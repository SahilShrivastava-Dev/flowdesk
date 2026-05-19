import React from 'react';
import { ComposedChart, Line, Area, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Scatter } from 'recharts';
import { Layers, Zap } from 'lucide-react';

const complexData = [
  { name: 'Mon', completion: 590, influx: 800, amt: 1400, anomalies: 490 },
  { name: 'Tue', completion: 868, influx: 967, amt: 1506, anomalies: 590 },
  { name: 'Wed', completion: 1397, influx: 1098, amt: 989, anomalies: 350 },
  { name: 'Thu', completion: 1480, influx: 1200, amt: 1228, anomalies: 290 },
  { name: 'Fri', completion: 1520, influx: 1108, amt: 1100, anomalies: 480 },
  { name: 'Sat', completion: 1400, influx: 680, amt: 1700, anomalies: 380 },
  { name: 'Sun', completion: 1400, influx: 680, amt: 1700, anomalies: 430 },
];

export default function AnalyticsView() {
  return (
    <div className="space-y-12 animate-fade-in relative z-10 pb-20">
      
      {/* Immersive Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
           <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-100 dark:bg-white/5 border border-amber-200 dark:border-white/10 text-amber-600 dark:text-amber-400 text-[10px] font-bold mb-4 uppercase tracking-widest">
             <Layers size={12} /> Global Telemetry
           </div>
           <h1 className="text-4xl lg:text-5xl font-black text-slate-900 dark:text-white tracking-tight leading-none mb-2">Metrics<br/>Engine.</h1>
           <p className="text-slate-500 dark:text-white/40 font-medium text-base max-w-lg mt-4">Correlating task throughput against system influx.</p>
        </div>
        
        <div className="flex gap-6 text-right">
           <div>
             <div className="text-4xl font-black text-slate-900 dark:text-white">99.8<span className="text-xl text-slate-400 dark:text-white/30">%</span></div>
             <div className="text-[10px] font-bold text-amber-500 dark:text-amber-400 uppercase tracking-widest mt-1">Uptime</div>
           </div>
           <div>
             <div className="text-4xl font-black text-slate-900 dark:text-white">12<span className="text-xl text-slate-400 dark:text-white/30">ms</span></div>
             <div className="text-[10px] font-bold text-emerald-500 dark:text-emerald-400 uppercase tracking-widest mt-1">Latency</div>
           </div>
        </div>
      </div>

      {/* Massive Composed Chart */}
      <div className="w-full h-[500px] eclipse-card p-6 relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-3/4 bg-amber-500/10 dark:bg-amber-500/10 rounded-full blur-[100px] -z-10"></div>
        <div className="flex justify-between items-center mb-6 z-10 relative px-4">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">System Throughput Analysis</h2>
          <button className="eclipse-btn-secondary py-1.5 px-3 text-xs">Run Deep Scan</button>
        </div>
        
        <div className="w-full h-[400px] relative z-10">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={complexData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
              <defs>
                <linearGradient id="colorInflux" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#fbbf24" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} dy={10} />
              <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} dx={-10} />
              <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} dx={10} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.02)' }} contentStyle={{ borderRadius: '16px', background: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)' }} />
              <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }} />
              
              <Area yAxisId="left" type="monotone" dataKey="influx" fill="url(#colorInflux)" stroke="#fbbf24" strokeWidth={2} name="Task Influx" />
              <Bar yAxisId="left" dataKey="completion" barSize={12} fill="#3b82f6" radius={[4, 4, 0, 0]} name="Completed" />
              <Line yAxisId="right" type="monotone" dataKey="amt" stroke="#ec4899" strokeWidth={3} dot={{ r: 4, fill: '#ec4899', strokeWidth: 0 }} name="Velocity" />
              <Scatter yAxisId="right" dataKey="anomalies" fill="#ef4444" name="Anomalies" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
         <div className="eclipse-card p-6 flex flex-col justify-center items-center text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-500 dark:text-emerald-400 flex items-center justify-center mb-4 animate-pulse">
               <Zap size={24} />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Systems Nominal</h3>
            <p className="text-sm text-slate-500 dark:text-white/40">No bottlenecks detected in the last 48 hours of operation.</p>
         </div>
         
         <div className="eclipse-card p-6">
            <h3 className="text-xs font-bold text-slate-500 dark:text-white/50 uppercase tracking-widest mb-4">Recent Anomaly Logs</h3>
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex items-center justify-between border-b border-slate-200 dark:border-white/5 pb-3 last:border-0 last:pb-0">
                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"></span>
                    <span className="text-sm font-medium text-slate-800 dark:text-white/80">Spike in Delay Statuses</span>
                  </div>
                  <span className="text-[10px] text-slate-400 dark:text-white/30">2h ago</span>
                </div>
              ))}
            </div>
         </div>
      </div>

    </div>
  );
}
