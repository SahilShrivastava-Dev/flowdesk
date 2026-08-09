import { Request, Response } from 'express';
import { ActionChannel, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ACTIVITY_TYPE } from '../lib/constants';
import {
  sendEscalationNotification, sendSupervisorEscalationNotification,
} from '../services/whatsappService';
import { recordTemplateSend } from '../services/notifyService';
import { canManageTask } from '../services/permissionService';
import * as taskService from '../services/taskService';
import { HTTP_STATUS, TaskOpError, chronological, taskInclude } from '../services/taskService';

/**
 * Turn a service-level refusal into an HTTP response.
 *
 * The operations that both this controller and the WhatsApp executor share now
 * live in `taskService`, so they signal failure by throwing rather than by
 * writing a response. Anything that isn't a `TaskOpError` is a genuine bug and
 * is re-thrown rather than reported to the client as a tidy 400.
 */
function sendOpError(res: Response, err: unknown): void {
  if (err instanceof TaskOpError) {
    res.status(HTTP_STATUS[err.code]).json({ error: err.message });
    return;
  }
  throw err;
}

/**
 * Load a task and confirm the caller may act on it.
 *
 * Approve, reject, retract, escalate and edit all used to check only that the
 * caller wasn't an Employee — so ANY Manager could approve, reject or rewrite
 * ANY task in the database, including one belonging to a different manager's
 * team entirely. The reassign endpoint had the same hole and was fixed when
 * WhatsApp started sharing its code path; these four were never reached by that
 * work and kept the weakness.
 *
 * Returns null when it has already sent the response.
 */
async function loadForAction(req: Request, res: Response) {
  const { id } = req.params;
  const { userId, role } = req.user!;

  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) { res.status(404).json({ error: 'Not found' }); return null; }

  if (!(await canManageTask({ id: userId, role }, task))) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return task;
}

export async function listTasks(req: Request, res: Response): Promise<void> {
  const { role, userId } = req.user!;

  let where = {};
  if (role === 'Manager') {
    const reports = await prisma.user.findMany({
      where: { reportingToId: userId },
      select: { id: true },
    });
    // Scope is unchanged — a manager's list is their reports' work. Widened
    // only so a report who holds a task as CO-assignee still puts it in view.
    // (A manager's own solo tasks have never appeared here; that predates this
    // change and is left alone deliberately.)
    where = taskService.heldByAnyUser(reports.map((r) => r.id));
  } else if (role === 'Employee') {
    // Not just `assignedToId` — an employee who is a CO-assignee on a shared
    // task must see it, or the task they were told to work on is invisible.
    where = taskService.heldByUser(userId);
  }

  const tasks = await prisma.task.findMany({
    where,
    include: taskInclude,
    orderBy: { deadline: 'asc' },
  });
  res.json(tasks.map(chronological));
}

export async function getTask(req: Request, res: Response): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: req.params.id },
    include: {
      ...taskInclude,
      // Only on the single-task fetch. Adding this to listTasks would
      // re-create exactly the payload bloat the activity cap just removed.
      messages: {
        orderBy: { createdAt: 'asc' as const },
        take: 100,
        include: { sender: { select: { id: true, name: true, avatar: true, color: true } } },
      },
    },
  });
  if (!task) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(chronological(task));
}

export async function createTask(req: Request, res: Response): Promise<void> {
  const { userId, role } = req.user!;

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

  try {
    const task = await taskService.create(
      { id: userId, role },
      {
        title,
        description,
        assignedToId,
        priority,
        deadline: new Date(deadline),
        customFields,
      },
      { channel: ActionChannel.web },
    );
    res.status(201).json(task);
  } catch (err) {
    sendOpError(res, err);
  }
}

export async function updateTask(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { userId, role } = req.user!;

  if (!(await loadForAction(req, res))) return;

  const allowed = ['title', 'description', 'priority', 'deadline', 'customFields'];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      patch[key] = key === 'deadline' ? new Date(req.body[key] as string) : req.body[key];
    }
  }

  const task = await prisma.task.update({ where: { id }, data: patch, include: taskInclude });
  res.json(chronological(task));
}

