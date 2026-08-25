import axios from 'axios';
import { MODEL, NVIDIA_URL, extractTaskRef, parseLooseJson } from './intentService';
import { transliterate } from '../lib/devanagari';
import { extractAmount, extractDocRef } from './moneyParser';

// ─────────────────────────────────────────────────────────────────────────────
// Turning a manager's WhatsApp message into a structured command.
//
// This is the INTERPRETATION layer and nothing more. It reads text and returns
// a struct. It has no database access, sends nothing, and decides no
// permissions — everything it produces is treated as untrusted user input by
// commandExecutor, which re-derives every fact from the database before acting.
//
// Two stages, mirroring how intentService already works:
//
//   1. Rules      — deterministic patterns for the phrasings people actually
//                   use. No API key needed, same answer every time, and it is
//                   what the tests assert against so they don't depend on a
//                   model's mood.
//   2. AI (Ph. 2) — a small instruct model for everything the rules miss.
//
// The rules run first and, when they fully match, win outright. A model is not
// more trustworthy than an exact pattern match on this kind of input; it is
// only better at the long tail.
// ─────────────────────────────────────────────────────────────────────────────

export type CommandIntent =
  | 'reassign_ticket'
  | 'create_task'
  | 'add_comment'
  | 'set_priority'
  | 'set_deadline'
  | 'duplicate_task'
  | 'bulk_reassign'
  | 'undo_last'
  // ─── Outreach ───────────────────────────────────────────────────────────
  // The four below all CREATE A TASK for an employee, about an external
  // party. They are separate intents because they carry different slots and
  // fill different custom fields, not because they execute differently — a
  // single handler serves all four.
  | 'assign_sample_dispatch'
  | 'create_sales_task'
  | 'create_store_check_task'
  | 'create_collection_task'
  // The two below MESSAGE the external party directly.
  | 'send_payment_reminder'
  | 'send_sample_notice'
  // Managing the contact directory itself.
  | 'register_contact'
  | 'search_contact';

/**
 * The outreach intents that create a task rather than messaging an outsider.
 *
 * Kept as a set because three different places need the distinction — the
 * confirmation policy, the executor's dispatch, and the role gate — and each
 * deriving it from its own list of intent names is how they drift.
 */
export const TASK_OUTREACH_INTENTS: ReadonlySet<CommandIntent> = new Set([
  'assign_sample_dispatch',
  'create_sales_task',
  'create_store_check_task',
  'create_collection_task',
]);

/** The intents that send a message to somebody outside the company. */
export const EXTERNAL_OUTREACH_INTENTS: ReadonlySet<CommandIntent> = new Set([
  'send_payment_reminder',
  'send_sample_notice',
]);

/**
 * Whether several names mean one task or one each.
 *
 * `null` is a real answer, not a missing one: "assign task 4 to Vedant and
 * Vikranth" genuinely does not say, and the two readings produce different work
 * for different people. It has to be asked, never guessed.
 */
export type AssignmentIntent = 'shared' | 'separate' | null;

export interface ParsedCommand {
  intent: CommandIntent;
  /** Normalised `TSK-<n>`, or null when the sender didn't name one. */
  taskRef: string | null;
  /** The name as the sender typed it. Resolution to a user happens later. */
  targetName: string | null;
  /**
   * Every name the sender listed, in order. `targetName` is the first of
   * these and stays populated so single-assignee callers are unaffected.
   */
  targetNames: string[];
  /** Shared task or one each — see AssignmentIntent. */
  assignmentIntent: AssignmentIntent;
  /**
   * True when the wording replaces the current holder ("instead", "move it
   * to") rather than adding one ("also assign", "…too"). Drives whether we
   * reassign or add, and reassignment removes somebody, so it is confirmed.
   */
  replaces: boolean;
  /**
   * True when the wording explicitly ADDS a person ("also assign", "add", "…too",
   * "bhi") rather than simply naming one. Distinct from `!replaces`: a plain
   * "assign task 4 to Vedant" says neither, and is an ordinary reassignment.
   * Only an explicit add raises the "add or reassign?" question.
   */
  adds: boolean;
  /**
   * The person the sender said the task is being taken FROM, when they named
   * one ("reassign task 4 FROM Vedant to Vikranth").
   *
   * Naming them is evidence the sender already knows who they are removing,
   * which is the difference between a reassignment that can be carried out and
   * one that has to be confirmed first.
   */
  fromName: string | null;
  /** Whose tasks a bulk command applies to ("all of VEDANT's pending tasks"). */
  ownerName: string | null;
  /** A due-date filter on a bulk command, as written ("tomorrow", "Friday"). */
  dueFilter: string | null;
  /** For create_task. */
  title: string | null;
  /** Raw deadline phrase ("by Friday"). Parsed to a Date in Phase 3. */
  deadlineText: string | null;
  priority: 'Low' | 'Medium' | 'High' | null;
  /** For add_comment. */
  comment: string | null;
  /** "because I have a high workload" — recorded on the audit trail. */
  reason: string | null;
  // ─── Outreach slots ───────────────────────────────────────────────────────
  //
  // Kept separate from `targetName`, which means EMPLOYEE everywhere else in
  // this file and in every consumer of it. "Ask Sahil to send samples to Urja
  // Vart" names two people who are not the same kind of thing, and collapsing
  // them into one slot would make that sentence unresolvable.

  /** The external party, as the sender wrote them ("Urja Vart", "रमेश ट्रेडर्स"). */
  contactName: string | null;
  /** A phone number typed inline, for registering a contact. */
  contactPhone: string | null;
  /** What kind of party, when the sender said ("vendor Ramesh", "customer DGH"). */
  contactType: string | null;
  /** Amount in whole currency units. `null` when none was stated. */
  amount: number | null;
  /** ISO currency code for `amount`. */
  currency: string | null;
  /** An invoice, order or docket reference ("INV-102", "SO-1187"). */
  reference: string | null;
  /** What is being sent, checked or ordered ("2m samples of Fabric A12"). */
  itemDescription: string | null;
  /** How much of it ("400 sq ft", "2 metre"). */
  quantity: string | null;

  /** 0–1. Drives whether we act straight away or confirm first. */
  confidence: number;
  source: 'rule' | 'ai';
}

// ─── Patterns ─────────────────────────────────────────────────────────────────

/**
 * Handover verbs.
 *
 * "move" is deliberately absent. It reads far more naturally as a deadline
 * command ("move TSK-1059 to Friday") and, being a common word, it is the one
 * most likely to collide with an ordinary worker message.
 */
const REASSIGN_VERB = /\b(assign|assigns|assigned|allocate|allocates|allocated|re-?assign(?:s|ed)?|delegate(?:s|d)?|allot(?:s|ted)?|transfer(?:s|red)?|hand(?:s|ed)?\s*over|handover|pass\s+(?:on|to)|give|gives|giving|gave|de\s*do|de\s*dena|dedo|saunp(?:o|do)?|सौंप|दे\s*दो)\b/i;

/**
 * The noun must follow the verb directly, allowing only articles between.
 *
 * This used to permit 20 characters of anything in between, which was fine
 * while people wrote "TSK-1059" — the word "task" simply didn't appear. Once
 * short ids made "task 4" the normal phrasing, "Add a comment to task 4" put
 * "add" and "task" 14 characters apart and the message parsed as a request to
 * CREATE a task. Proximity is what distinguishes "add a task" from "add a
 * comment to task 4".
 */
const CREATE_VERB = /\b(create|add|make|raise|open|set\s+up|new)\s+(?:(?:a|an|one|new|another)\s+){0,2}(task|ticket|job)\b/i;

/**
 * "Create another copy of task 4 for Vedant" / "duplicate task 4 for Vedant
 * and Vikranth" — an explicit request for a NEW task based on an existing one,
 * as opposed to moving the existing one.
 */
const DUPLICATE_VERB = /\b(?:duplicate|copy|clone)\b|\b(?:create|make)\s+(?:another|a\s+(?:new\s+)?)?(?:copy|duplicate)\b/i;

/**
 * "Move all of Vedant's pending tasks to Vikranth" — every open task belonging
 * to one person, optionally narrowed by a due date.
 *
 * Requires an explicit "all"/"every"/"saare": bulk reassignment touches work
 * the sender hasn't individually looked at, so it is never inferred from a
 * plural alone.
 */
// "kam" as well as "kaam": transliterating काम drops the long vowel, so the
// Devanagari form arrives here with one 'a', not two.
const BULK_QUANTIFIER = /\b(?:all|every|saare|sare|सारे|सभी)\b[^.!?]{0,40}?\b(?:tasks?|tickets?|work|kaam|kam)\b|\b(?:tasks?|tickets?)\b[^.!?]{0,20}?\ball\b/i;

/**
 * "move" is excluded from REASSIGN_VERB because it reads as a deadline command
 * far more often than a handover. In a bulk instruction it is the natural verb
 * — "move all of Vedant's tasks to Vikranth" — and the quantifier alongside it
 * removes the ambiguity, so it is accepted here and nowhere else.
 */
const BULK_MOVE_VERB = /\b(?:move|shift|transfer|reassign|assign|give|hand\s*over)\b/i;

/** Plural work + a due-date filter is a bulk instruction even without "all". */
const BULK_PLURAL = /\b(?:tasks|tickets)\b/i;

/** "undo", "undo the last assignment", "revert that", "wapas karo". */
const UNDO_VERB = /\b(?:undo|revert|rollback|roll\s+back|cancel\s+(?:the\s+)?last|[vw]apas\s+(?:karo|kar\s+do|kar\s+do)|वापस)\b/i;

/** "…tasks due tomorrow", "…due on Friday" — the filter in UC9. */
const DUE_FILTER = /\bdue\s+(?:on\s+)?(today|tomorrow|[a-z]{3,9}day|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b/i;

/** Whose tasks — "all of VEDANT's pending tasks", "VEDANT ke saare tasks". */
const OWNER_POSSESSIVE = /\b([A-Za-z][A-Za-z'’\-]*(?:\s+[A-Za-z][A-Za-z'’\-]*){0,2}?)(?:'s|s')\s/i;

/**
 * "VEDANT is on leave tomorrow. Assign his tasks…" — the owner is named in a
 * separate clause and referred to by a pronoun in the instruction itself, so
 * there is no possessive to find.
 */
