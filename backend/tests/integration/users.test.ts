import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/whatsappService', () => ({
  sendInteractiveList: vi.fn().mockResolvedValue(undefined),
  sendTextMessage:     vi.fn().mockResolvedValue({ ok: true }),
  sendTaskAssignmentNotification: vi.fn().mockResolvedValue({ ok: true }),
  sendEscalationNotification:     vi.fn().mockResolvedValue({ ok: true }),
  sendTaskReassignedNotification:  vi.fn().mockResolvedValue({ ok: true }),
  sendDeadlineReminderNotification: vi.fn().mockResolvedValue({ ok: true }),
  sendSupervisorEscalationNotification: vi.fn().mockResolvedValue({ ok: true }),
  sendUpdateWaitingNotification:   vi.fn().mockResolvedValue({ ok: true }),
  sendWhatsAppLocalized:          vi.fn().mockResolvedValue({ ok: true }),
  normalisePhone: (s: string) => String(s ?? '').replace(/\D/g, ''),
}));

import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../../src/index';
import { CMD, prisma, seedCommandOrg } from '../fixtures';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';

const tokenFor = (userId: string, role: string) =>
  jwt.sign({ userId, role }, process.env.JWT_SECRET!, { expiresIn: '1h' });

const asAdmin = () => tokenFor(CMD.admin, 'Admin');

beforeEach(async () => { await seedCommandOrg(); });
afterAll(async () => { await prisma.$disconnect(); });

