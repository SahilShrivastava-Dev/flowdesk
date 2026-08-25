// ─────────────────────────────────────────────────────────────────────────────
// What the system says back, in the sender's own language.
//
// Somebody who types "रमेश ट्रेडर्स को 45 हज़ार का reminder भेजो" and is answered
// with "You are about to send a payment reminder…" has been understood and then
// talked past. The whole premise of this feature is people who will not open
// the website; answering them only in English reintroduces the barrier the
// feature exists to remove.
//
// Deliberately a flat key→string table rather than an i18n library:
//   - There are two languages and both are known at build time.
//   - Every string is short and interpolates at most four values.
//   - A missing key must be a COMPILE error, which `Record<ReplyKey, string>`
//     gives for free and a runtime lookup would not.
//
// Adding a language means adding one object here and one code to
// APPROVED_LANGS in whatsappService — the same two-step the templates use.
// ─────────────────────────────────────────────────────────────────────────────

export type Lang = 'en' | 'hi';

/** Falls back to English for any code without a table, exactly like templates. */
export function langOf(preferred: string | null | undefined): Lang {
  return preferred === 'hi' ? 'hi' : 'en';
}

type Vars = Record<string, string | number>;

export type ReplyKey =
  | 'confirmPrompt'
  | 'confirmHeard'
  | 'cancelled'
  | 'unclear'
  | 'expired'
  | 'noContacts'
  | 'contactNotFound'
  | 'contactAmbiguous'
  | 'contactChooseAgain'
  | 'askWho'
  | 'askWhoToRemind'
  | 'askWhoToNotify'
  | 'askAmount'
  | 'askDate'
  | 'askRegisterName'
  | 'askRegisterPhone'
  | 'invoiceUnknownNoAmount'
  | 'taskCreated'
  | 'reminderSent'
  | 'noticeSent'
  | 'sendFailed'
  | 'contactSaved'
  | 'contactSearchNone'
  | 'contactSearchFound'
  | 'notAllowedOutreach'
  | 'optedOut'
  | 'somethingWrong';

const EN: Record<ReplyKey, string> = {
  confirmPrompt:       'You are about to {action}. Reply "Confirm" to continue, or "Cancel" to stop.',
  confirmHeard:        'I heard: "{text}"',
  cancelled:           'Cancelled — nothing was sent.',
  unclear:             'Sorry, I did not follow. Reply "Confirm" or "Cancel".',
  expired:             'That request has expired. Please send it again.',
  noContacts:          'There are no external contacts saved yet. Add one on the dashboard, or reply: register vendor <name> <phone number>',
  contactNotFound:     'I could not find "{name}" in the system. Please register the party first — reply: register vendor {name} <phone number>',
  contactAmbiguous:    'I found {count} matches:\n{options}\n\nWhich one do you mean? Reply with the number.',
  contactChooseAgain:  'I still need to know which one:\n{options}',
  askWho:              'Who should do this? Name the person and I will create the task.',
  askWhoToRemind:      'Who should I send the payment reminder to?',
  askWhoToNotify:      'Who should I send the dispatch notice to?',
  askAmount:           'How much is outstanding from {name}?',
  askDate:             'I could not read "{text}" as a date. When is this due?',
  askRegisterName:     'What is the name? Reply: register vendor <name> <phone number>',
  askRegisterPhone:    "What is {name}'s WhatsApp number? Reply: register vendor {name} <phone number>",
  invoiceUnknownNoAmount: 'I do not have {ref} on record, and no amount was given. Reply with the amount to send anyway.',
  taskCreated:         '✅ {taskId} created for {assignee}: {title}\nDue {due}.',
  reminderSent:        '✅ Payment reminder sent to {name} for {amount}.',
  noticeSent:          '✅ Dispatch notice sent to {name}.',
  sendFailed:          '❌ Could not send to {name}: {reason}',
  contactSaved:        '✅ Saved {name} as a {type}. You can now message them by name.',
  contactSearchNone:   'I could not find "{name}" in the system. Reply: register vendor {name} <phone number> to add them.',
  contactSearchFound:  'Found:\n{options}',
  notAllowedOutreach:  'You are not allowed to message external contacts.',
  optedOut:            '{name} has asked not to be messaged.',
  somethingWrong:      'Something went wrong. Please try again, or use the dashboard.',
};

