import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { sendWhatsApp } from '../services/whatsappService';

/**
 * Generate the next human-readable task ID.
 * Scans all existing IDs matching TSK-<digits>, takes the max, increments by 1.
 * Falls back to TSK-1054 if none are found (seed data tops out at TSK-1053).
 */
async function generateTaskId(): Promise<string> {
  const rows = await prisma.task.findMany({ select: { id: true } });
  const nums = rows
    .map((r) => r.id.match(/^TSK-(\d+)$/)?.[1])
    .filter((n): n is string => n !== undefined)
    .map((n) => parseInt(n, 10));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1054;
  return `TSK-${next}`;
}

const taskInclude = {
  assignedTo: { select: { id: true, name: true, avatar: true, color: true, phone: true, role: true, reportingToId: true } },
  assignedBy: { select: { id: true, name: true, avatar: true, color: true } },
  activities: {
    orderBy: { createdAt: 'asc' as const },
    include: { by: { select: { id: true, name: true, avatar: true, color: true } } },
  },
};

export async function listTasks(req: Request, res: Response): Promise<void> {
  const { role, userId } = req.user!;

  let where = {};
  if (role === 'Manager') {
    const reports = await prisma.user.findMany({
      where: { reportingToId: userId },
      select: { id: true },
    });
    const reportIds = reports.map((r) => r.id);
    where = { assignedToId: { in: reportIds } };
  } else if (role === 'Employee') {
    where = { assignedToId: userId };
  }

  const tasks = await prisma.task.findMany({
    where,
    include: taskInclude,
    orderBy: { deadline: 'asc' },
  });
  res.json(tasks);
}

export async function getTask(req: Request, res: Response): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: req.params.id },
    include: taskInclude,
  });
  if (!task) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(task);
}

export async function createTask(req: Request, res: Response): Promise<void> {
  const { userId, role } = req.user!;
  if (role === 'Employee') { res.status(403).json({ error: 'Forbidden' }); return; }

  const { title, description, assignedToId, priority, deadline, customFields } = req.body as {
    title: string;
    description?: string;
    assignedToId: string;
    priority?: 'Low' | 'Medium' | 'High';
    deadline: string;
    customFields?: Record<string, string>;
  };

  if (!title || !assignedToId || !deadline) {
    res.status(400).json({ error: 'title, assignedToId, and deadline are required' });
    return;
  }

  const taskId = await generateTaskId();
  const task = await prisma.task.create({
    data: {
      id: taskId,
      title,
      description: description ?? '',
      assignedToId,
      assignedById: userId,
      priority: priority ?? 'Medium',
      deadline: new Date(deadline),
      customFields: customFields ?? {},
      activities: {
        create: {
          byId: userId,
          type: 'created',
          text: 'Task created',
        },
      },
    },
    include: taskInclude,
  });

  // Fire-and-forget WhatsApp notification
  // Mark alertDispatched immediately so the 48h scheduler doesn't send a duplicate
  if (task.assignedTo.phone) {
    sendWhatsApp(task.assignedTo.phone, 'task_assignment', [
      task.title,
      new Date(task.deadline).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    ])
      .then(() =>
        prisma.task.update({
          where: { id: task.id },
          data: { alertDispatched: true },
        })
      )
      .catch(console.error);
  }

  res.status(201).json(task);
}

export async function updateTask(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { userId, role } = req.user!;

  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

  // Only admin/manager can edit fields
  if (role === 'Employee' && existing.assignedToId !== userId) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  const allowed = ['title', 'description', 'priority', 'deadline', 'customFields'];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      patch[key] = key === 'deadline' ? new Date(req.body[key] as string) : req.body[key];
    }
  }

  const task = await prisma.task.update({ where: { id }, data: patch, include: taskInclude });
  res.json(task);
}

export async function setStatus(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { userId, role } = req.user!;
  const { status } = req.body as { status: 'Pending' | 'Done' | 'Issue' | 'Delay' };

  const existing = await prisma.task.findUnique({
    where: { id },
    include: { assignedTo: { select: { id: true, reportingToId: true } } },
  });
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

  const isOwn = existing.assignedToId === userId;
  const isReport = existing.assignedTo.reportingToId === userId;

  if (role === 'Employee' && !isOwn) { res.status(403).json({ error: 'Forbidden' }); return; }
  if (role === 'Manager' && !isOwn && !isReport) { res.status(403).json({ error: 'Forbidden' }); return; }

  const task = await prisma.task.update({
    where: { id },
    data: {
      status,
      activities: {
        create: { byId: userId, type: 'status', text: `Status changed to ${status}` },
      },
    },
    include: taskInclude,
  });
  res.json(task);
}

