import { Request, Response } from 'express';
import { ContactType, MessageDirection, MessageKind, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { TaskOpError, HTTP_STATUS } from '../services/taskService';
import { canMessageContact } from '../services/permissionService';
import { computeSession } from '../services/conversationService';
import { sendTextMessage } from '../services/whatsappService';
import {
  archiveContact, createContact, getContact, listContacts, updateContact,
} from '../services/contactService';

// ─────────────────────────────────────────────────────────────────────────────
// The contacts API.
//
// Thin by design. Every rule — who may see whom, the phone-collision refusal,
// archive-not-delete — lives in `contactService`, so the dashboard and the
// WhatsApp command executor cannot end up enforcing different things.
// ─────────────────────────────────────────────────────────────────────────────

function actorOf(req: Request) {
  return { id: req.user!.userId, role: req.user!.role };
}

/**
 * Turn a service refusal into an HTTP status.
 *
 * `TaskOpError` carries the reason in the same words the WhatsApp sender would
 * be given, so the dashboard shows the same sentence rather than inventing its
 * own phrasing for the same rule.
 */
function fail(res: Response, err: unknown): void {
  if (err instanceof TaskOpError) {
    res.status(HTTP_STATUS[err.code]).json({ error: err.message });
    return;
  }
  throw err;
}

export async function list(req: Request, res: Response): Promise<void> {
  const contacts = await listContacts(actorOf(req));

  // The counts are what make the directory useful at a glance — "who owes us
  // something" and "who have we been talking to" are the two questions this
  // page exists to answer.
  const ids = contacts.map((c) => c.id);
  const [openInvoices, lastMessages] = await Promise.all([
    prisma.invoice.groupBy({
      by:     ['contactId'],
      where:  { contactId: { in: ids }, status: { in: ['open', 'partial'] } },
      _count: { _all: true },
      _sum:   { balance: true },
    }),
    prisma.message.groupBy({
      by:    ['contactId'],
      where: { contactId: { in: ids } },
      _max:  { createdAt: true },
    }),
  ]);

  const invoiceBy = new Map(openInvoices.map((r) => [r.contactId, r]));
  const lastBy    = new Map(lastMessages.map((r) => [r.contactId, r._max.createdAt]));

  res.json(contacts.map((c) => ({
    ...c,
    openInvoiceCount:   invoiceBy.get(c.id)?._count._all ?? 0,
    outstandingBalance: Number(invoiceBy.get(c.id)?._sum.balance ?? 0),
    lastMessageAt:      lastBy.get(c.id) ?? null,
  })));
}

export async function detail(req: Request, res: Response): Promise<void> {
  try {
    const contact = await getContact(actorOf(req), req.params.id);
    if (!contact) { res.status(404).json({ error: 'No such contact' }); return; }

    const [invoices, tasks, messages] = await Promise.all([
      prisma.invoice.findMany({
        where: { contactId: contact.id }, orderBy: { dueDate: 'asc' },
      }),
      prisma.task.findMany({
        where:   { contactId: contact.id },
        orderBy: { createdAt: 'desc' },
        take:    50,
        select:  {
          id: true, title: true, status: true, kind: true, deadline: true,
          assignedTo: { select: { id: true, name: true } },
        },
      }),
      prisma.message.findMany({
        where:   { contactId: contact.id },
        orderBy: { createdAt: 'desc' },
        take:    100,
      }),
    ]);

    res.json({
      ...contact,
      invoices: invoices.map(serialiseInvoice),
      tasks,
      // Oldest first, so the thread reads downward like a conversation.
      messages: messages.reverse(),
    });
  } catch (err) { fail(res, err); }
}

export async function create(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as Record<string, unknown>;
    const contact = await createContact(actorOf(req), {
      name:              String(body.name ?? ''),
      phone:             String(body.phone ?? ''),
      type:              body.type as ContactType | undefined,
      companyName:       body.companyName as string | null,
      email:             body.email as string | null,
      address:           body.address as string | null,
      notes:             body.notes as string | undefined,
      aliases:           Array.isArray(body.aliases) ? body.aliases.map(String) : undefined,
      externalRef:       body.externalRef as string | null,
      preferredLanguage: body.preferredLanguage as string | undefined,
      ownerId:           body.ownerId as string | undefined,
    });
    res.status(201).json(contact);
  } catch (err) { fail(res, err); }
}

