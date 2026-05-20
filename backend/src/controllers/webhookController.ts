import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { storeWhatsAppMedia } from '../services/mediaService';

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

// ─────────────────────────────────────────────────────────────────────────────
// Inbound message receiver — Meta requires 200 within 3 seconds
// ─────────────────────────────────────────────────────────────────────────────

export function receiveWebhook(req: Request, res: Response): void {
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
// Message parser
//
// Handles messages like:
//   "TSK-1054 done, mirrors installed"   → status update + comment
//   "done"                               → status update on latest task
//   "issue gateway is down"              → issue report
//   "delay need 2 more days"             → delay request
//   (image/doc with caption)             → media + optional status/comment
//   (image/doc with no caption)          → attachment logged as comment
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedReply {
  taskId:  string | null;
  action:  'done' | 'issue' | 'delay' | null;
  comment: string;
}

function parseReply(raw: string): ParsedReply {
  // Extract task ID (e.g. TSK-1054)
  const idMatch = raw.match(/\bTSK-\d+\b/i);
  const taskId  = idMatch ? idMatch[0].toUpperCase() : null;

  // Remove the task ID and surrounding punctuation/spaces
  let rest = raw
    .replace(/\bTSK-\d+\b/i, '')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .trim();

  // Detect status keyword and strip it, leaving the comment behind
  let action: ParsedReply['action'] = null;

  if (/\bdone\b/i.test(rest)) {
    action = 'done';
    rest = rest.replace(/\bdone\b/i, '').replace(/^[\s,]+/, '').trim();
  } else if (/\bissue\b/i.test(rest)) {
    action = 'issue';
    rest = rest.replace(/\bissue\b/i, '').replace(/^[\s,]+/, '').trim();
  } else if (/\bdelay\b/i.test(rest)) {
    action = 'delay';
    rest = rest.replace(/\bdelay\b/i, '').replace(/^[\s,]+/, '').trim();
  }

  return { taskId, action, comment: rest };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core processing — runs after 200 is already sent to Meta
// ─────────────────────────────────────────────────────────────────────────────

async function processInbound(body: unknown): Promise<void> {
  const entry   = (body as any)?.entry?.[0]?.changes?.[0]?.value;
  const message = entry?.messages?.[0];
  if (!message) return;

  // Meta always sends phone as digits-only E.164 (e.g. "919174192837")
  // Normalise so the DB lookup matches regardless of how the number was stored
  const senderPhone: string = (message.from as string).replace(/\D/g, '');
  const msgType: string     = message.type;

  // ── 1. Extract text + optional media ID based on message type ────────────
  let rawText = '';
  let mediaId: string | null = null;

  switch (msgType) {
    case 'text':
      rawText = (message.text?.body     as string ?? '').trim();
      break;
    case 'image':
      rawText = (message.image?.caption   as string ?? '').trim();
      mediaId = message.image?.id   ?? null;
      break;
    case 'document':
      rawText = (message.document?.caption as string ?? '').trim();
      mediaId = message.document?.id ?? null;
      break;
    case 'video':
      rawText = (message.video?.caption   as string ?? '').trim();
      mediaId = message.video?.id   ?? null;
      break;
    default:
      // audio, sticker, reaction, location — ignore
      return;
  }

  // ── 2. Parse the text ────────────────────────────────────────────────────
  const { taskId, action, comment } = parseReply(rawText);

  // ── 3. Find the task ─────────────────────────────────────────────────────
  let task = null;

  if (taskId) {
    // Exact ID lookup — match by task ID + sender phone (strip non-digits for comparison)
    task = await prisma.task.findFirst({
      where: {
        id:         taskId,
        assignedTo: { phone: { contains: senderPhone.slice(-10) } },
      },
      include: { assignedTo: true },
    });
  }

  if (!task) {
    // Fallback: most recently touched task for this sender (last 7 days).
    // No status filter — someone sending a photo after marking "done" is valid proof.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    task = await prisma.task.findFirst({
      where: {
        alertDispatched: true,
        updatedAt:  { gt: sevenDaysAgo },
        assignedTo: { phone: { contains: senderPhone.slice(-10) } },
      },
      orderBy: { updatedAt: 'desc' },
      include: { assignedTo: true },
    });
  }

  if (!task) {
    console.log(`[Webhook] No task found for sender ${senderPhone} (taskId=${taskId ?? 'none'})`);
    return;
  }

  // ── 4. Download & store attachment (non-blocking — fires in parallel) ─────
  const mediaUrl = mediaId ? await storeWhatsAppMedia(mediaId) : null;

  // ── 5. Apply action ──────────────────────────────────────────────────────
  if (!action) {
    // No status keyword → log as a free-text comment / media attachment
    await prisma.activity.create({
      data: {
        taskId: task.id,
        byId:   task.assignedToId,
        type:   'whatsapp',
        text:   rawText || '📎 Attachment received',
        ...(mediaUrl && { mediaUrl }),
      },
    });
    return;
  }

  const STATUS_MAP = {
    done:  'Done',
    issue: 'Issue',
    delay: 'Delay',
  } as const;

  const LABEL_MAP = {
    done:  'Marked done via WhatsApp',
    issue: 'Issue reported via WhatsApp',
    delay: 'Delay requested via WhatsApp',
  };

  const newStatus = STATUS_MAP[action];
  const actText   = comment
    ? `${LABEL_MAP[action]}: ${comment}`
    : LABEL_MAP[action];

  await prisma.task.update({
    where: { id: task.id },
    data: {
      status: newStatus,
      activities: {
        create: {
          byId: task.assignedToId,
          type: 'whatsapp',
          text: actText,
          ...(mediaUrl && { mediaUrl }),
        },
      },
    },
  });

  console.log(`[Webhook] Task ${task.id} → ${newStatus}${comment ? ` (${comment})` : ''}${mediaUrl ? ' + attachment' : ''}`);
}