describe('DELETE /api/users/:id', () => {
  it('refuses a member who still has tasks, and says what is blocking', async () => {
    // THE CRASH: this used to hand the delete to Postgres, hit a RESTRICT
    // foreign key, and — because Express 4 does not catch async rejections —
    // terminate the process. One Admin click restarted the API for everyone.
    const res = await request(app)
      .delete(`/api/users/${CMD.vedant}`)
      .set('Authorization', `Bearer ${asAdmin()}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Vedant Kulkarni');
    expect(res.body.error).toContain('still assigned to them');
    expect(res.body.blockers.assignedTasks).toBeGreaterThan(0);

    // Still there.
    expect(await prisma.user.findUnique({ where: { id: CMD.vedant } })).not.toBeNull();
  });

  it('names direct reports as a blocker too', async () => {
    const res = await request(app)
      .delete(`/api/users/${CMD.sahil}`)
      .set('Authorization', `Bearer ${asAdmin()}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('report to them');
    expect(res.body.blockers.reports).toBe(6);
  });

  it('deactivates a member who has history but nothing outstanding', async () => {
    // Vikranth Rao holds no tasks, manages nobody, but HAS written history.
    await prisma.activity.create({
      data: { taskId: 'TSK-1060', byId: CMD.vikranthR, type: 'comment', text: 'looked at this' },
    });

    const res = await request(app)
      .delete(`/api/users/${CMD.vikranthR}`)
      .set('Authorization', `Bearer ${asAdmin()}`);

    expect(res.status).toBe(200);
    expect(res.body.deactivated).toBe(true);

    // Still there — the audit trail depends on it — but marked as gone.
    const still = await prisma.user.findUnique({ where: { id: CMD.vikranthR } });
    expect(still?.deactivatedAt).not.toBeNull();

    // And the activity they wrote survives.
    expect(await prisma.activity.count({ where: { byId: CMD.vikranthR } })).toBe(1);
  });

  it('hides a deactivated member from the team list', async () => {
    await prisma.user.update({ where: { id: CMD.vikranthR }, data: { deactivatedAt: new Date() } });

    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${asAdmin()}`);
    expect(res.body.map((u: { id: string }) => u.id)).not.toContain(CMD.vikranthR);

    // Still reachable when explicitly asked for, for history views.
    const all = await request(app)
      .get('/api/users?includeInactive=true')
      .set('Authorization', `Bearer ${asAdmin()}`);
    expect(all.body.map((u: { id: string }) => u.id)).toContain(CMD.vikranthR);
  });

  it('still refuses while they hold work or manage people', async () => {
    const res = await request(app)
      .delete(`/api/users/${CMD.vedant}`)
      .set('Authorization', `Bearer ${asAdmin()}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('still assigned to them');
  });

  it('hard-deletes a member with no footprint at all', async () => {
    const spare = await prisma.user.create({
      data: {
        id: 'U900', name: 'Spare Person', email: 'spare@test.io',
        passwordHash: 'x', role: 'Employee', reportingToId: CMD.sahil,
      },
    });

    const res = await request(app)
      .delete(`/api/users/${spare.id}`)
      .set('Authorization', `Bearer ${asAdmin()}`);

    expect(res.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: spare.id } })).toBeNull();
  });

  it('will not let someone delete themselves', async () => {
    const res = await request(app)
      .delete(`/api/users/${CMD.admin}`)
      .set('Authorization', `Bearer ${asAdmin()}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('your own account');
  });

  it('404s on a member that does not exist', async () => {
    const res = await request(app)
      .delete('/api/users/U999')
      .set('Authorization', `Bearer ${asAdmin()}`);

    expect(res.status).toBe(404);
  });

  it('stays Admin-only', async () => {
    const res = await request(app)
      .delete(`/api/users/${CMD.vedant}`)
      .set('Authorization', `Bearer ${tokenFor(CMD.sahil, 'Manager')}`);

    expect(res.status).toBe(403);
  });
});

/**
 * These five endpoints checked only that the caller wasn't an Employee, so any
 * Manager could approve, reject, retract, escalate or rewrite ANY task in the
 * database — including one belonging to a different manager's team.
 *
 * TSK-1070 belongs to the rival manager's report, so Sahil must not touch it.
 */
describe('a manager cannot act on another team\'s task', () => {
  const asSahil = () => tokenFor(CMD.sahil, 'Manager');

  it.each([
    ['approve',  (t: string) => request(app).post(`/api/tasks/${t}/approve`)],
    ['reject',   (t: string) => request(app).post(`/api/tasks/${t}/reject`)],
    ['retract',  (t: string) => request(app).post(`/api/tasks/${t}/retract`)],
    ['escalate', (t: string) => request(app).post(`/api/tasks/${t}/escalate`)],
    ['reassign', (t: string) => request(app).post(`/api/tasks/${t}/reassign`).send({ newAssigneeId: CMD.vedant })],
  ])('refuses to %s it', async (_name, call) => {
    const res = await call('TSK-1070').set('Authorization', `Bearer ${asSahil()}`);
    expect(res.status).toBe(403);
  });

  it('refuses to edit its fields', async () => {
    const res = await request(app)
      .patch('/api/tasks/TSK-1070')
      .set('Authorization', `Bearer ${asSahil()}`)
      .send({ title: 'hijacked' });

    expect(res.status).toBe(403);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: 'TSK-1070' } })).title)
      .toBe('Not yours');
  });

  it('still allows the manager to act on their own team\'s task', async () => {
    const res = await request(app)
      .patch('/api/tasks/TSK-1060')
      .set('Authorization', `Bearer ${asSahil()}`)
      .send({ title: 'Photograph site — revised' });

    expect(res.status).toBe(200);
  });
});

describe('the process survives a failing request', () => {
  it('returns a status instead of dropping the connection', async () => {
    // The real regression guard: whatever happens, a bad request must produce
    // an HTTP response. Before errorHandler existed, this test would not have
    // failed — the worker process would have died mid-run.
    const res = await request(app)
      .delete(`/api/users/${CMD.vedant}`)
      .set('Authorization', `Bearer ${asAdmin()}`);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body).toHaveProperty('error');

    // And the app still serves the next request.
    const after = await request(app).get('/api/health');
    expect(after.status).toBe(200);
    expect(after.body.ok).toBe(true);
  });

  it('turns a duplicate email into a 409 rather than a crash', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${asAdmin()}`)
      .send({ name: 'Clash', email: 'vk@test.io', password: 'password123' });

    expect(res.status).toBe(409);
    expect((await request(app).get('/api/health')).status).toBe(200);
  });
});
