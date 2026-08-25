import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The only things that leave the process. Every outreach template sender is
// stubbed individually rather than through one catch-all, so a test can assert
// WHICH template was chosen — which is the difference between telling a vendor
// money is coming and demanding money from them.
const sent = {
  paymentDue:    vi.fn().mockResolvedValue({ ok: true, waMessageId: 'wamid.PAYDUE' }),
  paymentAdvice: vi.fn().mockResolvedValue({ ok: true, waMessageId: 'wamid.PAYADV' }),
  sample:        vi.fn().mockResolvedValue({ ok: true, waMessageId: 'wamid.SAMPLE' }),
  stock:         vi.fn().mockResolvedValue({ ok: true, waMessageId: 'wamid.STOCK' }),
  order:         vi.fn().mockResolvedValue({ ok: true, waMessageId: 'wamid.ORDER' }),
  text:          vi.fn().mockResolvedValue({ ok: true, waMessageId: 'wamid.TEXT' }),
};

vi.mock('../../src/services/whatsappService', () => ({
  normalisePhone: (raw: string) => {
    const d = String(raw ?? '').replace(/\D/g, '');
    return d.length === 10 ? `91${d}` : d;
  },
  sendInteractiveList:    vi.fn().mockResolvedValue(undefined),
  sendInteractiveButtons: vi.fn().mockResolvedValue(undefined),
  sendTextMessage:        (...a: unknown[]) => sent.text(...a),
  sendTaskAssignmentNotification:       vi.fn().mockResolvedValue({ ok: true }),
  sendEscalationNotification:           vi.fn().mockResolvedValue({ ok: true }),
  sendTaskReassignedNotification:       vi.fn().mockResolvedValue({ ok: true }),
  sendDeadlineReminderNotification:     vi.fn().mockResolvedValue({ ok: true }),
  sendSupervisorEscalationNotification: vi.fn().mockResolvedValue({ ok: true }),
  sendUpdateWaitingNotification:        vi.fn().mockResolvedValue({ ok: true }),
  sendWhatsAppLocalized:                vi.fn().mockResolvedValue({ ok: true }),
  sendSampleDispatchNotice: (...a: unknown[]) => sent.sample(...a),
  sendPaymentAdviceToVendor: (...a: unknown[]) => sent.paymentAdvice(...a),
  sendPaymentDueReminder:    (...a: unknown[]) => sent.paymentDue(...a),
  sendStockCheckRequest:     (...a: unknown[]) => sent.stock(...a),
  sendSalesOrderPlaced:      (...a: unknown[]) => sent.order(...a),
}));

vi.mock('../../src/services/mediaService', () => ({
  storeWhatsAppMedia:       vi.fn().mockResolvedValue('https://cdn.test/photo.jpg'),
  downloadWhatsAppMedia:    vi.fn().mockResolvedValue({ buffer: Buffer.from('x'), mimeType: 'audio/ogg' }),
  uploadBufferToCloudinary: vi.fn().mockResolvedValue('https://cdn.test/voice.ogg'),
}));

vi.mock('../../src/services/transcriptionService', () => ({
  transcribeAudio: vi.fn(),
}));

import { __test } from '../../src/controllers/webhookController';
import { __resetRateLimits } from '../../src/lib/rateLimit';
import {
  CMD, CMD_PHONES, INVOICE, PARTY, PARTY_PHONES,
  buttonReply, prisma, seedCommandOrg, seedParties, textMessage,
} from '../fixtures';

const { processInbound } = __test;

// No model key: the deterministic rule parser runs, so nothing here depends on
// an LLM being reachable or on what it happens to return today.
delete process.env.NVIDIA_API_KEY;
process.env.WA_COMMANDS_ENABLED  = 'true';
process.env.WA_OUTREACH_ENABLED  = 'true';
process.env.WA_OUTREACH_ROLES    = 'Admin';
process.env.WA_CONTACT_COOLDOWN_S = '0';   // one test per party; the cooldown has its own test

beforeEach(async () => {
  vi.clearAllMocks();
  __resetRateLimits();
  await seedCommandOrg();
  await seedParties();
});

