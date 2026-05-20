import React, { useMemo } from 'react';
import { Users2 } from 'lucide-react';
import Avatar from '../Avatar.jsx';
import { findUser } from '../../data/mockData.js';

// Each status gets a solid color segment on a full-width bar
const STATUS_COLORS = {
  Done:    '#22C55E',
  Pending: '#3B82F6',
  Delay:   '#F59E0B',
  Issue:   '#EF4444',
};

// A single full-width segmented bar showing task breakdown
function WorkloadBar({ counts, total }) {
  if (!total) {
    return <div className="h-2 rounded-full bg-[#F3F4F6] w-full" />;
  }
  const segments = ['Done', 'Pending', 'Delay', 'Issue'].filter((s) => counts[s] > 0);
  return (
    <div className="h-2 rounded-full overflow-hidden flex w-full gap-[1px]">
      {segments.map((s) => (
        <div
          key={s}
          className="h-full transition-all duration-700 rounded-sm"
          style={{ width: `${(counts[s] / total) * 100}%`, background: STATUS_COLORS[s] }}
          title={`${s}: ${counts[s]}`}
        />
      ))}
    </div>
  );
}

export default function WorkloadCard({ tasks, users, onSeeAll }) {
  const data = useMemo(() => {
    const employees = users.filter((u) => u.role !== 'Admin');
    const rows = employees.map((u) => {
      const my = tasks.filter((t) => t.assignedTo === u.id);
      const counts = {
        Done:    my.filter((t) => t.status === 'Done').length,
        Pending: my.filter((t) => t.status === 'Pending').length,
        Delay:   my.filter((t) => t.status === 'Delay').length,
        Issue:   my.filter((t) => t.status === 'Issue').length,
      };
      return { id: u.id, total: my.length, counts };
    });
    return rows.sort((a, b) => b.total - a.total);
  }, [tasks, users]);

  return (
    <div className="fd-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users2 className="h-4 w-4 text-[#6B7280]" />
          <h2 className="text-sm font-bold text-[#111827]">Workload Distribution</h2>
        </div>
        <button onClick={onSeeAll} className="text-xs font-semibold text-[#1E1B3A] hover:underline">
          See All
        </button>
      </div>

      <ul className="space-y-3.5">
        {data.map((row) => {
          const u = findUser(row.id);
          return (
            <li key={row.id} className="flex items-center gap-3">
              <Avatar user={u} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-sm font-medium text-[#111827] truncate">{u?.name}</span>
                  <span className="num text-xs text-[#9CA3AF] whitespace-nowrap shrink-0">
                    {row.total} task{row.total !== 1 ? 's' : ''}
                  </span>
                </div>
                <WorkloadBar counts={row.counts} total={row.total} />
              </div>
            </li>
          );
        })}
      </ul>

      {/* Legend */}
      <div className="mt-4 pt-3 border-t border-[#F3F4F6] flex items-center gap-4 flex-wrap">
        {Object.entries(STATUS_COLORS).map(([label, color]) => (
          <span key={label} className="inline-flex items-center gap-1.5 text-[11px] text-[#6B7280]">
            <span className="h-2 w-2 rounded-full" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
