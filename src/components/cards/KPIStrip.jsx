import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Activity, CheckCircle2, Timer, ShieldAlert } from 'lucide-react';
import { isOverdue } from '../../data/mockData.js';

// Animate a number from 0 to target on mount
function useCountUp(target, duration = 600) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let start = null;
    const from = 0;
    const step = (ts) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      setVal(Math.round(from + (target - from) * p));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target]);
  return val;
}

function Sparkline({ values, stroke = '#6366F1' }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const w = 80, h = 24;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = values[values.length - 1];
  const lastY = h - ((last - min) / range) * h;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-20 h-6" preserveAspectRatio="none">
      <polyline
        points={pts}
        fill="none"
        stroke={stroke}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={w} cy={lastY} r="2.5" fill={stroke} />
    </svg>
  );
}

function Tile({ label, value, suffix, delta, iconBg, icon: Icon, iconColor, spark, sparkColor, kicker, deltaRed }) {
  const isUp = (delta ?? 0) >= 0;
  const deltaIsRed = deltaRed ?? !isUp;
  const animated = useCountUp(typeof value === 'number' ? value : 0);
  const display  = typeof value === 'number' ? animated : value;

  return (
    <div className="fd-card p-5 flex flex-col gap-3 hover:shadow-md transition-shadow duration-200 cursor-default">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9CA3AF]">{label}</p>
          <p className="mt-2 text-[28px] leading-none font-bold text-[#111827]">
            {display}
            {suffix && <span className="text-base font-medium text-[#9CA3AF] ml-0.5">{suffix}</span>}
          </p>
        </div>
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
          style={{ background: iconBg }}
        >
          <Icon className="h-4.5 w-4.5" style={{ color: iconColor }} size={18} />
        </div>
      </div>

      <div className="flex items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          {delta !== undefined && (
            <span
              className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full w-fit ${
                deltaIsRed
                  ? 'bg-[#FEF2F2] text-[#DC2626]'
                  : 'bg-[#DCFCE7] text-[#16A34A]'
              }`}
            >
              {isUp
                ? <TrendingUp className="h-3 w-3" />
                : <TrendingDown className="h-3 w-3" />}
              {Math.abs(delta)}%
            </span>
          )}
          {kicker && (
            <span className="text-[11px] text-[#9CA3AF] mt-0.5">{kicker}</span>
          )}
        </div>
        {spark && (
          <div className="opacity-70">
            <Sparkline values={spark} stroke={sparkColor} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function KPIStrip({ tasks }) {
  const total       = tasks.length;
  const done        = tasks.filter((t) => t.status === 'Done').length;
  const completion  = total ? Math.round((done / total) * 100) : 0;

  const doneTasks   = tasks.filter((t) => t.status === 'Done');
  const onTimeCount = doneTasks.filter((t) => {
    const lastStatus = [...(t.activity || [])].reverse().find((a) => a.type === 'status');
    const closedAt   = lastStatus ? new Date(lastStatus.at).getTime() : Date.now();
    return closedAt <= new Date(t.deadline).getTime();
  }).length;
  const onTimePct = doneTasks.length ? Math.round((onTimeCount / doneTasks.length) * 100) : 0;

  const cycleSamples = tasks.map((t) => {
    const start  = new Date(t.createdAt).getTime();
    const closed = (t.activity || []).find((a) => a.type === 'status');
    const end    = closed ? new Date(closed.at).getTime() : Date.now();
    return Math.max(0, (end - start) / (1000 * 60 * 60 * 24));
  });
  const avgCycle = cycleSamples.length
    ? cycleSamples.reduce((a, b) => a + b, 0) / cycleSamples.length
    : 0;

  const overdueCount   = tasks.filter(isOverdue).length;
  const escalatedCount = tasks.filter((t) => t.escalationLevel > 0).length;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger">
      <Tile
        label="Active Tasks"
        value={total}
        delta={12}
        icon={Activity}
        iconBg="#EDE9FE"
        iconColor="#7C3AED"
        spark={[8, 10, 9, 12, 11, 14, 13, 16, total]}
        sparkColor="#7C3AED"
        kicker={`${tasks.filter((t) => t.status !== 'Done').length} in motion`}
      />
      <Tile
        label="Completion Rate"
        value={completion}
        suffix="%"
        delta={4}
        icon={CheckCircle2}
        iconBg="#CCFBF1"
        iconColor="#0D9488"
        spark={[42, 48, 55, 52, 60, 64, 68, 72, completion]}
        sparkColor="#0D9488"
        kicker={`${done} of ${total} closed`}
      />
      <Tile
        label="On-Time Delivery"
        value={onTimePct}
        suffix="%"
        delta={onTimePct >= 75 ? 6 : -3}
        icon={Timer}
        iconBg="#DBEAFE"
        iconColor="#1D4ED8"
        spark={[68, 70, 74, 72, 78, 80, 76, 82, onTimePct]}
        sparkColor="#1D4ED8"
        kicker={`avg cycle ${avgCycle.toFixed(1)} d`}
      />
      <Tile
        label="Overdue / Escalated"
        value={overdueCount}
        delta={-8}
        deltaRed
        icon={ShieldAlert}
        iconBg="#FEF3C7"
        iconColor="#D97706"
        spark={[6, 5, 7, 4, 5, 3, 4, 2, overdueCount]}
        sparkColor="#EF4444"
        kicker={`${escalatedCount} escalated`}
      />
    </div>
  );
}
