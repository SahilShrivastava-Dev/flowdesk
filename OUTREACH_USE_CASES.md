# Outreach Use Cases — Samples, Payments, Stock, Sales

Status: **specification only.** Nothing here is built. This document defines
five new use cases (UC26–UC30), the WhatsApp templates they need, and — the
part that actually matters right now — everything that has to exist *before*
the first line of code is written.

Existing use cases UC1–UC25 (assignment, reassignment, duplication, bulk moves,
attachments, undo) are referenced throughout `commandExecutor.ts`. These five
continue that numbering.

---

## 1. What is actually new here

Every use case built so far moves work between **employees**. The sender is a
Manager or Admin, the recipient is a `User` row inside the reporting hierarchy,
and the thing that changes is a `Task`.

All five new use cases send a message to somebody who is **not an employee** —
a vendor, a seller, a third-party agent, a customer. That single difference is
what breaks most of the existing machinery:

| Existing assumption | Where it lives | Why it breaks |
|---|---|---|
| Recipients are `User` rows | `permissionService.assignableUsers()` | A vendor has no login, no role, no `reportingToId` |
| The candidate list is the permission boundary | `nameResolutionService.ts` | "Sharma Traders" is in no manager's hierarchy, so it resolves to nobody |
| Every outbound is about a `Task` | `Message.taskId`, `notifyService.ts` | A payment reminder is not a task somebody has to do |
| Inbound messages are workers reporting progress | `intentService.ts`, `webhookController.ts` | A vendor replying "paid" is not a task status update |
| A wrong parse costs a misassigned ticket | `commandExecutor.ts` confidence gate | A wrong parse now sends a stranger a demand for the wrong amount of money |

**Nothing in the five use cases is hard. The prerequisites are.** Sections 4–6
are the real deliverable of this document.

---

## 2. The five use cases

Notation: **Admin** is whoever types the instruction on WhatsApp. **Contact** is
the external party who receives the message.

### UC26 — Sample dispatch notice

> Admin: *"Send the sample dispatch message to Rakesh at Sharma Traders — 2
> stone samples, going out tomorrow by Bluedart."*

| | |
|---|---|
| Trigger | Free-text WhatsApp instruction from an Admin |
| Recipient | Contact of type `buyer` / `agent` |
| Message | `sample_dispatch` template |
| Reply options | **Received** · **Not received yet** |
| Record created | A dispatch record; open until the contact confirms receipt |
| Follow-up | If no reply by the expected-arrival date + 1, chase the contact and notify the Admin |

Slots the parser must fill: contact, sample description, dispatch date or
expected arrival, optionally courier + tracking number.

### UC27 — Payment due reminder → third-party vendor / agent

> Admin: *"Send a payment alert to Metro Logistics — ₹45,000 against invoice
> INV-2231, due on the 5th."*

| | |
|---|---|
| Recipient | Contact of type `third_party` |
| Message | `payment_due_thirdparty` template |
| Reply options | **Payment done** · **Need more time** · **Invoice query** |
| Record created | A receivable record with amount, reference, due date, state |
| Follow-up | Configurable reminder ladder (e.g. due-3d, due-day, due+3d), then escalate to the Admin |

### UC28 — Payment due reminder → seller

Same shape as UC27, different relationship and different template wording, sent
to a Contact of type `seller`. Kept separate rather than parameterised because
the tone, the escalation path, and often the language differ — the same reason
`task_escalation` and `task_escalation_supervisor` are two templates rather
than one with a name swapped in.

> **Open question for the client (§6.1):** is there also a *"payment made"*
> direction — a remittance advice telling a vendor we have paid them? It is a
> different message and a different record, and it has not been specified.

### UC29 — Stock check

> Admin: *"Ask Kiran at Deccan Stones if they have 400 sq ft of Kota blue,
> needed by Friday."*

| | |
|---|---|
| Recipient | Contact of type `seller` / `supplier` |
| Message | `stock_check_request` template |
| Reply options | **In stock** · **Out of stock** · **Will confirm** |
| Record created | An enquiry, open until answered |
| Follow-up | Chase after N hours; report the answer back to the Admin either way |

