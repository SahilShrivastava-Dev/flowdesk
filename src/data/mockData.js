// ----------------------------- Users -----------------------------
export const users = [
  { id: 'U001', name: 'Aarav Mehta',     role: 'Admin',    reportingTo: null,   email: 'aarav@flowdesk.io',     avatar: 'AM', color: 'from-fuchsia-500 to-purple-600' },
  { id: 'U010', name: 'Priya Sharma',    role: 'Manager',  reportingTo: 'U001', email: 'priya@flowdesk.io',     avatar: 'PS', color: 'from-rose-500 to-orange-500' },
  { id: 'U011', name: 'Rahul Verma',     role: 'Manager',  reportingTo: 'U001', email: 'rahul@flowdesk.io',     avatar: 'RV', color: 'from-sky-500 to-indigo-500' },
  { id: 'U012', name: 'Neha Iyer',       role: 'Manager',  reportingTo: 'U001', email: 'neha@flowdesk.io',      avatar: 'NI', color: 'from-emerald-500 to-teal-500' },

  { id: 'U101', name: 'Karan Singh',     role: 'Employee', reportingTo: 'U010', email: 'karan@flowdesk.io',     avatar: 'KS', color: 'from-amber-500 to-rose-500' },
  { id: 'U102', name: 'Sneha Pillai',    role: 'Employee', reportingTo: 'U010', email: 'sneha@flowdesk.io',     avatar: 'SP', color: 'from-pink-500 to-fuchsia-500' },
  { id: 'U103', name: 'Vikram Rao',      role: 'Employee', reportingTo: 'U010', email: 'vikram@flowdesk.io',    avatar: 'VR', color: 'from-blue-500 to-cyan-500' },

  { id: 'U104', name: 'Aditi Nair',      role: 'Employee', reportingTo: 'U011', email: 'aditi@flowdesk.io',     avatar: 'AN', color: 'from-violet-500 to-indigo-500' },
  { id: 'U105', name: 'Rohan Das',       role: 'Employee', reportingTo: 'U011', email: 'rohan@flowdesk.io',     avatar: 'RD', color: 'from-lime-500 to-emerald-500' },

  { id: 'U106', name: 'Maya Kapoor',     role: 'Employee', reportingTo: 'U012', email: 'maya@flowdesk.io',      avatar: 'MK', color: 'from-rose-400 to-pink-500' },
  { id: 'U107', name: 'Imran Sheikh',    role: 'Employee', reportingTo: 'U012', email: 'imran@flowdesk.io',     avatar: 'IS', color: 'from-cyan-500 to-blue-600' },
];

// Runtime override — AppContext calls this when API users are loaded
let _runtimeUsers = users;
export function setRuntimeUsers(u) { _runtimeUsers = u; }

export const findUser = (id) => _runtimeUsers.find((u) => u.id === id);
export const directReports = (managerId) =>
  _runtimeUsers.filter((u) => (u.reportingTo ?? u.reportingToId) === managerId);

// ----------------------------- Date helpers -----------------------------
const today = new Date('2026-05-03T09:00:00');
const day = (offset) => {
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  return d.toISOString();
};

