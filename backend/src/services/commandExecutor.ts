import { ActionChannel, CommandStatus, TaskKind } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { checkRateLimit } from '../lib/rateLimit';
import { ParsedCommand, parseCommand, parseWithRules } from './commandService';
import { assignableUsers } from './permissionService';
import { Candidate, resolveName } from './nameResolutionService';
import { parseDeadline } from './deadlineParser';
import {
  PendingState, clearState, getState, readChoiceIndex, readConfirmation, setState,
} from './stateService';
import { getLastAttributedTaskId } from './conversationService';
import { sendInteractiveButtons, sendMediaMessage, sendTextMessage } from './whatsappService';
import {
  ParsedAttachment, RecentAttachment, describeAttachment, parseAttachment, recentAttachments,
} from './attachmentService';
import { computeSession, getLastInbound } from './conversationService';
import * as taskService from './taskService';
import * as invoiceService from './invoiceService';
import * as outreachService from './outreachService';
import { contactCandidates, createContact } from './contactService';
import { TaskOpError } from './taskService';
import { ActionKey, Lang, action as phrase, fragment, langOf, t } from './replies';

// ─────────────────────────────────────────────────────────────────────────────
// The trusted layer.
//
// Everything reaching this file is untrusted: the text came from WhatsApp, and
// the struct describing it came from a regex or a language model. Neither is
// evidence of anything. So nothing here takes the parse at its word —
// `taskService` re-reads the task, re-checks who the actor is, and re-derives
// the reporting hierarchy from the database before a single row changes.
//
// The model's only influence is on WHICH question gets asked. It cannot widen
// the set of people who may be assigned work (that comes from
// `assignableUsers`), it cannot reach a task the sender can't see, and a
// confident-sounding confidence score buys it nothing.
//
// Every command lands in `WhatsAppCommand`, including the refusals. A rejected
// command is the most interesting row in that table.
// ─────────────────────────────────────────────────────────────────────────────

export interface CommandActor {
  id:    string;
  name:  string;
  role:  string;
  phone: string | null;
  /**
   * Which language to answer in. Optional so every existing construction site
   * still compiles; absent means English, which is what they got before.
   *
   * Somebody who writes in Hindi and is answered in English has been
   * understood and then talked past — which reintroduces exactly the barrier
   * this whole feature exists to remove.
   */
  preferredLanguage?: string | null;
}

export interface CommandContext {
  actor: CommandActor;
  /** The message text, or the transcript for a voice note. */
  text: string;
  transcription: string | null;
  waMessageId: string | null;
  /** Our own `Message` row, when one has been written. */
  messageId: string | null;
}

export interface CommandOutcome {
  /** What to send back to the sender. Never empty. */
  reply: string;
  status: CommandStatus;
  /**
   * The ticket the command was ABOUT — which is not the same as one that
   * exists. "Assign TSK-9999 to Vedant" reports TSK-9999 here so the audit
   * names it; the caller checks before using it as a foreign key.
   */
  taskId: string | null;
}

// ─── Feature gating ───────────────────────────────────────────────────────────

/**
 * Off unless switched on.
 *
 * This ships dark on purpose. Existing client deployments have managers whose
 * phone numbers are already registered; flipping this on by default would give
 * every one of them a live command channel the moment they upgraded, with no
 * decision made by anyone. `startupSummary()` logs the state at boot so a
 * deployment that meant to enable it and didn't is obvious in the logs.
 */
export function commandsEnabled(): boolean {
  return (process.env.WA_COMMANDS_ENABLED ?? 'false').toLowerCase() === 'true';
}

/**
 * How sure the parse has to be before anything changes without a human saying
 * yes. The AI layer clamps its own self-reported confidence to this same value,
 * so raising it above 0.9 means every AI-parsed command is confirmed first.
 */
export function confidenceThreshold(): number {
  const raw = parseFloat(process.env.WA_CONFIDENCE_THRESHOLD ?? '0.9');
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.9;
}

export function commandRoles(): string[] {
  return (process.env.WA_COMMAND_ROLES ?? 'Manager,Admin')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
}

export function startupSummary(): string {
  return commandsEnabled()
    ? `[Command] WhatsApp management commands ENABLED for: ${commandRoles().join(', ')}`
    : '[Command] WhatsApp management commands are DISABLED (set WA_COMMANDS_ENABLED=true to turn them on)';
}

/**
 * A cheap "is this worth looking at?" check for the webhook.
 *
 * Exists so the caller doesn't have to re-implement the gating rules to decide
 * whether to take the command path. It stays cheap deliberately: the rule parse
 * is pure string work, and the state lookup — the only query — runs solely for
 * roles that can issue commands at all.
 *
 * A true here is not permission to do anything. `tryHandleCommand` re-checks
 * everything; this only avoids pointless work on the overwhelming majority of
 * messages, which are workers reporting progress.
 */
export async function looksLikeCommand(actor: CommandActor, text: string): Promise<boolean> {
  if (!commandsEnabled()) return false;
  if (parseWithRules(text)) return true;
  if (!commandRoles().includes(actor.role)) return false;
  return (await getState(actor.id)) !== null;
}

// ─── Held state ───────────────────────────────────────────────────────────────

/**
 * A command that has been resolved as far as it can be and is waiting on the
 * sender — either to confirm it, or to say which of several people they meant.
 *
 * Held as ids, but RE-VALIDATED on execution: being in this payload grants no
 * authority. If the manager loses the report between asking and confirming, or
 * the ticket closes, the confirmation is refused like any other command.
 */
interface PendingCommand {
  parsed: ParsedCommand;
  /** Verified to exist at the time we asked. */
  taskId: string | null;
  targetId: string | null;
  targetName: string | null;
  /** Every resolved assignee, for a multi-person command. */
  targets: ChoiceOption[];
  previousAssigneeName: string | null;
  /** True when the ticket came from conversation context, not from the sender. */
  fromContext: boolean;
  /** Resolved deadline, carried as an ISO string through the Json column. */
  deadlineIso: string | null;
  /**
   * What the sender picked when we asked how several people relate, or what
   * to do about an already-assigned or completed task. Set by the button reply
   * and read when the held command finally runs.
   */
  resolution?: 'shared' | 'separate' | 'add' | 'replace' | 'reopen' | 'copy';
  /**
   * The tasks a bulk command would move. Shown to the sender BEFORE they
   * confirm, and re-read at execution — a task that closed in between must not
   * be swept up by a confirmation given a minute earlier.
   */
  bulkTaskIds?: string[];
  /** The command being undone, for undo_last. */
  undoCommandId?: string;
  /** Held while asking which of several recent files was meant. */
  attachment?: ParsedAttachment;
  attachmentOptions?: RecentAttachment[];

  // ─── Outreach ─────────────────────────────────────────────────────────────

  /** The external party, once resolved to a row. Never a `User`. */
  contactId?: string | null;
  /** Their display name, for reading the command back before it runs. */
  contactName?: string | null;
  /** Their number, masked, so a confirmation shows WHO without leaking it. */
  contactPhoneMasked?: string | null;
  /** The bill this concerns, when the sender named a reference we hold. */
  invoiceId?: string | null;
  /**
   * The amount to be quoted, in whole units.
   *
   * Resolved at CONFIRMATION time from the invoice where one exists, so the
   * figure the sender is shown is the figure that gets sent. Carrying the
   * typed number through and re-resolving at execution would let the message
   * differ from what was approved.
   */
  amount?: number | null;
  currency?: string | null;
  /** The reference as it will appear in the message ("Invoice INV-102"). */
  reference?: string | null;
  /** Rendered date for the template's fifth parameter. */
  dateText?: string | null;
  /** What is being sent, checked or ordered. */
  itemText?: string | null;
  quantityText?: string | null;
  /** True when the party was added in the last day — worth saying out loud. */
  contactIsNew?: boolean;
}

type ChoiceOption = Candidate;

/**
 * Button ids. Sent to Meta, echoed back verbatim in the webhook, and matched
 * here — so they are a wire format, not display text. Meta caps a button title
 * at 20 characters, which every label below respects.
 */
const BTN = {
  shared:   'wa_shared',
  separate: 'wa_separate',
  add:      'wa_add',
  replace:  'wa_replace',
  reopen:   'wa_reopen',
  copy:     'wa_copy',
  cancel:   'wa_cancel',
} as const;

// ─── Audit ────────────────────────────────────────────────────────────────────

interface AuditInput {
  intent:     string | null;
  entities:   unknown;
  confidence: number | null;
  taskId?:    string | null;
  previousAssigneeId?: string | null;
  newAssigneeId?:      string | null;
  confirmed?: boolean;
  status:     CommandStatus;
  errorReason?: string | null;
}

/**
 * Write the audit row. Never throws — losing the audit write must not also lose
 * the reply telling the sender what happened, and the alternative (an exception
 * here unwinding a change that already committed) is worse than a gap in this
 * log, which the `Activity` row still covers.
 */
async function record(ctx: CommandContext, input: AuditInput): Promise<void> {
  try {
    await prisma.whatsAppCommand.create({
      data: {
        senderId:         ctx.actor.id,
        senderPhoneLast4: (ctx.actor.phone ?? '').replace(/\D/g, '').slice(-4),
        waMessageId:      ctx.waMessageId,
        messageId:        ctx.messageId,
        rawText:          ctx.text.slice(0, 2000),
        transcription:    ctx.transcription,
        intent:           input.intent,
        entities:         (input.entities ?? {}) as object,
        confidence:       input.confidence,
        taskId:           input.taskId ?? null,
        previousAssigneeId: input.previousAssigneeId ?? null,
        newAssigneeId:      input.newAssigneeId ?? null,
        channel:          ActionChannel.whatsapp,
        confirmed:        input.confirmed ?? false,
        status:           input.status,
        errorReason:      input.errorReason ?? null,
      },
    });
  } catch (err) {
    console.error('[Command] Failed writing audit row:', err);
  }
}