Note: the *answer* is the point of this one. Unlike UC26–UC28, the reply is a
data payload the Admin is waiting on, so routing the response back to the person
who asked is a hard requirement, not a nicety.

### UC30 — Sales order placement

> Admin: *"Place the order with Deccan Stones — 400 sq ft Kota blue, delivery by
> the 12th, order SO-1187."*

| | |
|---|---|
| Recipient | Contact of type `seller` / `supplier` |
| Message | `sales_order_placed` template |
| Reply options | **Confirmed** · **Query** |
| Record created | An order record with reference, line summary, delivery date |
| Follow-up | Unconfirmed after N hours → chase; delivery date passes → chase |

---

## 3. Message templates

### 3.1 Rules these follow

Taken from what the codebase already does (`whatsappService.ts` lines 5–31) and
from Meta's submission requirements:

- One template per language, name suffixed with the code: `sample_dispatch_en`,
  `sample_dispatch_hi`. `APPROVED_LANGS` currently holds `en` and `hi`; a code
  only gets added there once **both** the template and that language are
  approved, otherwise the send is rejected outright and the contact gets nothing.
- Positional parameters (`{{1}}`, `{{2}}`) — the existing senders pass an
  ordered array, so named parameters would mean changing `sendWhatsAppLocalized`.
- Every parameter value goes through the existing sanitiser (line ~476) before
  it is sent. Amounts and references must not contain newlines or tabs.
- Avoid starting or ending a body with a variable, and never place two variables
  adjacent — both are common Meta rejection reasons.
- Quick-reply buttons: maximum 3, title maximum 20 characters. Button ids are a
  **wire format**, matched on the way back in (`BTN` in `commandExecutor.ts`),
  so they are chosen once and never changed for cosmetic reasons.
- Category: all five are **UTILITY** (transaction and account updates to a party
  we already do business with). Submitting any of them as MARKETING changes both
  the approval odds and the cost. A payment reminder to somebody with no prior
  business relationship is not utility, and is not a message this system should
  be able to send at all — see §5.3.

### 3.2 `sample_dispatch`

**Category:** UTILITY · **Params:** 5

```
sample_dispatch_en
─────────────────────────────────────────────────────────
Hi {{1}}, this is an update from {{2}}.

We are sending you the following sample(s):
{{3}}

Expected to reach you by {{4}}.
Reference: {{5}}

Please confirm once it arrives.
─────────────────────────────────────────────────────────
Buttons:  [ Received ]  [ Not received yet ]
```

| Param | Meaning | Example |
|---|---|---|
| `{{1}}` | Contact name | `Rakesh` |
| `{{2}}` | Our company name | `Caratsense` |
| `{{3}}` | Sample description | `2 stone samples — Kota Blue, Tandur Grey` |
| `{{4}}` | Expected arrival date | `27 August` |
| `{{5}}` | Dispatch / tracking reference | `Bluedart 7712834455` |

```
sample_dispatch_hi
─────────────────────────────────────────────────────────
नमस्ते {{1}}, यह {{2}} की ओर से एक सूचना है।

हम आपको यह सैंपल भेज रहे हैं:
{{3}}

यह {{4}} तक आप तक पहुँचने की उम्मीद है।
संदर्भ: {{5}}

पहुँचने पर कृपया पुष्टि करें।
─────────────────────────────────────────────────────────
Buttons:  [ मिल गया ]  [ अभी नहीं मिला ]
```

### 3.3 `payment_due_thirdparty`

**Category:** UTILITY · **Params:** 5

```
payment_due_thirdparty_en
─────────────────────────────────────────────────────────
Hi {{1}}, this is a payment reminder from {{2}}.

Amount due: {{3}}
Against: {{4}}
Due date: {{5}}

If you have already paid, please ignore this message or reply below.
─────────────────────────────────────────────────────────
Buttons:  [ Payment done ]  [ Need more time ]  [ Invoice query ]
```