// ----------------------------- Tasks -----------------------------
export const initialTasks = [
  {
    id: 'TSK-1', title: 'Q2 Marketing campaign brief',
    description: 'Draft the campaign positioning, target personas, and channel mix for the Q2 product launch.',
    assignedTo: 'U102', assignedBy: 'U010', status: 'Pending', priority: 'High',
    deadline: day(-2), createdAt: day(-7), escalationLevel: 1,
    customFields: { Channel: 'WhatsApp + Email', Budget: '₹4,50,000', Region: 'IN-South' },
    activity: [
      { at: day(-7), by: 'U010', type: 'created', text: 'Task created and assigned' },
      { at: day(-5), by: 'U102', type: 'comment', text: 'Pulling positioning doc from last quarter.' },
      { at: day(-1), by: 'system', type: 'escalation', text: 'Auto-escalated: deadline missed.' },
    ],
  },
  {
    id: 'TSK-2', title: 'Vendor onboarding — Brightline Logistics',
    description: 'Collect KYC, sign NDA, and provision portal access.',
    assignedTo: 'U103', assignedBy: 'U010', status: 'Done', priority: 'Medium',
    deadline: day(-1), createdAt: day(-9), escalationLevel: 0,
    customFields: { Vendor: 'Brightline Logistics', PO: 'PO-7781', Region: 'IN-West' },
    activity: [
      { at: day(-9), by: 'U010', type: 'created', text: 'Task created' },
      { at: day(-2), by: 'U103', type: 'status', text: 'Marked as Done via WhatsApp' },
    ],
  },
  {
    id: 'TSK-3', title: 'Refund pipeline — May reconciliation',
    description: 'Reconcile failed refunds and issue manual settlements where required.',
    assignedTo: 'U101', assignedBy: 'U010', status: 'Issue', priority: 'High',
    deadline: day(0), createdAt: day(-5), escalationLevel: 2,
    customFields: { Volume: '184 cases', Tooling: 'Razorpay + Internal' },
    activity: [
      { at: day(-5), by: 'U010', type: 'created', text: 'Assigned during stand-up' },
      { at: day(-1), by: 'U101', type: 'comment', text: 'Blocked: gateway returns 502 on bulk fetch.' },
      { at: day(0),  by: 'system', type: 'escalation', text: 'Escalated to Admin' },
    ],
  },
  {
    id: 'TSK-4', title: 'Hiring loop — Senior SRE',
    description: 'Schedule on-site loop for shortlisted candidates next week.',
    assignedTo: 'U104', assignedBy: 'U011', status: 'Pending', priority: 'Medium',
    deadline: day(3), createdAt: day(-2), escalationLevel: 0,
    customFields: { Role: 'Senior SRE', Candidates: '4 shortlisted' },
    activity: [{ at: day(-2), by: 'U011', type: 'created', text: 'Task created' }],
  },
  {
    id: 'TSK-5', title: 'Pricing page A/B test — variant C',
    description: 'Ship variant C and route 20% traffic via feature flag.',
    assignedTo: 'U105', assignedBy: 'U011', status: 'Done', priority: 'High',
    deadline: day(-3), createdAt: day(-10), escalationLevel: 0,
    customFields: { Flag: 'pricing_v3_rollout', Traffic: '20%' },
    activity: [
      { at: day(-10), by: 'U011', type: 'created', text: 'Task created' },
      { at: day(-4),  by: 'U105', type: 'comment', text: 'PR merged, awaiting QA.' },
      { at: day(-3),  by: 'U105', type: 'status', text: 'Marked as Done via WhatsApp' },
    ],
  },
  {
    id: 'TSK-6', title: 'Customer churn report — April',
    description: 'Pull cohort retention and write the executive summary.',
    assignedTo: 'U104', assignedBy: 'U011', status: 'Delay', priority: 'High',
    deadline: day(-1), createdAt: day(-6), escalationLevel: 1,
    customFields: { Cohort: '2025-Q4', Tooling: 'Looker' },
    activity: [
      { at: day(-6), by: 'U011', type: 'created', text: 'Created' },
      { at: day(-1), by: 'system', type: 'escalation', text: 'Escalated to manager' },
    ],
  },
  {
    id: 'TSK-7', title: 'WhatsApp broadcast template approval',
    description: 'Submit the new utility template for Meta review.',
    assignedTo: 'U106', assignedBy: 'U012', status: 'Pending', priority: 'Low',
    deadline: day(2), createdAt: day(-1), escalationLevel: 0,
    customFields: { Category: 'Utility', Language: 'EN + HI' },
    activity: [{ at: day(-1), by: 'U012', type: 'created', text: 'Created' }],
  },
  {
    id: 'TSK-8', title: 'Roll out SSO to design team',
    description: 'Provision Okta groups and enforce SSO on Figma + Linear.',
    assignedTo: 'U107', assignedBy: 'U012', status: 'Done', priority: 'Medium',
    deadline: day(-2), createdAt: day(-8), escalationLevel: 0,
    customFields: { Tools: 'Figma, Linear, Notion', Users: '14' },
    activity: [
      { at: day(-8), by: 'U012', type: 'created', text: 'Created' },
      { at: day(-2), by: 'U107', type: 'status', text: 'Marked as Done — awaiting approval' },
    ],
  },
  {
    id: 'TSK-9', title: 'Quarterly compliance audit prep',
    description: 'Compile evidence for SOC2 controls A.1–A.7 and share with auditors.',
    assignedTo: 'U010', assignedBy: 'U001', status: 'Pending', priority: 'High',
    deadline: day(5), createdAt: day(0), escalationLevel: 0,
    customFields: { Framework: 'SOC2', Auditor: 'Prescient Assurance' },
    activity: [{ at: day(0), by: 'U001', type: 'created', text: 'Created by Admin' }],
  },
  {
    id: 'TSK-10', title: 'Investor update — May',
    description: 'Drafting key metrics and narrative for the May investor email.',
    assignedTo: 'U011', assignedBy: 'U001', status: 'Pending', priority: 'High',
    deadline: day(4), createdAt: day(-1), escalationLevel: 0,
    customFields: { Audience: 'Series B investors', Channel: 'Email' },
    activity: [{ at: day(-1), by: 'U001', type: 'created', text: 'Created by Admin' }],
  },
  {
    id: 'TSK-11', title: 'Customer success NPS sweep',
    description: 'Run NPS for top 50 accounts and triage detractors.',
    assignedTo: 'U102', assignedBy: 'U010', status: 'Pending', priority: 'Medium',
    deadline: day(6), createdAt: day(0), escalationLevel: 0,
    customFields: { Accounts: '50', Tooling: 'Delighted' },
    activity: [{ at: day(0), by: 'U010', type: 'created', text: 'Created' }],
  },
  {
    id: 'TSK-12', title: 'Migrate billing to v2 ledger',
    description: 'Cut over remaining 30% accounts to the v2 ledger backend.',
    assignedTo: 'U105', assignedBy: 'U011', status: 'Done', priority: 'High',
    deadline: day(-4), createdAt: day(-12), escalationLevel: 0,
    customFields: { Coverage: '30% → 100%', Risk: 'Medium' },
    activity: [
      { at: day(-12), by: 'U011', type: 'created', text: 'Created' },
      { at: day(-4),  by: 'U105', type: 'status', text: 'Marked Done via WhatsApp' },
    ],
  },
];

