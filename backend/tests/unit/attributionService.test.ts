import { describe, expect, it } from 'vitest';
import { AttributionSource } from '@prisma/client';
import { decideAttribution, type AttributionInput } from '../../src/services/attributionService';

/**
 * The decision table that replaced the guessing. Every branch is covered,
 * because this is the function whose old behaviour marked the wrong task done.
 */

const T = (id: string, minutesAgo = 0) => ({
  id,
  updatedAt: new Date(Date.now() - minutesAgo * 60_000),
});

function input(over: Partial<AttributionInput> = {}): AttributionInput {
  return {
    explicitRef: null,
    refIsExplicit: false,
    replyToTaskId: null,
    ownedTaskIds: new Set(['TSK-1060', 'TSK-1061']),
    openTasks: [T('TSK-1061'), T('TSK-1060', 10)],
    lastAttributedTaskId: null,
    action: null,
    pendingTaskChoice: false,
    ...over,
  };
}

describe('decideAttribution — explicit references', () => {
  it('uses the task the worker named', () => {
    const d = decideAttribution(input({
      explicitRef: 'TSK-1060', refIsExplicit: true, action: 'done',
    }));
    expect(d.taskId).toBe('TSK-1060');
    expect(d.attributedBy).toBe(AttributionSource.explicit_ref);
    expect(d.needsAttribution).toBe(false);
  });

  it('REGRESSION: "task 1060 done" must not land on the newer TSK-1061', () => {
    // The exact shape of the reported bug — TSK-1061 is the most recently
    // updated open task, which is what the old code picked regardless of what
    // the worker actually said.
    const d = decideAttribution(input({
      explicitRef: 'TSK-1060',
      refIsExplicit: true,
      action: 'done',
      openTasks: [T('TSK-1061'), T('TSK-1060', 30)],
    }));
    expect(d.taskId).toBe('TSK-1060');
    expect(d.taskId).not.toBe('TSK-1061');
  });

  it('rejects a task that belongs to someone else', () => {
    const d = decideAttribution(input({
      explicitRef: 'TSK-9999', refIsExplicit: true, action: 'done',
    }));
    expect(d.rejected).toBe(true);
    expect(d.taskId).toBeNull();
  });

  it('does NOT reject on a bare number that matches someone else\'s task', () => {
    // "5000 units done" yields TSK-5000 from the last-resort pattern. Treating
    // that as an attempt to touch a colleague's task would silently drop a
    // legitimate message.
    const d = decideAttribution(input({
      explicitRef: 'TSK-5000',
      refIsExplicit: false,
      action: 'done',
      openTasks: [T('TSK-1060')],
    }));
    expect(d.rejected).toBe(false);
    expect(d.taskId).toBe('TSK-1060');
    expect(d.attributedBy).toBe(AttributionSource.single_open_task);
  });
});

describe('decideAttribution — no reference given', () => {
  it('attributes when there is exactly one open task', () => {
    const d = decideAttribution(input({
      action: 'done', openTasks: [T('TSK-1060')],
    }));
    expect(d.taskId).toBe('TSK-1060');
    expect(d.attributedBy).toBe(AttributionSource.single_open_task);
  });

  it('ASKS instead of guessing when several tasks are open', () => {
    const d = decideAttribution(input({ action: 'done' }));
    expect(d.taskId).toBeNull();
    expect(d.needsAttribution).toBe(true);
    expect(d.ambiguousAmong).toEqual(['TSK-1061', 'TSK-1060']);
  });

  it.each(['done', 'issue', 'delay', 'progress'] as const)(
    'asks for "%s" — every outcome that changes state',
    (action) => {
      const d = decideAttribution(input({ action }));
      expect(d.needsAttribution).toBe(true);
      expect(d.taskId).toBeNull();
    },
  );

  it('does not flag chatter with nothing to act on', () => {
    // "ok thanks" — recording it is right, asking which task is noise.
    const d = decideAttribution(input({ action: null }));
    expect(d.needsAttribution).toBe(false);
    expect(d.taskId).toBeNull();
  });

  it('attributes a follow-up to the task under discussion', () => {
    const d = decideAttribution(input({
      action: 'done', lastAttributedTaskId: 'TSK-1060',
    }));
    expect(d.taskId).toBe('TSK-1060');
    expect(d.attributedBy).toBe(AttributionSource.recent_context);
  });

  it('ignores conversational context pointing at a task they no longer own', () => {
    const d = decideAttribution(input({
      action: 'done', lastAttributedTaskId: 'TSK-4242',
    }));
    expect(d.needsAttribution).toBe(true);
  });

  it('changes nothing when the person has no open tasks', () => {
    const d = decideAttribution(input({ action: 'done', openTasks: [] }));
    expect(d.taskId).toBeNull();
    expect(d.needsAttribution).toBe(false);
    expect(d.attributedBy).toBe(AttributionSource.none);
  });
});

