import { transliterate } from '../lib/devanagari';

// ─────────────────────────────────────────────────────────────────────────────
// Turning "Vikrant" into a specific employee — or refusing to.
//
// Deliberately PURE: no Prisma, no clock, no I/O. The caller gathers the
// candidates, this ranks them. That matters twice over. It makes every
// threshold decision testable without a database, and it makes the security
// property visible at the call site rather than buried in here:
//
//   THE CANDIDATE LIST IS THE PERMISSION BOUNDARY.
//
// Callers pass `assignableUsers(actor)` — only people the sender may actually
// assign work to. Somebody outside the manager's hierarchy is not scored badly,
// they are absent. So the answer to "assign this to <the CEO>" is "nobody by
// that name in your team", and the reply cannot confirm that such a person
// exists anywhere in the system. Filtering after the fact would leak that.
// ─────────────────────────────────────────────────────────────────────────────

export interface Candidate {
  id: string;
  name: string;
}

export interface ScoredCandidate<C extends Candidate = Candidate> {
  user: C;
  /** 0–1. Exactly 1 means a normalised exact match on the whole name or a name part. */
  score: number;
}

export interface NameResolution<C extends Candidate = Candidate> {
  status: 'matched' | 'ambiguous' | 'not_found';
  /** Set only when `status === 'matched'`. */
  match?: ScoredCandidate<C>;
  /**
   * True when the match was good but not exact — a typo, or a partial name.
   * The caller must confirm with the sender before acting.
   */
  requiresConfirmation: boolean;
  /** The options to offer when ambiguous; the near-misses otherwise. */
  candidates: ScoredCandidate<C>[];
}

/**
 * Good enough to put in front of the sender as "did you mean…?".
 * "Vikrant" → "Vikranth" scores 0.875, which is the case this has to catch.
 */
const ACCEPT = 0.82;

/** Worth mentioning, but only with a confirmation step. */
const CONSIDER = 0.6;

/** Below this length a prefix match is too weak to mean anything. */
const MIN_PREFIX = 4;

/**
 * Reduce a name to a matching key: transliterate Devanagari, strip accents,
 * lowercase, drop punctuation, collapse whitespace.
 *
 *   "Vikrànth  Sharma."  →  "vikranth sharma"
 *   "रमेश"                →  "ramesh"
 *
 * The transliteration step has to come first. The whitelist below keeps only
 * `[a-z0-9\s]`, so before this a Devanagari name was deleted down to the empty
 * string — it scored 0 against every candidate, could never be resolved, and
 * could never be matched by its own Roman spelling either, since the two
 * scripts share no codepoints for Levenshtein to work with.
 */
export function normaliseName(raw: string): string {
  return transliterate(raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // combining accents
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Levenshtein edit distance, two-row DP.
 *
 * Hand-rolled rather than pulled in as a dependency: it is fifteen lines, it is
 * the only string metric this needs, and a name matcher deciding who gets
 * assigned work should not have a supply chain.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,        // deletion
        curr[j - 1] + 1,    // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
}

/** 1 for identical, decaying with edit distance relative to the longer string. */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/**
 * How well `query` names `fullName`.
 *
 * Scored against the whole name AND each part of it, taking the best. People
 * say "Vikranth" far more often than "Vikranth Sharma", and a whole-string
 * comparison alone would score the short form badly against the long name.
 */
export function scoreName(query: string, fullName: string): number {
  const q = normaliseName(query);
  const n = normaliseName(fullName);
  if (!q || !n) return 0;
  if (q === n) return 1;

  let best = similarity(q, n);

  for (const part of n.split(' ')) {
    if (!part) continue;
    if (part === q) return 1;              // exact hit on a name part
    best = Math.max(best, similarity(q, part));

    // "Vikr" → "Vikranth". Scored into the confirm band on purpose, never the
    // act-immediately band: a four-letter prefix is a hint, not an identification.
    if (q.length >= MIN_PREFIX && part.startsWith(q)) best = Math.max(best, 0.75);
  }

  return best;
}

/**
 * Pick the employee the sender meant, or say why we can't.
 *
 * The rule that does the real work: **only an exact match acts without
 * confirmation.** A near match is still a match — "Vikrant" resolves to
 * "Vikranth Sharma" rather than failing — but the sender is asked to confirm
 * before the ticket moves. That is the difference between tolerating a typo and
 * silently guessing, and the spec is explicit that the second is not allowed.
 *
 * Ties are ambiguous by construction: two people whose first name is Vikranth
 * both score 1.0 for "Vikranth", so neither is chosen and both are offered.
 */
export function resolveName<C extends Candidate>(
  query: string,
  candidates: C[],
): NameResolution<C> {
  const q = normaliseName(query ?? '');
  if (!q || candidates.length === 0) {
    return { status: 'not_found', requiresConfirmation: false, candidates: [] };
  }

  const scored = candidates
    .map((user) => ({ user, score: scoreName(q, user.name) }))
    .sort((a, b) => b.score - a.score);

  // Bands are tried strongest-first. A single exact match wins outright even if
  // several weaker candidates also clear ACCEPT — otherwise adding a new hire
  // with a vaguely similar name would start making unambiguous commands ambiguous.
  for (const [threshold, exact] of [[1, true], [ACCEPT, false], [CONSIDER, false]] as const) {
    const band = scored.filter((s) => (exact ? s.score === 1 : s.score >= threshold));
    if (band.length === 0) continue;

    if (band.length === 1) {
      return {
        status: 'matched',
        match: band[0],
        requiresConfirmation: band[0].score < 1,
        candidates: band,
      };
    }

    return { status: 'ambiguous', requiresConfirmation: true, candidates: band };
  }

  return { status: 'not_found', requiresConfirmation: false, candidates: [] };
}
