import { prisma } from '../lib/prisma';

// ─────────────────────────────────────────────────────────────────────────────
// Short multi-message conversations.
//
//   User:   Assign TSK-1059 to Vikranth
//   System: I found two people named Vikranth. Which one?
//   User:   Vikranth Sharma
//   System: Confirm reassignment of TSK-1059 to Vikranth Sharma?
//   User:   Confirm
//   System: Done.
//
// The state that carries those three turns lives in Postgres, not in memory,
// for two reasons: Render restarts the process freely, and an in-memory map
// would silently stop working the moment the service runs more than one
// instance — with the failure mode being "the confirmation vanished", which is
// exactly the kind of bug nobody reproduces.
//
// Two properties matter more than the storage choice:
//
//   • It is keyed by the RESOLVED user id, never by the phone number in the
//     webhook payload. A forged `from` cannot claim somebody else's pending
//     confirmation.
//   • The payload is a DRAFT. It is re-validated from scratch when it is
//     finally executed — being held in state grants no authority. If the
//     manager loses the report between asking and confirming, the confirmation
//     is refused.
// ─────────────────────────────────────────────────────────────────────────────

export type StateKind =
  | 'confirm'
  | 'choose_employee'
  | 'choose_task'
  /** Which external party the sender meant, when several names are close. */
  | 'choose_contact'
  | 'choose_option';

/** How long a pending question stays answerable. */
export function stateTtlMs(): number {
  const seconds = parseInt(process.env.WA_STATE_TTL_S ?? '600', 10);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 600) * 1000;
}

export interface PendingState<P = unknown, O = unknown> {
  kind:      StateKind;
  payload:   P;
  options:   O[];
  expiresAt: Date;
}

/**
 * The live question for this person, or null.
 *
 * An expired row is deleted rather than returned. Sweeping on read is enough
 * here — the table only ever holds one row per person, so there is nothing to
 * accumulate, and a cron for it would be machinery without a purpose.
 */
export async function getState<P = unknown, O = unknown>(
  userId: string,
): Promise<PendingState<P, O> | null> {
  const row = await prisma.conversationState.findUnique({ where: { userId } });
  if (!row) return null;

  if (row.expiresAt.getTime() <= Date.now()) {
    await prisma.conversationState.deleteMany({ where: { userId } });
    console.log(`[State] ${userId}: pending "${row.kind}" expired — discarded`);
    return null;
  }

  return {
    kind:      row.kind as StateKind,
    payload:   row.payload as P,
    options:   (row.options ?? []) as O[],
    expiresAt: row.expiresAt,
  };
}

/**
 * Record what we've just asked. Replaces any existing question — a manager who
 * sends a fresh command mid-clarification means the new one, and leaving the
 * old one live would let a bare "confirm" apply to something they'd moved on from.
 */
export async function setState(
  userId: string,
  kind: StateKind,
  payload: unknown,
  options: unknown[] = [],
): Promise<void> {
  const expiresAt = new Date(Date.now() + stateTtlMs());
  const data = {
    kind,
    payload:  payload as object,
    options:  options as object,
    expiresAt,
  };

  await prisma.conversationState.upsert({
    where:  { userId },
    create: { userId, ...data },
    update: data,
  });
}

export async function clearState(userId: string): Promise<void> {
  await prisma.conversationState.deleteMany({ where: { userId } });
}

// ─── Reply interpretation ─────────────────────────────────────────────────────

const AFFIRMATIVE = [
  'confirm', 'confirmed', 'yes', 'y', 'yeah', 'yep', 'ok', 'okay', 'sure',
  'go ahead', 'do it', 'proceed', 'correct', 'right',
  // Hindi / Marathi, romanised and Devanagari — the same languages the worker
  // keyword banks already cover.
  'haan', 'han', 'ha', 'ji', 'ji haan', 'theek hai', 'thik hai', 'karo', 'kar do',
  'हाँ', 'हां', 'ठीक है', 'करो', 'कर दो', 'होय', 'बरोबर',
];

const NEGATIVE = [
  'cancel', 'no', 'n', 'nope', 'stop', 'abort', 'nevermind', 'never mind',
  'wrong', 'incorrect', 'dont', "don't", 'do not',
  'nahi', 'nahin', 'mat karo', 'rehne do', 'nako',
  'नहीं', 'मत करो', 'रहने दो', 'नको',
];

export type ConfirmReply = 'yes' | 'no' | 'unclear';

/**
 * Read a confirmation reply.
 *
 * Exact-match on a normalised whole string, not a substring scan. That is
 * deliberate: "no problem, confirm" contains both banks, and a substring check
 * would resolve it by whichever list happened to be tested first. Anything that
 * isn't unambiguously one or the other comes back `unclear`, and an unclear
 * answer to "shall I reassign this?" must never be read as yes.
 */
export function readConfirmation(text: string): ConfirmReply {
  const normalised = text.trim().toLowerCase().replace(/[.!,?"']/g, '').replace(/\s+/g, ' ');
  if (!normalised) return 'unclear';

  if (AFFIRMATIVE.includes(normalised)) return 'yes';
  if (NEGATIVE.includes(normalised))    return 'no';
  return 'unclear';
}

/**
 * Read a pick from a numbered list — "2", "option 2", "#2".
 * Returns a zero-based index, or null when the reply isn't a number in range.
 */
export function readChoiceIndex(text: string, optionCount: number): number | null {
  const match = text.trim().match(/^(?:option\s*|#)?(\d{1,2})[.)]?$/i);
  if (!match) return null;

  const n = parseInt(match[1], 10);
  return n >= 1 && n <= optionCount ? n - 1 : null;
}
