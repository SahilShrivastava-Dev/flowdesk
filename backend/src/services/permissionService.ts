import { prisma } from '../lib/prisma';

// ─────────────────────────────────────────────────────────────────────────────
// Who may assign work to whom, and who may act on which task.
//
// This is the single definition of the reporting-hierarchy rules. Everything
// that changes a task's ownership goes through here — the web API and the
// WhatsApp command executor both, so the two channels cannot drift apart.
//
// The load-bearing idea for the WhatsApp path: `assignableUsers` is not just a
// check, it's the CANDIDATE SET that name resolution searches. A manager asking
// for someone outside their hierarchy gets "nobody by that name in your team"
// because that person was never in the list, not because a later filter caught
// it. The AI is never shown people the sender may not assign to, so no amount
// of clever phrasing can surface one.
// ─────────────────────────────────────────────────────────────────────────────

export interface Actor {
  id: string;
  role: string;
}

export interface AssignableUser {
  id: string;
  name: string;
  role: string;
  phone: string | null;
  preferredLanguage: string;
}

/**
 * Everyone `actor` is permitted to put work on.
 *
 *   Admin    → everybody
 *   Manager  → their direct reports, plus themselves (taking a task back is a
 *              legitimate move, and the spec's scenario starts with a manager
 *              holding a ticket)
 *   Employee → nobody. Employees do not assign work.
 *
 * Returned sorted by name so any list we read back to a human is stable.
 */
export async function assignableUsers(actor: Actor): Promise<AssignableUser[]> {
  const select = {
    id: true, name: true, role: true, phone: true, preferredLanguage: true,
  } as const;

  // Somebody who has left is not a candidate. They stay in the database for
  // their task history, but assigning new work to them would be a silent dead
  // end — no login, no notifications, no chance of it being done.
  const active = { deactivatedAt: null };

  if (actor.role === 'Admin') {
    return prisma.user.findMany({ where: active, select, orderBy: { name: 'asc' } });
  }

  if (actor.role === 'Manager') {
    return prisma.user.findMany({
      where:   { ...active, OR: [{ reportingToId: actor.id }, { id: actor.id }] },
      select,
      orderBy: { name: 'asc' },
    });
  }

  return [];
}

export interface VisibleContact {
  id: string;
  name: string;
  companyName: string | null;
  phone: string;
  type: string;
  preferredLanguage: string;
  optOutAt: Date | null;
  ownerId: string;
  /** Merged into the candidate list by `contactCandidates`, not used directly. */
  aliases: string[];
}

/**
 * Every external party `actor` is permitted to message.
 *
 * The contact-side counterpart of `assignableUsers`, and load-bearing for the
 * same reason: this list IS the permission boundary. Name resolution only ever
 * searches what this returns, so a sender cannot reach a contact outside their
 * scope by phrasing the request differently — that contact was never a
 * candidate.
 *
 *   Admin    → every live contact
 *   Manager  → only the contacts they own
 *   Employee → none. Employees do not message customers or vendors.
 *
 * Archived contacts are excluded for the same reason deactivated users are:
 * the row is kept for its history, but it is not somebody to message today.
 */
export async function visibleContacts(actor: Actor): Promise<VisibleContact[]> {
  const select = {
    id: true, name: true, companyName: true, phone: true, type: true,
    preferredLanguage: true, optOutAt: true, ownerId: true, aliases: true,
  } as const;

  const live = { archivedAt: null };

  if (actor.role === 'Admin') {
    return prisma.contact.findMany({ where: live, select, orderBy: { name: 'asc' } });
  }

  if (actor.role === 'Manager') {
    return prisma.contact.findMany({
      where: { ...live, ownerId: actor.id }, select, orderBy: { name: 'asc' },
    });
  }

  return [];
}

/**
 * May `actor` message `contactId`? Derived from the same set, never a separate
 * rule — the two must not be able to disagree.
 */
export async function canMessageContact(actor: Actor, contactId: string): Promise<boolean> {
  if (actor.role === 'Employee') return false;

  const contact = await prisma.contact.findUnique({
    where:  { id: contactId },
    select: { id: true, ownerId: true, archivedAt: true },
  });
  if (!contact || contact.archivedAt !== null) return false;

  return actor.role === 'Admin' || contact.ownerId === actor.id;
}

/** May `actor` assign work to `targetId`? Derived from the same set, never a separate rule. */
export async function canAssignTo(actor: Actor, targetId: string): Promise<boolean> {
  if (actor.role === 'Admin') {
    const target = await prisma.user.findUnique({
      where: { id: targetId }, select: { id: true, deactivatedAt: true },
    });
    return target !== null && target.deactivatedAt === null;
  }

  if (actor.role !== 'Manager') return false;

  const target = await prisma.user.findUnique({
    where:  { id: targetId },
    select: { id: true, reportingToId: true, deactivatedAt: true },
  });
  if (!target || target.deactivatedAt) return false;

  return target.reportingToId === actor.id || target.id === actor.id;
}

export interface TaskForAuth {
  id?: string;
  assignedToId: string;
  assignedById: string;
}

/**
 * May `actor` act on this task — reassign it, comment on it, change its
 * priority or deadline?
 *
 *   Admin    → any task
 *   Manager  → a task assigned to them, a task assigned to one of their direct
 *              reports, or a task they created
 *   Employee → only a task assigned to them
 *
 * "Assigned to them" matters and is easy to leave out: the whole delegation
 * scenario is a manager handing on a ticket they are personally holding, which
 * a reports-only check would refuse.
 */
export async function canManageTask(actor: Actor, task: TaskForAuth): Promise<boolean> {
  if (actor.role === 'Admin') return true;
  if (task.assignedToId === actor.id) return true;

  // Holding a shared task counts as it being yours. Without this, a co-assignee
  // could see the task but not comment on it or report against it.
  if (task.id) {
    const own = await prisma.taskAssignee.findFirst({
      where:  { taskId: task.id, userId: actor.id },
      select: { id: true },
    });
    if (own) return true;
  }

  if (actor.role !== 'Manager') return false;
  if (task.assignedById === actor.id) return true;

  // A manager may act on anything held by one of their reports — primary or
  // co-assignee, so a shared task doesn't fall out of their reach.
  const holderIds = task.id
    ? (await prisma.taskAssignee.findMany({
        where: { taskId: task.id }, select: { userId: true },
      })).map((a) => a.userId)
    : [];

  const reports = await prisma.user.findMany({
    where:  { id: { in: [...new Set([task.assignedToId, ...holderIds])] } },
    select: { reportingToId: true },
  });
  return reports.some((u) => u.reportingToId === actor.id);
}
