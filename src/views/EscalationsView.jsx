import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';
import Avatar from '../components/Avatar.jsx';
import { ChevronRight, ChevronDown, ChevronLeft, Calendar, Flame } from 'lucide-react';

// ─── Priority colour config ───────────────────────────────────────────────────
const PRIORITY = {
  High:   { bar: 'bg-[#EF4444]', light: 'bg-[#FEF2F2]', text: 'text-[#B91C1C]', dot: '#EF4444', border: 'border-[#FECACA]' },
  Medium: { bar: 'bg-[#F59E0B]', light: 'bg-[#FFFBEB]', text: 'text-[#92400E]', dot: '#F59E0B', border: 'border-[#FDE68A]' },
  Low:    { bar: 'bg-[#22C55E]', light: 'bg-[#F0FDF4]', text: 'text-[#166534]', dot: '#22C55E', border: 'border-[#BBF7D0]' },
};

const STATUS_OPACITY = { Done: 'opacity-40', Pending: 'opacity-90', Issue: 'opacity-100', Delay: 'opacity-80' };

// ─── Helpers ─────────────────────────────────────────────────────────────────
function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }

// clamp a date within [lo, hi], return null if fully outside
function clampBar(createdAt, deadline, viewStart, viewEnd) {
  const s = Math.max(startOfDay(createdAt).getTime(), viewStart.getTime());
  const e = Math.min(startOfDay(deadline).getTime(),  viewEnd.getTime());
  if (s > e) return null;
  return { s, e };
}

function pct(ts, viewStart, totalMs) {
  return ((ts - viewStart.getTime()) / totalMs) * 100;
}


// ─── Single Gantt bar ─────────────────────────────────────────────────────────
// No hover tooltip — clicking opens the task detail modal directly.
// The bar fills its wrapper div (which is sized and positioned by the parent row).
function GanttBar({ task, viewStart, viewEnd, totalMs, onOpen }) {
  const clamped = clampBar(task.createdAt, task.deadline, viewStart, viewEnd);
  if (!clamped) return null;

  const left  = pct(clamped.s, viewStart, totalMs);
  const right = pct(clamped.e + 86400000, viewStart, totalMs);
  const width = Math.max(right - left, 0.5);
  const p     = PRIORITY[task.priority] || PRIORITY.Medium;
  const op    = STATUS_OPACITY[task.status] || 'opacity-90';

  return (
    <div
      title={`${task.title} · ${task.priority} · ${task.status}`}
      className={`absolute inset-y-0 rounded-full cursor-pointer
                  flex items-center px-2 select-none
                  hover:brightness-110 hover:shadow-md transition-all duration-100`}
      style={{ left: `${left}%`, width: `${width}%` }}
      onClick={() => onOpen && onOpen(task)}
    >
      <div className={`absolute inset-0 rounded-full ${p.bar} ${op}`} />
      <span className="relative z-10 text-white text-[10px] font-semibold truncate leading-none">
        {task.title}
      </span>
    </div>
  );
}

