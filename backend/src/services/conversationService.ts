import { Message, MessageDirection, MessageKind, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { CONTEXT_WINDOW_MS, EVIDENCE_ADOPT_MS, SESSION_WINDOW_MS } from '../lib/constants';
import { heldByUser } from './taskService';

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers — mirrored by src/lib/conversations.js on the frontend so both
// ends render the same thing. Keep the two in sync.
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionState {
  open: boolean;
  minutesAgo: number | null;
  expiresAt: string | null;
}

/**
 * WhatsApp's 24-hour free-form window, measured from the last message the
 * person sent US. One window per phone number — not per task, which is what
 * the old per-task calculation got wrong.
 */
export function computeSession(lastInboundAt: Date | null, now: Date = new Date()): SessionState {
  if (!lastInboundAt) return { open: false, minutesAgo: null, expiresAt: null };

  const elapsed = now.getTime() - lastInboundAt.getTime();
  const expires = new Date(lastInboundAt.getTime() + SESSION_WINDOW_MS);

  return {
    open: elapsed < SESSION_WINDOW_MS,
    minutesAgo: Math.max(0, Math.round(elapsed / 60_000)),
    expiresAt: expires.toISOString(),
  };
}

type PreviewSource = Pick<Message, 'kind' | 'text' | 'transcription' | 'mediaUrl'>;

/** One-line summary for the conversation list. */
export function previewFor(msg: PreviewSource | null | undefined): string {
  if (!msg) return 'No messages yet';

  if (msg.kind === MessageKind.voice) {
    return msg.transcription ? `🎙️ "${msg.transcription.slice(0, 60)}"` : '🎙️ Voice note';
  }
  if (msg.text?.trim()) return msg.text.trim().slice(0, 80);
  if (msg.mediaUrl) return '📎 Attachment';
  return 'No messages yet';
}

/** Meta message type → our `kind`. */
export function kindFromMetaType(metaType: string): MessageKind {
  switch (metaType) {
    case 'image':       return MessageKind.image;
    case 'document':    return MessageKind.document;
    case 'video':       return MessageKind.video;
    case 'audio':       return MessageKind.voice;
    case 'interactive': return MessageKind.interactive;
    default:            return MessageKind.text;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Database helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Match a Meta phone number to a user.
 *
 * Meta sends digits-only E.164 ("919174192837"); stored numbers may carry
 * spaces, a +, or a country code. Comparing the last 10 digits handles all of
 * those. Known limitation: it's an unindexed scan and two users sharing the
 * last 10 digits would collide — a normalised `phoneE164 @unique` column is
 * the real fix if the user base ever grows.
 */
export async function resolveUserByPhone(phone: string) {
  const last10 = phone.replace(/\D/g, '').slice(-10);
  if (last10.length < 10) return null;

  return prisma.user.findFirst({
    where: { phone: { contains: last10 } },
    select: { id: true, name: true, phone: true, role: true, reportingToId: true, preferredLanguage: true },
  });
}

/** Newest message this person sent us — drives the 24h session window. */
export async function getLastInbound(userId: string): Promise<Date | null> {
  const row = await prisma.message.findFirst({
    where: { userId, direction: MessageDirection.inbound },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}

export async function getSession(userId: string): Promise<SessionState> {
  return computeSession(await getLastInbound(userId));
}

/**
 * The task this conversation was last talking about, if recent enough to still
 * be the subject. Used to attribute follow-ups like "this one too".
 *
 * INBOUND ONLY, and that restriction is the whole point.
 *
 * This used to match any message with a task id, including the ones we send.
 * So assigning somebody a task wrote an outbound notification carrying that
 * task id, which became "what the conversation is about" for the next thirty
 * minutes — and their next bare "done" landed on the task they had just been
 * given rather than the one they had been working on all morning. The newest
 * task won every time, which looked exactly like the guessing this function
 * was written to replace.
 *
 * Escalations and deadline reminders made it worse still: the cron fires every
 * fifteen minutes and now records a message per notification, so on a busy day
 * the subject of the conversation was whatever the system last complained
 * about.
 *
 * What we said is not evidence of what they meant. Only what *they* said is.
 * When somebody genuinely is answering a message of ours, they reply to it, and
 * `context.id` carries that far more precisely than a thirty-minute window ever
 * could — see `replyToTaskId` in attributionService.
 */
export async function getLastAttributedTaskId(
  userId: string,
  withinMs: number = CONTEXT_WINDOW_MS,
): Promise<string | null> {
  const row = await prisma.message.findFirst({
    where: {
      userId,
      direction: MessageDirection.inbound,
      taskId: { not: null },
      createdAt: { gt: new Date(Date.now() - withinMs) },
    },
    orderBy: { createdAt: 'desc' },
    select: { taskId: true },
  });
  return row?.taskId ?? null;
}

/** The newest message still waiting for the worker to say which task it was. */
export async function findPendingAttribution(userId: string) {
  return prisma.message.findFirst({
    where: { userId, needsAttribution: true },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Attach recent unattributed media to a task the worker has just named.
 *
 * Now that a message can be unattributed, the common flow "[photo]" then
 * "task 1060 done" would otherwise leave the photo floating and the task
 * without evidence, so it would no longer auto-approve. This retroactively
 * links those photos to the task the worker names moments later.
 *
 * Returns how many messages were adopted.
 */
export async function adoptRecentUnattributed(
  userId: string,
  taskId: string,
  withinMs: number = EVIDENCE_ADOPT_MS,
): Promise<number> {
  const { count } = await prisma.message.updateMany({
    where: {
      userId,
      taskId: null,
      direction: MessageDirection.inbound,
      mediaUrl: { not: null },
      kind: { in: [MessageKind.image, MessageKind.document] },
      createdAt: { gt: new Date(Date.now() - withinMs) },
    },
    data: { taskId, attributedBy: 'recent_context' },
  });

  if (count > 0) {
    console.log(`[Conversation] adopted ${count} unattributed attachment(s) into ${taskId}`);
  }
  return count;
}

/**
 * Has this task been given photo/document evidence?
 *
 * Voice notes deliberately don't count — audio carries a claim, not proof.
 * That matches the previous behaviour, which filtered `type: 'whatsapp'` and
 * so excluded voice notes by omission; here it's stated explicitly.
 */
export async function taskHasEvidence(taskId: string): Promise<boolean> {
  const row = await prisma.message.findFirst({
    where: {
      taskId,
      direction: MessageDirection.inbound,
      mediaUrl: { not: null },
      kind: { in: [MessageKind.image, MessageKind.document] },
    },
    select: { id: true },
  });
  return row !== null;
}

/** Tasks assigned to this person, for attribution and the disambiguation list. */
export async function getUserTaskContext(userId: string) {
  const tasks = await prisma.task.findMany({
    // Co-assignments included. A worker on a shared task must be able to say
    // "done" about it over WhatsApp — with a primary-only check the task
    // wouldn't be a candidate and their message would be treated as chatter.
    where: heldByUser(userId),
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, status: true, updatedAt: true },
  });

  return {
    ownedTaskIds: new Set(tasks.map((t) => t.id)),
    // Submitted work is sitting with a reviewer, so it isn't a candidate for
    // "which task did they mean?" — the worker has already handed it over.
    openTasks: tasks.filter((t) => t.status !== 'Done' && t.status !== 'Submitted'),
    allTasks: tasks,
  };
}

/**
 * Role-based visibility, mirroring the scoping already used by listTasks and
 * listUsers: Admins see everyone, Managers see themselves plus direct reports,
 * Employees see only themselves.
 */
export function conversationScope(role: string, userId: string): Prisma.UserWhereInput {
  if (role === 'Admin') return {};
  if (role === 'Manager') return { OR: [{ id: userId }, { reportingToId: userId }] };
  return { id: userId };
}

/** Can this requester see the given person's conversation? */
export async function canAccessConversation(
  role: string,
  requesterId: string,
  targetUserId: string,
): Promise<boolean> {
  if (role === 'Admin') return true;
  if (requesterId === targetUserId) return true;
  if (role !== 'Manager') return false;

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { reportingToId: true },
  });
  return target?.reportingToId === requesterId;
}
