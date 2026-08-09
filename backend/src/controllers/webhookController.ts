import crypto from 'crypto';
import { Request, Response } from 'express';
import {
  ActionChannel, AttributionSource, DeliveryStatus, MessageDirection, MessageKind, TaskStatus,
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ACTIVITY_TYPE, MAX_LIST_ROWS } from '../lib/constants';
import { storeWhatsAppMedia, downloadWhatsAppMedia, uploadBufferToCloudinary } from '../services/mediaService';
import { transcribeAudio } from '../services/transcriptionService';
import { analyzeMessage, hasExplicitTaskRef, IntentResult } from '../services/intentService';
import { decideAttribution } from '../services/attributionService';
import {
  adoptRecentUnattributed, findPendingAttribution, getLastAttributedTaskId,
  getUserTaskContext, kindFromMetaType, resolveUserByPhone, taskHasEvidence,
} from '../services/conversationService';
import { sendInteractiveList, sendTextMessage } from '../services/whatsappService';
import {
  CommandActor, looksLikeCommand, tryHandleAttachment, tryHandleCommand,
} from '../services/commandExecutor';
import { rollUpStatus } from '../services/taskService';

// ─────────────────────────────────────────────────────────────────────────────
// Webhook verification (Meta challenge handshake)
// ─────────────────────────────────────────────────────────────────────────────

export function verifyWebhook(req: Request, res: Response): void {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
}

/**
 * Verify Meta's payload signature.
 *
 * `index.ts` already mounts express.raw() on this route specifically so the
 * exact bytes are available for this check — but the check itself was never
 * written, leaving the endpoint forgeable: anyone who found the URL could POST
 * fake worker replies and flip task statuses.
 *
 * When META_APP_SECRET is unset we warn and allow, so existing deployments
 * don't break the moment this ships. Set it in production.
 */
function verifyMetaSignature(req: Request): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    console.warn('[Webhook] META_APP_SECRET not set — accepting unverified payload');
    return true;
  }

  const header = req.get('x-hub-signature-256');
  if (!header?.startsWith('sha256=')) {
    console.error('[Webhook] REJECTED: missing or malformed X-Hub-Signature-256');
    return false;
  }

  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body), 'utf8');
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    console.error('[Webhook] REJECTED: signature mismatch');
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inbound receiver — Meta requires a 200 within 3 seconds
// ─────────────────────────────────────────────────────────────────────────────

