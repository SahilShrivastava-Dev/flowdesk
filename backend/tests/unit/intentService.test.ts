import { beforeAll, describe, expect, it } from 'vitest';
import {
  analyzeMessage, extractTaskRef, hasExplicitTaskRef, parseLooseJson,
} from '../../src/services/intentService';

// Force the keyword fallback path — these tests must not make network calls.
beforeAll(() => {
  delete process.env.NVIDIA_API_KEY;
});

describe('extractTaskRef', () => {
  it.each([
    ['TSK-1058 done',            'TSK-1058'],
    ['Tsk 1058',                 'TSK-1058'],
    ['tsk1058 ho gaya',          'TSK-1058'],
    ['tsk_1058',                 'TSK-1058'],
    ['Task-1058',                'TSK-1058'],
    ['Task -1058',               'TSK-1058'],   // reported in the field
    ['task no 1058',             'TSK-1058'],
    ['task number 1058',         'TSK-1058'],
    ['task #1058',               'TSK-1058'],
    ['T S K 1058',               'TSK-1058'],   // speech-to-text spells it out
    ['टास्क 1058 पूरा हो गया',      'TSK-1058'],
    ['कार्य क्रमांक 1058',           'TSK-1058'],
    ['1058 done',                'TSK-1058'],   // bare number, last resort
    ['Task 1058 completed and I clicked the picture also.', 'TSK-1058'],
  ])('parses %j', (text, expected) => {
    expect(extractTaskRef(text)).toBe(expected);
  });

  // Short ids. A fresh deployment numbers its tasks from TSK-1, so requiring
  // three digits made every task on a new client invisible to this parser —
  // which left the whole feature depending on the AI layer being reachable.
  it.each([
    ['Assign task 4 to Vedant',   'TSK-4'],
    ['TSK-4 done',                'TSK-4'],
    ['tsk4 ho gaya',              'TSK-4'],
    ['task 12 done',              'TSK-12'],
    ['Assign task 44 to Vedant',  'TSK-44'],
    ['task #7',                   'TSK-7'],
    ['टास्क 4 पूरा हो गया',         'TSK-4'],
    ['कार्य क्रमांक 4',              'TSK-4'],
  ])('parses the short form %j', (text, expected) => {
    expect(extractTaskRef(text)).toBe(expected);
  });

  it.each([
    'done',
    'need 2 more days',
    '3 boxes left',
    'on my way',
    'level 3 escalation',
    '',
    '   ',
  ])('finds no task number in %j', (text) => {
    expect(extractTaskRef(text)).toBeNull();
  });

  // "काम"/"कार्य" mean work in general, not only "task", so a bare small number
  // after them is far likelier to be a time or a quantity than an id. They keep
  // the 3-digit floor that "टास्क" — a loanword that only ever means task —
  // does not need.
  it.each([
    'काम 2 घंटे में हो जाएगा',
    'कार्य 3 दिन में',
  ])('does not read a quantity after काम/कार्य as a task in %j', (text) => {
    expect(extractTaskRef(text)).toBeNull();
  });

  // Money collides with the bare-number fallback. Every rupee amount an Indian
  // business types sits in the same 4–6 digit range a task id does, so
  // "remind Metro about 45000" used to resolve to TSK-45000 and quietly point
  // an outreach command at a ticket that has nothing to do with it.
  it.each([
    'remind Metro Logistics about 45000 due Friday',
    'send a payment reminder of ₹45,000',
    'Rs. 45000 pending from Ramesh Traders',
    'payment of 25000 is outstanding',
    'clear invoice INV-2231',
    'बकाया 45000 का भुगतान',
    '45 हज़ार का payment reminder भेजो',
  ])('does not read an amount or invoice number as a task in %j', (text) => {
    expect(extractTaskRef(text)).toBeNull();
  });

  // The masking that makes the above work must never touch a number that
  // states its own prefix — otherwise fixing money would break the far more
  // common case of a manager naming a ticket alongside an amount.
  it.each([
    ['payment for task 1058 is 45000',        'TSK-1058'],
    ['TSK-1058 — ₹45,000 collected',          'TSK-1058'],
    ['task 4 invoice INV-102 done',           'TSK-4'],
    ['टास्क 1058 का बकाया 45000',                'TSK-1058'],
  ])('still reads the stated task number in %j', (text, expected) => {
    expect(extractTaskRef(text)).toBe(expected);
  });

  // Outreach commands carry amounts and invoice numbers and never name a
  // ticket by bare number, so they opt out of the fallback entirely.
  it('drops the bare fallback when the caller opts out', () => {
    expect(extractTaskRef('1058 done')).toBe('TSK-1058');
    expect(extractTaskRef('1058 done', { allowBare: false })).toBeNull();
    // A stated reference still resolves — opting out only silences guessing.
    expect(extractTaskRef('task 1058 done', { allowBare: false })).toBe('TSK-1058');
  });

  it('reads the task number, not the quantity', () => {
    expect(extractTaskRef('I need 2 days for task 1057')).toBe('TSK-1057');
    expect(extractTaskRef('I need 2 days for task 7')).toBe('TSK-7');
  });

  it('normalises away leading zeros and separators', () => {
    expect(extractTaskRef('TSK-0042')).toBe('TSK-42');
  });
});

