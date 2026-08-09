import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mocked before importing the controller so the module picks up the stubs.
// These are the only three boundaries that leave the process.
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
}));

vi.mock('../../src/services/mediaService', () => ({
  storeWhatsAppMedia:      vi.fn().mockResolvedValue('https://cdn.test/photo.jpg'),
  downloadWhatsAppMedia:   vi.fn().mockResolvedValue({ buffer: Buffer.from('x'), mimeType: 'audio/ogg' }),
  uploadBufferToCloudinary: vi.fn().mockResolvedValue('https://cdn.test/voice.ogg'),
}));

const transcribeAudio = vi.fn().mockResolvedValue('task 1060 completed');
vi.mock('../../src/services/transcriptionService', () => ({
  transcribeAudio: (...args: unknown[]) => transcribeAudio(...args),
}));

import { __test } from '../../src/controllers/webhookController';
import { sendInteractiveList, sendTextMessage } from '../../src/services/whatsappService';
import {
  IDS, PHONES, prisma, seedOrg,
  audioMessage, batchedMessages, imageMessage, listReply, statusUpdate, textMessage,
} from '../fixtures';

const { processInbound } = __test;

// No NVIDIA key in tests — intent resolution runs the deterministic keyword +
// regex path, so these assertions don't depend on a model's output.
delete process.env.NVIDIA_API_KEY;

beforeEach(async () => {
  vi.clearAllMocks();
  transcribeAudio.mockResolvedValue('task 1060 completed');
  await seedOrg();
});

afterAll(async () => { await prisma.$disconnect(); });

const messages = (where = {}) => prisma.message.findMany({ where, orderBy: { createdAt: 'asc' } });
const task = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });

describe('naming a task explicitly', () => {
  it('attributes the message and updates that task', async () => {
    await processInbound(textMessage(PHONES.worker, 'task 1060 done'));

    const [m] = await messages();
    expect(m.taskId).toBe('TSK-1060');
    expect(m.direction).toBe('inbound');
    expect(m.attributedBy).toBe('explicit_ref');
    expect(m.needsAttribution).toBe(false);
    expect((await task('TSK-1060')).status).toBe('Submitted');

    // The status change is audited on the task; the text lives on the message.
    const acts = await prisma.activity.findMany({ where: { taskId: 'TSK-1060' } });
    expect(acts).toHaveLength(1);
    expect(acts[0].type).toBe('status');
  });

  it('REGRESSION: does not touch the more recently updated TSK-1061', async () => {
    // Make TSK-1061 the newest, which is what the old code always picked.
    await prisma.task.update({ where: { id: 'TSK-1061' }, data: { title: 'touched' } });

    await processInbound(textMessage(PHONES.worker, 'Task 1060 completed and I clicked the picture also'));

    expect((await task('TSK-1060')).status).toBe('Submitted');
    expect((await task('TSK-1061')).status).toBe('Pending');
  });

  it.each([
    'Tsk 1060 done', 'task -1060 done', 'TSK1060 done', 'task number 1060 done',
  ])('understands the loose form %j', async (body) => {
    await processInbound(textMessage(PHONES.worker, body));
    expect((await messages())[0].taskId).toBe('TSK-1060');
  });
});