const OWNER_STATE = /\b([A-Za-z][A-Za-z'’\-]{2,20})\s+(?:is|was|will\s+be|has|ke|ka)\b/i;

const COMMENT_VERB = /\b(add\s+(?:a\s+)?(?:comment|note|remark)|comment|note\s+(?:on|that)|remark)\b/i;

// ─── Hindi and Hinglish verb banks ────────────────────────────────────────────
//
// These sit alongside the English banks rather than inside them, because Hindi
// puts the verb last and the noun first — "task banao", not "create a task" —
// so the proximity rules the English patterns rely on do not transfer.
//
// They are written in Roman script only. Devanagari input reaches them through
// the transliteration pass in `parseWithRules`, which turns "टास्क बनाओ" into
// "task banao" before any of this runs. Writing them twice, once per script,
// would double the surface area and guarantee the two copies drift.

/** "task banao", "naya task bana do", "kaam banwao". */
const CREATE_VERB_HI =
  /\b(?:task|ticket|kaam|kam)\s+(?:bana(?:o|do|iye|na|dijiye)?|banwa(?:o|do)?|khol(?:o|do))\b|\b(?:naya|nayi|nai)\s+(?:task|ticket|kaam|kam)\b/i;

/** "task 4 par tippani likho", "note likh do". */
const COMMENT_VERB_HI =
  /\b(?:tippani|comment|note|remark)\s*(?:likh(?:o|\s*do|iye)?|jod(?:o|\s*do)|add\s*kar(?:o|\s*do)?)\b|\blikh\s*(?:do|dijiye)\b/i;

/**
 * "priority zaruri kar do", "prathamikata jyada karo", "priority badal do".
 *
 * The gap between the noun and the verb is what the English pattern cannot
 * do: Hindi puts the new VALUE in between — "priority zaruri kar do" — so
 * requiring the verb to follow the noun directly matched none of these.
 */
const PRIORITY_VERB_HI =
  /\b(?:priority|prathamik(?:a)?ta)\b[^.!?]{0,25}?\b(?:kar\s*(?:o|do|dijiye)|karo|badal\s*do|badl(?:o|iye)|bana\s*do)\b/i;

/** "deadline badal do", "samay seema badhao", "tarikh aage karo". */
const DEADLINE_VERB_HI =
  /\b(?:deadline|samay\s*s(?:ee|i)ma|samay|tar(?:ee|i)kh|date)\s*(?:badl(?:o|\s*do)|badal\s*do|badha(?:o|\s*do)|aage\s*kar(?:o|\s*do)?|bad(?:a|ha)\s*do)\b/i;

/** "copy bana do", "dusra task banao", "nakal". */
const DUPLICATE_VERB_HI =
  /\b(?:copy|nakal|pratilipi)\s*(?:bana(?:o|\s*do)?|kar(?:o|\s*do)?)\b|\b(?:dusra|doosra|ek\s+aur)\s+(?:task|ticket|copy)\b/i;

/** Bulk handover verbs — "de do", "saunp do", "shift kar do". */
const BULK_MOVE_VERB_HI =
  /\b(?:de\s*do|dedo|de\s*dena|saunp(?:o|\s*do)?|transfer\s*kar(?:o|\s*do)?|shift\s*kar(?:o|\s*do)?|bhej\s*do)\b/i;

/** "kal wale saare task", "aaj ke tasks" — the Hindi form of the due filter. */
const DUE_FILTER_HI =
  /\b(aaj|aj|kal|para?s(?:o|oo)?n?|som[av]ar|mangal[av]ar|budh[av]ar|guru[av]ar|shukra?[av]ar|shani[av]ar|ravi[av]ar)\s+(?:wale|wala|wali|ke|ki)\b/i;

const PRIORITY_VERB = /\b(?:set|change|make|mark|update)\b[^.!?]{0,30}?\bpriorit(?:y|ies)\b|\bpriority\b[^.!?]{0,20}?\b(?:to|as|=)\b/i;

const DEADLINE_VERB = /\b(?:set|change|extend|move|push|update|shift)\b[^.!?]{0,30}?\b(?:deadline|due\s*date|due)\b|\bdeadline\b[^.!?]{0,20}?\b(?:to|by|=)\b/i;

/**
 * "… to Vikranth", "… to Vikranth Sharma", "… for Vedant".
 *
 * Capped at three words and letters-only so it grabs a name and stops. Without
 * the cap, "assign 1059 to Vikranth because the client is waiting" swallows the
 * entire reason into the name.
 */
const NAME_AFTER = /\b(?:to|for)\s+([A-Za-z][A-Za-z.'’\-]*(?:\s+[A-Za-z][A-Za-z.'’\-]*){0,2})/i;

/**
 * Note the closing `\b`, and the absence of a bare "as".
 *
 * Without the boundary, "as" matched the first two letters of "assign" — so
 * "Tsk1059 - assign to Vikranth" had "sign to Vikranth" stripped off as a
 * reason clause and the assignee vanished. "as" is dropped entirely rather than
 * bounded, because "assign as soon as possible" would still misfire.
 */
const REASON_AFTER = /\b(?:because|since|due\s+to|reason)\b[:\s]\s*(.+)$/i;

/** "reassign task 4 FROM Vedant to Vikranth" — who it is being taken off. */
const FROM_NAME = /\bfrom\s+([A-Za-z][A-Za-z'’\-]*(?:\s+[A-Za-z][A-Za-z'’\-]*){0,2})/i;

// ─── Outreach ─────────────────────────────────────────────────────────────────
//
// Every command above moves work between employees. These involve an OUTSIDE
// party as well, and that is the whole difficulty: the sentence names two
// people who are not the same kind of thing.
//
//   "Ask Sahil to send fabric samples to Urja Vart"
//         ^ employee                      ^ external party
//
// One slot cannot hold both. `targetName` means "employee" in every other
// branch of this file and in every consumer of it, so the party goes in
// `contactName` and the two are extracted by different rules — the employee
// from the frame that delegates the work, the party from the tail that says
// who it concerns.

/**
 * "Ask Sahil to …", "tell Vedant to …", "get Gaurav to …".
 *
 * The `to` is required: it is what makes this a delegation rather than a
 * mention. Without it "ask about Ramesh" would name Ramesh as an employee.
 */
const EMPLOYEE_FRAME =
  /\b(?:ask|tell|get|have|assign|instruct)\s+([A-Za-z][A-Za-z.'’\-]*(?:\s+[A-Za-z][A-Za-z.'’\-]*){0,2}?)\s+(?:to|ko|that|the)\b/i;

/**
 * "Sahil ko bolo …", "Gaurav se poocho …".
 *
 * Hindi puts the person first and the verb last, so the English frame — which
 * looks for a verb THEN a name — matches none of it. The verb list is narrow
 * on purpose: "X ko bhejo" means send something TO X, not tell X to send, and
 * including "bhejo" here would turn every recipient into an assignee.
 */
const EMPLOYEE_FRAME_HI =
  /\b([A-Za-z][A-Za-z.'’\-]*(?:\s+[A-Za-z][A-Za-z.'’\-]*){0,2}?)\s+(?:ko|se)\s+(?:bolo|bol\s*do|bolna|kaho|kah\s*do|keh\s*do|kehna|pooch(?:o|ho)|puch(?:o|ho)|kehdo)\b/i;

/** "…for Sahil to…" — the create-a-task phrasing of the same delegation. */
const EMPLOYEE_FRAME_TASK =
  /\b(?:task|ticket|job|kaam|kam)\s+(?:for|to)\s+([A-Za-z][A-Za-z.'’\-]*(?:\s+[A-Za-z][A-Za-z.'’\-]*){0,2}?)\s+(?:to|ko|that|for)\b/i;

/**
 * Words that end a business name.
 *
 * A party name is captured greedily — "Urja Vart Textiles Pvt Ltd" is one name
 * — so something has to stop it before it swallows the rest of the sentence.
 * These are the words that can only begin a new clause.
 */
const CONTACT_STOP =
  /^(?:about|regarding|for|from|by|on|at|in|with|and|aur|ke|ka|ki|se|ko|that|which|who|whether|if|is|are|was|were|before|after|due|tomorrow|today|kal|aaj|parso|asap|please|pls|urgently|now|tak|the|a|an|of|kya|hai|ho)$/i;

/**
 * Verbs that cannot begin a party name.
 *
 * "Ask Sahil to send samples to Urja Vart" contains two "to" phrases, and the
 * first one introduces the VERB, not a person. Without this the party came out
 * as "send fabric samples to" — a capture that starts at the delegating "to"
 * and runs until it hits a word cap.
 */
const CONTACT_STOP_VERB =
  /^(?:send|sends|sending|dispatch|despatch|courier|ship|deliver|check|checks|confirm|verify|see|look|find|create|make|place|raise|book|prepare|collect|recover|chase|follow|followup|remind|ask|tell|get|have|assign|do|give|know|bhejo|bhejna|dekho|karo|banao|poocho|puchho|mango|maango|lagao)$/i;

/**
 * Where a party name could begin: after "to", "for", "from" or "with".
 *
 * This matches only the PREPOSITION, not the name. Capturing the name here as
 * well made the match consume several words, so a later "to Urja Vart" fell
 * inside the region the first match had already eaten and was never seen — the
 * party came out as "send fabric samples to". Matching the marker and reading
 * forward from it separately keeps every candidate position visible.
 */
const PARTY_MARKER = /\b(?:to|for|from|with)\s+/gi;

/**
 * Hindi marks the party with a postposition — the name comes BEFORE it.
 *
 *   "Urja Vart ko sample bhej de"   ← the party is to the LEFT of "ko"
 *   "send samples to Urja Vart"     ← the party is to the RIGHT of "to"
 *
 * Reading forward from "ko" gives "sample bhej de", so this needs its own
 * pass that reads backwards. Matching the marker alone, again, rather than
 * capturing the name — so two adjacent markers cannot swallow each other.
 */
const PARTY_MARKER_HI = /\s+(?:ko|se|ke\s+liye)\b/gi;

/** "remind ABC Traders about…", "ABC Traders ko yaad dilao". */
const REMIND_PARTY =
  /\bremind\s+([A-Za-z][A-Za-z0-9.'’&\-]*(?:\s+[A-Za-z0-9][A-Za-z0-9.'’&\-]*){0,3}?)\s+(?:about|regarding|for|to|that)\b/i;