export async function approveTask(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { userId, role } = req.user!;

  if (role === 'Employee') { res.status(403).json({ error: 'Forbidden' }); return; }

  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  if (existing.status !== 'Done') { res.status(400).json({ error: 'Task is not in Done status' }); return; }

  const task = await prisma.task.update({
    where: { id },
    data: {
      approved: true,
      activities: {
        create: { byId: userId, type: 'approval', text: 'Approved by manager' },
      },
    },
    include: taskInclude,
  });
  res.json(task);
}

export async function rejectTask(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { userId, role } = req.user!;

  if (role === 'Employee') { res.status(403).json({ error: 'Forbidden' }); return; }

  const { reason } = req.body as { reason?: string };

  const task = await prisma.task.update({
    where: { id },
    data: {
      status: 'Pending',
      approved: false,
      activities: {
        create: {
          byId: userId,
          type: 'reject',
          text: reason ? `Rejected: ${reason}` : 'Rejected — needs rework',
        },
      },
    },
    include: taskInclude,
  });
  res.json(task);
}

export async function escalateTask(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { userId, role } = req.user!;

  // Fetch task + full assignee chain so we can route notifications correctly
  const existing = await prisma.task.findUnique({
    where: { id },
    include: {
      assignedTo: {
        select: { id: true, name: true, phone: true, reportingToId: true,
          reportingTo: { select: { id: true, name: true, phone: true, reportingToId: true,
            reportingTo: { select: { id: true, name: true, phone: true } }
          }}
        },
      },
    },
  });
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

  const MAX_ESCALATION_LEVEL = 4;
  if (existing.escalationLevel >= MAX_ESCALATION_LEVEL) {
    res.status(400).json({ error: `Already at maximum escalation level (L${MAX_ESCALATION_LEVEL})` });
    return;
  }

  const escalator = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, role: true },
  });

  const nextLevel = existing.escalationLevel + 1;

  const task = await prisma.task.update({
    where: { id },
    data: {
      escalationLevel: nextLevel,
      activities: {
        create: {
          byId: userId,
          type: 'escalation',
          text: `Manually escalated to L${nextLevel} by ${escalator?.name ?? 'unknown'} (${role})`,
        },
      },
    },
    include: taskInclude,
  });

  // ── Notification routing based on who escalated ─────────────────────────
  //
  //  Employee escalates own task  → notify their Manager
  //  Manager escalates a report   → notify Manager's manager (Admin), also ping assignee
  //  Admin escalates any task     → notify assignee + their Manager
  //
  const assignee = existing.assignedTo;
  const manager  = assignee.reportingTo;
  const admin    = manager?.reportingTo;

  if (role === 'Employee') {
    // Notify the manager
    if (manager?.phone) {
      sendWhatsApp(manager.phone, 'task_escalation', [assignee.name, existing.title]).catch(console.error);
    }
  } else if (role === 'Manager') {
    // Notify Admin (manager's manager)
    if (admin?.phone) {
      sendWhatsApp(admin.phone, 'task_escalation', [assignee.name, existing.title]).catch(console.error);
    }
    // Also ping the assignee so they know it's been escalated above their manager
    if (assignee.phone) {
      sendWhatsApp(assignee.phone, 'task_escalation', [assignee.name, existing.title]).catch(console.error);
    }
  } else if (role === 'Admin') {
    // Notify both the assignee and their manager
    if (assignee.phone) {
      sendWhatsApp(assignee.phone, 'task_escalation', [assignee.name, existing.title]).catch(console.error);
    }
    if (manager?.phone) {
      sendWhatsApp(manager.phone, 'task_escalation', [assignee.name, existing.title]).catch(console.error);
    }
  }

  res.json(task);
}

export async function retractApproval(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { userId, role } = req.user!;

  if (role === 'Employee') { res.status(403).json({ error: 'Forbidden' }); return; }

  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  if (!existing.approved) { res.status(400).json({ error: 'Task is not yet approved' }); return; }

  const task = await prisma.task.update({
    where: { id },
    data: {
      approved: false,
      activities: {
        create: { byId: userId, type: 'retract', text: 'Approval retracted' },
      },
    },
    include: taskInclude,
  });
  res.json(task);
}

export async function reassignTask(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { userId, role } = req.user!;

  if (role === 'Employee') { res.status(403).json({ error: 'Forbidden' }); return; }

  const { newAssigneeId } = req.body as { newAssigneeId: string };
  if (!newAssigneeId) { res.status(400).json({ error: 'newAssigneeId required' }); return; }

  const newAssignee = await prisma.user.findUnique({ where: { id: newAssigneeId } });
  if (!newAssignee) { res.status(404).json({ error: 'Assignee not found' }); return; }

  const task = await prisma.task.update({
    where: { id },
    data: {
      assignedToId: newAssigneeId,
      activities: {
        create: {
          byId: userId,
          type: 'reassign',
          text: `Reassigned to ${newAssignee.name}`,
        },
      },
    },
    include: taskInclude,
  });
  res.json(task);
}
