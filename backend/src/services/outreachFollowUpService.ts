import { MessageDirection, TaskKind, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { sendOutreach, money, senderIdentity } from './outreachService';
import { sendTextMessage } from './whatsappService';
import { computeSession } from './conversationService';

// ─────────────────────────────────────────────────────────────────────────────
// Chasing an external party who has not replied.
//
// Runs on the SAME 15-minute cron as task escalation rather than a second
// worker, so there is one place that answers "what runs unattended?".
//
// Two design decisions worth stating, because both look like shortcuts and
// neither is:
//
//   1. A chase RE-SENDS the same approved template. Meta approved five
//      templates; separate `*_followup` variants were specified but never
//      submitted, and a reminder re-sent IS a reminder — that is what a ladder
//      is. Waiting on four more approvals to say the same sentence a second
//      time would have blocked the whole feature.
//
//   2. It stops. After `MAX_CHASES` the party is left alone and the internal
//      OWNER is told instead. An unbounded ladder is how a WhatsApp number
//      gets reported, and that number is the one the internal task system
//      runs on too.
// ─────────────────────────────────────────────────────────────────────────────

/** How many times we will chase before handing the problem to a human. */
const MAX_CHASES = Number(process.env.WA_OUTREACH_MAX_CHASES ?? 2);

/** Minimum gap between chases. Deliberately days, not hours. */
const CHASE_GAP_MS = Number(process.env.WA_OUTREACH_CHASE_GAP_H ?? 72) * 3_600_000;

/** Task kinds that produced an outbound message worth chasing. */
const CHASEABLE = [TaskKind.payment_followup, TaskKind.sample_dispatch, TaskKind.stock_check, TaskKind.sales];

/** Still waiting on the party. `Submitted` and `Done` are answered. */
const OPEN = [TaskStatus.Pending, TaskStatus.InProgress, TaskStatus.Delay];

export interface FollowUpSummary {
  chased: number;
  escalated: number;
  skipped: number;
}

/**
 * One sweep. Never throws — it runs unattended, and an exception would kill the
 * cron tick that also does task escalation.
 */
export async function runOutreachFollowUps(now: Date = new Date()): Promise<FollowUpSummary> {
  const summary: FollowUpSummary = { chased: 0, escalated: 0, skipped: 0 };

  const candidates = await prisma.task.findMany({
    where: {
      kind:      { in: CHASEABLE },
      status:    { in: OPEN },
      contactId: { not: null },
      // Nothing is chased before its own deadline has passed. Chasing a party
      // about something not yet due is how a reminder becomes a nuisance.
      deadline:  { lt: now },
    },
    select: {
      id: true, title: true, kind: true, deadline: true, escalationLevel: true,
      contactId: true, invoiceId: true,
      assignedTo: { select: { id: true, name: true, phone: true } },
      contact: {
        select: {
          id: true, name: true, optOutAt: true, archivedAt: true,
          owner: { select: { id: true, name: true, role: true, phone: true } },
        },
      },
      invoice: { select: { number: true, balance: true, currency: true, dueDate: true, status: true, payable: true } },
    },
    take: 200,
  });

  for (const task of candidates) {
    const contact = task.contact;
    if (!contact || contact.optOutAt || contact.archivedAt) { summary.skipped++; continue; }

    // A settled bill is not chased, whatever the task still says. The invoice
    // is the source of truth about the money; the task lags behind it.
    if (task.invoice && (task.invoice.status === 'paid' || task.invoice.status === 'cancelled')) {
      summary.skipped++;
      continue;
    }

    const [lastOutbound, lastInbound] = await Promise.all([
      prisma.message.findFirst({
        where:   { contactId: contact.id, direction: MessageDirection.outbound, taskId: task.id },
        orderBy: { createdAt: 'desc' },
        select:  { createdAt: true },
      }),
      prisma.message.findFirst({
        where:   { contactId: contact.id, direction: MessageDirection.inbound },
        orderBy: { createdAt: 'desc' },
        select:  { createdAt: true },
      }),
    ]);

    // Nothing was ever sent to them about this — there is nothing to chase, and
    // sending a first message unprompted from a cron job is not a follow-up.
    if (!lastOutbound) { summary.skipped++; continue; }

    // They have replied since we wrote. Whatever they said, a chase would be
    // answering their message with our own question again.
    if (lastInbound && lastInbound.createdAt > lastOutbound.createdAt) { summary.skipped++; continue; }

    if (now.getTime() - lastOutbound.createdAt.getTime() < CHASE_GAP_MS) { summary.skipped++; continue; }

    if (task.escalationLevel >= MAX_CHASES) {
      await escalateToOwner(task, contact, now);
      summary.escalated++;
      continue;
    }

    const sent = await chase(task, contact);
    if (sent) summary.chased++;
    else summary.skipped++;
  }

  return summary;
}

type ChaseTask = Awaited<ReturnType<typeof prisma.task.findMany>> extends Array<infer T> ? T : never;

/** Re-send the template this task's original message used. */
async function chase(
  task: {
    id: string; kind: TaskKind; deadline: Date; escalationLevel: number;
    invoice: { number: string; balance: unknown; currency: string; dueDate: Date; payable: boolean } | null;
    title: string;
  },
  contact: { id: string; name: string; owner: { id: string; name: string; role: string } },
): Promise<boolean> {
  // The chase is sent AS the contact's owner, so permission and rate limits are
  // evaluated against a real person rather than a privileged system identity.
  const actor = { id: contact.owner.id, role: contact.owner.role, name: contact.owner.name };

  const kind =
      task.kind === TaskKind.payment_followup
        ? (task.invoice?.payable ? 'payment_advice_vendor' as const : 'payment_due_reminder' as const)
    : task.kind === TaskKind.sample_dispatch ? 'sample_dispatch'    as const
    : task.kind === TaskKind.stock_check     ? 'stock_check_request' as const
    :                                          'sales_order_placed'  as const;

  const headline = task.invoice
    ? money(Number(task.invoice.balance), task.invoice.currency)
    : task.title;
  const detail = task.invoice ? `Invoice ${task.invoice.number}` : '—';
  const date   = fmt(task.invoice?.dueDate ?? task.deadline);

  try {
    const result = await sendOutreach(actor, {
      contactId: contact.id,
      kind,
      headline,
      detail,
      date,
      taskId:     task.id,
      // Exempt from the cooldown — this IS the agreed ladder — but still
      // subject to the daily cap, which is the backstop against a runaway one.
      isFollowUp: true,
    });

    if (!result.ok) return false;

    await prisma.$transaction([
      prisma.task.update({
        where: { id: task.id },
        data:  { escalationLevel: { increment: 1 } },
      }),
      prisma.activity.create({
        data: {
          taskId:  task.id,
          byId:    contact.owner.id,
          type:    'escalation',
          text:    `Reminder ${task.escalationLevel + 1} of ${MAX_CHASES} sent to ${contact.name}`,
          channel: 'system',
        },
      }),
    ]);
    return true;
  } catch (err) {
    // A refusal here — opt-out, daily cap, the feature switched off — is a
    // normal outcome for one row and must not stop the sweep.
    console.warn(`[Outreach] chase skipped for ${task.id}: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Stop chasing and tell a person.
 *
 * The task moves to `Issue` so it surfaces on the dashboard rather than sitting
 * quietly past its deadline, and the owner is told once — not once per tick,
 * which `escalationLevel` incrementing past MAX_CHASES is what prevents.
 */
async function escalateToOwner(
  task: { id: string; title: string; escalationLevel: number },
  contact: { id: string; name: string; owner: { id: string; name: string; phone: string | null } },
  now: Date,
): Promise<void> {
  await prisma.$transaction([
    prisma.task.update({
      where: { id: task.id },
      data:  { status: TaskStatus.Issue, escalationLevel: { increment: 1 } },
    }),
    prisma.activity.create({
      data: {
        taskId:  task.id,
        byId:    contact.owner.id,
        type:    'escalation',
        text:    `${contact.name} has not replied after ${MAX_CHASES} reminders — needs a call`,
        channel: 'system',
      },
    }),
  ]);

  const owner = contact.owner;
  if (!owner.phone) return;

  const lastInbound = await prisma.message.findFirst({
    where:   { userId: owner.id, direction: MessageDirection.inbound },
    orderBy: { createdAt: 'desc' },
    select:  { createdAt: true },
  });
  // Free-form only. Waking a template to deliver an internal FYI would spend a
  // template send on something that is not urgent to anyone but us.
  if (!computeSession(lastInbound?.createdAt ?? null, now).open) return;

  await sendTextMessage(
    owner.phone,
    `${contact.name} has not replied after ${MAX_CHASES} reminders about "${task.title}" (${task.id}). `
    + `No further WhatsApp reminders will be sent — worth a call.`,
  );
}

function fmt(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}