| Param | Meaning | Example |
|---|---|---|
| `{{1}}` | Contact name | `Metro Logistics` |
| `{{2}}` | Our company name | `Caratsense` |
| `{{3}}` | Amount, pre-formatted with currency | `₹45,000` |
| `{{4}}` | Invoice or reference | `Invoice INV-2231` |
| `{{5}}` | Due date | `5 September 2026` |

```
payment_due_thirdparty_hi
─────────────────────────────────────────────────────────
नमस्ते {{1}}, यह {{2}} की ओर से भुगतान की याद दिलाने वाला संदेश है।

बकाया राशि: {{3}}
किसके विरुद्ध: {{4}}
अंतिम तिथि: {{5}}

यदि आपने भुगतान कर दिया है, तो कृपया इस संदेश को अनदेखा करें या नीचे उत्तर दें।
─────────────────────────────────────────────────────────
Buttons:  [ भुगतान हो गया ]  [ समय चाहिए ]  [ बिल संबंधी प्रश्न ]
```

### 3.4 `payment_due_seller`

**Category:** UTILITY · **Params:** 5 (identical positions to §3.3)

```
payment_due_seller_en
─────────────────────────────────────────────────────────
Hi {{1}}, a payment against your account with {{2}} is now due.

Amount: {{3}}
Against: {{4}}
Due date: {{5}}

Please confirm the payment status using the buttons below.
─────────────────────────────────────────────────────────
Buttons:  [ Payment done ]  [ Need more time ]  [ Invoice query ]
```

```
payment_due_seller_hi
─────────────────────────────────────────────────────────
नमस्ते {{1}}, {{2}} के साथ आपके खाते में भुगतान अब देय है।

राशि: {{3}}
किसके विरुद्ध: {{4}}
अंतिम तिथि: {{5}}

कृपया नीचे दिए गए बटन से भुगतान की स्थिति बताएं।
─────────────────────────────────────────────────────────
Buttons:  [ भुगतान हो गया ]  [ समय चाहिए ]  [ बिल संबंधी प्रश्न ]
```

### 3.5 `stock_check_request`

**Category:** UTILITY · **Params:** 5

```
stock_check_request_en
─────────────────────────────────────────────────────────
Hi {{1}}, {{2}} would like to check availability.

Item: {{3}}
Quantity: {{4}}
Required by: {{5}}

Please let us know using the buttons below.
─────────────────────────────────────────────────────────
Buttons:  [ In stock ]  [ Out of stock ]  [ Will confirm ]
```

| Param | Meaning | Example |
|---|---|---|
| `{{1}}` | Contact name | `Kiran` |
| `{{2}}` | Our company name | `Caratsense` |
| `{{3}}` | Item / SKU | `Kota Blue limestone, honed` |
| `{{4}}` | Quantity | `400 sq ft` |
| `{{5}}` | Needed-by date | `Friday, 28 August` |

```
stock_check_request_hi
─────────────────────────────────────────────────────────
नमस्ते {{1}}, {{2}} उपलब्धता जानना चाहते हैं।

वस्तु: {{3}}
मात्रा: {{4}}
कब तक चाहिए: {{5}}

कृपया नीचे दिए गए बटन से बताएं।
─────────────────────────────────────────────────────────
Buttons:  [ स्टॉक में है ]  [ स्टॉक में नहीं ]  [ बाद में बताऊंगा ]
```

### 3.6 `sales_order_placed`

**Category:** UTILITY · **Params:** 5

```
sales_order_placed_en
─────────────────────────────────────────────────────────
Hi {{1}}, {{2}} has placed the following order.

Order: {{3}}
Details: {{4}}
Delivery expected by: {{5}}

Please confirm you can fulfil this.
─────────────────────────────────────────────────────────
Buttons:  [ Confirmed ]  [ Query ]
```

| Param | Meaning | Example |
|---|---|---|
| `{{1}}` | Contact name | `Kiran` |
| `{{2}}` | Our company name | `Caratsense` |
| `{{3}}` | Order reference | `SO-1187` |
| `{{4}}` | Line summary | `400 sq ft Kota Blue, honed finish` |
| `{{5}}` | Delivery date | `12 September` |

