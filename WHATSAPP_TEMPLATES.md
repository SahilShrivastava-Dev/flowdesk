# WhatsApp Message Templates — the source of truth

Every template FlowDesk sends, with the parameter order the code actually
passes. `README.md`, `SETUP.md` and `ARCHITECTURE.md` point here rather than
carrying their own copies — they had drifted into three different answers about
the same templates, which is how a message goes out with the amount and the
invoice number swapped.

**Meta renders positionally.** `{{1}}` is whatever the code passes first. A
template whose body is correct but whose parameter ORDER differs from the code
produces a message that reads perfectly and states the wrong facts. So the
authority for the order below is `backend/src/services/whatsappService.ts`, not
this document — if the two disagree, the code is what gets sent.

## Rules every template follows

- One template per language, name suffixed with the code: `sample_dispatch_en`,
  `sample_dispatch_hi`.
- A language code only goes into `APPROVED_LANGS` (`whatsappService.ts`) once
  **both** the template and that language are approved. Sending to a name Meta
  has never seen is rejected outright, so the recipient gets nothing at all.
- Every parameter passes through `sanitiseParam`, which collapses whitespace and
  truncates at 300 characters. Meta rejects a body parameter containing a
  newline, a tab, or four or more consecutive spaces — and rejects the whole
  message, not just that parameter.
- Never start or end a body with a variable, and never place two variables
  adjacent. Both are common rejection reasons.
- Quick-reply buttons: at most 3, title at most 20 characters.
- **Button labels are a wire format.** Meta returns the LABEL for a template
  quick reply — there is no separate payload — and `contactReplyService.ts`
  matches on it. Renaming a button in WhatsApp Manager without changing that map
  turns every tap into an uninterpreted reply, silently. `tests/unit/contactReplyService.test.ts`
  is the contract.

---

## Internal templates — sent to employees

Six templates, all Utility. Bodies are in Meta; the parameter order is here.

| Template | Params, in order | Sender function |
|---|---|---|
| `task_assignment` | assignee name, task id | `sendTaskAssignmentNotification` |
| `task_reassigned` | new assignee, who moved it, task id | `sendTaskReassignedNotification` |
| `task_deadline_reminder` | holder, task id | `sendDeadlineReminderNotification` |
| `task_escalation` | recipient's own name, task title | `sendEscalationNotification` |
| `task_escalation_supervisor` | the assignee whose task it is, task title | `sendSupervisorEscalationNotification` |
| `update_waiting` | who is trying to reach them | `sendUpdateWaitingNotification` |

> ⚠️ **Known discrepancy, worth checking in WhatsApp Manager.**
> `README.md` documented `task_assignment` as `{{1}}` = task title and `{{2}}` =
> deadline. The code passes **assignee name** then **task id**. Both cannot be
> right. If the approved body reads "You've been assigned a new task: *{{1}}*",
> then it currently renders the assignee's name where the title belongs.
> Nothing in this work changed that behaviour — it is recorded here because
> writing this document is what surfaced it.

---

## Outreach templates — sent to external parties

Five templates, all **Utility**, submitted 25 August 2026. Each takes exactly
five parameters, and the shape is the same across all five:

```
{{1}}  who we are writing to        {{4}}  the reference or detail
{{2}}  who it is from (us)          {{5}}  the date
{{3}}  the headline value
```

`{{2}}` comes from `COMPANY_NAME` when set, and otherwise from the sending
employee's own name — which is what the approved samples show.

### `sample_dispatch`

```
sample_dispatch_en
─────────────────────────────────────────────
Hi {{1}}, this is an update from {{2}}.

We are sending you the following sample(s):
{{3}}

Expected to reach you by {{4}}.
Reference: {{5}}

Please confirm once it arrives.
─────────────────────────────────────────────
Buttons:  [ Received ]  [ Not received yet ]
```
```
sample_dispatch_hi
─────────────────────────────────────────────
नमस्ते {{1}}, यह {{2}} की ओर से एक सूचना है।

हम आपको यह सैंपल भेज रहे हैं:
{{3}}

यह {{4}} तक आप तक पहुँचने की उम्मीद है।
संदर्भ: {{5}}

पहुँचने पर कृपया पुष्टि करें।
─────────────────────────────────────────────
Buttons:  [ मिल गया ]  [ अभी नहीं मिला ]
```

| Param | Meaning | Example |
|---|---|---|
| `{{1}}` | Contact name | `Rakesh` |
| `{{2}}` | From | `Caratsense` |
| `{{3}}` | Sample description | `2m samples — Fabric A12, B14` |
| `{{4}}` | Expected arrival | `27 August 2026` |
| `{{5}}` | Dispatch / tracking reference | `Bluedart 7712834455` |

### `payment_advice_vendor` — **we owe them**

