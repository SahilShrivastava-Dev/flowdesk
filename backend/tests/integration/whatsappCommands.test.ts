import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The same three boundaries webhook.test.ts stubs — the only things that leave
// the process.
vi.mock('../../src/services/whatsappService', () => ({
  sendInteractiveList:    vi.fn().mockResolvedValue(undefined),
  sendInteractiveButtons: vi.fn().mockResolvedValue(undefined),
  sendTextMessage:     vi.fn().mockResolvedValue({ ok: true, waMessageId: 'wamid.OUT' }),
  sendTaskAssignmentNotification: vi.fn().mockResolvedValue({ ok: true, waMessageId: 'wamid.TPL' }),
  sendEscalationNotification:     vi.fn().mockResolvedValue({ ok: true }),
  sendTaskReassignedNotification:  vi.fn().mockResolvedValue({ ok: true }),
  sendDeadlineReminderNotification: vi.fn().mockResolvedValue({ ok: true }),
  sendSupervisorEscalationNotification: vi.fn().mockResolvedValue({ ok: true }),
  sendUpdateWaitingNotification:   vi.fn().mockResolvedValue({ ok: true }),
  sendWhatsAppLocalized:          vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../../src/services/mediaService', () => ({
  storeWhatsAppMedia:       vi.fn().mockResolvedValue('https://cdn.test/photo.jpg'),
  downloadWhatsAppMedia:    vi.fn().mockResolvedValue({ buffer: Buffer.from('x'), mimeType: 'audio/ogg' }),
  uploadBufferToCloudinary: vi.fn().mockResolvedValue('https://cdn.test/voice.ogg'),
}));

const transcribeAudio = vi.fn();
vi.mock('../../src/services/transcriptionService', () => ({
  transcribeAudio: (...args: unknown[]) => transcribeAudio(...args),
}));

import { __test } from '../../src/controllers/webhookController';
import { sendTextMessage } from '../../src/services/whatsappService';
import { __resetRateLimits } from '../../src/lib/rateLimit';
import {
  CMD, CMD_PHONES, prisma, seedCommandOrg, audioMessage, textMessage,
} from '../fixtures';

const { processInbound } = __test;

// No NVIDIA key: the deterministic rule parser runs, so nothing here depends on
// a model's output.
delete process.env.NVIDIA_API_KEY;
process.env.WA_COMMANDS_ENABLED = 'true';

beforeEach(async () => {
  vi.clearAllMocks();
  __resetRateLimits();
  process.env.WA_COMMANDS_ENABLED = 'true';
  process.env.WA_STATE_TTL_S = '600';
  transcribeAudio.mockResolvedValue('allocate task 1059 to Vedant');
  await seedCommandOrg();
});

afterAll(async () => { await prisma.$disconnect(); });

const task     = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
const commands = () => prisma.whatsAppCommand.findMany({ orderBy: { createdAt: 'asc' } });
const state    = (userId: string) => prisma.conversationState.findUnique({ where: { userId } });