describe('ambiguity — the system asks instead of guessing', () => {
  it('records the message but changes nothing when several tasks are open', async () => {
    await processInbound(textMessage(PHONES.worker, 'done'));

    const [m] = await messages();
    expect(m.taskId).toBeNull();
    expect(m.needsAttribution).toBe(true);
    expect(m.intentAction).toBe('done');

    // Critically: no task was marked done.
    expect((await task('TSK-1060')).status).toBe('Pending');
    expect((await task('TSK-1061')).status).toBe('Pending');

    expect(sendInteractiveList).toHaveBeenCalledOnce();
    const rows = vi.mocked(sendInteractiveList).mock.calls[0][3][0].rows;
    expect(rows.map((r: { id: string }) => r.id).sort()).toEqual(['TSK-1060', 'TSK-1061']);
  });

  it('attributes without asking when only one task is open', async () => {
    await processInbound(textMessage(PHONES.solo, 'done'));

    const [m] = await messages();
    expect(m.taskId).toBe('TSK-2000');
    expect(m.attributedBy).toBe('single_open_task');
    expect((await task('TSK-2000')).status).toBe('Submitted');
    expect(sendInteractiveList).not.toHaveBeenCalled();
  });

  it('applies the parked outcome once the worker picks from the list', async () => {
    await processInbound(textMessage(PHONES.worker, 'done'));
    await processInbound(listReply(PHONES.worker, 'TSK-1061'));

    const all = await messages();
    expect(all[0].taskId).toBe('TSK-1061');        // the parked one, now resolved
    expect(all[0].needsAttribution).toBe(false);
    expect(all[1].attributedBy).toBe('list_reply');
    expect((await task('TSK-1061')).status).toBe('Submitted');
    expect((await task('TSK-1060')).status).toBe('Pending');
  });

  it('treats a new outcome as a new statement, not an answer', async () => {
    await processInbound(textMessage(PHONES.worker, 'done'));          // parked
    await processInbound(textMessage(PHONES.worker, 'task 1061 issue')); // different intent

    // The parked "done" must not be applied to TSK-1061.
    expect((await task('TSK-1061')).status).toBe('Issue');
    expect((await task('TSK-1060')).status).toBe('Pending');
  });

  it('does not flag chatter that asks for nothing', async () => {
    await processInbound(textMessage(PHONES.worker, 'ok thanks'));

    const [m] = await messages();
    expect(m.needsAttribution).toBe(false);
    expect(m.taskId).toBeNull();
    expect(sendInteractiveList).not.toHaveBeenCalled();
  });

  it('keeps a follow-up on the task still under discussion', async () => {
    // TSK-1060 stays open as Issue, so "still stuck" is about that task.
    await processInbound(textMessage(PHONES.worker, 'task 1060 has a problem'));
    await processInbound(textMessage(PHONES.worker, 'still stuck on it'));

    const all = await messages();
    expect(all[1].taskId).toBe('TSK-1060');
    expect(all[1].attributedBy).toBe('recent_context');
  });

  it('attaches a bare photo to the task just completed', async () => {
    // The photo carries no outcome, so it belongs to whatever was just
    // discussed — even though completing TSK-1060 left TSK-1061 as the only
    // open task.
    await processInbound(textMessage(PHONES.worker, 'task 1060 done'));
    await processInbound(imageMessage(PHONES.worker, ''));

    const all = await messages();
    expect(all[1].taskId).toBe('TSK-1060');
    expect(all[1].attributedBy).toBe('recent_context');
  });

  it('does not let a finished task swallow the next completion', async () => {
    // Worker clears both tasks back to back. The second "done" must land on
    // the remaining open task, not be absorbed by the one just closed.
    await processInbound(textMessage(PHONES.worker, 'task 1060 done'));
    await processInbound(textMessage(PHONES.worker, 'done'));

    expect((await task('TSK-1061')).status).toBe('Submitted');
    expect((await messages())[1].attributedBy).toBe('single_open_task');
  });
});

describe('someone else\'s task', () => {
  it('records the message, changes nothing, and says so', async () => {
    await processInbound(textMessage(PHONES.worker, 'TSK-3000 done'));

    const [m] = await messages();
    expect(m.taskId).toBeNull();
    expect(m.userId).toBe(IDS.worker);
    expect((await task('TSK-3000')).status).toBe('Pending');
    expect(sendTextMessage).toHaveBeenCalledOnce();
  });
});

