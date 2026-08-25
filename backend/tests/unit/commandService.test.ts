import { describe, expect, it } from 'vitest';
import {
  ParsedCommand, detectAssignmentIntent, detectReplaces, mergeParsed, parseWithRules,
} from '../../src/services/commandService';
import { normaliseName } from '../../src/services/nameResolutionService';

// The rule layer is what runs when no AI key is configured, so everything here
// is the guaranteed floor of the feature rather than a best case.

describe('reassignment', () => {
  it.each([
    ['Assign TSK-1059 to Vikranth',                    'TSK-1059', 'Vikranth'],
    ['Allocate task 1059 to Vedant',                   'TSK-1059', 'Vedant'],
    ['Reassign my ticket TSK-1059 to Vikranth',        'TSK-1059', 'Vikranth'],
    ['allocate task TSK-1059 to Vikranth.',            'TSK-1059', 'Vikranth'],
    ['Please reassign TSK-1059 to Vikranth Sharma',    'TSK-1059', 'Vikranth Sharma'],
    ['delegate TSK-1059 to vedant',                    'TSK-1059', 'vedant'],
    ['Transfer task no 1059 to Vikranth',              'TSK-1059', 'Vikranth'],
    ['hand over TSK-1059 to Vedant',                   'TSK-1059', 'Vedant'],
    ['Tsk1059 - assign to Vikranth',                   'TSK-1059', 'Vikranth'],
  ])('parses %j', (text, taskRef, targetName) => {
    const cmd = parseWithRules(text);
    expect(cmd?.intent).toBe('reassign_ticket');
    expect(cmd?.taskRef).toBe(taskRef);
    expect(cmd?.targetName).toBe(targetName);
    expect(cmd?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('keeps the reason out of the name', () => {
    const cmd = parseWithRules('Delegate TSK-1059 to Vikranth because I have a high workload');
    expect(cmd?.targetName).toBe('Vikranth');
    expect(cmd?.reason).toBe('I have a high workload');
  });

  it('flags a missing ticket number instead of guessing one', () => {
    const cmd = parseWithRules('Delegate this ticket to Vikranth because I have a high workload');
    expect(cmd?.intent).toBe('reassign_ticket');
    expect(cmd?.taskRef).toBeNull();
    expect(cmd?.targetName).toBe('Vikranth');
    // Below the act-immediately bar — the executor has to ask which ticket.
    expect(cmd?.confidence).toBeLessThan(0.9);
  });

  it('flags a missing name the same way', () => {
    const cmd = parseWithRules('reassign TSK-1059');
    expect(cmd?.taskRef).toBe('TSK-1059');
    expect(cmd?.targetName).toBeNull();
    expect(cmd?.confidence).toBeLessThan(0.9);
  });

  it('does not accept a pronoun as an assignee', () => {
    // "assign it to me" names nobody. Treating "me" as a name would send the
    // executor looking for an employee called Me.
    expect(parseWithRules('assign TSK-1059 to me')?.targetName).toBeNull();
  });
});

// The critical safety property: worker traffic must never route into the
// command pipeline. Every string here appears in the existing webhook suite.
describe('worker messages are not commands', () => {
  it.each([
    'task 1060 done',
    'Task 1060 completed and I clicked the picture also',
    'done',
    'ok thanks',
    'TSK-3000 done',
    'in progress',
    '1060 in progress, will complete soon',
    'still stuck on it',
    'task 1061 issue',
    'task 1060 has a problem',
    'Tsk 1060 done',
    'task -1060 done',
    'task number 1060 done',
    'मैंने काम पूरा कर दिया',
    'ho gaya',
    '1058 ho gaya',
  ])('%j parses to null', (text) => {
    expect(parseWithRules(text)).toBeNull();
  });
});

describe('task creation', () => {
  it('pulls the assignee, title and deadline apart', () => {
    const cmd = parseWithRules('Create a task for Vedant to prepare the weekly report by Friday');
    expect(cmd?.intent).toBe('create_task');
    expect(cmd?.targetName).toBe('Vedant');
    expect(cmd?.title).toBe('prepare the weekly report');
    expect(cmd?.deadlineText).toBe('Friday');
  });

  it('reads a priority when one is stated', () => {
    const cmd = parseWithRules('Create a task for Vedant to fix the login page by tomorrow, high priority');
    expect(cmd?.priority).toBe('High');
    expect(cmd?.targetName).toBe('Vedant');
  });
});

describe('comments', () => {
  it('takes the text after "saying"', () => {
    const cmd = parseWithRules('Add a comment to TSK-1059 saying that the client approval is pending');
    expect(cmd?.intent).toBe('add_comment');
    expect(cmd?.taskRef).toBe('TSK-1059');
    expect(cmd?.comment).toBe('that the client approval is pending');
  });
});

// Short task ids put the literal word "task" into almost every message, which
// the looser create pattern used to swallow. With "TSK-1059" these all worked;
// with "task 4" they did not.
describe('short ids do not turn every message into "create a task"', () => {
  it.each([
    ['Add a comment to task 4 saying client approval pending', 'add_comment'],
    ['Set the priority of task 4 to high',                     'set_priority'],
    ['Extend the deadline of task 4 to Monday',                'set_deadline'],
    ['Assign task 4 to Vedant',                                'reassign_ticket'],
  ])('%j is %s', (text, intent) => {
    const cmd = parseWithRules(text);
    expect(cmd?.intent).toBe(intent);
    expect(cmd?.taskRef).toBe('TSK-4');
  });

  it('still recognises a genuine creation', () => {
    const cmd = parseWithRules('Create a task for Vedant to prepare the weekly report by Friday');
    expect(cmd?.intent).toBe('create_task');
    expect(cmd?.taskRef).toBeNull();
  });

  // These two now resolve to the more specific `create_store_check_task`.
  // That is a refinement, not a behaviour change: both still create a task for
  // Vedant with Friday's deadline and no ticket reference — the only
  // difference is that the resulting task is filed under `stock_check` and can
  // be filtered as such. What matters here is that they remain CREATIONS and
  // are not swallowed by the reassign branch, which is what this block guards.
  it.each([
    'raise a new ticket for Vedant to check the stock by Friday',
    'make a task for Vedant to check the stock by Friday',
  ])('recognises %j as creation', (text) => {
    const cmd = parseWithRules(text);
    expect(cmd?.intent).toBe('create_store_check_task');
    expect(cmd?.taskRef).toBeNull();
    expect(normaliseName(cmd?.targetName ?? '')).toBe('vedant');
    expect(cmd?.deadlineText).toBe('Friday');
  });
});

describe('priority', () => {
  it('parses "set the priority of TSK-1059 to high"', () => {
    const cmd = parseWithRules('Set the priority of TSK-1059 to high');
    expect(cmd?.intent).toBe('set_priority');
    expect(cmd?.taskRef).toBe('TSK-1059');
    expect(cmd?.priority).toBe('High');
    expect(cmd?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it.each([
    ['make TSK-1059 priority urgent', 'High'],
    ['change priority of task 1059 to low', 'Low'],
    ['set TSK-1059 priority to medium', 'Medium'],
  ])('parses %j', (text, priority) => {
    expect(parseWithRules(text)?.priority).toBe(priority);
  });
});

describe('deadline', () => {
  it('parses "extend the deadline of TSK-1059 to Monday"', () => {
    const cmd = parseWithRules('Extend the deadline of TSK-1059 to Monday');
    expect(cmd?.intent).toBe('set_deadline');
    expect(cmd?.taskRef).toBe('TSK-1059');
    expect(cmd?.deadlineText).toBe('Monday');
  });

  it('parses "move TSK-1059 deadline to next Friday"', () => {
    const cmd = parseWithRules('move TSK-1059 deadline to next Friday');
    expect(cmd?.intent).toBe('set_deadline');
    expect(cmd?.deadlineText).toBe('next Friday');
  });
});

describe('empty input', () => {
  it.each(['', '   ', '\n'])('%j is not a command', (text) => {
    expect(parseWithRules(text)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Assignment model — one task for several people, or one each.
// ─────────────────────────────────────────────────────────────────────────────

describe('detectAssignmentIntent', () => {
  it.each([
    'they should work on it together', 'assign it jointly', 'both work on this',
    'add both to the same task', 'dono ko mil kar karna hai',
  ])('reads %j as shared', (t) => expect(detectAssignmentIntent(t)).toBe('shared'));

  it.each([
    'both of them need to complete it separately', 'give each of them a copy',
    'one copy each', 'they each need their own task',
    'vikranth ko bhi same kaam alag se', 'अलग से दे दो',
  ])('reads %j as separate', (t) => expect(detectAssignmentIntent(t)).toBe('separate'));

  it.each([
    'Assign task 4 to Vedant and Vikranth',
    'give task 4 to Vedant and Vikranth please',
  ])('leaves %j unstated — this is what must be asked, not guessed', (t) => {
    expect(detectAssignmentIntent(t)).toBeNull();
  });

  it('prefers separate when a message somehow says both', () => {
    // Giving somebody their own copy is recoverable; collapsing two people's
    // work into one task loses one person's accountability.
    expect(detectAssignmentIntent('both work on it together, separately')).toBe('separate');
  });
});

describe('detectReplaces', () => {
  it.each([
    'give task 4 to Vikranth instead', 'move it to Vikranth', 'transfer task 4 to Vikranth',
    'reassign task 4 to Vikranth', 'replace Vedant with Vikranth',
  ])('reads %j as a replacement', (t) => expect(detectReplaces(t)).toBe(true));

  it.each([
    'also assign task 4 to Vedant', 'add Vedant to task 4', 'share task 4 with Vedant',
    'assign task 4 to Vedant too', 'vikranth ko bhi de do',
  ])('reads %j as an addition', (t) => expect(detectReplaces(t)).toBe(false));

  it('does not treat a bare "send" as a handover', () => {
    // The spec is explicit: "send" on its own means share or notify. Reading it
    // as a handover would silently remove whoever holds the task.
    expect(detectReplaces('send task 4 to Vedant')).toBe(false);
  });
});

describe('several assignees', () => {
  it('keeps a two-word name as one person', () => {
    const cmd = parseWithRules('Please reassign TSK-1059 to Vikranth Sharma');
    expect(cmd?.targetNames).toEqual(['Vikranth Sharma']);
  });

  it('splits a list on every joiner people use', () => {
    expect(parseWithRules('Assign task 4 to Vedant, Vikranth and Priya')?.targetNames)
      .toEqual(['Vedant', 'Vikranth', 'Priya']);
  });

  it('stops a name at a sentence boundary', () => {
    // "…to Vedant and Vikranth. Both of them need to…" once produced a person
    // called "Vikranth Both of them".
    const cmd = parseWithRules(
      'Assign task 4 to Vedant and Vikranth. Both of them need to complete it separately.',
    );
    expect(cmd?.targetNames).toEqual(['Vedant', 'Vikranth']);
    expect(cmd?.assignmentIntent).toBe('separate');
  });

  it('drops below the act-immediately bar when the model is unstated', () => {
    const cmd = parseWithRules('Assign task 4 to Vedant and Vikranth.');
    expect(cmd?.targetNames).toHaveLength(2);
    expect(cmd?.assignmentIntent).toBeNull();
    expect(cmd?.confidence).toBeLessThan(0.9);
  });

  it('stays confident when the message says how', () => {
    const cmd = parseWithRules('Assign task 4 to Vedant and Vikranth. They should work on it together.');
    expect(cmd?.assignmentIntent).toBe('shared');
    expect(cmd?.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

describe('the phrasings the spec uses', () => {
  it('UC1 — "Assign Vedant the task of …" is a creation, not a reassignment', () => {
    const cmd = parseWithRules("Assign Vedant the task of checking today's inventory");
    expect(cmd?.intent).toBe('create_task');
    expect(cmd?.targetName).toBe('Vedant');
    expect(cmd?.title).toBe("checking today's inventory");
  });

  it('UC7 — "instead" is a replacement, and is not part of the name', () => {
    const cmd = parseWithRules('Give task 4 to Vikranth instead.');
    expect(cmd?.targetNames).toEqual(['Vikranth']);
    expect(cmd?.replaces).toBe(true);
  });

  it('UC20 — mixed Hindi and English', () => {
    // "task 4 vedant ko de do aur vikranth ko bhi same kaam alag se"
    // Hindi marks the recipient AFTER the name, so there is no "to" to anchor on.
    const cmd = parseWithRules('Task 4 vedant ko de do aur vikranth ko bhi same kaam alag se');
    expect(cmd?.taskRef).toBe('TSK-4');
    expect(cmd?.targetNames.map((n) => n.toLowerCase())).toEqual(['vedant', 'vikranth']);
    expect(cmd?.assignmentIntent).toBe('separate');
  });
});

// The model's output is untrusted input like any other. These pin down exactly
// how much of it is allowed to survive contact with the rule parse.
describe('mergeParsed', () => {
  const cmd = (over: Partial<ParsedCommand>): ParsedCommand => {
    const base: ParsedCommand = {
      intent: 'reassign_ticket', taskRef: null, targetName: null, targetNames: [],
      assignmentIntent: null, replaces: false, title: null,
      deadlineText: null, priority: null, comment: null, reason: null,
      confidence: 0.6, source: 'rule', ...over,
    };
    // Keep the two name fields consistent when a test sets only targetName.
    if (over.targetName && !over.targetNames) base.targetNames = [over.targetName];
    return base;
  };

  it('returns whichever side exists when only one does', () => {
    const rule = cmd({ taskRef: 'TSK-1' });
    expect(mergeParsed(rule, null)).toBe(rule);
    expect(mergeParsed(null, rule)).toBe(rule);
    expect(mergeParsed(null, null)).toBeNull();
  });

  it('lets the model fill a slot the rules left empty', () => {
    const merged = mergeParsed(
      cmd({ taskRef: 'TSK-1059', targetName: null }),
      cmd({ taskRef: 'TSK-1059', targetName: 'Vikranth', source: 'ai', confidence: 0.88 }),
    );
    expect(merged?.targetName).toBe('Vikranth');
    expect(merged?.source).toBe('ai');
  });

  it('never lets the model overwrite a ticket number the rules found', () => {
    // The most damaging single field to get wrong — it aims the whole command
    // at somebody else's work.
    const merged = mergeParsed(
      cmd({ taskRef: 'TSK-1059', targetName: 'Vedant', confidence: 0.95 }),
      cmd({ taskRef: 'TSK-9999', targetName: 'Vedant', source: 'ai', confidence: 0.9 }),
    );
    expect(merged?.taskRef).toBe('TSK-1059');
  });

  it('trusts an explicit verb over an inferred intent', () => {
    const rule = cmd({ intent: 'reassign_ticket', taskRef: 'TSK-1059', targetName: 'Vedant' });
    const ai   = cmd({ intent: 'create_task', source: 'ai', confidence: 0.9 });
    expect(mergeParsed(rule, ai)?.intent).toBe('reassign_ticket');
  });

  it('does not inflate confidence beyond what the model claimed', () => {
    const merged = mergeParsed(
      cmd({ confidence: 0.6 }),
      cmd({ source: 'ai', confidence: 0.7, targetName: 'Vedant' }),
    );
    expect(merged?.confidence).toBe(0.7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bilingual parsing.
//
// Before the transliteration pass there was not one test in this file
// asserting that a Hindi or Hinglish message produced a management intent —
// every positive case was English, and the two Hindi lines that existed both
// asserted the message was NOT a command. Devanagari input in fact matched
// almost nothing: names are captured with `[A-Za-z]` and words delimited with
// `\b`, both ASCII-only.
//
// Each case below is asserted in Devanagari and in Roman script, because a
// sender switches between them freely and often mixes them in one message.
// ─────────────────────────────────────────────────────────────────────────────
describe('Hindi and Hinglish commands', () => {
  describe('reassign', () => {
    it.each([
      'vedant ko task 4 de do',
      'वेदांत को टास्क 4 दे दो',
      'task 4 वेदांत को दे दो',
      'टास्क 4 vedant ko de do',          // mixed script, one message
    ])('reads %j as a reassignment', (text) => {
      const cmd = parseWithRules(text);
      expect(cmd?.intent).toBe('reassign_ticket');
      expect(cmd?.taskRef).toBe('TSK-4');
      expect(normaliseName(cmd?.targetName ?? '')).toBe('vedant');
    });
  });

  describe('create', () => {
    it.each([
      'sahil ke liye naya task banao',
      'साहिल के लिए नया टास्क बनाओ',
    ])('reads %j as a creation', (text) => {
      expect(parseWithRules(text)?.intent).toBe('create_task');
    });
  });

  describe('comment', () => {
    it.each([
      'task 4 par tippani likho',
      'टास्क 4 पर टिप्पणी लिखो',
    ])('reads %j as a comment', (text) => {
      const cmd = parseWithRules(text);
      expect(cmd?.intent).toBe('add_comment');
      expect(cmd?.taskRef).toBe('TSK-4');
    });
  });

  describe('priority', () => {
    it.each([
      ['task 4 ki priority zaruri kar do',  'High'],
      ['टास्क 4 की priority ज़रूरी कर दो',      'High'],
      ['task 4 ki priority kam kar do',     'Low'],
    ])('reads %j as priority %s', (text, priority) => {
      const cmd = parseWithRules(text);
      expect(cmd?.intent).toBe('set_priority');
      expect(cmd?.priority).toBe(priority);
    });
  });

  describe('deadline', () => {
    it.each([
      'task 4 ki deadline badal do kal tak',
      'टास्क 4 की deadline बदल दो कल तक',
    ])('reads %j as a deadline change', (text) => {
      const cmd = parseWithRules(text);
      expect(cmd?.intent).toBe('set_deadline');
      expect(cmd?.taskRef).toBe('TSK-4');
    });
  });

  describe('undo', () => {
    it.each(['vapas karo', 'वापस करो', 'undo karo'])('reads %j as undo', (text) => {
      expect(parseWithRules(text)?.intent).toBe('undo_last');
    });
  });

  describe('bulk', () => {
    it.each([
      'vedant ke saare task vikranth ko de do',
      'वेदांत के सारे टास्क विक्रांत को दे दो',
    ])('reads %j as a bulk move', (text) => {
      expect(parseWithRules(text)?.intent).toBe('bulk_reassign');
    });
  });

  // The guard that matters most. A worker reporting on their own work must
  // never be read as a command — otherwise "payment ho gaya" from a field
  // employee starts moving other people's tickets around.
  describe('a worker reporting their own work is never a command', () => {
    it.each([
      'ho gaya',
      'हो गया',
      'task 4 ho gaya',
      'टास्क 4 पूरा हो गया',
      'मैंने काम पूरा कर दिया',
      'kal tak kar dunga',
      'कल तक कर दूंगा',
      'dikkat aa gayi',
      'दिक्कत आ गई',
    ])('%j parses to null', (text) => {
      expect(parseWithRules(text)).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Outreach.
//
// The distinction these tests exist to protect: a message that DELEGATES work
// must create a task, and a message that does not must message the outside
// party. Getting it backwards either drops the instruction or messages a
// stranger about money — and both sentences look almost identical.
// ─────────────────────────────────────────────────────────────────────────────
describe('outreach', () => {
  describe('delegated — creates a task, contacts nobody outside', () => {
    it.each([
      ['Ask Sahil to send fabric samples to Urja Vart.',            'assign_sample_dispatch', 'Sahil',  'Urja Vart'],
      ['Tell Sahil to send samples to Urja',                        'assign_sample_dispatch', 'Sahil',  'Urja'],
      ['Can you ask Sahil to send the fabric samples to Urja Vart?','assign_sample_dispatch', 'Sahil',  'Urja Vart'],
      ['Assign Sahil the sample dispatch for Urja Vart',            'assign_sample_dispatch', 'Sahil',  'Urja Vart'],
      ['Create a task for Ashish to collect dues from Ramesh ji.',  'create_collection_task', 'Ashish', 'Ramesh'],
      ['Ask Vedant to create a sale for DGH.',                      'create_sales_task',      'Vedant', 'DGH'],
    ])('%j', (text, intent, employee, party) => {
      const cmd = parseWithRules(text);
      expect(cmd?.intent).toBe(intent);
      expect(normaliseName(cmd?.targetName ?? '')).toBe(normaliseName(employee));
      expect(cmd?.contactName).toBe(party);
    });

    // A store check often concerns nobody outside the company at all, so it is
    // the one delegated intent that does not need a party.
    it('reads a store check with no outside party', () => {
      const cmd = parseWithRules('Create a task for Gaurav to check whether XYZ fabric is available in the store.');
      expect(cmd?.intent).toBe('create_store_check_task');
      expect(normaliseName(cmd?.targetName ?? '')).toBe('gaurav');
      expect(cmd?.itemDescription).toBe('XYZ fabric');
    });

    it('captures the optional detail without demanding it', () => {
      const cmd = parseWithRules('Ask Sahil to send 2-meter samples of Fabric A12 and B14 to Urja Vart tomorrow.');
      expect(cmd?.intent).toBe('assign_sample_dispatch');
      expect(cmd?.contactName).toBe('Urja Vart');
      expect(cmd?.itemDescription).toContain('A12');
      expect(cmd?.deadlineText).toBe('tomorrow');
    });
  });

  describe('direct — messages the outside party', () => {
    it.each([
      ['Send a payment reminder of ₹45,000 to Ramesh Traders.',   'Ramesh Traders', 45_000, null],
      ['Remind ABC Traders about invoice INV-102 for ₹25,000.',   'ABC Traders',    25_000, 'INV-102'],
      ['Send a payment reminder of Rs 50000 to Metro Logistics',  'Metro Logistics', 50_000, null],
    ])('%j', (text, party, amount, reference) => {
      const cmd = parseWithRules(text);
      expect(cmd?.intent).toBe('send_payment_reminder');
      expect(cmd?.contactName).toBe(party);
      expect(cmd?.amount).toBe(amount);
      expect(cmd?.reference).toBe(reference);
      // No employee is being told to do anything — that is what makes it direct.
      expect(cmd?.targetName).toBeNull();
    });

    // The load-bearing case. Naming an employee turns the same subject matter
    // into internal work, and must NOT message the party.
    it('does not message the party when an employee is told to do it', () => {
      const cmd = parseWithRules('Ask Ashish to collect the ₹45,000 dues from Ramesh Traders');
      expect(cmd?.intent).toBe('create_collection_task');
      expect(normaliseName(cmd?.targetName ?? '')).toBe('ashish');
    });
  });

  describe('an amount is never read as a ticket number', () => {
    it.each([
      'Send a payment reminder of ₹45,000 to Ramesh Traders.',
      'Remind ABC Traders about invoice INV-102 for ₹25,000.',
    ])('%j carries no taskRef', (text) => {
      expect(parseWithRules(text)?.taskRef).toBeNull();
    });
  });

  describe('contact directory', () => {
    it('reads a registration with a name and a number', () => {
      const cmd = parseWithRules('register vendor Metro Logistics 9876543210');
      expect(cmd?.intent).toBe('register_contact');
      expect(cmd?.contactName).toBe('Metro Logistics');
      expect(cmd?.contactPhone).toBe('9876543210');
      expect(cmd?.contactType).toBe('vendor');
    });

    it('still returns the intent when the number is missing, so we can ask', () => {
      const cmd = parseWithRules('add customer Urja Vart');
      expect(cmd?.intent).toBe('register_contact');
      expect(cmd?.contactName).toBe('Urja Vart');
      expect(cmd?.contactPhone).toBeNull();
      expect(cmd?.confidence).toBeLessThan(0.9);
    });
  });

  describe('Hindi and Hinglish', () => {
    it.each([
      'Sahil ko bolo Urja Vart ko sample bhej de',
      'साहिल को बोलो उर्जा वर्त को सैंपल भेज दे',
    ])('%j delegates a sample dispatch', (text) => {
      expect(parseWithRules(text)?.intent).toBe('assign_sample_dispatch');
    });

    it('reads a Hinglish amount', () => {
      const cmd = parseWithRules('Ramesh Traders ko 45 hazaar ka payment reminder bhejo');
      expect(cmd?.intent).toBe('send_payment_reminder');
      expect(cmd?.amount).toBe(45_000);
    });
  });

  // The guard that must survive every change to this file. A worker reporting
  // on their own work must never trigger an outbound message about money.
  describe('a worker reporting is never outreach', () => {
    it.each([
      'payment ho gaya',
      'भुगतान हो गया',
      'sample bhej diya',
      'सैंपल भेज दिया',
      'stock check kar liya',
      'maal aa gaya',
    ])('%j parses to null', (text) => {
      expect(parseWithRules(text)).toBeNull();
    });
  });
});