```
sales_order_placed_hi
─────────────────────────────────────────────────────────
नमस्ते {{1}}, {{2}} ने यह ऑर्डर दिया है।

ऑर्डर: {{3}}
विवरण: {{4}}
डिलीवरी कब तक: {{5}}

कृपया पुष्टि करें कि आप यह पूरा कर सकते हैं।
─────────────────────────────────────────────────────────
Buttons:  [ पुष्टि की ]  [ प्रश्न है ]
```

### 3.7 Templates that are easy to forget

These are not use cases, but without them the flows have holes:

| Template | Why it is needed |
|---|---|
| `payment_due_followup_{en,hi}` | The 24-hour window closes. A reminder ladder cannot use a session message. |
| `stock_check_followup_{en,hi}` | Same — the chase after silence. |
| `sample_delivery_check_{en,hi}` | Same — "did the sample reach you?" days later. |
| `outreach_optin_{en,hi}` | First-ever contact, asking permission to message them (§5.3). |

That takes the submission set to roughly **9 base templates × 2 languages = 18**
template approvals. At Meta's usual turnaround this is days, not hours, and any
rejection resets that clock — which is why §7 puts template submission first.

---

## 4. What must exist before any of this can be coded

### 4.1 A `Contact` model — the single biggest gap

There is no representation of an external party anywhere in
`backend/prisma/schema.prisma`. Everything is a `User` with a `Role`.

Contacts cannot be `User` rows. A `User` has `passwordHash`, `role`,
`reportingToId`, appears in team lists, in workload charts, in
`assignableUsers()`, and can be given tasks. Putting a vendor there would put
them in every one of those places.

A new model is needed, roughly:

```
Contact
  id, name, companyName, phone (unique), type (seller | third_party | buyer | supplier | other)
  preferredLanguage        // same "en" | "hi" contract as User
  ownerId  → User          // who at our end is responsible for them
  optInAt, optOutAt        // §5.3
  archivedAt
  createdAt
```

Consequences that must be designed at the same time, not discovered later:

- **`Message.userId` is non-null and points at `User`.** A conversation with a
  contact has no owning employee. Either `Message` gains a nullable `contactId`
  with a check that exactly one of the two is set, or contact conversations get
  their own table. This decision touches `conversationService.ts`,
  `conversationController.ts`, and the whole WhatsApp Hub in the frontend.
- **`WhatsAppCommand.newAssigneeId` is a plain string with no FK**, so it can
  hold a contact id — but `previousAssigneeId`/`newAssigneeId` are the wrong
  names for "who we messaged", and the audit view reads them as employees.
- **Phone uniqueness across both tables.** If a number belongs to both a `User`
  and a `Contact`, the inbound webhook has to decide which one is speaking.
  Resolve this at the schema level, not with an `if` in the webhook.

### 4.2 A record for the thing being tracked

Each use case produces something with a lifecycle: sent → replied → resolved,
with reminders in between. Two options, and this needs deciding before coding:

**Option A — reuse `Task`.** Add a `kind` enum (`internal`, `sample`, `payment`,
`stock`, `order`) and a nullable `contactId`. Everything already built comes
along for free: the escalation cron, the deadline reminder ladder, the tracker
UI, activity logging, the analytics views.

**Option B — a new `Outreach` model.** Cleaner conceptually; a payment reminder
genuinely is not a task somebody performs. But it means a second escalation
worker, a second tracker view, a second set of analytics, and every "show me
everything open" query becomes a union.

**Recommendation: Option A.** `Task` already has `deadline`, `status`,
`escalationLevel`, `alertDispatched`, `customFields` (a `Json` column — amount,
invoice ref, SKU, quantity all fit there without a migration per use case), and
an activity log. The cost is that `assignedToId` is required and points at a
`User`, so the internal owner stays the assignee and the contact hangs off
`contactId`. That reads correctly: *somebody on our team owns chasing this*.

### 4.3 New command intents and slots

`commandService.ts` currently parses eight intents. Five more are needed:

```
send_sample | payment_reminder | stock_check | sales_order   (+ a shared `outreach_followup`)
```

And new slots on `ParsedCommand`:

| Slot | Used by | Notes |
|---|---|---|
| `contactName` | all five | Distinct from `targetName`, which means *employee* everywhere today |
| `amount` + `currency` | UC27, UC28 | See §5.1 — this is the dangerous one |
| `reference` | UC26–UC30 | Invoice no., order no., tracking no. |
| `itemDescription` | UC26, UC29, UC30 | |
| `quantity` | UC29, UC30 | |
| `dueDateText` | all five | `deadlineParser.ts` already exists and should be reused as-is |

Both stages need updating in step: the rule patterns **and** `COMMAND_PROMPT`,
plus `AI_INTENTS`. The existing prompt contains the line *"a person reporting on
their OWN work is ALWAYS none"* — that guard has to survive, or a worker saying
"payment ho gaya" starts triggering outbound payment messages.

### 4.4 Contact name resolution

Good news: `nameResolutionService.ts` is pure and generic over
`Candidate { id, name }`, so it can rank contacts with no changes. What is
needed is the contact-side equivalent of `assignableUsers()` — a function that
returns the contacts a given Admin is allowed to message, because **the
candidate list is the permission boundary** and that property has to hold for
contacts exactly as it does for employees.

Open decision: can every Admin message every contact, or only contacts they own
(`Contact.ownerId`)? See §6.3.

### 4.5 Inbound routing for contact replies

`webhookController.ts` today assumes an inbound message is from a `User`, and
runs it through `intentService.analyzeMessage()` which classifies it as
`done | issue | delay | progress`. A vendor tapping **Payment done** must not
enter that pipeline.

Needed:

1. A branch at the top of the webhook: is this number a `User` or a `Contact`?
2. A separate button-id → outcome map for the outreach buttons.
3. Free-text handling for contacts — a vendor who types *"we'll pay Tuesday"*
   instead of tapping a button. Simplest correct behaviour to start with:
   **do not try to interpret it**; store it, mark the record as "contact
   replied", and forward it verbatim to the internal owner. Reading a payment
   commitment out of free text is a project of its own.
4. Routing the reply back to the Admin who sent the request. UC29 in particular
   is worthless if the answer does not reach the person who asked.

### 4.6 Frontend

- A **Contacts** directory (add / edit / archive, phone, type, language, owner).
  Roughly the shape of the existing `TeamView` + `AddMemberModal`.
- Outreach records surfaced in the tracker — either as a filter on the existing
  task table if §4.2 Option A is taken, or as a new view if Option B.
- The WhatsApp Hub needs to show contact conversations alongside employee ones.

---

## 5. Safety rules that must be settled before coding

These are not polish. Each one is a way this feature can do real damage.

### 5.1 Amounts collide with task numbers — a live bug waiting to happen

`intentService.ts` line 63 ends the task-reference patterns with a bare
4–6 digit fallback:

```
/\b(\d{4,6})\b/
```

So `extractTaskRef("remind Metro Logistics about 45000 due Friday")` returns
**`TSK-45000`**. Both `intentService` and `commandService` call it. Every
payment instruction contains a number in exactly that range.

This must be fixed as part of the work, not after: an amount pattern has to be
recognised and excluded before the bare-number fallback runs, and the bare
fallback should probably be suppressed entirely on the new intents.

### 5.2 Money commands always confirm

`commandExecutor.ts` executes without asking when confidence ≥ `0.9`
(`WA_CONFIDENCE_THRESHOLD`). That threshold was set for reassigning a ticket,
which is recoverable and undoable.

Sending an external party a demand for the wrong amount, or the right amount to
the wrong party, is neither. **UC27 and UC28 should confirm before sending
regardless of confidence** — an explicit branch, in the same style as the
existing bulk-reassign rule, which always confirms because it touches work the
sender has not individually looked at. UC26, UC29 and UC30 arguably qualify too.

The confirmation must read back the parsed values, not the raw message:

> *Send a payment reminder to **Metro Logistics** (+91 ••••4455) for **₹45,000**
> against **INV-2231**, due **5 September**? Reply YES to send.*

### 5.3 Opt-in and WhatsApp policy

This is the prerequisite most likely to stop the whole feature, and it is not a
technical one.

