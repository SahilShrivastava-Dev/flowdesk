import React from 'react';
import { findUser } from '../../data/mockData.js';
import { AvatarStack } from '../Avatar.jsx';

const TILE_STYLES = [
  {
    bg: 'bg-[#EEF2FF]',
    bar: 'bg-[#3B82F6]',
    pill: 'bg-[#DBEAFE] text-[#1D4ED8]',
  },
  {
    bg: 'bg-[#F5F3FF]',
    bar: 'bg-[#7C3AED]',
    pill: 'bg-[#EDE9FE] text-[#6D28D9]',
  },
  {
    bg: 'bg-[#FFF3EC]',
    bar: 'bg-[#F97316]',
    pill: 'bg-[#FFEDD5] text-[#C2410C]',
  },
  {
    bg: 'bg-[#ECFDF5]',
    bar: 'bg-[#10B981]',
    pill: 'bg-[#D1FAE5] text-[#065F46]',
  },
];

function TaskTile({ task, style, onOpen }) {
  const total        = 20;
  const completedMap = { Done: 20, Pending: 8, Delay: 6, Issue: 4 };
  const completed    = completedMap[task.status] ?? 10;
  const pct          = (completed / total) * 100;

  const team = [findUser(task.assignedTo), findUser(task.assignedBy)].filter(Boolean);

  return (
    <button
      onClick={() => onOpen?.(task)}
      className={`group flex flex-col text-left ${style.bg} rounded-2xl p-5 min-h-[200px] border border-white/60 hover:shadow-md transition-shadow w-full`}
    >
      {/* Priority pill */}
      <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full w-fit ${style.pill}`}>
        {task.priority} Priority
      </span>

      {/* Title */}
      <h3 className="mt-4 text-lg font-bold text-[#111827] leading-snug line-clamp-2 flex-1">
        {task.title}
      </h3>

      {/* Avatars */}
      <div className="mt-4">
        <AvatarStack userList={team} max={3} />
      </div>

      {/* Progress bar */}
      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1 h-1.5 rounded-full bg-white/70 overflow-hidden">
          <div
            className={`h-full ${style.bar} rounded-full transition-all`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="num text-xs font-semibold text-[#374151] tabular-nums shrink-0">
          {completed}/{total}
        </span>
      </div>
    </button>
  );
}

export default function TodayTaskBoard({ tasks, onOpenTask, onSeeAll }) {
  const top = tasks.slice(0, 3);
  return (
    <div className="fd-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-[#111827]">Today Task</h2>
        <button onClick={onSeeAll} className="text-xs font-semibold text-[#1E1B3A] hover:underline">
          See All
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {top.map((t, i) => (
          <TaskTile
            key={t.id}
            task={t}
            style={TILE_STYLES[i % TILE_STYLES.length]}
            onOpen={onOpenTask}
          />
        ))}
      </div>
    </div>
  );
}
