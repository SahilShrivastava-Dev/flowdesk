import React from 'react';
import { useApp } from '../context/AppContext.jsx';
import { directReports, findUser } from '../data/mockData.js';
import Avatar from '../components/Avatar.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { CheckSquare } from 'lucide-react';

export default function ApprovalsView({ onOpenTask }) {
  const { tasks, activeUser, role, approveTask, rejectTask } = useApp();

  const scope = role === 'Admin'
    ? tasks
    : tasks.filter((t) => directReports(activeUser.id).some((u) => u.id === t.assignedTo));

  const pending = scope.filter((t) => t.status === 'Done' && !t.approved);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#9CA3AF]">Approvals</p>
          <h2 className="text-xl font-bold text-[#111827] mt-0.5">Pending your review</h2>
          <p className="text-sm text-[#6B7280] mt-0.5">
            Employees mark tasks as Done via WhatsApp. Approve or send back for rework.
          </p>
        </div>
        <span className="inline-flex items-center px-3 py-1 rounded-full bg-[#DCFCE7] text-xs font-semibold text-[#166534]">
          {pending.length} waiting
        </span>
      </div>

      {pending.length === 0 ? (
        <div className="fd-card p-12 text-center">
          <CheckSquare className="h-7 w-7 mx-auto text-[#22C55E] mb-2" />
          <p className="text-sm font-semibold text-[#111827]">Inbox zero.</p>
          <p className="text-xs text-[#9CA3AF] mt-1">New approvals will appear here as they come in.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {pending.map((t) => {
            const u = findUser(t.assignedTo);
            return (
              <li key={t.id} className="fd-card p-4 flex flex-wrap items-center gap-3 animate-fade-in">
                <Avatar user={u} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-[#111827] truncate">{t.title}</p>
                    <StatusBadge status={t.status} />
                  </div>
                  <p className="num text-[11px] text-[#9CA3AF]">{t.id} · submitted by {u?.name}</p>
                  <p className="text-sm text-[#374151] mt-1 line-clamp-2">{t.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => approveTask(t.id, activeUser.id)}
                    className="fd-btn-primary bg-[#16A34A] hover:bg-[#15803D]"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => rejectTask(t.id, activeUser.id)}
                    className="fd-btn-secondary"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => onOpenTask(t)}
                    className="fd-btn-secondary border-transparent bg-transparent"
                  >
                    Details
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