describe('duplicate deliveries', () => {
  it('processes a repeated wamid exactly once', async () => {
    const payload = textMessage(PHONES.worker, 'task 1060 done');
    await processInbound(payload);
    await processInbound(payload);           // Meta retries

    expect(await messages()).toHaveLength(1);
    const acts = await prisma.activity.findMany({ where: { taskId: 'TSK-1060', type: 'status' } });
    expect(acts).toHaveLength(1);            // status flipped once, not twice
  });

  it('skips re-transcribing a retried voice note', async () => {
    const payload = audioMessage(PHONES.worker);
    await processInbound(payload);
    expect(transcribeAudio).toHaveBeenCalledOnce();

    await processInbound(payload);
    // Dedupe runs BEFORE download+transcription, which is the expensive path.
    expect(transcribeAudio).toHaveBeenCalledOnce();
  });
});

describe('media', () => {
  it('stores a voice note with its transcript and routes on it', async () => {
    await processInbound(audioMessage(PHONES.worker));

    const [m] = await messages();
    expect(m.kind).toBe('voice');
    expect(m.transcription).toBe('task 1060 completed');
    expect(m.mediaUrl).toBe('https://cdn.test/voice.ogg');
    expect(m.taskId).toBe('TSK-1060');       // resolved from the transcript
  });

  it('notes the attachment on the submission but does not approve it', async () => {
    await processInbound(imageMessage(PHONES.worker, 'task 1060 photo'));
    await processInbound(textMessage(PHONES.worker, 'task 1060 done'));

    const t = await task('TSK-1060');
    expect(t.status).toBe('Submitted');
    // A photo is evidence for the reviewer to weigh, not a substitute for them.
    expect(t.approved).toBe(false);

    const audit = await prisma.activity.findFirstOrThrow({
      where: { taskId: 'TSK-1060', type: 'status' },
    });
    expect(audit.text).toContain('attachment');
  });

  it('adopts an unattributed photo sent moments before the completion', async () => {
    // Photo with no task reference — stays unattributed on arrival…
    await processInbound(imageMessage(PHONES.worker, ''));
    expect((await messages())[0].taskId).toBeNull();

    // …then gets linked when the worker names the task, so the reviewer sees
    // it alongside the submission.
    await processInbound(textMessage(PHONES.worker, 'task 1060 done'));

    expect((await messages())[0].taskId).toBe('TSK-1060');
  });

  it('does not treat a voice note as photographic evidence', async () => {
    await processInbound(audioMessage(PHONES.worker));

    const t = await task('TSK-1060');
    expect(t.status).toBe('Submitted');

    const audit = await prisma.activity.findFirstOrThrow({
      where: { taskId: 'TSK-1060', type: 'status' },
    });
    expect(audit.text).not.toContain('attachment');   // audio is a claim, not proof
  });
});

describe('the approval gate', () => {
  it('never lets a WhatsApp message alone mark a task Done', async () => {
    // The whole point: "done" from a worker is a submission. Only a reviewer
    // moves a task to Done, and that happens through the API, not here.
    await processInbound(textMessage(PHONES.worker, 'task 1060 done'));
    await processInbound(textMessage(PHONES.worker, 'task 1060 done again'));
    await processInbound(imageMessage(PHONES.worker, 'task 1060 proof'));

    const t = await task('TSK-1060');
    expect(t.status).toBe('Submitted');
    expect(t.approved).toBe(false);
  });

  it('leaves a submitted task out of the "which task?" options', async () => {
    // Submitted work is with the reviewer, so a later bare "done" belongs to
    // the task still in the worker's hands — no ambiguity, no question asked.
    await processInbound(textMessage(PHONES.worker, 'task 1060 done'));
    await processInbound(textMessage(PHONES.worker, 'done'));

    expect((await task('TSK-1061')).status).toBe('Submitted');
    expect(sendInteractiveList).not.toHaveBeenCalled();
  });
});