function outcome(reply: string, status: CommandStatus, taskId: string | null = null): CommandOutcome {
  return { reply, status, taskId };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Handle this message as a management command, or decline it.
 *
 * Returns null when the message isn't one — which is the common case, since
 * most traffic on this webhook is workers reporting progress. A null return
 * means the caller carries on down the existing worker pipeline, unchanged.
 */
export async function tryHandleCommand(ctx: CommandContext): Promise<CommandOutcome | null> {
  if (!commandsEnabled()) return null;

  const roleAllowed = commandRoles().includes(ctx.actor.role);

  // ── Is this an answer to something we asked? ─────────────────────────────
  if (roleAllowed) {
    const state = await getState(ctx.actor.id);
    if (state) {
      const resolved = await resolvePending(ctx, state);
      // null means "that wasn't an answer" — fall through and see whether it's
      // a fresh command instead.
      if (resolved) return resolved;
    }
  }

  // ── Is this a new command? ───────────────────────────────────────────────
  const parsed = await parseCommand(ctx.text);
  if (!parsed) return null;

  if (!roleAllowed) {
    // Only refuse a command they unmistakably issued. The handover verbs are
    // ordinary English — "I handed over the site to Vikranth" is a worker
    // reporting progress, and answering it with "only managers can reassign
    // tickets" would be both wrong and baffling. A partial parse falls through
    // to the worker pipeline where it belongs.
    if (parsed.confidence < confidenceThreshold()) return null;

    // A complete command, though, is told explicitly rather than ignored: an
    // employee who tries this and hears nothing back assumes it worked.
    const reply = 'Only managers can assign or reassign tickets over WhatsApp. ' +
      'Reply with an update on one of your own tasks instead.';
    await record(ctx, {
      intent: parsed.intent, entities: parsed, confidence: parsed.confidence,
      taskId: parsed.taskRef, status: CommandStatus.rejected, errorReason: reply,
    });
    return outcome(reply, CommandStatus.rejected, parsed.taskRef);
  }

  // ── Throttle ─────────────────────────────────────────────────────────────
  const limit = checkRateLimit(ctx.actor.id);
  if (!limit.allowed) {
    const reply = `You've sent a lot of commands in a short time. ` +
      `Please try again in about ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).`;
    await record(ctx, {
      intent: parsed.intent, entities: parsed, confidence: parsed.confidence,
      taskId: parsed.taskRef, status: CommandStatus.rejected, errorReason: 'Rate limited',
    });
    return outcome(reply, CommandStatus.rejected, parsed.taskRef);
  }

  try {
    switch (parsed.intent) {
      case 'reassign_ticket': return await startReassign(ctx, parsed);
      case 'create_task':     return await startCreate(ctx, parsed);
      case 'duplicate_task':  return await startDuplicate(ctx, parsed);
      case 'bulk_reassign':   return await startBulk(ctx, parsed);
      case 'undo_last':       return await startUndo(ctx, parsed);
      case 'add_comment':
      case 'set_priority':
      case 'set_deadline':    return await startEdit(ctx, parsed);

      // Delegated outreach — creates a task, contacts nobody outside.
      case 'assign_sample_dispatch':
      case 'create_sales_task':
      case 'create_store_check_task':
      case 'create_collection_task':  return await startOutreachTask(ctx, parsed);

      // Direct outreach — messages somebody outside. Always confirms.
      case 'send_payment_reminder':   return await startPaymentReminder(ctx, parsed);
      case 'send_sample_notice':      return await startSampleNotice(ctx, parsed);

      case 'register_contact':        return await startRegisterContact(ctx, parsed);
      case 'search_contact':          return await startSearchContact(ctx, parsed);
    }
  } catch (err) {
    console.error('[Command] Unexpected failure:', err);
    await record(ctx, {
      intent: parsed.intent, entities: parsed, confidence: parsed.confidence,
      taskId: parsed.taskRef, status: CommandStatus.failed, errorReason: (err as Error).message,
    });
    return outcome(
      'Something went wrong handling that. Please try again, or use the dashboard.',
      CommandStatus.failed,
      parsed.taskRef,
    );
  }
}

// ─── Resolving the pieces ─────────────────────────────────────────────────────

/**
 * Which ticket, given that the sender may not have said.
 *
 * "Delegate this ticket to Vikranth" names no number, so fall back to whatever
 * the conversation was just about — the same context window the worker pipeline
 * uses for "also done". A ticket found that way is flagged, because it must
 * never be acted on without showing the sender which one we picked.
 */
async function resolveTicket(
  ctx: CommandContext,
  parsed: ParsedCommand,
): Promise<{ taskRef: string | null; fromContext: boolean }> {
  if (parsed.taskRef) return { taskRef: parsed.taskRef, fromContext: false };

  const contextual = await getLastAttributedTaskId(ctx.actor.id);
  return { taskRef: contextual, fromContext: contextual !== null };
}

async function loadTask(taskRef: string) {
  return prisma.task.findUnique({
    where:  { id: taskRef },
    select: {
      id: true, title: true, status: true, priority: true, deadline: true,
      assignedToId: true, assignedById: true,
      assignedTo: { select: { id: true, name: true } },
    },
  });
}

// ─── Reassignment ─────────────────────────────────────────────────────────────

async function startReassign(ctx: CommandContext, parsed: ParsedCommand): Promise<CommandOutcome> {
  const audit = { intent: parsed.intent, entities: parsed, confidence: parsed.confidence } as const;

  const { taskRef, fromContext } = await resolveTicket(ctx, parsed);
  if (!taskRef) {
    const reply =
      'I understood that you want to assign a ticket, but I could not identify the ' +
      'ticket number. Please provide it in a format such as TSK-1059.';
    await record(ctx, { ...audit, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying);
  }

  const task = await loadTask(taskRef);
  if (!task) {
    const reply = `I could not find ticket ${taskRef}. Please check the ticket number and try again.`;
    await record(ctx, { ...audit, taskId: taskRef, status: CommandStatus.rejected, errorReason: reply });
    return outcome(reply, CommandStatus.rejected, taskRef);
  }

  // ── Who to? ──────────────────────────────────────────────────────────────
  //
  // The candidate list IS the permission boundary — see nameResolutionService.
  // Someone outside the sender's hierarchy is absent from this list, so they
  // cannot be selected and the reply cannot reveal that they exist.
  const scope = await assignableUsers(ctx.actor);

  const base: PendingCommand = {
    parsed, taskId: task.id, targetId: null, targetName: null, targets: [],
    previousAssigneeName: task.assignedTo.name, fromContext, deadlineIso: null,
  };

  if (parsed.targetNames.length === 0) {
    const reply =
      `I understood that you want to reassign ${task.id}, but not who to. ` +
      `Reply with a name${scope.length ? ` — for example: ${namesOf(scope, 3)}` : ''}.`;
    await record(ctx, { ...audit, taskId: task.id, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying, task.id);
  }

  // ── Resolve every name against the sender's own team ─────────────────────
  const resolved = await resolveEveryName(ctx, parsed.targetNames, scope, base, task.id);
  if ('outcome' in resolved) return resolved.outcome;
  const targets = resolved.targets;

  const pending: PendingCommand = {
    ...base, targets, targetId: targets[0].id, targetName: targets[0].name,
  };

  const holderIds = new Set(
    (await prisma.taskAssignee.findMany({ where: { taskId: task.id }, select: { userId: true } }))
      .map((a) => a.userId),
  );

  // ── UC10: this is already exactly what was asked for ─────────────────────
  if (targets.length === holderIds.size && targets.every((t) => holderIds.has(t.id))) {
    const reply = `${task.id} is already assigned to ${listNames(targets)}. ` +
      `No duplicate assignment was created.`;
    await record(ctx, { ...audit, taskId: task.id, status: CommandStatus.rejected, errorReason: reply });
    return outcome(reply, CommandStatus.rejected, task.id);
  }

  // ── UC24: the task is finished ───────────────────────────────────────────
  // Reopening loses nothing — the activity log is append-only — but it does
  // reverse a decision an approver made, so it is never silent.
  if (task.status === 'Done') {
    return askWithButtons(ctx, pending,
      `${task.id} is completed. Reopen it and assign it to ${listNames(targets)}, or create a new copy?`,
      [
        { id: BTN.reopen, title: 'Reopen task' },
        { id: BTN.copy,   title: 'Create a copy' },
        { id: BTN.cancel, title: 'Cancel' },
      ]);
  }

  // ── UC4: several people, and nothing saying how they relate ──────────────
  // The two readings give different people different work, so this is asked
  // however confident the rest of the parse was.
  if (targets.length > 1 && parsed.assignmentIntent === null) {
    return askWithButtons(ctx, pending,
      `Should ${listNames(targets)} share ${task.id}, or should I create a separate task for each person?`,
      [
        { id: BTN.shared,   title: 'Share one task' },
        { id: BTN.separate, title: 'Separate tasks' },
        { id: BTN.cancel,   title: 'Cancel' },
      ]);
  }

  // ── UC5 / UC7: somebody already holds it ─────────────────────────────────
  // "Also assign" adds and "instead" replaces; where the sender said neither,
  // one of those answers takes the task away from somebody mid-flight, so it
  // is the question that must not be guessed.
  const newcomers = targets.filter((t) => !holderIds.has(t.id));
  // "Somebody else" excludes the sender. A manager delegating a ticket they are
  // personally holding is not taking work off anyone — they ARE the person
  // being relieved — so it needs no confirmation. That is the spec's own
  // scenario, and confirming it would put a question in front of the most
  // common command there is.
  const somebodyElseHolds = [...holderIds]
    .some((id) => id !== ctx.actor.id && !targets.some((t) => t.id === id));

  // Only an EXPLICIT "also"/"add"/"too"/"bhi" raises this. A plain "assign task
  // 4 to Vedant" says neither add nor replace and is an ordinary reassignment —
  // asking about every one of those would make the common case cost two
  // messages for no reason.
  if (parsed.adds && newcomers.length > 0 && somebodyElseHolds && parsed.assignmentIntent === null) {
    return askWithButtons(ctx, pending,
      `${task.id} is currently assigned to ${task.assignedTo.name}. Add ` +
      `${listNames(newcomers)} as a joint assignee, or reassign the task?`,
      [
        { id: BTN.add,     title: 'Add as joint' },
        { id: BTN.replace, title: 'Reassign' },
        { id: BTN.cancel,  title: 'Cancel' },
      ]);
  }

  // Three ways to end up asking, each mapping to a clause in the spec:
  //   • the name wasn't exact        — a typo, resolved but not assumed
  //   • the parse wasn't confident   — the model was guessing
  //   • the ticket came from context — the sender never said which one
  //
  // A fourth: replacement language on a task somebody else is holding, WITHOUT
  // the sender having named them. "Reassign task 4 from Vedant to Vikranth"
  // shows they already know who they are removing, so it goes through. "Give
  // task 4 to Vikranth instead" does not, and taking work off somebody who is
  // mid-flight is the thing the spec says must always be confirmed.
  const namedTheHolder =
    parsed.fromName !== null &&
    resolveName(parsed.fromName, [{ id: task.assignedToId, name: task.assignedTo.name }])
      .status === 'matched';

  const certain =
    !resolved.requiresConfirmation &&
    parsed.confidence >= confidenceThreshold() &&
    !fromContext &&
    !(parsed.replaces && somebodyElseHolds && !namedTheHolder);

  return certain ? execute(ctx, pending, false) : askToConfirm(ctx, pending);
}

/**
 * Resolve a list of names to people, or return the question that has to be
 * asked instead. Every name is searched only within `scope` — see
 * nameResolutionService for why that list IS the permission boundary.
 */
async function resolveEveryName(
  ctx: CommandContext,
  names: string[],
  scope: { id: string; name: string }[],
  base: PendingCommand,
  taskId: string | null,
): Promise<{ targets: ChoiceOption[]; requiresConfirmation: boolean } | { outcome: CommandOutcome }> {
  const targets: ChoiceOption[] = [];
  let requiresConfirmation = false;

  for (const name of names) {
    const resolution = resolveName(name, scope);

    if (resolution.status === 'not_found') {
      const reply = scope.length === 0
        ? `You don't have anyone reporting to you that I can assign work to.`
        : `I couldn't find anyone called "${name}" in your team. ` +
          `You can assign to: ${namesOf(scope, 8)}.`;
      await record(ctx, {
        intent: base.parsed.intent, entities: base.parsed,
        confidence: base.parsed.confidence, taskId,
        status: CommandStatus.rejected, errorReason: reply,
      });
      return { outcome: outcome(reply, CommandStatus.rejected, taskId) };
    }

    if (resolution.status === 'ambiguous') {
      return { outcome: await askWhichPerson(ctx, base, resolution.candidates.map((c) => c.user)) };
    }

    targets.push({ id: resolution.match!.user.id, name: resolution.match!.user.name });
    if (resolution.requiresConfirmation) requiresConfirmation = true;
  }

  return { targets, requiresConfirmation };
}

function listNames(people: { name: string }[]): string {
  if (people.length === 0) return 'nobody';
  if (people.length === 1) return people[0].name;
  return `${people.slice(0, -1).map((p) => p.name).join(', ')} and ${people[people.length - 1].name}`;
}

// ─── Attachments (UC13–UC17) ──────────────────────────────────────────────────

/**
 * A photograph or document, and what to do with it.
 *
 * Returns null when the message has nothing to do with a file, so the caller
 * carries on down the ordinary command path.
 */
export async function tryHandleAttachment(
  ctx: CommandContext,
  media: { url: string | null; kind: 'image' | 'document' | 'video' | null },
): Promise<CommandOutcome | null> {
  if (!commandsEnabled()) return null;
  if (!commandRoles().includes(ctx.actor.role)) return null;

  const parsed = parseAttachment(ctx.text, media.url !== null);
  if (!parsed) return null;

  const limit = checkRateLimit(ctx.actor.id);
  if (!limit.allowed) {
    return outcome(
      `You've sent a lot of commands in a short time. Please try again in about ` +
      `${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).`,
      CommandStatus.rejected,
    );
  }

  const audit = {
    intent: `attachment:${parsed.intent}`, entities: parsed, confidence: 0.9,
  } as const;

  // ── Which file? ──────────────────────────────────────────────────────────
  let fileUrl = media.url;
  let fileKind: 'image' | 'document' = media.kind === 'document' ? 'document' : 'image';

  if (!fileUrl) {
    // "send this to Vedant" with nothing attached — resolve from what they
    // sent us recently, and ONLY when there is exactly one candidate.
    const recent = await recentAttachments(ctx.actor.id);

    if (recent.length === 0) {
      const reply = `I don't have a recent image or document from you to send. ` +
        `Send the file first, then tell me who it's for.`;
      await record(ctx, { ...audit, status: CommandStatus.rejected, errorReason: reply });
      return outcome(reply, CommandStatus.rejected);
    }

    if (recent.length > 1) {
      // UC15. Two plausible files is a question — forwarding the wrong one to
      // the wrong person cannot be taken back.
      const options = recent.slice(0, 3).map((a, i) => ({
        id: `att_${a.id}`, title: `Option ${i + 1}`,
      }));
      const body =
        `Which file should I send?\n` +
        recent.slice(0, 3).map((a, i) => `${i + 1}. ${describeAttachment(a)}`).join('\n');

      const pending: PendingCommand = {
        parsed: attachmentAsCommand(parsed), taskId: parsed.taskRef,
        targetId: null, targetName: null, targets: [],
        previousAssigneeName: null, fromContext: true, deadlineIso: null,
        attachment: parsed, attachmentOptions: recent.slice(0, 3),
      };
      return askWithButtons(ctx, pending, body, [...options, { id: BTN.cancel, title: 'Cancel' }]);
    }

    fileUrl  = recent[0].mediaUrl;
    fileKind = recent[0].kind === 'document' ? 'document' : 'image';
  }

  return runAttachment(ctx, parsed, { url: fileUrl, kind: fileKind });
}

/** A ParsedCommand shell, so attachment flows can reuse the pending-state machinery. */
function attachmentAsCommand(a: ParsedAttachment): ParsedCommand {
  return {
    intent: 'create_task', taskRef: a.taskRef,
    targetName: a.targetNames[0] ?? null, targetNames: a.targetNames,
    assignmentIntent: null, replaces: false, adds: false, fromName: null,
    ownerName: null, dueFilter: null,
    title: a.title, deadlineText: null, priority: null, comment: null,
    reason: null,
    contactName: null, contactPhone: null, contactType: null,
    amount: null, currency: null, reference: null,
    itemDescription: null, quantity: null,
    confidence: 0.9, source: 'rule',
  };
}

async function runAttachment(
  ctx: CommandContext,
  parsed: ParsedAttachment,
  file: { url: string; kind: 'image' | 'document' },
): Promise<CommandOutcome> {
  const audit = { intent: `attachment:${parsed.intent}`, entities: parsed, confidence: 0.9 } as const;
  const actor = { id: ctx.actor.id, role: ctx.actor.role };
  const opts  = { channel: ActionChannel.whatsapp };
  const scope = await assignableUsers(ctx.actor);

  // ── UC16: put it on an existing ticket ───────────────────────────────────
  if (parsed.intent === 'attach_to_task' && parsed.taskRef) {
    const task = await loadTask(parsed.taskRef);
    if (!task) {
      const reply = `I could not find ticket ${parsed.taskRef}. Please check the ticket number and try again.`;
      await record(ctx, { ...audit, taskId: parsed.taskRef, status: CommandStatus.rejected, errorReason: reply });
      return outcome(reply, CommandStatus.rejected, parsed.taskRef);
    }

    try {
      await taskService.comment(actor, task.id, `📎 Attachment added via WhatsApp`, opts);
    } catch (err) {
      const reply = err instanceof TaskOpError ? err.message : 'Could not add the attachment.';
      await record(ctx, { ...audit, taskId: task.id, status: CommandStatus.rejected, errorReason: reply });
      return outcome(reply, CommandStatus.rejected, task.id);
    }

    // The file is linked to the TASK, not left sitting in the chat.
    await prisma.message.updateMany({
      where: { userId: ctx.actor.id, mediaUrl: file.url, taskId: null },
      data:  { taskId: task.id, attributedBy: 'manual' },
    });

    let note = `✅ The file has been added to ${task.id}.`;

    // "…and send it to Vedant" — sharing, not reassigning. The spec is explicit
    // that "send" must never remove the current holder.
    if (parsed.targetNames.length > 0) {
      const resolvedName = resolveName(parsed.targetNames[0], scope);
      if (resolvedName.status === 'matched') {
        const to = resolvedName.match!.user;
        const holds = await prisma.taskAssignee.findFirst({
          where: { taskId: task.id, userId: to.id }, select: { id: true },
        });
        if (holds) {
          const sent = await deliverFile(ctx, to.id, file, `${task.id} — ${task.title}`);
          note += ` ${sent}`;
        } else {
          const reply =
            `The file has been added to ${task.id}, which is currently assigned to ` +
            `${task.assignedTo.name}. Add ${to.name} as a joint assignee, or reassign it to them?`;
          const pending: PendingCommand = {
            parsed: attachmentAsCommand({ ...parsed, intent: 'attach_to_task' }),
            taskId: task.id, targetId: to.id, targetName: to.name, targets: [{ id: to.id, name: to.name }],
            previousAssigneeName: task.assignedTo.name, fromContext: false, deadlineIso: null,
          };
          pending.parsed.intent = 'reassign_ticket';
          return askWithButtons(ctx, pending, reply, [
            { id: BTN.add,     title: 'Add as joint' },
            { id: BTN.replace, title: 'Reassign' },
            { id: BTN.cancel,  title: 'Cancel' },
          ]);
        }
      }
    }

    await record(ctx, { ...audit, taskId: task.id, status: CommandStatus.executed });
    return outcome(note, CommandStatus.executed, task.id);
  }

  // ── Who is it for? ───────────────────────────────────────────────────────
  if (parsed.targetNames.length === 0) {
    const reply = `Who should I send this to?` + (scope.length ? ` For example: ${namesOf(scope, 3)}.` : '');
    await record(ctx, { ...audit, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying);
  }

  const resolution = resolveName(parsed.targetNames[0], scope);
  if (resolution.status === 'not_found') {
    const reply = `I couldn't find anyone called "${parsed.targetNames[0]}" in your team.` +
      (scope.length ? ` You can send to: ${namesOf(scope, 8)}.` : '');
    await record(ctx, { ...audit, status: CommandStatus.rejected, errorReason: reply });
    return outcome(reply, CommandStatus.rejected);
  }
  if (resolution.status === 'ambiguous') {
    const names = resolution.candidates.map((c) => c.user.name).join(', ');
    const reply = `I found more than one match: ${names}. Which one?`;
    await record(ctx, { ...audit, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying);
  }

  const to = resolution.match!.user;

  // ── UC17: forward without creating anything ──────────────────────────────
  if (parsed.intent === 'forward_only') {
    const sent = await deliverFile(ctx, to.id, file, parsed.title ?? undefined);
    await record(ctx, { ...audit, newAssigneeId: to.id, status: CommandStatus.executed });
    return outcome(`${sent} No task was created.`, CommandStatus.executed);
  }

  // ── UC13/UC14: the file becomes a task ───────────────────────────────────
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 1);
  deadline.setHours(18, 0, 0, 0);

  try {
    const task = await taskService.create(actor, {
      title: parsed.title ?? 'Review the attached file',
      assignedToId: to.id,
      deadline,
    }, opts);

    // Link the file to the new task so it is on the record, not only in chat.
    await prisma.message.updateMany({
      where: { userId: ctx.actor.id, mediaUrl: file.url, taskId: null },
      data:  { taskId: task.id, attributedBy: 'manual' },
    });

    const sent = await deliverFile(ctx, to.id, file, `${task.id} — ${task.title}`);
    await record(ctx, { ...audit, taskId: task.id, newAssigneeId: to.id, status: CommandStatus.executed });

    return outcome(
      `✅ Task ${task.id} created for ${task.assignedTo.name}: "${task.title}". ` +
      `The attachment was added to the task. ${sent}`,
      CommandStatus.executed,
      task.id,
    );
  } catch (err) {
    const isRefusal = err instanceof TaskOpError;
    const reply = isRefusal ? (err as TaskOpError).message : 'Something went wrong creating that task.';
    await record(ctx, {
      ...audit, status: isRefusal ? CommandStatus.rejected : CommandStatus.failed,
      errorReason: (err as Error).message,
    });
    return outcome(reply, isRefusal ? CommandStatus.rejected : CommandStatus.failed);
  }
}

/**
 * Put the file in front of somebody.
 *
 * Meta only permits free-form media inside the recipient's 24-hour window. When
 * it is shut the file cannot be delivered at all — so rather than failing, the
 * task keeps the attachment and the person is sent the approved template so
 * they know to look. The sender is told which of the two happened, because
 * "sent" and "saved for them to find" are not the same promise.
 */
async function deliverFile(
  ctx: CommandContext,
  toUserId: string,
  file: { url: string; kind: 'image' | 'document' },
  caption?: string,
): Promise<string> {
  const person = await prisma.user.findUnique({
    where: { id: toUserId },
    select: { id: true, name: true, phone: true, preferredLanguage: true },
  });
  if (!person?.phone) return `${person?.name ?? 'They'} has no WhatsApp number, so the file is on the task only.`;

  const session = computeSession(await getLastInbound(person.id));
  if (!session.open) {
    return `${person.name} hasn't messaged in 24h, so WhatsApp won't deliver the file directly — ` +
      `it's saved on the task and they've been notified to open it.`;
  }

  const result = await sendMediaMessage(person.phone, file.url, { kind: file.kind, caption });

  await prisma.message.create({
    data: {
      userId: person.id, senderId: ctx.actor.id, direction: 'outbound',
      kind: file.kind === 'document' ? 'document' : 'image',
      mediaUrl: file.url, text: caption ?? '',
      waMessageId: result.waMessageId ?? null,
      deliveryStatus: result.ok ? 'sent' : 'failed',
      deliveryError: result.ok ? null : result.error ?? 'Send failed',
    },
  });

  // Never report success for a send Meta rejected.
  return result.ok
    ? `Sent to ${person.name}.`
    : `⚠️ WhatsApp could not deliver the file to ${person.name} (${result.error}). It is saved on the task.`;
}

// ─── Duplication (UC11, UC12) ─────────────────────────────────────────────────

async function startDuplicate(ctx: CommandContext, parsed: ParsedCommand): Promise<CommandOutcome> {
  const audit = { intent: parsed.intent, entities: parsed, confidence: parsed.confidence } as const;

  const task = parsed.taskRef ? await loadTask(parsed.taskRef) : null;
  if (!task) {
    const reply = `I could not find ticket ${parsed.taskRef ?? 'that'}. Please check the ticket number and try again.`;
    await record(ctx, { ...audit, taskId: parsed.taskRef, status: CommandStatus.rejected, errorReason: reply });
    return outcome(reply, CommandStatus.rejected, parsed.taskRef);
  }

  const scope = await assignableUsers(ctx.actor);
  const base: PendingCommand = {
    parsed, taskId: task.id, targetId: null, targetName: null, targets: [],
    previousAssigneeName: task.assignedTo.name, fromContext: false, deadlineIso: null,
  };

  if (parsed.targetNames.length === 0) {
    const reply = `Who should the copy of ${task.id} be for?` +
      (scope.length ? ` For example: ${namesOf(scope, 3)}.` : '');
    await record(ctx, { ...audit, taskId: task.id, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying, task.id);
  }

  const resolved = await resolveEveryName(ctx, parsed.targetNames, scope, base, task.id);
  if ('outcome' in resolved) return resolved.outcome;

  const pending: PendingCommand = {
    ...base, targets: resolved.targets,
    targetId: resolved.targets[0].id, targetName: resolved.targets[0].name,
    // Duplication is always "one each" — that is what a copy IS.
    resolution: 'separate',
  };

  const certain = !resolved.requiresConfirmation && parsed.confidence >= confidenceThreshold();
  return certain ? execute(ctx, pending, false) : askToConfirm(ctx, pending);
}

// ─── Bulk reassignment (UC8, UC9) ─────────────────────────────────────────────

async function startBulk(ctx: CommandContext, parsed: ParsedCommand): Promise<CommandOutcome> {
  const audit = { intent: parsed.intent, entities: parsed, confidence: parsed.confidence } as const;
  const scope = await assignableUsers(ctx.actor);

  const base: PendingCommand = {
    parsed, taskId: null, targetId: null, targetName: null, targets: [],
    previousAssigneeName: null, fromContext: false, deadlineIso: null,
  };

  if (!parsed.ownerName || parsed.targetNames.length === 0) {
    const reply =
      `I understood that you want to move several tasks, but not ${!parsed.ownerName ? 'whose' : 'who to'}. ` +
      `Try "Move all of Vedant's pending tasks to Vikranth".`;
    await record(ctx, { ...audit, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying);
  }

  // Both people must be inside the sender's team — the person losing the work
  // as much as the one gaining it.
  const owner = await resolveEveryName(ctx, [parsed.ownerName], scope, base, null);
  if ('outcome' in owner) return owner.outcome;
  const target = await resolveEveryName(ctx, parsed.targetNames, scope, base, null);
  if ('outcome' in target) return target.outcome;

  const from = owner.targets[0];
  const to   = target.targets[0];

  if (from.id === to.id) {
    const reply = `${from.name} already holds those tasks — nothing to move.`;
    await record(ctx, { ...audit, status: CommandStatus.rejected, errorReason: reply });
    return outcome(reply, CommandStatus.rejected);
  }

  // Only OPEN work. Completed, submitted and approved tasks are history and
  // must not be swept into a bulk move.
  const due = parsed.dueFilter ? parseDeadline(parsed.dueFilter) : null;
  if (parsed.dueFilter && !due) {
    const reply = `I couldn't work out the date "${parsed.dueFilter}". Try "due tomorrow" or "due on Friday".`;
    await record(ctx, { ...audit, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying);
  }

  const dayWindow = due
    ? {
        gte: new Date(due.getFullYear(), due.getMonth(), due.getDate(), 0, 0, 0, 0),
        lte: new Date(due.getFullYear(), due.getMonth(), due.getDate(), 23, 59, 59, 999),
      }
    : undefined;

  const open = await prisma.task.findMany({
    where: {
      ...taskService.heldByUser(from.id),
      status: { notIn: ['Done', 'Submitted'] },
      ...(dayWindow && { deadline: dayWindow }),
    },
    select: { id: true, title: true },
    orderBy: { deadline: 'asc' },
  });

  if (open.length === 0) {
    const reply = due
      ? `${from.name} has no open tasks due ${fmtDate(due)}.`
      : `${from.name} has no open tasks to move.`;
    await record(ctx, { ...audit, status: CommandStatus.rejected, errorReason: reply });
    return outcome(reply, CommandStatus.rejected);
  }

  const pending: PendingCommand = {
    ...base,
    targets: [to], targetId: to.id, targetName: to.name,
    previousAssigneeName: from.name,
    bulkTaskIds: open.map((t) => t.id),
  };

  // ALWAYS confirmed, however clear the wording. This moves work the sender has
  // not looked at one by one, and the count is the thing they most need to see
  // before agreeing to it.
  await setState(ctx.actor.id, 'confirm', pending);
  const listed = open.slice(0, 5).map((t) => `${t.id} ${t.title}`).join('\n• ');
  const more   = open.length > 5 ? `\n…and ${open.length - 5} more` : '';
  const when   = due ? ` due ${fmtDate(due)}` : ' pending';

  const reply =
    `${from.name} has ${open.length} task${open.length > 1 ? 's' : ''}${when}:\n• ${listed}${more}\n\n` +
    `Reassign all ${open.length} to ${to.name}? Reply "Confirm" to continue, or "Cancel" to stop.`;

  await record(ctx, { ...audit, newAssigneeId: to.id, previousAssigneeId: from.id,
    status: CommandStatus.awaiting_confirmation, errorReason: reply });
  return outcome(reply, CommandStatus.awaiting_confirmation);
}

// ─── Undo (UC25) ──────────────────────────────────────────────────────────────

/** How far back "undo the last one" can reach. */
function undoWindowMs(): number {
  const s = parseInt(process.env.WA_UNDO_WINDOW_S ?? '3600', 10);
  return (Number.isFinite(s) && s > 0 ? s : 3600) * 1000;
}

async function startUndo(ctx: CommandContext, parsed: ParsedCommand): Promise<CommandOutcome> {
  const audit = { intent: parsed.intent, entities: parsed, confidence: parsed.confidence } as const;

  // The sender's own most recent reversible action, not anyone else's — and
  // only one that has not already been undone.
  const last = await prisma.whatsAppCommand.findFirst({
    where: {
      senderId: ctx.actor.id,
      status: CommandStatus.executed,
      intent: 'reassign_ticket',
      undoneAt: null,
      previousAssigneeId: { not: null },
      createdAt: { gt: new Date(Date.now() - undoWindowMs()) },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!last || !last.taskId || !last.previousAssigneeId) {
    const reply = `I couldn't find a recent assignment of yours to undo.`;
    await record(ctx, { ...audit, status: CommandStatus.rejected, errorReason: reply });
    return outcome(reply, CommandStatus.rejected);
  }

  const [task, previous, current] = await Promise.all([
    loadTask(last.taskId),
    prisma.user.findUnique({ where: { id: last.previousAssigneeId }, select: { id: true, name: true } }),
    last.newAssigneeId
      ? prisma.user.findUnique({ where: { id: last.newAssigneeId }, select: { id: true, name: true } })
      : null,
  ]);

  if (!task || !previous) {
    const reply = `That assignment can no longer be undone — the task or the person is gone.`;
    await record(ctx, { ...audit, status: CommandStatus.rejected, errorReason: reply });
    return outcome(reply, CommandStatus.rejected);
  }

  // Somebody has since moved it on. Undoing would overwrite a decision that
  // isn't the one being reversed.
  if (current && task.assignedToId !== current.id) {
    const reply =
      `${task.id} has changed hands again since then, so undoing would overwrite ` +
      `a newer change. Reassign it explicitly if that's what you want.`;
    await record(ctx, { ...audit, taskId: task.id, status: CommandStatus.rejected, errorReason: reply });
    return outcome(reply, CommandStatus.rejected, task.id);
  }

  const pending: PendingCommand = {
    parsed, taskId: task.id,
    targetId: previous.id, targetName: previous.name, targets: [previous],
    previousAssigneeName: current?.name ?? task.assignedTo.name,
    fromContext: false, deadlineIso: null,
    undoCommandId: last.id,
  };

  await setState(ctx.actor.id, 'confirm', pending);

  const worked = await prisma.activity.count({
    where: { taskId: task.id, byId: current?.id, createdAt: { gt: last.createdAt } },
  });

  const reply =
    `Your last action assigned ${task.id} to ${current?.name ?? 'someone'}. ` +
    (worked > 0 ? `They have already worked on it since. ` : '') +
    `Undo it and give ${task.id} back to ${previous.name}? Reply "Confirm" or "Cancel".`;

  await record(ctx, { ...audit, taskId: task.id, status: CommandStatus.awaiting_confirmation, errorReason: reply });
  return outcome(reply, CommandStatus.awaiting_confirmation, task.id);
}

// ─── Creation ─────────────────────────────────────────────────────────────────

async function startCreate(ctx: CommandContext, parsed: ParsedCommand): Promise<CommandOutcome> {
  const audit = { intent: parsed.intent, entities: parsed, confidence: parsed.confidence } as const;

  if (!parsed.title) {
    const reply =
      'I understood that you want to create a task, but not what it is. Try ' +
      '"Create a task for Vedant to prepare the weekly report by Friday".';
    await record(ctx, { ...audit, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying);
  }

  const scope = await assignableUsers(ctx.actor);
  const base: PendingCommand = {
    parsed, taskId: null, targetId: null, targetName: null, targets: [],
    previousAssigneeName: null, fromContext: false, deadlineIso: null,
  };

  if (parsed.targetNames.length === 0) {
    const reply =
      `I understood that you want to create "${parsed.title}", but not who for. ` +
      `Reply with a name${scope.length ? ` — for example: ${namesOf(scope, 3)}` : ''}.`;
    await record(ctx, { ...audit, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying);
  }

  const resolved = await resolveEveryName(ctx, parsed.targetNames, scope, base, null);
  if ('outcome' in resolved) return resolved.outcome;
  const targets = resolved.targets;

  // A task with no deadline can't exist — the escalation engine is built on it.
  // So an unreadable date is a question, never a default.
  const deadline = parsed.deadlineText ? parseDeadline(parsed.deadlineText) : null;
  if (!deadline) {
    const reply = parsed.deadlineText
      ? `I couldn't work out the date "${parsed.deadlineText}". When is "${parsed.title}" due? ` +
        `Try "by Friday", "tomorrow", or "15/08".`
      : `When is "${parsed.title}" due? Try "by Friday", "tomorrow", or "15/08".`;
    await record(ctx, { ...audit, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying);
  }

  const pending: PendingCommand = {
    ...base,
    targets,
    targetId: targets[0].id,
    targetName: targets[0].name,
    deadlineIso: deadline.toISOString(),
  };

  // Same question as reassignment, and for the same reason: two people named
  // and no word saying whether that is one job or two.
  if (targets.length > 1 && parsed.assignmentIntent === null) {
    return askWithButtons(ctx, pending,
      `Should ${listNames(targets)} share one task for "${parsed.title}", or should I create a separate task for each?`,
      [
        { id: BTN.shared,   title: 'Share one task' },
        { id: BTN.separate, title: 'Separate tasks' },
        { id: BTN.cancel,   title: 'Cancel' },
      ]);
  }

  const certain = !resolved.requiresConfirmation && parsed.confidence >= confidenceThreshold();
  return certain ? execute(ctx, pending, false) : askToConfirm(ctx, pending);
}

// ─── Comment / priority / deadline ────────────────────────────────────────────

async function startEdit(ctx: CommandContext, parsed: ParsedCommand): Promise<CommandOutcome> {
  const audit = { intent: parsed.intent, entities: parsed, confidence: parsed.confidence } as const;

  const { taskRef, fromContext } = await resolveTicket(ctx, parsed);
  if (!taskRef) {
    const reply =
      'I understood what you want to change, but not which ticket. ' +
      'Please include it in a format such as TSK-1059.';
    await record(ctx, { ...audit, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying);
  }

  const task = await loadTask(taskRef);
  if (!task) {
    const reply = `I could not find ticket ${taskRef}. Please check the ticket number and try again.`;
    await record(ctx, { ...audit, taskId: taskRef, status: CommandStatus.rejected, errorReason: reply });
    return outcome(reply, CommandStatus.rejected, taskRef);
  }

  const pending: PendingCommand = {
    parsed, taskId: task.id, targetId: null, targetName: null, targets: [],
    previousAssigneeName: task.assignedTo.name, fromContext, deadlineIso: null,
  };

  // Each intent needs its own value present before there is anything to do.
  if (parsed.intent === 'add_comment' && !parsed.comment) {
    const reply = `What should the comment on ${task.id} say?`;
    await record(ctx, { ...audit, taskId: task.id, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying, task.id);
  }

  if (parsed.intent === 'set_priority' && !parsed.priority) {
    const reply = `What priority should ${task.id} be — High, Medium or Low?`;
    await record(ctx, { ...audit, taskId: task.id, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying, task.id);
  }

  if (parsed.intent === 'set_deadline') {
    const deadline = parsed.deadlineText ? parseDeadline(parsed.deadlineText) : null;
    if (!deadline) {
      const reply = parsed.deadlineText
        ? `I couldn't work out the date "${parsed.deadlineText}". Try "Friday", "tomorrow", or "15/08".`
        : `When should ${task.id} be due? Try "Friday", "tomorrow", or "15/08".`;
      await record(ctx, { ...audit, taskId: task.id, status: CommandStatus.clarifying, errorReason: reply });
      return outcome(reply, CommandStatus.clarifying, task.id);
    }
    pending.deadlineIso = deadline.toISOString();
  }

  const certain = parsed.confidence >= confidenceThreshold() && !fromContext;
  return certain ? execute(ctx, pending, false) : askToConfirm(ctx, pending);
}

// ─── Asking ───────────────────────────────────────────────────────────────────

/**
 * Offer a small set of choices as WhatsApp buttons.
 *
 * Meta allows at most three, which is exactly what every question here needs:
 * two ways forward and a way out. The reply arrives as the button's id in the
 * message text, so `resolvePending` matches on `BTN.*` rather than on wording
 * — and the same handler still accepts a typed answer for anyone whose client
 * doesn't render buttons.
 */
async function askWithButtons(
  ctx: CommandContext,
  pending: PendingCommand,
  body: string,
  buttons: { id: string; title: string }[],
): Promise<CommandOutcome> {
  await setState(ctx.actor.id, 'choose_option', pending, buttons);

  if (ctx.actor.phone) {
    await sendInteractiveButtons(ctx.actor.phone, body, buttons.slice(0, 3));
  }

  await record(ctx, {
    intent: pending.parsed.intent, entities: pending.parsed,
    confidence: pending.parsed.confidence, taskId: pending.taskId,
    status: CommandStatus.clarifying, errorReason: body,
  });

  // The text is returned as well as sent: a client that can't render buttons
  // still sees the question, and the caller records it in the thread.
  return outcome(
    `${body}\n${buttons.map((b) => `• ${b.title}`).join('\n')}`,
    CommandStatus.clarifying,
    pending.taskId,
  );
}

async function askWhichPerson(
  ctx: CommandContext,
  pending: PendingCommand,
  candidates: ChoiceOption[],
): Promise<CommandOutcome> {
  const options = candidates.map((c) => ({ id: c.id, name: c.name }));
  await setState(ctx.actor.id, 'choose_employee', pending, options);

  const reply =
    `I found ${options.length} employees with similar names: ` +
    `${options.map((o, i) => `${i + 1}. ${o.name}`).join('  ')}\n` +
    `Please reply with the correct name or its number.`;

  await record(ctx, {
    intent: pending.parsed.intent, entities: pending.parsed,
    confidence: pending.parsed.confidence, taskId: pending.taskId,
    status: CommandStatus.clarifying, errorReason: reply,
  });
  return outcome(reply, CommandStatus.clarifying, pending.taskId);
}

// ─── Outreach ─────────────────────────────────────────────────────────────────
//
// Two shapes, and the difference between them is the whole safety story:
//
//   DELEGATED  creates a task for an employee. Low risk, reversible, and the
//              external party is never contacted — so it executes directly at
//              high confidence, exactly like `create_task`.
//
//   DIRECT     sends a message to somebody outside the company. Not reversible
//              and not correctable: a wrong amount to the wrong vendor cannot
//              be unsent. These ALWAYS confirm, whatever the confidence, and
//              the confirmation reads back the parsed values rather than the
//              raw message — so a mis-parse is visible before it is sent, not
//              after.

/** Above this, a confirmation spells the amount out in words as well as digits. */
function largeAmountThreshold(): number {
  return Number(process.env.WA_CONFIRM_AMOUNT ?? 100_000);
}

/** How long a contact counts as newly added, for the extra warning. */
const NEW_CONTACT_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve the party the sender named to a contact row.
 *
 * Returns either a resolved contact, or an outcome that has already asked the
 * sender something. The candidate list comes from `contactCandidates`, which
 * is scoped to what this sender may message — so a party outside their scope
 * is not "forbidden", it simply was never a candidate, which is the same
 * property `assignableUsers` gives the employee side.
 */
async function resolveContactNamed(
  ctx: CommandContext,
  parsed: ParsedCommand,
  name: string,
): Promise<
  | { contact: { id: string; name: string; phone: string; createdAt: Date }; requiresConfirmation: boolean }
  | { outcome: CommandOutcome }
> {
  const candidates = await contactCandidates({ id: ctx.actor.id, role: ctx.actor.role });

  if (candidates.length === 0) {
    return {
      outcome: await refuseIn(ctx, parsed, 'noContacts'),
    };
  }

  const resolution = resolveName(name, candidates);

  if (resolution.status === 'not_found') {
    return {
      outcome: await refuseIn(ctx, parsed, 'contactNotFound', { name }),
    };
  }

  if (resolution.status === 'ambiguous') {
    // De-duplicate by contact id: aliases put the same party in the list more
    // than once, and offering "1. Ramesh Traders  2. Ramesh Traders" is not a
    // question anybody can answer.
    const seen = new Set<string>();
    const unique = resolution.candidates.filter((c) => {
      const id = (c.user as { contactId?: string }).contactId ?? c.user.id;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    if (unique.length === 1) {
      const only = await loadContact(unique[0].user.id);
      if (only) return { contact: only, requiresConfirmation: true };
    }

    return { outcome: await askWhichContact(ctx, parsed, unique.slice(0, 5)) };
  }

  const contact = await loadContact(resolution.match!.user.id);
  if (!contact) {
    return { outcome: await refuseIn(ctx, parsed, 'contactNotFound', { name }) };
  }
  return { contact, requiresConfirmation: resolution.requiresConfirmation };
}

async function loadContact(id: string) {
  return prisma.contact.findUnique({
    where:  { id },
    select: { id: true, name: true, phone: true, createdAt: true },
  });
}

/** Ask which of several similarly-named parties was meant. */
async function askWhichContact(
  ctx: CommandContext,
  parsed: ParsedCommand,
  options: Array<{ user: Candidate }>,
): Promise<CommandOutcome> {
  const rows = await prisma.contact.findMany({
    where:  { id: { in: options.map((o) => o.user.id) } },
    select: { id: true, name: true, companyName: true, address: true },
  });

  const pending: PendingCommand = {
    parsed, taskId: null, targetId: null, targetName: null, targets: [],
    previousAssigneeName: null, fromContext: false, deadlineIso: null,
  };

  await setState(
    ctx.actor.id, 'choose_contact', pending,
    rows.map((r) => ({ id: r.id, name: r.name })),
  );

  // The distinguishing detail matters more than the name here — two rows both
  // called "Ramesh Traders" are unanswerable without the city or company.
  const lines = rows
    .map((r, i) => {
      const detail = [r.companyName, r.address].filter(Boolean).join(' — ');
      return `${i + 1}. ${r.name}${detail ? ` – ${detail}` : ''}`;
    })
    .join('\n');

  const reply = `I found ${rows.length} matches:\n${lines}\n\nWhich one do you mean? Reply with the number.`;

  await record(ctx, {
    intent: parsed.intent, entities: parsed, confidence: parsed.confidence,
    status: CommandStatus.clarifying, errorReason: reply,
  });
  return outcome(reply, CommandStatus.clarifying, null);
}

/**
 * Record a refusal and phrase it for somebody who is not a programmer.
 *
 * "I couldn't find Sahil in the employee list", never "Foreign key constraint
 * failed" — and in the sender's own language, since somebody who cannot read
 * the refusal cannot act on it.
 */
async function refuseIn(
  ctx: CommandContext,
  parsed: ParsedCommand,
  key: Parameters<typeof t>[1],
  vars: Record<string, string | number> = {},
): Promise<CommandOutcome> {
  return refuse(ctx, parsed, t(langOf(ctx.actor.preferredLanguage), key, vars));
}

async function refuse(
  ctx: CommandContext,
  parsed: ParsedCommand,
  reply: string,
): Promise<CommandOutcome> {
  await record(ctx, {
    intent: parsed.intent, entities: parsed, confidence: parsed.confidence,
    status: CommandStatus.rejected, errorReason: reply,
  });
  return outcome(reply, CommandStatus.rejected, null);
}

/** What each delegated intent becomes on the task record. */
const OUTREACH_TASK_KIND: Record<string, TaskKind> = {
  assign_sample_dispatch:  TaskKind.sample_dispatch,
  create_sales_task:       TaskKind.sales,
  create_store_check_task: TaskKind.stock_check,
  create_collection_task:  TaskKind.payment_followup,
};

/**
 * "Ask Sahil to send samples to Urja Vart" — a task for an employee, about an
 * outside party who is NOT messaged.
 *
 * Deliberately as permissive as `create_task`: the brief is explicit that a
 * low-risk internal action should execute and confirm rather than interrogate.
 * The one thing that cannot be defaulted is the deadline, because
 * `taskService.create` requires a real one and inventing a date somebody will
 * be escalated against is worse than asking.
 */
async function startOutreachTask(
  ctx: CommandContext,
  parsed: ParsedCommand,
): Promise<CommandOutcome> {
  const assignable = await assignableUsers({ id: ctx.actor.id, role: ctx.actor.role });
  if (assignable.length === 0) {
    return refuse(ctx, parsed, 'You do not have anybody to assign work to.');
  }

  if (!parsed.targetName) {
    return refuseIn(ctx, parsed, 'askWho');
  }

  const base: PendingCommand = {
    parsed, taskId: null, targetId: null, targetName: null, targets: [],
    previousAssigneeName: null, fromContext: false, deadlineIso: null,
  };
  const resolved = await resolveEveryName(ctx, parsed.targetNames, assignable, base, null);
  if ('outcome' in resolved) return resolved.outcome;
  const { targets, requiresConfirmation } = resolved;

  // The external party is optional — a store check often concerns nobody
  // outside the company at all — but a NAMED party that cannot be found is an
  // error, not something to quietly drop.
  let contactId: string | null = null;
  let contactName: string | null = null;
  let contactIsNew = false;

  if (parsed.contactName) {
    const found = await resolveContactNamed(ctx, parsed, parsed.contactName);
    if ('outcome' in found) return found.outcome;
    contactId    = found.contact.id;
    contactName  = found.contact.name;
    contactIsNew = Date.now() - found.contact.createdAt.getTime() < NEW_CONTACT_MS;
  }

  const deadline = parsed.deadlineText ? parseDeadline(parsed.deadlineText) : null;
  if (parsed.deadlineText && !deadline) {
    return refuseIn(ctx, parsed, 'askDate', { text: parsed.deadlineText });
  }

  const pending: PendingCommand = {
    parsed,
    taskId: null,
    targetId: targets[0]?.id ?? null,
    targetName: targets[0]?.name ?? null,
    targets,
    previousAssigneeName: null,
    fromContext: false,
    deadlineIso: (deadline ?? defaultOutreachDeadline()).toISOString(),
    contactId,
    contactName,
    contactIsNew,
    itemText:     parsed.itemDescription,
    quantityText: parsed.quantity,
    reference:    parsed.reference,
    amount:       parsed.amount,
    currency:     parsed.currency,
  };

  // Creating internal work is reversible and touches nobody outside, so the
  // ordinary confidence gate applies. No extra friction is added here.
  const certain = parsed.confidence >= confidenceThreshold() && !requiresConfirmation;
  return certain ? execute(ctx, pending, false) : askToConfirm(ctx, pending);
}

/**
 * When the sender did not say when.
 *
 * `taskService.create` requires a real deadline and will not invent one. Rather
 * than interrogate an Admin who just wants a task raised — which the brief
 * explicitly asks us not to do for optional information — an outreach task
 * defaults to the end of the next working day, and the confirmation says so.
 */
function defaultOutreachDeadline(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(18, 0, 0, 0);
  return d;
}

/**
 * "Send a payment reminder of ₹45,000 to Ramesh Traders" — a message to
 * somebody outside the company, about money.
 *
 * Always confirms. The `WA_CONFIDENCE_THRESHOLD` gate that lets a reassignment
 * through was tuned for an action that is undoable and internal; this one is
 * neither, and a confident mis-parse is exactly the case that gate cannot
 * catch.
 */
async function startPaymentReminder(
  ctx: CommandContext,
  parsed: ParsedCommand,
): Promise<CommandOutcome> {
  if (!parsed.contactName) {
    return refuseIn(ctx, parsed, 'askWhoToRemind');
  }

  const found = await resolveContactNamed(ctx, parsed, parsed.contactName);
  if ('outcome' in found) return found.outcome;
  const contact = found.contact;

  const actor = { id: ctx.actor.id, role: ctx.actor.role };

  // The invoice is the source of truth when we hold one. A figure typed on a
  // phone cannot be checked against anything, and this message asks a real
  // business for real money.
  const invoice = parsed.reference ? await invoiceService.findByRef(actor, parsed.reference) : null;

  if (parsed.reference && !invoice) {
    // Not an error — the client may genuinely not have recorded it. But the
    // sender is told, so they know the amount is the one they typed.
    if (parsed.amount === null) {
      return refuseIn(ctx, parsed, 'invoiceUnknownNoAmount', { ref: parsed.reference });
    }
  }

  const amount   = invoice ? Number(invoice.balance) : parsed.amount;
  const currency = invoice ? invoice.currency : (parsed.currency ?? 'INR');

  if (amount === null || amount === undefined) {
    return refuseIn(ctx, parsed, 'askAmount', { name: contact.name });
  }

  const dueDate   = invoice?.dueDate ?? (parsed.deadlineText ? parseDeadline(parsed.deadlineText) : null) ?? new Date();
  const reference = invoice ? `Invoice ${invoice.number}` : (parsed.reference ? `Invoice ${parsed.reference}` : 'your account');

  const pending: PendingCommand = {
    parsed,
    taskId: null, targetId: null, targetName: null, targets: [],
    previousAssigneeName: null, fromContext: false, deadlineIso: dueDate.toISOString(),
    contactId:          contact.id,
    contactName:        contact.name,
    contactPhoneMasked: maskPhone(contact.phone),
    contactIsNew:       Date.now() - contact.createdAt.getTime() < NEW_CONTACT_MS,
    invoiceId:          invoice?.id ?? null,
    amount,
    currency,
    reference,
    dateText:           fmtDate(dueDate),
  };

  return askToConfirm(ctx, pending);
}

/** "Send the sample dispatch message to Rakesh" — a notice, direct to the party. */
async function startSampleNotice(
  ctx: CommandContext,
  parsed: ParsedCommand,
): Promise<CommandOutcome> {
  if (!parsed.contactName) {
    return refuseIn(ctx, parsed, 'askWhoToNotify');
  }

  const found = await resolveContactNamed(ctx, parsed, parsed.contactName);
  if ('outcome' in found) return found.outcome;
  const contact = found.contact;

  const arrival = (parsed.deadlineText ? parseDeadline(parsed.deadlineText) : null) ?? defaultOutreachDeadline();

  const pending: PendingCommand = {
    parsed,
    taskId: null, targetId: null, targetName: null, targets: [],
    previousAssigneeName: null, fromContext: false, deadlineIso: arrival.toISOString(),
    contactId:          contact.id,
    contactName:        contact.name,
    contactPhoneMasked: maskPhone(contact.phone),
    contactIsNew:       Date.now() - contact.createdAt.getTime() < NEW_CONTACT_MS,
    itemText:           parsed.itemDescription ?? parsed.quantity ?? 'samples',
    reference:          parsed.reference ?? '—',
    dateText:           fmtDate(arrival),
  };

  return askToConfirm(ctx, pending);
}

/**
 * "register vendor Metro Logistics 9876543210".
 *
 * Always confirms, whatever the confidence. A typo here does not fail loudly —
 * it silently creates a party that does not exist and points every future
 * message at a stranger's phone.
 */
async function startRegisterContact(
  ctx: CommandContext,
  parsed: ParsedCommand,
): Promise<CommandOutcome> {
  if (!parsed.contactName) {
    return refuseIn(ctx, parsed, 'askRegisterName');
  }
  if (!parsed.contactPhone) {
    return refuseIn(ctx, parsed, 'askRegisterPhone', { name: parsed.contactName });
  }

  const pending: PendingCommand = {
    parsed,
    taskId: null, targetId: null, targetName: null, targets: [],
    previousAssigneeName: null, fromContext: false, deadlineIso: null,
    contactName:        parsed.contactName,
    contactPhoneMasked: maskPhone(parsed.contactPhone),
  };

  return askToConfirm(ctx, pending);
}

/** "find Metro Logistics" — read-only, so it answers immediately. */
async function startSearchContact(
  ctx: CommandContext,
  parsed: ParsedCommand,
): Promise<CommandOutcome> {
  const query = parsed.contactName;
  if (!query) return refuseIn(ctx, parsed, 'askWhoToRemind');

  const candidates = await contactCandidates({ id: ctx.actor.id, role: ctx.actor.role });
  const resolution = resolveName(query, candidates);

  if (resolution.status === 'not_found') {
    const reply = `I couldn't find "${query}" in the system. Reply: register vendor ${query} <phone number> to add them.`;
    await record(ctx, {
      intent: parsed.intent, entities: parsed, confidence: parsed.confidence,
      status: CommandStatus.executed, errorReason: null,
    });
    return outcome(reply, CommandStatus.executed, null);
  }

  const ids = resolution.status === 'matched'
    ? [resolution.match!.user.id]
    : [...new Set(resolution.candidates.map((c) => c.user.id))].slice(0, 5);

  const rows = await prisma.contact.findMany({
    where:  { id: { in: ids } },
    select: { name: true, companyName: true, type: true, phone: true, optOutAt: true },
  });

  const lines = rows.map((r) => {
    const bits = [r.companyName, r.type, maskPhone(r.phone)].filter(Boolean).join(' · ');
    return `• ${r.name}${bits ? ` — ${bits}` : ''}${r.optOutAt ? ' (opted out)' : ''}`;
  }).join('\n');

  await record(ctx, {
    intent: parsed.intent, entities: parsed, confidence: parsed.confidence,
    status: CommandStatus.executed,
  });
  return outcome(`Found:\n${lines}`, CommandStatus.executed, null);
}

/**
 * Show enough of a number to identify it, not enough to misuse it.
 *
 * The confirmation has to prove we are about to message the RIGHT party, and
 * the last four digits do that — while a full number echoed into a WhatsApp
 * thread is a copy of somebody's contact details sitting in a chat log.
 */
function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? `+${digits.slice(0, 2)} ••••${digits.slice(-4)}` : null;
}

/**
 * An amount spelled out, for a confirmation the sender must not skim.
 *
 * Indian units, because "one lakh twenty thousand" is how the number is read
 * aloud here and "120 thousand" is not.
 */
function amountInWords(value: number): string {
  if (value >= 10_000_000) return `${trimZeros(value / 10_000_000)} crore`;
  if (value >= 100_000)    return `${trimZeros(value / 100_000)} lakh`;
  if (value >= 1_000)      return `${trimZeros(value / 1_000)} thousand`;
  return String(value);
}

function trimZeros(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * The task title an outreach instruction produces.
 *
 * Written to read like something a person would have typed on the dashboard,
 * because it appears in the tracker beside tasks that were. The full original
 * message is kept in the description, so nothing the sender said is lost even
 * where the title summarises.
 */
function outreachTitle(pending: PendingCommand): string {
  const party = pending.contactName;
  const item  = pending.itemText;
  const qty   = pending.quantityText;
  const thing = [qty, item].filter(Boolean).join(' ') || null;

  switch (pending.parsed.intent) {
    case 'assign_sample_dispatch':
      return `Send ${thing ?? 'samples'}${party ? ` to ${party}` : ''}`;
    case 'create_sales_task':
      return `Create a sale${party ? ` for ${party}` : ''}${thing ? ` — ${thing}` : ''}`;
    case 'create_store_check_task':
      return `Check stock${thing ? ` of ${thing}` : ''}${party ? ` with ${party}` : ''}`;
    case 'create_collection_task':
      return `Follow up payment${party ? ` from ${party}` : ''}`
        + `${pending.amount ? ` — ${outreachService.money(pending.amount, pending.currency ?? 'INR')}` : ''}`;
    default:
      return pending.parsed.title ?? 'Task';
  }
}

/**
 * The structured detail, on the existing `customFields` Json column.
 *
 * Deliberately not new columns: these differ per use case and would otherwise
 * mean a migration each time the client names another thing they want captured.
 * Empty values are dropped so the task detail panel does not show a column of
 * blank rows.
 */
function outreachCustomFields(pending: PendingCommand): Record<string, string> {
  const fields: Record<string, string> = {};
  if (pending.contactName)  fields.Party     = pending.contactName;
  if (pending.itemText)     fields.Item      = pending.itemText;
  if (pending.quantityText) fields.Quantity  = pending.quantityText;
  if (pending.reference)    fields.Reference = pending.reference;
  if (pending.amount != null) {
    fields.Amount = outreachService.money(pending.amount, pending.currency ?? 'INR');
  }
  return fields;
}

/**
 * Does this bill mean we owe them?
 *
 * Read from the stored invoice, never inferred from how the instruction was
 * worded. "Remind Metro about INV-2231" is the same sentence whether Metro is
 * a supplier we owe or a customer who owes us, and the two templates say
 * opposite things to the recipient.
 *
 * With no invoice on record the safe default is the collection wording, which
 * is what an Admin typing "send a payment reminder" almost always means — and
 * the confirmation showed them the wording's subject before it went.
 */
async function isPayable(invoiceId: string | null | undefined): Promise<boolean> {
  if (!invoiceId) return false;
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId }, select: { payable: true },
  });
  return invoice?.payable === true;
}

/**
 * The phrase a confirmation reads back.
 *
 * The outreach intents render through `replies.action`, so a Hindi sender is
 * asked to confirm in Hindi. The pre-existing intents stay in English: they
 * were English before this change, and translating half a sentence — an
 * English verb glued to a Hindi clause — reads worse than either language on
 * its own. They are listed in `ACTIONS` when somebody wants them translated.
 */
function describe(pending: PendingCommand, lang: Lang = 'en'): string {
  const p = pending.parsed;
  const due = pending.deadlineIso ? fmtDate(new Date(pending.deadlineIso)) : null;

  const outreachAction = describeOutreach(pending, lang, due);
  if (outreachAction) return outreachAction;

  switch (p.intent) {
    case 'reassign_ticket':
      return `reassign ${pending.taskId} from ${pending.previousAssigneeName} to ${pending.targetName}`;
    case 'create_task':
      return `create a task for ${pending.targetName}: "${p.title}", due ${due}`;
    case 'add_comment':
      return `add this comment to ${pending.taskId}: "${p.comment}"`;
    case 'set_priority':
      return `set ${pending.taskId} to ${p.priority} priority`;
    case 'set_deadline':
      return `move the ${pending.taskId} deadline to ${due}`;
    case 'duplicate_task':
      return `copy ${pending.taskId} for ${listNames(pending.targets)}`;
    case 'bulk_reassign':
      return `reassign ${pending.bulkTaskIds?.length ?? 0} task(s) to ${pending.targetName}`;
    case 'undo_last':
      return `undo that`;

    // Handled above by `describeOutreach`, which renders them in the sender's
    // language. Listed here so the switch stays exhaustive and adding an
    // intent is still a compile error.
    case 'assign_sample_dispatch':
    case 'create_sales_task':
    case 'create_store_check_task':
    case 'create_collection_task':
    case 'send_payment_reminder':
    case 'send_sample_notice':
    case 'register_contact':
    case 'search_contact':
      return describeOutreach(pending, lang, due) ?? `look up ${pending.contactName}`;
  }
}

/**
 * Render an outreach confirmation in the sender's language, or null when this
 * is not an outreach intent.
 *
 * Every optional fragment is passed as an already-assembled string rather than
 * a flag, because the two languages put them in different places — Hindi's
 * postposition follows the noun where English's preposition precedes it, and a
 * template that has to branch on that is not a template.
 */
function describeOutreach(pending: PendingCommand, lang: Lang, due: string | null): string | null {
  const p = pending.parsed;

  const key: ActionKey | null =
      p.intent === 'assign_sample_dispatch'  ? 'createSampleTask'
    : p.intent === 'create_sales_task'       ? 'createSalesTask'
    : p.intent === 'create_store_check_task' ? 'createStockTask'
    : p.intent === 'create_collection_task'  ? 'createCollectionTask'
    : p.intent === 'send_payment_reminder'   ? 'sendPaymentReminder'
    : p.intent === 'send_sample_notice'      ? 'sendSampleNotice'
    : p.intent === 'register_contact'        ? 'registerContact'
    : null;
  if (!key) return null;

  const amount = pending.amount != null
    ? outreachService.money(pending.amount, pending.currency ?? 'INR')
    : '';

  // Spelled out in words above the threshold, so a confirmation about a large
  // sum cannot be skimmed past on a phone screen.
  const words = pending.amount != null && pending.amount >= largeAmountThreshold()
    ? ` (${amountInWords(pending.amount)})`
    : '';

  // A party added minutes ago is the case a typo produces, so it is called out
  // rather than left to be noticed after the message has gone.
  const isNew = pending.contactIsNew
    ? (lang === 'hi'
        ? '\n⚠️ यह पार्टी पिछले 24 घंटों में जोड़ी गई है।'
        : '\n⚠️ This contact was added in the last 24 hours.')
    : '';

  // The preposition differs per intent: work is sent TO a party, dues are
  // collected FROM one. Hindi marks the second with "से", not "को".
  const contactPrep =
      p.intent === 'create_collection_task' ? { en: 'from', hi: 'से' as const }
    : p.intent === 'create_store_check_task' ? { en: 'with', hi: 'से' as const }
    : p.intent === 'create_sales_task'       ? { en: 'for',  hi: 'को' as const }
    :                                          { en: 'to',   hi: 'को' as const };

  const itemText = [pending.quantityText, pending.itemText].filter(Boolean).join(' ');

  const rendered = phrase(lang, key, {
    contact:   fragment(lang, pending.contactName, contactPrep.en, contactPrep.hi),
    name:      pending.contactName ?? '',
    phone:     pending.contactPhoneMasked ? ` (${pending.contactPhoneMasked})` : '',
    amount,
    words,
    amountSuffix: amount ? ` — ${amount}` : '',
    reference: pending.reference ?? '',
    date:      pending.dateText ?? due ?? '',
    item:      key === 'createStockTask'
                 ? fragment(lang, itemText || null, 'of', 'का')
                 : (itemText || (lang === 'hi' ? 'सैंपल' : 'samples')),
    assignee:  pending.targetName ?? '',
    type:      p.contactType ?? 'contact',
  });

  return rendered + isNew;
}

async function askToConfirm(ctx: CommandContext, pending: PendingCommand): Promise<CommandOutcome> {
  await setState(ctx.actor.id, 'confirm', pending);

  // On a voice note, show what was transcribed. The sender can hear their own
  // words back in WhatsApp but has no idea what we made of them, and a bad
  // transcript is the likeliest reason we're asking in the first place.
  const heard = ctx.transcription
    ? `${t(langOf(ctx.actor.preferredLanguage), 'confirmHeard', { text: ctx.transcription.slice(0, 120) })}\n\n`
    : '';

  const lang = langOf(ctx.actor.preferredLanguage);
  const reply = `${heard}${t(lang, 'confirmPrompt', { action: describe(pending, lang) })}`;

  await record(ctx, {
    intent: pending.parsed.intent, entities: pending.parsed,
    confidence: pending.parsed.confidence, taskId: pending.taskId,
    newAssigneeId: pending.targetId,
    status: CommandStatus.awaiting_confirmation,
  });

  return outcome(reply, CommandStatus.awaiting_confirmation, pending.taskId);
}

// ─── Doing it ─────────────────────────────────────────────────────────────────

/**
 * Carry out the command — by calling `taskService`, which is the same code the
 * web endpoints run. Every authorization check happens in there, against data
 * read fresh from the database, no matter how the command reached this point or
 * how long it sat in a pending state first.
 */
async function execute(
  ctx: CommandContext,
  pending: PendingCommand,
  confirmed: boolean,
): Promise<CommandOutcome> {
  const actor  = { id: ctx.actor.id, role: ctx.actor.role };
  const parsed = pending.parsed;
  const opts   = { channel: ActionChannel.whatsapp };
  const lang   = langOf(ctx.actor.preferredLanguage);

  const before = pending.taskId
    ? await prisma.task.findUnique({ where: { id: pending.taskId }, select: { assignedToId: true } })
    : null;

  try {
    let reply: string;
    let taskId = pending.taskId;

    switch (parsed.intent) {
      case 'reassign_ticket': {
        // How the sender answered, or what the wording already said.
        const mode = pending.resolution
          ?? (parsed.assignmentIntent === 'shared'   ? 'shared'
            : parsed.assignmentIntent === 'separate' ? 'separate'
            : parsed.replaces                        ? 'replace'
            : pending.targets.length > 1             ? 'shared'
            : 'replace');

        if (mode === 'reopen') {
          await taskService.reopen(actor, pending.taskId!, opts);
          const task = await taskService.reassign(actor, pending.taskId!, pending.targetId!, {
            ...opts, reason: parsed.reason,
          });
          reply = `✅ ${task.id} has been reopened and assigned to ${task.assignedTo.name}.`;
          break;
        }

        if (mode === 'copy' || mode === 'separate') {
          // One task each, copied from the original. The source keeps its own
          // assignee and its own history — nothing about it changes.
          const made: string[] = [];
          for (const t of pending.targets) {
            const copy = await taskService.duplicate(actor, pending.taskId!, t.id, opts);
            made.push(`${copy.id} for ${t.name}`);
          }
          reply = made.length === 1
            ? `✅ ${made[0].replace(' for ', ' has been created as a copy of ' + pending.taskId + ' and assigned to ')}.`
            : `✅ ${made.length} separate tasks were created from ${pending.taskId}: ${made.join(', ')}. ` +
              `Each person was notified separately.`;
          break;
        }

        if (mode === 'shared' || mode === 'add') {
          const task = await taskService.addAssignees(
            actor, pending.taskId!, pending.targets.map((t) => t.id), opts,
          );
          const holders = task.assignees.map((a) => a.user.name);
          reply = `✅ ${task.id} has been assigned jointly to ${holders.join(' and ')}. ` +
            `Each of them must complete their own part before it goes for approval.`;
          break;
        }

        const task = await taskService.reassign(actor, pending.taskId!, pending.targetId!, {
          ...opts, reason: parsed.reason,
        });
        reply = `✅ Ticket ${task.id} has been assigned to ${task.assignedTo.name} successfully.`;
        break;
      }
      case 'create_task': {
        const mode = pending.resolution ?? parsed.assignmentIntent ?? 'separate';

        // One task each is the default for a new instruction: without an
        // existing task there is nothing to share, and a copy each is the
        // reading that preserves everyone's individual accountability.
        if (pending.targets.length > 1 && mode === 'separate') {
          const made: string[] = [];
          for (const t of pending.targets) {
            const made1 = await taskService.create(actor, {
              title:        parsed.title!,
              assignedToId: t.id,
              priority:     parsed.priority ?? undefined,
              deadline:     new Date(pending.deadlineIso!),
            }, opts);
            made.push(`${made1.id} for ${t.name}`);
            taskId = made1.id;
          }
          reply = `✅ ${made.length} tasks were created from the same instruction: ${made.join(', ')}. ` +
            `Each person was notified separately.`;
          break;
        }

        const created = await taskService.create(actor, {
          title:        parsed.title!,
          assignedToId: pending.targets[0]?.id ?? pending.targetId!,
          priority:     parsed.priority ?? undefined,
          deadline:     new Date(pending.deadlineIso!),
        }, opts);
        taskId = created.id;

        if (pending.targets.length > 1) {
          const shared = await taskService.addAssignees(
            actor, created.id, pending.targets.slice(1).map((t) => t.id), opts,
          );
          reply = `✅ Created ${shared.id} — "${shared.title}", due ${fmtDate(shared.deadline)}, ` +
            `assigned jointly to ${shared.assignees.map((a) => a.user.name).join(' and ')}.`;
          break;
        }

        reply = `✅ Created ${created.id} for ${created.assignedTo.name} — "${created.title}", due ${fmtDate(created.deadline)}.`;
        break;
      }
      case 'duplicate_task': {
        const made: string[] = [];
        for (const t of pending.targets) {
          const copy = await taskService.duplicate(actor, pending.taskId!, t.id, opts);
          made.push(`${copy.id} for ${t.name}`);
          taskId = copy.id;
        }
        reply = made.length === 1
          ? `✅ ${made[0].split(' for ')[0]} has been created as a copy of ${pending.taskId} and assigned to ${pending.targets[0].name}.`
          : `✅ ${made.length} copies were created from ${pending.taskId}: ${made.join(', ')}. ` +
            `Each person was notified separately.`;
        break;
      }
      case 'bulk_reassign': {
        // Re-read rather than trusting the list shown at confirmation time. A
        // task somebody finished in the intervening minute must not be dragged
        // back open by a yes given before they did.
        const still = await prisma.task.findMany({
          where: { id: { in: pending.bulkTaskIds ?? [] }, status: { notIn: ['Done', 'Submitted'] } },
          select: { id: true },
        });

        const moved: string[] = [];
        const skipped: string[] = [];
        for (const t of still) {
          try {
            await taskService.reassign(actor, t.id, pending.targetId!, { ...opts, reason: parsed.reason });
            moved.push(t.id);
          } catch (e) {
            // One refusal must not abandon the rest — the sender is told which.
            skipped.push(t.id);
            console.warn(`[Command] bulk: skipped ${t.id}: ${(e as Error).message}`);
          }
        }

        const closed = (pending.bulkTaskIds?.length ?? 0) - still.length;
        reply = `✅ ${moved.length} task${moved.length === 1 ? '' : 's'} reassigned to ${pending.targetName}.` +
          (closed  > 0 ? ` ${closed} had already been completed and were left alone.` : '') +
          (skipped.length > 0 ? ` ${skipped.length} could not be moved: ${skipped.join(', ')}.` : '');
        taskId = moved[0] ?? null;
        break;
      }
      case 'undo_last': {
        const task = await taskService.reassign(actor, pending.taskId!, pending.targetId!, {
          ...opts, reason: 'undo of a previous reassignment',
        });
        // Marked so the same action can never be undone twice.
        if (pending.undoCommandId) {
          await prisma.whatsAppCommand.updateMany({
            where: { id: pending.undoCommandId, undoneAt: null },
            data:  { undoneAt: new Date() },
          });
        }
        reply = `✅ Undone — ${task.id} is back with ${task.assignedTo.name}.`;
        break;
      }
      case 'add_comment': {
        const task = await taskService.comment(actor, pending.taskId!, parsed.comment!, opts);
        reply = `✅ Comment added to ${task.id}.`;
        break;
      }
      case 'set_priority': {
        const task = await taskService.setPriority(actor, pending.taskId!, parsed.priority!, opts);
        reply = `✅ ${task.id} priority set to ${task.priority}.`;
        break;
      }
      case 'set_deadline': {
        const task = await taskService.setDeadline(actor, pending.taskId!, new Date(pending.deadlineIso!), opts);
        reply = `✅ ${task.id} deadline moved to ${fmtDate(task.deadline)}.`;
        break;
      }

      // ─── Delegated outreach ─────────────────────────────────────────────
      //
      // One branch for all four. They differ only in the `kind` recorded and
      // the words used, so `taskService.create` is called once — which is also
      // what keeps permissions, notifications and the activity log identical
      // to a task raised on the website.
      case 'assign_sample_dispatch':
      case 'create_sales_task':
      case 'create_store_check_task':
      case 'create_collection_task': {
        const kind = OUTREACH_TASK_KIND[parsed.intent];

        const created = await taskService.create(actor, {
          title:       outreachTitle(pending),
          description: ctx.text.slice(0, 2000),
          assignedToId: pending.targetId!,
          deadline:     new Date(pending.deadlineIso!),
          customFields: outreachCustomFields(pending),
        }, opts);

        // `kind`, `contactId` and `invoiceId` are set immediately after rather
        // than passed through `CreateInput`: keeping them out of that shared
        // signature means the web create path and its callers are untouched by
        // this feature.
        await prisma.task.update({
          where: { id: created.id },
          data:  { kind, contactId: pending.contactId ?? null, invoiceId: pending.invoiceId ?? null },
        });

        taskId = created.id;
        reply  = t(lang, 'taskCreated', {
          taskId:   created.id,
          assignee: created.assignedTo.name,
          title:    created.title,
          due:      fmtDate(created.deadline),
        });
        break;
      }

      // ─── Direct outreach ────────────────────────────────────────────────
      //
      // Reached only after an explicit confirmation — `startPaymentReminder`
      // and `startSampleNotice` have no path that calls `execute` directly.
      case 'send_payment_reminder': {
        const result = await outreachService.sendOutreach(
          { id: ctx.actor.id, role: ctx.actor.role, name: ctx.actor.name },
          {
            contactId: pending.contactId!,
            // A vendor bill means WE owe THEM, and the two templates say
            // opposite things. Deciding it from the stored invoice rather than
            // from the wording is what stops "remind Metro about INV-2231"
            // telling a supplier they owe us money they are in fact owed.
            kind:      (await isPayable(pending.invoiceId))
                         ? 'payment_advice_vendor'
                         : 'payment_due_reminder',
            headline:  outreachService.money(pending.amount ?? 0, pending.currency ?? 'INR'),
            detail:    pending.reference ?? 'your account',
            date:      pending.dateText ?? fmtDate(new Date(pending.deadlineIso!)),
          },
        );

        reply = result.ok
          ? t(lang, 'reminderSent', {
              name:   pending.contactName ?? '',
              amount: outreachService.money(pending.amount ?? 0, pending.currency ?? 'INR'),
            })
          : t(lang, 'sendFailed', { name: pending.contactName ?? '', reason: result.error ?? '' });
        break;
      }

      case 'send_sample_notice': {
        const result = await outreachService.sendOutreach(
          { id: ctx.actor.id, role: ctx.actor.role, name: ctx.actor.name },
          {
            contactId: pending.contactId!,
            kind:      'sample_dispatch',
            headline:  pending.itemText ?? 'samples',
            detail:    pending.reference ?? '—',
            date:      pending.dateText ?? fmtDate(new Date(pending.deadlineIso!)),
          },
        );

        reply = result.ok
          ? t(lang, 'noticeSent', { name: pending.contactName ?? '' })
          : t(lang, 'sendFailed', { name: pending.contactName ?? '', reason: result.error ?? '' });
        break;
      }

      case 'register_contact': {
        const contact = await createContact(actor, {
          name:  pending.contactName!,
          phone: parsed.contactPhone!,
          type:  (parsed.contactType as never) ?? undefined,
        });
        reply = t(lang, 'contactSaved', { name: contact.name, type: contact.type });
        break;
      }

      // Read-only, and answered in `startSearchContact` before `execute` is
      // ever reached. Listed so the switch stays exhaustive.
      case 'search_contact': {
        reply = 'Nothing to do.';
        break;
      }
    }

    await record(ctx, {
      intent: parsed.intent, entities: parsed, confidence: parsed.confidence,
      taskId,
      previousAssigneeId: before?.assignedToId ?? null,
      newAssigneeId: pending.targetId,
      confirmed,
      status: CommandStatus.executed,
    });

    console.log(`[Command] ${ctx.actor.name}: ${parsed.intent} on ${taskId} via WhatsApp`);
    return outcome(reply, CommandStatus.executed, taskId);
  } catch (err) {
    // A refusal from taskService is an answer, and the sender gets the reason.
    // Anything else is a bug and must not be echoed back verbatim.
    const isRefusal = err instanceof TaskOpError;
    if (!isRefusal) console.error(`[Command] Unexpected failure on ${pending.taskId}:`, err);

    const reply = isRefusal
      ? refusalMessage(err as TaskOpError, pending)
      : `Something went wrong. Please try again, or use the dashboard.`;

    await record(ctx, {
      intent: parsed.intent, entities: parsed, confidence: parsed.confidence,
      taskId: pending.taskId,
      previousAssigneeId: before?.assignedToId ?? null,
      newAssigneeId: pending.targetId,
      confirmed,
      status: isRefusal ? CommandStatus.rejected : CommandStatus.failed,
      errorReason: (err as Error).message,
    });

    return outcome(reply, isRefusal ? CommandStatus.rejected : CommandStatus.failed, pending.taskId);
  }
}

function refusalMessage(err: TaskOpError, pending: PendingCommand): string {
  if (err.code === 'forbidden') {
    return err.message.includes('outside your permitted reporting structure')
      ? `You cannot assign ${pending.taskId ?? 'this ticket'} to ${pending.targetName} because ` +
        `they are outside your permitted reporting structure.`
      : `You do not have permission to change ${pending.taskId ?? 'that ticket'}.`;
  }
  if (err.code === 'not_found') {
    return `I could not find ticket ${pending.taskId}. Please check the ticket number and try again.`;
  }
  return err.message;
}

// ─── Answering a held question ────────────────────────────────────────────────

/**
 * Interpret this message as a reply to whatever we last asked.
 *
 * Returns null when it clearly isn't one, so the message gets a second chance
 * as a fresh command or as an ordinary worker update. That fallthrough is what
 * stops a forgotten pending question from swallowing unrelated messages for the
 * rest of its lifetime.
 */
async function resolvePending(
  ctx: CommandContext,
  state: PendingState,
): Promise<CommandOutcome | null> {
  const pending = state.payload as PendingCommand;

  if (state.kind === 'confirm') {
    const answer = readConfirmation(ctx.text);

    if (answer === 'yes') {
      await clearState(ctx.actor.id);
      return execute(ctx, pending, true);
    }

    if (answer === 'no') {
      await clearState(ctx.actor.id);
      await record(ctx, {
        intent: pending.parsed.intent, entities: pending.parsed,
        confidence: pending.parsed.confidence, taskId: pending.taskId,
        newAssigneeId: pending.targetId, status: CommandStatus.cancelled,
      });
      return outcome(
        `Cancelled — ${pending.taskId ?? 'nothing'} has not been changed.`,
        CommandStatus.cancelled,
        pending.taskId,
      );
    }

    // Unclear. If it reads as a new command, let that replace this one.
    if (await parseCommand(ctx.text)) return null;

    return outcome(
      `I still need a yes or no: reply "Confirm" to ${describe(pending)}, or "Cancel" to stop.`,
      CommandStatus.awaiting_confirmation,
      pending.taskId,
    );
  }

  if (state.kind === 'choose_option') {
    const options = state.options as { id: string; title: string }[];
    const said    = ctx.text.trim().toLowerCase();

    // A tapped button arrives as its id; a typed reply arrives as words. Both
    // are accepted, because not every client renders buttons.
    const chosen = options.find((o) => o.id.toLowerCase() === said)
      ?? options.find((o) => o.title.toLowerCase() === said)
      ?? (readChoiceIndex(ctx.text, options.length) !== null
            ? options[readChoiceIndex(ctx.text, options.length)!]
            : undefined);

    if (!chosen) {
      // Typed "cancel"/"no" rather than tapping it.
      if (readConfirmation(ctx.text) === 'no') {
        await clearState(ctx.actor.id);
        await record(ctx, {
          intent: pending.parsed.intent, entities: pending.parsed,
          confidence: pending.parsed.confidence, taskId: pending.taskId,
          status: CommandStatus.cancelled,
        });
        return outcome(`Cancelled — nothing was changed.`, CommandStatus.cancelled, pending.taskId);
      }
      if (await parseCommand(ctx.text)) return null;
      return outcome(
        `I still need to know which: ${options.map((o) => o.title).join(' / ')}`,
        CommandStatus.clarifying,
        pending.taskId,
      );
    }

    await clearState(ctx.actor.id);

    if (chosen.id === BTN.cancel) {
      await record(ctx, {
        intent: pending.parsed.intent, entities: pending.parsed,
        confidence: pending.parsed.confidence, taskId: pending.taskId,
        status: CommandStatus.cancelled,
      });
      return outcome(
        `Cancelled — ${pending.taskId ?? 'nothing'} has not been changed.`,
        CommandStatus.cancelled,
        pending.taskId,
      );
    }

    // "Which file did you mean?" — the id carries the message row.
    if (chosen.id.startsWith('att_') && pending.attachment) {
      const picked = pending.attachmentOptions?.find((a) => `att_${a.id}` === chosen.id);
      if (!picked) {
        return outcome(`That file is no longer available. Please send it again.`,
          CommandStatus.rejected, pending.taskId);
      }
      return runAttachment(ctx, pending.attachment, {
        url: picked.mediaUrl,
        kind: picked.kind === 'document' ? 'document' : 'image',
      });
    }

    const RESOLUTIONS: Record<string, PendingCommand['resolution']> = {
      [BTN.shared]: 'shared', [BTN.separate]: 'separate',
      [BTN.add]: 'add', [BTN.replace]: 'replace',
      [BTN.reopen]: 'reopen', [BTN.copy]: 'copy',
    };

    // The answer resolves the ambiguity; it does not authorise the change.
    // Everything is re-validated inside execute → taskService.
    return execute(ctx, { ...pending, resolution: RESOLUTIONS[chosen.id] }, true);
  }

  if (state.kind === 'choose_employee') {
    const options = state.options as ChoiceOption[];

    const byIndex = readChoiceIndex(ctx.text, options.length);
    // Re-run resolution against the shortlist only. A reply of "Sharma" is
    // unambiguous among the two people we offered even though it wasn't
    // against the whole team.
    const picked = byIndex !== null
      ? options[byIndex]
      : resolveName(ctx.text, options).match?.user ?? null;

    if (!picked) {
      if (await parseCommand(ctx.text)) return null;
      return outcome(
        `I still need to know which one: ${options.map((o, i) => `${i + 1}. ${o.name}`).join('  ')}`,
        CommandStatus.clarifying,
        pending.taskId,
      );
    }

    // Disambiguation resolves the name; it does not authorise the change. The
    // sender still confirms, which is the flow the spec describes.
    return askToConfirm(ctx, {
      ...pending,
      targetId: picked.id,
      targetName: picked.name,
      // Replace only the name that WAS ambiguous, keeping any already resolved.
      targets: [...pending.targets.filter((t) => t.id !== picked.id), picked],
    });
  }

  // ── Which external party did they mean? ─────────────────────────────────
  //
  // The same shape as `choose_employee`, and separate for the same reason the
  // slots are separate: a contact is not a `User`, and resolving one must not
  // put a contact id where an assignee id is read.
  //
  // Crucially, the ORIGINAL command is resumed. The sender said "send a
  // payment reminder to Ramesh", we asked which Ramesh, they said "2" — and
  // what runs is the payment reminder, not a bare selection.
  if (state.kind === 'choose_contact') {
    const options = state.options as ChoiceOption[];

    const byIndex = readChoiceIndex(ctx.text, options.length);
    const picked = byIndex !== null
      ? options[byIndex]
      : resolveName(ctx.text, options).match?.user ?? null;

    if (!picked) {
      // A brand new command replaces the question rather than being read as a
      // bad answer to it — the newest thing the sender said is what they mean.
      if (await parseCommand(ctx.text)) return null;
      return outcome(
        `I still need to know which one:\n${options.map((o, i) => `${i + 1}. ${o.name}`).join('\n')}`,
        CommandStatus.clarifying,
        pending.taskId,
      );
    }

    // Re-enter the original handler with the party now pinned by id. Restarting
    // rather than patching the pending state is what keeps the invoice lookup,
    // the opt-out check and the amount resolution in one place instead of
    // duplicated here — and those are the steps that must not be skipped.
    const resumed: ParsedCommand = { ...pending.parsed, contactName: picked.name };

    switch (resumed.intent) {
      case 'send_payment_reminder':      return startPaymentReminder(ctx, resumed);
      case 'send_sample_notice':         return startSampleNotice(ctx, resumed);
      case 'assign_sample_dispatch':
      case 'create_sales_task':
      case 'create_store_check_task':
      case 'create_collection_task':     return startOutreachTask(ctx, resumed);
      case 'search_contact':             return startSearchContact(ctx, resumed);
      default:
        return outcome('Sorry, that request has expired. Please send it again.',
          CommandStatus.cancelled, null);
    }
  }

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function namesOf(users: { name: string }[], limit: number): string {
  const shown = users.slice(0, limit).map((u) => u.name);
  const extra = users.length - shown.length;
  return shown.join(', ') + (extra > 0 ? `, and ${extra} more` : '');
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