const HI: Record<ReplyKey, string> = {
  confirmPrompt:       'आप {action} करने जा रहे हैं। जारी रखने के लिए "हाँ" भेजें, रोकने के लिए "नहीं"।',
  confirmHeard:        'मैंने सुना: "{text}"',
  cancelled:           'रद्द कर दिया — कुछ नहीं भेजा गया।',
  unclear:             'माफ़ कीजिए, समझ नहीं आया। "हाँ" या "नहीं" भेजें।',
  expired:             'यह अनुरोध समाप्त हो गया है। कृपया दोबारा भेजें।',
  noContacts:          'अभी कोई बाहरी पार्टी सेव नहीं है। डैशबोर्ड से जोड़ें, या भेजें: register vendor <नाम> <फ़ोन नंबर>',
  contactNotFound:     '"{name}" सिस्टम में नहीं मिला। पहले पार्टी को रजिस्टर करें — भेजें: register vendor {name} <फ़ोन नंबर>',
  contactAmbiguous:    '{count} नाम मिले:\n{options}\n\nआपका मतलब कौन सा है? नंबर भेजें।',
  contactChooseAgain:  'कृपया बताएं कौन सा:\n{options}',
  askWho:              'यह काम किसे देना है? नाम बताएं, मैं टास्क बना दूंगा।',
  askWhoToRemind:      'भुगतान की याद किसे दिलानी है?',
  askWhoToNotify:      'डिस्पैच की सूचना किसे भेजनी है?',
  askAmount:           '{name} से कितनी राशि बकाया है?',
  askDate:             '"{text}" को तारीख के रूप में नहीं पढ़ पाया। यह कब तक चाहिए?',
  askRegisterName:     'नाम क्या है? भेजें: register vendor <नाम> <फ़ोन नंबर>',
  askRegisterPhone:    '{name} का WhatsApp नंबर क्या है? भेजें: register vendor {name} <फ़ोन नंबर>',
  invoiceUnknownNoAmount: '{ref} मेरे पास दर्ज नहीं है, और राशि भी नहीं बताई गई। फिर भी भेजने के लिए राशि भेजें।',
  taskCreated:         '✅ {taskId} बनाया गया — {assignee} के लिए: {title}\nअंतिम तिथि {due}।',
  reminderSent:        '✅ {name} को {amount} का भुगतान रिमाइंडर भेज दिया गया।',
  noticeSent:          '✅ {name} को डिस्पैच सूचना भेज दी गई।',
  sendFailed:          '❌ {name} को नहीं भेजा जा सका: {reason}',
  contactSaved:        '✅ {name} को {type} के रूप में सेव कर दिया। अब आप उन्हें नाम से संदेश भेज सकते हैं।',
  contactSearchNone:   '"{name}" सिस्टम में नहीं मिला। जोड़ने के लिए भेजें: register vendor {name} <फ़ोन नंबर>',
  contactSearchFound:  'मिला:\n{options}',
  notAllowedOutreach:  'आपको बाहरी पार्टी को संदेश भेजने की अनुमति नहीं है।',
  optedOut:            '{name} ने संदेश न भेजने के लिए कहा है।',
  somethingWrong:      'कुछ गड़बड़ हो गई। कृपया दोबारा कोशिश करें, या डैशबोर्ड का उपयोग करें।',
};

const TABLES: Record<Lang, Record<ReplyKey, string>> = { en: EN, hi: HI };

/**
 * Render a reply in `lang`.
 *
 * Interpolation is `{name}`-style and deliberately dumb: a placeholder with no
 * matching variable is left as written rather than becoming "undefined", so a
 * missed argument shows up as an obviously wrong string in a test instead of
 * being delivered to somebody as a sentence with a hole in it.
 */
