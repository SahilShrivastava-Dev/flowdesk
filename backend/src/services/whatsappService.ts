import axios, { AxiosError } from 'axios';

const BASE = 'https://graph.facebook.com/v19.0';

// ─── Language → Template mapping ─────────────────────────────────────────────
//
// Every template is submitted to Meta once per language, with the language
// baked into the name: `task_assignment_en`, `task_assignment_hi`. So the
// member's `preferredLanguage` picks both the template name and the language
// code in the API call, and the two must agree.
//
// APPROVED_LANGS is the set that actually exists in Meta Business Manager.
// Anything else falls back to English rather than being sent to a template name
// Meta has never heard of — that send is rejected outright, so the person would
// get nothing at all. Only add a code here once BOTH the template and its
// language have been approved.
const APPROVED_LANGS = new Set(['en', 'hi']);

/** The base names, each of which exists as `<base>_en` and `<base>_hi`. */
const TEMPLATE = {
  ASSIGNMENT:           'task_assignment',
  REASSIGNED:           'task_reassigned',
  DEADLINE_REMINDER:    'task_deadline_reminder',
  ESCALATION:           'task_escalation',
  ESCALATION_SUPERVISOR: 'task_escalation_supervisor',
  UPDATE_WAITING:       'update_waiting',
} as const;

function templateFor(base: string, preferredLang: string): { name: string; langCode: string } {
  const lang = APPROVED_LANGS.has(preferredLang) ? preferredLang : 'en';
  return { name: `${base}_${lang}`, langCode: lang };
}

/**
 * Send a task-assignment notification in the member's preferred language.
 *
 * @param to               Phone number (E.164 or raw)
 * @param assigneeName     {{1}}
 * @param taskId           {{2}}  (e.g. "TSK-1054")
 * @param preferredLang    Value from User.preferredLanguage (e.g. "hi", "en")
 */
export async function sendTaskAssignmentNotification(
  to:            string,
  assigneeName:  string,
  taskId:        string,
  preferredLang: string = 'en',
): Promise<SendResult> {
  const t = templateFor(TEMPLATE.ASSIGNMENT, preferredLang);
  return sendWhatsAppLocalized(to, t.name, [assigneeName, taskId], t.langCode);
}

/**
 * Tell somebody a task has changed hands and is now theirs.
 *
 * Distinct from the assignment template because "a new task has been assigned"
 * is misleading for work that already existed and may already be part-done.
 *
 * {{1}} = new assignee, {{2}} = who moved it, {{3}} = task id
 */
export async function sendTaskReassignedNotification(
  to:            string,
  assigneeName:  string,
  actorName:     string,
  taskId:        string,
  preferredLang: string = 'en',
): Promise<SendResult> {
  const t = templateFor(TEMPLATE.REASSIGNED, preferredLang);
  return sendWhatsAppLocalized(to, t.name, [assigneeName, actorName, taskId], t.langCode);
}

/**
 * The advance warning sent before a deadline, while there is still time to act.
 *
 * This used to reuse the assignment template, so somebody who had held a task
 * for a week was told it had just been assigned to them.
 *
 * {{1}} = holder, {{2}} = task id
 */
export async function sendDeadlineReminderNotification(
  to:            string,
  holderName:    string,
  taskId:        string,
  preferredLang: string = 'en',
): Promise<SendResult> {
  const t = templateFor(TEMPLATE.DEADLINE_REMINDER, preferredLang);
  return sendWhatsAppLocalized(to, t.name, [holderName, taskId], t.langCode);
}

/**
 * Chase the person actually holding an overdue task.
 * {{1}} = recipient's own name, {{2}} = task title
 */
export async function sendEscalationNotification(
  to:            string,
  recipientName: string,
  taskTitle:     string,
  preferredLang: string = 'en',
): Promise<SendResult> {
  const t = templateFor(TEMPLATE.ESCALATION, preferredLang);
  return sendWhatsAppLocalized(to, t.name, [recipientName, taskTitle], t.langCode);
}

/**
 * Tell a manager or admin that somebody *else's* task is overdue.
 *
 * The holder-facing template opens "Hi {{1}}, your task…", so sending it to a
 * supervisor with the assignee's name in {{1}} produced a message addressed to
 * the wrong person and claiming the supervisor owned the work.
 *
 * {{1}} = the assignee whose task it is, {{2}} = task title
 */
export async function sendSupervisorEscalationNotification(
  to:            string,
  assigneeName:  string,
  taskTitle:     string,
  preferredLang: string = 'en',
): Promise<SendResult> {
  const t = templateFor(TEMPLATE.ESCALATION_SUPERVISOR, preferredLang);
  return sendWhatsAppLocalized(to, t.name, [assigneeName, taskTitle], t.langCode);
}

