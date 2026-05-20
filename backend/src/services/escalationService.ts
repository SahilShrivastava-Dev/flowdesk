import { prisma } from '../lib/prisma';
import { sendWhatsApp } from './whatsappService';

export async function runEscalation(): Promise<void> {
  const now = new Date();

  // Find overdue tasks that are not Done and haven't been escalated yet (or need re-escalation)
  const overdueTasks = await prisma.task.findMany({
    where: {
      deadline: { lt: now },
      status: { not: 'Done' },
    },
    include: {
      assignedTo: {
        select: { id: true, name: true, phone: true, reportingToId: true },
      },
      assignedBy: {
        select: { id: true, name: true },
      },
    },
  });

  for (const task of overdueTasks) {
    try {
      // Determine if we already escalated in the last hour to avoid flooding
      const recentEscalation = await prisma.activity.findFirst({
        where: {
          taskId: task.id,
          type: 'escalation',
          createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) },
        },
      });
      if (recentEscalation) continue;

      await prisma.task.update({
        where: { id: task.id },
        data: {
          escalationLevel: { increment: 1 },
          activities: {
            create: {
              byId: task.assignedById,
              type: 'escalation',
              text: 'Auto-escalated: deadline missed',
            },
          },
        },
      });

      // Notify assignee directly
      if (task.assignedTo.phone) {
        await sendWhatsApp(task.assignedTo.phone, 'task_escalation', [
          task.assignedTo.name,
          task.title,
        ]).catch(console.error);
      }

      // If escalationLevel > 0, also notify the reporting manager
      if (task.escalationLevel > 0 && task.assignedTo.reportingToId) {
        const manager = await prisma.user.findUnique({
          where: { id: task.assignedTo.reportingToId },
          select: { phone: true, name: true },
        });
        if (manager?.phone) {
          await sendWhatsApp(manager.phone, 'task_escalation', [
            task.assignedTo.name,
            task.title,
          ]).catch(console.error);
        }
      }
    } catch (err) {
      console.error(`[Escalation] Failed for task ${task.id}:`, err);
    }
  }

  // Send 48h advance alerts
  const alertThreshold = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const pendingAlerts = await prisma.task.findMany({
    where: {
      alertDispatched: false,
      deadline: { lt: alertThreshold, gt: now },
      status: { not: 'Done' },
    },
    include: {
      assignedTo: { select: { phone: true, name: true } },
    },
  });

  for (const task of pendingAlerts) {
    try {
      if (task.assignedTo.phone) {
        await sendWhatsApp(task.assignedTo.phone, 'task_assignment', [
          task.title,
          new Date(task.deadline).toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
          }),
        ]);
      }
      await prisma.task.update({
        where: { id: task.id },
        data: { alertDispatched: true },
      });
    } catch (err) {
      console.error(`[Alert] Failed for task ${task.id}:`, err);
    }
  }
}
