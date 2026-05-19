import React from 'react';
import { useApp } from '../context/AppContext.jsx';
import Avatar from '../components/Avatar.jsx';
import { directReports } from '../data/mockData.js';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { Users } from 'lucide-react';

const radarData = [
  { subject: 'Velocity', A: 120, fullMark: 150 },
  { subject: 'Quality', A: 98, fullMark: 150 },
  { subject: 'Comms', A: 86, fullMark: 150 },
  { subject: 'Leadership', A: 99, fullMark: 150 },
  { subject: 'Output', A: 85, fullMark: 150 },
  { subject: 'Growth', A: 65, fullMark: 150 },
];

function PersonNode({ user, depth = 0 }) {
  const { tasks } = useApp();
  const reports = directReports(user.id);
  const my = tasks.filter((t) => t.assignedTo === user.id);
  const done = my.filter((t) => t.status === 'Done').length;
  const score = my.length ? Math.round((done / my.length) * 100) : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="eclipse-card p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:shadow-[0_0_30px_rgba(255,255,255,0.05)] transition-all">
        
        <div className="flex items-center gap-6">
          <div className="relative">
             <Avatar user={user} size="xl" />
             <div className="absolute -inset-2 rounded-full border border-white/10 animate-spin" style={{animationDuration: '10s'}}></div>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-black text-slate-900 dark:text-white truncate mb-1">{user.name}</h3>
            <div className="inline-flex items-center gap-2 px-2 py-1 rounded bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold uppercase tracking-widest border border-indigo-200 dark:border-indigo-500/20">
               {user.role}
            </div>
            <p className="text-xs font-medium text-slate-500 dark:text-white/40 mt-2">{user.email}</p>
          </div>
        </div>

        <div className="flex items-center gap-6 md:gap-10">
          <div className="flex flex-col items-center">
            <span className="text-2xl font-black text-slate-900 dark:text-white">{my.length}</span>
            <span className="text-[10px] font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest mt-1">Active</span>
          </div>
          <div className="flex flex-col items-center">
             <span className="text-2xl font-black text-emerald-500 dark:text-emerald-400">{done}</span>
             <span className="text-[10px] font-bold text-emerald-600/70 dark:text-emerald-400/50 uppercase tracking-widest mt-1">Closed</span>
          </div>
          
          <div className="relative w-16 h-16 flex items-center justify-center">
            <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90 filter dark:drop-shadow-[0_0_8px_rgba(56,189,248,0.5)]">
               <path className="text-slate-200 dark:text-white/5" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3" />
               <path className="text-sky-500 dark:text-sky-400" strokeDasharray={`${score}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <span className="absolute text-sm font-black text-slate-900 dark:text-white">{score}%</span>
          </div>
        </div>
      </div>

      {reports.length > 0 && (
        <div className="ml-10 md:ml-12 border-l border-white/10 pl-10 md:pl-12 space-y-6 pt-4 relative">
          <div className="absolute top-0 left-[-1px] w-[2px] h-32 bg-gradient-to-b from-indigo-500 to-transparent"></div>
          {reports.map((r) => <PersonNode key={r.id} user={r} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
}

export default function TeamView() {
  const { users, role, activeUser } = useApp();
  const root = role === 'Admin' ? users.find((u) => u.role === 'Admin') : activeUser;

  return (
    <div className="space-y-12 animate-fade-in relative z-10">
      
      {/* Header & Radar Chart Split */}
      <div className="flex flex-col lg:flex-row gap-8">
        <div className="flex-1 flex flex-col justify-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-200 dark:bg-white/5 border border-slate-300 dark:border-white/10 text-sky-600 dark:text-sky-400 text-[10px] font-bold mb-4 uppercase tracking-widest">
             <Users size={12} /> Org Matrix
          </div>
          <h1 className="text-4xl lg:text-5xl font-black text-slate-900 dark:text-white tracking-tight mb-4">{role === 'Admin' ? 'Global Org' : 'My Squad'}</h1>
          <p className="text-slate-500 dark:text-white/40 font-medium text-base max-w-md">Hierarchy visualizer and performance topology. See who operates where.</p>
        </div>
        
        <div className="flex-1 h-[300px] eclipse-card flex items-center justify-center p-4 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-tr from-sky-500/10 to-indigo-500/10 z-0"></div>
          <div className="w-full h-full relative z-10">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                <PolarGrid stroke="rgba(255,255,255,0.1)" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 'bold' }} />
                <PolarRadiusAxis angle={30} domain={[0, 150]} tick={false} axisLine={false} />
                <Radar name="Performance" dataKey="A" stroke="#38bdf8" strokeWidth={2} fill="#38bdf8" fillOpacity={0.3} />
                <Tooltip cursor={{fill: 'transparent'}} contentStyle={{ borderRadius: '16px', background: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)' }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      
      {/* Hierarchy Tree */}
      <div className="pt-8">
        {root && <PersonNode user={root} />}
      </div>
    </div>
  );
}