// ----------------------------- Notifications -----------------------------
export const initialNotifications = [
  { id: 'N1', type: 'escalation', title: 'TSK-3 escalated to Admin', detail: 'Refund pipeline blocked at gateway', time: '12 min ago', unread: true },
  { id: 'N2', type: 'approval',   title: 'Sneha submitted TSK-1 for review', detail: 'Awaiting your approval', time: '36 min ago', unread: true },
  { id: 'N3', type: 'whatsapp',   title: 'Karan replied via WhatsApp', detail: '“Looking into the gateway 502s now.”', time: '1 hr ago', unread: true },
  { id: 'N4', type: 'overdue',    title: 'TSK-6 is overdue by 1 day', detail: 'Customer churn report — April', time: '2 hrs ago', unread: false },
  { id: 'N5', type: 'system',     title: 'Daily summary sent', detail: 'Posted to #ops at 09:00', time: '6 hrs ago', unread: false },
];

// ----------------------------- Conversations -----------------------------
// One thread per person, mirroring the /api/conversations shape.
//
// U104 owns two tasks (TSK-4, TSK-6), which is what makes the interesting
// cases demonstrable: a merged thread spanning both, and an ambiguous "done"
// that the system refuses to guess at.
const mins = (n) => new Date(Date.now() - n * 60_000).toISOString();

export const initialThreads = {
  U104: {
    messages: [
      { id: 'M1', direction: 'inbound', kind: 'text',
        text: 'Task 4 done, candidate accepted the offer',
        taskId: 'TSK-4', attributedBy: 'explicit_ref', needsAttribution: false,
        senderId: 'U104', deliveryStatus: 'sent', createdAt: mins(180) },
      { id: 'M2', direction: 'outbound', kind: 'text',
        text: 'Great news — can you share the churn numbers too?',
        taskId: null, attributedBy: 'none', needsAttribution: false,
        senderId: 'U011', deliveryStatus: 'sent', createdAt: mins(174) },
      { id: 'M3', direction: 'inbound', kind: 'voice',
        text: 'Ye bhi ho gaya', transcription: 'Ye bhi ho gaya',
        taskId: null, attributedBy: 'none', needsAttribution: true,
        senderId: 'U104', deliveryStatus: 'sent', createdAt: mins(12) },
    ],
    hasMore: false, nextBefore: null,
    session: { open: true, minutesAgo: 12 },
    tasks: [
      { id: 'TSK-4', title: 'Hiring loop — Senior SRE',      status: 'Pending' },
      { id: 'TSK-6', title: 'Customer churn report — April', status: 'Delay'   },
    ],
  },
  U101: {
    messages: [
      { id: 'M4', direction: 'inbound', kind: 'text',
        text: 'Gateway is returning 502s, blocked on this',
        taskId: 'TSK-3', attributedBy: 'single_open_task', needsAttribution: false,
        senderId: 'U101', deliveryStatus: 'sent', createdAt: mins(65) },
    ],
    hasMore: false, nextBefore: null,
    session: { open: true, minutesAgo: 65 },
    tasks: [{ id: 'TSK-3', title: 'Refund pipeline — May reconciliation', status: 'Issue' }],
  },
};