// ─── Outreach subject matter ──────────────────────────────────────────────────
//
// What the instruction is ABOUT. Each pairs a noun with the verbs that act on
// it, because the noun alone is too weak — "the samples arrived" is a worker
// reporting, not a manager delegating.

const SAMPLE_NOUN = /\bsamples?\b|\bswatch(?:es)?\b|\bsainpal\b|\bnamuna\b/i;
const SEND_ACTION = /\b(?:send|dispatch|courier|ship|deliver|bhej(?:o|na|wa\s*do|\s*do)?|send\s*out)\b/i;

const SALES_NOUN  = /\b(?:sale|sales|sales\s*order|order|so)\b|\bbikri\b|\bordar\b/i;
const SALES_ACTION = /\b(?:create|make|place|raise|book|prepare|banao|bana\s*do|lagao|kar\s*do)\b/i;

const STOCK_NOUN  = /\b(?:stock|inventory|store|godown|availab(?:le|ility)|maal)\b/i;
const STOCK_ACTION = /\b(?:check|confirm|verify|see|look|find\s*out|dekh(?:o|na|\s*lo)?|pata\s*karo|chek\s*karo|poocho|puchho)\b/i;

const DUES_NOUN   = /\b(?:dues?|outstanding|receivable|payment|balance|bakaya|baki|udhaar|udhar|vasooli|vasuli)\b/i;
const COLLECT_ACTION = /\b(?:collect|recover|chase|follow\s*up|followup|pursue|maango|mango|le\s*lo|vasool)\b/i;

/**
 * A direct payment chase — the sender is not delegating, they want the party
 * messaged now. "Send a payment reminder to X", "remind X about INV-102".
 */
const PAYMENT_REMINDER_DIRECT =
  /\b(?:payment|invoice|bill|due|dues|outstanding|bhugtan|bhugatan|bakaya)\s*(?:ka\s*)?(?:reminder|alert|notice|follow\s*up|yaad)\b|\b(?:reminder|alert|yaad\s*dila(?:o|na|iye))\b[^.!?]{0,30}?\b(?:payment|invoice|bill|dues|bakaya|bhugatan)\b|\bremind\b[^.!?]{0,40}?\b(?:invoice|payment|bill|dues|outstanding|inv-?\d)/i;

/** A direct dispatch notice to the party, rather than a task for an employee. */
const SAMPLE_NOTICE_DIRECT =
  /\bsend\s+(?:the\s+|a\s+)?(?:sample\s+)?(?:dispatch|despatch)\s*(?:message|notice|update|intimation)\b|\b(?:sample|dispatch)\s+(?:message|notice|intimation)\s+(?:to|ko)\b/i;

/** "register vendor Ramesh 9876543210", "add contact Urja Vart". */
const REGISTER_CONTACT =
  /\b(?:register|add|save|create|naya|new)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(customer|vendor|seller|supplier|buyer|party|contact|client|grahak|vikreta)\b/i;

/** "find Ramesh", "search for Metro Logistics", "do we have ABC Traders". */
const SEARCH_CONTACT =
  /\b(?:search|find|look\s*up|lookup|do\s+we\s+have|dhoondh?o|khojo)\b[^.!?]{0,20}?\b(?:customer|vendor|seller|supplier|buyer|party|contact|client)\b/i;

/** "vendor Ramesh", "customer DGH" — the party's kind, when stated. */
const CONTACT_TYPE_WORD =
  /\b(customer|vendor|seller|supplier|buyer|client|party|grahak|vikreta)\b/i;

/** Maps the words people use onto the six stored types. */
const CONTACT_TYPE_CANON: Record<string, string> = {
  customer: 'customer', client: 'customer', grahak: 'customer', buyer: 'buyer',
  vendor: 'vendor', vikreta: 'vendor',
  seller: 'seller', supplier: 'supplier',
  party: 'other', contact: 'other',
};

/** A phone number typed inline. Indian mobiles are ten digits, often with +91. */
const INLINE_PHONE = /(?:\+?91[\s\-]?)?\b(\d{10})\b|\b(\d{12})\b/;

/** "400 sq ft", "2 metre", "3 pieces", "2m" — how much of the thing. */
const QUANTITY =
  /\b(\d+(?:\.\d+)?\s*(?:sq\.?\s*(?:ft|feet|m|meters?|metres?)|m(?:tr|eters?|etres?)?|kg|g|gm|grams?|tons?|pcs?|pieces?|units?|nos\.?|boxes|rolls?|yards?|dozen))\b/i;

/**
 * Trim a captured party name down to the name itself.
 *
 * Distinct from `cleanName`, which is tuned for people: it cuts at the first
 * word not shaped like a personal name, which would reduce "Urja Vart
 * Textiles" to "Urja" and "Metro Logistics Pvt Ltd" to "Metro". A business
 * name needs the whole string — the contact directory is keyed on it.
 */
export function cleanContactName(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const words: string[] = [];
  for (const word of raw.trim().split(/\s+/)) {
    const bare = word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.'’&\-]+$/g, '');
    if (!bare) break;
    // Stop words are tested WITHOUT a trailing dot. "Urja Vart tomorrow."
    // ends the sentence, and `bare` keeps that dot — dots are legitimate
    // inside a business name ("Pvt. Ltd.") so they are not stripped wholesale.
    if (CONTACT_STOP.test(bare.replace(/\.+$/, ''))) break;
    // A verb can only be the first word, and only ever means this capture
    // began at a delegating preposition rather than a name.
    if (words.length === 0 && CONTACT_STOP_VERB.test(bare.replace(/\.+$/, ''))) return null;
    words.push(bare);
    if (words.length === 4) break;
  }

  const name = words.join(' ').replace(/[.,]+$/, '').trim();
  // A single stray letter is never a party. "ji" and "sir" are honorifics that
  // arrive attached to a name and are not part of it.
  if (name.length < 2) return null;
  return name.replace(/\s+(?:ji|sir|madam|bhai|saheb|sahab)$/i, '').trim() || null;
}

// ─── Interpretation Rule 1: shared task vs one each ───────────────────────────
//
// These two banks decide whether "Vedant and Vikranth" means one task with two
// owners or two tasks with one each — which changes who has to do what, so when
// neither fires the sender is asked rather than guessed at.

const SHARED_PHRASES = [
  'together', 'jointly', 'joint', 'collaborate', 'collaboratively', 'as a team',
  'with each other', 'same task', 'one task', 'single task', 'share', 'shared',
  'both of you work', 'both work on', 'work on it together', 'add both',
  // Hindi / Marathi
  'mil kar', 'milkar', 'saath mein', 'saath me', 'ek saath', 'dono saath',
  'मिलकर', 'मिल कर', 'साथ में', 'एक साथ', 'दोनों साथ', 'एकत्र',
];

const SEPARATE_PHRASES = [
  'separately', 'separate', 'individually', 'individual', 'each of them',
  'each one', 'one each', 'a copy each', 'one copy each', 'own task',
  'their own', 'both must complete', 'both need to complete', 'duplicate for',
  'copy for both', 'different task',
  // Hindi / Marathi — "alag se" is the phrase the spec calls out explicitly.
  'alag se', 'alag alag', 'alag-alag', 'alag', 'apna apna', 'apne apne',
  'अलग से', 'अलग अलग', 'अलग-अलग', 'अलग', 'अपना अपना', 'वेगळे', 'वेगवेगळे',
];

// ─── Interpretation Rule 2: replace vs add ────────────────────────────────────
//
// "Send it to Vedant" is deliberately absent from both banks. The spec is
// explicit that "send" on its own means share or notify — reading it as a
// handover would silently remove whoever currently holds the task.

const REPLACE_PHRASES = [
  'instead', 'rather than', 'in place of', 'replace', 'replacing',
  'move it to', 'move to', 'transfer', 'take it away', 'take away from',
  'reassign', 're-assign', 'hand over to', 'handover to', 'shift to',
  'de do', 'de dena', 'transfer kar', 'badal do',
  'के बजाय', 'की जगह', 'हटा', 'बदल दो',
];

const ADD_PHRASES = [
  'also assign', 'also add', 'also give', 'also', 'add', 'additionally',
  'include', 'share with', 'as well', 'too', 'along with', 'in addition',
  'bhi', 'ke saath', 'aur bhi',
  'भी', 'के साथ', 'साथ में भी',
];

function hits(text: string, bank: string[]): boolean {
  const lower = ` ${text.toLowerCase()} `;
  return bank.some((p) => lower.includes(p.toLowerCase()));
}

/**
 * Shared, separate, or unstated.
 *
 * Separate wins a tie. "Both must complete it separately, together with the
 * ops team" is contrived, but where both banks fire the safer reading is one
 * task each: giving somebody their own copy is recoverable, while collapsing
 * two people's work into one task loses one person's accountability.
 */
export function detectAssignmentIntent(text: string): AssignmentIntent {
  const separate = hits(text, SEPARATE_PHRASES);
  const shared   = hits(text, SHARED_PHRASES);

  if (separate) return 'separate';
  if (shared)   return 'shared';
  return null;
}

/**
 * True when the phrasing replaces the current holder rather than adding one.
 *
 * Add wins a tie, for the same reason "send" is in neither bank: adding is
 * reversible, removing somebody from their work is not.
 */
export function detectReplaces(text: string): boolean {
  if (hits(text, ADD_PHRASES)) return false;
  return hits(text, REPLACE_PHRASES);
}

/**
 * True when the sender explicitly said to ADD somebody.
 *
 * Separate from `!detectReplaces` on purpose. "Assign task 4 to Vedant" says
 * neither add nor replace and is an ordinary reassignment; only "ALSO assign
 * task 4 to Vedant" raises the question of whether Vedant joins the current
 * holder or takes over from them.
 */
export function detectAdds(text: string): boolean {
  return hits(text, ADD_PHRASES);
}

const PRIORITY_VALUE = /\b(high|urgent|critical|medium|normal|low|zaruri|zaroori|jaruri|turant|uchch|jyada|zyada|saamanya|samanya|kam)\b/i;


/**
 * Deadline phrase for CREATE, where there is no ticket number to anchor on and
 * the whole message has to be searched. "to" is excluded here: in "create a
 * task for Vedant to prepare the report by Friday", the first "to" introduces
 * the work, not the date.
 */
const DEADLINE_CREATE = /\b(?:by|before|until|till|due)\s+(.+?)\s*$/i;

/**
 * Deadline phrase for SET DEADLINE, applied only to the text after the ticket
 * reference — so "to" is safe and, in "…TSK-1059 to Monday", necessary.
 */
