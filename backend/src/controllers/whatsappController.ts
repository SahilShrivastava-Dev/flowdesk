import { Request, Response } from 'express';
import { AttributionSource, DeliveryStatus, MessageDirection, MessageKind } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { sendTextMessage, sendUpdateWaitingNotification } from '../services/whatsappService';
import { canAccessConversation, getLastInbound, computeSession } from '../services/conversationService';

/**
 * Send a WhatsApp message to a team member.
 *
 * Addressed by PERSON, not by task. WhatsApp gives each phone number one
 * conversation, so "which task is this about?" is optional context, not a
 * requirement — an admin asking "how's it going?" isn't talking about a task
 * at all, and forcing one is the mistake this refactor undoes.
 *
 * Body: { userId, message, taskId? }
 * `taskId` alone is still accepted so older clients keep working.
 */
export async function sendMessage(req: Request, res: Response): Promise<void> {
  const { userId, taskId, message } = req.body as {
    userId?: string;
    taskId?: string;
    message: string;
  };
  const { userId: requesterId, role } = req.user!;

  if (!message?.trim()) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  // ── Resolve the recipient ──────────────────────────────────────────────────
  let targetUserId = userId;
  if (!targetUserId && taskId) {
    const task = await prisma.task.findUnique({
      where:  { id: taskId },
      select: { assignedToId: true },
    });
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    targetUserId = task.assignedToId;
  }

  if (!targetUserId) {
    res.status(400).json({ error: 'userId (or taskId) is required' });
    return;
  }

  const target = await prisma.user.findUnique({
    where:  { id: targetUserId },
    select: { id: true, name: true, phone: true, preferredLanguage: true, reportingToId: true },
  });
  if (!target) { res.status(404).json({ error: 'User not found' }); return; }

  // ── Hierarchy check ───────────────────────────────────────────────────────
  // Admin can message anyone; a Manager only their direct reports.
  if (!(await canAccessConversation(role, requesterId, target.id))) {
    res.status(403).json({
      error: 'Forbidden — you can only message your direct reports',
    });
    return;
  }

  if (!target.phone) {
    res.status(400).json({ error: 'This person has no WhatsApp number — update their profile first' });
    return;
  }

  // If a task was named, it must belong to the person being messaged.
  if (taskId) {
    const owns = await prisma.task.findFirst({
      where:  { id: taskId, assignedToId: target.id },
      select: { id: true },
    });
    if (!owns) {
      res.status(400).json({ error: `${taskId} is not assigned to ${target.name}` });
      return;
    }
  }

  // ── Session window ────────────────────────────────────────────────────────
  // Belongs to the phone number, so this is a single indexed lookup on the
  // conversation rather than a scan of one task's activity.
  const session = computeSession(await getLastInbound(target.id));
  const text = message.trim();

  if (session.open) {
    // ✅ Free-form message allowed
    const result = await sendTextMessage(target.phone, text);

    const created = await prisma.message.create({
      data: {
        userId:         target.id,
        senderId:       requesterId,
        direction:      MessageDirection.outbound,
        kind:           MessageKind.text,
        taskId:         taskId ?? null,
        attributedBy:   taskId ? AttributionSource.manual : AttributionSource.none,
        text,
        // Stored so Meta's status webhook can match delivered/read receipts
        // back to this row and drive the ticks in the UI.
        waMessageId:    result.waMessageId ?? null,
        deliveryStatus: result.ok ? DeliveryStatus.sent : DeliveryStatus.failed,
        deliveryError:  result.ok ? null : result.error ?? 'Send failed',
      },
      include: { sender: { select: { id: true, name: true, avatar: true, color: true } } },
    });

    res.status(result.ok ? 200 : 502).json({
      ok: result.ok,
      mode: 'free_text',
      message: created,
      ...(result.ok ? {} : { error: result.error }),
    });
    return;
  }

  // ⏰ Window closed — a template is the only thing Meta will deliver. Send one
  // to re-open it and keep a record of what the sender actually wanted to say.
  //
  // This used to send `hello_world`, so a worker waiting on their manager got
  // Meta's own "Welcome and congratulations!!" sample text from a number they
  // associate with work. `update_waiting` names who is trying to reach them, in
  // their own language, and asks them to reply — which is the entire point of
  // sending anything here.
  const requester = await prisma.user.findUnique({
    where:  { id: requesterId },
    select: { name: true },
  });
  const result = await sendUpdateWaitingNotification(
    target.phone,
    requester?.name ?? 'FlowDesk',
    target.preferredLanguage,
  );

  const created = await prisma.message.create({
    data: {
      userId:         target.id,
      senderId:       requesterId,
      direction:      MessageDirection.outbound,
      kind:           MessageKind.system,
      taskId:         taskId ?? null,
      text:           `[Session expired — sent a re-open notification. Intended: "${text}"]`,
      // The send result is recorded rather than assumed. This hardcoded `sent`,
      // so a template Meta rejected still showed a delivered tick in the UI.
      waMessageId:    result.waMessageId ?? null,
      deliveryStatus: result.ok ? DeliveryStatus.sent : DeliveryStatus.failed,
      deliveryError:  result.ok ? null : result.error ?? 'Send failed',
    },
    include: { sender: { select: { id: true, name: true, avatar: true, color: true } } },
  });

  res.status(result.ok ? 200 : 502).json({
    ok: result.ok,
    mode: 'template_fallback',
    message: created,
    ...(result.ok
      ? {
          warning:
            `${target.name} hasn't replied in over 24h, so your message couldn't be delivered ` +
            `as typed. They've been notified that you're trying to reach them — once they ` +
            `reply, you can send it.`,
        }
      : { error: result.error }),
  });
}