export function t(lang: Lang, key: ReplyKey, vars: Vars = {}): string {
  const template = TABLES[lang][key] ?? EN[key];
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/**
 * The phrase a confirmation reads back — "send a payment reminder to X for Y".
 *
 * Separate from `t` because the ACTION is assembled from parsed values that
 * differ per intent, and gluing a translated verb onto an English noun phrase
 * produces something worse than either language alone.
 */
export type ActionKey =
  | 'sendPaymentReminder'
  | 'sendSampleNotice'
  | 'registerContact'
  | 'createSampleTask'
  | 'createSalesTask'
  | 'createStockTask'
  | 'createCollectionTask';

/**
 * Confirmation phrases.
 *
 * `{contact}` and `{item}` are whole FRAGMENTS including their own preposition
 * — " to Urja Vart" in English, " उर्जा वर्त को" in Hindi — not bare nouns.
 * That is deliberate: English puts the preposition before the noun and Hindi
 * puts a postposition after it, so a template that interpolated a bare name
 * would need to branch on language to place the word around it, which is
 * exactly what a template is supposed to avoid. It also makes an absent
 * contact collapse to nothing instead of leaving a dangling "to ,".
 */
const ACTIONS: Record<Lang, Record<ActionKey, string>> = {
  en: {
    sendPaymentReminder: 'send a payment reminder{contact}{phone} for {amount}{words} against {reference}, due {date}',
    sendSampleNotice:    'send a dispatch notice{contact}{phone} — {item}, expected {date}, ref {reference}',
    registerContact:     'save {name} as a new {type}{phone}',
    createSampleTask:    'create a task for {assignee}: send {item}{contact}, due {date}',
    createSalesTask:     'create a task for {assignee}: raise a sale{contact}, due {date}',
    createStockTask:     'create a task for {assignee}: check stock{item}{contact}, due {date}',
    createCollectionTask:'create a task for {assignee}: follow up payment{contact}{amountSuffix}, due {date}',
  },
  hi: {
    sendPaymentReminder: '{contact} {amount}{words} का भुगतान रिमाइंडर भेजने{phone} — {reference} के विरुद्ध, अंतिम तिथि {date}',
    sendSampleNotice:    '{contact} डिस्पैच सूचना भेजने{phone} — {item}, {date} तक अपेक्षित, संदर्भ {reference}',
    registerContact:     '{name} को नए {type} के रूप में सेव करने{phone}',
    createSampleTask:    '{assignee} के लिए टास्क बनाने: {item}{contact} भेजना, अंतिम तिथि {date}',
    createSalesTask:     '{assignee} के लिए टास्क बनाने:{contact} सेल बनाना, अंतिम तिथि {date}',
    createStockTask:     '{assignee} के लिए टास्क बनाने:{item} स्टॉक जांचना{contact}, अंतिम तिथि {date}',
    createCollectionTask:'{assignee} के लिए टास्क बनाने:{contact} भुगतान का फॉलो-अप{amountSuffix}, अंतिम तिथि {date}',
  },
};

/**
 * Wrap a name in the preposition its language wants, or return nothing when
 * there is no name.
 *
 * `en` is the English preposition; `hiPost` is the Hindi postposition, chosen
 * by the caller because it depends on the ROLE the noun plays — a recipient
 * takes "को", a source takes "से", a possessed thing takes "का". Guessing one
 * default for all of them produces sentences that are understandable and
 * plainly wrong, which is worse than a slightly stiff one.
 */
export type HindiPostposition = 'को' | 'से' | 'का' | 'के लिए';

export function fragment(
  lang: Lang,
  name: string | null | undefined,
  en: string,
  hiPost: HindiPostposition = 'को',
): string {
  if (!name) return '';
  return lang === 'hi' ? ` ${name} ${hiPost}` : ` ${en} ${name}`;
}

export function action(lang: Lang, key: ActionKey, vars: Vars = {}): string {
  const template = ACTIONS[lang][key] ?? ACTIONS.en[key];
  return template
    .replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : ''))
    // Optional fragments arrive empty, which leaves double spaces and a
    // dangling comma before the next clause.
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .trim();
}
