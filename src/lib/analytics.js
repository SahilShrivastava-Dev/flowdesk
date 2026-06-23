// Real-data analytics helpers — derived entirely from live tasks/activity.
// No mock data, no hardcoded series.

const DAY_MS = 24 * 60 * 60 * 1000;

// Timestamp a task was closed: the latest status/approval activity, else creation.
function closedAt(task) {
  const stamps = (task.activity || [])
    .filter((a) => a.type === 'status' || a.type === 'approval')
    .map((a) => new Date(a.at).getTime())
    .filter((n) => !Number.isNaN(n));
  if (stamps.length) return Math.max(...stamps);
  return new Date(task.createdAt).getTime();
}

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Created vs closed counts per day for the last `days` days (oldest → newest).
export function weeklyActivity(tasks, days = 7) {
  const today = startOfDay(Date.now());
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today - i * DAY_MS);
    buckets.push({
      key: d.getTime(),
      day: d.toLocaleDateString('en-US', { weekday: 'short' }),
      created: 0,
      closed: 0,
    });
  }
  const indexOf = (ms) => buckets.findIndex((b) => b.key === startOfDay(ms));

  tasks.forEach((t) => {
    const ci = indexOf(new Date(t.createdAt).getTime());
    if (ci >= 0) buckets[ci].created++;
    if (t.status === 'Done') {
      const xi = indexOf(closedAt(t));
      if (xi >= 0) buckets[xi].closed++;
    }
  });
  return buckets;
}

// Flatten task activity into a recent feed (newest first).
export function recentActivity(tasks, limit = 5) {
  const items = [];
  tasks.forEach((t) => {
    (t.activity || []).forEach((a) => {
      if (!a.at) return;
      items.push({
        taskId: t.id,
        taskTitle: t.title,
        by: a.by,
        type: a.type,
        text: a.text,
        at: a.at,
      });
    });
  });
  return items
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);
}

// "just now" / "5m ago" / "3h ago" / "2d ago" / "1w ago"
export function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, (Date.now() - then) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}
