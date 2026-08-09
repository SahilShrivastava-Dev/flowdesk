import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../src/services/whatsappService', () => ({
  sendInteractiveList: vi.fn().mockResolvedValue(undefined),
  sendTextMessage:     vi.fn().mockResolvedValue({ ok: true }),
  // Without these, creating a task makes a real network call to Meta and
  // the suite hangs until it times out.
  sendTaskAssignmentNotification: vi.fn().mockResolvedValue({ ok: true }),
  sendEscalationNotification:     vi.fn().mockResolvedValue({ ok: true }),
  sendTaskReassignedNotification:  vi.fn().mockResolvedValue({ ok: true }),
  sendDeadlineReminderNotification: vi.fn().mockResolvedValue({ ok: true }),
  sendSupervisorEscalationNotification: vi.fn().mockResolvedValue({ ok: true }),
  sendUpdateWaitingNotification:   vi.fn().mockResolvedValue({ ok: true }),
  sendWhatsAppLocalized:          vi.fn().mockResolvedValue({ ok: true }),
  verifyTokenOnStartup: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/workers/scheduler', () => ({ startScheduler: vi.fn() }));

import app from '../../src/index';
import { sendTextMessage } from '../../src/services/whatsappService';
import { IDS, PHONES, prisma, seedOrg } from '../fixtures';

const SECRET = process.env.JWT_SECRET ?? 'dev-secret';
const tokenFor = (userId: string, role: string) =>
  jwt.sign({ userId, role }, SECRET, { expiresIn: '1h' });

const asAdmin   = () => tokenFor(IDS.admin, 'Admin');
const asManager = () => tokenFor(IDS.manager, 'Manager');
const asWorker  = () => tokenFor(IDS.worker, 'Employee');

beforeEach(async () => {
  vi.clearAllMocks();
  await seedOrg();
});
afterAll(async () => { await prisma.$disconnect(); });

async function seedMessages(count: number, userId = IDS.worker) {
  const base = Date.now() - count * 60_000;
  for (let i = 0; i < count; i++) {
    await prisma.message.create({
      data: {
        userId, senderId: userId, direction: 'inbound', kind: 'text',
        text: `message ${i}`, createdAt: new Date(base + i * 60_000),
      },
    });
  }
}

describe('GET /api/conversations — role scoping', () => {
  it('shows an Admin everyone reachable, including people never messaged', async () => {
    const res = await request(app).get('/api/conversations')
      .set('Authorization', `Bearer ${asAdmin()}`).expect(200);

    const ids = res.body.map((c: { userId: string }) => c.userId).sort();
    // Only the three seeded users with a phone number. The admin and manager
    // have none, so there is no WhatsApp conversation to have with them.
    expect(ids).toEqual([IDS.other, IDS.solo, IDS.worker].sort());
    // A brand-new hire must be reachable, so zero-message rows are included.
    expect(res.body.every((c: { lastMessage: unknown }) => c.lastMessage === null)).toBe(true);
  });

  it('never lists a conversation with yourself', async () => {
    await prisma.user.update({ where: { id: IDS.admin }, data: { phone: '919000000009' } });

    const res = await request(app).get('/api/conversations')
      .set('Authorization', `Bearer ${asAdmin()}`).expect(200);

    // Even with a phone number of their own, the admin shouldn't see a thread
    // with themselves — that was the stray "TDM Admin · No messages yet" row.
    expect(res.body.map((c: { userId: string }) => c.userId)).not.toContain(IDS.admin);
  });

  it('excludes people with no phone number', async () => {
    const res = await request(app).get('/api/conversations')
      .set('Authorization', `Bearer ${asAdmin()}`).expect(200);

    expect(res.body.every((c: { hasPhone: boolean }) => c.hasPhone)).toBe(true);
  });

  it('limits a Manager to their direct reports', async () => {
    const res = await request(app).get('/api/conversations')
      .set('Authorization', `Bearer ${asManager()}`).expect(200);

    const ids = res.body.map((c: { userId: string }) => c.userId).sort();
    expect(ids).toEqual([IDS.solo, IDS.worker].sort());
    expect(ids).not.toContain(IDS.other);    // not their report
    expect(ids).not.toContain(IDS.manager);  // themselves
  });

  it('limits an Employee to their own conversation', async () => {
    const res = await request(app).get('/api/conversations')
      .set('Authorization', `Bearer ${asWorker()}`).expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].userId).toBe(IDS.worker);
  });

  it('surfaces open, overdue and needs-attribution counts', async () => {
    await prisma.message.create({
      data: { userId: IDS.worker, senderId: IDS.worker, direction: 'inbound',
              kind: 'text', text: 'done', needsAttribution: true },
    });
    await prisma.task.update({
      where: { id: 'TSK-1060' },
      data: { deadline: new Date(Date.now() - 86_400_000) },
    });

    const res = await request(app).get('/api/conversations')
      .set('Authorization', `Bearer ${asAdmin()}`).expect(200);

    const worker = res.body.find((c: { userId: string }) => c.userId === IDS.worker);
    expect(worker.openTaskCount).toBe(2);          // TSK-1060, TSK-1061
    expect(worker.overdueCount).toBe(1);
    expect(worker.needsAttributionCount).toBe(1);
  });
});