afterAll(async () => { await prisma.$disconnect(); });

/** Drive one inbound message all the way through the webhook. */
async function inbound(payload: unknown): Promise<void> {
  await processInbound((payload as { entry: { changes: { value: unknown }[] }[] }).entry[0].changes[0].value);
}

/** The last thing the system said back to the sender. */
function lastReply(): string {
  const calls = sent.text.mock.calls;
  return calls.length ? String(calls[calls.length - 1][1]) : '';
}

describe('delegated outreach creates a real task', () => {
  it('“Ask Sahil to send fabric samples to Urja Vart” files a task, and messages nobody outside', async () => {
    await inbound(textMessage(CMD_PHONES.admin, 'Ask Sahil to send fabric samples to Urja Vart by tomorrow'));

    const task = await prisma.task.findFirst({
      where: { kind: 'sample_dispatch' },
      include: { assignedTo: true, contact: true },
    });

    expect(task).not.toBeNull();
    expect(task!.assignedTo.id).toBe(CMD.sahil);
    expect(task!.contact!.id).toBe(PARTY.urja);
    expect(task!.assignedById).toBe(CMD.admin);

    // The party is referenced, never messaged. This is the distinction the
    // whole feature turns on.
    expect(sent.sample).not.toHaveBeenCalled();
    expect(sent.paymentDue).not.toHaveBeenCalled();

    // Indistinguishable from a task raised on the website, which is the
    // requirement: one task system, not two.
    const assignees = await prisma.taskAssignee.findMany({ where: { taskId: task!.id } });
    expect(assignees).toHaveLength(1);
    const activity = await prisma.activity.findFirst({ where: { taskId: task!.id, type: 'created' } });
    expect(activity?.channel).toBe('whatsapp');
  });

  it('captures the detail that was given without demanding the rest', async () => {
    await inbound(textMessage(
      CMD_PHONES.admin,
      'Ask Sahil to send 2-meter samples of Fabric A12 and B14 to Urja Vart tomorrow',
    ));

    const task = await prisma.task.findFirst({ where: { kind: 'sample_dispatch' } });
    expect(task).not.toBeNull();
    const fields = task!.customFields as Record<string, string>;
    expect(fields.Party).toBe('Urja Vart');
    expect(fields.Item).toContain('A12');
  });

  it('files a collection task rather than messaging the customer', async () => {
    await inbound(textMessage(CMD_PHONES.admin, 'Create a task for Sahil to collect dues from Ramesh Traders'));

    const task = await prisma.task.findFirst({ where: { kind: 'payment_followup' } });
    expect(task?.contactId).toBe(PARTY.ramesh);
    expect(sent.paymentDue).not.toHaveBeenCalled();
  });
});

describe('direct outreach always confirms before it sends', () => {
  it('reads back the parsed values and sends nothing until confirmed', async () => {
    await inbound(textMessage(CMD_PHONES.admin, 'Send a payment reminder to Ramesh Traders about invoice INV-102'));

    // Nothing has gone out yet, whatever the confidence was.
    expect(sent.paymentDue).not.toHaveBeenCalled();

    const reply = lastReply();
    expect(reply).toContain('Ramesh Traders');
    // The AMOUNT comes from the invoice on record, not from the message —
    // which never mentioned one.
    expect(reply).toContain('₹25,000');
    expect(reply).toContain('INV-102');

    const state = await prisma.conversationState.findUnique({ where: { userId: CMD.admin } });
    expect(state?.kind).toBe('confirm');

    await inbound(textMessage(CMD_PHONES.admin, 'yes'));

    expect(sent.paymentDue).toHaveBeenCalledTimes(1);
    const [to, contactName, , amount, reference] = sent.paymentDue.mock.calls[0];
    expect(to).toBe(PARTY_PHONES.ramesh);
    expect(contactName).toBe('Ramesh Traders');
    expect(amount).toBe('₹25,000');
    expect(reference).toContain('INV-102');
  });

  it('sends nothing when the sender cancels', async () => {
    await inbound(textMessage(CMD_PHONES.admin, 'Send a payment reminder of ₹45,000 to Ramesh Traders'));
    await inbound(textMessage(CMD_PHONES.admin, 'no'));

    expect(sent.paymentDue).not.toHaveBeenCalled();
    const cancelled = await prisma.whatsAppCommand.findFirst({ where: { status: 'cancelled' } });
    expect(cancelled).not.toBeNull();
  });

  // The invoice decides the direction, not the wording. "Remind Metro about
  // BILL-4471" is the same sentence whether Metro owes us or we owe them.
  it('uses the vendor ADVICE template when the bill is one we owe', async () => {
    await inbound(textMessage(CMD_PHONES.admin, 'Send a payment reminder to Metro Logistics for BILL-4471'));
    await inbound(textMessage(CMD_PHONES.admin, 'yes'));

    expect(sent.paymentAdvice).toHaveBeenCalledTimes(1);
    expect(sent.paymentDue).not.toHaveBeenCalled();
  });

  it('quotes the OUTSTANDING balance, not the original amount', async () => {
    await inbound(textMessage(CMD_PHONES.admin, 'Remind Ramesh Traders about invoice INV-2231'));
    await inbound(textMessage(CMD_PHONES.admin, 'yes'));

    // INV-2231 is ₹60,000 with ₹45,000 still owed.
    expect(sent.paymentDue.mock.calls[0][3]).toBe('₹45,000');
  });
});

