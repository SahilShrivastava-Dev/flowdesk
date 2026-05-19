import React, { useMemo } from 'react';
import TaskTable from '../components/TaskTable.jsx';
import { useApp } from '../context/AppContext.jsx';
import { directReports } from '../data/mockData.js';
import { Clock, CheckCircle2, AlertCircle, ListTodo, Activity } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';

const taskTrendData = [ { day: 'M', v: 12 }, { day: 'T', v: 19 }, { day: 'W', v: 15 }, { day: 'T', v: 22 }, { day: 'F', v: 18 }, { day: 'S', v: 25 }, { day: 'S', v: 20 } ];

export default function TasksView({ onOpenTask, title }) {
  const { tasks, role, activeUser } = useApp();

  const list = useMemo(() => {
    if (role === 'Employee') return tasks.filter((t) => t.assignedTo === activeUser.id);
    if (role === 'Manager') {
      const teamIds = directReports(activeUser.id).map((u) => u.id);
      return tasks.filter((t) => teamIds.includes(t.assignedTo));
    }
    return tasks;
  }, [tasks, role, activeUser.id]);

  const heading = title || (role === 'Employee' ? 'My Assignments' : role === 'Manager' ? 'Team Workflows' : 'Global Tasks');

  const pendingCount = list.filter(t => t.status === 'Pending').length;
  const inProgressCount = list.filter(t => t.status === 'In Progress').length;
  const doneCount = list.filter(t => t.status === 'Done').length;

  return (
    <div className="space-y-6 animate-fade-in relative z-10">
      
      {/* Immersive Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
        <div>
           <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-200 dark:bg-white/5 border border-slate-300 dark:border-white/10 text-pink-600 dark:text-pink-400 text-[10px] font-bold mb-3 uppercase tracking-widest">
             <Activity size={12} /> Active Database
           </div>
           <h1 className="text-3xl lg:text-4xl font-black text-slate-900 dark:text-white tracking-tight">{heading}</h1>
           <p className="text-slate-500 dark:text-white/40 font-medium mt-1 text-sm">Manage, filter, and execute across {list.length} distinct operations.</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="eclipse-btn-secondary py-2 px-4 text-xs">Filters</button>
          <button className="eclipse-btn-primary py-2 px-4 text-xs">Export Engine</button>
        </div>
      </div>

      {/* Floating Glass Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="eclipse-card p-5 flex flex-col justify-between group">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-bold text-slate-500 dark:text-white/40 uppercase tracking-widest">Total Volume</span>
            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center text-slate-600 dark:text-white/50 group-hover:scale-110 transition-transform"><ListTodo size={14} /></div>
          </div>
          <span className="text-3xl font-black text-slate-900 dark:text-white">{list.length}</span>
        </div>

        <div className="eclipse-card p-5 flex flex-col justify-between group relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-pink-500/10 dark:bg-pink-500/20 rounded-full blur-[30px] -z-10 group-hover:bg-pink-500/20 dark:group-hover:bg-pink-500/30 transition-colors"></div>
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-bold text-pink-500 dark:text-pink-400 uppercase tracking-widest">Pending</span>
            <div className="w-8 h-8 rounded-full bg-pink-100 dark:bg-pink-500/10 flex items-center justify-center text-pink-500 dark:text-pink-400 group-hover:scale-110 transition-transform"><Clock size={14} /></div>
          </div>
          <span className="text-3xl font-black text-slate-900 dark:text-white">{pendingCount}</span>
        </div>

        <div className="eclipse-card p-5 flex flex-col justify-between group relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-full blur-[30px] -z-10 group-hover:bg-indigo-500/20 dark:group-hover:bg-indigo-500/30 transition-colors"></div>
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-widest">In Progress</span>
            <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-500/10 flex items-center justify-center text-indigo-500 dark:text-indigo-400 group-hover:scale-110 transition-transform"><AlertCircle size={14} /></div>
          </div>
          <span className="text-3xl font-black text-slate-900 dark:text-white">{inProgressCount}</span>
        </div>

        <div className="eclipse-card p-5 flex flex-col justify-between group relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 dark:bg-emerald-500/20 rounded-full blur-[30px] -z-10 group-hover:bg-emerald-500/20 dark:group-hover:bg-emerald-500/30 transition-colors"></div>
          <div className="relative z-10 flex items-center justify-between mb-4">
            <span className="text-xs font-bold text-emerald-500 dark:text-emerald-400 uppercase tracking-widest">Completed</span>
            <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center text-emerald-500 dark:text-emerald-400 group-hover:scale-110 transition-transform"><CheckCircle2 size={14} /></div>
          </div>
          <span className="relative z-10 text-3xl font-black text-slate-900 dark:text-white">{doneCount}</span>
          
          <div className="absolute bottom-0 left-0 right-0 h-16 opacity-20 dark:opacity-30 pointer-events-none z-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={taskTrendData}>
                <Area type="monotone" dataKey="v" stroke="#34d399" strokeWidth={2} fill="#34d399" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="eclipse-card overflow-hidden">
        <TaskTable tasks={list} onOpen={onOpenTask} />
      </div>
    </div>
  );
}
