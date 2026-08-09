import { prisma } from '../lib/prisma';
import { ACTIVITY_TYPE } from '../lib/constants';
import {
  sendDeadlineReminderNotification, sendEscalationNotification,
  sendSupervisorEscalationNotification,
} from './whatsappService';
import { recordTemplateSend } from './notifyService';

// ─── Escalation config ────────────────────────────────────────────────────────
//
// ESCALATION_INTERVALS_HOURS defines how long to wait between each escalation level.
// Format: comma-separated hours, one value per transition.
//
//   Index 0 → Level 0→1: hours after deadline before first escalation
//   Index 1 → Level 1→2: hours after L1 before escalating to L2
//   Index 2 → Level 2→3: hours after L2 before escalating to L3
//   ... and so on
//
// Once all intervals are exhausted, no further escalation happens.
//
// Examples:
//   Food delivery:  "0,0.25,0.5,1"     → immediate, +15min, +30min, +1hr
//   Home services:  "0,24,48,72"        → immediate, +24hr, +48hr, +72hr
//   Default:        "0,24,48"
//
// MAX_ESCALATION_LEVEL: cap so tasks don't escalate infinitely.
// Set to 0 to disable the cap.

function getEscalationConfig(): { intervals: number[]; maxLevel: number } {
  const raw      = process.env.ESCALATION_INTERVALS_HOURS ?? '0,24,48';
  const maxLevel = parseInt(process.env.MAX_ESCALATION_LEVEL ?? '0', 10) || 99;

  const intervals = raw
    .split(',')
    .map((s) => parseFloat(s.trim()))
    .filter((n) => !isNaN(n));

  if (intervals.length === 0) {
    console.warn('[Escalation] ESCALATION_INTERVALS_HOURS is invalid — using default [0, 24, 48]');
    return { intervals: [0, 24, 48], maxLevel };
  }

  return { intervals, maxLevel };
}

// ─── Main escalation runner ───────────────────────────────────────────────────

