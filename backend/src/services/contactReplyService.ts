import { MessageDirection, MessageKind, TaskKind, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { recordOptOut, recordOptIn } from './contactService';
import { computeSession } from './conversationService';
import { sendTextMessage } from './whatsappService';
import { transliterate } from '../lib/devanagari';

// ─────────────────────────────────────────────────────────────────────────────
// A reply from an external party.
//
// The critical rule: this NEVER goes through `intentService.analyzeMessage`.
// That classifier reads a message as `done | issue | delay | progress` — a
// worker reporting on a task they hold. A vendor tapping "Payment done" holds
// no task, and running their reply through it would move somebody else's work
// to a state nobody asked for.
//
// Three things can arrive here:
//
//   1. A quick-reply button from one of our templates. Meta returns the button
//      LABEL, in whatever language the template was rendered in, so the map
//      below is keyed on the exact approved labels in both languages.
//   2. STOP, in any of the ways people write it. Honoured permanently and
//      before anything else — a party asking to be left alone must not have
//      that request parsed as an answer to our question.
//   3. Free text. Deliberately NOT interpreted. It is stored, the record is
//      marked as answered, and it is forwarded verbatim to the employee who
//      owns the relationship. Reading a payment commitment out of free text is
//      a project of its own, and guessing wrong about money is worse than not
//      guessing.
// ─────────────────────────────────────────────────────────────────────────────

/** What a reply means, independent of which language it arrived in. */
export type ReplyOutcome =
  | 'received'        // sample arrived
  | 'not_received'
  | 'paid'
  | 'needs_time'
  | 'query'           // a question about the invoice or order
  | 'details_ok'
  | 'details_change'
  | 'in_stock'
  | 'out_of_stock'
  | 'will_confirm'
  | 'confirmed'
  | 'opt_out'
  | 'opt_in'
  | 'unknown';

/**
 * Approved button labels → meaning.
 *
 * Keyed on the label because that is what Meta sends back for a template
 * quick reply — there is no separate payload to match on. Both languages are
 * listed for every button, and the keys are the EXACT strings submitted to
 * Meta: changing a label in WhatsApp Manager without changing it here silently
 * turns every tap of that button into `unknown`.
 */
const BUTTON_MEANING: Record<string, ReplyOutcome> = {
  // sample_dispatch
  'received':            'received',
  'मिल गया':              'received',
  'not received yet':    'not_received',
  'अभी नहीं मिला':         'not_received',

  // payment_due_reminder
  'payment done':        'paid',
  'भुगतान हो गया':         'paid',
  'need more time':      'needs_time',
  'और समय चाहिए':          'needs_time',
  'invoice query':       'query',
  'इनवॉइस संबंधी प्रश्न':    'query',

  // payment_advice_vendor
  'details correct':     'details_ok',
  'विवरण सही है':          'details_ok',
  'need to update':      'details_change',
  'अपडेट करना है':         'details_change',

  // stock_check_request
  'in stock':            'in_stock',
  'स्टॉक में है':           'in_stock',
  'out of stock':        'out_of_stock',
  'स्टॉक में नहीं':          'out_of_stock',
  'will confirm':        'will_confirm',
  'बाद में बताऊंगा':        'will_confirm',

  // sales_order_placed
  'confirmed':           'confirmed',
  'पुष्टि करें':            'confirmed',
  'query':               'query',
  'प्रश्न है':              'query',
};

/**
 * Ways people ask to stop being messaged.
 *
 * Matched on the whole trimmed message, not as a substring: "please don't stop
 * sending the samples" is not an opt-out, and reading it as one would silence
 * a customer who wanted the opposite.
 */
const OPT_OUT_EXACT = new Set([
  'stop', 'stop.', 'unsubscribe', 'opt out', 'optout', 'remove me', 'do not message',
  'dont message', "don't message", 'no more messages',
  'band karo', 'band karo.', 'bandh karo', 'mat bhejo', 'message mat bhejo',
  'बंद करो', 'बंद', 'मत भेजो', 'संदेश मत भेजो', 'हटाओ',
]);

const OPT_IN_EXACT = new Set([
  'start', 'subscribe', 'yes send', 'resume',
  'shuru karo', 'शुरू करो', 'हाँ भेजो',
]);

/** Normalise for lookup: transliterate, lowercase, collapse space, drop punctuation. */
function key(text: string): string {
  return transliterate(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * What a contact's reply means.
 *
 * Button labels are matched on the raw text first, because they are exact
 * approved strings and transliterating "मिल गया" would turn it into "mil gaya",
 * which is not a key. Only the free-text paths go through normalisation.
 */
export function interpretContactReply(text: string): ReplyOutcome {
  const raw = (text ?? '').trim().toLowerCase();
  if (!raw) return 'unknown';

  // Opt-out first, and always. A party asking to be left alone must not have
  // that request read as an answer to whatever we last asked them.
  if (OPT_OUT_EXACT.has(raw) || OPT_OUT_EXACT.has(key(raw))) return 'opt_out';
  if (OPT_IN_EXACT.has(raw)  || OPT_IN_EXACT.has(key(raw)))  return 'opt_in';

  const direct = BUTTON_MEANING[raw];
  if (direct) return direct;

  const normalised = BUTTON_MEANING[key(raw)];
  if (normalised) return normalised;

  return 'unknown';
}

/** How each outcome reads in the internal notification sent to the owner. */
const OUTCOME_SUMMARY: Record<ReplyOutcome, string> = {
  received:       'confirmed the samples arrived',
  not_received:   'says the samples have NOT arrived yet',
  paid:           'says the payment has been made',
  needs_time:     'has asked for more time to pay',
  query:          'has a question about the invoice or order',
  details_ok:     'confirmed their account details are unchanged',
  details_change: 'needs to update their account details',
  in_stock:       'has the item IN STOCK',
  out_of_stock:   'is OUT OF STOCK',
  will_confirm:   'will confirm availability later',
  confirmed:      'confirmed they can fulfil the order',
  opt_out:        'has asked to stop receiving messages',
  opt_in:         'has asked to start receiving messages again',
  unknown:        'replied',
};

/**
 * Which task states an outcome should move the follow-up task to.
 *
 * `null` means "record it, change nothing". A vendor saying "payment done" is
 * a claim, not a receipt — the task moves to `Submitted` for a human to check,
 * never straight to `Done`. That distinction is the same one the worker
 * pipeline already makes and for the same reason.
 */
const OUTCOME_TASK_STATUS: Partial<Record<ReplyOutcome, TaskStatus>> = {
  received:     TaskStatus.Submitted,
  paid:         TaskStatus.Submitted,
  confirmed:    TaskStatus.Submitted,
  in_stock:     TaskStatus.Submitted,
  details_ok:   TaskStatus.Submitted,
  not_received: TaskStatus.Issue,
  out_of_stock: TaskStatus.Issue,
  needs_time:   TaskStatus.Delay,
  query:        TaskStatus.Issue,
};

export interface ContactReplyInput {
  contactId: string;
  text: string;
  waMessageId: string | null;
  mediaUrl?: string | null;
  kind?: MessageKind;
}

/**
 * Handle one inbound message from an external party, end to end.
 *
 * Never throws: this runs inside the webhook's fire-and-forget worker, and an
 * exception here would lose the message entirely rather than degrade to
 * storing it.
 */
export async function handleContactReply(input: ContactReplyInput): Promise<void> {
  const contact = await prisma.contact.findUnique({
    where:  { id: input.contactId },
    select: {
      id: true, name: true, companyName: true, phone: true, preferredLanguage: true,
      owner: { select: { id: true, name: true, phone: true } },
    },
  });
  if (!contact) return;

  const outcome = interpretContactReply(input.text);

  // 1. Store it, whatever it is. A reply we cannot interpret is still a reply,
  //    and losing it would leave the owner unable to see why nothing happened.
  const message = await prisma.message.create({
    data: {
      contactId:      contact.id,
      senderId:       null,          // a contact is not a User and never will be
      direction:      MessageDirection.inbound,
      kind:           input.kind ?? MessageKind.text,
      text:           input.text ?? '',
      mediaUrl:       input.mediaUrl ?? null,
      waMessageId:    input.waMessageId,
      deliveryStatus: 'delivered',
    },
    select: { id: true },
  });

  // 2. Opt-out is absolute and terminates here. No task update, no forward
  //    that might read as a reason to write back.
  if (outcome === 'opt_out') {
    await recordOptOut(contact.id);
    await notifyOwner(contact, `${contact.name} has asked to STOP receiving WhatsApp messages. No further messages will be sent to them.`);
    return;
  }
  if (outcome === 'opt_in') {
    await recordOptIn(contact.id);
    await notifyOwner(contact, `${contact.name} has opted back in to WhatsApp messages.`);
    return;
  }

  // 3. Move the open follow-up task, if there is exactly one.
  const task = await openTaskFor(contact.id);
  const newStatus = OUTCOME_TASK_STATUS[outcome];

  if (task && newStatus) {
    await prisma.$transaction([
      prisma.task.update({ where: { id: task.id }, data: { status: newStatus } }),
      prisma.taskAssignee.updateMany({ where: { taskId: task.id }, data: { status: newStatus } }),
      prisma.activity.create({
        data: {
          taskId:  task.id,
          byId:    task.assignedToId,   // the holder — a contact cannot be an actor
          type:    'status',
          text:    `${contact.name} ${OUTCOME_SUMMARY[outcome]}${input.text ? `: "${input.text.slice(0, 200)}"` : ''}`,
          channel: 'whatsapp',
        },
      }),
      prisma.message.update({ where: { id: message.id }, data: { taskId: task.id } }),
    ]);
  } else if (task) {
    // An uninterpreted reply still belongs to the conversation about this task.
    await prisma.message.update({ where: { id: message.id }, data: { taskId: task.id } });
  }

  // 4. Tell the person who owns this relationship. For a stock check the ANSWER
  //    is the entire point of having asked, so this is a hard requirement, not
  //    a courtesy.
  const quoted = input.text?.trim() ? `\n\nThey said: "${input.text.trim().slice(0, 300)}"` : '';
  const taskLine = task ? `\nTask: ${task.id} — ${task.title}` : '';
  await notifyOwner(
    contact,
    `${contact.name}${contact.companyName ? ` (${contact.companyName})` : ''} ${OUTCOME_SUMMARY[outcome]}.${taskLine}${quoted}`,
  );
}

/**
 * The task this reply is about.
 *
 * Only when there is exactly ONE open task for the contact. With two, guessing
 * would move the wrong one — the reply is still stored and forwarded, and the
 * owner resolves it, which is the same conservative rule the worker-side
 * attribution logic follows.
 */
async function openTaskFor(contactId: string) {
  const open = await prisma.task.findMany({
    where: {
      contactId,
      kind:   { not: TaskKind.internal },
      status: { in: [TaskStatus.Pending, TaskStatus.InProgress, TaskStatus.Delay, TaskStatus.Issue] },
    },
    orderBy: { createdAt: 'desc' },
    select:  { id: true, title: true, assignedToId: true },
    take:    2,
  });
  return open.length === 1 ? open[0] : null;
}

/**
 * Forward to the employee who owns the contact.
 *
 * Free-form, so it only lands if their own 24-hour window is open. Their
 * dashboard shows it regardless, and waking a template up to deliver an
 * internal FYI would burn a template send on something that is not urgent.
 */
async function notifyOwner(
  contact: { owner: { id: string; name: string; phone: string | null } },
  body: string,
): Promise<void> {
  const owner = contact.owner;
  if (!owner?.phone) return;

  const lastInbound = await prisma.message.findFirst({
    where:   { userId: owner.id, direction: MessageDirection.inbound },
    orderBy: { createdAt: 'desc' },
    select:  { createdAt: true },
  });
  if (!computeSession(lastInbound?.createdAt ?? null).open) return;

  const result = await sendTextMessage(owner.phone, body);

  await prisma.message.create({
    data: {
      userId:         owner.id,
      senderId:       owner.id,   // system-originated, filed under the recipient
      direction:      MessageDirection.outbound,
      kind:           MessageKind.system,
      text:           body,
      waMessageId:    result.waMessageId ?? null,
      deliveryStatus: result.ok ? 'sent' : 'failed',
      deliveryError:  result.error ?? null,
    },
  });
}