/** Everything we sent back to the manager, concatenated. */
function repliesTo(phone: string): string {
  return vi.mocked(sendTextMessage).mock.calls
    .filter((c) => c[0] === phone)
    .map((c) => c[1])
    .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────

describe('the scenario from the spec', () => {
  it('reassigns TSK-1059 from Sahil to a direct report', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Allocate task TSK-1059 to Vedant'));

    expect((await task('TSK-1059')).assignedToId).toBe(CMD.vedant);
  });

  it('records the change on the task history as a WhatsApp action', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Allocate task TSK-1059 to Vedant'));

    const activity = await prisma.activity.findFirstOrThrow({
      where: { taskId: 'TSK-1059', type: 'reassign' },
    });
    expect(activity.channel).toBe('whatsapp');
    expect(activity.byId).toBe(CMD.sahil);
    // The previous owner is named, not overwritten — the history has to still
    // show the task was Sahil's.
    expect(activity.text).toContain('Sahil Mehta');
    expect(activity.text).toContain('Vedant Kulkarni');
  });

  it('writes a full audit row', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Allocate task TSK-1059 to Vedant'));

    const [cmd] = await commands();
    expect(cmd.status).toBe('executed');
    expect(cmd.senderId).toBe(CMD.sahil);
    expect(cmd.intent).toBe('reassign_ticket');
    expect(cmd.taskId).toBe('TSK-1059');
    expect(cmd.previousAssigneeId).toBe(CMD.sahil);
    expect(cmd.newAssigneeId).toBe(CMD.vedant);
    expect(cmd.channel).toBe('whatsapp');
    expect(cmd.rawText).toBe('Allocate task TSK-1059 to Vedant');
    expect(cmd.senderPhoneLast4).toBe('0010');
    // Linked back to the message that carried it.
    expect(cmd.messageId).not.toBeNull();
  });

  it('confirms to the sender and notifies the new assignee', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Allocate task TSK-1059 to Vedant'));

    expect(repliesTo(CMD_PHONES.sahil)).toContain('TSK-1059 has been assigned to Vedant Kulkarni');

    // Vedant has never messaged us, so his 24h window is shut and the
    // notification has to go out as a template.
    const { sendTaskAssignmentNotification } = await import('../../src/services/whatsappService');
    expect(sendTaskAssignmentNotification).toHaveBeenCalledOnce();
    expect(vi.mocked(sendTaskAssignmentNotification).mock.calls[0][0]).toBe(CMD_PHONES.vedant);
  });

  it('records the notification in the assignee\'s conversation', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Allocate task TSK-1059 to Vedant'));

    const outbound = await prisma.message.findFirstOrThrow({
      where: { userId: CMD.vedant, direction: 'outbound' },
    });
    expect(outbound.taskId).toBe('TSK-1059');
    expect(outbound.text).toContain('Sahil Mehta');
  });

  it('keeps both sides of the exchange in the sender\'s thread', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Allocate task TSK-1059 to Vedant'));

    const thread = await prisma.message.findMany({
      where: { userId: CMD.sahil }, orderBy: { createdAt: 'asc' },
    });
    expect(thread).toHaveLength(2);
    expect(thread[0].direction).toBe('inbound');
    expect(thread[0].text).toBe('Allocate task TSK-1059 to Vedant');
    expect(thread[1].direction).toBe('outbound');
  });

  it.each([
    'Assign TSK-1059 to Vedant',
    'Allocate task 1059 to Vedant',
    'Reassign my ticket TSK-1059 to Vedant',
    'delegate TSK-1059 to vedant because I have a high workload',
  ])('understands %j', async (text) => {
    await processInbound(textMessage(CMD_PHONES.sahil, text));
    expect((await task('TSK-1059')).assignedToId).toBe(CMD.vedant);
  });

  it('keeps the stated reason on the audit trail', async () => {
    await processInbound(textMessage(
      CMD_PHONES.sahil, 'Delegate TSK-1059 to Vedant because I have a high workload',
    ));

    const activity = await prisma.activity.findFirstOrThrow({
      where: { taskId: 'TSK-1059', type: 'reassign' },
    });
    expect(activity.text).toContain('high workload');
  });
});

describe('authorization', () => {
  it('refuses a target outside the reporting structure', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign TSK-1059 to Farouk'));

    expect((await task('TSK-1059')).assignedToId).toBe(CMD.sahil);   // unchanged

    const [cmd] = await commands();
    expect(cmd.status).toBe('rejected');
    expect(cmd.newAssigneeId).toBeNull();

    // And the refusal must not confirm that Farouk exists anywhere.
    const reply = repliesTo(CMD_PHONES.sahil);
    expect(reply).toContain("couldn't find anyone called");
    expect(reply).not.toContain('Farouk Ali');
  });

  it('refuses a ticket the sender has no access to', async () => {
    // TSK-1070 belongs to the rival manager's report.
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign TSK-1070 to Vedant'));

    expect((await task('TSK-1070')).assignedToId).toBe(CMD.outsider);
    expect((await commands())[0].status).toBe('rejected');
    expect(repliesTo(CMD_PHONES.sahil)).toContain('do not have permission');
  });

  it('refuses an employee outright', async () => {
    await processInbound(textMessage(CMD_PHONES.vedant, 'Assign TSK-1060 to Vikranth Sharma'));

    expect((await task('TSK-1060')).assignedToId).toBe(CMD.vedant);
    const [cmd] = await commands();
    expect(cmd.status).toBe('rejected');
    expect(repliesTo(CMD_PHONES.vedant)).toContain('Only managers');
  });

  it('lets an admin assign across the whole org', async () => {
    await prisma.user.update({ where: { id: CMD.admin }, data: { phone: '919100000001' } });
    await processInbound(textMessage('919100000001', 'Assign TSK-1070 to Vedant'));

    expect((await task('TSK-1070')).assignedToId).toBe(CMD.vedant);
  });

  it('ignores a command from a phone number that matches nobody', async () => {
    await processInbound(textMessage('919999999999', 'Assign TSK-1059 to Vedant'));

    expect((await task('TSK-1059')).assignedToId).toBe(CMD.sahil);
    expect(await commands()).toHaveLength(0);
  });
});