export const initialConversations = [
  {
    userId: 'U104', name: 'Ishita Rao', avatar: '', color: 'from-fuchsia-400 to-fuchsia-600',
    role: 'Employee', hasPhone: true, reportingToId: 'U011',
    lastMessage: { id: 'M3', preview: '🎙️ "Ye bhi ho gaya"', direction: 'inbound', kind: 'voice', createdAt: mins(12) },
    session: { open: true, minutesAgo: 12 },
    needsAttributionCount: 1, openTaskCount: 2, overdueCount: 1,
  },
  {
    userId: 'U101', name: 'Karan Shah', avatar: '', color: 'from-sky-400 to-sky-600',
    role: 'Employee', hasPhone: true, reportingToId: 'U010',
    lastMessage: { id: 'M4', preview: 'Gateway is returning 502s, blocked on this', direction: 'inbound', kind: 'text', createdAt: mins(65) },
    session: { open: true, minutesAgo: 65 },
    needsAttributionCount: 0, openTaskCount: 1, overdueCount: 0,
  },
  {
    userId: 'U102', name: 'Sneha Iyer', avatar: '', color: 'from-emerald-400 to-emerald-600',
    role: 'Employee', hasPhone: true, reportingToId: 'U010',
    lastMessage: null,
    session: { open: false, minutesAgo: null },
    needsAttributionCount: 0, openTaskCount: 1, overdueCount: 0,
  },
];

// ----------------------------- Helpers -----------------------------
export const isOverdue = (task) => {
  const d = new Date(task.deadline).getTime();
  // Submitted work isn't overdue — the worker delivered; it's with a reviewer.
  return d < Date.now() && task.status !== 'Done' && task.status !== 'Submitted';
};

export const daysUntil = (iso) => {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.round(ms / (1000 * 60 * 60 * 24));
};

// ─────────────────────────────────────────────────────────────────────────────
// External parties and invoices — demo mode only.
//
// The app ships in two modes: with VITE_API_URL it talks to the backend, and
// without it, it runs entirely on this file as an interactive demo. Adding a
// view that reads from the API without a mock counterpart makes the demo build
// render an empty page, which is how the Parties page would have looked to
// anybody evaluating it.
// ─────────────────────────────────────────────────────────────────────────────

export const initialContacts = [
  {
    id: 'C1', name: 'Ramesh Traders', companyName: 'Ramesh Traders Pvt Ltd',
    phone: '919876543210', type: 'customer', email: 'accounts@rameshtraders.in',
    address: 'Jaipur, Rajasthan', notes: '', aliases: ['रमेश ट्रेडर्स', 'RT'],
    externalRef: 'GST08AAB...', preferredLanguage: 'hi', ownerId: 'U101',
    optInAt: '2026-07-02T09:00:00.000Z', optOutAt: null, archivedAt: null,
    createdAt: '2026-07-01T09:00:00.000Z',
    openInvoiceCount: 2, outstandingBalance: 70000,
    lastMessageAt: '2026-08-24T11:20:00.000Z',
  },
  {
    id: 'C2', name: 'Ramesh Textile Traders', companyName: 'Ramesh Textiles',
    phone: '919812345678', type: 'customer', email: null,
    address: 'Surat, Gujarat', notes: 'Different party from Ramesh Traders — do not merge.',
    aliases: [], externalRef: null, preferredLanguage: 'hi', ownerId: 'U101',
    optInAt: null, optOutAt: null, archivedAt: null,
    createdAt: '2026-07-14T09:00:00.000Z',
    openInvoiceCount: 0, outstandingBalance: 0, lastMessageAt: null,
  },
  {
    id: 'C3', name: 'Urja Vart', companyName: 'Urja Vart Textiles',
    phone: '919090909090', type: 'buyer', email: 'buying@urjavart.com',
    address: 'Ahmedabad, Gujarat', notes: '', aliases: ['Urja'],
    externalRef: null, preferredLanguage: 'en', ownerId: 'U102',
    optInAt: '2026-06-20T09:00:00.000Z', optOutAt: null, archivedAt: null,
    createdAt: '2026-06-18T09:00:00.000Z',
    openInvoiceCount: 0, outstandingBalance: 0,
    lastMessageAt: '2026-08-25T08:10:00.000Z',
  },
  {
    id: 'C4', name: 'Metro Logistics', companyName: 'Metro Logistics',
    phone: '919619608095', type: 'vendor', email: null,
    address: 'Mumbai, Maharashtra', notes: 'Courier partner.', aliases: [],
    externalRef: 'PO-7781', preferredLanguage: 'en', ownerId: 'U101',
    optInAt: '2026-05-10T09:00:00.000Z', optOutAt: null, archivedAt: null,
    createdAt: '2026-05-09T09:00:00.000Z',
    openInvoiceCount: 1, outstandingBalance: 45000,
    lastMessageAt: '2026-08-20T15:45:00.000Z',
  },
  {
    id: 'C5', name: 'Deccan Stones', companyName: 'Deccan Stones & Supply',
    phone: '919700112233', type: 'supplier', email: null,
    address: 'Hyderabad, Telangana', notes: '', aliases: [],
    externalRef: null, preferredLanguage: 'en', ownerId: 'U102',
    optInAt: null, optOutAt: '2026-08-01T10:00:00.000Z', archivedAt: null,
    createdAt: '2026-04-02T09:00:00.000Z',
    openInvoiceCount: 0, outstandingBalance: 0,
    lastMessageAt: '2026-08-01T10:00:00.000Z',
  },
];

