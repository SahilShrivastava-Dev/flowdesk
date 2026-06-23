import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { useApp } from '../../context/AppContext.jsx';
import { weeklyActivity } from '../../lib/analytics.js';

export default function TrackerDetailCard({ onSeeAll }) {
  const { tasks } = useApp();
  const data = useMemo(() => weeklyActivity(tasks), [tasks]);
  const hasData = data.some((d) => d.created > 0 || d.closed > 0);

  return (
    <div className="fd-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-[#111827]">Weekly Activity</h2>
        <button onClick={onSeeAll} className="text-xs font-semibold text-[#1E1B3A] hover:underline">
          See All
        </button>
      </div>

      <div className="flex items-center gap-4 mb-3">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-[#6B7280]">
          <span className="h-2 w-2 rounded-full bg-[#FB923C] inline-block" />
          Closed
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-[#6B7280]">
          <span className="h-2 w-2 rounded-full bg-[#E5E7EB] inline-block" />
          Created
        </span>
      </div>

      <div className="h-[190px]">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 8, right: 8, left: -22, bottom: 0 }}
              barCategoryGap="32%"
            >
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11, fill: '#9CA3AF' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis hide />
              <Tooltip
                cursor={{ fill: 'rgba(30,27,58,.04)' }}
                contentStyle={{
                  borderRadius: '10px',
                  border: '1px solid #E5E7EB',
                  fontSize: '12px',
                }}
              />
              <Bar dataKey="closed"  fill="#FB923C" radius={[8, 8, 8, 8]} name="Closed" />
              <Bar dataKey="created" fill="#E5E7EB" radius={[8, 8, 8, 8]} name="Created" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-[#9CA3AF]">
            No activity in the last 7 days
          </div>
        )}
      </div>
    </div>
  );
}
