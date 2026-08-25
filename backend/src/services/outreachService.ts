import { Contact, MessageDirection, MessageKind, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { Actor, canMessageContact } from './permissionService';
import { TaskOpError } from './taskService';
import { formatAmount } from './moneyParser';
import {
  SendResult,
  sendPaymentAdviceToVendor,
  sendPaymentDueReminder,
  sendSalesOrderPlaced,
  sendSampleDispatchNotice,
  sendStockCheckRequest,
} from './whatsappService';

// ─────────────────────────────────────────────────────────────────────────────
// Messaging an external party.
//
// Every send to somebody outside the company goes through here. That is the
// point: the guards below protect a third party who did not ask to be in our
// system, and a second code path that skipped them would be indistinguishable
// from not having them.
//
// The order of the guards matters and is not arbitrary — cheapest and most
// absolute first:
//
//   1. Feature flag        — the whole capability ships dark.
//   2. Role                — a separate gate from WA_COMMAND_ROLES. Somebody
//                            who can reassign a ticket should not thereby be
//                            able to send a vendor a bill.
//   3. Permission          — the same visibility boundary as everything else.
//   4. Opt-out             — permanent, and checked before any rate limit so
//                            it can never be bypassed by waiting.
//   5. Per-contact limits  — cooldown and daily cap, database-backed so they
//                            survive a restart and a second process.
//
// Meta's quality rating is per phone NUMBER, and that number is the same one
// the internal task system runs on. A vendor marking us as spam degrades
// deliverability for every employee notification too — which is why the limits
// here are conservative and why nothing bypasses them.
// ─────────────────────────────────────────────────────────────────────────────

function outreachEnabled(): boolean {
  return (process.env.WA_OUTREACH_ENABLED ?? 'false').toLowerCase() === 'true';
}

function outreachRoles(): string[] {
  return (process.env.WA_OUTREACH_ROLES ?? 'Admin')
    .split(',').map((r) => r.trim()).filter(Boolean);
}

/**
 * Whether a recorded opt-in is required before we may message somebody.
 *
 * Defaults to false, which is the client's explicit decision. The column and
 * this flag both exist so turning it on later is a config change rather than a
 * migration — Meta does require opt-in, and the day that is enforced should not
 * also be the day we discover we never recorded it.
 */
function requireOptIn(): boolean {
  return (process.env.WA_REQUIRE_OPTIN ?? 'false').toLowerCase() === 'true';
}

const COOLDOWN_S  = Number(process.env.WA_CONTACT_COOLDOWN_S ?? 86_400);
const DAILY_CAP   = Number(process.env.WA_CONTACT_DAILY_CAP ?? 3);

/** What appears as {{2}} in every outreach template — who the message is from. */
export function senderIdentity(actorName: string): string {
  return process.env.COMPANY_NAME?.trim() || actorName;
}

export type OutreachKind =
  | 'sample_dispatch'
  | 'payment_advice_vendor'
  | 'payment_due_reminder'
  | 'stock_check_request'
  | 'sales_order_placed';

export interface OutreachInput {
  contactId: string;
  kind: OutreachKind;
  /** {{3}} — the headline value: the samples, the amount, the item, the order. */
  headline: string;
  /** {{4}} — the reference or supporting detail. */
  detail: string;
  /** {{5}} — the date, already formatted for a human to read. */
  date: string;
  /** Links the send to the work it belongs to, when there is any. */
  taskId?: string | null;
  /** Bypasses the cooldown for a scheduled follow-up in an agreed ladder. */
  isFollowUp?: boolean;
}

export interface OutreachResult {
  ok: boolean;
  error?: string;
  messageId?: string;
  waMessageId?: string;
  contact?: Pick<Contact, 'id' | 'name' | 'phone' | 'preferredLanguage'>;
}

/**
 * How recently, and how often, this party has been messaged.
 *
 * Counts OUTBOUND rows only. An inbound reply from them is a reason to be
 * allowed to write back, never a reason to be throttled.
 */
async function checkContactLimits(
  contactId: string,
  isFollowUp: boolean,
): Promise<string | null> {
  const now = Date.now();

  const since24h = new Date(now - 24 * 60 * 60 * 1000);
  const sentToday = await prisma.message.count({
    where: { contactId, direction: MessageDirection.outbound, createdAt: { gt: since24h } },
  });
  if (sentToday >= DAILY_CAP) {
    return `This contact has already received ${sentToday} messages today`;
  }

  // A follow-up is part of a ladder the sender already agreed to, so it is
  // exempt from the cooldown — but never from the daily cap above, which is
  // the backstop against a runaway ladder.
  if (isFollowUp) return null;

  const cooldownStart = new Date(now - COOLDOWN_S * 1000);
  const recent = await prisma.message.findFirst({
    where:   { contactId, direction: MessageDirection.outbound, createdAt: { gt: cooldownStart } },
    orderBy: { createdAt: 'desc' },
    select:  { createdAt: true },
  });
  if (recent) {
    const hours = Math.max(1, Math.round((now - recent.createdAt.getTime()) / 3_600_000));
    return `This contact was messaged ${hours}h ago — wait before sending again`;
  }

  return null;
}

/**
 * Send one approved template to one external party, and record it.
 *
 * Returns a result rather than throwing for a delivery failure: the caller has
 * already told the sender their command was accepted, and "Meta rejected it"
 * is information to relay, not an exception to unwind. Genuine refusals —
 * permission, opt-out, limits — do throw, because they mean the command should
 * never have got this far.
 */
export async function sendOutreach(
  actor: Actor & { name: string },
  input: OutreachInput,
): Promise<OutreachResult> {
  if (!outreachEnabled()) {
    throw new TaskOpError('forbidden', 'Messaging external contacts is switched off');
  }
  if (!outreachRoles().includes(actor.role)) {
    throw new TaskOpError('forbidden', 'You are not allowed to message external contacts');
  }
  if (!(await canMessageContact(actor, input.contactId))) {
    throw new TaskOpError('forbidden', 'That contact is not yours to message');
  }

  const contact = await prisma.contact.findUnique({
    where:  { id: input.contactId },
    select: { id: true, name: true, phone: true, preferredLanguage: true, optInAt: true, optOutAt: true },
  });
  if (!contact) throw new TaskOpError('not_found', 'No such contact');

  if (contact.optOutAt) {
    throw new TaskOpError('forbidden', `${contact.name} has asked not to be messaged`);
  }
  if (requireOptIn() && !contact.optInAt) {
    throw new TaskOpError('forbidden', `${contact.name} has not opted in to WhatsApp messages`);
  }

  const limited = await checkContactLimits(contact.id, input.isFollowUp === true);
  if (limited) throw new TaskOpError('invalid', limited);

  const from = senderIdentity(actor.name);
  const lang = contact.preferredLanguage;

  const result = await dispatch(input.kind, contact.phone, contact.name, from, input, lang);

  // Recorded whether or not it left. A failed send that leaves no trace is the
  // worst outcome available: the sender is told it went, and nothing shows why
  // it did not.
  const message = await prisma.message.create({
    data: {
      contactId:      contact.id,
      senderId:       actor.id,
      direction:      MessageDirection.outbound,
      kind:           MessageKind.system,
      taskId:         input.taskId ?? null,
      text:           describeSend(input),
      waMessageId:    result.waMessageId ?? null,
      deliveryStatus: result.ok ? 'sent' : 'failed',
      deliveryError:  result.error ?? null,
    },
    select: { id: true },
  });

  return {
    ok:          result.ok,
    error:       result.error,
    messageId:   message.id,
    waMessageId: result.waMessageId,
    contact:     { id: contact.id, name: contact.name, phone: contact.phone, preferredLanguage: lang },
  };
}

/** Pick the template. One switch, so a new kind is a compile error until handled. */
function dispatch(
  kind: OutreachKind,
  phone: string,
  contactName: string,
  from: string,
  input: OutreachInput,
  lang: string,
): Promise<SendResult> {
  switch (kind) {
    case 'sample_dispatch':
      return sendSampleDispatchNotice(phone, contactName, from, input.headline, input.date, input.detail, lang);
    case 'payment_advice_vendor':
      return sendPaymentAdviceToVendor(phone, contactName, from, input.headline, input.detail, input.date, lang);
    case 'payment_due_reminder':
      return sendPaymentDueReminder(phone, contactName, from, input.headline, input.detail, input.date, lang);
    case 'stock_check_request':
      return sendStockCheckRequest(phone, contactName, from, input.headline, input.detail, input.date, lang);
    case 'sales_order_placed':
      return sendSalesOrderPlaced(phone, contactName, from, input.headline, input.detail, input.date, lang);
  }
}

/**
 * What the tracker and the WhatsApp Hub show for this send.
 *
 * Templates render on Meta's side, so we never see the delivered text. Writing
 * a readable summary here is the only way the conversation view shows what was
 * actually sent rather than a template name.
 */
function describeSend(input: OutreachInput): string {
  switch (input.kind) {
    case 'sample_dispatch':
      return `Sample dispatch notice — ${input.headline}, expected ${input.date} (${input.detail})`;
    case 'payment_advice_vendor':
      return `Payment advice — ${input.headline} against ${input.detail}, scheduled ${input.date}`;
    case 'payment_due_reminder':
      return `Payment reminder — ${input.headline} against ${input.detail}, due ${input.date}`;
    case 'stock_check_request':
      return `Stock check — ${input.headline} × ${input.detail}, required by ${input.date}`;
    case 'sales_order_placed':
      return `Order placed — ${input.headline} (${input.detail}), delivery by ${input.date}`;
  }
}

/** A rupee figure formatted the way the templates expect to receive it. */
export function money(amount: number | Prisma.Decimal, currency = 'INR'): string {
  const value = typeof amount === 'number' ? amount : Number(amount);
  return formatAmount(value, currency);
}

/**
 * A date rendered for a human, in the recipient's language.
 *
 * "5 September 2026", not an ISO string. A template parameter is read by a
 * person, and `2026-09-05T18:00:00.000Z` in a message asking for money reads
 * like a system error.
 */
export function readableDate(date: Date, lang = 'en'): string {
  return new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  }).format(date);
}
