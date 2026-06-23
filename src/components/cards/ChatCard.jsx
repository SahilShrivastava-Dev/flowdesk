import React, { useMemo } from 'react';
import Avatar from '../Avatar.jsx';
import { findUser } from '../../data/mockData.js';
import { useApp } from '../../context/AppContext.jsx';
import { recentActivity, timeAgo } from '../../lib/analytics.js';

export default function ChatCard({ onSeeAll }) {
  const { tasks } = useApp();
  const items = useMemo(() => recentActivity(tasks, 5), [tasks]);

  return (
    <div className="fd-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-[#111827]">Recent Activity</h2>
        <button onClick={onSeeAll} className="text-xs font-semibold text-[#1E1B3A] hover:underline">
          See All
        </button>
      </div>

      {items.length === 0 ? (
        <div className="py-8 text-center text-xs text-[#9CA3AF]">
          No activity yet
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item, i) => {
            const actor = findUser(item.by);
            return (
              <div key={`${item.taskId}-${i}`} className="flex items-start gap-3">
                <Avatar user={actor} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[#374151] leading-snug">
                    <span className="font-semibold text-[#111827]">
                      {actor?.name?.split(' ')[0] ?? 'Someone'}
                    </span>{' '}
                    {item.text}
                  </p>
                  <p className="text-[11px] text-[#9CA3AF] mt-0.5">
                    {item.taskId} · {timeAgo(item.at)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