describe('bad input', () => {
  it('reports an unknown ticket without changing anything', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign TSK-9999 to Vedant'));

    const [cmd] = await commands();
    expect(cmd.status).toBe('rejected');
    expect(cmd.taskId).toBe('TSK-9999');
    expect(repliesTo(CMD_PHONES.sahil)).toContain('could not find ticket TSK-9999');
  });

  it('asks for the ticket number when none was given and nothing is in context', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Delegate this ticket to Vedant'));

    expect((await commands())[0].status).toBe('clarifying');
    expect(repliesTo(CMD_PHONES.sahil)).toContain('could not identify the ticket number');
  });

  it('uses the ticket under discussion for "this ticket" — but confirms it first', async () => {
    // Establishes TSK-1059 as what this conversation is about.
    await processInbound(textMessage(CMD_PHONES.sahil, 'TSK-1059 in progress'));
    await processInbound(textMessage(CMD_PHONES.sahil, 'Delegate this ticket to Vedant'));

    // Picked up from context — and NOT acted on, because the sender never
    // actually said which ticket.
    expect(repliesTo(CMD_PHONES.sahil)).toContain('reassign TSK-1059');
    expect((await task('TSK-1059')).assignedToId).toBe(CMD.sahil);

    await processInbound(textMessage(CMD_PHONES.sahil, 'Confirm'));
    expect((await task('TSK-1059')).assignedToId).toBe(CMD.vedant);
  });

  it('does not silently reopen a task that is already Done', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign TSK-1080 to Vikranth Sharma'));

    // Offered reopen-or-copy rather than acting — see UC24.
    expect((await task('TSK-1080')).assignedToId).toBe(CMD.vedant);
    expect((await task('TSK-1080')).status).toBe('Done');
    expect((await commands())[0].status).toBe('clarifying');
  });

  it('refuses a no-op reassignment', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign TSK-1060 to Vedant'));

    expect((await commands())[0].status).toBe('rejected');
    expect(repliesTo(CMD_PHONES.sahil)).toContain('already assigned to Vedant Kulkarni');
  });
});