describe('ambiguity is asked about, never guessed', () => {
  it('offers both Rameshes and resumes the original command on "2"', async () => {
    await inbound(textMessage(CMD_PHONES.admin, 'Send a payment reminder of ₹45,000 to Ramesh'));

    const asked = lastReply();
    expect(asked).toContain('Ramesh Traders');
    expect(asked).toContain('Ramesh Textile Traders');
    expect(sent.paymentDue).not.toHaveBeenCalled();

    const state = await prisma.conversationState.findUnique({ where: { userId: CMD.admin } });
    expect(state?.kind).toBe('choose_contact');

    await inbound(textMessage(CMD_PHONES.admin, '2'));

    // Picking resolves the name; it does not authorise the send.
    expect(sent.paymentDue).not.toHaveBeenCalled();
    expect(lastReply()).toContain('Ramesh Textile Traders');

    await inbound(textMessage(CMD_PHONES.admin, 'yes'));
    expect(sent.paymentDue.mock.calls[0][0]).toBe(PARTY_PHONES.rameshAlt);
  });

  it('refuses a party it does not know, and says how to add them', async () => {
    await inbound(textMessage(CMD_PHONES.admin, 'Send a payment reminder of ₹45,000 to Nobody Traders'));

    expect(sent.paymentDue).not.toHaveBeenCalled();
    expect(lastReply()).toMatch(/could not find|couldn't find/i);
    expect(lastReply()).toContain('register');
  });
});

describe('protecting the other party', () => {
  it('refuses to message somebody who has opted out', async () => {
    await inbound(textMessage(CMD_PHONES.admin, 'Send a payment reminder of ₹10,000 to Deccan Stones'));
    await inbound(textMessage(CMD_PHONES.admin, 'yes'));

    expect(sent.paymentDue).not.toHaveBeenCalled();
    expect(lastReply()).toMatch(/not to be messaged/i);
  });

  it('refuses outreach from somebody without the role', async () => {
    // Sahil is a Manager: allowed to reassign tickets, not to send a vendor a bill.
    await inbound(textMessage(CMD_PHONES.sahil, 'Send a payment reminder of ₹45,000 to Ramesh Traders'));
    expect(sent.paymentDue).not.toHaveBeenCalled();
  });

  it('honours a daily cap per contact', async () => {
    process.env.WA_CONTACT_DAILY_CAP = '1';
    try {
      await inbound(textMessage(CMD_PHONES.admin, 'Remind Ramesh Traders about invoice INV-102'));
      await inbound(textMessage(CMD_PHONES.admin, 'yes'));
      expect(sent.paymentDue).toHaveBeenCalledTimes(1);

      await inbound(textMessage(CMD_PHONES.admin, 'Remind Ramesh Traders about invoice INV-2231'));
      await inbound(textMessage(CMD_PHONES.admin, 'yes'));
      expect(sent.paymentDue).toHaveBeenCalledTimes(1);   // still one
      expect(lastReply()).toMatch(/already received/i);
    } finally {
      process.env.WA_CONTACT_DAILY_CAP = '3';
    }
  });
});

describe('a reply from the party', () => {
  async function sendReminder() {
    await inbound(textMessage(CMD_PHONES.admin, 'Create a task for Sahil to collect dues from Ramesh Traders'));
    return prisma.task.findFirstOrThrow({ where: { kind: 'payment_followup' } });
  }

  it('a button tap moves the task and does NOT enter the worker pipeline', async () => {
    const task = await sendReminder();

    await inbound(buttonReply(PARTY_PHONES.ramesh, 'Payment done'));

    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    // Submitted, never Done. A vendor saying they paid is a claim, not a receipt.
    expect(after.status).toBe('Submitted');

    const msg = await prisma.message.findFirst({ where: { contactId: PARTY.ramesh, direction: 'inbound' } });
    expect(msg).not.toBeNull();
    expect(msg!.userId).toBeNull();      // a contact is not a User
    expect(msg!.senderId).toBeNull();
  });

  it('a Hindi button tap means the same thing', async () => {
    const task = await sendReminder();
    await inbound(buttonReply(PARTY_PHONES.ramesh, 'भुगतान हो गया'));
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.status).toBe('Submitted');
  });

  it('free text is stored and forwarded, never interpreted', async () => {
    const task = await sendReminder();
    await inbound(textMessage(PARTY_PHONES.ramesh, "we'll pay on Tuesday"));

    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.status).toBe('Pending');   // unchanged — we did not guess

    const stored = await prisma.message.findFirst({
      where: { contactId: PARTY.ramesh, direction: 'inbound' },
    });
    expect(stored?.text).toBe("we'll pay on Tuesday");
  });

  it('STOP is honoured permanently', async () => {
    await inbound(textMessage(PARTY_PHONES.ramesh, 'STOP'));

    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: PARTY.ramesh } });
    expect(contact.optOutAt).not.toBeNull();

    // And nothing can be sent afterwards, however it is asked for.
    await inbound(textMessage(CMD_PHONES.admin, 'Remind Ramesh Traders about invoice INV-102'));
    await inbound(textMessage(CMD_PHONES.admin, 'yes'));
    expect(sent.paymentDue).not.toHaveBeenCalled();
  });
});