describe('repeat outcomes', () => {
  it('records the message without rewriting an unchanged status', async () => {
    await processInbound(textMessage(PHONES.worker, 'task 1060 done'));
    await processInbound(textMessage(PHONES.worker, 'task 1060 done again'));

    expect(await messages()).toHaveLength(2);
    const acts = await prisma.activity.findMany({ where: { taskId: 'TSK-1060', type: 'status' } });
    expect(acts).toHaveLength(1);   // one status change, so one notification
  });
});

describe('batched deliveries', () => {
  it('processes every message, not just the first', async () => {
    await processInbound(batchedMessages(PHONES.worker, ['task 1060 done', 'task 1061 issue']));

    expect(await messages()).toHaveLength(2);
    expect((await task('TSK-1060')).status).toBe('Submitted');
    expect((await task('TSK-1061')).status).toBe('Issue');
  });
});

describe('progress reports', () => {
  it('moves a named task to In Progress', async () => {
    await processInbound(textMessage(PHONES.worker, '1060 in progress, will complete soon'));

    expect((await task('TSK-1060')).status).toBe('InProgress');
    expect((await messages())[0].taskId).toBe('TSK-1060');
  });

  it('does not read "will complete soon" as a completion', async () => {
    await processInbound(textMessage(PHONES.worker, 'task 1060 in progress, will complete soon'));
    // A promise to finish is not a finish — closing the task here would be
    // exactly wrong, and it's the phrasing people actually use.
    expect((await task('TSK-1060')).status).not.toBe('Done');
  });

  it('asks which task rather than guessing, same as any other outcome', async () => {
    await processInbound(textMessage(PHONES.worker, 'in progress'));

    expect((await messages())[0].needsAttribution).toBe(true);
    expect((await task('TSK-1060')).status).toBe('Pending');
    expect((await task('TSK-1061')).status).toBe('Pending');
  });
});

describe('delivery receipts', () => {
  const WAMID = 'wamid.OUTBOUND1';

  async function outbound(status = 'sent' as const) {
    return prisma.message.create({
      data: {
        userId: IDS.worker, senderId: IDS.manager, direction: 'outbound',
        kind: 'text', text: 'ping', waMessageId: WAMID, deliveryStatus: status,
      },
    });
  }

  it('advances sent → delivered → read', async () => {
    await outbound();
    await processInbound(statusUpdate(WAMID, 'delivered'));
    expect((await prisma.message.findFirstOrThrow()).deliveryStatus).toBe('delivered');

    await processInbound(statusUpdate(WAMID, 'read'));
    expect((await prisma.message.findFirstOrThrow()).deliveryStatus).toBe('read');
  });

  it('never moves backwards when receipts arrive out of order', async () => {
    await outbound();
    await processInbound(statusUpdate(WAMID, 'read'));
    // Meta can deliver these out of order; a late "delivered" must not turn a
    // blue double tick back to grey.
    await processInbound(statusUpdate(WAMID, 'delivered'));
    await processInbound(statusUpdate(WAMID, 'sent'));

    expect((await prisma.message.findFirstOrThrow()).deliveryStatus).toBe('read');
  });

  it('records a failure reason', async () => {
    await outbound();
    await processInbound(statusUpdate(WAMID, 'failed'));

    const m = await prisma.message.findFirstOrThrow();
    expect(m.deliveryStatus).toBe('failed');
    expect(m.deliveryError).toBe('Message undeliverable');
  });

  it('ignores a receipt for a message we never sent', async () => {
    await processInbound(statusUpdate('wamid.UNKNOWN', 'read'));
    expect(await messages()).toHaveLength(0);
  });

  it('does not treat a status-only payload as an inbound message', async () => {
    await outbound();
    await processInbound(statusUpdate(WAMID, 'read'));
    // One row — the outbound one. A receipt must never create a message.
    expect(await messages()).toHaveLength(1);
  });
});

describe('unknown senders', () => {
  it('ignores a phone number that matches nobody', async () => {
    await processInbound(textMessage('919999999999', 'task 1060 done'));

    expect(await messages()).toHaveLength(0);
    expect((await task('TSK-1060')).status).toBe('Pending');
  });
});