export async function setStatus(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { userId, role } = req.user!;
  // `Submitted` included: a holder reporting their own part submits it, which
  // is the same transition the WhatsApp path makes.
  const { status } = req.body as {
    status: 'Pending' | 'InProgress' | 'Submitted' | 'Done' | 'Issue' | 'Delay';
  };

  const existing = await prisma.task.findUnique({
    where: { id },
    include: {
      assignedTo: { select: { id: true, reportingToId: true } },
      assignees:  { select: { userId: true, status: true } },
    },
  });
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

  // Holding the task counts as owning it, so a co-assignee on a shared task
  // can report their own progress.
  const isOwn = existing.assignedToId === userId
    || existing.assignees.some((a) => a.userId === userId);
  const isReport = existing.assignedTo.reportingToId === userId;

  if (role === 'Employee' && !isOwn) { res.status(403).json({ error: 'Forbidden' }); return; }
  if (role === 'Manager' && !isOwn && !isReport) { res.status(403).json({ error: 'Forbidden' }); return; }

  // A holder is reporting their own part; anyone else (a manager overriding)
  // is setting the task's status directly.
  const mine = existing.assignees.find((a) => a.userId === userId);
  const rolledUp = mine
    ? taskService.rollUpStatus([
        ...existing.assignees.filter((a) => a.userId !== userId).map((a) => a.status),
        status as TaskStatus,
      ])
    : status as TaskStatus;

  await prisma.$transaction([
    prisma.task.update({
      where: { id },
      data: {
        status: rolledUp,
        activities: {
          create: { byId: userId, type: ACTIVITY_TYPE.STATUS, text: `Status changed to ${status}` },
        },
      },
    }),
    ...(mine ? [prisma.taskAssignee.update({
      where: { taskId_userId: { taskId: id, userId } },
      data: {
        status: status as TaskStatus,
        submittedAt: status === 'Submitted' ? new Date() : null,
      },
    })] : []),
  ]);

  const task = await prisma.task.findUniqueOrThrow({ where: { id }, include: taskInclude });
  res.json(chronological(task));
}

export async function approveTask(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { userId, role } = req.user!;

  if (role === 'Employee') { res.status(403).json({ error: 'Forbidden' }); return; }

  const existing = await loadForAction(req, res);
  if (!existing) return;
  if (existing.status !== 'Submitted') {
    res.status(400).json({ error: 'Only a submitted task can be approved' });
    return;
  }

  // Approval is what makes a task Done. Until now the worker's submission sat
  // in Submitted — this is the step that verifies it.
  const task = await prisma.task.update({
    where: { id },
    data: {
      status: 'Done',
      approved: true,
      activities: {
        create: { byId: userId, type: ACTIVITY_TYPE.APPROVAL, text: 'Approved — marked Done' },
      },
    },
    include: taskInclude,
  });
  res.json(chronological(task));
}

export async function rejectTask(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { userId, role } = req.user!;

  if (role === 'Employee') { res.status(403).json({ error: 'Forbidden' }); return; }
  if (!(await loadForAction(req, res))) return;

  const { reason } = req.body as { reason?: string };

  // Rejected work goes back to InProgress, not Pending — the worker already
  // started it, and sending them back to "not begun" loses that.
  const task = await prisma.task.update({
    where: { id },
    data: {
      status: 'InProgress',
      approved: false,
      activities: {
        create: {
          byId: userId,
          type: ACTIVITY_TYPE.REJECT,
          text: reason ? `Rejected: ${reason}` : 'Rejected — needs rework',
        },
      },
    },
    include: taskInclude,
  });
  res.json(chronological(task));
}

