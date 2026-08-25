import { Request, Response } from 'express';
import { CommandStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

// ─────────────────────────────────────────────────────────────────────────────
// The WhatsApp command log.
//
// A reader over `WhatsAppCommand`, which already records every command
// including the ones we refused. This exists so an operator can answer "why
// did nothing happen when I sent that?" without reading server logs — the
// commonest support question a natural-language interface produces.
//
// Admin only. The rows contain other people's instructions.
// ─────────────────────────────────────────────────────────────────────────────

/** How much of the parsed entity blob is useful in a list view. */
interface ParsedSummary {
  contact?: string | null;
  amount?: number | null;
  reference?: string | null;
  targets?: string[];
  taskRef?: string | null;
}

export async function list(req: Request, res: Response): Promise<void> {
  const take   = Math.min(Number(req.query.limit ?? 100), 500);
  const status = req.query.status as CommandStatus | undefined;

  const where: Prisma.WhatsAppCommandWhereInput = {
    ...(status && { status }),
    ...(req.query.senderId && { senderId: String(req.query.senderId) }),
  };

  const rows = await prisma.whatsAppCommand.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
    include: { sender: { select: { id: true, name: true, avatar: true, color: true } } },
  });

  // The tasks a command names are looked up in one query rather than per row.
  // `WhatsAppCommand.taskId` deliberately has no foreign key — a command naming
  // a ticket that never existed has to stay auditable — so this is a join we
  // have to do ourselves, and a missing task is a normal result, not an error.
  const taskIds = [...new Set(rows.map((r) => r.taskId).filter((id): id is string => !!id))];
  const tasks = taskIds.length
    ? await prisma.task.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, title: true, status: true },
      })
    : [];
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  res.json(rows.map((r) => {
    const entities = (r.entities ?? {}) as ParsedSummary;
    return {
      id:         r.id,
      createdAt:  r.createdAt,
      sender:     r.sender,
      senderPhoneLast4: r.senderPhoneLast4,
      rawText:    r.rawText,
      transcription: r.transcription,
      intent:     r.intent,
      confidence: r.confidence,
      status:     r.status,
      errorReason: r.errorReason,
      confirmed:  r.confirmed,
      channel:    r.channel,
      undoneAt:   r.undoneAt,
      taskId:     r.taskId,
      // Null when the command named a ticket that does not exist — which is
      // exactly the case an operator is trying to diagnose.
      task:       r.taskId ? taskById.get(r.taskId) ?? null : null,
      summary: {
        contact:   entities.contact ?? null,
        amount:    entities.amount ?? null,
        reference: entities.reference ?? null,
        targets:   entities.targets ?? [],
      },
    };
  }));
}
