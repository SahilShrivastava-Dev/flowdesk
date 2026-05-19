import React, { useState, useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext.jsx';
import { Home, ListTodo, Users, BarChart3, Plus, Bell, Search, Sparkles, Sun, Moon } from 'lucide-react';
import { RadialBarChart, RadialBar, Tooltip, ResponsiveContainer, PolarAngleAxis } from 'recharts';

import TasksView from './views/TasksView.jsx';
import TeamView from './views/TeamView.jsx';
import ApprovalsView from './views/ApprovalsView.jsx';
import AnalyticsView from './views/AnalyticsView.jsx';
import TaskDetailsModal from './components/TaskDetailsModal.jsx';
import CreateTaskModal from './components/CreateTaskModal.jsx';

// Dribbble-style Massive Radial Data
const radialData = [
  { name: 'Pending', count: 45, fill: '#f43f5e' },
  { name: 'In Progress', count: 65, fill: '#8b5cf6' },
  { name: 'Review', count: 85, fill: '#3b82f6' },
  { name: 'Completed', count: 120, fill: '#10b981' },
];

function EclipseOverview({ onOpenTask }) {
  const { tasks, activeUser } = useApp();
  const priorityTasks = tasks.filter(t => t.status !== 'Done').slice(0, 4);

  return (
    <div className="h-full flex flex-col lg:flex-row gap-8 animate-fade-in p-8">
      
      {/* Left Column: Greeting & Priority Flow */}
      <div className="flex-1 flex flex-col justify-center">
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 text-xs font-bold mb-6">
            <Sparkles size={14} /> System Optimal
          </div>
          <h1 className="text-4xl lg:text-5xl font-black tracking-tight leading-tight mb-4 text-slate-900 dark:text-white">
            Good Morning,<br/>{activeUser?.name?.split(' ')[0]}.
          </h1>
          <p className="text-lg text-slate-500 dark:text-white/50 font-medium max-w-md">
            You have <strong className="text-slate-800 dark:text-white">{tasks.filter(t=>t.status==='Pending').length} pending actions</strong> requiring your attention.
          </p>
        </div>

        <h3 className="text-xs font-bold tracking-widest uppercase text-slate-400 dark:text-white/30 mb-4">Priority Stream</h3>
        <div className="flex gap-4 overflow-x-auto pb-6 no-scrollbar snap-x">
          {priorityTasks.map((task, i) => (
            <div 
              key={task.id} 
              onClick={() => onOpenTask(task)}
              className="snap-start shrink-0 w-64 eclipse-card p-5 cursor-pointer group"
            >
              <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-4 group-hover:scale-110 transition-transform">
                <ListTodo size={16} />
              </div>
              <h4 className="text-lg font-bold text-slate-900 dark:text-white mb-1 leading-tight">{task.title}</h4>
              <p className="text-xs text-slate-500 dark:text-white/40 font-medium">{task.project}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Right Column: Massive Immersive Chart */}
      <div className="flex-1 flex items-center justify-center relative min-h-[500px]">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/10 to-purple-500/10 rounded-[4rem] blur-3xl -z-10"></div>
        <div className="w-full h-full max-w-[600px] max-h-[600px] relative animate-float">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart cx="50%" cy="50%" innerRadius="30%" outerRadius="100%" barSize={24} data={radialData} startAngle={90} endAngle={-270}>
              <PolarAngleAxis type="number" domain={[0, 150]} angleAxisId={0} tick={false} />
              <RadialBar
                minAngle={15}
                background={{ fill: 'rgba(255,255,255,0.02)' }}
                clockWise
                dataKey="count"
                cornerRadius={12}
              />
              <Tooltip cursor={{fill: 'transparent'}} contentStyle={{ borderRadius: '12px' }} />
            </RadialBarChart>
          </ResponsiveContainer>
          {/* Center Content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-4xl font-black text-slate-900 dark:text-white">{tasks.length}</span>
            <span className="text-xs font-bold tracking-widest uppercase text-slate-400 dark:text-white/40 mt-1">Workflows</span>
          </div>
        </div>
      </div>

    </div>
  );
}

function EclipseShell() {
  const [activeTab, setActiveTab] = useState('Overview');
  const [openTask, setOpenTask] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  const renderView = () => {
    switch (activeTab) {
      case 'Overview': return <EclipseOverview onOpenTask={setOpenTask} />;
      case 'Tasks': return <div className="h-full overflow-y-auto p-8 max-w-[1400px] mx-auto"><TasksView onOpenTask={setOpenTask} /></div>;
      case 'Team': return <div className="h-full overflow-y-auto p-8 max-w-[1400px] mx-auto"><TeamView /></div>;
      case 'Approvals': return <div className="h-full overflow-y-auto p-8 max-w-[1400px] mx-auto"><ApprovalsView onOpenTask={setOpenTask} /></div>;
      case 'Analytics': return <div className="h-full overflow-y-auto p-8 max-w-[1400px] mx-auto"><AnalyticsView /></div>;
      default: return <EclipseOverview onOpenTask={setOpenTask} />;
    }
  };

  const dockItems = [
    { id: 'Overview', icon: Home },
    { id: 'Tasks', icon: ListTodo },
    { id: 'Team', icon: Users },
    { id: 'Analytics', icon: BarChart3 },
  ];

  return (
    <div className="flex flex-col h-screen font-sans overflow-hidden relative selection:bg-indigo-500/30">
      
      {/* Top Floating Header */}
      <header className="absolute top-4 left-6 right-6 flex items-center justify-between z-50 pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          <div className="w-10 h-10 rounded-xl bg-white/50 dark:bg-white/10 backdrop-blur-md border border-slate-200 dark:border-white/10 flex items-center justify-center shadow-sm">
            <span className="text-lg font-black bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 to-pink-500">FD</span>
          </div>
          <span className="text-lg font-black tracking-tight text-slate-800 dark:text-white/90 hidden sm:block">FlowDesk</span>
        </div>
        
        <div className="flex items-center gap-3 pointer-events-auto">
          <button className="w-10 h-10 rounded-full eclipse-card flex items-center justify-center text-slate-500 dark:text-white/70 hover:text-indigo-500 dark:hover:text-white">
            <Search size={18} />
          </button>
          <button className="w-10 h-10 rounded-full eclipse-card flex items-center justify-center text-slate-500 dark:text-white/70 hover:text-indigo-500 dark:hover:text-white relative">
            <Bell size={18} />
            <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-pink-500 rounded-full border-2 border-white dark:border-[#030303]"></span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full h-full relative z-10 pt-24 pb-32">
        {renderView()}
      </main>

      {/* Mac OS Style Floating Dock */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50">
        <div className="flex items-center gap-2 p-1.5 rounded-full bg-white/50 dark:bg-white/5 backdrop-blur-3xl border border-slate-200 dark:border-white/10 shadow-xl dark:shadow-2xl">
          {dockItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`relative flex flex-col items-center justify-center w-12 h-12 rounded-full transition-all duration-300 group
                  ${isActive ? 'bg-slate-200 dark:bg-white/10 scale-105' : 'hover:bg-slate-100 dark:hover:bg-white/5 hover:scale-105'}`}
              >
                <Icon size={20} className={isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-white/50 group-hover:text-slate-800 dark:group-hover:text-white/80'} />
                {isActive && <div className="absolute -bottom-0.5 w-1.5 h-1.5 rounded-full bg-indigo-500 dark:bg-indigo-400 shadow-[0_0_8px_rgba(99,102,241,0.6)]"></div>}
              </button>
            )
          })}
          
          <div className="w-[1px] h-8 bg-slate-300 dark:bg-white/10 mx-2"></div>
          
          <button onClick={() => setCreateOpen(true)} className="w-12 h-12 rounded-full bg-indigo-500 text-white flex flex-col items-center justify-center hover:scale-105 transition-all duration-300 shadow-lg">
            <Plus size={22} />
          </button>
          
          <button onClick={() => setIsDark(!isDark)} className="w-12 h-12 rounded-full bg-slate-200 dark:bg-[#111] text-slate-700 dark:text-amber-400 flex flex-col items-center justify-center hover:scale-105 transition-all duration-300 ml-1">
            {isDark ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>
      </div>

      <TaskDetailsModal task={openTask} onClose={() => setOpenTask(null)} />
      <CreateTaskModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <EclipseShell />
    </AppProvider>
  );
}
