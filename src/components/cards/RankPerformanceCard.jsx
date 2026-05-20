import React from 'react';
import Avatar from '../Avatar.jsx';
import { findUser } from '../../data/mockData.js';

export default function RankPerformanceCard({ data, onSeeAll }) {
  const top = data.slice(0, 5);

  return (
    <div className="fd-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-[#111827]">Rank Performance</h2>
        <button onClick={onSeeAll} className="text-xs font-semibold text-[#1E1B3A] hover:underline">
          See All
        </button>
      </div>

      <ul className="space-y-3">
        {top.map((row, idx) => {
          const u      = findUser(row.id);
          const points = 100 + row.done * 5 + (row.score % 20);
          return (
            <li key={row.id} className="flex items-center gap-3">
              {/* Rank number */}
              <span className="w-5 text-xs font-bold text-[#9CA3AF] text-right shrink-0">
                {idx + 1}
              </span>

              <Avatar user={u} size="md" />

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#111827] truncate">{u?.name}</p>
                <p className="text-xs text-[#9CA3AF] truncate">
                  {u?.role === 'Manager' ? 'Team Lead' : 'Specialist'}
                </p>
              </div>

              <span className="num text-sm font-semibold text-[#111827] shrink-0">
                {points} <span className="text-[#9CA3AF] font-normal">pt</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
