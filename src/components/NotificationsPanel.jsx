import React, { useEffect, useRef } from 'react';
import { ShieldAlert, MessageCircle, CheckCheck, Clock3, Sparkles, X, Activity } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';

const ICONS = {
  escalation: { Icon: ShieldAlert,   cls: 'text-rose-600 bg-rose-50 dark:bg-rose-500/10 dark:text-rose-300' },
  approval:   { Icon: CheckCheck,    cls: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-300' },
  whatsapp:   { Icon: MessageCircle, cls: 'text-teal-600 bg-teal-50 dark:bg-teal-500/10 dark:text-teal-300' },
  status:     { Icon: Activity,      cls: 'text-blue-600 bg-blue-50 dark:bg-blue-500/10 dark:text-blue-300' },
  overdue:    { Icon: Clock3,        cls: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300' },
  system:     { Icon: Sparkles,      cls: 'text-brand-600 bg-brand-50 dark:bg-brand-500/10 dark:text-brand-300' },
};

function relativeTime(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} day(s) ago`;
}

export default function NotificationsPanel({ onClose }) {
  const { notifications, markAllRead, notifLastSeen } = useApp();
  const panelRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className="absolute right-0 mt-2 w-[380px] max-w-[92vw] card p-0 overflow-hidden animate-pop-in z-50"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-ink-200 dark:border-white/[.06]">
        <div>
          <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">Notifications</p>
          <p className="text-[11px] text-ink-500 dark:text-ink-400">Latest activity across your team</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={markAllRead} className="text-xs font-medium text-brand-600 hover:text-brand-700">
            Mark all read
          </button>
          <button onClick={onClose} className="btn-ghost h-7 w-7 p-0 justify-center">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <ul className="max-h-[60vh] overflow-y-auto divide-y divide-ink-100 dark:divide-white/[.04]">
        {notifications.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-ink-400 dark:text-ink-500">
            No notifications yet
          </li>
        )}
        {notifications.map((n) => {
          const meta = ICONS[n.type] || ICONS.system;
          const Icon = meta.Icon;

          // Support both API format (createdAt) and mock format (unread, time)
          const isUnread = n.createdAt
            ? new Date(n.createdAt) > new Date(notifLastSeen)
            : (n.unread ?? false);
          const timeStr = n.createdAt ? relativeTime(n.createdAt) : (n.time ?? '');

          return (
            <li
              key={n.id}
              className={`flex items-start gap-3 px-4 py-3 ${isUnread ? 'bg-brand-50/30 dark:bg-brand-500/5' : ''}`}
            >
              <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.cls}`}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-900 dark:text-ink-50 truncate">{n.title}</p>
                <p className="text-xs text-ink-500 dark:text-ink-400 mt-0.5 line-clamp-2">{n.detail}</p>
                {n.taskTitle && (
                  <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-0.5 truncate italic">
                    {n.taskTitle}
                  </p>
                )}
                <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-1">{timeStr}</p>
              </div>
              {isUnread && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
