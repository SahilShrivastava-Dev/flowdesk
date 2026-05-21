import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { sendTextMessage, sendWhatsApp } from '../services/whatsappService';

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Send a message from Admin/Manager to a task's assignee via WhatsApp.
 *
 * Strategy:
 *  - If the assignee messaged us within the last 24h → send free text (personalised)
 *  - If the window has expired → send hello_world template to restart the session,
 *    then log what the admin tried to say so they can resend once employee replies
 */
export async function sendMessage(req: Request, res: Response): Promise<void> {
  const { taskId, message } = req.body as { taskId: string; message: string };
  const { userId, role } = req.user!;

  if (!taskId || !message?.trim()) {
    res.status(400).json({ error: 'taskId and message are required' });
    return;
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      assignedTo: { select: { id: true, name: true, phone: true, reportingToId: true } },
    },
  });

  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

  // ── Hierarchy check ────────────────────────────────────────────────────────
  // Admin can message anyone.
  // Manager can only message assignees who directly report to them.
  if (role === 'Manager' && task.assignedTo.reportingToId !== userId) {
    res.status(403).json({
      error: 'Forbidden — you can only send WhatsApp messages for tasks assigned to your direct reports',
    });
    return;
  }

  const phone = task.assignedTo.phone;
  if (!phone) {
    res.status(400).json({ error: 'Assignee has no WhatsApp number — update their profile first' });
    return;
  }

  // Check if assignee sent us a message in the last 24h (session window)
  const lastInbound = await prisma.activity.findFirst({
    where: { taskId, type: 'whatsapp' },
    orderBy: { createdAt: 'desc' },
  });

  const withinWindow = lastInbound
    ? (Date.now() - new Date(lastInbound.createdAt).getTime()) < SESSION_WINDOW_MS
    : false;

  if (withinWindow) {
    // ✅ Free-text — no template needed
    await sendTextMessage(phone, message.trim());

    await prisma.activity.create({
      data: {
        taskId,
        byId: userId,
        type: 'outbound',
        text: message.trim(),
      },
    });

    res.json({ ok: true, mode: 'free_text' });
  } else {
    // ⏰ Session expired — send template to re-open window
    // Log the intended message so admin knows it's queued
    await sendWhatsApp(phone, 'hello_world', []);

    await prisma.activity.create({
      data: {
        taskId,
        byId: userId,
        type: 'outbound',
        text: `[Session expired — sent hello_world to re-open. Intended: "${message.trim()}"]`,
      },
    });

    res.json({
      ok: true,
      mode: 'template_fallback',
      warning: `${task.assignedTo.name} hasn't replied in over 24h. A hello_world message was sent to restart the session. Once they reply, you can send free messages.`,
    });
  }
}
