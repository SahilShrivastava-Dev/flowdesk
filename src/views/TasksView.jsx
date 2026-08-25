import React, { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import TaskTable from '../components/TaskTable.jsx';
import { useApp } from '../context/AppContext.jsx';
import { directReports, TASK_KINDS } from '../data/mockData.js';

export default function TasksView({ onOpenTask, onCreateTask }) {
  const { tasks, role, activeUser } = useApp();

  // Which kind of work. `internal` is the default on every task, including
  // every task that existed before outreach did, so "All" and "Internal" are
  // the same list until somebody raises their first sample or payment task.
  const [kind, setKind] = useState('all');

  const scoped = useMemo(() => {
    if (role === 'Employee') return tasks.filter((t) => t.assignedTo === activeUser.id);
    if (role === 'Manager') {
      const teamIds = directReports(activeUser.id).map((u) => u.id);
      return tasks.filter((t) => teamIds.includes(t.assignedTo));
    }
    return tasks;
  }, [tasks, role, activeUser.id]);

  const list = useMemo(
    () => (kind === 'all' ? scoped : scoped.filter((t) => (t.kind ?? 'internal') === kind)),
    [scoped, kind],
  );

  // Only shown once there is something to filter. A row of chips that all read
  // "0" is noise on a deployment that never uses outreach.
  const kindCounts = useMemo(() => {
    const counts = {};
    for (const t of scoped) {
      const k = t.kind ?? 'internal';
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return counts;
  }, [scoped]);

  const hasOutreach = TASK_KINDS.some((k) => k.id !== 'internal' && kindCounts[k.id] > 0);

  const heading = role === 'Employee' ? 'My Assignments' : role === 'Manager' ? 'Team Tasks' : 'All tasks';
  const subtitle =
    role === 'Employee'
      ? 'Tasks assigned to you — filter, sort, and update status.'
      : role === 'Manager'
      ? 'Tasks across your team — filter, sort, click any row to inspect or reassign.'
      : 'Filter, sort, and click any row to inspect details, escalate, or reassign.';

  const done       = list.filter((t) => t.status === 'Done').length;
  const submitted  = list.filter((t) => t.status === 'Submitted').length;
  const pending    = list.filter((t) => t.status === 'Pending').length;
  const inProgress = list.filter((t) => t.status === 'InProgress').length;
  const delayed   = list.filter((t) => t.status === 'Delay').length;
  const issues    = list.filter((t) => t.status === 'Issue').length;
  const escalated = list.filter((t) => (t.escalationLevel ?? 0) > 0).length;

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#9CA3AF]">Tasks</p>
          <h2 className="text-xl font-bold text-[#111827] mt-0.5">{heading}</h2>
          <p className="text-sm text-[#6B7280] mt-0.5">{subtitle}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="inline-flex items-center px-3 py-1 rounded-full bg-[#F3F4F6] text-xs font-semibold text-[#374151]">
            {list.length} total
          </span>
          {/* Employees can't create tasks, so the button would only ever 403. */}
          {role !== 'Employee' && onCreateTask && (
            <button onClick={onCreateTask} className="fd-btn-primary">
              <Plus size={14} /> New Task
            </button>
          )}
        </div>
      </div>

      {/* Quick-stat pills */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: 'Done',        value: done,       bg: '#DCFCE7', text: '#166534' },
          { label: 'Submitted',   value: submitted,  bg: '#FFF7ED', text: '#C2410C' },
          { label: 'In Progress', value: inProgress, bg: '#EDE9FE', text: '#6D28D9' },
          { label: 'Pending',     value: pending,    bg: '#EFF6FF', text: '#1D4ED8' },
          { label: 'Delayed',   value: delayed,   bg: '#FFFBEB', text: '#B45309' },
          { label: 'Issues',    value: issues,    bg: '#FEF2F2', text: '#B91C1C' },
          { label: 'Escalated', value: escalated, bg: '#FEE2E2', text: '#991B1B' },
        ].map(({ label, value, bg, text }) => (
          <span
            key={label}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
            style={{ background: bg, color: text }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: text }}
            />
            {label}: {value}
          </span>
        ))}
      </div>

      {hasOutreach && (
        <div className="flex gap-1 flex-wrap">
          <KindChip active={kind === 'all'} onClick={() => setKind('all')} count={scoped.length}>
            All
          </KindChip>
          {TASK_KINDS.filter((k) => kindCounts[k.id] > 0).map((k) => (
            <KindChip
              key={k.id}
              active={kind === k.id}
              onClick={() => setKind(k.id)}
              count={kindCounts[k.id]}
            >
              {k.label}
            </KindChip>
          ))}
        </div>
      )}

      {/* Table with built-in filter row */}
      <TaskTable tasks={list} onOpen={onOpenTask} />
    </div>
  );
}

function KindChip({ active, onClick, count, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
        active ? 'bg-[#1E1B3A] text-white' : 'bg-white border border-[#E5E7EB] text-[#374151] hover:bg-gray-50'
      }`}
    >
      {children}
      <span className={`num ml-1.5 ${active ? 'text-white/70' : 'text-[#9CA3AF]'}`}>{count}</span>
    </button>
  );
}
