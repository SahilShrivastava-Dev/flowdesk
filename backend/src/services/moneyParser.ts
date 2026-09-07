// ─────────────────────────────────────────────────────────────────────────────
// Money and document references
//
// This exists because of a collision that is invisible until money enters the
// system. `extractTaskRef` ends its pattern list with a bare `\b(\d{4,6})\b`
// fallback, so a naked four-to-six digit number is read as a task id. Every
// rupee amount an Indian business types sits in exactly that range:
//
//   "remind Metro Logistics about 45000 due Friday"  →  TSK-45000
//
// The fallback is right for a worker replying "1058 ho gaya" and wrong for a
// manager quoting an amount, and neither knows about the other. So the amount
// is recognised FIRST and masked out of the text before task-ref extraction
// runs — the digits stop existing as far as the task parser is concerned.
//
// The same applies to document references. "INV-102" and "PO-7781" carry digits
// that are not task numbers either.
//
// Everything here is pure: no clock, no database, no I/O.
// ─────────────────────────────────────────────────────────────────────────────

/** What a scale word multiplies by. Indian units alongside the English ones. */
const SCALE: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  hazaar: 1_000,
  hazar: 1_000,
  hajaar: 1_000,
  hzr: 1_000,
  'हज़ार': 1_000,
  'हजार': 1_000,
  lakh: 100_000,
  lakhs: 100_000,
  lac: 100_000,
  lacs: 100_000,
  'लाख': 100_000,
  crore: 10_000_000,
  crores: 10_000_000,
  cr: 10_000_000,
  'करोड़': 10_000_000,
  'करोड': 10_000_000,
};

const SCALE_ALTERNATION = Object.keys(SCALE)
  .sort((a, b) => b.length - a.length) // longest first, so "lakhs" beats "lakh"
  .join('|');

/**
 * A number as people actually write one: `45000`, `45,000`, `1,20,000`
 * (Indian grouping), `45.50`.
 */
const NUM = String.raw`\d[\d,]*(?:\.\d{1,2})?`;

/** Currency markers that can lead a number. */
const CURRENCY_BEFORE = String.raw`(?:₹|₨|Rs\.?|INR|रु\.?|रू\.?)`;

/** Currency markers that can trail one, including the ubiquitous "/-". */
const CURRENCY_AFTER = String.raw`(?:rupees?|rupaye|रुपये|रुपए|रुपया|\/\-|\/=)`;

/**
 * Ordered most-specific first, exactly like the task-ref list. Each pattern
 * captures the digits in group 1 and, where one exists, the scale word in
 * group 2.
 *
 * The last pattern — a number carrying thousands separators — has no currency
 * marker at all. It is here because "45,000" is a formatted quantity in a way
 * "45000" is not: nobody writes a task number with a comma in it, and the
 * separator is the only signal available when somebody types "remind them
 * about 45,000".
 */
/**
 * A right-hand boundary that works on Devanagari.
 *
 * `\b` is defined against ASCII word characters, so a boundary immediately
 * after `हज़ार` only exists when the next character is ASCII-word-ish — which
 * in ordinary Hindi it never is. `45 हज़ार का भुगतान` therefore failed to match
 * at all. `(?!\w)` asks the question that was actually meant: is the scale
 * word finished?
 */
const END = String.raw`(?!\w)`;

const MONEY_PATTERNS: RegExp[] = [
  // ₹45,000 / Rs. 45000 / INR 1,20,000 — optionally with a scale word after
  new RegExp(String.raw`${CURRENCY_BEFORE}\s*(${NUM})\s*(${SCALE_ALTERNATION})?${END}`, 'i'),
  // 45,000 rupees / 45000/- / 2 lakh rupaye
  new RegExp(String.raw`\b(${NUM})\s*(${SCALE_ALTERNATION})?\s*${CURRENCY_AFTER}`, 'i'),
  // 45 hazaar / 2 lakh / 45k / 2 करोड़ — a scale word is itself a money signal
  new RegExp(String.raw`\b(${NUM})\s*(${SCALE_ALTERNATION})${END}`, 'i'),
  // 45,000 — grouped digits, no marker. Deliberately last.
  new RegExp(String.raw`\b(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?)\b()`),
];

/**
 * Spelled-out document words, mapped to the short prefix they mean. A sender
 * who writes "bill no 4471" gets back `BILL-4471`, not a reference to an
 * invoice they never mentioned.
 */
const DOC_PREFIX: Record<string, string> = {
  inv: 'INV', invoice: 'INV', 'इनवॉइस': 'INV',
  bill: 'BILL', 'बिल': 'BILL',
  challan: 'CHL', chl: 'CHL', 'चालान': 'CHL',
  order: 'SO', so: 'SO', 'ऑर्डर': 'SO',
  po: 'PO', do: 'DO', grn: 'GRN', ref: 'REF',
};

/**
 * Document references that carry digits which are not task numbers.
 * Ordered so the prefixed forms win before the looser "invoice 102" phrasing.
 *
 * Every pattern captures the SAME two groups — the word naming the document
 * type, then the digits — so the caller needs no per-pattern special casing.
 */