export function receiveWebhook(req: Request, res: Response): void {
  if (!verifyMetaSignature(req)) {
    res.sendStatus(403);
    return;
  }

  res.status(200).send('EVENT_RECEIVED');

  // express.raw() gives a Buffer; express.json() gives an object; handle all three
  let body: unknown;
  try {
    if (Buffer.isBuffer(req.body)) {
      body = JSON.parse(req.body.toString('utf8'));
    } else if (typeof req.body === 'string') {
      body = JSON.parse(req.body);
    } else {
      body = req.body;
    }
  } catch {
    console.error('[Webhook] Failed to parse body');
    return;
  }

  setImmediate(() => processInbound(body).catch(console.error));
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline
//
//   1. Dedupe on Meta's message id — BEFORE any expensive work, so a retried
//      delivery doesn't re-download and re-transcribe the same audio.
//   2. Resolve the sender to a user (the conversation owner).
//   3. Extract text + media. Voice notes are transcribed here, because the
//      transcript is the only thing that says which task they meant.
//   4. Work out intent, then which task it belongs to.
//   5. Always persist one Message — including rejected and unattributed ones.
//   6. Apply an outcome only when we're confident which task it was.
// ─────────────────────────────────────────────────────────────────────────────

interface InboundContent {
  text:          string;
  mediaUrl:      string | null;
  transcription: string | null;
  kind:          MessageKind;
}

async function processInbound(body: unknown): Promise<void> {
  const value = (body as any)?.entry?.[0]?.changes?.[0]?.value;
  if (!value) return;

  // Delivery receipts for messages WE sent — this is what drives the ticks.
  if (Array.isArray(value.statuses)) {
    for (const status of value.statuses) {
      try {
        await processStatus(status);
      } catch (err) {
        console.error(`[Webhook] Failed processing status ${status?.id}:`, err);
      }
    }
  }

  const messages = value.messages;
  if (!Array.isArray(messages) || messages.length === 0) return;

  // Meta can batch several messages into one delivery. The old code read
  // messages[0] and silently dropped the rest.
  for (const message of messages) {
    try {
      await processMessage(message);
    } catch (err) {
      console.error(`[Webhook] Failed processing message ${message?.id}:`, err);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Delivery receipts
//
// Meta reports sent → delivered → read for every outbound message, keyed by the
// wamid we stored when sending. Receipts can arrive out of order, so status is
// only ever allowed to move forward: a late "sent" must not undo a "read".
// ─────────────────────────────────────────────────────────────────────────────

const DELIVERY_RANK: Record<string, number> = {
  [DeliveryStatus.pending]:   0,
  [DeliveryStatus.sent]:      1,
  [DeliveryStatus.delivered]: 2,
  [DeliveryStatus.read]:      3,
  [DeliveryStatus.failed]:    3,
};

const META_STATUS_MAP: Record<string, DeliveryStatus> = {
  sent:      DeliveryStatus.sent,
  delivered: DeliveryStatus.delivered,
  read:      DeliveryStatus.read,
  failed:    DeliveryStatus.failed,
};

async function processStatus(status: any): Promise<void> {
  const waMessageId: string | undefined = status?.id;
  const next = META_STATUS_MAP[String(status?.status ?? '')];
  if (!waMessageId || !next) return;

  const existing = await prisma.message.findUnique({
    where:  { waMessageId },
    select: { id: true, deliveryStatus: true },
  });

  if (!existing) {
    // A receipt for something we didn't send, or sent before wamids were
    // recorded. Logged rather than dropped silently: if ticks aren't
    // advancing, seeing this line proves Meta IS sending receipts and the
    // problem is the missing id — which is a completely different fix from
    // "Meta never sent anything".
    console.log(`[Webhook] receipt "${status.status}" for unknown message ${waMessageId} — ignoring`);
    return;
  }

  if (DELIVERY_RANK[next] <= DELIVERY_RANK[existing.deliveryStatus]) return;

  const errorText = next === DeliveryStatus.failed
    ? status?.errors?.[0]?.title ?? 'WhatsApp reported a delivery failure'
    : null;

  await prisma.message.update({
    where: { id: existing.id },
    data: { deliveryStatus: next, ...(errorText && { deliveryError: errorText }) },
  });

  console.log(`[Webhook] ${waMessageId} → ${next}`);
}

async function processMessage(message: any): Promise<void> {
  const waMessageId: string | null = message?.id ?? null;

  // ── 1. Idempotency ───────────────────────────────────────────────────────
  if (waMessageId) {
    const seen = await prisma.message.findUnique({
      where:  { waMessageId },
      select: { id: true },
    });
    if (seen) {
      console.log(`[Webhook] duplicate delivery ${waMessageId} — ignoring`);
      return;
    }
  }

  // ── 2. Who is this? ──────────────────────────────────────────────────────
  const senderPhone = String(message.from ?? '').replace(/\D/g, '');
  const user = await resolveUserByPhone(senderPhone);
  if (!user) {
    console.log(`[Webhook] No user matches phone ${senderPhone} — ignoring`);
    return;
  }

  // ── 3. Text + media ──────────────────────────────────────────────────────
  const content = await extractContent(message);
  if (!content) return;

  // ── 3.5. A management command? ───────────────────────────────────────────
  // "Assign TSK-1059 to Vikranth" is a different kind of message from "1059
  // done" and takes a different path. Everything below this point is the
  // worker-report pipeline and is untouched: when this returns false, not one
  // line of the original behaviour changes.
  if (await handleAsCommand(user, content, waMessageId)) return;

  // ── 4. Intent + attribution ──────────────────────────────────────────────
  const intent = await analyzeMessage(content.text);
  const { ownedTaskIds, openTasks, allTasks } = await getUserTaskContext(user.id);
  const pending = await findPendingAttribution(user.id);

  const decision = decideAttribution({
    explicitRef:          intent.taskRef,
    refIsExplicit:        hasExplicitTaskRef(content.text),
    replyToTaskId:        await taskOfRepliedMessage(message),
    ownedTaskIds,
    openTasks:            openTasks.map((t) => ({ id: t.id, updatedAt: t.updatedAt })),
    lastAttributedTaskId: await getLastAttributedTaskId(user.id),
    action:               intent.action,
    pendingTaskChoice:    pending !== null,
  });

  // ── 5. Persist the message, always ───────────────────────────────────────
  // Even a rejected or unroutable message gets recorded. Dropping it on the
  // floor is what made the old misroutes invisible.
  const created = await prisma.message.create({
    data: {
      userId:           user.id,
      senderId:         user.id,          // inbound: actor is the owner
      direction:        MessageDirection.inbound,
      kind:             content.kind,
      taskId:           decision.taskId,
      attributedBy:     decision.attributedBy,
      needsAttribution: decision.needsAttribution,
      intentAction:     decision.needsAttribution ? intent.action : null,
      intentConfidence: decision.needsAttribution ? intent.confidence : null,
      text:             content.text,
      mediaUrl:         content.mediaUrl,
      transcription:    content.transcription,
      waMessageId,
    },
  });

  // ── 6. Act ───────────────────────────────────────────────────────────────
  if (decision.rejected) {
    console.log(`[Webhook] ${user.name} referenced ${intent.taskRef} — not their task`);
    await sendTextMessage(
      user.phone!,
      `${intent.taskRef} isn't assigned to you, so I haven't changed it. ` +
      `Reply with one of your own task numbers if you meant a different one.`,
    );
    return;
  }

  if (decision.needsAttribution) {
    await askWhichTask(user, decision.ambiguousAmong, allTasks);
    console.log(
      `[Webhook] ${user.name}: "${intent.action}" but ${decision.ambiguousAmong.length} open tasks — asked which`,
    );
    return;
  }

  if (!decision.taskId) return;

  // The worker has named a task while an earlier message was waiting on one,
  // so that earlier message is resolved either way.
  if (pending) await resolvePending(pending.id, decision.taskId);

  // Which outcome applies? The one in THIS message if it stated one; otherwise
  // the one parked on the message that was awaiting a task.
  //
  // Order matters. "TSK-1055 issue" after a parked "done" must report an issue
  // on TSK-1055 — applying the parked "done" instead would mark it complete.
  const action  = intent.action ?? (pending?.intentAction as IntentResult['action'] ?? null);
  const summary = intent.action ? intent.summary : pending?.text ?? '';

  if (action) {
    await applyOutcome(decision.taskId, user.id, action, {
      messageId: created.id,
      summary,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Management commands
//
// A manager reassigning a ticket is doing something categorically different
// from a worker reporting on one, so it gets its own branch rather than being
// squeezed into the attribution machinery — which exists to answer "which of
// YOUR tasks is this about?", a question that doesn't apply here.
//
// Returns true when the message was a command and has been dealt with. False
// means "not mine", and the caller carries on down the original pipeline.
// ─────────────────────────────────────────────────────────────────────────────

interface WebhookUser {
  id: string;
  name: string;
  phone: string | null;
  role: string;
}

async function handleAsCommand(
  user: WebhookUser,
  content: InboundContent,
  waMessageId: string | null,
): Promise<boolean> {
  const actor: CommandActor = {
    id: user.id, name: user.name, role: user.role, phone: user.phone,
  };

  // A photograph or document — either attached now, or referred to from a
  // moment ago. Checked first: "send this to Vedant" is about a file, and the
  // ordinary command parser has no idea what "this" is.
  const mediaKind =
    content.kind === MessageKind.image    ? 'image' as const
    : content.kind === MessageKind.document ? 'document' as const
    : content.kind === MessageKind.video    ? 'video' as const
    : null;

  const attachmentResult = await tryHandleAttachment(
    { actor, text: content.text, transcription: content.transcription, waMessageId, messageId: null },
    // A VOICE note also has a media url, but it is not a file to forward — the
    // transcript is the message. Passing it here made every spoken command get
    // read as "share this recording with somebody".
    { url: mediaKind ? content.mediaUrl : null, kind: mediaKind },
  );
  if (attachmentResult) {
    await persistCommandTurn(user, content, waMessageId, attachmentResult);
    return true;
  }

  if (!(await looksLikeCommand(actor, content.text))) return false;

  const result = await tryHandleCommand({
    actor,
    text:          content.text,
    transcription: content.transcription,
    waMessageId,
    // Deliberately null. The inbound Message row is written AFTER the command
    // runs and back-linked below — creating it first would leave an orphaned,
    // unattributed row behind every time the executor declines the message and
    // the worker pipeline takes over instead.
    messageId: null,
  });

  if (!result) return false;

  await persistCommandTurn(user, content, waMessageId, result);
  console.log(
    `[Webhook] command from ${user.name} → ${result.status}` +
    (result.status === 'executed' ? '' : ` — ${result.reply.replace(/\s+/g, ' ').slice(0, 140)}`),
  );
  return true;
}

/**
 * Record both halves of a command turn: the sender's message, and our reply.
 *
 * Shared by the command and attachment paths so a message can never be handled
 * without appearing in the conversation.
 */
async function persistCommandTurn(
  user: WebhookUser,
  content: InboundContent,
  waMessageId: string | null,
  result: { reply: string; taskId: string | null },
): Promise<void> {
  // `result.taskId` is the ticket the COMMAND was about, which is not the same
  // as a ticket that exists: "assign TSK-9999 to Vedant" produces a perfectly
  // good audit row naming TSK-9999, and `WhatsAppCommand.taskId` has no foreign
  // key precisely so it can hold that. `Message.taskId` does have one, so it
  // gets the id only after confirming there is a row to point at — otherwise
  // the insert fails and takes the sender's reply down with it.
  const linkedTaskId = result.taskId
    ? (await prisma.task.findUnique({ where: { id: result.taskId }, select: { id: true } }))?.id ?? null
    : null;

  // The sender's own message. `kind` reflects how it arrived — a voice command
  // is still a voice note in the conversation view.
  const inbound = await prisma.message.create({
    data: {
      userId:       user.id,
      senderId:     user.id,
      direction:    MessageDirection.inbound,
      kind:         content.kind,
      taskId:       linkedTaskId,
      attributedBy: linkedTaskId ? AttributionSource.explicit_ref : AttributionSource.none,
      text:          content.text,
      mediaUrl:      content.mediaUrl,
      transcription: content.transcription,
      waMessageId,
    },
  });

  // Link the audit rows this turn produced back to the message that carried it.
  // Scoped by wamid, which Meta guarantees unique, so this can only ever touch
  // the rows just written.
  if (waMessageId) {
    await prisma.whatsAppCommand.updateMany({
      where: { senderId: user.id, waMessageId, messageId: null },
      data:  { messageId: inbound.id },
    });
  }

  await replyToSender(user, result.reply, linkedTaskId);
}

/**
 * Answer the sender, and keep the answer in the conversation.
 *
 * Always a free-form text message: the sender messaged us moments ago, so their
 * 24h session is open by definition. That is not true of the person receiving
 * the ticket, which is why `notifyService` has to think about templates and
 * this doesn't.
 */
async function replyToSender(
  user: WebhookUser,
  text: string,
  taskId: string | null,
): Promise<void> {
  if (!user.phone) return;

  const result = await sendTextMessage(user.phone, text);

  await prisma.message.create({
    data: {
      userId:    user.id,
      senderId:  user.id,   // the system replying inside their own thread
      direction: MessageDirection.outbound,
      kind:      MessageKind.system,
      taskId,
      attributedBy:   taskId ? AttributionSource.manual : AttributionSource.none,
      text,
      waMessageId:    result.waMessageId ?? null,
      deliveryStatus: result.ok ? DeliveryStatus.sent : DeliveryStatus.failed,
      deliveryError:  result.ok ? null : result.error ?? 'Send failed',
    },
  });
}

/**
 * Which task, if any, the message being replied to was about.
 *
 * WhatsApp sets `context.id` to the wamid of the quoted message whenever
 * somebody taps a quick-reply button on one of our templates or swipe-replies
 * to a message. Since every template send is now stored with its `waMessageId`
 * and `taskId`, that id resolves to a task exactly — no window, no inference.
 *
 * This is what makes a button tap unambiguous for somebody holding six tasks:
 * they did not type "done" into the void, they pressed a button attached to one
 * specific task's message.
 *
 * `context` is also present on messages forwarded from elsewhere, where the
 * quoted id is not ours — hence the lookup, which simply finds nothing and
 * leaves attribution to the branches below it.
 */
async function taskOfRepliedMessage(message: any): Promise<string | null> {
  const quotedId: string | null = message?.context?.id ?? null;
  if (!quotedId) return null;

  const quoted = await prisma.message.findUnique({
    where:  { waMessageId: quotedId },
    select: { taskId: true },
  });
  if (quoted?.taskId) {
    console.log(`[Webhook] reply to ${quotedId} → ${quoted.taskId}`);
  }
  return quoted?.taskId ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Content extraction
// ─────────────────────────────────────────────────────────────────────────────

async function extractContent(message: any): Promise<InboundContent | null> {
  const msgType: string = message.type;
  const kind = kindFromMetaType(msgType);

  switch (msgType) {
    case 'text':
      return {
        text: String(message.text?.body ?? '').trim(),
        mediaUrl: null, transcription: null, kind,
      };

    case 'image':
    case 'document':
    case 'video': {
      const payload = message[msgType];
      const mediaId = payload?.id ?? null;
      return {
        text: String(payload?.caption ?? '').trim(),
        mediaUrl: mediaId ? await storeWhatsAppMedia(mediaId) : null,
        transcription: null, kind,
      };
    }

    case 'audio': {
      // Voice notes have no caption — the transcript IS the message, and it
      // has to exist before we can tell which task they meant.
      const mediaId = message.audio?.id ?? null;
      if (!mediaId) return null;

      const downloaded = await downloadWhatsAppMedia(mediaId);
      if (!downloaded) {
        console.warn('[Webhook] 🎙️ voice note download failed');
        return { text: '', mediaUrl: null, transcription: null, kind };
      }

      const [cloudinaryUrl, transcript] = await Promise.all([
        uploadBufferToCloudinary(downloaded.buffer, mediaId, 'flowdesk/voice-notes'),
        transcribeAudio(downloaded.buffer, downloaded.mimeType),
      ]);

      console.log(`[Webhook] 🎙️ transcript: "${(transcript ?? '').slice(0, 100)}"`);
      return {
        text: transcript ?? '',
        mediaUrl: cloudinaryUrl ?? null,
        transcription: transcript ?? null,
        kind,
      };
    }

    case 'interactive': {
      const i = message.interactive;
      const id = String(
        i?.type === 'button_reply' ? i.button_reply?.id
        : i?.type === 'list_reply' ? i.list_reply?.id
        : '',
      ).trim();
      if (!id) return null;
      console.log(`[Webhook] interactive reply: "${id}"`);
      return { text: id, mediaUrl: null, transcription: null, kind };
    }

    case 'button': {
      // A quick-reply button on a TEMPLATE, which is a different message shape
      // from the `interactive` buttons we send ourselves: Meta delivers it as
      // its own top-level type carrying `{ text, payload }` rather than a
      // `button_reply` with an id.
      //
      // Without this case every tap fell through to `default` and was dropped
      // silently — the worker pressed "Done", the task never moved, and nothing
      // was recorded to show they had tried.
      //
      // The label is treated as ordinary text on purpose: the button wording is
      // chosen to match the phrase banks in intentService, so "Done" /
      // "पूरा हो गया" / "और समय चाहिए" route exactly like the same words typed
      // by hand, in whichever language the template went out in.
      const b = message.button;
      const label = String(b?.text ?? b?.payload ?? '').trim();
      if (!label) return null;
      console.log(`[Webhook] template button: "${label}"`);
      return { text: label, mediaUrl: null, transcription: null, kind: MessageKind.text };
    }

    default:
      // sticker, reaction, location — ignore
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Disambiguation
// ─────────────────────────────────────────────────────────────────────────────

async function askWhichTask(
  user: { id: string; phone: string | null; name: string },
  candidateIds: string[],
  allTasks: { id: string; title: string }[],
): Promise<void> {
  if (!user.phone) return;

  const titleById = new Map(allTasks.map((t) => [t.id, t.title]));
  const rows = candidateIds.slice(0, MAX_LIST_ROWS).map((id) => ({
    id,
    title: id.slice(0, 24),                                   // Meta caps at 24
    description: (titleById.get(id) ?? '').slice(0, 72),      // and 72
  }));

  await sendInteractiveList(
    user.phone,
    'Which task did you mean?',
    'Choose task',
    [{ title: 'Your open tasks', rows }],
    undefined,
    'Tap one, or reply with the task number.',
  );
}

/** Link a parked message to the task the worker finally picked. */
async function resolvePending(messageId: string, taskId: string): Promise<void> {
  await prisma.message.update({
    where: { id: messageId },
    data: { taskId, attributedBy: AttributionSource.list_reply, needsAttribution: false },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Outcomes
//
//   done + photo/document on the task → Done, auto-approved
//   done, no evidence                 → Done, awaiting approval
//   issue / delay                     → Issue / Delay
//
// The message text itself lives in `Message`. What lands in `Activity` is the
// audit row for the status change, so nothing is rendered twice and the task
// history stays complete.
// ─────────────────────────────────────────────────────────────────────────────

// A worker reporting completion moves the task to Submitted, never straight to
// Done. Done means someone reviewed it — a WhatsApp message is a submission,
// not a verification.
const STATUS_MAP: Record<string, TaskStatus> = {
  done:     TaskStatus.Submitted,
  issue:    TaskStatus.Issue,
  delay:    TaskStatus.Delay,
  progress: TaskStatus.InProgress,
};

const LABEL_MAP: Record<string, string> = {
  done:     'Submitted for approval via WhatsApp',
  issue:    'Issue reported via WhatsApp',
  delay:    'Delay requested via WhatsApp',
  progress: 'Started via WhatsApp',
};

async function applyOutcome(
  taskId: string,
  userId: string,
  action: IntentResult['action'],
  ctx: { messageId: string; summary: string },
): Promise<void> {
  if (!action || !STATUS_MAP[action]) return;

  const task = await prisma.task.findUnique({
    where:  { id: taskId },
    select: {
      id: true, status: true, approved: true, assignedToId: true, assignmentMode: true,
      assignees: { select: { userId: true, status: true, user: { select: { name: true } } } },
    },
  });
  if (!task) return;

  const reported = STATUS_MAP[action];

  // A photo sent moments before "task 1060 done" belongs to that task.
  if (action === 'done') await adoptRecentUnattributed(userId, taskId);

  // Evidence no longer auto-approves. Approval is a human decision now, so a
  // photo is something the approver weighs rather than something that bypasses
  // them — it's noted on the submission instead.
  const hasEvidence = action === 'done' && (await taskHasEvidence(taskId));

  // ── Record THIS person's part ────────────────────────────────────────────
  // The reporter is whoever sent the message, not the primary assignee — on a
  // shared task those differ, and attributing Vikranth's update to Vedant is
  // exactly the confusion this table exists to prevent.
  const mine = task.assignees.find((a) => a.userId === userId);
  const otherStatuses = task.assignees
    .filter((a) => a.userId !== userId)
    .map((a) => a.status);

  const newStatus = mine
    ? rollUpStatus([...otherStatuses, reported])
    : reported;   // not a holder (shouldn't happen — attribution checks first)

  // Repeating an outcome that changes nothing shouldn't rewrite the status or
  // fire a second notification. Both halves have to be unchanged: on a shared
  // task the roll-up can stay put while this person's own part moves forward.
  const myPartUnchanged = !mine || mine.status === reported;
  if (task.status === newStatus && myPartUnchanged) {
    console.log(`[Webhook] ${taskId} already ${newStatus} — message logged, no status change`);
    return;
  }

  const parts = [LABEL_MAP[action]];
  if (ctx.summary) parts.push(`: ${ctx.summary}`);
  if (hasEvidence) parts.push(' 📎 with attachment');

  // Who is still outstanding, for the audit line and the reply.
  const waitingOn = task.assignees
    .filter((a) => a.userId !== userId && a.status !== TaskStatus.Submitted && a.status !== TaskStatus.Done)
    .map((a) => a.user.name);

  if (task.assignmentMode === 'shared' && action === 'done' && waitingOn.length > 0) {
    parts.push(` — waiting on ${waitingOn.join(', ')}`);
  }

  // One transaction so a status change can never exist without its audit row.
  await prisma.$transaction([
    prisma.task.update({
      where: { id: taskId },
      data: {
        status: newStatus,
      },
    }),
    ...(mine ? [prisma.taskAssignee.update({
      where: { taskId_userId: { taskId, userId } },
      data: {
        status: reported,
        submittedAt: reported === TaskStatus.Submitted ? new Date() : null,
      },
    })] : []),
    prisma.activity.create({
      data: {
        taskId,
        // The person who actually reported it.
        byId: userId,
        type: ACTIVITY_TYPE.STATUS,
        text: parts.join(''),
        channel: ActionChannel.whatsapp,
      },
    }),
  ]);

  console.log(`[Webhook] ${taskId} → ${newStatus}${hasEvidence ? ' (with attachment)' : ''}`);
}

// Exported for integration tests: receiveWebhook answers Meta before any of
// this runs, so a test that drives the HTTP route can't observe the result.
export const __test = { processInbound, processMessage, applyOutcome };
