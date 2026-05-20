import React, { useMemo, useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { directReports, isOverdue } from '../data/mockData.js';
import KPIStrip from '../components/cards/KPIStrip.jsx';
import TodayTaskBoard from '../components/cards/TodayTaskBoard.jsx';
import ProjectCompletedCard from '../components/cards/ProjectCompletedCard.jsx';
import TrackerDetailCard from '../components/cards/TrackerDetailCard.jsx';
import ChatCard from '../components/cards/ChatCard.jsx';
import RankPerformanceCard from '../components/cards/RankPerformanceCard.jsx';
import UpcomingDeadlinesCard from '../components/cards/UpcomingDeadlinesCard.jsx';
import Avatar from '../components/Avatar.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { CheckCircle2, Clock, AlertCircle, Flame, Target } from 'lucide-react';

// Animated progress ring
function ProgressRing({ pct, size = 80, stroke = 7 }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const [drawn, setDrawn] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDrawn(pct), 120);
    return () => clearTimeout(t);
  }, [pct]);

  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#F3F4F6" strokeWidth={stroke} />
      <circle
        cx={size/2} cy={size/2} r={r} fill="none"
        stroke={pct === 100 ? '#22C55E' : '#3B82F6'}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ - (drawn / 100) * circ}
        style={{ transition: 'stroke-dashoffset 0.8s ease' }}
      />
    </svg>
  );
}

export default function EmployeeDashboard({ onOpenTask, onNavigate }) {
  const { tasks, activeUser, users } = useApp();

  const myTasks = useMemo(
    () => tasks.filter((t) => t.assignedTo === activeUser.id),
    [tasks, activeUser.id]
  );

  const todayTasks = useMemo(() => {
    const order = { High: 0, Medium: 1, Low: 2 };
    return [...myTasks]
      .filter((t) => t.status !== 'Done')
      .sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9));
  }, [myTasks]);

  const performanceData = useMemo(() =>
    users
      .filter((u) => u.role === 'Employee')
      .map((u) => {
        const my   = tasks.filter((t) => t.assignedTo === u.id);
        const done = my.filter((t) => t.status === 'Done').length;
        return {
          id: u.id, name: u.name.split(' ')[0], fullName: u.name,
          done,
          pending: my.filter((t) => t.status === 'Pending' || t.status === 'Delay').length,
          issues:  my.filter((t) => t.status === 'Issue').length,
          score:   my.length ? Math.round((done / my.length) * 100) : 0,
        };
      })
      .sort((a, b) => b.score - a.score),
    [tasks, users]
  );

  const done     = myTasks.filter((t) => t.status === 'Done').length;
  const overdue  = myTasks.filter(isOverdue).length;
  const pct      = myTasks.length ? Math.round((done / myTasks.length) * 100) : 0;
  const firstName = activeUser?.name?.split(' ')[0] || 'there';

  // greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-5">

      {/* Personal greeting banner */}
      <div className="fd-card p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-5 bg-gradient-to-r from-white to-[#F5F3FF] overflow-hidden relative">
        {/* BG decoration */}
        <div className="absolute right-0 top-0 w-64 h-64 rounded-full bg-[#6366F1]/5 -translate-y-1/2 translate-x-1/2 pointer-events-none" />

        <div className="relative z-10">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9CA3AF] mb-1">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          <h2 className="text-2xl font-bold text-[#111827] leading-tight">
            {greeting}, {firstName} 👋
          </h2>
          <p className="text-sm text-[#6B7280] mt-1.5">
            {todayTasks.length > 0
              ? <>You have <strong className="text-[#111827]">{todayTasks.length} open task{todayTasks.length !== 1 ? 's' : ''}</strong> — {overdue > 0 ? <span className="text-[#DC2626]">{overdue} overdue</span> : 'all on track'}.</>
              : '🎉 All tasks done! Great work today.'}
          </p>
        </div>

        {/* Progress ring */}
        <div className="flex items-center gap-4 relative z-10 shrink-0">
          <div className="relative flex items-center justify-center">
            <ProgressRing pct={pct} />
            <div className="absolute flex flex-col items-center">
              <span className="text-lg font-bold text-[#111827] leading-none">{pct}%</span>
            </div>
          </div>
          <div>
            <p className="text-sm font-bold text-[#111827]">{done} / {myTasks.length}</p>
            <p className="text-xs text-[#9CA3AF]">tasks complete</p>
          </div>
        </div>
      </div>

      {/* Personal KPIs */}
      <KPIStrip tasks={myTasks} />

      {/* Today tasks + project */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <TodayTaskBoard
            tasks={todayTasks.length ? todayTasks : myTasks}
            onOpenTask={onOpenTask}
            onSeeAll={() => onNavigate?.('MyTasks')}
          />
        </div>
        <ProjectCompletedCard tasks={myTasks} />
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        <RankPerformanceCard data={performanceData} onSeeAll={() => onNavigate?.('Tracker')} />
        <TrackerDetailCard   onSeeAll={() => onNavigate?.('Tracker')} />
        <ChatCard            onSeeAll={() => onNavigate?.('Tracker')} />
      </div>

      <UpcomingDeadlinesCard
        tasks={myTasks}
        onOpen={onOpenTask}
        onSeeAll={() => onNavigate?.('MyTasks')}
      />
    </div>
  );
}