describe('hasExplicitTaskRef', () => {
  it.each([
    'TSK-1058', 'Tsk 1058', 'task 1058', 'Task -1058', 'टास्क 1058',
    // Short ids count as explicit too. This is what gates the "that task
    // isn't yours" rejection, so while it was false for TSK-4 a worker could
    // name a colleague's task and have it quietly attributed elsewhere.
    'TSK-4', 'task 4', 'task 12', 'टास्क 4',
  ])(
    'is true for the prefixed form %j', (t) => expect(hasExplicitTaskRef(t)).toBe(true),
  );

  it.each(['1058 done', '5000 units done', 'done', 'need 2 more days'])(
    'is false for %j — a bare number must never reject a message', (t) =>
      expect(hasExplicitTaskRef(t)).toBe(false),
  );
});

describe('parseLooseJson', () => {
  const want = { action: 'done', taskNumber: '1060' };

  it('parses bare JSON', () => {
    expect(parseLooseJson('{"action":"done","taskNumber":"1060"}')).toMatchObject(want);
  });

  it('parses a fenced block', () => {
    expect(parseLooseJson('```json\n{"action":"done","taskNumber":"1060"}\n```')).toMatchObject(want);
  });

  it('parses JSON followed by commentary', () => {
    expect(parseLooseJson('{"action":"done","taskNumber":"1060"}\n\nHope that helps!')).toMatchObject(want);
  });

  it('parses JSON preceded by reasoning', () => {
    expect(parseLooseJson('Let me think. The worker said done.\n{"action":"done","taskNumber":"1060"}'))
      .toMatchObject(want);
  });

  it('returns null on unparseable output', () => {
    expect(parseLooseJson('I think the task is done')).toBeNull();
    expect(parseLooseJson('{not valid json')).toBeNull();
    expect(parseLooseJson('')).toBeNull();
  });
});

describe('analyzeMessage — keyword fallback (no API key)', () => {
  it.each([
    ['task 1058 done',           'done',  'TSK-1058'],
    ['1058 ho gaya',             'done',  'TSK-1058'],
    ['झालंय',                     'done',  null],
    ['dikkat aa gayi',           'issue', null],
    ['टास्क 1057 में दिक्कत है',      'issue', 'TSK-1057'],
    ['kal tak kar dunga',        'delay', null],
    ['1054 in progress',         'progress', 'TSK-1054'],
    ['working on task 1054',     'progress', 'TSK-1054'],
    ['task 1054 shuru kar diya', 'progress', 'TSK-1054'],
    // "will complete soon" is a start, not a completion — the done bank must
    // not win on the word "complete".
    ['1054 in progress, will complete soon', 'progress', 'TSK-1054'],
  ])('reads %j as %s', async (text, action, taskRef) => {
    const r = await analyzeMessage(text);
    expect(r.action).toBe(action);
    expect(r.taskRef).toBe(taskRef);
    expect(r.confidence).toBe('keyword');
  });

  it('flags a mention of photographic proof', async () => {
    expect((await analyzeMessage('task 1058 done, photo bhej diya')).mentionsProof).toBe(true);
    expect((await analyzeMessage('task 1058 done')).mentionsProof).toBe(false);
  });

  it('reports no action for genuine chatter', async () => {
    const r = await analyzeMessage('ok thanks');
    expect(r.action).toBeNull();
    expect(r.confidence).toBe('none');
  });

  it('handles empty input without calling anything', async () => {
    const r = await analyzeMessage('');
    expect(r).toEqual({
      action: null, taskRef: null, mentionsProof: false, summary: '', confidence: 'none',
    });
  });
});
