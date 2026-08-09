import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/whatsappService', () => ({
  sendInteractiveList: vi.fn().mockResolvedValue(undefined),
  sendInteractiveButtons: vi.fn().mockResolvedValue(undefined),
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

vi.mock('../../src/services/mediaService', () => ({
  storeWhatsAppMedia:       vi.fn().mockResolvedValue('https://cdn.test/photo.jpg'),
  downloadWhatsAppMedia:    vi.fn().mockResolvedValue({ buffer: Buffer.from('x'), mimeType: 'audio/ogg' }),
  uploadBufferToCloudinary: vi.fn().mockResolvedValue('https://cdn.test/voice.ogg'),
}));

vi.mock('../../src/services/transcriptionService', () => ({
  transcribeAudio: vi.fn().mockResolvedValue(''),
}));

import { __test } from '../../src/controllers/webhookController';
import { rollUpStatus } from '../../src/services/taskService';
import {
  CMD, CMD_PHONES, createTask, prisma, seedCommandOrg, textMessage,
} from '../fixtures';

const { processInbound } = __test;

delete process.env.NVIDIA_API_KEY;
process.env.WA_COMMANDS_ENABLED = 'false';   // worker pipeline only, here

const task     = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
const holder   = (taskId: string, userId: string) =>
  prisma.taskAssignee.findUniqueOrThrow({ where: { taskId_userId: { taskId, userId } } });

beforeEach(async () => {
  vi.clearAllMocks();
  await seedCommandOrg();

  // One task, two holders — Vedant and Vikranth Sharma work on it together.
  await createTask({
    id: 'TSK-2001', title: 'Stock verification',
    assignedToId: CMD.vedant, assignedById: CMD.sahil,
    deadline: new Date(Date.now() + 86_400_000),
    coAssigneeIds: [CMD.vikranthS],
  });
});

afterAll(async () => { await prisma.$disconnect(); });

describe('rollUpStatus', () => {
  it('needs everyone before it counts as submitted', () => {
    expect(rollUpStatus(['Submitted', 'Pending'])).toBe('InProgress');
    expect(rollUpStatus(['Submitted', 'Submitted'])).toBe('Submitted');
  });

  it('lets a blocker on one side block the task', () => {
    // Half-finished work with a problem on the other half is not progress.
    expect(rollUpStatus(['Submitted', 'Issue'])).toBe('Issue');
    expect(rollUpStatus(['InProgress', 'Delay'])).toBe('Delay');
  });

  it('is unchanged for a sole holder', () => {
    expect(rollUpStatus(['Submitted'])).toBe('Submitted');
    expect(rollUpStatus(['Pending'])).toBe('Pending');
    expect(rollUpStatus(['InProgress'])).toBe('InProgress');
  });

  it('treats an approved part as submitted', () => {
    expect(rollUpStatus(['Done', 'Submitted'])).toBe('Submitted');
  });
});

describe('a shared task', () => {
  it('does NOT complete for both when one person says done', async () => {
    // The whole point of the join table. Before it, Vedant saying "done" closed
    // Vikranth's work too and left no record of who actually did what.
    await processInbound(textMessage(CMD_PHONES.vedant, 'task 2001 done'));

    expect((await holder('TSK-2001', CMD.vedant)).status).toBe('Submitted');
    expect((await holder('TSK-2001', CMD.vikranthS)).status).toBe('Pending');
    expect((await task('TSK-2001')).status).toBe('InProgress');
  });

  it('submits once the second person reports too', async () => {
    await processInbound(textMessage(CMD_PHONES.vedant, 'task 2001 done'));
    await processInbound(textMessage(CMD_PHONES.vikranthS, 'task 2001 done'));

    expect((await task('TSK-2001')).status).toBe('Submitted');
    expect((await holder('TSK-2001', CMD.vikranthS)).status).toBe('Submitted');
  });

  it('records who is still outstanding on the audit line', async () => {
    await processInbound(textMessage(CMD_PHONES.vedant, 'task 2001 done'));

    const audit = await prisma.activity.findFirstOrThrow({
      where: { taskId: 'TSK-2001', type: 'status' },
    });
    expect(audit.text).toContain('waiting on Vikranth Sharma');
    // Attributed to whoever reported it, not to the primary assignee.
    expect(audit.byId).toBe(CMD.vedant);
    expect(audit.channel).toBe('whatsapp');
  });

  it('lets one person report a blocker for the whole task', async () => {
    await processInbound(textMessage(CMD_PHONES.vikranthS, 'task 2001 has a problem'));

    expect((await task('TSK-2001')).status).toBe('Issue');
    expect((await holder('TSK-2001', CMD.vedant)).status).toBe('Pending');
  });

  it('is visible to a co-assignee over WhatsApp', async () => {
    // Vikranth is not the primary. A bare "done" must still find this task —
    // with a primary-only lookup it would not be a candidate at all.
    await processInbound(textMessage(CMD_PHONES.vikranthS, 'done'));

    const msg = await prisma.message.findFirstOrThrow({
      where: { userId: CMD.vikranthS, direction: 'inbound' },
    });
    expect(msg.taskId).toBe('TSK-2001');
  });
});

describe('a sole task behaves exactly as before', () => {
  it('submits on the holder\'s first "done"', async () => {
    await processInbound(textMessage(CMD_PHONES.vedant, 'task 1060 done'));

    expect((await task('TSK-1060')).status).toBe('Submitted');
    expect((await holder('TSK-1060', CMD.vedant)).status).toBe('Submitted');
  });
});