const DEADLINE_SET = /\b(?:to|by|before|on|until|till|due)\s+(.+?)\s*$/i;

const COMMENT_BODY = /\b(?:saying|says|say|stating|states|noting|notes|note|that)\b\s*(.+)$/i;

/**
 * Words that end a name. NAME_AFTER grabs up to three words, which is right for
 * "Vikranth Sharma Rao" and wrong for "Vedant to prepare" — the capture has to
 * stop where the name stops.
 */
const NAME_STOPWORDS = new Set([
  'to', 'for', 'by', 'and', 'or', 'because', 'since', 'on', 'at', 'in', 'with',
  'from', 'before', 'until', 'till', 'due', 'please', 'pls', 'asap', 'the', 'a',
  'an', 'task', 'ticket', 'is', 'has', 'have', 'will', 'that', 'saying', 'so',
  'today', 'tomorrow', 'priority', 'about', 'regarding', 're',
  // Sentence-starters and modals. A name capture runs across a full stop —
  // "…to Vedant and Vikranth. Both of them need to…" — and without these the
  // second assignee comes out as "Vikranth Both of them".
  'both', 'each', 'all', 'they', 'them', 'their', 'he', 'she', 'we', 'you', 'i',
  'this', 'these', 'those', 'it', 'should', 'must', 'need', 'needs', 'can',
  'work', 'works', 'working', 'complete', 'completes', 'separately', 'together',
  'jointly', 'individually', 'ko', 'ka', 'ki', 'ke', 'bhi', 'aur', 'de', 'do',
  'instead', 'rather', 'also', 'as', 'well', 'too', 'now', 'then',
  // Words that follow a name in a bulk instruction — "all of Vedant's PENDING
  // TASKS to Vikranth" — and would otherwise be read as part of the name.
  'tasks', 'tickets', 'pending', 'open', 'every', 'leave', 'his', 'her', 'their',
  // "all OF Vedant's tasks" — a leading stopword is skipped, so this trims the
  // preposition off the possessive rather than making the name unresolvable.
  'of',
]);

/**
 * "Assign Vedant the task of checking today's inventory" — the assignee comes
 * straight after the verb, with no "to" anywhere, and what follows is a
 * description rather than a ticket number.
 *
 * This is the plainest way anyone phrases a new assignment, and it parsed as
 * nothing at all: the name extractor anchors on "to"/"for", and neither is
 * present.
 */
const NAME_AFTER_VERB = /\b(?:assign|allocate|give|allot)\s+([A-Za-z][A-Za-z'’\-]*(?:\s+[A-Za-z][A-Za-z'’\-]*){0,2}?)\s+(?:the\s+|a\s+|an\s+)?(?:task|job|work|ticket)\b/i;

/** The work itself, in "…the task of checking the inventory". */
const TASK_OF = /\b(?:task|job|work|ticket)\s+(?:of|to|for)\s+(.+)$/i;

/**
 * Words that look like names to NAME_AFTER but never are. "assign it to me",
 * "assign to someone else" — a name slot filled with one of these is a slot the
 * sender did not actually fill.
 */
const NON_NAMES = new Set([
  'me', 'myself', 'him', 'her', 'them', 'someone', 'somebody', 'anyone',
  'anybody', 'him her', 'the team', 'team', 'us', 'you', 'it', 'this', 'that',
  'high', 'medium', 'low', 'urgent', 'today', 'tomorrow', 'complete', 'completed',
  'done', 'pending', 'progress',
]);

const PRIORITY_CANON: Record<string, 'Low' | 'Medium' | 'High'> = {
  high: 'High', urgent: 'High', critical: 'High',
  medium: 'Medium', normal: 'Medium',
  low: 'Low',

  // Hindi, folded onto the same three levels. "kam" means low — note it also
  // means "work" (काम), but PRIORITY_VALUE only consults this map inside a
  // branch that has already established the message is about priority.
  zaruri: 'High', zaroori: 'High', jaruri: 'High', turant: 'High',
  uchch: 'High', jyada: 'High', zyada: 'High',
  saamanya: 'Medium', samanya: 'Medium',
  kam: 'Low',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Trim a name capture down to the actual name.
 *
 * Two jobs: drop trailing punctuation ("to Vikranth." → "Vikranth") and cut the
 * capture at the first word that cannot be part of a name, so
 * "for Vedant to prepare" yields "Vedant".
 */
function cleanName(raw: string | undefined | null): string | null {
  if (!raw) return null;

  const words: string[] = [];
  for (const word of raw.trim().split(/\s+/)) {
    const bare = word.replace(/^[^A-Za-z]+|[^A-Za-z'’\-]+$/g, '');
    if (!bare) { if (words.length) break; else continue; }
    if (NAME_STOPWORDS.has(bare.toLowerCase())) {
      // Leading stopwords are skipped, not fatal. A Hindi capture reaches back
      // across the conjunction — "aur vikranth sharma ko" — and breaking on
      // the first word would throw the name away entirely.
      if (words.length === 0) continue;
      break;
    }
    words.push(bare);
  }

  const name = words.join(' ');
  if (!name) return null;
  if (NON_NAMES.has(name.toLowerCase())) return null;
  return name;
}

function extractReason(text: string): string | null {
  const m = text.match(REASON_AFTER);
  return m?.[1]?.trim().replace(/[.!]+$/, '') || null;
}

/**
 * The part of the message that comes after the ticket reference.
 *
 * Nearly every slot we want to fill sits to the right of the ticket number, and
 * reading from the left finds the wrong thing: "Extend the deadline of TSK-1059
 * to Monday" has an "of" before the date, and "Reassign my ticket TSK-1059 to
 * Vikranth" has "my ticket" between the verb and the name. Anchoring past the
 * reference makes the first "to …" the right one.
 *
 * Returns null when there is no reference, so callers fall back to the whole
 * message rather than searching an empty string.
 */
function afterTaskRef(text: string, taskRef: string | null): string | null {
  if (!taskRef) return null;

  const digits = taskRef.replace(/\D/g, '');
  const idx = text.search(new RegExp(`\\b\\D{0,6}${digits}\\b`));
  if (idx < 0) return null;

  // Drop the reference token itself along with whatever prefix it carried.
  const tail = text.slice(idx).replace(/^\S+\s*/, '').trim();
  return tail || null;
}

/**
 * Find the assignee. Searched after the ticket reference where one exists, and
 * always with the reason clause removed first — otherwise "to Vikranth because
 * of workload" leaks the explanation into the name.
 */
function extractName(text: string, taskRef: string | null): string | null {
  return extractNames(text, taskRef)[0] ?? null;
}

/**
 * "to Vedant and Vikranth" / "to Vedant, Vikranth and Priya" / "to A & B" —
 * and equally "to Vikranth Sharma", which is one person, not two.
 *
 * Deliberately captures a GENEROUS run of words and joiners rather than trying
 * to delimit each name in the pattern. A space separates first name from
 * surname AND one name from the next, so no regex can tell "Vikranth Sharma"
 * from "Vedant Vikranth" — splitting is done afterwards on explicit joiners,
 * and `cleanName` trims each piece at the first word that can't be part of a
 * name. That is what stops "to Vedant and Vikranth by Friday" ending with a
 * person called "Vikranth by Friday".
 */
const NAME_LIST_AFTER = /\b(?:to|for)\s+([A-Za-z][A-Za-z'’\-]*(?:[\s,&]+[A-Za-z][A-Za-z'’\-]*){0,5})/i;

/**
 * Hindi and Marathi mark the recipient with a postposition rather than a
 * preposition — "vedant ko de do" is "give it to Vedant". Without this, a
 * perfectly clear instruction in the language half the workforce uses yields
 * no assignee at all.
 */
const NAME_BEFORE_KO = /\b([A-Za-z][A-Za-z'’\-]*(?:\s+[A-Za-z][A-Za-z'’\-]*){0,2})\s+(?:ko|la|ला|को)\b/gi;

/** The joiners people actually use, English and Hindi/Marathi. */
const NAME_SPLIT = /\s*(?:,|&|\band\b|\baur\b|\bव\b|\bआणि\b)\s*/i;

/**
 * Every name the sender listed.
 *
 * Split on the joiners people actually use, including "aur" — a message can be
 * "task 4 vedant ko de do aur vikranth ko bhi", where the second name arrives
 * after a Hindi conjunction rather than an English one.
 *
 * Each candidate goes through `cleanName`, so a list that trails into other
 * words ("to Vedant and Vikranth by Friday") stops at the names.
 */
export function extractNames(text: string, taskRef: string | null): string[] {
  const tail  = afterTaskRef(text, taskRef);
  // Only narrow to the tail if it actually contains a "to"/"for". A message
  // that names the person before the ticket ("give Vikranth 1059") must not
  // lose them.
  const scope = tail && NAME_LIST_AFTER.test(tail) ? tail : text;
  const withoutReason = scope.replace(REASON_AFTER, '');

  const names: string[] = [];

  // Every "to X"/"for X" in the message, not just the first — "vedant ko de do
  // aur vikranth ko bhi" and "assign to A, also assign to B" both list two.
  const add = (raw: string | undefined) => {
    const cleaned = cleanName(raw);
    if (cleaned && !names.some((n) => n.toLowerCase() === cleaned.toLowerCase())) {
      names.push(cleaned);
    }
  };

  const listRegex = new RegExp(NAME_LIST_AFTER.source, 'gi');
  for (const match of withoutReason.matchAll(listRegex)) {
    for (const part of match[1].split(new RegExp(NAME_SPLIT.source, 'i'))) add(part);
  }

  // "vedant ko … aur vikranth ko bhi" — searched over the WHOLE message, not
  // the "to …" scope, because Hindi puts the name before the postposition and
  // there is no "to" to anchor on.
  for (const match of withoutReason.matchAll(new RegExp(NAME_BEFORE_KO.source, 'gi'))) {
    add(match[1]);
  }

  return names;
}

function blank(intent: CommandIntent, source: 'rule' | 'ai', confidence: number): ParsedCommand {
  return {
    intent, taskRef: null, targetName: null, targetNames: [],
    assignmentIntent: null, replaces: false, adds: false, fromName: null,
    ownerName: null, dueFilter: null,
    title: null, deadlineText: null,
    priority: null, comment: null, reason: null,
    contactName: null, contactPhone: null, contactType: null,
    amount: null, currency: null, reference: null,
    itemDescription: null, quantity: null,
    confidence, source,
  };
}

/**
 * Read a model-supplied amount without trusting its formatting.
 *
 * The model is asked for a number and usually gives one, but it also returns
 * "45,000" and "₹45000" often enough to matter. Anything that does not reduce
 * to a positive finite number becomes null, so the executor asks rather than
 * sending a message quoting NaN.
 */
function toAmount(raw: unknown): number | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/[^\d.]/g, '');
  if (!digits) return null;
  const value = parseFloat(digits);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Keep only the digits of a phone number typed inline, or null if implausible. */
function normaliseTypedPhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 10 ? digits : null;
}

/** Keep `targetName` and `targetNames` in step — the first name is the primary. */
function setNames(cmd: ParsedCommand, names: string[]): void {
  cmd.targetNames = names;
  cmd.targetName  = names[0] ?? null;
}

// ─── Stage 1: rules ───────────────────────────────────────────────────────────

/**
 * Deterministic parse. Returns null when the message isn't a management
 * command at all — which is the overwhelmingly common case, since most traffic
 * on this webhook is workers reporting on tasks.
 *
 * Confidence is graded rather than binary: a message naming both a ticket and a
 * person is a command we can act on; one missing a piece is a command we should
 * ask about. That grading is what decides between executing and clarifying.
 */
export function parseWithRules(text: string): ParsedCommand | null {
  const direct = parseRomanRules(text);
  // A confident read needs no second opinion, and this is the hot path for the
  // English and Hinglish messages that make up most traffic.
  if (direct && direct.confidence >= 0.9) return direct;

  const romanised = transliterate(text ?? '');
  // `transliterate` returns its argument unchanged when there is no Devanagari,
  // so the all-Latin case costs one regex test and never parses twice.
  if (romanised === text) return direct;

  const viaRoman = parseRomanRules(romanised);
  if (!viaRoman) return direct;
  if (!direct) return viaRoman;
  return viaRoman.confidence > direct.confidence ? viaRoman : direct;
}

/**
 * The rule engine proper, which only ever sees Roman script.
 *
 * Splitting this out is what makes Devanagari work without duplicating forty
 * regexes. Every structural pattern in this file captures names with
 * `[A-Za-z]` and delimits words with `\b` — and both are defined against ASCII,
 * so Devanagari input matched almost nothing: a Hindi-script name could not be
 * captured at all, and `\b` after a character like `प` never fires because
 * neither side of the boundary is a word character. Rather than widen forty
 * patterns and hope none was missed, the text is transliterated once and the
 * existing rules are run again against the result.
 */
function parseRomanRules(text: string): ParsedCommand | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;

  const taskRef = extractTaskRef(trimmed);

  // ── Undo ─────────────────────────────────────────────────────────────────
  // Checked first: "undo the last assignment" contains "assignment", which the
  // reassign branch would otherwise claim.
  if (UNDO_VERB.test(trimmed)) {
    return blank('undo_last', 'rule', 0.9);
  }

  // ── Outreach ─────────────────────────────────────────────────────────────
  // Before reassign and create. "Assign Sahil the sample dispatch for Urja
  // Vart" contains "assign", and "create a task for Gaurav to check stock"
  // contains "create … task"; both would otherwise be claimed by branches that
  // have nowhere to put the external party and would silently drop it.
  //
  // Every pattern here requires an outreach NOUN (sample, payment, stock,
  // sale), so an ordinary "assign task 4 to Vedant" never reaches this code.
  const outreach = parseOutreach(trimmed, taskRef);
  if (outreach) return outreach;

  // ── Bulk reassignment ────────────────────────────────────────────────────
  // Before the single-task branch, because "move all of Vedant's tasks to
  // Vikranth" matches both and the bulk reading is the correct one.
  const dueFilter = trimmed.match(DUE_FILTER)?.[1] ?? trimmed.match(DUE_FILTER_HI)?.[1] ?? null;
  const looksBulk = (BULK_MOVE_VERB.test(trimmed) || BULK_MOVE_VERB_HI.test(trimmed))
    && (BULK_QUANTIFIER.test(trimmed) || (BULK_PLURAL.test(trimmed) && dueFilter !== null));

  if (looksBulk) {
    const cmd = blank('bulk_reassign', 'rule', 0.6);
    cmd.ownerName = cleanName(trimmed.match(OWNER_POSSESSIVE)?.[1])
      ?? cleanName(trimmed.match(/\b(?:of|from)\s+([A-Za-z][A-Za-z'’\-]*(?:\s+[A-Za-z][A-Za-z'’\-]*){0,2})/i)?.[1])
      ?? cleanName(trimmed.match(OWNER_STATE)?.[1]);
    cmd.dueFilter = dueFilter;
    setNames(cmd, extractNames(trimmed, null).filter(
      (n) => n.toLowerCase() !== (cmd.ownerName ?? '').toLowerCase(),
    ));
    cmd.reason = extractReason(trimmed);

    // Bulk always confirms — see the executor. Confidence only decides whether
    // we can name the two people involved without asking.
    if (cmd.ownerName && cmd.targetName) cmd.confidence = 0.9;
    else if (cmd.targetName) cmd.confidence = 0.6;
    else return null;
    return cmd;
  }

  // ── Duplication ──────────────────────────────────────────────────────────
  if ((DUPLICATE_VERB.test(trimmed) || DUPLICATE_VERB_HI.test(trimmed)) && taskRef) {
    const cmd = blank('duplicate_task', 'rule', 0.6);
    cmd.taskRef = taskRef;
    setNames(cmd, extractNames(trimmed, taskRef));
    cmd.assignmentIntent = detectAssignmentIntent(trimmed);
    cmd.reason = extractReason(trimmed);
    if (cmd.targetName) cmd.confidence = 0.9;
    return cmd;
  }

  // ── Reassignment / assignment to one or more people ──────────────────────
  if (REASSIGN_VERB.test(trimmed)) {
    // "Assign Vedant the task of checking the inventory" names no ticket and
    // describes the work instead — that is a CREATION, however much it reads
    // like an assignment. Handled before the reassign branch, which would
    // otherwise ask which ticket the sender meant when they never had one.
    const verbName = cleanName(trimmed.match(NAME_AFTER_VERB)?.[1]);
    const described = trimmed.match(TASK_OF)?.[1]?.trim().replace(/[.]+$/, '');

    if (!taskRef && verbName && described && described.length >= 3) {
      const create = blank('create_task', 'rule', 0.9);
      setNames(create, [verbName]);
      create.title            = described;
      create.reason           = extractReason(trimmed);
      create.assignmentIntent = detectAssignmentIntent(trimmed);
      create.deadlineText     = trimmed.match(DEADLINE_CREATE)?.[1]?.split(',')[0].trim() || null;
      create.priority         = PRIORITY_CANON[trimmed.match(PRIORITY_VALUE)?.[1].toLowerCase() ?? ''] ?? null;
      return create;
    }

    const cmd = blank('reassign_ticket', 'rule', 0);
    cmd.taskRef          = taskRef;
    cmd.reason           = extractReason(trimmed);
    cmd.assignmentIntent = detectAssignmentIntent(trimmed);
    cmd.replaces         = detectReplaces(trimmed);
    cmd.adds             = detectAdds(trimmed);
    cmd.fromName         = cleanName(trimmed.match(FROM_NAME)?.[1]);

    // Fall back to the after-the-verb name when there is no "to …" at all.
    const listed = extractNames(trimmed, taskRef);
    setNames(cmd, listed.length > 0 ? listed : (verbName ? [verbName] : []));

    // Both slots filled by an explicit verb — nothing left to guess.
    if (cmd.taskRef && cmd.targetName) cmd.confidence = 0.95;
    // One slot missing. Still clearly a reassignment request, so we ask for the
    // missing half rather than dropping the message into the worker pipeline
    // where "delegate this to Vikranth" would be read as unrelated chatter.
    else if (cmd.targetName || cmd.taskRef) cmd.confidence = 0.6;
    else return null;

    // Several names and no word saying how they relate. The two readings give
    // different people different work, so this drops below the act-immediately
    // bar however clear the rest of the message was.
    if (cmd.targetNames.length > 1 && cmd.assignmentIntent === null) {
      cmd.confidence = Math.min(cmd.confidence, 0.6);
    }

    return cmd;
  }

  // ── Comment ───────────────────────────────────────────────────────────────
  //
  // Operations on an EXISTING ticket are checked before creation. A message
  // naming a ticket is talking about that ticket; only one with no reference at
  // all is asking for a new one. Ordering it the other way round meant "Add a
  // comment to task 4" was read as a request to create a task.
  if ((COMMENT_VERB.test(trimmed) || COMMENT_VERB_HI.test(trimmed)) && taskRef) {
    const cmd = blank('add_comment', 'rule', 0.9);
    cmd.taskRef = taskRef;
    cmd.comment = extractCommentBody(afterTaskRef(trimmed, taskRef) ?? trimmed);
    if (!cmd.comment) cmd.confidence = 0.5;
    return cmd;
  }

  // ── Priority ──────────────────────────────────────────────────────────────
  if (PRIORITY_VERB.test(trimmed) || PRIORITY_VERB_HI.test(trimmed)) {
    const cmd = blank('set_priority', 'rule', 0.6);
    cmd.taskRef  = taskRef;
    cmd.priority = PRIORITY_CANON[trimmed.match(PRIORITY_VALUE)?.[1].toLowerCase() ?? ''] ?? null;
    if (cmd.taskRef && cmd.priority) cmd.confidence = 0.95;
    return cmd;
  }

  // ── Deadline ──────────────────────────────────────────────────────────────
  if (DEADLINE_VERB.test(trimmed) || DEADLINE_VERB_HI.test(trimmed)) {
    const cmd = blank('set_deadline', 'rule', 0.6);
    cmd.taskRef = taskRef;

    // Searched after the ticket reference. Reading the whole message instead
    // made "Extend the deadline of TSK-1059 to Monday" yield the date as
    // "of TSK-1059 to Monday".
    const scope = afterTaskRef(trimmed, taskRef) ?? trimmed;
    cmd.deadlineText = scope.match(DEADLINE_SET)?.[1]?.split(',')[0].trim() || null;

    if (cmd.taskRef && cmd.deadlineText) cmd.confidence = 0.9;
    return cmd;
  }

  // ── Creation ──────────────────────────────────────────────────────────────
  // Last, so that anything referring to an existing ticket has already claimed
  // the message.
  if (CREATE_VERB.test(trimmed) || CREATE_VERB_HI.test(trimmed)) {
    const cmd = blank('create_task', 'rule', 0.6);
    setNames(cmd, extractNames(trimmed, null));
    cmd.assignmentIntent = detectAssignmentIntent(trimmed);
    cmd.reason       = extractReason(trimmed);
    // Cut at a comma: "by tomorrow, high priority" is a date followed by a
    // separate instruction, not a five-word date.
    cmd.deadlineText = trimmed.match(DEADLINE_CREATE)?.[1]?.split(',')[0].trim() || null;
    cmd.priority     = PRIORITY_CANON[trimmed.match(PRIORITY_VALUE)?.[1].toLowerCase() ?? ''] ?? null;
    cmd.title        = extractCreatedTitle(trimmed);

    if (cmd.targetName && cmd.title) cmd.confidence = 0.9;
    return cmd;
  }

  return null;
}

