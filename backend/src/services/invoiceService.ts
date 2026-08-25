import { InvoiceStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { Actor, canMessageContact } from './permissionService';
import { TaskOpError } from './taskService';

// ─────────────────────────────────────────────────────────────────────────────
// Bills, in both directions.
//
// This exists for one reason: so a payment reminder can quote what is actually
// outstanding rather than whatever number somebody typed into WhatsApp. A
// figure typed on a phone cannot be validated against anything, and the message
// it produces asks a real business for real money.
//
// Deliberately small. This is not an accounting system and must not grow into
// one — no ledgers, no tax, no part-payment history beyond a running balance.
// If the client already keeps invoices in Tally or Zoho, this becomes a sync
// target and `number` stays the join key.
// ─────────────────────────────────────────────────────────────────────────────

const invoiceSelect = {
  id: true, number: true, contactId: true, amount: true, currency: true,
  balance: true, dueDate: true, status: true, payable: true, notes: true,
  createdById: true, createdAt: true, updatedAt: true,
  contact: { select: { id: true, name: true, companyName: true, type: true } },
} as const;

export interface CreateInvoiceInput {
  number: string;
  contactId: string;
  amount: number | string;
  dueDate: Date;
  currency?: string;
  /** Defaults to `amount` — a new bill is outstanding in full. */
  balance?: number | string;
  /** True when we owe them (a vendor bill), false when they owe us. */
  payable?: boolean;
  notes?: string;
}

/**
 * Normalise a reference the way `extractDocRef` does, so a bill created as
 * "inv 102" on the web is found by "INV-102" typed on WhatsApp.
 */
export function normaliseInvoiceNumber(raw: string): string {
  const trimmed = (raw ?? '').trim().toUpperCase();
  const m = trimmed.match(/^([A-Z]+)[\s\-_/#.]*(\d+)$/);
  return m ? `${m[1]}-${m[2]}` : trimmed;
}

export async function createInvoice(actor: Actor, input: CreateInvoiceInput) {
  if (actor.role === 'Employee') {
    throw new TaskOpError('forbidden', 'Only an Admin or Manager can record an invoice');
  }
  if (!(await canMessageContact(actor, input.contactId))) {
    throw new TaskOpError('forbidden', 'That contact is not yours');
  }

  const number = normaliseInvoiceNumber(input.number);
  if (!number) throw new TaskOpError('invalid', 'an invoice needs a reference number');

  const amount = new Prisma.Decimal(input.amount);
  if (amount.lessThanOrEqualTo(0)) {
    throw new TaskOpError('invalid', 'an invoice amount must be more than zero');
  }
  if (isNaN(input.dueDate?.getTime?.())) {
    throw new TaskOpError('invalid', 'a valid due date is required');
  }

  const existing = await prisma.invoice.findUnique({ where: { number }, select: { id: true } });
  if (existing) throw new TaskOpError('invalid', `${number} already exists`);

  return prisma.invoice.create({
    data: {
      number,
      contactId:   input.contactId,
      amount,
      balance:     input.balance !== undefined ? new Prisma.Decimal(input.balance) : amount,
      currency:    input.currency ?? 'INR',
      dueDate:     input.dueDate,
      payable:     input.payable ?? false,
      notes:       input.notes ?? '',
      createdById: actor.id,
    },
    select: invoiceSelect,
  });
}

/**
 * Find a bill by the reference somebody quoted.
 *
 * Scoped to the actor's contacts, so a reference alone cannot surface a bill
 * belonging to a party they may not message — the same boundary that governs
 * everything else here.
 *
 * Returns null rather than throwing when the reference is unknown: "I don't
 * have INV-999, send anyway with the amount you gave me?" is a better answer
 * than an error, and the caller is the one that knows how to ask it.
 */
export async function findByRef(actor: Actor, ref: string) {
  const number = normaliseInvoiceNumber(ref);
  if (!number) return null;

  const invoice = await prisma.invoice.findUnique({ where: { number }, select: invoiceSelect });
  if (!invoice) return null;

  return (await canMessageContact(actor, invoice.contactId)) ? invoice : null;
}

/** Open bills for one party, oldest due first — what a reminder should lead with. */
export async function outstandingFor(actor: Actor, contactId: string) {
  if (!(await canMessageContact(actor, contactId))) {
    throw new TaskOpError('forbidden', 'That contact is not yours');
  }
  return prisma.invoice.findMany({
    where:   { contactId, status: { in: [InvoiceStatus.open, InvoiceStatus.partial] } },
    select:  invoiceSelect,
    orderBy: { dueDate: 'asc' },
  });
}

export async function listInvoices(actor: Actor, filter: { contactId?: string; status?: InvoiceStatus } = {}) {
  // Employees see none, and a Manager sees only their own contacts' bills.
  if (actor.role === 'Employee') return [];

  const where: Prisma.InvoiceWhereInput = {
    ...(filter.contactId && { contactId: filter.contactId }),
    ...(filter.status && { status: filter.status }),
    ...(actor.role === 'Manager' && { contact: { ownerId: actor.id } }),
  };

  return prisma.invoice.findMany({ where, select: invoiceSelect, orderBy: { dueDate: 'asc' } });
}

export interface UpdateInvoiceInput {
  balance?: number | string;
  status?: InvoiceStatus;
  dueDate?: Date;
  notes?: string;
}

/**
 * Record a payment or a correction.
 *
 * Settling to zero marks the bill paid without the caller having to say so
 * twice — the two would otherwise be free to disagree, and a bill with a zero
 * balance still listed as open would keep being chased.
 */
export async function updateInvoice(actor: Actor, id: string, input: UpdateInvoiceInput) {
  const invoice = await prisma.invoice.findUnique({
    where: { id }, select: { id: true, contactId: true, amount: true },
  });
  if (!invoice) throw new TaskOpError('not_found', 'No such invoice');
  if (!(await canMessageContact(actor, invoice.contactId))) {
    throw new TaskOpError('forbidden', 'That invoice is not yours');
  }

  const data: Prisma.InvoiceUpdateInput = {};

  if (input.balance !== undefined) {
    const balance = new Prisma.Decimal(input.balance);
    if (balance.lessThan(0)) throw new TaskOpError('invalid', 'a balance cannot be negative');
    if (balance.greaterThan(invoice.amount)) {
      throw new TaskOpError('invalid', 'a balance cannot exceed the invoice amount');
    }
    data.balance = balance;

    if (input.status === undefined) {
      data.status = balance.isZero()
        ? InvoiceStatus.paid
        : balance.equals(invoice.amount) ? InvoiceStatus.open : InvoiceStatus.partial;
    }
  }

  if (input.status !== undefined)  data.status  = input.status;
  if (input.dueDate !== undefined) data.dueDate = input.dueDate;
  if (input.notes !== undefined)   data.notes   = input.notes;

  return prisma.invoice.update({ where: { id }, data, select: invoiceSelect });
}