/**
 * Nudge somebody whose 24h window has closed so they reply and re-open it.
 *
 * Replaces the `hello_world` sample template, which delivered Meta's own
 * "Welcome and congratulations!!" boilerplate to a worker who was expecting a
 * message from their manager.
 *
 * {{1}} = who is trying to reach them
 */
export async function sendUpdateWaitingNotification(
  to:            string,
  senderName:    string,
  preferredLang: string = 'en',
): Promise<SendResult> {
  const t = templateFor(TEMPLATE.UPDATE_WAITING, preferredLang);
  return sendWhatsAppLocalized(to, t.name, [senderName], t.langCode);
}

/**
 * The country code assumed for numbers saved without one. India by default,
 * since that is who this is deployed for; override per client if that changes.
 */
const DEFAULT_COUNTRY_CODE = (process.env.DEFAULT_COUNTRY_CODE ?? '91').replace(/\D/g, '');

/**
 * Normalise a phone number to the E.164 digits-only format Meta requires.
 * "+91 98765 43210" → "919876543210"
 *
 * The country-code handling is the load-bearing part. Stripping punctuation
 * alone left a number saved as "9619608095" exactly as typed, and Meta's
 * response to that is the worst possible one: the send is ACCEPTED, a message
 * id comes back, and the failure only surfaces in a delivery receipt seconds
 * later. So the assignee silently got nothing while the manager who reassigned
 * the ticket was told it had worked.
 *
 * Inbound never had this problem — `resolveUserByPhone` matches on the last ten
 * digits — which is exactly why a number saved without a country code looked
 * fine right up until something had to be sent to it.
 */
export function normalisePhone(raw: string): string {
  let digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return '';

  // "0 9619608095" — the trunk prefix used when dialling domestically. It is
  // never part of the international form.
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);

  // A bare national number. Ten digits is the Indian length; a number that
  // already carries a country code is longer, so this cannot double-prefix one.
  if (digits.length === 10) return DEFAULT_COUNTRY_CODE + digits;

  return digits;
}

/**
 * Translate a Meta API error into a clear console message.
 * Specifically calls out token expiry so it's impossible to miss in the logs.
 *
 * Returns a short reason so callers that need to record delivery state (see
 * sendTextMessage) can surface it instead of silently reporting success.
 */
function handleMetaError(err: unknown, context: string): string {
  const axiosErr = err as AxiosError<{ error?: { code?: number; message?: string; error_subcode?: number } }>;
  const metaError = axiosErr.response?.data?.error;

  if (metaError?.code === 190) {
    // Token expired or invalid
    const subcode = metaError.error_subcode;
    if (subcode === 463 || subcode === 467) {
      console.error(
        `\n🚨 [WhatsApp] ACCESS TOKEN EXPIRED — ${context}\n` +
        `   Go to: Meta Developer Dashboard → WhatsApp → API Setup → Generate token\n` +
        `   Then update META_ACCESS_TOKEN in backend/.env and restart.\n` +
        `   Meta message: ${metaError.message}\n`
      );
      return 'WhatsApp access token expired';
    }
    console.error(`🚨 [WhatsApp] INVALID TOKEN (code 190, subcode ${subcode}) — ${context}`);
    console.error(`   Meta message: ${metaError.message}`);
    return 'WhatsApp access token invalid';
  }

  if (metaError) {
    console.error(`[WhatsApp] Meta API error (${context}): code=${metaError.code} — ${metaError.message}`);
    return metaError.message ?? `Meta error ${metaError.code}`;
  }

  console.error(`[WhatsApp] Unexpected error (${context}):`, err);
  return (err as Error)?.message ?? 'Unknown WhatsApp error';
}

/**
 * Verify the token is still valid on startup.
 * Logs a clear warning so you know immediately when the server starts.
 */
export async function verifyTokenOnStartup(): Promise<void> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token || token.startsWith('EAADxxxxxx')) {
    console.warn('[WhatsApp] META_ACCESS_TOKEN not configured — WhatsApp sends will be skipped.');
    return;
  }
  try {
    await axios.get(`${BASE}/me`, { params: { access_token: token } });
    console.log('[WhatsApp] ✅ Token verified — ready to send messages');
  } catch (err) {
    handleMetaError(err, 'startup token check');
  }
}

export interface SendResult {
  ok: boolean;
  error?: string;
  /**
   * Meta's message id (wamid) for a successful send. Storing it is what lets
   * the status webhook later match delivered/read receipts back to this row.
   */
  waMessageId?: string;
}

/**
 * Send a free-form text message. Only valid inside the 24h session window.
 *
 * Returns whether the send actually succeeded. This used to return void and
 * swallow every Meta error, so `/api/whatsapp/send` reported success even when
 * the message never left — the UI showed a delivered checkmark for a message
 * Meta had rejected.
 */