describe('ambiguous and uncertain names', () => {
  it('asks which Vikranth, and changes nothing yet', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign TSK-1059 to Vikranth'));

    expect((await task('TSK-1059')).assignedToId).toBe(CMD.sahil);   // untouched
    expect((await commands())[0].status).toBe('clarifying');

    const held = await state(CMD.sahil);
    expect(held?.kind).toBe('choose_employee');

    const reply = repliesTo(CMD_PHONES.sahil);
    expect(reply).toContain('Vikranth Sharma');
    expect(reply).toContain('Vikranth Rao');
  });

  it('walks the full clarify → name → confirm → execute conversation', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign TSK-1059 to Vikranth'));
    await processInbound(textMessage(CMD_PHONES.sahil, 'Vikranth Sharma'));

    expect(repliesTo(CMD_PHONES.sahil)).toContain('Reply "Confirm"');
    expect((await task('TSK-1059')).assignedToId).toBe(CMD.sahil);   // still nothing

    await processInbound(textMessage(CMD_PHONES.sahil, 'Confirm'));

    expect((await task('TSK-1059')).assignedToId).toBe(CMD.vikranthS);
    expect(await state(CMD.sahil)).toBeNull();

    const executed = (await commands()).find((c) => c.status === 'executed');
    expect(executed?.confirmed).toBe(true);
    expect(executed?.newAssigneeId).toBe(CMD.vikranthS);
  });

  it('accepts a numbered reply to the shortlist', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign TSK-1059 to Vikranth'));
    await processInbound(textMessage(CMD_PHONES.sahil, '2'));
    await processInbound(textMessage(CMD_PHONES.sahil, 'yes'));

    // Candidates keep the order they arrive in, which is `assignableUsers`'
    // alphabetical sort — so Rao is 1 and Sharma is 2.
    expect((await task('TSK-1059')).assignedToId).toBe(CMD.vikranthS);
  });

  it('tolerates a typo but confirms before acting on it', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign TSK-1059 to Vedanth'));

    // Resolved to Vedant — but not applied without a yes.
    expect((await task('TSK-1059')).assignedToId).toBe(CMD.sahil);
    expect((await commands())[0].status).toBe('awaiting_confirmation');
    expect(repliesTo(CMD_PHONES.sahil)).toContain('Vedant Kulkarni');

    await processInbound(textMessage(CMD_PHONES.sahil, 'Confirm'));
    expect((await task('TSK-1059')).assignedToId).toBe(CMD.vedant);
  });

  it('cancels cleanly', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign TSK-1059 to Vedanth'));
    await processInbound(textMessage(CMD_PHONES.sahil, 'cancel'));

    expect((await task('TSK-1059')).assignedToId).toBe(CMD.sahil);
    expect(await state(CMD.sahil)).toBeNull();
    expect((await commands()).some((c) => c.status === 'cancelled')).toBe(true);
  });

  it('does not read an unclear reply as a yes', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign TSK-1059 to Vedanth'));
    await processInbound(textMessage(CMD_PHONES.sahil, 'hmm maybe'));

    expect((await task('TSK-1059')).assignedToId).toBe(CMD.sahil);
    expect(repliesTo(CMD_PHONES.sahil)).toContain('still need a yes or no');
  });

  it('ignores a confirmation once the question has expired', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign TSK-1059 to Vedanth'));

    await prisma.conversationState.update({
      where: { userId: CMD.sahil },
      data:  { expiresAt: new Date(Date.now() - 1000) },
    });

    await processInbound(textMessage(CMD_PHONES.sahil, 'Confirm'));

    expect((await task('TSK-1059')).assignedToId).toBe(CMD.sahil);
    expect(await state(CMD.sahil)).toBeNull();
  });

  it('lets a fresh command replace a pending one', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign TSK-1059 to Vedanth'));
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign TSK-1059 to Vikranth Sharma'));

    // The second command was exact and confident, so it went straight through —
    // and the stale confirmation for Vedant is gone rather than still live.
    expect((await task('TSK-1059')).assignedToId).toBe(CMD.vikranthS);
  });
});

describe('creating a task', () => {
  it('creates it, assigns it, and dates it', async () => {
    await processInbound(textMessage(
      CMD_PHONES.sahil, 'Create a task for Vedant to prepare the weekly report by Friday',
    ));

    // generateTaskId continues from the highest existing number (TSK-1080).
    const created = await prisma.task.findUniqueOrThrow({ where: { id: 'TSK-1081' } });
    expect(created.title).toBe('prepare the weekly report');
    expect(created.assignedToId).toBe(CMD.vedant);
    expect(created.assignedById).toBe(CMD.sahil);
    expect(created.deadline.getDay()).toBe(5);           // a Friday
    expect(created.deadline.getTime()).toBeGreaterThan(Date.now());

    const activity = await prisma.activity.findFirstOrThrow({
      where: { taskId: 'TSK-1081', type: 'created' },
    });
    expect(activity.channel).toBe('whatsapp');

    expect(repliesTo(CMD_PHONES.sahil)).toContain('Created TSK-1081 for Vedant Kulkarni');
  });

  it('reads a stated priority', async () => {
    await processInbound(textMessage(
      CMD_PHONES.sahil, 'Create a task for Vedant to fix the login page by tomorrow, high priority',
    ));

    expect((await prisma.task.findUniqueOrThrow({ where: { id: 'TSK-1081' } })).priority).toBe('High');
  });

  it('notifies the new assignee', async () => {
    await processInbound(textMessage(
      CMD_PHONES.sahil, 'Create a task for Vedant to prepare the weekly report by Friday',
    ));

    const { sendTaskAssignmentNotification } = await import('../../src/services/whatsappService');
    expect(sendTaskAssignmentNotification).toHaveBeenCalledOnce();
  });

  it('refuses to create work for someone outside the hierarchy', async () => {
    await processInbound(textMessage(
      CMD_PHONES.sahil, 'Create a task for Farouk to prepare the weekly report by Friday',
    ));

    expect(await prisma.task.findUnique({ where: { id: 'TSK-1081' } })).toBeNull();
    expect((await commands())[0].status).toBe('rejected');
  });

  it('asks rather than inventing a date it could not read', async () => {
    await processInbound(textMessage(
      CMD_PHONES.sahil, 'Create a task for Vedant to prepare the weekly report by whenever',
    ));

    expect(await prisma.task.findUnique({ where: { id: 'TSK-1081' } })).toBeNull();
    expect((await commands())[0].status).toBe('clarifying');
    expect(repliesTo(CMD_PHONES.sahil)).toContain('due?');
  });
});

