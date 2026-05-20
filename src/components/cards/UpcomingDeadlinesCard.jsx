import React, { useMemo } from 'react';
import { CalendarClock, ArrowUpRight } from 'lucide-react';
import { findUser, isOverdue, daysUntil } from '../../data/mockData.js';
import Avatar from '../Avatar.jsx';

function DeadlineChip({ task }) {
  if (isOverdue(task)) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FEF2F2] text-[#B91C1C]">
        Overdue
      </span>
    );
  }
  const d = daysUntil(task.deadline);
  if (d <= 0) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FFFBEB] text-[#B45309]">
        Due today
      </span>
    );
  }
  if (d <= 2) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FFFBEB] text-[#B45309]">
        {d}d left
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#DCFCE7] text-[#166534]">
      {d}d left
    </span>
  );
}

export default function UpcomingDeadlinesCard({ tasks, onOpen, onSeeAll }) {
  const list = useMemo(() => {
    return [...tasks]
      .filter((t) => t.status !== 'Done')
      .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
      .slice(0, 6);
  }, [tasks]);

  return (
    <div className="fd-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-[#6B7280]" />
          <h2 className="text-sm font-bold text-[#111827]">Upcoming Deadlines</h2>
        </div>
        <button onClick={onSeeAll} className="text-xs font-semibold text-[#1E1B3A] hover:underline">
          See All
        </button>
      </div>

      {list.length === 0 ? (
        <p className="text-sm text-[#9CA3AF] text-center py-6">Nothing due soon.</p>
      ) : (
        <ul className="divide-y divide-[#F3F4F6]">
          {list.map((t) => {
            const u = findUser(t.assignedTo);
            return (
              <li key={t.id}>
                <button
                  onClick={() => onOpen?.(t)}
                  className="w-full flex items-center gap-3 py-3 text-left hover:bg-[#F9FAFB] -mx-2 px-2 rounded-xl transition-colors"
                >
                  <Avatar user={u} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[#111827] truncate">{t.title}</p>
                    <p className="num text-[11px] text-[#9CA3AF]">
                      {t.id} · {u?.name?.split(' ')[0]}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <DeadlineChip task={t} />
                    <span className="num text-[11px] text-[#6B7280]">
                      {new Date(t.deadline).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-[#9CA3AF]" />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