export async function sendTextMessage(to: string, text: string): Promise<SendResult> {
  const phoneId = process.env.META_PHONE_ID;
  const token   = process.env.META_ACCESS_TOKEN;

  if (!phoneId || !token) {
    console.warn('[WhatsApp] META_PHONE_ID or META_ACCESS_TOKEN not set — skipping send');
    return { ok: false, error: 'WhatsApp is not configured on the server' };
  }

  const normalisedTo = normalisePhone(to);
  if (!normalisedTo) {
    console.warn('[WhatsApp] Invalid phone number — skipping send');
    return { ok: false, error: 'Invalid phone number' };
  }

  try {
    const { data } = await axios.post<{ messages?: Array<{ id: string }> }>(
      `${BASE}/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        to:   normalisedTo,
        type: 'text',
        text: { body: text },
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return { ok: true, waMessageId: data?.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, error: handleMetaError(err, `sendTextMessage → ${normalisedTo}`) };
  }
}

/**
 * Send a stored file — an image or a document — by URL.
 *
 * Meta accepts either an uploaded media id or a public link. The link form is
 * used because every attachment is already on Cloudinary by the time we want to
 * forward it, so re-uploading the bytes to Meta would be a second copy of a
 * file we are holding anyway.
 *
 * Only valid inside the 24-hour session window, like any free-form message.
 * Outside it Meta rejects the send, which is why `notifyService` and the
 * forwarding flow both check the window first and fall back to a template.
 */
export async function sendMediaMessage(
  to: string,
  mediaUrl: string,
  opts: { kind: 'image' | 'document'; caption?: string; filename?: string } ,
): Promise<SendResult> {
  const phoneId = process.env.META_PHONE_ID;
  const token   = process.env.META_ACCESS_TOKEN;

  if (!phoneId || !token) {
    console.warn('[WhatsApp] META_PHONE_ID or META_ACCESS_TOKEN not set — skipping send');
    return { ok: false, error: 'WhatsApp is not configured on the server' };
  }

  const normalisedTo = normalisePhone(to);
  if (!normalisedTo) return { ok: false, error: 'Invalid phone number' };
  if (!/^https?:\/\//i.test(mediaUrl)) {
    return { ok: false, error: 'Attachment has no shareable link' };
  }

  // Meta caps a media caption at 1024 characters and rejects the whole message
  // if it is longer — so it is trimmed here rather than losing the file.
  const caption = opts.caption?.slice(0, 1024);

  try {
    const { data } = await axios.post<{ messages?: Array<{ id: string }> }>(
      `${BASE}/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        to:   normalisedTo,
        type: opts.kind,
        [opts.kind]: {
          link: mediaUrl,
          ...(caption && { caption }),
          ...(opts.kind === 'document' && opts.filename && { filename: opts.filename }),
        },
      },
      { headers: { Authorization: `Bearer ${token}` } },
    );
    console.log(`[WhatsApp] ✅ Sent ${opts.kind} to ${normalisedTo}`);
    return { ok: true, waMessageId: data?.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, error: handleMetaError(err, `sendMediaMessage → ${normalisedTo}`) };
  }
}

// ─── Interactive Messages ─────────────────────────────────────────────────────
// These only work within the 24-hour session window (after the customer has
// messaged you first). Outside that window, use one of the template senders at
// the top of this file — they are the only thing Meta will deliver.

export interface ReplyButton {
  id:    string;  // your internal ID, e.g. "done" — returned in webhook when tapped
  title: string;  // label shown on button, max 20 chars
}

/**
 * Send up to 3 quick-reply buttons.
 * Example use: "Acknowledge task" / "Report issue" / "Request delay"
 *
 * Requires an active 24-hour session (customer messaged you first).
 */
export async function sendInteractiveButtons(
  to:      string,
  bodyText: string,
  buttons: ReplyButton[],
  headerText?: string,
  footerText?: string,
): Promise<void> {
  const phoneId = process.env.META_PHONE_ID;
  const token   = process.env.META_ACCESS_TOKEN;
  if (!phoneId || !token) return;

  const normalisedTo = normalisePhone(to);
  if (!normalisedTo) return;

  if (buttons.length < 1 || buttons.length > 3) {
    console.warn('[WhatsApp] sendInteractiveButtons requires 1–3 buttons');
    return;
  }

  const payload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                normalisedTo,
    type:              'interactive',
    interactive: {
      type: 'button',
      ...(headerText && { header: { type: 'text', text: headerText } }),
      body: { text: bodyText },
      ...(footerText && { footer: { text: footerText } }),
      action: {
        buttons: buttons.map((btn) => ({
          type:  'reply',
          reply: { id: btn.id, title: btn.title },
        })),
      },
    },
  };

  try {
    await axios.post(`${BASE}/${phoneId}/messages`, payload, {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`[WhatsApp] ✅ Interactive buttons sent to ${normalisedTo}`);
  } catch (err) {
    handleMetaError(err, `sendInteractiveButtons → ${normalisedTo}`);
  }
}