Meta requires an opt-in before a business messages someone on WhatsApp. Today
that is satisfied implicitly: every recipient is an employee of the client. A
third-party vendor is not, and messaging them without a recorded opt-in risks
the client's WhatsApp Business number being rate-limited or banned — which would
take down the task manager along with it.

Required before build:
- `Contact.optInAt` / `optOutAt`, and a hard refusal to send to a contact with
  no opt-in recorded.
- A documented way opt-in is captured (a form, a signed vendor agreement, an
  `outreach_optin` template the contact replies to) — **the client has to tell
  us which**.
- STOP / opt-out handling on the inbound side, honoured permanently.
- Awareness that Meta's quality rating is per-phone-number: outreach complaints
  degrade the same number the internal task flow depends on.

### 5.4 Who is allowed to do this

`WA_COMMAND_ROLES` is currently `Manager,Admin`. Payment reminders and orders
should almost certainly be **Admin only**, which means a second gate rather than
reusing the existing one — a Manager who can reassign a ticket should not
thereby be able to send a vendor a bill.

Suggested: `WA_OUTREACH_ENABLED` (defaulting to `false`, exactly as
`WA_COMMANDS_ENABLED` ships dark) and `WA_OUTREACH_ROLES="Admin"`.

### 5.5 Rate limiting and blast radius

`rateLimit.ts` limits commands per sender. It does not limit *sends per
contact*, so a mis-parse or an over-eager reminder ladder can message the same
vendor repeatedly. A per-contact cooldown is needed, and probably a daily cap
on outbound messages per contact.

---

## 6. Decisions needed from the client before we start

1. **Payment direction.** Is there a "we have paid you" remittance message, or
   only "you owe us"? (§2, UC28)
2. **Amount source of truth.** Does the Admin type the amount into WhatsApp
   every time, or does it come from an invoice record / existing accounting
   system? If it is typed, the system can never validate it, and §5.2 becomes
   mandatory rather than advisable.
3. **Contact visibility.** Can any Admin message any contact, or only contacts
   they own? (§4.4)
4. **Opt-in mechanism.** How is consent captured and evidenced? (§5.3)
5. **Reminder ladder.** Exact schedule per use case — e.g. payment at due−3d,
   due, due+3d, then escalate to Admin. Configurable per client or fixed?
6. **Company name in templates.** `{{2}}` in every template is the sending
   company. One value per deployment, or per contact?
7. **Contact onboarding.** How do contacts get into the system in the first
   place — dashboard entry, CSV import, or created inline from a WhatsApp
   instruction? (Creating a contact from WhatsApp means an Admin typo silently
   creates a new vendor and messages a wrong number.)
8. **Currency.** ₹ only, or multi-currency?

---

## 7. Suggested order of work

Template approval is the long pole and has no code dependencies, so it starts
on day one and runs in parallel with everything else.

| Phase | Work | Blocked by |
|---|---|---|
| 0 | Answer §6. Submit all 18 templates to Meta. Document the opt-in mechanism. | Client |
| 1 | `Contact` model + migration; contacts directory UI; phone-collision rule (§4.1) | §6.3, §6.7 |
| 2 | Fix the amount/task-number collision (§5.1) with tests. Standalone, no dependencies — do it early. | — |
| 3 | Outreach record decision (§4.2) implemented; `customFields` shapes fixed per use case | §6.2 |
| 4 | Parser: new intents + slots, rules and prompt, contact resolution (§4.3, §4.4) | Phase 1 |
| 5 | Executor: mandatory confirmation, opt-in gate, per-contact rate limit, send (§5) | Phases 1–4 + approved templates |
| 6 | Inbound: contact branch, button map, forward-to-owner (§4.5) | Phase 5 |
| 7 | Reminder ladder on the existing 15-minute cron (`workers/scheduler.ts`) | Phase 3, §6.5 |
| 8 | Tracker + WhatsApp Hub surfacing | Phase 3 |

Phases 0 and 2 can begin immediately. Everything else waits on the answers in
§6 — in particular §6.4, because if opt-in cannot be evidenced, the payment and
stock use cases should not ship at all in their current form.