export async function update(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as Record<string, unknown>;
    const contact = await updateContact(actorOf(req), req.params.id, {
      ...(body.name !== undefined              && { name: String(body.name) }),
      ...(body.phone !== undefined             && { phone: String(body.phone) }),
      ...(body.type !== undefined              && { type: body.type as ContactType }),
      ...(body.companyName !== undefined       && { companyName: body.companyName as string | null }),
      ...(body.email !== undefined             && { email: body.email as string | null }),
      ...(body.address !== undefined           && { address: body.address as string | null }),
      ...(body.notes !== undefined             && { notes: String(body.notes) }),
      ...(body.aliases !== undefined           && { aliases: (body.aliases as string[]).map(String) }),
      ...(body.externalRef !== undefined       && { externalRef: body.externalRef as string | null }),
      ...(body.preferredLanguage !== undefined && { preferredLanguage: String(body.preferredLanguage) }),
      ...(body.ownerId !== undefined           && { ownerId: String(body.ownerId) }),
    });
    res.json(contact);
  } catch (err) { fail(res, err); }
}

export async function archive(req: Request, res: Response): Promise<void> {
  try {
    res.json(await archiveContact(actorOf(req), req.params.id));
  } catch (err) { fail(res, err); }
}

/** The conversation thread with one contact, for the WhatsApp Hub. */
export async function messages(req: Request, res: Response): Promise<void> {
  try {
    const contact = await getContact(actorOf(req), req.params.id);
    if (!contact) { res.status(404).json({ error: 'No such contact' }); return; }

    const rows = await prisma.message.findMany({
      where:   { contactId: contact.id },
      orderBy: { createdAt: 'asc' },
      take:    500,
      include: { task: { select: { id: true, title: true } } },
    });

    const lastInbound = rows.filter((m) => m.direction === MessageDirection.inbound).at(-1);

    res.json({
      contact,
      messages: rows,
      // Contacts have the same 24-hour window employees do. Surfacing it stops
      // the composer offering a free-form reply that Meta will reject.
      lastInboundAt: lastInbound?.createdAt ?? null,
    });
  } catch (err) { fail(res, err); }
}

/**
 * POST /api/contacts/:id/messages — a free-form reply to an external party.
 *
 * Only inside the 24-hour session window, and there is no template fallback on
 * purpose. When an employee's window closes we wake it with `update_waiting`,
 * because we have a standing relationship and they expect to hear from us. A
 * customer does not: silently converting "thanks, I'll check" into an approved
 * template send is a message they did not agree to receive, on a number whose
 * quality rating the whole system depends on.
 *
 * So a closed window is refused with an explanation, and the operator uses a
 * proper outreach command — which picks an approved template deliberately.
 */
export async function sendMessage(req: Request, res: Response): Promise<void> {
  try {
    const actor = actorOf(req);
    const text = String((req.body as { message?: unknown }).message ?? '').trim();
    if (!text) { res.status(400).json({ error: 'A message is required' }); return; }

    if (!(await canMessageContact(actor, req.params.id))) {
      res.status(403).json({ error: 'That contact is not yours to message' });
      return;
    }

    const contact = await prisma.contact.findUnique({
      where:  { id: req.params.id },
      select: { id: true, name: true, phone: true, optOutAt: true },
    });
    if (!contact) { res.status(404).json({ error: 'No such contact' }); return; }

    if (contact.optOutAt) {
      res.status(403).json({ error: `${contact.name} has asked not to be messaged` });
      return;
    }

    const lastInbound = await prisma.message.findFirst({
      where:   { contactId: contact.id, direction: MessageDirection.inbound },
      orderBy: { createdAt: 'desc' },
      select:  { createdAt: true },
    });

    if (!computeSession(lastInbound?.createdAt ?? null).open) {
      res.status(409).json({
        error:
          `${contact.name} has not messaged in over 24 hours, so WhatsApp will not deliver a `
          + `free-form reply. Send an approved template instead — for example a payment `
          + `reminder — from WhatsApp.`,
      });
      return;
    }

    const result = await sendTextMessage(contact.phone, text);

    // Recorded either way. A failed send that leaves no trace tells the sender
    // it worked and shows nothing when it did not.
    const message = await prisma.message.create({
      data: {
        contactId:      contact.id,
        senderId:       actor.id,
        direction:      MessageDirection.outbound,
        kind:           MessageKind.text,
        text,
        waMessageId:    result.waMessageId ?? null,
        deliveryStatus: result.ok ? 'sent' : 'failed',
        deliveryError:  result.error ?? null,
      },
    });

    if (!result.ok) { res.status(502).json({ error: result.error, message }); return; }
    res.status(201).json(message);
  } catch (err) { fail(res, err); }
}

/**
 * Decimal columns serialise to strings through JSON, which then compare and
 * sort as text on the frontend — "9" > "10". Converting once here keeps that
 * bug out of every consumer.
 */
export function serialiseInvoice<T extends { amount: Prisma.Decimal; balance: Prisma.Decimal }>(inv: T) {
  return { ...inv, amount: Number(inv.amount), balance: Number(inv.balance) };
}
