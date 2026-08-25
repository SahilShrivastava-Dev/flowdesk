import { Request, Response } from 'express';
import { MessageDirection, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { NOTIFIABLE_ACTIVITY_TYPES } from '../lib/constants';
import { conversationScope, previewFor } from '../services/conversationService';
import { heldByAnyUser, heldByUser } from '../services/taskService';

/**
 * Recent notifications for the logged-in user.
 *
 * Two sources, merged:
 *   • conversations — inbound WhatsApp messages, COLLAPSED PER PERSON
 *   • tasks         — escalations, status changes, approvals from the audit log
 *
 * The collapsing matters. Previously every inbound message produced its own
 * row, so a worker sending three messages in a minute filled the bell with
 * three near-identical "replied on TSK-…" entries. Now that's one row saying
 * how many messages arrived.
 *
 * Read/unread is client-side via a lastSeen timestamp in localStorage.
 */
const SINCE_MS = 7 * 24 * 60 * 60 * 1000;
const LIMIT = 30;

export async function listNotifications(req: Request, res: Response): Promise<void> {
  const { role, userId } = req.user!;
  const since = new Date(Date.now() - SINCE_MS);

  // Which tasks does this user care about? (unchanged role scoping)
  // Co-assignments count, so a shared task raises the bell for everyone on it
  // rather than only its primary holder.
  let taskFilter: Prisma.TaskWhereInput | undefined;
  if (role === 'Manager') {
    const reports = await prisma.user.findMany({
      where: { reportingToId: userId },
      select: { id: true },
    });
    taskFilter = heldByAnyUser(reports.map((r) => r.id));
  } else if (role === 'Employee') {
    taskFilter = heldByUser(userId);
  }

  const [inbound, activities] = await Promise.all([
    prisma.message.findMany({
      where: {
        direction: MessageDirection.inbound,
        createdAt: { gt: since },
        // Employee threads only. `userId` is nullable now that a conversation
        // can belong to an external contact, and a contact's reply does not
        // belong in the team's notification bell — it is routed to the one
        // person who owns that relationship instead. Stating the filter
        // explicitly rather than relying on the relation filter below to imply
        // it, so the intent survives someone editing `conversationScope`.
        userId: { not: null },
        user: conversationScope(role, userId),
      },
      include: {
        user: { select: { id: true, name: true, avatar: true, color: true } },
        task: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    prisma.activity.findMany({
      where: {
        type: { in: NOTIFIABLE_ACTIVITY_TYPES },
        createdAt: { gt: since },
        ...(taskFilter && { task: taskFilter }),
      },
      include: {
        task: { select: { id: true, title: true } },
        by:   { select: { id: true, name: true, avatar: true, color: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: LIMIT,
    }),
  ]);

  // ── Collapse conversation messages: one entry per person ─────────────────
  const byUser = new Map<string, typeof inbound>();
  for (const m of inbound) {
    // Narrowing, not filtering: the query above already excluded contact
    // threads. This is what tells the compiler so.
    if (!m.userId || !m.user) continue;
    const list = byUser.get(m.userId) ?? [];
    list.push(m);
    byUser.set(m.userId, list);
  }

  const conversationItems = [...byUser.values()].map((msgs) => {
    // `inbound` is newest-first, so the first entry is the latest message.
    const latest = msgs[0];
    const count = msgs.length;
    const firstName = latest.user!.name.split(' ')[0];

    return {
      id:        `conv-${latest.userId}-${latest.id}`,
      type:      'conversation' as const,
      title:     count === 1 ? `${firstName} replied` : `${firstName} sent ${count} messages`,
      detail:    previewFor(latest),
      userId:    latest.userId,
      taskId:    latest.taskId,               // may be null — panel handles that
      taskTitle: latest.task?.title ?? null,
      needsAttribution: msgs.some((m) => m.needsAttribution),
      channel:   'whatsapp',   // by definition — these are inbound messages
      by:        latest.user!,
      createdAt: latest.createdAt,
    };
  });

  const TITLES: Record<string, (by: string, taskId: string) => string> = {
    escalation: (_by, id) => `${id} escalated`,
    status:     (by, id)  => `${by} updated ${id}`,
    approval:   (by, id)  => `${by} approved ${id}`,
    reassign:   (by, id)  => `${by} assigned ${id} to you`,
    created:    (by, id)  => `${by} assigned you ${id}`,
  };

  const taskItems = activities.map((a) => ({
    id:        a.id,
    type:      a.type,
    title:     (TITLES[a.type] ?? ((_b, id) => `Activity on ${id}`))(a.by.name, a.task.id),
    detail:    a.text,
    userId:    null as string | null,
    taskId:    a.task.id,
    taskTitle: a.task.title,
    needsAttribution: false,
    // Lets the bell distinguish "reassigned on the dashboard" from
    // "reassigned over WhatsApp" without parsing the detail string.
    channel:   a.channel,
    by:        a.by,
    createdAt: a.createdAt,
  }));

  const merged = [...conversationItems, ...taskItems]
    .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
    .slice(0, LIMIT);

  res.json(merged);
}
