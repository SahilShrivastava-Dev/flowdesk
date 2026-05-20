import React, { useMemo } from 'react';
import { useApp } from '../context/AppContext.jsx';
import TaskTable from '../components/TaskTable.jsx';
import { isOverdue } from '../data/mockData.js';
import { AlertTriangle, Clock, TrendingUp } from 'lucide-react';

export default function EscalationsView({ onOpenTask }) {
  const { tasks } = useApp();

  const escalated = useMemo(() => tasks.filter((t) => t.escalationLevel > 0), [tasks]);
  const overdue   = useMemo(() => tasks.filter(isOverdue), [tasks]);
  const l2Plus    = useMemo(() => escalated.filter((t) => t.escalationLevel >= 2), [escalated]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#9CA3AF]">Escalations</p>
          <h2 className="text-xl font-bold text-[#111827] mt-0.5">Active escalations</h2>
          <p className="text-sm text-[#6B7280] mt-0.5 max-w-xl">
            Tasks past deadline auto-escalate to the assignee's reporting manager.
            Managers can escalate further to Admin.
          </p>
        </div>
        <span className="inline-flex items-center px-3 py-1 rounded-full bg-[#FEF2F2] text-sm font-semibold text-[#B91C1C] border border-[#FECACA] shrink-0">
          {escalated.length} active
        </span>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="fd-card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#FEF2F2] flex items-center justify-center shrink-0">
            <AlertTriangle className="h-4 w-4 text-[#DC2626]" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Escalated</p>
            <p className="text-2xl font-bold text-[#111827] leading-none mt-0.5">{escalated.length}</p>
          </div>
        </div>
        <div className="fd-card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#FFFBEB] flex items-center justify-center shrink-0">
            <Clock className="h-4 w-4 text-[#D97706]" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Overdue</p>
            <p className="text-2xl font-bold text-[#111827] leading-none mt-0.5">{overdue.length}</p>
          </div>
        </div>
        <div className="fd-card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#FEF2F2] flex items-center justify-center shrink-0">
            <TrendingUp className="h-4 w-4 text-[#B91C1C]" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">L2+ Critical</p>
            <p className="text-2xl font-bold text-[#111827] leading-none mt-0.5">{l2Plus.length}</p>
          </div>
        </div>
      </div>

      {/* How escalation works */}
      <div className="fd-card p-4 bg-[#FFFBEB] border-[#FDE68A]">
        <p className="text-xs font-semibold text-[#B45309] mb-1">How it works</p>
        <p className="text-xs text-[#92400E] leading-relaxed">
          <strong>L1</strong> — Escalated to the assignee's manager. &nbsp;
          <strong>L2</strong> — Escalated to Admin. &nbsp;
          Tasks auto-escalate every 15 minutes if they remain overdue and unresolved.
          Managers can manually escalate via the task detail panel.
        </p>
      </div>

      <TaskTable
        tasks={escalated}
        onOpen={onOpenTask}
        emptyText="✅ No active escalations — all tasks are on track."
      />
    </div>
  );
}
