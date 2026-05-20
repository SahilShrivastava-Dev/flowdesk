import React, { useMemo, useState } from 'react';
import { ArrowUpDown, ChevronUp, ChevronDown, Filter, Flame } from 'lucide-react';
import { findUser, isOverdue, daysUntil } from '../data/mockData.js';
import StatusBadge, { PriorityBadge } from './StatusBadge.jsx';
import Avatar from './Avatar.jsx';
import { useApp } from '../context/AppContext.jsx';

function DeadlineCell({ task }) {
  const overdue = isOverdue(task);
  const d = daysUntil(task.deadline);
  const date = new Date(task.deadline).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  return (
    <div className="leading-tight">
      <p className={`text-sm font-semibold ${overdue ? 'text-[#B91C1C]' : 'text-[#111827]'}`}>{date}</p>
      <p className={`text-xs mt-0.5 ${overdue ? 'text-[#B91C1C]' : 'text-[#9CA3AF]'}`}>
        {overdue ? `${Math.abs(d)}d overdue` : d === 0 ? 'Due today' : `in ${d}d`}
      </p>
    </div>
  );
}

function EscBadge({ level }) {
  if (!level || level === 0)
    return <span className="chip bg-[#F3F4F6] text-[#6B7280]">L0</span>;
  if (level === 1)
    return <span className="chip bg-[#FEF2F2] text-[#DC2626]">L1</span>;
  if (level === 2)
    return <span className="chip bg-[#FEE2E2] text-[#991B1B] font-bold">L2</span>;
  // L3+
  return <span className="chip bg-[#7F1D1D] text-white font-bold">L{level}</span>;
}

function SortHeader({ label, dir, onClick }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 hover:text-[#111827] transition-colors"
    >
      {label}
      {dir === 'asc'
        ? <ChevronUp className="h-3 w-3" />
        : dir === 'desc'
          ? <ChevronDown className="h-3 w-3" />
          : <ArrowUpDown className="h-3 w-3 opacity-50" />}
    </button>
  );
}

const STATUS_FILTERS = ['All', 'Pending', 'Done', 'Delay', 'Issue'];

export default function TaskTable({ tasks, onOpen, emptyText = 'No tasks match your filters.', dense = false }) {
  const { search } = useApp();
  const [statusFilter, setStatusFilter] = useState('All');
  const [sort, setSort] = useState({ key: 'deadline', dir: 'asc' });

  const filtered = useMemo(() => {
    let list = tasks;
    if (statusFilter !== 'All') list = list.filter((t) => t.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q) ||
          (findUser(t.assignedTo)?.name || '').toLowerCase().includes(q)
      );
    }
    const { key, dir } = sort;
    list = [...list].sort((a, b) => {
      let av = a[key], bv = b[key];
      if (key === 'assignedTo') { av = findUser(av)?.name || ''; bv = findUser(bv)?.name || ''; }
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [tasks, statusFilter, search, sort]);

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const dirFor = (k) => (sort.key === k ? sort.dir : null);

  return (
    <div className="fd-card overflow-hidden">
      {/* Filter row */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[#E5E7EB]">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-3.5 w-3.5 text-[#9CA3AF]" />
          <span className="text-xs font-medium text-[#6B7280]">Filter</span>
          <div className="flex flex-wrap gap-1.5 ml-1">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`text-xs font-medium rounded-full px-3 py-1 transition-colors ${
                  statusFilter === s
                    ? 'bg-[#1E1B3A] text-white'
                    : 'border border-[#E5E7EB] text-[#6B7280] hover:bg-gray-50 bg-white'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-[#9CA3AF]">{filtered.length} of {tasks.length}</p>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="fd-table-head">
                <SortHeader label="Task" dir={dirFor('title')} onClick={() => toggleSort('title')} />
              </th>
              <th className="fd-table-head">
                <SortHeader label="Assignee" dir={dirFor('assignedTo')} onClick={() => toggleSort('assignedTo')} />
              </th>
              <th className="fd-table-head">
                <SortHeader label="Status" dir={dirFor('status')} onClick={() => toggleSort('status')} />
              </th>
              <th className="fd-table-head">
                <SortHeader label="Priority" dir={dirFor('priority')} onClick={() => toggleSort('priority')} />
              </th>
              <th className="fd-table-head">
                <SortHeader label="Deadline" dir={dirFor('deadline')} onClick={() => toggleSort('deadline')} />
              </th>
              <th className="fd-table-head text-right">Esc.</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-[#9CA3AF]">
                  {emptyText}
                </td>
              </tr>
            )}
            {filtered.map((t) => {
              const assignee = findUser(t.assignedTo);
              const overdue  = isOverdue(t);
              return (
                <tr
                  key={t.id}
                  onClick={() => onOpen?.(t)}
                  className="fd-row-hover"
                >
                  {/* Task */}
                  <td className={`fd-table-cell ${dense ? 'py-2' : ''}`}>
                    <div className="flex items-start gap-2">
                      <div>
                        <p className="font-semibold text-[#111827]">{t.title}</p>
                        <p className="num text-[11px] text-[#9CA3AF] mt-0.5">{t.id}</p>
                      </div>
                      {overdue && <Flame className="h-3.5 w-3.5 text-[#DC2626] mt-0.5 shrink-0" />}
                    </div>
                  </td>

                  {/* Assignee */}
                  <td className="fd-table-cell">
                    <div className="flex items-center gap-2">
                      <Avatar user={assignee} size="sm" />
                      <span className="font-medium text-[#374151]">{assignee?.name}</span>
                    </div>
                  </td>

                  {/* Status */}
                  <td className="fd-table-cell">
                    <StatusBadge status={t.status} />
                  </td>

                  {/* Priority */}
                  <td className="fd-table-cell">
                    <PriorityBadge priority={t.priority} />
                  </td>

                  {/* Deadline */}
                  <td className="fd-table-cell">
                    <DeadlineCell task={t} />
                  </td>

                  {/* Escalation */}
                  <td className="fd-table-cell text-right">
                    <EscBadge level={t.escalationLevel || 0} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