export interface ListRow {
  id:           string;  // returned in webhook when selected
  title:        string;  // main label, max 24 chars
  description?: string;  // subtitle, max 72 chars
}

export interface ListSection {
  title: string;         // section heading, max 24 chars
  rows:  ListRow[];      // max 10 rows across ALL sections combined
}

/**
 * Send a list message — the "More options" / menu-style button banking apps use.
 * Shows a single button labelled `buttonLabel`; tapping it opens a scrollable list.
 *
 * Example use: task actions menu, language selection, status update options.
 * Requires an active 24-hour session (customer messaged you first).
 */
export async function sendInteractiveList(
  to:           string,
  bodyText:     string,
  buttonLabel:  string,          // text on the "open menu" button, max 20 chars
  sections:     ListSection[],
  headerText?:  string,
  footerText?:  string,
): Promise<void> {
  const phoneId = process.env.META_PHONE_ID;
  const token   = process.env.META_ACCESS_TOKEN;
  if (!phoneId || !token) return;

  const normalisedTo = normalisePhone(to);
  if (!normalisedTo) return;

  const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0);
  if (totalRows > 10) {
    console.warn('[WhatsApp] sendInteractiveList: max 10 rows total across all sections');
    return;
  }

  const payload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                normalisedTo,
    type:              'interactive',
    interactive: {
      type: 'list',
      ...(headerText && { header: { type: 'text', text: headerText } }),
      body: { text: bodyText },
      ...(footerText && { footer: { text: footerText } }),
      action: {
        button:   buttonLabel,
        sections: sections.map((sec) => ({
          title: sec.title,
          rows:  sec.rows.map((row) => ({
            id:    row.id,
            title: row.title,
            ...(row.description && { description: row.description }),
          })),
        })),
      },
    },
  };

  try {
    await axios.post(`${BASE}/${phoneId}/messages`, payload, {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`[WhatsApp] ✅ Interactive list sent to ${normalisedTo}`);
  } catch (err) {
    handleMetaError(err, `sendInteractiveList → ${normalisedTo}`);
  }
}

/**
 * Make a value safe to drop into a template parameter.
 *
 * Meta rejects a body parameter that contains a newline, a tab, or four or more
 * consecutive spaces — and a task title typed into the dashboard textarea can
 * carry all three. The rejection kills the whole send, not just the parameter,
 * so the substitution happens here rather than being remembered at ten call
 * sites. An empty parameter is rejected too, hence the dash.
 */
function sanitiseParam(raw: string): string {
  const clean = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '—';
  // Meta caps the whole rendered body at 1024 characters. A long task title is
  // the only parameter that can realistically approach that, and losing the
  // sentence after it would be worse than losing the tail of the title.
  return clean.length > 300 ? `${clean.slice(0, 297)}...` : clean;
}

/**
 * Send a WhatsApp template in a specific language.
 *
 * The template must exist in Meta under exactly this name AND be approved in
 * this language — `templateFor` above is what keeps those two in step.
 *
 * @param languageCode  BCP-47 code: 'en', 'hi'
 */
export async function sendWhatsAppLocalized(
  to:           string,
  templateName: string,
  parameters:   string[],
  languageCode: string,
): Promise<SendResult> {
  const phoneId = process.env.META_PHONE_ID;
  const token   = process.env.META_ACCESS_TOKEN;
  if (!phoneId || !token) {
    console.warn('[WhatsApp] META_PHONE_ID or META_ACCESS_TOKEN not set — skipping send');
    return { ok: false, error: 'WhatsApp is not configured on the server' };
  }

  const normalisedTo = normalisePhone(to);
  if (!normalisedTo) {
    console.warn('[WhatsApp] Invalid phone number — skipping send');
    return { ok: false, error: 'Invalid phone number' };
  }

  const safeParams = parameters.map(sanitiseParam);
  console.log(`[WhatsApp] Sending "${templateName}" (${languageCode}) → ${normalisedTo}`);

  try {
    const { data } = await axios.post<{ messages?: Array<{ id: string }> }>(
      `${BASE}/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        to:                normalisedTo,
        type:              'template',
        template: {
          name:     templateName,
          language: { code: languageCode },
          components: safeParams.length > 0
            ? [{ type: 'body', parameters: safeParams.map((text) => ({ type: 'text', text })) }]
            : [],
        },
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    console.log(`[WhatsApp] ✅ Sent localized template to ${normalisedTo}`);
    return { ok: true, waMessageId: data?.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, error: handleMetaError(err, `sendWhatsAppLocalized → ${normalisedTo}`) };
  }
}
