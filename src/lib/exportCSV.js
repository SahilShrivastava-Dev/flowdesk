/**
 * exportTasksCSV
 * Converts a filtered task list to a downloadable CSV file.
 * Designed for non-technical users — column names are plain English,
 * dates are human-readable, and custom fields are inlined as "Key: Value" pairs.
 */
import { findUser } from '../data/mockData.js';

// Escape a cell value: wrap in quotes if it contains commas, quotes, or newlines
function cell(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function daysRemaining(deadline) {
  if (!deadline) return '';
  const diff = Math.round((new Date(deadline) - new Date()) / 86_400_000);
  return diff;
}

function formatCustomFields(obj) {
  if (!obj || typeof obj !== 'object') return '';
  return Object.entries(obj)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' | ');
}

const COLUMNS = [
  'Task ID',
  'Title',
  'Description',
  'Assigned To',
  'Assigned By',
  'Manager',
  'Status',
  'Priority',
  'Created On',
  'Deadline',
  'Days Remaining',
  'Overdue',
  'Escalation Level',
  'Approved',
  'Custom Fields',
];

export function exportTasksCSV(tasks, filename = 'flowdesk-tasks') {
  const rows = [
    COLUMNS.join(','),
    ...tasks.map((t) => {
      const assignee = findUser(t.assignedTo);
      const assigner = findUser(t.assignedBy);
      const manager  = findUser(assignee?.reportingTo ?? assignee?.reportingToId);

      const days    = daysRemaining(t.deadline);
      const overdue = typeof days === 'number' && days < 0 ? 'Yes' : 'No';

      return [
        cell(t.id),
        cell(t.title),
        cell(t.description ?? ''),
        cell(assignee?.name ?? t.assignedTo ?? ''),
        cell(assigner?.name ?? t.assignedBy ?? ''),
        cell(manager?.name ?? ''),
        cell(t.status),
        cell(t.priority),
        cell(formatDate(t.createdAt)),
        cell(formatDate(t.deadline)),
        cell(typeof days === 'number' ? (days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `${days}d`) : ''),
        cell(overdue),
        cell(t.escalationLevel ?? 0),
        cell(t.approved ? 'Yes' : 'No'),
        cell(formatCustomFields(t.customFields)),
      ].join(',');
    }),
  ];

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  a.href     = url;
  a.download = `${filename}-${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
