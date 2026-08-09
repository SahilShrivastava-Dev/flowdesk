/**
 * Conversation helpers.
 *
 * Mirrors backend/src/services/conversationService.ts — `sessionStatus` and
 * `previewFor` must produce the same result on both ends, or the list preview
 * and the session badge disagree with the API. Keep the two in sync.
 */

export const DIRECTION = { INBOUND: 'inbound', OUTBOUND: 'outbound' };

export const KIND = {
  TEXT: 'text', IMAGE: 'image', DOCUMENT: 'document',
  VIDEO: 'video', VOICE: 'voice', INTERACTIVE: 'interactive', SYSTEM: 'system',
};

export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Mirrors WhatsApp's own tick states, driven by Meta's status webhook. */
export const DELIVERY = {
  PENDING:   'pending',    // still in flight from us
  SENT:      'sent',       // one grey tick
  DELIVERED: 'delivered',  // two grey ticks
  READ:      'read',       // two blue ticks
  FAILED:    'failed',
};

export const DELIVERY_LABEL = {
  pending:   'Sending…',
  sent:      'Sent',
  delivered: 'Delivered',
  read:      'Read',
  failed:    'Not delivered',
};

/** Human explanation of why a message ended up on a task. Shown on hover. */
export const ATTRIBUTION_LABEL = {
  explicit_ref:     'They named this task',
  reply_context:    'They replied to a message about this task',
  list_reply:       'They picked it from a list',
  single_open_task: 'Their only open task',
  recent_context:   'Follow-up to the previous message',
  manual:           'Linked manually',
  none:             'Not linked to a task',
};

/**
 * Attributions where a human actually said which task this is about.
 *
 * `reply_context` belongs here: tapping a template button, or swipe-replying to
 * a message, points at one specific task as deliberately as typing its number.
 * It is not the inference that `recent_context` is.
 */
const STATED_BY_A_HUMAN = ['explicit_ref', 'reply_context', 'list_reply', 'manual'];

/**
 * Should this message display its task chip?
 *
 * A message can be *linked* to a task without *being about* it — "Ok" gets
 * attached to whatever was last discussed so a later photo still lands
 * somewhere sensible. Labelling those is noise: people switch between tasks
 * constantly, and a chip over every "thanks" makes the thread unreadable and
 * implies a precision the inference doesn't have.
 *
 * So the chip appears only when someone actually said which task it was, or
 * when the message carries evidence worth filing against one.
 */
export function showsTaskChip(msg) {
  if (!msg?.taskId) return false;
  if (STATED_BY_A_HUMAN.includes(msg.attributedBy)) return true;
  // Photos, documents and voice notes are the proof attached to a task — worth
  // labelling even when the link was inferred.
  if (msg.mediaUrl || msg.kind === KIND.VOICE) return true;
  return false;
}

/**
 * WhatsApp's 24h free-form window, measured from the last message the person
 * sent us. One window per phone number — which is exactly why this takes a
 * single timestamp now instead of scanning every task's activity.
 */
export function sessionStatus(lastInboundAt) {
  if (!lastInboundAt) return { open: false, minutesAgo: null };
  const ms = Date.now() - new Date(lastInboundAt).getTime();
  return {
    open: ms < SESSION_WINDOW_MS,
    minutesAgo: Math.max(0, Math.round(ms / 60000)),
  };
}

/** One-line summary for the conversation list. */
export function previewFor(msg) {
  if (!msg) return 'No messages yet';
  if (msg.kind === KIND.VOICE) {
    return msg.transcription ? `🎙️ "${msg.transcription.slice(0, 60)}"` : '🎙️ Voice note';
  }
  if (msg.text?.trim()) return msg.text.trim().slice(0, 80);
  if (msg.mediaUrl) return '📎 Attachment';
  return 'No messages yet';
}

/** "12m ago" / "3h ago" / "Tue" — compact age for the conversation list. */
export function shortAge(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * Split a chronological message list into day groups so the merged thread —
 * which can span weeks now that it isn't scoped to one task — stays readable.
 */
export function groupByDay(messages) {
  const groups = [];
  let current = null;

  for (const m of messages) {
    const key = new Date(m.createdAt).toDateString();
    if (!current || current.key !== key) {
      current = { key, label: dayLabel(m.createdAt), items: [] };
      groups.push(current);
    }
    current.items.push(m);
  }
  return groups;
}

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Merge server messages with locally-pending ones.
 *
 * An optimistic bubble is dropped as soon as the server returns the real row,
 * matched on `clientId`. Without this the sender sees their message twice for
 * one poll interval.
 */
export function mergeOptimistic(serverMessages, pending = []) {
  if (pending.length === 0) return serverMessages;
  const serverIds = new Set(serverMessages.map((m) => m.id));
  const stillPending = pending.filter((p) => !serverIds.has(p.resolvedId));
  return [...serverMessages, ...stillPending];
}