describe('comments, priority and deadlines', () => {
  it('adds a comment to the task history', async () => {
    await processInbound(textMessage(
      CMD_PHONES.sahil, 'Add a comment to TSK-1059 saying that the client approval is pending',
    ));

    const activity = await prisma.activity.findFirstOrThrow({
      where: { taskId: 'TSK-1059', type: 'comment' },
    });
    expect(activity.text).toBe('that the client approval is pending');
    expect(activity.channel).toBe('whatsapp');
    expect(activity.byId).toBe(CMD.sahil);
    expect((await commands())[0].status).toBe('executed');
  });

  it('changes priority', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Set the priority of TSK-1059 to high'));

    expect((await task('TSK-1059')).priority).toBe('High');
    const activity = await prisma.activity.findFirstOrThrow({
      where: { taskId: 'TSK-1059', type: 'status' },
    });
    expect(activity.text).toBe('Priority changed from Medium to High');
    expect(repliesTo(CMD_PHONES.sahil)).toContain('priority set to High');
  });

  it('refuses a priority change that changes nothing', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Set the priority of TSK-1059 to medium'));

    expect((await commands())[0].status).toBe('rejected');
    expect(repliesTo(CMD_PHONES.sahil)).toContain('already Medium priority');
  });

  it('moves a deadline', async () => {
    const before = (await task('TSK-1059')).deadline;
    await processInbound(textMessage(CMD_PHONES.sahil, 'Extend the deadline of TSK-1059 to Monday'));

    const after = (await task('TSK-1059')).deadline;
    expect(after.getTime()).not.toBe(before.getTime());
    expect(after.getDay()).toBe(1);                     // a Monday
    expect(repliesTo(CMD_PHONES.sahil)).toContain('deadline moved to');
  });

  it('asks rather than guessing an unreadable date', async () => {
    const before = (await task('TSK-1059')).deadline;
    await processInbound(textMessage(CMD_PHONES.sahil, 'Move the TSK-1059 deadline to whenever'));

    expect((await task('TSK-1059')).deadline.getTime()).toBe(before.getTime());
    expect((await commands())[0].status).toBe('clarifying');
  });

  it('applies the same access check to edits as to reassignment', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Set the priority of TSK-1070 to high'));

    expect((await task('TSK-1070')).priority).toBe('Medium');
    expect((await commands())[0].status).toBe('rejected');
    expect(repliesTo(CMD_PHONES.sahil)).toContain('do not have permission');
  });

  it('refuses an employee trying to edit', async () => {
    await processInbound(textMessage(CMD_PHONES.vedant, 'Set the priority of TSK-1060 to high'));

    expect((await task('TSK-1060')).priority).toBe('Medium');
    expect((await commands())[0].status).toBe('rejected');
  });
});

describe('voice notes', () => {
  it('runs a spoken command through the same pipeline', async () => {
    await processInbound(audioMessage(CMD_PHONES.sahil));

    expect((await task('TSK-1059')).assignedToId).toBe(CMD.vedant);

    const [cmd] = await commands();
    expect(cmd.status).toBe('executed');
    // The transcript is what was acted on, so it is kept with the decision.
    expect(cmd.transcription).toBe('allocate task 1059 to Vedant');

    const inbound = await prisma.message.findFirstOrThrow({
      where: { userId: CMD.sahil, direction: 'inbound' },
    });
    expect(inbound.kind).toBe('voice');
    expect(inbound.transcription).toBe('allocate task 1059 to Vedant');
    expect(inbound.mediaUrl).toBe('https://cdn.test/voice.ogg');
  });

  it('echoes back what it heard when it needs to confirm', async () => {
    transcribeAudio.mockResolvedValue('assign task 1059 to Vedanth');
    await processInbound(audioMessage(CMD_PHONES.sahil));

    expect(repliesTo(CMD_PHONES.sahil)).toContain('I heard:');
    expect((await task('TSK-1059')).assignedToId).toBe(CMD.sahil);
  });

  it('creates a task from a spoken instruction', async () => {
    transcribeAudio.mockResolvedValue('create a task for Vedant to prepare the weekly report by Friday');
    await processInbound(audioMessage(CMD_PHONES.sahil));

    const created = await prisma.task.findUniqueOrThrow({ where: { id: 'TSK-1081' } });
    expect(created.assignedToId).toBe(CMD.vedant);
    expect((await commands())[0].transcription).toContain('weekly report');
  });

  it('changes nothing when transcription fails', async () => {
    // A voice note we couldn't hear is not a command. It gets recorded and
    // nothing moves — the alternative is acting on an empty string.
    transcribeAudio.mockResolvedValue(null);
    await processInbound(audioMessage(CMD_PHONES.sahil));

    expect((await task('TSK-1059')).assignedToId).toBe(CMD.sahil);
    expect(await commands()).toHaveLength(0);
    // Still logged, so the manager's thread shows a voice note arrived.
    expect(await prisma.message.findMany({ where: { userId: CMD.sahil } })).toHaveLength(1);
  });
});