describe('registering a party from WhatsApp', () => {
  it('always confirms, then saves', async () => {
    await inbound(textMessage(CMD_PHONES.admin, 'register vendor Sharma Traders 9812300000'));

    // A typo here silently creates a party and points future messages at a
    // stranger's phone, so it confirms whatever the confidence was.
    expect(await prisma.contact.findFirst({ where: { name: 'Sharma Traders' } })).toBeNull();
    expect(lastReply()).toContain('Sharma Traders');

    await inbound(textMessage(CMD_PHONES.admin, 'yes'));

    const created = await prisma.contact.findFirst({ where: { name: 'Sharma Traders' } });
    expect(created?.type).toBe('vendor');
    expect(created?.phone).toBe('919812300000');
  });

  it('refuses a number that belongs to a colleague', async () => {
    await inbound(textMessage(CMD_PHONES.admin, `register vendor Fake Person ${CMD_PHONES.vedant.slice(2)}`));
    await inbound(textMessage(CMD_PHONES.admin, 'yes'));

    expect(await prisma.contact.findFirst({ where: { name: 'Fake Person' } })).toBeNull();
    expect(lastReply()).toMatch(/on the team|cannot be both/i);
  });
});

describe('an amount is never read as a ticket number', () => {
  it('does not attach a payment reminder to TSK-45000', async () => {
    await inbound(textMessage(CMD_PHONES.admin, 'remind Ramesh Traders about 45000 due Friday'));

    const cmd = await prisma.whatsAppCommand.findFirst({ orderBy: { createdAt: 'desc' } });
    expect(cmd?.taskId).toBeNull();
  });
});