export async function runEscalation(): Promise<void> {
  const now = new Date();
  const { intervals, maxLevel } = getEscalationConfig();

  // Find all overdue, non-Done tasks
  const overdueTasks = await prisma.task.findMany({
    where: {
      deadline: { lt: now },
      status:   { notIn: ['Done', 'Submitted'] },  // submitted work is with the reviewer, not the worker
    },
    include: {
      assignedTo: {
        select: { id: true, name: true, phone: true, preferredLanguage: true, reportingToId: true },
      },
      assignedBy: { select: { id: true, name: true } },
      // Every holder, not just the primary. On a shared task the co-assignees
      // are as overdue as the owner of record, and escalating past them
      // silently was the gap multi-assignee opened.
      assignees: {
        select: {
          status: true,
          user: { select: { id: true, name: true, phone: true, preferredLanguage: true } },
        },
      },
    },
  });

  for (const task of overdueTasks) {
    try {
      const currentLevel = task.escalationLevel;

      // Already at or above max — stop
      if (maxLevel > 0 && currentLevel >= maxLevel) continue;

      // No more configured intervals — stop
      if (currentLevel >= intervals.length) continue;

      const intervalHours = intervals[currentLevel];
      const intervalMs    = intervalHours * 60 * 60 * 1000;

      // Find the most recent escalation activity for this task
      const lastEscalation = await prisma.activity.findFirst({
        where:   { taskId: task.id, type: ACTIVITY_TYPE.ESCALATION },
        orderBy: { createdAt: 'desc' },
      });

      let shouldEscalate = false;

      if (!lastEscalation) {
        // Never escalated before — fire as soon as the wait after deadline is met
        const msSinceDeadline = now.getTime() - new Date(task.deadline).getTime();
        shouldEscalate = msSinceDeadline >= intervalMs;
      } else {
        // Already escalated — check if enough time has passed since the last one
        const msSinceLast = now.getTime() - new Date(lastEscalation.createdAt).getTime();
        shouldEscalate = msSinceLast >= intervalMs;
      }

      if (!shouldEscalate) continue;

      // ── Escalate ──────────────────────────────────────────────────────────
      const nextLevel = currentLevel + 1;

      await prisma.task.update({
        where: { id: task.id },
        data: {
          escalationLevel: nextLevel,
          activities: {
            create: {
              byId: task.assignedById,
              type: ACTIVITY_TYPE.ESCALATION,
              text: `Auto-escalated to L${nextLevel}: deadline missed by ${Math.round((now.getTime() - new Date(task.deadline).getTime()) / 3600000)}h`,
            },
          },
        },
      });

      console.log(`[Escalation] ${task.id} → L${nextLevel} (was L${currentLevel}, interval was ${intervalHours}h)`);

      // ── Notify: every holder who hasn't finished their part ──────────────
      // Somebody who has already submitted is waiting on a reviewer, not
      // holding anything up, so chasing them would be noise.
      const outstanding = task.assignees.length > 0
        ? task.assignees
            .filter((a) => a.status !== 'Submitted' && a.status !== 'Done')
            .map((a) => a.user)
        : [task.assignedTo];

      for (const person of outstanding) {
        if (!person.phone) continue;
        const result = await sendEscalationNotification(
          person.phone,
          person.name,          // {{1}} = the recipient's own name — this is their task
          task.title,
          person.preferredLanguage,
        );
        await recordTemplateSend({
          userId:  person.id,
          actorId: null,        // the cron, not a person
          taskId:  task.id,
          text:    `⏰ Escalated to L${nextLevel} — "${task.title}" is past its deadline`,
          result,
        });
      }

      // ── Notify: ping manager on L2+, Admin on L3+ ────────────────────────
      //
      // Supervisors get their own template. The holder-facing one opens
      // "Hi {{1}}, your task…", so sending it upward with the assignee's name
      // in {{1}} addressed the manager by somebody else's name and told them
      // they owned work that was never theirs.
      if (nextLevel >= 2 && task.assignedTo.reportingToId) {
        const manager = await prisma.user.findUnique({
          where:  { id: task.assignedTo.reportingToId },
          select: { id: true, phone: true, name: true, preferredLanguage: true, reportingToId: true },
        });
        if (manager?.phone) {
          const result = await sendSupervisorEscalationNotification(
            manager.phone,
            task.assignedTo.name,   // {{1}} = whose task is overdue
            task.title,
            manager.preferredLanguage,
          );
          await recordTemplateSend({
            userId:  manager.id,
            actorId: null,
            taskId:  task.id,
            text:    `⏰ L${nextLevel}: ${task.assignedTo.name}'s task "${task.title}" is overdue`,
            result,
          });
        }

        // L3+: also notify the manager's manager (Admin level)
        if (nextLevel >= 3 && manager?.reportingToId) {
          const admin = await prisma.user.findUnique({
            where:  { id: manager.reportingToId },
            select: { id: true, phone: true, name: true, preferredLanguage: true },
          });
          if (admin?.phone) {
            const result = await sendSupervisorEscalationNotification(
              admin.phone,
              task.assignedTo.name,
              task.title,
              admin.preferredLanguage,
            );
            await recordTemplateSend({
              userId:  admin.id,
              actorId: null,
              taskId:  task.id,
              text:    `⏰ L${nextLevel}: ${task.assignedTo.name}'s task "${task.title}" is overdue`,
              result,
            });
          }
        }
      }
    } catch (err) {
      console.error(`[Escalation] Failed for task ${task.id}:`, err);
    }
  }

  // ── 48h advance alerts ────────────────────────────────────────────────────
  const alertThreshold = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const pendingAlerts  = await prisma.task.findMany({
    where: {
      alertDispatched: false,
      deadline: { lt: alertThreshold, gt: now },
      status:   { notIn: ['Done', 'Submitted'] },  // submitted work is with the reviewer, not the worker
    },
    include: {
      assignedTo: { select: { id: true, phone: true, name: true, preferredLanguage: true } },
      assignees: {
        select: { user: { select: { id: true, phone: true, name: true, preferredLanguage: true } } },
      },
    },
  });

  for (const task of pendingAlerts) {
    try {
      // Everyone holding it gets the advance warning, not only the primary.
      const holders = task.assignees.length > 0
        ? task.assignees.map((a) => a.user)
        : [task.assignedTo];

      for (const person of holders) {
        if (!person.phone) continue;
        // Its own template. This used to send `task_assignment`, so somebody
        // who had held a task for a week was told it had just been given to
        // them — and the real point, that the deadline is close, was never said.
        const result = await sendDeadlineReminderNotification(
          person.phone,
          person.name,
          task.id,
          person.preferredLanguage,  // auto-picks the right language template
        );
        await recordTemplateSend({
          userId:  person.id,
          actorId: null,
          taskId:  task.id,
          text:    `🔔 Reminder: ${task.id} is due soon and not yet complete`,
          result,
        });
      }
      await prisma.task.update({
        where: { id: task.id },
        data:  { alertDispatched: true },
      });
    } catch (err) {
      console.error(`[Alert] Failed for task ${task.id}:`, err);
    }
  }
}
