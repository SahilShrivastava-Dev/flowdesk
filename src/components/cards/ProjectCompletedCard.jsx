import React from 'react';
import { RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis } from 'recharts';

function StatRow({ color, label, pct }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: color }} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-[#374151] truncate">{label}</p>
        <p className="num text-xl font-bold text-[#111827]">{pct}%</p>
      </div>
    </div>
  );
}

export default function ProjectCompletedCard({ tasks }) {
  const count       = tasks.length;            // real total (may be 0)
  const total       = count || 1;              // divisor guard to avoid /0
  const done        = tasks.filter((t) => t.status === 'Done').length;
  const inProgress  = tasks.filter((t) => t.status === 'Pending' || t.status === 'Delay').length;
  const backlog     = tasks.filter((t) => t.status === 'Issue' || t.escalationLevel > 0).length;

  const donePct       = Math.round((done / total) * 100);
  const inProgressPct = Math.round((inProgress / total) * 100);
  const backlogPct    = Math.round((backlog / total) * 100);

  // RadialBarChart renders innermost ring first
  const data = [
    { name: 'Backlog',     uv: backlogPct,    fill: '#7DD3FC' },
    { name: 'In Progress', uv: inProgressPct, fill: '#FB923C' },
    { name: 'Done',        uv: donePct,       fill: '#A78BFA' },
  ];

  return (
    <div className="fd-card p-5 h-full flex flex-col">
      <div className="flex items-start justify-between mb-4">
        <h2 className="text-sm font-bold text-[#111827]">Project Completed</h2>
        <p className="text-xs text-[#9CA3AF]">
          Total project{' '}
          <span className="num font-semibold text-[#111827]">{count}</span>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 flex-1 items-center">
        {/* Legend */}
        <div className="space-y-4">
          <StatRow color="#A78BFA" label="Project Done"  pct={donePct} />
          <StatRow color="#FB923C" label="In Progress"   pct={inProgressPct} />
          <StatRow color="#7DD3FC" label="Backlog"       pct={backlogPct} />
        </div>

        {/* Donut chart */}
        <div className="relative h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              innerRadius="40%"
              outerRadius="100%"
              data={data}
              startAngle={90}
              endAngle={-270}
              barSize={14}
            >
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
              <RadialBar
                dataKey="uv"
                background={{ fill: '#F3F4F6' }}
                cornerRadius={20}
              />
            </RadialBarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
