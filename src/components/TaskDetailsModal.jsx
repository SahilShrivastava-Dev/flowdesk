import React, { useState } from 'react';
import Modal from './Modal.jsx';
import StatusBadge, { PriorityBadge } from './StatusBadge.jsx';
import Avatar from './Avatar.jsx';
import { findUser, isOverdue, daysUntil } from '../data/mockData.js';
import { useApp } from '../context/AppContext.jsx';
import { ShieldAlert, CheckCircle2, XCircle, RefreshCw, MessageCircle, Clock3, Paperclip, RotateCcw } from 'lucide-react';

const ACTIVITY_TONE = {
  created:    'bg-[#EDE9FE] text-[#6D28D9]',
  comment:    'bg-[#F3F4F6] text-[#374151]',
  status:     'bg-[#DCFCE7] text-[#166534]',
  escalation: 'bg-[#FEF2F2] text-[#B91C1C]',
  approval:   'bg-[#DCFCE7] text-[#166534]',
  retract:    'bg-[#FEF3C7] text-[#92400E]',
  reject:     'bg-[#FEF2F2] text-[#B91C1C]',
  reassign:   'bg-[#EFF6FF] text-[#1D4ED8]',
  whatsapp:   'bg-[#F0FDF4] text-[#166534]',
};

function AttachmentPreview({ url, compact = false }) {
  const isImage = /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(url) || url.includes('/image/upload/');
  const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(url) || url.includes('/video/upload/');

  if (isImage) {
    return (
      <div className={`mt-2 ${compact ? 'max-w-[220px]' : 'max-w-xs'}`}>
        <a href={url} target="_blank" rel="noopener noreferrer" className="group block relative">
          <img
            src={url}
            alt="Attachment"
            className={`w-full rounded-xl border border-[#E5E7EB] object-cover transition-opacity group-hover:opacity-90 ${compact ? 'max-h-36' : 'max-h-52'}`}
            onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }}
          />
          <span className="absolute bottom-2 right-2 bg-black/50 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
            View full size ↗
          </span>
        </a>
        <a href={url} target="_blank" rel="noopener noreferrer"
           className="mt-1 inline-flex items-center gap-1 text-[11px] text-[#6B7280] hover:text-[#1D4ED8] hover:underline">
          <Paperclip className="h-3 w-3" /> Open in new tab
        </a>
      </div>
    );
  }

  if (isVideo) {
    return (
      <div className="mt-2">
        <video
          src={url}
          controls
          className="max-h-48 max-w-xs rounded-xl border border-[#E5E7EB]"
        />
        <a href={url} target="_blank" rel="noopener noreferrer"
           className="mt-1 inline-flex items-center gap-1 text-[11px] text-[#6B7280] hover:text-[#1D4ED8] hover:underline">
          <Paperclip className="h-3 w-3" /> Open video
        </a>
      </div>
    );
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
       className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F3F4F6] text-xs font-medium text-[#374151] hover:bg-[#E5E7EB] transition-colors">
      <Paperclip className="h-3.5 w-3.5 text-[#6B7280]" />
      View attachment
    </a>
  );
}

