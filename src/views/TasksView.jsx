import React, { useMemo } from 'react';
import TaskTable from '../components/TaskTable.jsx';
import { useApp } from '../context/AppContext.jsx';
import { directReports } from '../data/mockData.js';

export default function TasksView({ onOpenTask }) {
  const { tasks, role, activeUser } = useApp();

  const list = useMemo(() => {
    if (role === 'Employee') return tasks.filter((t) => t.assignedTo === activeUser.id);
    if (role === 'Manager') {
      const teamIds = directReports(activeUser.id).map((u) => u.id);
      return tasks.filter((t) => teamIds.includes(t.assignedTo));
    }
    return tasks;
  }, [tasks, role, activeUser.id]);

  const heading = role === 'Employee' ? 'My Assignments' : role === 'Manager' ? 'Team Tasks' : 'All tasks';
  const subtitle =
    role === 'Employee'
      ? 'Tasks assigned to you — filter, sort, and update status.'
      : role === 'Manager'
      ? 'Tasks across your team — filter, sort, click any row to inspect or reassign.'
      : 'Filter, sort, and click any row to inspect details, escalate, or reassign.';

  const done    = list.filter((t) => t.status === 'Done').length;
  const pending = list.filter((t) => t.status === 'Pending').length;
  const delayed = list.filter((t) => t.status === 'Delay').length;
  const issues  = list.filter((t) => t.status === 'Issue').length;

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#9CA3AF]">Tasks</p>
          <h2 className="text-xl font-bold text-[#111827] mt-0.5">{heading}</h2>
          <p className="text-sm text-[#6B7280] mt-0.5">{subtitle}</p>
        </div>
        <span className="inline-flex items-center px-3 py-1 rounded-full bg-[#F3F4F6] text-xs font-semibold text-[#374151]">
          {list.length} total
        </span>
      </div>

      {/* Quick-stat pills */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: 'Done',    value: done,    bg: '#DCFCE7', text: '#166534' },
          { label: 'Pending', value: pending, bg: '#EFF6FF', text: '#1D4ED8' },
          { label: 'Delayed', value: delayed, bg: '#FFFBEB', text: '#B45309' },
          { label: 'Issues',  value: issues,  bg: '#FEF2F2', text: '#B91C1C' },
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

      {/* Table with built-in filter row */}
      <TaskTable tasks={list} onOpen={onOpenTask} />
    </div>
  );
}
