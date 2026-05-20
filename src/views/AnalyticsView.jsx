import React, { useMemo } from 'react';
import {
  PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Area, AreaChart,
} from 'recharts';
import { useApp } from '../context/AppContext.jsx';
import { findUser, isOverdue } from '../data/mockData.js';
import Avatar from '../components/Avatar.jsx';

const STATUS_COLORS = {
  Done:    '#22C55E',
  Pending: '#3B82F6',
  Delay:   '#F97316',
  Issue:   '#EF4444',
};

const TREND_DATA = [
  { day: 'Mon', closed: 2 },
  { day: 'Tue', closed: 4 },
  { day: 'Wed', closed: 3 },
  { day: 'Thu', closed: 6 },
  { day: 'Fri', closed: 5 },
  { day: 'Sat', closed: 4 },
  { day: 'Sun', closed: 7 },
];

export default function AnalyticsView() {
  const { tasks, users } = useApp();

  // Tasks by status for donut
  const statusData = useMemo(() => {
    const counts = { Done: 0, Pending: 0, Delay: 0, Issue: 0 };
    tasks.forEach((t) => {
      if (counts[t.status] !== undefined) counts[t.status]++;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [tasks]);

  // Throughput by person (grouped bar)
  const throughputData = useMemo(() => {
    return users
      .filter((u) => u.role === 'Employee')
      .map((u) => {
        const my   = tasks.filter((t) => t.assignedTo === u.id);
        return {
          name:    u.name.split(' ')[0],
          done:    my.filter((t) => t.status === 'Done').length,
          pending: my.filter((t) => t.status === 'Pending').length,
          issues:  my.filter((t) => t.status === 'Issue').length,
        };
      });
  }, [tasks, users]);

  // Per-person detail table
  const personStats = useMemo(() => {
    return users
      .filter((u) => u.role !== 'Admin')
      .map((u) => {
        const my      = tasks.filter((t) => t.assignedTo === u.id);
        const done    = my.filter((t) => t.status === 'Done').length;
        const pending = my.filter((t) => t.status === 'Pending').length;
        const delayed = my.filter((t) => t.status === 'Delay').length;
        const issues  = my.filter((t) => t.status === 'Issue').length;
        const overdue = my.filter(isOverdue).length;
        const rate    = my.length ? Math.round((done / my.length) * 100) : 0;
        return { user: u, total: my.length, done, pending, delayed, issues, overdue, rate };
      })
      .sort((a, b) => b.rate - a.rate);
  }, [tasks, users]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#9CA3AF]">Analytics</p>
        <h2 className="text-xl font-bold text-[#111827] mt-0.5">Operational health</h2>
        <p className="text-sm text-[#6B7280] mt-0.5">
          Throughput, distribution, and trend across the last six weeks.
        </p>
      </div>

      {/* Top row: donut + grouped bar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Tasks by Status — donut */}
        <div className="fd-card p-5">
          <h3 className="text-sm font-bold text-[#111827] mb-4">Tasks by Status</h3>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {statusData.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || '#ccc'} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: '1px solid #E5E7EB', fontSize: '12px' }}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => (
                    <span style={{ fontSize: 12, color: '#374151' }}>{value}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Throughput by Person — grouped bar */}
        <div className="fd-card p-5">
          <h3 className="text-sm font-bold text-[#111827] mb-4">Throughput by Person</h3>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={throughputData}
                margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
                barCategoryGap="30%"
                barGap={2}
              >
                <CartesianGrid vertical={false} stroke="#F3F4F6" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#9CA3AF' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#9CA3AF' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: '1px solid #E5E7EB', fontSize: '12px' }}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => (
                    <span style={{ fontSize: 12, color: '#374151' }}>{value}</span>
                  )}
                />
                <Bar dataKey="done"    fill="#22C55E" radius={[4, 4, 0, 0]} name="Done" />
                <Bar dataKey="pending" fill="#3B82F6" radius={[4, 4, 0, 0]} name="Pending" />
                <Bar dataKey="issues"  fill="#EF4444" radius={[4, 4, 0, 0]} name="Issues" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Completion Trend — line chart */}
      <div className="fd-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-[#111827]">Completion Trend</h3>
          <span className="text-xs text-[#9CA3AF]">Last 7 days</span>
        </div>
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={TREND_DATA}
              margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
            >
              <defs>
                <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#6366F1" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#F3F4F6" />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11, fill: '#9CA3AF' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#9CA3AF' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{ borderRadius: '12px', border: '1px solid #E5E7EB', fontSize: '12px' }}
              />
              <Area
                type="monotone"
                dataKey="closed"
                stroke="#6366F1"
                strokeWidth={2.5}
                fill="url(#trendGrad)"
                dot={{ r: 4, fill: '#6366F1', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                name="Tasks Closed"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      {/* Per-person performance table */}
      <div className="fd-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#F3F4F6]">
          <h3 className="text-sm font-bold text-[#111827]">Individual Performance</h3>
          <span className="text-xs text-[#9CA3AF]">{personStats.length} members</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {['Member', 'Total', 'Done', 'Pending', 'Delayed', 'Issues', 'Overdue', 'Rate'].map((h) => (
                  <th key={h} className="fd-table-head text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {personStats.map(({ user, total, done, pending, delayed, issues, overdue, rate }) => (
                <tr key={user.id} className="fd-row-hover">
                  <td className="fd-table-cell">
                    <div className="flex items-center gap-2.5">
                      <Avatar user={user} size="sm" />
                      <div>
                        <p className="font-semibold text-[#111827] text-sm">{user.name}</p>
                        <p className="text-[11px] text-[#9CA3AF]">{user.role}</p>
                      </div>
                    </div>
                  </td>
                  <td className="fd-table-cell">
                    <span className="font-semibold text-[#111827]">{total}</span>
                  </td>
                  <td className="fd-table-cell">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#DCFCE7] text-[#166534]">
                      {done}
                    </span>
                  </td>
                  <td className="fd-table-cell">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#EFF6FF] text-[#1D4ED8]">
                      {pending}
                    </span>
                  </td>
                  <td className="fd-table-cell">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FFFBEB] text-[#B45309]">
                      {delayed}
                    </span>
                  </td>
                  <td className="fd-table-cell">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FEF2F2] text-[#B91C1C]">
                      {issues}
                    </span>
                  </td>
                  <td className="fd-table-cell">
                    {overdue > 0 ? (
                      <span className="text-sm font-semibold text-[#DC2626]">{overdue}</span>
                    ) : (
                      <span className="text-sm text-[#9CA3AF]">—</span>
                    )}
                  </td>
                  <td className="fd-table-cell">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-[#F3F4F6] overflow-hidden min-w-[60px]">
                        <div
                          className="h-full rounded-full bg-[#3B82F6]"
                          style={{ width: `${rate}%` }}
                        />
                      </div>
                      <span className="num text-xs font-semibold text-[#374151] w-8 shrink-0">{rate}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Status summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Done',    color: '#22C55E', bg: '#DCFCE7', value: tasks.filter(t => t.status === 'Done').length },
          { label: 'Pending', color: '#3B82F6', bg: '#EFF6FF', value: tasks.filter(t => t.status === 'Pending').length },
          { label: 'Delayed', color: '#F97316', bg: '#FFFBEB', value: tasks.filter(t => t.status === 'Delay').length },
          { label: 'Issues',  color: '#EF4444', bg: '#FEF2F2', value: tasks.filter(t => t.status === 'Issue').length },
        ].map(({ label, color, bg, value }) => (
          <div key={label} className="fd-card p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: bg }}>
              <span className="w-3 h-3 rounded-full" style={{ background: color }} />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">{label}</p>
              <p className="text-2xl font-bold text-[#111827] leading-none mt-0.5">{value}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
