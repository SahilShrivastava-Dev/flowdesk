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
    id: 'TSK-1042', title: 'Q2 Marketing campaign brief',
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
    id: 'TSK-1043', title: 'Vendor onboarding — Brightline Logistics',
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
    id: 'TSK-1044', title: 'Refund pipeline — May reconciliation',
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
    id: 'TSK-1045', title: 'Hiring loop — Senior SRE',
    description: 'Schedule on-site loop for shortlisted candidates next week.',
    assignedTo: 'U104', assignedBy: 'U011', status: 'Pending', priority: 'Medium',
    deadline: day(3), createdAt: day(-2), escalationLevel: 0,
    customFields: { Role: 'Senior SRE', Candidates: '4 shortlisted' },
    activity: [{ at: day(-2), by: 'U011', type: 'created', text: 'Task created' }],
  },
  {
    id: 'TSK-1046', title: 'Pricing page A/B test — variant C',
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
    id: 'TSK-1047', title: 'Customer churn report — April',
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
    id: 'TSK-1048', title: 'WhatsApp broadcast template approval',
    description: 'Submit the new utility template for Meta review.',
    assignedTo: 'U106', assignedBy: 'U012', status: 'Pending', priority: 'Low',
    deadline: day(2), createdAt: day(-1), escalationLevel: 0,
    customFields: { Category: 'Utility', Language: 'EN + HI' },
    activity: [{ at: day(-1), by: 'U012', type: 'created', text: 'Created' }],
  },
  {
    id: 'TSK-1049', title: 'Roll out SSO to design team',
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
    id: 'TSK-1050', title: 'Quarterly compliance audit prep',
    description: 'Compile evidence for SOC2 controls A.1–A.7 and share with auditors.',
    assignedTo: 'U010', assignedBy: 'U001', status: 'Pending', priority: 'High',
    deadline: day(5), createdAt: day(0), escalationLevel: 0,
    customFields: { Framework: 'SOC2', Auditor: 'Prescient Assurance' },
    activity: [{ at: day(0), by: 'U001', type: 'created', text: 'Created by Admin' }],
  },
  {
    id: 'TSK-1051', title: 'Investor update — May',
    description: 'Drafting key metrics and narrative for the May investor email.',
    assignedTo: 'U011', assignedBy: 'U001', status: 'Pending', priority: 'High',
    deadline: day(4), createdAt: day(-1), escalationLevel: 0,
    customFields: { Audience: 'Series B investors', Channel: 'Email' },
    activity: [{ at: day(-1), by: 'U001', type: 'created', text: 'Created by Admin' }],
  },
  {
    id: 'TSK-1052', title: 'Customer success NPS sweep',
    description: 'Run NPS for top 50 accounts and triage detractors.',
    assignedTo: 'U102', assignedBy: 'U010', status: 'Pending', priority: 'Medium',
    deadline: day(6), createdAt: day(0), escalationLevel: 0,
    customFields: { Accounts: '50', Tooling: 'Delighted' },
    activity: [{ at: day(0), by: 'U010', type: 'created', text: 'Created' }],
  },
  {
    id: 'TSK-1053', title: 'Migrate billing to v2 ledger',
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
  { id: 'N1', type: 'escalation', title: 'TSK-1044 escalated to Admin', detail: 'Refund pipeline blocked at gateway', time: '12 min ago', unread: true },
  { id: 'N2', type: 'approval',   title: 'Sneha submitted TSK-1042 for review', detail: 'Awaiting your approval', time: '36 min ago', unread: true },
  { id: 'N3', type: 'whatsapp',   title: 'Karan replied via WhatsApp', detail: '“Looking into the gateway 502s now.”', time: '1 hr ago', unread: true },
  { id: 'N4', type: 'overdue',    title: 'TSK-1047 is overdue by 1 day', detail: 'Customer churn report — April', time: '2 hrs ago', unread: false },
  { id: 'N5', type: 'system',     title: 'Daily summary sent', detail: 'Posted to #ops at 09:00', time: '6 hrs ago', unread: false },
];

// ----------------------------- Helpers -----------------------------
export const isOverdue = (task) => {
  const d = new Date(task.deadline).getTime();
  return d < Date.now() && task.status !== 'Done';
};

export const daysUntil = (iso) => {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.round(ms / (1000 * 60 * 60 * 24));
};