export async function escalateTask(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { userId, role } = req.user!;

  // Fetch task + full assignee chain so we can route notifications correctly
  const existing = await prisma.task.findUnique({
    where: { id },
    include: {
      assignedTo: {
        select: { id: true, name: true, phone: true, preferredLanguage: true, reportingToId: true,
          reportingTo: { select: { id: true, name: true, phone: true, preferredLanguage: true, reportingToId: true,
            reportingTo: { select: { id: true, name: true, phone: true, preferredLanguage: true } }
          }}
        },
      },
    },
  });
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

  if (!(await canManageTask({ id: userId, role }, existing))) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

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
          type: ACTIVITY_TYPE.ESCALATION,
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

  // Two audiences, two templates. The holder is told their own task is overdue;
  // a supervisor is told somebody else's is. These all used to send the
  // holder-facing template in English regardless of who was reading it, so a
  // Hindi-speaking manager got an English message addressed to their report.
  const notifyHolder = async (
    person: { id: string; name: string; phone: string | null; preferredLanguage: string },
  ) => {
    if (!person.phone) return;
    const result = await sendEscalationNotification(
      person.phone, person.name, existing.title, person.preferredLanguage,
    );
    await recordTemplateSend({
      userId: person.id, actorId: userId, taskId: existing.id,
      text: `⏰ Escalated to L${nextLevel} — "${existing.title}" is past its deadline`,
      result,
    });
  };

  const notifySupervisor = async (
    person: { id: string; name: string; phone: string | null; preferredLanguage: string },
  ) => {
    if (!person.phone) return;
    const result = await sendSupervisorEscalationNotification(
      person.phone, assignee.name, existing.title, person.preferredLanguage,
    );
    await recordTemplateSend({
      userId: person.id, actorId: userId, taskId: existing.id,
      text: `⏰ L${nextLevel}: ${assignee.name}'s task "${existing.title}" is overdue`,
      result,
    });
  };

  // Fire and forget — the escalation itself is already committed, and a failed
  // notification must not turn a successful escalation into a 500.
  void (async () => {
    if (role === 'Employee') {
      // Up one level: their manager.
      if (manager) await notifySupervisor(manager);
    } else if (role === 'Manager') {
      // Up to the Admin, and back down so the assignee knows it went over their
      // manager's head.
      if (admin) await notifySupervisor(admin);
      await notifyHolder(assignee);
    } else if (role === 'Admin') {
      await notifyHolder(assignee);
      if (manager) await notifySupervisor(manager);
    }
  })().catch((err) => console.error(`[Escalate] Notification failed for ${existing.id}:`, err));

  res.json(chronological(task));
}

export async function retractApproval(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { userId, role } = req.user!;

  if (role === 'Employee') { res.status(403).json({ error: 'Forbidden' }); return; }

  const existing = await loadForAction(req, res);
  if (!existing) return;
  if (!existing.approved) { res.status(400).json({ error: 'Task is not yet approved' }); return; }

  // Retracting approval returns it to the review queue rather than leaving it
  // Done-but-unapproved, which nothing would surface.
  const task = await prisma.task.update({
    where: { id },
    data: {
      status: 'Submitted',
      approved: false,
      activities: {
        create: { byId: userId, type: ACTIVITY_TYPE.RETRACT, text: 'Approval retracted — back for review' },
      },
    },
    include: taskInclude,
  });
  res.json(chronological(task));
}

/**
 * Reassign a task.
 *
 * This used to check only that the caller wasn't an Employee — no check that
 * they could see the task, and none that the new assignee was inside their
 * reporting line. Any Manager could move any task in the database onto any
 * user. The UI never offered that, because `listUsers` is role-scoped, but the
 * server was taking the client's word for it.
 *
 * Both checks now live in `taskService.reassign`, which the WhatsApp command
 * executor calls too — so neither channel can be the lenient one.
 */
export async function reassignTask(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { userId, role } = req.user!;

  const { newAssigneeId } = req.body as { newAssigneeId: string };
  if (!newAssigneeId) { res.status(400).json({ error: 'newAssigneeId required' }); return; }

  try {
    const task = await taskService.reassign(
      { id: userId, role },
      id,
      newAssigneeId,
      { channel: ActionChannel.web },
    );
    res.json(task);
  } catch (err) {
    sendOpError(res, err);
  }
}