describe('duplicate deliveries', () => {
  it('reassigns exactly once for a retried wamid', async () => {
    const payload = textMessage(CMD_PHONES.sahil, 'Assign TSK-1059 to Vedant');
    await processInbound(payload);
    await processInbound(payload);   // Meta retries

    expect((await task('TSK-1059')).assignedToId).toBe(CMD.vedant);
    expect(await commands()).toHaveLength(1);
    expect(await prisma.activity.findMany({ where: { taskId: 'TSK-1059', type: 'reassign' } }))
      .toHaveLength(1);
  });
});

describe('rate limiting', () => {
  it('stops runaway commands', async () => {
    process.env.WA_COMMAND_RATE_LIMIT = '3';
    __resetRateLimits();

    for (let i = 0; i < 5; i++) {
      await processInbound(textMessage(CMD_PHONES.sahil, 'Assign TSK-9999 to Vedant'));
    }

    const limited = (await commands()).filter((c) => c.errorReason === 'Rate limited');
    expect(limited.length).toBe(2);
    expect(repliesTo(CMD_PHONES.sahil)).toContain('try again in about');

    delete process.env.WA_COMMAND_RATE_LIMIT;
  });
});

describe('the feature switch', () => {
  it('does nothing at all when disabled', async () => {
    process.env.WA_COMMANDS_ENABLED = 'false';
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign TSK-1059 to Vedant'));

    expect((await task('TSK-1059')).assignedToId).toBe(CMD.sahil);
    expect(await commands()).toHaveLength(0);
  });
});

describe('the worker pipeline is untouched', () => {
  it('still handles a manager reporting on their own task', async () => {
    // Sahil holds TSK-1059. "done" is a worker report, not a command, and must
    // go down the original path even with commands enabled.
    await processInbound(textMessage(CMD_PHONES.sahil, 'TSK-1059 done'));

    expect((await task('TSK-1059')).status).toBe('Submitted');
    expect(await commands()).toHaveLength(0);

    const inbound = await prisma.message.findFirstOrThrow({
      where: { userId: CMD.sahil, direction: 'inbound' },
    });
    expect(inbound.attributedBy).toBe('explicit_ref');
  });

  it('still handles an employee reporting progress', async () => {
    await processInbound(textMessage(CMD_PHONES.vedant, 'task 1060 done'));

    expect((await task('TSK-1060')).status).toBe('Submitted');
    expect(await commands()).toHaveLength(0);
  });

  it('does not mistake ordinary English for a command', async () => {
    // "handed over" is a reassignment verb, but this is a worker describing
    // their day — no ticket number, so the parse is partial. Answering it with
    // "only managers can reassign tickets" would be both wrong and baffling,
    // and would swallow the completion report.
    await processInbound(textMessage(
      CMD_PHONES.vedant, 'handed over the keys to Vikranth, all done',
    ));

    expect((await task('TSK-1060')).status).toBe('Submitted');
    expect(await commands()).toHaveLength(0);
    expect(repliesTo(CMD_PHONES.vedant)).not.toContain('Only managers');
  });

  it('still refuses an employee who issues an unmistakable command', async () => {
    // The complete form — verb, ticket and name — is refused explicitly, so
    // nobody is left assuming it worked.
    await processInbound(textMessage(CMD_PHONES.vedant, 'hand over task 1060 to Vikranth Sharma'));

    expect((await task('TSK-1060')).assignedToId).toBe(CMD.vedant);
    expect((await commands())[0].status).toBe('rejected');
    expect(repliesTo(CMD_PHONES.vedant)).toContain('Only managers');
  });
});
