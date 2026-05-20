import React, { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import Avatar from '../components/Avatar.jsx';
import AddMemberModal from '../components/AddMemberModal.jsx';
import { directReports } from '../data/mockData.js';
import { UserPlus } from 'lucide-react';

function ProgressBar({ pct }) {
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 h-1.5 rounded-full bg-[#F3F4F6] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-[#22C55E]' : 'bg-[#3B82F6]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="num text-xs font-semibold text-[#374151] w-8 text-right shrink-0">
        {pct}%
      </span>
    </div>
  );
}

function PersonRow({ user, depth = 0 }) {
  const { tasks } = useApp();
  const reports   = directReports(user.id);
  const my        = tasks.filter((t) => t.assignedTo === user.id);
  const done      = my.filter((t) => t.status === 'Done').length;
  const score     = my.length ? Math.round((done / my.length) * 100) : 0;

  const roleStyle = {
    Admin:    { bg: 'bg-[#EDE9FE]', text: 'text-[#6D28D9]' },
    Manager:  { bg: 'bg-[#DBEAFE]', text: 'text-[#1D4ED8]' },
    Employee: { bg: 'bg-[#F3F4F6]', text: 'text-[#374151]' },
  }[user.role] || { bg: 'bg-[#F3F4F6]', text: 'text-[#374151]' };

  return (
    <div>
      <div className="fd-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:shadow-md transition-shadow">
        {/* Left: avatar + info */}
        <div className="flex items-center gap-4">
          <Avatar user={user} size={depth === 0 ? 'lg' : 'md'} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-bold text-[#111827] text-sm">{user.name}</p>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${roleStyle.bg} ${roleStyle.text}`}>
                {user.role}
              </span>
            </div>
            <p className="text-xs text-[#9CA3AF] mt-0.5">{user.email}</p>
          </div>
        </div>

        {/* Right: progress + task count */}
        <div className="sm:min-w-[220px] sm:max-w-[280px] w-full">
          {user.role !== 'Admin' ? (
            <>
              <ProgressBar pct={score} />
              <p className="text-xs text-[#9CA3AF] mt-1">
                {my.length} task{my.length !== 1 ? 's' : ''} · {done} done
                {my.filter(t => t.escalationLevel > 0).length > 0 && (
                  <span className="ml-2 text-[#B91C1C]">
                    · {my.filter(t => t.escalationLevel > 0).length} escalated
                  </span>
                )}
              </p>
            </>
          ) : (
            <p className="text-xs text-[#9CA3AF]">
              {my.length} tasks assigned · Admin access
            </p>
          )}
        </div>
      </div>

      {/* Direct reports — indented */}
      {reports.length > 0 && (
        <div
          className={`mt-3 space-y-3 ${
            depth === 0
              ? 'ml-6 pl-5 border-l-2 border-[#E5E7EB]'
              : 'ml-4 pl-4 border-l border-[#E5E7EB]'
          }`}
        >
          {reports.map((r) => (
            <PersonRow key={r.id} user={r} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function TeamView() {
  const { users, role, activeUser, tasks } = useApp();
  const [addOpen, setAddOpen] = useState(false);

  const root = role === 'Admin'
    ? users.find((u) => u.role === 'Admin')
    : activeUser;

  const stats = useMemo(() => {
    const total    = users.length;
    const managers = users.filter((u) => u.role === 'Manager').length;
    const employees= users.filter((u) => u.role === 'Employee').length;
    const activeTaskCount = tasks.filter((t) => t.status !== 'Done').length;
    return { total, managers, employees, activeTaskCount };
  }, [users, tasks]);

  return (
    <div className="space-y-5">
      <AddMemberModal open={addOpen} onClose={() => setAddOpen(false)} />

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#9CA3AF]">Org Chart</p>
          <h2 className="text-xl font-bold text-[#111827] mt-0.5">Organization</h2>
          <p className="text-sm text-[#6B7280] mt-0.5">
            Hierarchy drives escalation. Tasks bubble up to whoever each person reports to.
          </p>
        </div>
        {role === 'Admin' && (
          <button
            className="fd-btn-primary shrink-0 self-start"
            onClick={() => setAddOpen(true)}
          >
            <UserPlus className="h-4 w-4" />
            Add Member
          </button>
        )}
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Members', value: stats.total,          bg: '#EDE9FE', color: '#7C3AED' },
          { label: 'Managers',      value: stats.managers,       bg: '#DBEAFE', color: '#1D4ED8' },
          { label: 'Employees',     value: stats.employees,      bg: '#F3F4F6', color: '#374151' },
          { label: 'Active Tasks',  value: stats.activeTaskCount,bg: '#DCFCE7', color: '#166534' },
        ].map(({ label, value, bg, color }) => (
          <div key={label} className="fd-card p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: bg }}>
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">{label}</p>
              <p className="text-xl font-bold text-[#111827] leading-none mt-0.5">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tree */}
      <div className="space-y-3">
        {root && <PersonRow user={root} />}
      </div>
    </div>
  );
}