const DOC_REF_PATTERNS: RegExp[] = [
  // INV-102 / INV 102 / SO-1187 / PO-7781 — a short prefix glued to digits
  /\b(INV|BILL|PO|SO|DO|GRN|CHL|REF)[\s\-_/#.]*(\d{1,10})\b/i,
  // invoice no 102 / bill number 4471 / order # 1187
  /\b(invoice|bill|challan|order)\s*(?:number|no\.?|num|#)?\s*[-#:]?\s*(\d{1,10})\b/i,
  // बिल नंबर 102 — no \b anywhere: it would not match after Devanagari
  /(बिल|चालान|इनवॉइस|ऑर्डर)\s*(?:नंबर|क्रमांक|नं\.?)?\s*[-#:]?\s*(\d{1,10})/,
];

export interface ParsedAmount {
  /** The resolved value in whole currency units. `2 lakh` → 200000. */
  value: number;
  /** ISO code. Only INR is produced today; the field exists so callers do not
   *  have to be rewritten when a second currency appears. */
  currency: string;
  /** Exactly as the sender wrote it, for reading back in a confirmation. */
  raw: string;
}

/**
 * Pull the first amount out of free text.
 *
 * Returns null when there is no money in the message — which is the common
 * case, and why every caller must handle it rather than defaulting to zero.
 */
export function extractAmount(text: string): ParsedAmount | null {
  if (!text?.trim()) return null;

  for (const pattern of MONEY_PATTERNS) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;

    const digits = match[1].replace(/,/g, '');
    const base = parseFloat(digits);
    if (!Number.isFinite(base)) continue;

    const scaleWord = match[2]?.toLowerCase();
    const multiplier = scaleWord ? (SCALE[scaleWord] ?? 1) : 1;

    return {
      value: Math.round(base * multiplier * 100) / 100,
      currency: 'INR',
      raw: match[0].trim(),
    };
  }
  return null;
}

/**
 * Pull the first document reference out of free text, normalised to upper case
 * with a single hyphen: "inv 102" → "INV-102".
 *
 * The spelled-out forms keep their own meaning — "bill no 4471" is
 * `BILL-4471`, not `INV-4471`.
 */
export function extractDocRef(text: string): string | null {
  if (!text?.trim()) return null;

  for (const pattern of DOC_REF_PATTERNS) {
    const match = text.match(pattern);
    if (!match?.[2]) continue;

    const prefix = DOC_PREFIX[match[1].toLowerCase()] ?? match[1].toUpperCase();
    return `${prefix}-${match[2]}`;
  }
  return null;
}

/**
 * Vocabulary that makes a nearby bare number an amount rather than a task id.
 *
 * These are used ONLY when masking for the bare-number fallback (see
 * `maskNonTaskDigits`), never against the prefixed task patterns — so
 * "payment for task 1058" keeps its task reference. That separation is what
 * lets this list be aggressive: the cost of a false positive here is that a
 * BARE number stops being guessed at, which is the conservative outcome.
 */
const MONEY_CONTEXT = String.raw`payment|amount|due|pending|outstanding|balance|invoice|bill|paid|clear|settle|bakaya|baki|rakam|raashi|bhugtan|भुगतान|बकाया|बाकी|राशि|रकम|रुपये|बिल`;

const MONEY_CONTEXT_PATTERNS: RegExp[] = [
  // "…pending 45000", "payment of 45000"
  new RegExp(String.raw`(?:${MONEY_CONTEXT})[^.!?\n]{0,24}?\b(\d{3,9})\b`, 'i'),
  // "45000 due Friday", "45000 ka payment"
  new RegExp(String.raw`\b(\d{3,9})\b[^.!?\n]{0,24}?(?:${MONEY_CONTEXT})`, 'i'),
];

/** The character digits are replaced with. Not a digit, not a word character,
 *  and not `#` — which `task #1058` uses as a separator. */
const MASK_CHAR = '•';

/**
 * Blank out the digits of every amount, document reference, and
 * money-context number in `text`, leaving length and word boundaries intact.
 *
 * Intended for ONE caller: the bare-number task-ref fallback. The prefixed
 * task patterns must run against the original text, or "payment for task
 * 1058" would lose the reference it plainly states.
 *
 * Length is preserved so that any index a caller computed against the original
 * string still points at the same place, and so masking can never join two
 * words into one.
 */
export function maskNonTaskDigits(text: string): string {
  if (!text) return text;

  let out = text;
  for (const pattern of [...MONEY_PATTERNS, ...DOC_REF_PATTERNS, ...MONEY_CONTEXT_PATTERNS]) {
    // Each pattern is defined unanchored and non-global; masking has to sweep
    // the whole string, so a global clone is made per pass.
    const global = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
    out = out.replace(global, (span) => span.replace(/\d/g, MASK_CHAR));
  }
  return out;
}

/**
 * Does this message talk about money at all?
 *
 * Broader than `extractAmount`, deliberately. "remind Ramesh Traders about
 * 45000 due Friday" states a sum with no currency marker and no thousands
 * separator, so `extractAmount` cannot read it — correctly, since it will not
 * guess. But the message is plainly about money, and a caller deciding whether
 * a "remind" is a PAYMENT reminder needs that weaker signal.
 *
 * Reuses the same vocabulary the masking pass uses, so the two cannot drift
 * into disagreeing about what looks monetary.
 */
export function looksMonetary(text: string): boolean {
  if (!text?.trim()) return false;
  return MONEY_PATTERNS.some((p) => p.test(text))
    || MONEY_CONTEXT_PATTERNS.some((p) => p.test(text))
    || DOC_REF_PATTERNS.some((p) => p.test(text));
}

/**
 * Format an amount the way it should appear in a WhatsApp template or a
 * confirmation: `45000` → `₹45,000`, with Indian digit grouping.
 *
 * Paise are shown only when they are non-zero — "₹45,000.50" is right and
 * "₹45,000.00" is noise.
 */
export function formatAmount(value: number, currency: string = 'INR'): string {
  const hasPaise = Math.round(value * 100) % 100 !== 0;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value);

  return currency === 'INR' ? `₹${formatted}` : `${currency} ${formatted}`;
}