describe('decideAttribution — answering "which task?"', () => {
  it('treats a bare task id as the answer', () => {
    const d = decideAttribution(input({
      explicitRef: 'TSK-1060', refIsExplicit: true,
      action: null, pendingTaskChoice: true,
    }));
    expect(d.taskId).toBe('TSK-1060');
    expect(d.attributedBy).toBe(AttributionSource.list_reply);
  });

  it('REGRESSION: a new outcome is a new statement, not an answer', () => {
    // A "done" is parked awaiting a task. The worker then says
    // "TSK-1061 issue". Treating that as an answer would apply the parked
    // "done" and mark TSK-1061 complete — the opposite of what they said.
    const d = decideAttribution(input({
      explicitRef: 'TSK-1061', refIsExplicit: true,
      action: 'issue', pendingTaskChoice: true,
    }));
    expect(d.taskId).toBe('TSK-1061');
    expect(d.attributedBy).toBe(AttributionSource.explicit_ref);
  });
});

describe('decideAttribution — the message they replied to', () => {
  it('a button tap lands on the task its template was about', () => {
    // Six tasks open, no task number typed — but they pressed a button
    // attached to one specific message. That is not ambiguous.
    const d = decideAttribution(input({
      action: 'done', replyToTaskId: 'TSK-1060',
    }));
    expect(d.taskId).toBe('TSK-1060');
    expect(d.attributedBy).toBe(AttributionSource.reply_context);
    expect(d.needsAttribution).toBe(false);
  });

  it('a typed task number still beats what they replied to', () => {
    // Replying to TSK-1060's message while writing "TSK-1061 done" means
    // TSK-1061. The words win over the thing being quoted.
    const d = decideAttribution(input({
      explicitRef: 'TSK-1061', refIsExplicit: true,
      replyToTaskId: 'TSK-1060', action: 'done',
    }));
    expect(d.taskId).toBe('TSK-1061');
    expect(d.attributedBy).toBe(AttributionSource.explicit_ref);
  });

  it('beats the conversational context', () => {
    // They were discussing TSK-1061 a moment ago, then replied to TSK-1060's
    // escalation. The reply is the more specific signal.
    const d = decideAttribution(input({
      action: 'done', replyToTaskId: 'TSK-1060', lastAttributedTaskId: 'TSK-1061',
    }));
    expect(d.taskId).toBe('TSK-1060');
    expect(d.attributedBy).toBe(AttributionSource.reply_context);
  });

  it('ignores a quoted message about a task that is not theirs', () => {
    // Forwarded from a colleague, or re-assigned since. Falls through to ask.
    const d = decideAttribution(input({
      action: 'done', replyToTaskId: 'TSK-4242',
    }));
    expect(d.taskId).toBeNull();
    expect(d.needsAttribution).toBe(true);
  });

  it('REGRESSION: a bare outcome with no reply is still asked about', () => {
    // The whole point of the reply branch is that it only fires when the
    // worker actually pointed at something. Typing "पूरा हो गया" into the
    // thread with three tasks open must still ask, not pick the newest.
    const d = decideAttribution(input({ action: 'done', replyToTaskId: null }));
    expect(d.taskId).toBeNull();
    expect(d.needsAttribution).toBe(true);
    expect(d.ambiguousAmong).toEqual(['TSK-1061', 'TSK-1060']);
  });
});