describe('GET /api/conversations/:userId/messages', () => {
  it('refuses a Manager access to someone outside their reporting line', async () => {
    await request(app).get(`/api/conversations/${IDS.other}/messages`)
      .set('Authorization', `Bearer ${asManager()}`).expect(403);
  });

  it('returns the thread oldest-first with the person\'s tasks', async () => {
    await seedMessages(3);
    const res = await request(app).get(`/api/conversations/${IDS.worker}/messages`)
      .set('Authorization', `Bearer ${asAdmin()}`).expect(200);

    expect(res.body.messages.map((m: { text: string }) => m.text))
      .toEqual(['message 0', 'message 1', 'message 2']);
    // Tasks ride along so the re-attribution menu needs no second request.
    expect(res.body.tasks.map((t: { id: string }) => t.id).sort())
      .toEqual(['TSK-1059', 'TSK-1060', 'TSK-1061']);
  });

  it('paginates without gaps or duplicates', async () => {
    await seedMessages(120);

    const seen: string[] = [];
    let before: string | null = null;
    for (let page = 0; page < 3; page++) {
      const qs: string = `limit=50${before ? `&before=${before}` : ''}`;
      const res = await request(app)
        .get(`/api/conversations/${IDS.worker}/messages?${qs}`)
        .set('Authorization', `Bearer ${asAdmin()}`).expect(200);

      seen.push(...res.body.messages.map((m: { id: string }) => m.id));
      before = res.body.nextBefore;
      expect(res.body.hasMore).toBe(page < 2);
    }

    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);   // no duplicates
  });
});