/**
 * "Create a task for Vedant to prepare the weekly report by Friday"
 *                                 └────────── title ──────────┘
 */
function extractCreatedTitle(text: string): string | null {
  // Everything after "for <name> to …" is the work itself.
  let body = text.match(/\bfor\s+[A-Za-z][A-Za-z.'’\-]*(?:\s+[A-Za-z][A-Za-z.'’\-]*){0,2}\s+to\s+(.+)$/i)?.[1]
    // "Create a task to prepare the weekly report" — no assignee named yet.
    ?? text.match(/\b(?:task|ticket|job)\b\s*(?::|-)?\s*(?:to\s+)?(.+)$/i)?.[1]
    ?? null;
  if (!body) return null;

  // Cut from the deadline marker onward rather than matching the exact phrase
  // at end-of-string — "by tomorrow, high priority" has trailing text, and an
  // anchored strip would leave the whole clause in the title.
  body = body
    .replace(/\s*\b(?:by|before|until|till|due)\s+.*$/i, '')
    .replace(REASON_AFTER, '')
    .trim()
    .replace(/[.,;]+$/, '');

  return body.length >= 3 ? body : null;
}

function extractCommentBody(text: string): string | null {
  // A leading colon ("comment on TSK-1059: client approval pending") is the
  // other common form. Checked separately from the verb list because a bare
  // "-" alternative matched the hyphen inside "TSK-1059".
  const body = text.match(COMMENT_BODY)?.[1]?.trim()
    ?? text.match(/:\s*(.+)$/)?.[1]?.trim();

  return body && body.length >= 2 ? body.replace(/[.]+$/, '') : null;
}

/**
 * Recognise an instruction that involves an external party.
 *
 * Returns null for anything that is not one — which is nearly everything, so
 * the cheap noun tests come first and the expensive name extraction only runs
 * once an intent is established.
 *
 * Two shapes exist and they are not variants of each other:
 *
 *   DELEGATED  "Ask Sahil to send samples to Urja Vart"
 *              → a task for Sahil. Sahil is told; Urja Vart is not messaged.
 *
 *   DIRECT     "Send a payment reminder to Ramesh Traders"
 *              → a message to Ramesh Traders. No employee involved.
 *
 * The presence of an employee frame is what separates them, and getting it
 * wrong is not a cosmetic error: one of these messages a stranger about money
 * and the other does not.
 */
function parseOutreach(trimmed: string, taskRef: string | null): ParsedCommand | null {
  const employeeName =
    cleanName(trimmed.match(EMPLOYEE_FRAME)?.[1])
    ?? cleanName(trimmed.match(EMPLOYEE_FRAME_TASK)?.[1])
    ?? cleanName(trimmed.match(EMPLOYEE_FRAME_HI)?.[1]);

  // ── Contact directory management ────────────────────────────────────────
  if (REGISTER_CONTACT.test(trimmed)) {
    const cmd = blank('register_contact', 'rule', 0.6);
    cmd.contactType  = canonContactType(trimmed);
    cmd.contactPhone = extractInlinePhone(trimmed);
    cmd.contactName  = extractPartyName(trimmed, employeeName, { afterTypeWord: true });
    // A name and a number is everything needed; either one missing is a
    // question, not a failure.
    if (cmd.contactName && cmd.contactPhone) cmd.confidence = 0.9;
    return cmd;
  }

  if (SEARCH_CONTACT.test(trimmed)) {
    const cmd = blank('search_contact', 'rule', 0.8);
    cmd.contactName = extractPartyName(trimmed, employeeName, { afterTypeWord: true });
    return cmd.contactName ? cmd : null;
  }

  // ── Direct messages to the party ────────────────────────────────────────
  //
  // Checked before the delegated forms: "send a payment reminder to X" also
  // matches the dues vocabulary below, and the direct reading is the one the
  // sender meant when they did not name an employee.
  if (!employeeName && PAYMENT_REMINDER_DIRECT.test(trimmed)) {
    const cmd = blank('send_payment_reminder', 'rule', 0.6);
    fillMoneySlots(cmd, trimmed);
    cmd.contactName = cleanContactName(trimmed.match(REMIND_PARTY)?.[1])
      ?? extractPartyName(trimmed, null, {});
    // A party plus either an amount or an invoice is actionable. A party alone
    // is still the right intent — the executor asks for the missing half.
    if (!cmd.contactName) return null;
    cmd.confidence = (cmd.amount !== null || cmd.reference !== null) ? 0.9 : 0.6;
    return cmd;
  }

  if (!employeeName && SAMPLE_NOTICE_DIRECT.test(trimmed)) {
    const cmd = blank('send_sample_notice', 'rule', 0.6);
    cmd.contactName     = extractPartyName(trimmed, null, {});
    cmd.quantity        = trimmed.match(QUANTITY)?.[1] ?? null;
    cmd.itemDescription = extractItem(trimmed, 'send_sample_notice', [cmd.contactName]);
    if (!cmd.contactName) return null;
    cmd.confidence = 0.9;
    return cmd;
  }

  // ── Delegated work about a party ────────────────────────────────────────
  //
  // Each needs its noun AND a verb that acts on it. The noun alone is a
  // worker reporting ("the samples arrived"), not a manager delegating.
  const subject: CommandIntent | null =
      SAMPLE_NOUN.test(trimmed) && SEND_ACTION.test(trimmed)    ? 'assign_sample_dispatch'
    : STOCK_NOUN.test(trimmed)  && STOCK_ACTION.test(trimmed)   ? 'create_store_check_task'
    : DUES_NOUN.test(trimmed)   && COLLECT_ACTION.test(trimmed) ? 'create_collection_task'
    : SALES_NOUN.test(trimmed)  && SALES_ACTION.test(trimmed)   ? 'create_sales_task'
    : null;

  if (!subject) return null;

  // Without somebody to do it this is not a delegation at all. Falling through
  // lets the ordinary create/reassign branches have their say rather than
  // inventing an assignee.
  if (!employeeName) return null;

  const cmd = blank(subject, 'rule', 0.6);
  cmd.taskRef  = taskRef;
  setNames(cmd, [employeeName]);
  cmd.contactName     = extractPartyName(trimmed, employeeName, {});
  cmd.deadlineText    = trimmed.match(DEADLINE_CREATE)?.[1]?.trim() ?? bareDeadline(trimmed);
  cmd.quantity        = trimmed.match(QUANTITY)?.[1] ?? null;
  cmd.itemDescription = extractItem(trimmed, subject, [cmd.contactName, employeeName]);
  fillMoneySlots(cmd, trimmed);

  // An employee to do it and a party it concerns is the whole instruction.
  // A stock check legitimately has no outside party — "check if A12 is in the
  // store" concerns nobody but us — so it is not held back for one.
  if (cmd.contactName || subject === 'create_store_check_task') cmd.confidence = 0.9;

  return cmd;
}

/**
 * A date word standing on its own at the end of the sentence.
 *
 * `DEADLINE_CREATE` requires a preposition — "by Friday", "before tomorrow" —
 * which people routinely omit when the instruction is already an instruction:
 * "…send the samples to Urja Vart tomorrow". Without this the date was simply
 * dropped and the task got the default deadline instead of the stated one.
 *
 * Deliberately narrow: only words that can ONLY be dates. Anything less
 * certain is left to `parseDeadline` to refuse, which asks rather than guesses.
 */
function bareDeadline(text: string): string | null {
  const m = text.match(
    /\b(today|tomorrow|day after tomorrow|aaj|aj|kal|para?s(?:o|oo)?n?|next week|ag(?:a)?le\s+ha(?:ph|f|p)te|monday|tuesday|wednesday|thursday|friday|saturday|sunday|som[av]ar|mangal[av]ar|budh[av]ar|guru[av]ar|shukra?[av]ar|shani[av]ar|ravi[av]ar)\b\s*[.!?]?\s*$/i,
  );
  return m?.[1] ?? null;
}

/** Read the amount and reference a money instruction carries. */
function fillMoneySlots(cmd: ParsedCommand, text: string): void {
  const amount = extractAmount(text);
  if (amount) {
    cmd.amount   = amount.value;
    cmd.currency = amount.currency;
  }
  cmd.reference = extractDocRef(text);
}

function canonContactType(text: string): string | null {
  const word = text.match(CONTACT_TYPE_WORD)?.[1]?.toLowerCase();
  return word ? (CONTACT_TYPE_CANON[word] ?? 'other') : null;
}

function extractInlinePhone(text: string): string | null {
  const m = text.match(INLINE_PHONE);
  const digits = m?.[1] ?? m?.[2] ?? null;
  return digits && digits.length >= 10 ? digits : null;
}

/**
 * The external party named in the message.
 *
 * `PARTY_AFTER` finds every "to/for/from <name>" phrase; the party is normally
 * the LAST of them, because the employee's own "to" belongs to the delegation
 * verb and comes first. Any capture that resolves to the employee is discarded
 * outright — "ask Sahil to send samples to Sahil" is not a sentence anybody
 * writes, so a match on the employee means the wrong phrase was picked.
 */