```
payment_advice_vendor_en
─────────────────────────────────────────────
Hi {{1}}, a payment update from {{2}}.

Amount: {{3}}
Against: {{4}}
Scheduled for: {{5}}

Please confirm your account details are unchanged.
─────────────────────────────────────────────
Buttons:  [ Details Correct ]  [ Need to update ]
```
```
payment_advice_vendor_hi
─────────────────────────────────────────────
नमस्ते {{1}}, {{2}} की ओर से भुगतान संबंधी सूचना।

राशि: {{3}}
किसके विरुद्ध: {{4}}
भुगतान निर्धारित: {{5}}

कृपया पुष्टि करें कि आपके खाते का विवरण अपरिवर्तित है।
─────────────────────────────────────────────
Buttons:  [ विवरण सही है ]  [ अपडेट करना है ]
```

### `payment_due_reminder` — **they owe us**

Not interchangeable with the one above. These two say opposite things about the
recipient's account, and the direction is decided by `Invoice.payable` — never
by how the instruction was worded, because "remind Metro about BILL-4471" is the
same sentence either way.

```
payment_due_reminder_en
─────────────────────────────────────────────
Hi {{1}}, this is a payment reminder from {{2}}.

Amount pending: {{3}}
Against: {{4}}
Due date: {{5}}

Kindly arrange the payment at your convenience.
If you have already paid, please ignore this message.
─────────────────────────────────────────────
Buttons:  [ Payment done ]  [ Need more time ]  [ Invoice Query ]
```
```
payment_due_reminder_hi
─────────────────────────────────────────────
नमस्ते {{1}}, यह {{2}} की ओर से भुगतान की याद दिलाने वाला संदेश है।

बकाया राशि: {{3}}
किसके विरुद्ध: {{4}}
अंतिम तिथि: {{5}}

कृपया अपनी सुविधानुसार भुगतान करें।
यदि आपने भुगतान कर दिया है, तो इस संदेश को अनदेखा करें।
─────────────────────────────────────────────
Buttons:  [ भुगतान हो गया ]  [ और समय चाहिए ]  [ इनवॉइस संबंधी प्रश्न ]
```

### `stock_check_request`

```
stock_check_request_en
─────────────────────────────────────────────
Hi {{1}}, {{2}} would like to check availability.

Item: {{3}}
Quantity: {{4}}
Required by: {{5}}

Please let us know using the buttons below.
─────────────────────────────────────────────
Buttons:  [ In stock ]  [ Out of stock ]  [ Will confirm ]
```
```
stock_check_request_hi
─────────────────────────────────────────────
नमस्ते {{1}}, {{2}} उपलब्धता जानना चाहते हैं।

वस्तु: {{3}}
मात्रा: {{4}}
कब तक चाहिए: {{5}}

कृपया नीचे दिए गए बटन से बताएं।
─────────────────────────────────────────────
Buttons:  [ स्टॉक में है ]  [ स्टॉक में नहीं ]  [ बाद में बताऊंगा ]
```

The **answer** is the point of this one, so `contactReplyService` routes the
reply back to the employee who owns the contact whether or not it was a button.

### `sales_order_placed`

```
sales_order_placed_en
─────────────────────────────────────────────
Hi {{1}}, {{2}} has placed the following order.

Order: {{3}}
Details: {{4}}
Delivery expected by: {{5}}

Please confirm you can fulfil this.
─────────────────────────────────────────────
Buttons:  [ Confirmed ]  [ Query ]
```
```
sales_order_placed_hi
─────────────────────────────────────────────
नमस्ते {{1}}, {{2}} ने यह ऑर्डर दिया है।

ऑर्डर: {{3}}
विवरण: {{4}}
डिलीवरी अपेक्षित: {{5}}

कृपया पुष्टि करें कि आप इसे पूरा कर सकते हैं।
─────────────────────────────────────────────
Buttons:  [ पुष्टि करें ]  [ प्रश्न है ]
```

> **Note the parameter order, which reads backwards.** The approved template
> puts the line summary in `{{3}}` ("Order: 30 US Polo Shorts") and the
> reference in `{{4}}` ("Details: ORDERID-1234"). `sendSalesOrderPlaced` follows
> the approved template, not the label wording. Do not "fix" one without the
> other.

> ⚠️ **`sales_order_placed_hi` was submitted as MARKETING, not Utility** —
> its English twin is Utility. Marketing templates price differently, are
> approved differently, and are subject to marketing opt-out. Worth changing to
> Utility in WhatsApp Manager so the pair behaves consistently.

---

## Reminder ladder

There are no separate `*_followup` templates and none are needed: a chase
**re-sends the same approved template**, which is what a reminder ladder is.
`outreachFollowUpService` stops after `WA_OUTREACH_MAX_CHASES` and tells the
internal owner to call instead — an unbounded ladder is how a WhatsApp number
gets reported, and it is the same number the internal task flow depends on.

## When a template is not used at all

Inside the 24-hour session window, replies to both employees and contacts go out
as free-form text. Outside it:

- **Employees** get `update_waiting` to re-open the window. There is a standing
  relationship and they expect to hear from us.
- **Contacts** get nothing. `POST /api/contacts/:id/messages` refuses with an
  explanation rather than silently converting a typed reply into an approved
  template send — that would be a message the party never agreed to receive, on
  a number whose quality rating everything else depends on.