describe('PATCH /api/conversations/messages/:id — correcting attribution', () => {
  async function messageOn(taskId: string | null) {
    return prisma.message.create({
      data: { userId: IDS.worker, senderId: IDS.worker, direction: 'inbound',
              kind: 'text', text: 'done', taskId, needsAttribution: taskId === null },
    });
  }

  it('moves the message and audits both tasks', async () => {
    await prisma.task.update({ where: { id: 'TSK-1060' }, data: { status: 'Done' } });
    const msg = await messageOn('TSK-1060');

    const res = await request(app).patch(`/api/conversations/messages/${msg.id}`)
      .set('Authorization', `Bearer ${asAdmin()}`)
      .send({ taskId: 'TSK-1061' }).expect(200);

    expect(res.body.message.taskId).toBe('TSK-1061');
    expect(res.body.message.attributedBy).toBe('manual');

    const audits = await prisma.activity.findMany({ where: { type: 'attribution' } });
    expect(audits.map((a) => a.taskId).sort()).toEqual(['TSK-1060', 'TSK-1061']);

    // The old task is still Done because of this message — offer the undo
    // rather than silently reverting someone's status change.
    expect(res.body.revertHint).toMatchObject({ taskId: 'TSK-1060', suggestedStatus: 'Pending' });
  });

  it('clears the needs-attribution flag', async () => {
    const msg = await messageOn(null);
    const res = await request(app).patch(`/api/conversations/messages/${msg.id}`)
      .set('Authorization', `Bearer ${asAdmin()}`)
      .send({ taskId: 'TSK-1060' }).expect(200);

    expect(res.body.message.needsAttribution).toBe(false);
  });

  it('rejects a task belonging to someone else', async () => {
    const msg = await messageOn(null);
    await request(app).patch(`/api/conversations/messages/${msg.id}`)
      .set('Authorization', `Bearer ${asAdmin()}`)
      .send({ taskId: 'TSK-3000' }).expect(400);
  });

  it('refuses an Employee', async () => {
    const msg = await messageOn(null);
    await request(app).patch(`/api/conversations/messages/${msg.id}`)
      .set('Authorization', `Bearer ${asWorker()}`)
      .send({ taskId: 'TSK-1060' }).expect(403);
  });
});

describe('POST /api/whatsapp/send', () => {
  it('sends free text while the session is open', async () => {
    await prisma.message.create({
      data: { userId: IDS.worker, senderId: IDS.worker, direction: 'inbound', kind: 'text', text: 'hi' },
    });

    const res = await request(app).post('/api/whatsapp/send')
      .set('Authorization', `Bearer ${asAdmin()}`)
      .send({ userId: IDS.worker, message: 'How is it going?' }).expect(200);

    expect(res.body.mode).toBe('free_text');
    expect(res.body.message.deliveryStatus).toBe('sent');
    expect(res.body.message.taskId).toBeNull();   // not every message is about a task
    expect(sendTextMessage).toHaveBeenCalledOnce();
  });

  it('falls back to a template once the window has closed', async () => {
    await prisma.message.create({
      data: { userId: IDS.worker, senderId: IDS.worker, direction: 'inbound', kind: 'text',
              text: 'hi', createdAt: new Date(Date.now() - 25 * 3600_000) },
    });

    const res = await request(app).post('/api/whatsapp/send')
      .set('Authorization', `Bearer ${asAdmin()}`)
      .send({ userId: IDS.worker, message: 'ping' }).expect(200);

    expect(res.body.mode).toBe('template_fallback');
    expect(res.body.message.kind).toBe('system');
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('reports a failed send instead of a false delivered tick', async () => {
    await prisma.message.create({
      data: { userId: IDS.worker, senderId: IDS.worker, direction: 'inbound', kind: 'text', text: 'hi' },
    });
    vi.mocked(sendTextMessage).mockResolvedValueOnce({ ok: false, error: 'token expired' });

    const res = await request(app).post('/api/whatsapp/send')
      .set('Authorization', `Bearer ${asAdmin()}`)
      .send({ userId: IDS.worker, message: 'ping' }).expect(502);

    expect(res.body.ok).toBe(false);
    expect(res.body.message.deliveryStatus).toBe('failed');
  });

  it('stops a Manager messaging outside their reporting line', async () => {
    await request(app).post('/api/whatsapp/send')
      .set('Authorization', `Bearer ${asManager()}`)
      .send({ userId: IDS.other, message: 'hello' }).expect(403);
  });

  it('rejects a task that is not the recipient\'s', async () => {
    await request(app).post('/api/whatsapp/send')
      .set('Authorization', `Bearer ${asAdmin()}`)
      .send({ userId: IDS.worker, taskId: 'TSK-3000', message: 'hi' }).expect(400);
  });
});
