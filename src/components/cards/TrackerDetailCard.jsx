import React from 'react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts';

const DEFAULT_DATA = [
  { day: 'Mon', focus: 6, break: 2 },
  { day: 'Tue', focus: 4, break: 3 },
  { day: 'Wed', focus: 7, break: 4 },
  { day: 'Thu', focus: 3, break: 2 },
  { day: 'Fri', focus: 8, break: 3 },
  { day: 'Sat', focus: 2, break: 5 },
];

export default function TrackerDetailCard({ data = DEFAULT_DATA, onSeeAll }) {
  return (
    <div className="fd-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-[#111827]">Tracker Detail</h2>
        <button onClick={onSeeAll} className="text-xs font-semibold text-[#1E1B3A] hover:underline">
          See All
        </button>
      </div>

      <div className="flex items-center gap-4 mb-3">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-[#6B7280]">
          <span className="h-2 w-2 rounded-full bg-[#FB923C] inline-block" />
          Focus
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-[#6B7280]">
          <span className="h-2 w-2 rounded-full bg-[#E5E7EB] inline-block" />
          Break
        </span>
      </div>

      <div className="h-[190px]">
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
            <Bar dataKey="focus" fill="#FB923C" radius={[8, 8, 8, 8]} />
            <Bar dataKey="break" fill="#E5E7EB" radius={[8, 8, 8, 8]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