export const initialInvoices = [
  {
    id: 'INV1', number: 'INV-102', contactId: 'C1', amount: 25000, balance: 25000,
    currency: 'INR', dueDate: '2026-09-05T12:30:00.000Z', status: 'open',
    payable: false, notes: '', createdById: 'U101',
    contact: { id: 'C1', name: 'Ramesh Traders', companyName: 'Ramesh Traders Pvt Ltd', type: 'customer' },
  },
  {
    id: 'INV2', number: 'INV-2231', contactId: 'C1', amount: 60000, balance: 45000,
    currency: 'INR', dueDate: '2026-08-20T12:30:00.000Z', status: 'partial',
    payable: false, notes: 'Part payment received 12 Aug.', createdById: 'U101',
    contact: { id: 'C1', name: 'Ramesh Traders', companyName: 'Ramesh Traders Pvt Ltd', type: 'customer' },
  },
  {
    // payable: we owe THEM. Drives the other payment template — the one that
    // says money is coming rather than asking for it.
    id: 'INV3', number: 'BILL-4471', contactId: 'C4', amount: 45000, balance: 45000,
    currency: 'INR', dueDate: '2026-09-12T12:30:00.000Z', status: 'open',
    payable: true, notes: 'Courier charges, August.', createdById: 'U101',
    contact: { id: 'C4', name: 'Metro Logistics', companyName: 'Metro Logistics', type: 'vendor' },
  },
];

/** Labels and colours for the six party types, used across the directory. */
export const CONTACT_TYPES = [
  { id: 'customer', label: 'Customer', bg: 'bg-[#DBEAFE]', text: 'text-[#1D4ED8]' },
  { id: 'vendor',   label: 'Vendor',   bg: 'bg-[#FEF3C7]', text: 'text-[#B45309]' },
  { id: 'seller',   label: 'Seller',   bg: 'bg-[#EDE9FE]', text: 'text-[#6D28D9]' },
  { id: 'supplier', label: 'Supplier', bg: 'bg-[#DCFCE7]', text: 'text-[#15803D]' },
  { id: 'buyer',    label: 'Buyer',    bg: 'bg-[#E0F2FE]', text: 'text-[#0369A1]' },
  { id: 'other',    label: 'Other',    bg: 'bg-[#F3F4F6]', text: 'text-[#374151]' },
];

export function contactTypeStyle(type) {
  return CONTACT_TYPES.find((t) => t.id === type) ?? CONTACT_TYPES[5];
}

/** The five task kinds, for the tracker filter and the task detail panel. */
export const TASK_KINDS = [
  { id: 'internal',         label: 'Internal'      },
  { id: 'sample_dispatch',  label: 'Samples'       },
  { id: 'payment_followup', label: 'Payments'      },
  { id: 'stock_check',      label: 'Stock'         },
  { id: 'sales',            label: 'Sales'         },
];

export function taskKindLabel(kind) {
  return TASK_KINDS.find((k) => k.id === kind)?.label ?? 'Internal';
}

/** ₹45,000 — Indian digit grouping, matching what the backend sends. */
export function formatMoney(value, currency = 'INR') {
  const n = Number(value ?? 0);
  const hasPaise = Math.round(n * 100) % 100 !== 0;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(n);
  return currency === 'INR' ? `\u20B9${formatted}` : `${currency} ${formatted}`;
}