function extractPartyName(
  text: string,
  employeeName: string | null,
  opts: { afterTypeWord?: boolean },
): string | null {
  // "register vendor Ramesh Traders 98765…" — the name follows the type word,
  // not a preposition.
  if (opts.afterTypeWord) {
    const typed = text.match(
      /\b(?:customer|vendor|seller|supplier|buyer|client|party|contact|grahak|vikreta)\s+(.+)$/i,
    )?.[1];
    const name = cleanContactName(typed?.replace(INLINE_PHONE, '').trim());
    if (name) return name;
  }

  const employeeKey = employeeName?.toLowerCase().trim();
  const candidates: string[] = [];

  // `PARTY_MARKER` is global and therefore stateful — reset before each sweep,
  // or the second call in a process starts wherever the first one stopped.
  PARTY_MARKER.lastIndex = 0;
  for (const m of text.matchAll(PARTY_MARKER)) {
    // Read forward from the marker. `cleanContactName` stops at the first word
    // that cannot be part of a name, which is what discards the delegating
    // "to send …" while keeping the "to Urja Vart" later in the same sentence.
    const name = cleanContactName(text.slice(m.index + m[0].length));
    if (!name) continue;
    if (employeeKey && name.toLowerCase() === employeeKey) continue;
    candidates.push(name);
  }

  // Hindi postpositions, read backwards from each marker.
  PARTY_MARKER_HI.lastIndex = 0;
  for (const m of text.matchAll(PARTY_MARKER_HI)) {
    const name = nameEndingAt(text.slice(0, m.index));
    if (!name) continue;
    if (employeeKey && name.toLowerCase() === employeeKey) continue;
    candidates.push(name);
  }

  // The last one: the employee's own marker always comes first, so anything
  // after it is more likely to be who the work concerns.
  return candidates.length ? candidates[candidates.length - 1] : null;
}

/**
 * The name immediately preceding a Hindi postposition.
 *
 * Walks backwards from the end of `before`, collecting words while they still
 * look like part of a name and stopping at the first verb or clause word. That
 * is what turns "…bolo Urja Vart" into "Urja Vart" rather than dragging the
 * delegating verb in with it.
 */
function nameEndingAt(before: string): string | null {
  const words = before.trim().split(/\s+/);
  const collected: string[] = [];

  for (let i = words.length - 1; i >= 0 && collected.length < 4; i--) {
    const bare = words[i]
      .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.'’&\-]+$/g, '')
      .replace(/\.+$/, '');
    if (!bare) break;
    if (CONTACT_STOP.test(bare) || CONTACT_STOP_VERB.test(bare)) break;
    collected.unshift(bare);
  }

  const name = collected.join(' ').trim();
  if (name.length < 2) return null;
  return name.replace(/\s+(?:ji|sir|madam|bhai|saheb|sahab)$/i, '').trim() || null;
}

/**
 * What is being sent, checked or ordered.
 *
 * Per-intent rather than one pattern, because the same preposition means
 * different things in each. In "create a sale for DGH" the word after "for" is
 * the CUSTOMER; in "samples of Fabric A12" the word after "of" is the goods.
 * A single greedy rule read the party as the item and the employee as the item
 * in turn, and an item ends up quoted in a message to a customer.
 *
 * Conservative by design: null is a fine answer. The instruction is carried
 * verbatim in the task title either way, so nothing is lost by not guessing.
 */
function extractItem(text: string, intent: CommandIntent, exclude: Array<string | null>): string | null {
  const banned = new Set(exclude.filter(Boolean).map((v) => v!.toLowerCase()));

  const patterns: RegExp[] =
      intent === 'assign_sample_dispatch' || intent === 'send_sample_notice'
        ? [/\bsamples?\s+of\s+(.+)$/i, /\bof\s+(.+)$/i]
    : intent === 'create_store_check_task'
        // "check whether XYZ fabric is available", "check if A12 is in stock",
        // "A12 stock check karo" — the goods sit between the verb and the
        // availability word.
        ? [/\b(?:whether|if|kya)\s+(.+?)\s+(?:is|are|hai|available|in\s+stock|stock)\b/i,
           /\bcheck\s+(?:the\s+)?(?:stock|availability|inventory)\s+(?:of|for)\s+(.+)$/i,
           /\bcheck\s+(?:whether\s+|if\s+)?(.+?)\s+(?:is|are|hai)\b/i]
    : intent === 'create_sales_task'
        // Only "of". "for" introduces the buyer.
        ? [/\b(?:sale|sales|order)\s+of\s+(.+)$/i, /\bof\s+(.+)$/i]
    : [];

  for (const pattern of patterns) {
    const raw = text.match(pattern)?.[1];
    const item = trimItem(raw);
    if (item && !banned.has(item.toLowerCase())) return item;
  }
  return null;
}

/** Cut an item description at the first word that starts a new clause. */
function trimItem(raw: string | undefined): string | null {
  if (!raw) return null;

  const cut = raw.split(
    /\s+\b(?:to|from|by|before|due|tomorrow|today|kal|aaj|parso|and\s+send|please|pls|asap|tak|ko)\b/i,
  )[0];

  const item = cut.trim().replace(/[.,;:]+$/, '');
  return item.length >= 2 && item.length <= 120 ? item : null;
}

// ─── Stage 2: the model ───────────────────────────────────────────────────────

/**
 * The ceiling on anything a language model tells us about its own certainty.
 *
 * Small instruct models are cheerfully overconfident, and the executor's
 * act-immediately threshold sits at 0.9 — so this is what decides whether a
 * model can ever cause a ticket to move without a human saying yes. Clamping
 * to exactly the threshold means it can, but only when the model is maximally
 * confident AND the name resolved to an exact match. Lower this to 0.89 to
 * require confirmation on every AI-parsed command.
 */
const AI_CONFIDENCE_CEILING = 0.9;

const COMMAND_PROMPT = [
  'You convert a WhatsApp message from a MANAGER into a structured task-management command.',
  'Messages may be in English, Hindi, Marathi, or a mix, and voice-note transcripts are often noisy.',
  '',
  'Reply with ONLY a JSON object. No markdown fence, no commentary, no reasoning:',
  '{"intent":"reassign_ticket|create_task|add_comment|set_priority|set_deadline|duplicate_task|',
  'bulk_reassign|undo_last|assign_sample_dispatch|create_sales_task|create_store_check_task|',
  'create_collection_task|send_payment_reminder|send_sample_notice|register_contact|search_contact|none",',
  ' "ticket":"<digits or null>","targets":["<EMPLOYEE name>", ...],"title":"<task title or null>",',
  ' "deadline":"<date phrase exactly as written, or null>","priority":"High|Medium|Low|null",',
  ' "comment":"<comment text or null>","reason":"<stated reason or null>","from":"<name or null>",',
  ' "assignment":"shared|separate|null","replaces":true|false,',
  ' "contact":"<EXTERNAL party name or null>","phone":"<digits or null>",',
  ' "contact_type":"customer|vendor|seller|supplier|buyer|null",',
  ' "amount":<number or null>,"currency":"INR|null","reference":"<invoice/order ref or null>",',
  ' "item":"<what is being sent/checked/ordered, or null>","quantity":"<how much, or null>",',
  ' "confidence":<0.0-1.0>}',
  '',
  'intent:',
  '  reassign_ticket = move an EXISTING ticket to a different person',
  '  create_task     = create a NEW task for someone',
  '  add_comment     = add a note or comment to a ticket',
  '  set_priority    = change a ticket\'s priority',
  '  set_deadline    = change a ticket\'s due date',
  '  duplicate_task  = make a COPY of an existing ticket, leaving the original alone',
  '  bulk_reassign   = move ALL of one person\'s open tickets to somebody else',
  '  undo_last       = reverse the sender\'s most recent action',
  '',
  '  These four create a TASK FOR AN EMPLOYEE about an outside party. Nobody',
  '  outside the company is messaged:',
  '  assign_sample_dispatch  = tell an employee to send samples to a party',
  '  create_sales_task       = tell an employee to raise a sale/order for a party',
  '  create_store_check_task = tell an employee to check stock or availability',
  '  create_collection_task  = tell an employee to chase money owed by a party',
  '',
  '  These two MESSAGE THE OUTSIDE PARTY DIRECTLY. Use them ONLY when no',
  '  employee is told to do anything:',
  '  send_payment_reminder   = message a party about money they owe',
  '  send_sample_notice      = message a party that samples are on the way',
  '',
  '  register_contact = save a new external party (needs a name and a phone number)',
  '  search_contact   = look up an external party',
  '  none            = anything else',
  '',
  'CRITICAL: a person reporting on their OWN work is ALWAYS "none". These are all "none":',
  '  "task 1060 done"   "done"   "in progress"   "I have a problem"   "need more time"',
  '  "ho gaya"   "kar raha hoon"   "काम पूरा हो गया"   "will finish tomorrow"',
  '  "payment ho gaya"   "sample bhej diya"   "stock check kar liya"   "maal aa gaya"',
  'The last four matter: a worker saying the payment came in, or that they have already',
  'sent the samples, is REPORTING. It is "none". It must never become an instruction to',
  'message a customer about money.',
  'Only a message asking to change WHO OWNS a ticket, to create one, or to message an',
  'outside party, is a command.',
  '',
  'ticket: digits only, from "TSK-1059", "Tsk 1059", "task number 1059", "टास्क 1059", or a',
  'bare "1059". Ticket numbers can be SHORT — "TSK-4", "task 7" and "task 12" are valid and',
  'mean 4, 7 and 12. Never pad, round or lengthen a number; report exactly the digits',
  'stated. null if none is stated — never infer or invent one. Quantities are not',
  'ticket numbers: "need 2 more days" contains no ticket.',
  '',
  'targets: every EMPLOYEE named, in order, exactly as the sender wrote them — misspellings',
  'included, do NOT correct them. [] if nobody is named. "me", "myself", "someone" and',
  '"the team" are not names.',
  '',
  'contact vs targets — the single most important distinction in this prompt.',
  '"targets" is somebody who WORKS HERE and is being given work. "contact" is an',
  'outside business or person the work CONCERNS. A message can name both:',
  '  "Ask Sahil to send fabric samples to Urja Vart"',
  '     targets=["Sahil"]  contact="Urja Vart"  intent=assign_sample_dispatch',
  '  "Create a task for Ashish to collect dues from Ramesh ji"',
  '     targets=["Ashish"] contact="Ramesh ji"  intent=create_collection_task',
  '  "Send a payment reminder of Rs 45,000 to Ramesh Traders"',
  '     targets=[]         contact="Ramesh Traders" amount=45000 intent=send_payment_reminder',
  'If an employee is told to do something, it is one of the four TASK intents —',
  'never send_payment_reminder, which messages the outsider instead.',
  'Keep a company name whole: "Urja Vart Textiles" is one contact, not two names.',
  '',
  'amount: a plain number in rupees. "45,000" -> 45000. "45 hazaar" -> 45000.',
  '"2 lakh" -> 200000. "45k" -> 45000. null if no money is mentioned. NEVER guess an',
  'amount, and never copy a ticket number or a quantity into it.',
  '',
  'reference: an invoice, bill or order number as written — "INV-102", "SO-1187".',
  'A reference is not a ticket: put it in "reference", leave "ticket" null.',
  '',
  'assignment: only when more than one person is named.',
  '  "shared"   = one task they do together ("together", "jointly", "same task", "mil kar")',
  '  "separate" = a task each ("separately", "each of them", "one copy each", "alag se")',
  '  null       = they did not say. Do NOT guess — null is the correct answer when the',
  '               message does not make it explicit, and the system will ask.',
  '',
  'replaces: true when the wording takes the task AWAY from whoever holds it ("instead",',
  '"move it to", "transfer", "reassign"). false when it ADDS somebody ("also assign", "add",',
  '"share with", "…too", "bhi"). The word "send" on its own means share — NOT replace.',
  '',
  'confidence: your certainty that this IS a management command and that you read the slots',
  'correctly. Use below 0.7 if you are guessing at any part of it.',
  '',
  'Hindi and Hinglish are first-class, not a fallback. Worked examples:',
  '  "vedant ko task 4 de do"',
  '     {"intent":"reassign_ticket","ticket":"4","targets":["vedant"],"replaces":true,...}',
  '  "साहिल के लिए नया टास्क बनाओ - कल तक रिपोर्ट"',
  '     {"intent":"create_task","targets":["साहिल"],"title":"रिपोर्ट","deadline":"कल",...}',
  '  "Sahil ko bolo Urja Vart ko sample bhej de"',
  '     {"intent":"assign_sample_dispatch","targets":["Sahil"],"contact":"Urja Vart",...}',
  '  "रमेश ट्रेडर्स को 45 हज़ार का payment reminder भेजो"',
  '     {"intent":"send_payment_reminder","targets":[],"contact":"रमेश ट्रेडर्स","amount":45000,...}',
  '  "Gaurav se poocho A12 fabric stock me hai kya"',
  '     {"intent":"create_store_check_task","targets":["Gaurav"],"item":"A12 fabric",...}',
  'Report names in the script the sender used. Do NOT translate or transliterate them —',
  'the system matches across scripts by itself.',
].join('\n');