function ActivityItem({ entry }) {
  const u    = findUser(entry.by);
  const time = new Date(entry.at).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  const tone = ACTIVITY_TONE[entry.type] || 'bg-[#F3F4F6] text-[#374151]';

  return (
    <li className="flex gap-3">
      {u ? (
        <Avatar user={u} size="sm" />
      ) : (
        <span className="inline-flex h-7 w-7 rounded-full bg-[#F3F4F6] items-center justify-center text-[10px] font-bold text-[#374151]">
          SYS
        </span>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#374151]">
          <span className="font-semibold text-[#111827]">{u?.name || 'System'}</span>
          {' '}<span className="text-[#9CA3AF]">— {entry.text}</span>
        </p>
        {entry.mediaUrl && <AttachmentPreview url={entry.mediaUrl} />}
        <div className="mt-1 flex items-center gap-2">
          <span className={`chip ${tone}`}>{entry.type}</span>
          <span className="text-[11px] text-[#9CA3AF]">{time}</span>
        </div>
      </div>
    </li>
  );
}

export default function TaskDetailsModal({ task, onClose }) {
  const { role, activeUser, users, setTaskStatus, approveTask, retractTask, rejectTask, reassignTask, escalateTask } = useApp();
  const [comment, setComment] = useState('');
  if (!task) return null;

  const assignee    = findUser(task.assignedTo);
  const assigner    = findUser(task.assignedBy);
  const overdue     = isOverdue(task);
  const days        = daysUntil(task.deadline);

  const isMyTask    = task.assignedTo === activeUser?.id;
  const isMyReport  = users.some((u) => u.id === task.assignedTo && u.reportingTo === activeUser?.id);
  // Can approve only if task is Done AND not yet approved
  const canApprove  = role !== 'Employee' && (isMyReport || role === 'Admin') && task.status === 'Done' && !task.approved;
  // Can retract if already approved (replaces the approve button)
  const canRetract  = role !== 'Employee' && (isMyReport || role === 'Admin') && task.approved;
  const canReassign = role !== 'Employee' && (isMyReport || role === 'Admin');
  const canEscalate = role !== 'Admin' && (isMyTask || isMyReport);

  const employeesOfRole = users.filter(
    (u) => u.role === 'Employee' && (role === 'Admin' || u.reportingTo === activeUser?.id)
  );

  return (
    <Modal
      open={!!task}
      onClose={onClose}
      title={task.title}
      subtitle={`${task.id} • Assigned by ${assigner?.name}`}
      maxWidth="max-w-3xl"
      footer={
        <div className="flex flex-wrap items-center justify-between w-full gap-2">
          <div className="flex flex-wrap gap-2">
            {role === 'Employee' && isMyTask && task.status !== 'Done' && (
              <>
                <button
                  className="fd-btn-primary bg-[#16A34A] hover:bg-[#15803D]"
                  onClick={() => setTaskStatus(task.id, 'Done', activeUser.id)}
                >
                  <CheckCircle2 className="h-4 w-4" /> Mark Done
                </button>
                <button
                  className="fd-btn-secondary"
                  onClick={() => setTaskStatus(task.id, 'Issue', activeUser.id)}
                >
                  <ShieldAlert className="h-4 w-4" /> Report Issue
                </button>
                <button
                  className="fd-btn-secondary"
                  onClick={() => setTaskStatus(task.id, 'Delay', activeUser.id)}
                >
                  <Clock3 className="h-4 w-4" /> Request Delay
                </button>
              </>
            )}
            {canApprove && (
              <>
                <button
                  className="fd-btn-primary bg-[#16A34A] hover:bg-[#15803D]"
                  onClick={() => approveTask(task.id, activeUser.id)}
                >
                  <CheckCircle2 className="h-4 w-4" /> Approve
                </button>
                <button
                  className="fd-btn-primary bg-[#B91C1C] hover:bg-[#991B1B]"
                  onClick={() => rejectTask(task.id, activeUser.id)}
                >
                  <XCircle className="h-4 w-4" /> Reject
                </button>
              </>
            )}
            {canRetract && (
              <button
                className="fd-btn-secondary border-amber-300 text-amber-700 hover:bg-amber-50"
                onClick={() => retractTask(task.id, activeUser.id)}
              >
                <RotateCcw className="h-4 w-4" /> Retract Approval
              </button>
            )}
            {canEscalate && (
              <button
                className="fd-btn-secondary"
                onClick={() => escalateTask(task.id, activeUser.id)}
              >
                <ShieldAlert className="h-4 w-4" /> Escalate
              </button>
            )}
            {canReassign && employeesOfRole.length > 0 && (
              <select
                onChange={(e) => e.target.value && reassignTask(task.id, e.target.value, activeUser.id)}
                className="fd-input max-w-[200px]"
                defaultValue=""
              >
                <option value="" disabled>Reassign to…</option>
                {employeesOfRole.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            )}
          </div>
          <button onClick={onClose} className="fd-btn-secondary">Close</button>
        </div>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Main content */}
        <div className="md:col-span-2 space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            {overdue && (
              <span className="chip bg-[#FEF2F2] text-[#B91C1C]">Overdue</span>
            )}
            {task.escalationLevel > 0 && (
              <span className="chip bg-[#FDF4FF] text-[#9333EA]">
                Escalated · L{task.escalationLevel}
              </span>
            )}
          </div>

          <p className="text-sm text-[#374151] leading-relaxed">{task.description}</p>

          {/* Custom fields */}
          <div>
            <p className="label">Custom Fields</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.entries(task.customFields || {}).map(([k, v]) => (
                <div
                  key={k}
                  className="rounded-xl bg-[#F9FAFB] px-3 py-2 border border-[#E5E7EB]"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">{k}</p>
                  <p className="text-sm text-[#111827] font-medium">{v}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Activity */}
          <div>
            <p className="label">Activity</p>
            <ul className="space-y-3">
              {task.activity?.map((a, i) => <ActivityItem key={i} entry={a} />)}
            </ul>
          </div>

          {/* WhatsApp Thread — built from real whatsapp-type activities */}
          {(() => {
            const waMessages = (task.activity ?? []).filter((a) => a.type === 'whatsapp');
            if (waMessages.length === 0) return null;
            return (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <MessageCircle className="h-4 w-4 text-[#16A34A]" />
                  <p className="label !mb-0">WhatsApp Thread</p>
                  <span className="text-[11px] text-[#9CA3AF]">{waMessages.length} message{waMessages.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="rounded-xl border border-[#E5E7EB] bg-[#F0FDF4] p-3 space-y-3 max-h-72 overflow-y-auto thin-scrollbar">
                  {waMessages.map((msg, i) => {
                    const sender = findUser(msg.by);
                    const time   = new Date(msg.at).toLocaleString('en-IN', {
                      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                    });
                    const isPureAttachment = msg.text === '📎 Attachment received';
                    return (
                      <div key={i} className="flex items-end gap-2 justify-end">
                        <div className="max-w-[80%]">
                          {/* Image/attachment preview in bubble */}
                          {msg.mediaUrl && (
                            <AttachmentPreview url={msg.mediaUrl} compact />
                          )}
                          {/* Text bubble — skip if purely an attachment with no message */}
                          {!isPureAttachment && (
                            <div className="bg-white border border-[#E5E7EB] rounded-2xl rounded-br-md px-3 py-2 mt-1 shadow-sm">
                              <p className="text-sm text-[#111827]">{msg.text}</p>
                            </div>
                          )}
                          <p className="text-[10px] text-[#9CA3AF] mt-1 text-right">
                            {sender?.name ?? 'Unknown'} · {time}
                          </p>
                        </div>
                        <Avatar user={sender} size="sm" />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          <div className="fd-card p-4">
            <p className="label">Assignee</p>
            <div className="flex items-center gap-3">
              <Avatar user={assignee} size="lg" />
              <div>
                <p className="text-sm font-semibold text-[#111827]">{assignee?.name}</p>
                <p className="text-[11px] text-[#9CA3AF]">{assignee?.role} · {assignee?.id}</p>
              </div>
            </div>
          </div>

          <div className="fd-card p-4">
            <p className="label">Deadline</p>
            <p className={`text-lg font-bold tabular-nums ${overdue ? 'text-[#B91C1C]' : 'text-[#111827]'}`}>
              {new Date(task.deadline).toLocaleDateString('en-IN', {
                day: '2-digit', month: 'short', year: 'numeric',
              })}
            </p>
            <p className="text-xs text-[#9CA3AF]">
              {overdue
                ? `${Math.abs(days)} day(s) overdue`
                : days === 0
                  ? 'Due today'
                  : `${days} day(s) remaining`}
            </p>
          </div>

          <div className="fd-card p-4">
            <p className="label">Hierarchy</p>
            <ol className="text-sm space-y-2">
              <li className="flex items-center gap-2">
                <Avatar user={assigner} size="sm" />
                <span className="text-[#111827] font-medium">{assigner?.name}</span>
                <span className="text-[#9CA3AF] text-[11px]">({assigner?.role})</span>
              </li>
              <li className="ml-3 border-l-2 border-dashed border-[#E5E7EB] pl-3 py-1 text-[11px] text-[#9CA3AF] flex items-center gap-1">
                <RefreshCw className="h-3 w-3" /> assigned
              </li>
              <li className="flex items-center gap-2">
                <Avatar user={assignee} size="sm" />
                <span className="text-[#111827] font-medium">{assignee?.name}</span>
                <span className="text-[#9CA3AF] text-[11px]">({assignee?.role})</span>
              </li>
            </ol>
          </div>
        </aside>
      </div>
    </Modal>
  );
}
