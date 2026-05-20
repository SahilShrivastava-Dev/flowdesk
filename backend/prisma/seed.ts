import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = 'flowdesk123';

// Mirror of src/data/mockData.js
const today = new Date('2026-05-03T09:00:00');
function day(offset: number): Date {
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  return d;
}

const USERS = [
  { id: 'U001', name: 'Aarav Mehta',  email: 'aarav@flowdesk.io',  role: 'Admin'    as const, reportingToId: null,   avatar: 'AM', color: 'from-fuchsia-500 to-purple-600' },
  { id: 'U010', name: 'Priya Sharma', email: 'priya@flowdesk.io',  role: 'Manager'  as const, reportingToId: 'U001', avatar: 'PS', color: 'from-rose-500 to-orange-500' },
  { id: 'U011', name: 'Rahul Verma',  email: 'rahul@flowdesk.io',  role: 'Manager'  as const, reportingToId: 'U001', avatar: 'RV', color: 'from-sky-500 to-indigo-500' },
  { id: 'U012', name: 'Neha Iyer',    email: 'neha@flowdesk.io',   role: 'Manager'  as const, reportingToId: 'U001', avatar: 'NI', color: 'from-emerald-500 to-teal-500' },
  { id: 'U101', name: 'Karan Singh',  email: 'karan@flowdesk.io',  role: 'Employee' as const, reportingToId: 'U010', avatar: 'KS', color: 'from-amber-500 to-rose-500' },
  { id: 'U102', name: 'Sneha Pillai', email: 'sneha@flowdesk.io',  role: 'Employee' as const, reportingToId: 'U010', avatar: 'SP', color: 'from-pink-500 to-fuchsia-500' },
  { id: 'U103', name: 'Vikram Rao',   email: 'vikram@flowdesk.io', role: 'Employee' as const, reportingToId: 'U010', avatar: 'VR', color: 'from-blue-500 to-cyan-500' },
  { id: 'U104', name: 'Aditi Nair',   email: 'aditi@flowdesk.io',  role: 'Employee' as const, reportingToId: 'U011', avatar: 'AN', color: 'from-violet-500 to-indigo-500' },
  { id: 'U105', name: 'Rohan Das',    email: 'rohan@flowdesk.io',  role: 'Employee' as const, reportingToId: 'U011', avatar: 'RD', color: 'from-lime-500 to-emerald-500' },
  { id: 'U106', name: 'Maya Kapoor',  email: 'maya@flowdesk.io',   role: 'Employee' as const, reportingToId: 'U012', avatar: 'MK', color: 'from-rose-400 to-pink-500' },
  { id: 'U107', name: 'Imran Sheikh', email: 'imran@flowdesk.io',  role: 'Employee' as const, reportingToId: 'U012', avatar: 'IS', color: 'from-cyan-500 to-blue-600' },
];

type ActivityEntry = { at: Date; by: string; type: string; text: string };

const TASKS: {
  id: string; title: string; description: string;
  assignedTo: string; assignedBy: string;
  status: 'Pending' | 'Done' | 'Issue' | 'Delay';
  priority: 'Low' | 'Medium' | 'High';
  deadline: Date; createdAt: Date; escalationLevel: number;
  customFields: Record<string, string>;
  activity: ActivityEntry[];
}[] = [
  {
    id: 'TSK-1042', title: 'Q2 Marketing campaign brief',
    description: 'Draft the campaign positioning, target personas, and channel mix for the Q2 product launch.',
    assignedTo: 'U102', assignedBy: 'U010', status: 'Pending', priority: 'High',
    deadline: day(-2), createdAt: day(-7), escalationLevel: 1,
    customFields: { Channel: 'WhatsApp + Email', Budget: '₹4,50,000', Region: 'IN-South' },
    activity: [
      { at: day(-7), by: 'U010', type: 'created',   text: 'Task created and assigned' },
      { at: day(-5), by: 'U102', type: 'comment',   text: 'Pulling positioning doc from last quarter.' },
      { at: day(-1), by: 'U001', type: 'escalation',text: 'Auto-escalated: deadline missed.' },
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
      { at: day(-2), by: 'U103', type: 'status',  text: 'Marked as Done via WhatsApp' },
    ],
  },
  {
    id: 'TSK-1044', title: 'Refund pipeline — May reconciliation',
    description: 'Reconcile failed refunds and issue manual settlements where required.',
    assignedTo: 'U101', assignedBy: 'U010', status: 'Issue', priority: 'High',
    deadline: day(0), createdAt: day(-5), escalationLevel: 2,
    customFields: { Volume: '184 cases', Tooling: 'Razorpay + Internal' },
    activity: [
      { at: day(-5), by: 'U010', type: 'created',   text: 'Assigned during stand-up' },
      { at: day(-1), by: 'U101', type: 'comment',   text: 'Blocked: gateway returns 502 on bulk fetch.' },
      { at: day(0),  by: 'U001', type: 'escalation',text: 'Escalated to Admin' },
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
      { at: day(-3),  by: 'U105', type: 'status',  text: 'Marked as Done via WhatsApp' },
    ],
  },
  {
    id: 'TSK-1047', title: 'Customer churn report — April',
    description: 'Pull cohort retention and write the executive summary.',
    assignedTo: 'U104', assignedBy: 'U011', status: 'Delay', priority: 'High',
    deadline: day(-1), createdAt: day(-6), escalationLevel: 1,
    customFields: { Cohort: '2025-Q4', Tooling: 'Looker' },
    activity: [
      { at: day(-6), by: 'U011', type: 'created',   text: 'Created' },
      { at: day(-1), by: 'U001', type: 'escalation',text: 'Escalated to manager' },
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
      { at: day(-2), by: 'U107', type: 'status',  text: 'Marked as Done — awaiting approval' },
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
      { at: day(-4),  by: 'U105', type: 'status',  text: 'Marked Done via WhatsApp' },
    ],
  },
];

async function main(): Promise<void> {
  console.log('Seeding…');
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  // Upsert users (no foreign key deps for Admin, then others)
  for (const u of USERS) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: {},
      create: {
        id: u.id,
        name: u.name,
        email: u.email,
        passwordHash: hash,
        role: u.role,
        reportingToId: u.reportingToId,
        avatar: u.avatar,
        color: u.color,
      },
    });
  }
  console.log(`  ✓ ${USERS.length} users`);

  // Upsert tasks + activities
  for (const t of TASKS) {
    await prisma.task.upsert({
      where: { id: t.id },
      update: {},
      create: {
        id: t.id,
        title: t.title,
        description: t.description,
        assignedToId: t.assignedTo,
        assignedById: t.assignedBy,
        status: t.status,
        priority: t.priority,
        deadline: t.deadline,
        createdAt: t.createdAt,
        escalationLevel: t.escalationLevel,
        customFields: t.customFields,
        activities: {
          create: t.activity.map((a) => ({
            byId: a.by === 'system' ? t.assignedBy : a.by,
            type: a.type,
            text: a.text,
            createdAt: a.at,
          })),
        },
      },
    });
  }
  console.log(`  ✓ ${TASKS.length} tasks`);
  console.log('\nAll users login with password: ' + DEFAULT_PASSWORD);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