const AI_INTENTS: CommandIntent[] = [
  'reassign_ticket', 'create_task', 'add_comment', 'set_priority', 'set_deadline',
  'duplicate_task', 'bulk_reassign', 'undo_last',
  'assign_sample_dispatch', 'create_sales_task', 'create_store_check_task',
  'create_collection_task', 'send_payment_reminder', 'send_sample_notice',
  'register_contact', 'search_contact',
];

function str(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s && s.toLowerCase() !== 'null' ? s : null;
}

async function parseWithAI(text: string): Promise<ParsedCommand | null> {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return null;

  try {
    const { data } = await axios.post<{ choices: Array<{ message: { content: string } }> }>(
      NVIDIA_URL,
      {
        model: MODEL,
        messages: [
          { role: 'system', content: COMMAND_PROMPT },
          { role: 'user',   content: `Manager message:\n"""${text}"""` },
        ],
        temperature: 0,   // extraction — same answer every time
        max_tokens: 300,
      },
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 15_000,
      },
    );

    const parsed = parseLooseJson(data.choices?.[0]?.message?.content ?? '');
    if (!parsed) return null;

    const intent = String(parsed.intent ?? 'none').toLowerCase() as CommandIntent;
    if (!AI_INTENTS.includes(intent)) return null;

    const digits = String(parsed.ticket ?? '').replace(/\D/g, '');
    const rawConfidence = Number(parsed.confidence);

    // Run every name through the same cleaner the rules use, so "Vikranth
    // please" can't arrive as a name from one path and not the other.
    const targets = (Array.isArray(parsed.targets) ? parsed.targets : [parsed.targets])
      .map((t) => cleanName(str(t)))
      .filter((n): n is string => n !== null);

    const assignment = str(parsed.assignment)?.toLowerCase();

    return {
      intent,
      taskRef:    digits ? `TSK-${parseInt(digits, 10)}` : null,
      targetName: targets[0] ?? null,
      targetNames: targets,
      assignmentIntent: assignment === 'shared' || assignment === 'separate' ? assignment : null,
      replaces:   parsed.replaces === true,
      adds:       parsed.replaces === false && parsed.adds === true,
      fromName:   cleanName(str(parsed.from)),
      ownerName:  cleanName(str(parsed.owner)),
      dueFilter:  str(parsed.due),
      title:      str(parsed.title),
      deadlineText: str(parsed.deadline),
      priority:   PRIORITY_CANON[str(parsed.priority)?.toLowerCase() ?? ''] ?? null,
      comment:    str(parsed.comment),
      reason:     str(parsed.reason),

      // Outreach slots. The contact name is deliberately NOT run through
      // `cleanName`: that cleaner is tuned for personal names and cuts at the
      // first word it does not recognise as one, which would turn
      // "Urja Vart Textiles" into "Urja" and "Metro Logistics Pvt Ltd" into
      // "Metro". A business name is resolved against the contact directory,
      // where the full string is the useful key.
      contactName:     str(parsed.contact),
      contactPhone:    normaliseTypedPhone(str(parsed.phone)),
      contactType:     str(parsed.contact_type)?.toLowerCase() ?? null,
      amount:          toAmount(parsed.amount),
      currency:        str(parsed.currency)?.toUpperCase() ?? (parsed.amount != null ? 'INR' : null),
      reference:       str(parsed.reference)?.toUpperCase() ?? null,
      itemDescription: str(parsed.item),
      quantity:        str(parsed.quantity),

      confidence: Math.min(
        Number.isFinite(rawConfidence) ? Math.max(0, rawConfidence) : 0.5,
        AI_CONFIDENCE_CEILING,
      ),
      source: 'ai',
    };
  } catch (err) {
    // Best-effort. A model outage must degrade the feature to the rule set,
    // never take down the webhook.
    const e = err as { response?: { status?: number; data?: unknown }; message?: string };
    console.warn(
      '[Command] NVIDIA call failed:',
      e.response ? `${e.response.status} ${JSON.stringify(e.response.data).slice(0, 150)}` : e.message,
    );
    return null;
  }
}

// ─── Merge ────────────────────────────────────────────────────────────────────

/**
 * Combine a rule parse with a model parse.
 *
 * Rules win on the ticket number, always. The regexes handle "Tsk1058",
 * "task -1058" and "टास्क 1058" reliably, and a wrong ticket number is the most
 * damaging single field to get wrong — it points the whole command at somebody
 * else's work. Elsewhere the model fills gaps the rules left.
 *
 * Pure and exported so the precedence is testable without a network call.
 */
export function mergeParsed(
  rule: ParsedCommand | null,
  ai: ParsedCommand | null,
): ParsedCommand | null {
  if (!rule) return ai;
  if (!ai)   return rule;

  // The rules recognised a different action than the model did. Trust the
  // explicit verb: "assign" in the message beats an inference about intent.
  if (rule.intent !== ai.intent) return rule;

  // The rules win on names when they found any: the model paraphrases, and a
  // paraphrased name resolves to the wrong person or to nobody.
  const names = rule.targetNames.length > 0 ? rule.targetNames : ai.targetNames;

  const merged: ParsedCommand = {
    ...rule,
    taskRef:      rule.taskRef      ?? ai.taskRef,
    targetName:   names[0]          ?? null,
    targetNames:  names,
    // A stated mode wins over an unstated one from either side. Only when
    // NEITHER found one does this stay null — and null is what triggers the
    // question, so an unstated intent must never be filled in by inference.
    assignmentIntent: rule.assignmentIntent ?? ai.assignmentIntent,
    // Replacement removes somebody. It needs a positive signal, so it is only
    // true when a stage actually saw one.
    replaces:     rule.replaces || ai.replaces,
    adds:         rule.adds || ai.adds,
    fromName:     rule.fromName ?? ai.fromName,
    ownerName:    rule.ownerName ?? ai.ownerName,
    dueFilter:    rule.dueFilter ?? ai.dueFilter,
    title:        rule.title        ?? ai.title,
    deadlineText: rule.deadlineText ?? ai.deadlineText,
    priority:     rule.priority     ?? ai.priority,
    comment:      rule.comment      ?? ai.comment,
    reason:       rule.reason       ?? ai.reason,
    source:       'ai',
  };

  // Confidence reflects what we ended up with, not what either stage claimed in
  // isolation: a rule parse that was only partial becomes trustworthy once the
  // model supplied the missing half, but never more trustworthy than the model
  // was about the message overall.
  merged.confidence = Math.max(rule.confidence, Math.min(ai.confidence, AI_CONFIDENCE_CEILING));

  // Several people and nothing saying how — still a question, no matter how
  // confident either stage was about the rest of it.
  if (merged.targetNames.length > 1 && merged.assignmentIntent === null) {
    merged.confidence = Math.min(merged.confidence, 0.6);
  }

  return merged;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Work out whether this message is a management command, and what it asks for.
 *
 * The rules run first and, when they produce a complete command, the model is
 * never called — that is the common phrasing, it costs nothing, and a language
 * model is not more trustworthy than an exact pattern match on this input. The
 * model exists for the long tail, and for the cases where the rules found a
 * verb but not everything around it.
 */
export async function parseCommand(text: string): Promise<ParsedCommand | null> {
  const rule = parseWithRules(text);

  // Complete rule match — nothing a model could add, so don't pay for one.
  if (rule && rule.confidence >= 0.9) {
    console.log(`[Command] rule → ${rule.intent} task=${rule.taskRef} target=${rule.targetName}`);
    return rule;
  }

  const merged = mergeParsed(rule, await parseWithAI(text));
  if (merged) {
    console.log(
      `[Command] ${merged.source} → ${merged.intent} task=${merged.taskRef ?? 'none'} ` +
      `target=${merged.targetName ?? 'none'} conf=${merged.confidence.toFixed(2)}`,
    );
  }
  return merged;
}