// ─── Left panel — person row ──────────────────────────────────────────────────
function PersonRow({ user, depth, selected, onToggle, taskCount }) {
  const indent = depth * 20;
  return (
    <button
      onClick={() => onToggle(user.id)}
      className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors rounded-lg
                  ${selected
                    ? 'bg-[#EDE9FE] text-[#6D28D9]'
                    : 'hover:bg-[#F9FAFB] text-[#374151]'}`}
      style={{ paddingLeft: `${12 + indent}px` }}
    >
      <Avatar user={user} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold truncate">{user.name}</p>
        <p className={`text-[10px] ${selected ? 'text-[#7C3AED]' : 'text-[#9CA3AF]'}`}>
          {user.role} · {taskCount} task{taskCount !== 1 ? 's' : ''}
        </p>
      </div>
      <div
        className={`w-4 h-4 rounded-full shrink-0 ${selected ? 'bg-[#7C3AED]' : 'bg-[#E5E7EB]'}`}
      />
    </button>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────
export default function EscalationsView({ onOpenTask }) {
  const { users, tasks, role, activeUser } = useApp();
  const today = new Date();


  // Month navigation
  const [viewYear,  setViewYear]  = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  // Which user IDs are visible on the timeline
  const [selectedIds, setSelectedIds] = useState(new Set());
  // Which manager rows are expanded in the left panel
  const [expandedMgr, setExpandedMgr] = useState(new Set());
  // Filter Gantt bars to escalated tasks only
  const [escalatedOnly, setEscalatedOnly] = useState(false);

  // Build hierarchy
  const managers   = useMemo(() => users.filter(u => u.role === 'Manager' || u.role === 'Admin'), [users]);
  const reportMap  = useMemo(() => {
    const m = {};
    users.forEach(u => {
      const mgr = u.reportingTo ?? u.reportingToId;
      if (mgr) { if (!m[mgr]) m[mgr] = []; m[mgr].push(u); }
    });
    return m;
  }, [users]);

  // Task lookup by assignee
  const tasksByUser = useMemo(() => {
    const m = {};
    tasks.forEach(t => {
      if (!m[t.assignedTo]) m[t.assignedTo] = [];
      m[t.assignedTo].push(t);
    });
    return m;
  }, [tasks]);

  // Calendar bounds
  const days       = daysInMonth(viewYear, viewMonth);
  const viewStart  = new Date(viewYear, viewMonth, 1);
  const viewEnd    = new Date(viewYear, viewMonth, days);
  viewEnd.setHours(23, 59, 59, 999);
  const totalMs    = viewEnd.getTime() - viewStart.getTime() + 1;

  // Today's marker position
  const todayPct = today >= viewStart && today <= viewEnd
    ? pct(today.getTime(), viewStart, totalMs)
    : null;

  // All user IDs flattened
  const allUserIds = useMemo(() => users.map(u => u.id), [users]);

  const allSelected = allUserIds.length > 0 && allUserIds.every(id => selectedIds.has(id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allUserIds));
      // Expand all managers so the left panel reflects the selection
      setExpandedMgr(new Set(managers.map(m => m.id)));
    }
  };

  // Toggle individual user. If it's a manager, also toggle all their direct reports.
  const toggleUser = (id) => {
    const reports = reportMap[id] ?? [];
    const isMgr   = reports.length > 0;

    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        // Deselect this user + all their reports
        next.delete(id);
        if (isMgr) reports.forEach(r => next.delete(r.id));
      } else {
        // Select this user + all their reports, and expand the manager row
        next.add(id);
        if (isMgr) {
          reports.forEach(r => next.add(r.id));
          setExpandedMgr(prev2 => new Set([...prev2, id]));
        }
      }
      return next;
    });
  };

  // Toggle manager expand/collapse (chevron only — separate from selection)
  const toggleMgr = (id) => {
    setExpandedMgr(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Rows to show on timeline = selected users with tasks in this month
  const timelineRows = useMemo(() => {
    return users
      .filter(u => selectedIds.has(u.id))
      .map(u => ({
        user: u,
        tasks: (tasksByUser[u.id] ?? []).filter(t => {
          const s = new Date(t.createdAt);
          const e = new Date(t.deadline);
          const inRange = e >= viewStart && s <= viewEnd;
          if (!inRange) return false;
          if (escalatedOnly && !(t.escalationLevel > 0)) return false;
          return true;
        }),
      }))
      .filter(r => r.tasks.length > 0);
  }, [selectedIds, users, tasksByUser, viewStart, viewEnd, escalatedOnly]);

  const monthLabel = new Date(viewYear, viewMonth, 1)
    .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const selectedCount = selectedIds.size;

  return (
    <div className="flex gap-0 h-[calc(100vh-120px)] min-h-[600px]">

      {/* ── Left Panel ──────────────────────────────────────────────────── */}
      <div className="w-64 shrink-0 flex flex-col border-r border-[#E5E7EB] bg-white rounded-l-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E5E7EB]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#9CA3AF]">Timeline</p>
              <p className="text-sm font-semibold text-[#111827] mt-0.5">Select people to view</p>
            </div>
            <button
              onClick={toggleAll}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors shrink-0
                ${allSelected
                  ? 'bg-[#EDE9FE] text-[#6D28D9] hover:bg-[#DDD6FE]'
                  : 'bg-[#F3F4F6] text-[#374151] hover:bg-[#E5E7EB]'}`}
            >
              {allSelected ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          {selectedCount > 0 && (
            <p className="text-[11px] text-[#7C3AED] mt-1.5">
              {selectedCount} of {allUserIds.length} selected
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2 thin-scrollbar">
          {managers.map(mgr => {
            const reports   = reportMap[mgr.id] ?? [];
            const expanded  = expandedMgr.has(mgr.id);
            const mgrTasks  = (tasksByUser[mgr.id] ?? []).length;

            return (
              <div key={mgr.id}>
                {/* Manager row */}
                <div className="flex items-center gap-1">
                  {reports.length > 0 ? (
                    <button
                      onClick={() => toggleMgr(mgr.id)}
                      className="p-0.5 rounded text-[#6B7280] hover:text-[#111827] hover:bg-[#F3F4F6] shrink-0"
                    >
                      {expanded
                        ? <ChevronDown className="h-3.5 w-3.5" />
                        : <ChevronRight className="h-3.5 w-3.5" />}
                    </button>
                  ) : (
                    <div className="w-5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <PersonRow
                      user={mgr}
                      depth={0}
                      selected={selectedIds.has(mgr.id)}
                      onToggle={toggleUser}
                      taskCount={mgrTasks}
                    />
                  </div>
                </div>

                {/* Reports (employees) — shown when manager is expanded */}
                {expanded && reports.map(emp => (
                  <div key={emp.id} className="flex items-center gap-1 ml-4">
                    <div className="w-5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <PersonRow
                        user={emp}
                        depth={1}
                        selected={selectedIds.has(emp.id)}
                        onToggle={toggleUser}
                        taskCount={(tasksByUser[emp.id] ?? []).length}
                      />
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="px-4 py-3 border-t border-[#E5E7EB] space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#9CA3AF]">Priority</p>
          {Object.entries(PRIORITY).map(([label, cfg]) => (
            <div key={label} className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${cfg.bar}`} />
              <span className="text-[11px] text-[#6B7280]">{label}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 mt-1">
            <span className="w-3 h-0.5 bg-[#6366F1] rounded" style={{ borderTop: '2px dashed #6366F1', background: 'none' }} />
            <span className="text-[11px] text-[#6B7280]">Today</span>
          </div>
        </div>
      </div>

      {/* ── Right Panel — Gantt ──────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col bg-white rounded-r-2xl overflow-hidden border border-[#E5E7EB] border-l-0">

        {/* Month nav header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#E5E7EB] shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={prevMonth}
              className="w-8 h-8 rounded-full flex items-center justify-center text-[#6B7280]
                         hover:bg-[#F3F4F6] transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <h2 className="text-base font-bold text-[#111827] w-40 text-center">{monthLabel}</h2>
            <button
              onClick={nextMonth}
              className="w-8 h-8 rounded-full flex items-center justify-center text-[#6B7280]
                         hover:bg-[#F3F4F6] transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => { setViewMonth(today.getMonth()); setViewYear(today.getFullYear()); }}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#E5E7EB]
                         text-[#374151] hover:bg-[#F3F4F6] transition-colors"
            >
              Today
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setEscalatedOnly(v => !v)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                escalatedOnly
                  ? 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
                  : 'bg-white border-[#E5E7EB] text-[#6B7280] hover:bg-[#F9FAFB]'
              }`}
            >
              <Flame className="h-3.5 w-3.5" />
              Escalated only
            </button>
            <div className="flex items-center gap-2 text-xs text-[#9CA3AF]">
              <Calendar className="h-3.5 w-3.5" />
              {timelineRows.length > 0
                ? `${timelineRows.length} people · ${timelineRows.reduce((a, r) => a + r.tasks.length, 0)} tasks`
                : 'Select people from the left panel'}
            </div>
          </div>
        </div>

        {/* Day header */}
        <div className="flex border-b border-[#E5E7EB] shrink-0 bg-[#F9FAFB]">
          <div className="w-40 shrink-0 border-r border-[#E5E7EB]" />
          <div className="flex-1 relative flex">
            {Array.from({ length: days }, (_, i) => {
              const d    = new Date(viewYear, viewMonth, i + 1);
              const isWk = d.getDay() === 0 || d.getDay() === 6;
              const isTd = d.toDateString() === today.toDateString();
              return (
                <div
                  key={i}
                  className={`flex-1 text-center py-1.5 text-[10px] font-semibold border-r border-[#F3F4F6] last:border-r-0
                              ${isWk ? 'text-[#9CA3AF] bg-[#F9FAFB]' : 'text-[#6B7280]'}
                              ${isTd ? 'text-[#6366F1] font-bold' : ''}`}
                >
                  {i + 1}
                </div>
              );
            })}
          </div>
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto thin-scrollbar">
          {timelineRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-[#9CA3AF]">
              <Calendar className="h-10 w-10 opacity-30" />
              <p className="text-sm font-medium">Select a manager or employee from the left panel</p>
              <p className="text-xs">Their tasks will appear here as coloured bars</p>
            </div>
          ) : (
            timelineRows.map(({ user, tasks: rowTasks }) => {
              // Dynamic row height: 8px top padding + each bar is 24px + 4px gap
              const BAR_H   = 24;
              const BAR_GAP = 4;
              const rowH    = Math.max(44, 8 + rowTasks.length * (BAR_H + BAR_GAP));

              return (
                <div
                  key={user.id}
                  className="flex border-b border-[#F3F4F6] last:border-b-0 hover:bg-[#FAFBFF] transition-colors"
                  style={{ height: `${rowH}px` }}
                >
                  {/* Person label — vertically centred */}
                  <div className="w-40 shrink-0 border-r border-[#F3F4F6] flex items-center gap-2 px-3">
                    <Avatar user={user} size="sm" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#111827] truncate">{user.name}</p>
                      <p className="text-[10px] text-[#9CA3AF] truncate">
                        {rowTasks.length} task{rowTasks.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>

                  {/* Gantt area — overflow visible so bars are never clipped */}
                  <div className="flex-1 relative overflow-visible">
                    {/* Weekend shading */}
                    {Array.from({ length: days }, (_, i) => {
                      const d  = new Date(viewYear, viewMonth, i + 1);
                      const wk = d.getDay() === 0 || d.getDay() === 6;
                      return wk ? (
                        <div
                          key={i}
                          className="absolute inset-y-0 bg-[#F9FAFB]"
                          style={{ left: `${(i / days) * 100}%`, width: `${(1 / days) * 100}%` }}
                        />
                      ) : null;
                    })}

                    {/* Day grid lines */}
                    {Array.from({ length: days }, (_, i) => (
                      <div
                        key={i}
                        className="absolute inset-y-0 border-r border-[#F3F4F6]"
                        style={{ left: `${((i + 1) / days) * 100}%` }}
                      />
                    ))}

                    {/* Today line */}
                    {todayPct !== null && (
                      <div
                        className="absolute inset-y-0 w-px bg-[#6366F1] z-10"
                        style={{ left: `${todayPct}%` }}
                      />
                    )}

                    {/* Task bars — each gets its own absolutely-positioned lane */}
                    {rowTasks.map((task, ti) => (
                      <div
                        key={task.id}
                        className="absolute left-0 right-0"
                        style={{
                          top:    `${8 + ti * (BAR_H + BAR_GAP)}px`,
                          height: `${BAR_H}px`,
                        }}
                      >
                        <GanttBar
                          task={task}
                          viewStart={viewStart}
                          viewEnd={viewEnd}
                          totalMs={totalMs}
                          onOpen={onOpenTask}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
