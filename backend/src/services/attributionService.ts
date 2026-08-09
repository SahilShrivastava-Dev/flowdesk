import { AttributionSource } from '@prisma/client';
import type { TaskAction } from './intentService';

/**
 * Decides which task an inbound WhatsApp message belongs to.
 *
 * This is deliberately PURE — no Prisma, no I/O, no clock. The caller gathers
 * the facts, this decides. That makes every branch below unit-testable with no
 * database, which matters because this function is where the misrouting bugs
 * lived.
 *
 * The rule that changed: the old implementation, when a worker said "done"
 * with several open tasks and named none, logged an AMBIGUOUS warning and then
 * picked the most recently updated task anyway. That guess is what marked
 * TSK-1061 done when the worker meant TSK-1060.
 *
 * It no longer guesses on an actionable message. It asks.
 */

export interface CandidateTask {
  id: string;
  /** Most recent first — the caller orders these. */
  updatedAt: Date;
}

export interface AttributionInput {
  /** Normalised `TSK-<n>` found in the message, or null. */
  explicitRef: string | null;
  /**
   * True when the reference had a real prefix ("TSK-1060", "task 1060") rather
   * than being a bare number that merely looks like one. "5000 units done"
   * yields a ref but not an explicit one, so it must never reject the message.
   */
  refIsExplicit: boolean;
  /**
   * The task belonging to the message this one is a reply to.
   *
   * WhatsApp sets `context.id` when somebody taps a quick-reply button on a
   * template or swipe-replies to a message, and every template we send is
   * stored with its `waMessageId` and `taskId` — so this is an exact link, not
   * an inference. It is the whole answer to "which of my six tasks did they
   * mean": they pointed at one.
   */
  replyToTaskId: string | null;
  /** Every task assigned to this person, regardless of status. */
  ownedTaskIds: Set<string>;
  /** Their not-Done tasks, most recently updated first. */
  openTasks: CandidateTask[];
  /**
   * The task the previous message in this conversation was attributed to,
   * if that message is recent enough to still be "what we're talking about".
   */
  lastAttributedTaskId: string | null;
  /** What the worker is reporting. */
  action: TaskAction;
  /** True when an earlier message is still waiting for the worker to pick a task. */
  pendingTaskChoice: boolean;
}

export interface AttributionDecision {
  taskId: string | null;
  attributedBy: AttributionSource;
  /** Actionable but unroutable — flag it and ask the worker which task. */
  needsAttribution: boolean;
  /** They named a task that isn't theirs. Record the message, change nothing. */
  rejected: boolean;
  /** Populated only when needsAttribution — the options to offer. */
  ambiguousAmong: string[];
}

/**
 * Outcomes that change a task's state, and therefore must never be guessed.
 * `progress` is here because "1054 in progress" moves the task to In Progress —
 * it stopped being harmless chatter the moment it started changing status.
 */
const ACTIONABLE: TaskAction[] = ['done', 'issue', 'delay', 'progress'];

function decision(
  taskId: string | null,
  attributedBy: AttributionSource,
  extra: Partial<AttributionDecision> = {},
): AttributionDecision {
  return {
    taskId,
    attributedBy,
    needsAttribution: false,
    rejected: false,
    ambiguousAmong: [],
    ...extra,
  };
}

export function decideAttribution(input: AttributionInput): AttributionDecision {
  const {
    explicitRef, refIsExplicit, replyToTaskId, ownedTaskIds, openTasks,
    lastAttributedTaskId, action, pendingTaskChoice,
  } = input;

  // ── 1. The worker named a task ───────────────────────────────────────────
  if (explicitRef) {
    if (ownedTaskIds.has(explicitRef)) {
      // A bare task reference while an earlier message awaits a choice is the
      // worker answering our question — by tapping the list or typing the id.
      //
      // It only counts as an answer when the message carries no outcome of its
      // own. "TSK-1055 issue" after a parked "done" is a NEW statement about a
      // different task, not an answer; treating it as an answer would apply the
      // parked "done" to TSK-1055 and mark the wrong task complete.
      const isBareAnswer = pendingTaskChoice && action === null;
      return decision(
        explicitRef,
        isBareAnswer ? AttributionSource.list_reply : AttributionSource.explicit_ref,
      );
    }

    // Named a task that isn't theirs. Only treat this as an attempt to act on
    // someone else's work when they actually spelled it out — a bare number
    // could be a quantity ("5000 units done") that happens to collide with a
    // colleague's task ID.
    if (refIsExplicit) {
      return decision(null, AttributionSource.none, { rejected: true });
    }
    // Bare number that matched nothing of theirs — ignore it and fall through.
  }

  // ── 2. The message they replied to ───────────────────────────────────────
  //
  // Checked before conversational context because it is not a guess at all:
  // tapping "Done" on the escalation for TSK-2, or swipe-replying to it, points
  // at exactly one task. Somebody holding six tasks who taps a button has told
  // us which one, and asking them "which task did you mean?" after that is both
  // wrong and insulting.
  //
  // It sits BELOW the explicit reference so that replying to TSK-2's message
  // while typing "TSK-5 done" still does what the words say.
  if (replyToTaskId && ownedTaskIds.has(replyToTaskId)) {
    return decision(replyToTaskId, AttributionSource.reply_context);
  }

  // ── 3. The task the conversation is already about ────────────────────────
  //
  // Checked BEFORE "only one open task", because what was just discussed is
  // stronger evidence than what happens to be left. Otherwise "task 1060 done"
  // followed by "here's the photo" files the photo against 1061 — 1060 having
  // just closed is exactly why it's no longer the lone open task.
  if (lastAttributedTaskId && ownedTaskIds.has(lastAttributedTaskId)) {
    const stillOpen = openTasks.some((t) => t.id === lastAttributedTaskId);
    // Only a message with NO outcome inherits the previous task — a photo, an
    // acknowledgement. Now that "in progress" moves a task to In Progress it
    // counts as an outcome, so "task 1060 done" followed by "1055 in progress"
    // must not reopen the task that was just closed.
    const addsNoOutcome = action === null;

    // Use it while that task is still open, or when this message reports
    // nothing new. A *fresh* outcome after the task closed is far more likely
    // to be about different work, so that case falls through — otherwise a
    // worker finishing their last two tasks in a row would see the second
    // "done" swallowed by the already-completed first one.
    if (stillOpen || addsNoOutcome) {
      return decision(lastAttributedTaskId, AttributionSource.recent_context);
    }
  }

  // ── 4. No task to attribute to ───────────────────────────────────────────
  if (openTasks.length === 0) {
    return decision(null, AttributionSource.none);
  }

  // ── 5. Exactly one candidate — not a guess ───────────────────────────────
  if (openTasks.length === 1) {
    return decision(openTasks[0].id, AttributionSource.single_open_task);
  }

  // ── 6. Several candidates, no context ────────────────────────────────────
  // Actionable and genuinely ambiguous — this is the branch that used to
  // guess. Record the message, change no status, ask which task.
  if (action && ACTIONABLE.includes(action)) {
    return decision(null, AttributionSource.none, {
      needsAttribution: true,
      ambiguousAmong: openTasks.map((t) => t.id),
    });
  }

  // Chatter ("on my way", "ok") with nothing to act on. Record it and move on —
  // no flag, because there's no pending decision for anyone to make.
  return decision(null, AttributionSource.none);
}
