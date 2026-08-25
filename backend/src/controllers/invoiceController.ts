import { Request, Response } from 'express';
import { InvoiceStatus } from '@prisma/client';
import { HTTP_STATUS, TaskOpError } from '../services/taskService';
import {
  createInvoice, listInvoices, outstandingFor, updateInvoice,
} from '../services/invoiceService';
import { serialiseInvoice } from './contactController';

// ─────────────────────────────────────────────────────────────────────────────
// The invoices API. Thin, like contacts — every rule lives in the service, so a
// reminder sent from WhatsApp and one raised from the dashboard quote the same
// figure.
// ─────────────────────────────────────────────────────────────────────────────

function actorOf(req: Request) {
  return { id: req.user!.userId, role: req.user!.role };
}

function fail(res: Response, err: unknown): void {
  if (err instanceof TaskOpError) {
    res.status(HTTP_STATUS[err.code]).json({ error: err.message });
    return;
  }
  throw err;
}

export async function list(req: Request, res: Response): Promise<void> {
  const invoices = await listInvoices(actorOf(req), {
    contactId: req.query.contactId as string | undefined,
    status:    req.query.status as InvoiceStatus | undefined,
  });
  res.json(invoices.map(serialiseInvoice));
}

export async function outstanding(req: Request, res: Response): Promise<void> {
  try {
    const invoices = await outstandingFor(actorOf(req), req.params.contactId);
    res.json(invoices.map(serialiseInvoice));
  } catch (err) { fail(res, err); }
}

export async function create(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as Record<string, unknown>;

    // Parsed here rather than in the service so an unparseable date is a 400
    // with a sentence, not an `Invalid Date` that reaches the database.
    const dueDate = new Date(String(body.dueDate ?? ''));
    if (isNaN(dueDate.getTime())) {
      res.status(400).json({ error: 'A valid due date is required' });
      return;
    }

    const invoice = await createInvoice(actorOf(req), {
      number:    String(body.number ?? ''),
      contactId: String(body.contactId ?? ''),
      amount:    body.amount as number,
      balance:   body.balance as number | undefined,
      currency:  body.currency as string | undefined,
      dueDate,
      payable:   body.payable === true,
      notes:     body.notes as string | undefined,
    });
    res.status(201).json(serialiseInvoice(invoice));
  } catch (err) { fail(res, err); }
}

export async function update(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as Record<string, unknown>;

    let dueDate: Date | undefined;
    if (body.dueDate !== undefined) {
      dueDate = new Date(String(body.dueDate));
      if (isNaN(dueDate.getTime())) {
        res.status(400).json({ error: 'A valid due date is required' });
        return;
      }
    }

    const invoice = await updateInvoice(actorOf(req), req.params.id, {
      ...(body.balance !== undefined && { balance: body.balance as number }),
      ...(body.status  !== undefined && { status: body.status as InvoiceStatus }),
      ...(dueDate      !== undefined && { dueDate }),
      ...(body.notes   !== undefined && { notes: String(body.notes) }),
    });
    res.json(serialiseInvoice(invoice));
  } catch (err) { fail(res, err); }
}
