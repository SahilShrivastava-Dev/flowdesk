import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

/**
 * Return recent activity-based notifications for the logged-in user.
 * Admins see everything; Managers see their direct reports; Employees see their own.
 * Read/unread state is managed client-side via a lastSeen timestamp in localStorage.
 */
export async function listNotifications(req: Request, res: Response): Promise<void> {
  const { role, userId } = req.user!;

  // Which tasks does this user care about?
  let taskFilter: Record<string, unknown> = {};
  if (role === 'Manager') {
    const reports = await prisma.user.findMany({
      where: { reportingToId: userId },
      select: { id: true },
    });
    taskFilter = { assignedToId: { in: reports.map((r) => r.id) } };
  } else if (role === 'Employee') {
    taskFilter = { assignedToId: userId };
  }
  // Admin → no filter, sees everything

  // Pull the last 7 days of whatsapp replies + escalations across relevant tasks
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const activities = await prisma.activity.findMany({
    where: {
      type: { in: ['whatsapp', 'escalation', 'status'] },
      createdAt: { gt: since },
      task: Object.keys(taskFilter).length ? taskFilter : undefined,
    },
    include: {
      task: { select: { id: true, title: true } },
      by:   { select: { id: true, name: true, avatar: true, color: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  const TITLES: Record<string, (byName: string, taskId: string) => string> = {
    whatsapp:   (by, id) => `${by} replied on ${id}`,
    escalation: (by, id) => `${id} escalated`,
    status:     (by, id) => `${by} updated ${id}`,
  };

  res.json(
    activities.map((a) => ({
      id:        a.id,
      type:      a.type,
      title:     (TITLES[a.type] ?? ((b, id) => `Activity on ${id}`))(a.by.name, a.task.id),
      detail:    a.text,
      taskId:    a.task.id,
      taskTitle: a.task.title,
      by:        a.by,
      createdAt: a.createdAt,
    }))
  );
}
