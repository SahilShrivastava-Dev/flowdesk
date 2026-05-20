import React, { useMemo } from 'react';
import { useApp } from '../context/AppContext.jsx';
import TodayTaskBoard       from '../components/cards/TodayTaskBoard.jsx';
import ProjectCompletedCard from '../components/cards/ProjectCompletedCard.jsx';
import RankPerformanceCard  from '../components/cards/RankPerformanceCard.jsx';
import TrackerDetailCard    from '../components/cards/TrackerDetailCard.jsx';
import ChatCard             from '../components/cards/ChatCard.jsx';
import KPIStrip             from '../components/cards/KPIStrip.jsx';

export default function AdminDashboard({ onOpenTask, onNavigate }) {
  const { tasks, users } = useApp();

  const todayTasks = useMemo(() => {
    const order  = { High: 0, Medium: 1, Low: 2 };
    const sorted = [...tasks].sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9));
    const open   = sorted.filter((t) => t.status !== 'Done');
    return open.length >= 3 ? open : sorted;
  }, [tasks]);

  const performanceData = useMemo(() => {
    return users
      .filter((u) => u.role === 'Employee')
      .map((u) => {
        const my   = tasks.filter((t) => t.assignedTo === u.id);
        const done = my.filter((t) => t.status === 'Done').length;
        return {
          id:      u.id,
          name:    u.name.split(' ')[0],
          fullName: u.name,
          done,
          pending: my.filter((t) => t.status === 'Pending' || t.status === 'Delay').length,
          issues:  my.filter((t) => t.status === 'Issue').length,
          score:   my.length ? Math.round((done / my.length) * 100) : 0,
        };
      })
      .sort((a, b) => b.score - a.score);
  }, [tasks, users]);

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <KPIStrip tasks={tasks} />

      {/* Today tasks + project donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <TodayTaskBoard
            tasks={todayTasks}
            onOpenTask={onOpenTask}
            onSeeAll={() => onNavigate?.('Tasks')}
          />
        </div>
        <ProjectCompletedCard tasks={tasks} />
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <RankPerformanceCard
          data={performanceData}
          onSeeAll={() => onNavigate?.('Team')}
        />
        <TrackerDetailCard onSeeAll={() => onNavigate?.('Analytic')} />
        <ChatCard onSeeAll={() => onNavigate?.('Tracker')} />
      </div>
    </div>
  );
}
