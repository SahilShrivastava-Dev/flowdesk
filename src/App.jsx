import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AppProvider, useApp } from './context/AppContext.jsx';
import { isLoggedIn, getSavedUser, clearSession } from './lib/auth.js';
import LoginView from './views/LoginView.jsx';
import {
  Search, Bell, Moon, Sun, ChevronDown, Plus, LogOut, X,
} from 'lucide-react';

import AdminDashboard    from './views/AdminDashboard.jsx';
import ManagerDashboard  from './views/ManagerDashboard.jsx';
import EmployeeDashboard from './views/EmployeeDashboard.jsx';
import TasksView         from './views/TasksView.jsx';
import AnalyticsView     from './views/AnalyticsView.jsx';
import TeamView          from './views/TeamView.jsx';
import EscalationsView   from './views/EscalationsView.jsx';
import ApprovalsView     from './views/ApprovalsView.jsx';
import WhatsAppHub       from './views/WhatsAppHub.jsx';
import TaskDetailsModal  from './components/TaskDetailsModal.jsx';
import CreateTaskModal   from './components/CreateTaskModal.jsx';

// ── Role-based navigation config ─────────────────────────────────────────────
const NAV_BY_ROLE = {
  Admin: [
    { id: 'Dashboard',   label: 'Dashboard'   },
    { id: 'Tasks',       label: 'Tasks'        },
    { id: 'Analytic',    label: 'Analytic'     },
    { id: 'Team',        label: 'Team'         },
    { id: 'Escalations', label: 'Timeline'  },
    { id: 'Tracker',     label: 'Tracker'      },
  ],
  Manager: [
    { id: 'Dashboard', label: 'Dashboard' },
    { id: 'Tasks',     label: 'Tasks'     },
    { id: 'Approvals', label: 'Approvals' },
    { id: 'Team',      label: 'Team'      },
    { id: 'Tracker',   label: 'Tracker'   },
  ],
  Employee: [
    { id: 'MyDay',    label: 'My Day'    },
    { id: 'MyTasks',  label: 'My Tasks'  },
    { id: 'Tracker',  label: 'Tracker'   },
  ],
};

const DEFAULT_TAB = { Admin: 'Dashboard', Manager: 'Dashboard', Employee: 'MyDay' };
const ROLES = ['Admin', 'Manager', 'Employee'];

// ── Search overlay ────────────────────────────────────────────────────────────
function SearchOverlay({ onClose }) {
  const { tasks, setSearch } = useApp();
  const [q, setQ] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // close on Escape
  useEffect(() => {
    const fn = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  const results = q
    ? tasks.filter((t) =>
        t.title.toLowerCase().includes(q.toLowerCase()) ||
        t.id.toLowerCase().includes(q.toLowerCase())
      ).slice(0, 6)
    : [];

  return (
    <div
      className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-start justify-center pt-24 px-4"
      onClick={onClose}
    >
      <div
        className="fd-card w-full max-w-lg shadow-2xl animate-pop-in overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#F3F4F6]">
          <Search className="h-4 w-4 text-[#9CA3AF] shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 text-sm bg-transparent outline-none text-[#111827] placeholder:text-[#9CA3AF]"
            placeholder="Search tasks, IDs, people…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setSearch(e.target.value); }}
          />
          <button onClick={onClose}><X className="h-4 w-4 text-[#9CA3AF]" /></button>
        </div>
        {results.length > 0 ? (
          <ul className="divide-y divide-[#F3F4F6] max-h-72 overflow-y-auto thin-scrollbar">
            {results.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => { setSearch(''); onClose(); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#F9FAFB] transition-colors"
                >
                  <span className="num text-[11px] text-[#9CA3AF] w-16 shrink-0">{t.id}</span>
                  <span className="text-sm font-medium text-[#111827] truncate">{t.title}</span>
                  <span className={`ml-auto shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                    t.status === 'Done'    ? 'bg-[#DCFCE7] text-[#166534]' :
                    t.status === 'Pending' ? 'bg-[#EFF6FF] text-[#1D4ED8]' :
                    t.status === 'Delay'   ? 'bg-[#FFFBEB] text-[#B45309]' :
                                             'bg-[#FEF2F2] text-[#B91C1C]'
                  }`}>{t.status}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : q ? (
          <p className="px-4 py-6 text-sm text-center text-[#9CA3AF]">No tasks match "{q}"</p>
        ) : (
          <p className="px-4 py-4 text-xs text-center text-[#9CA3AF]">Start typing to search tasks…</p>
        )}
      </div>
    </div>
  );
}

// ── Notifications panel ───────────────────────────────────────────────────────
const TYPE_DOT = {
  whatsapp:   'bg-[#0EA5E9]',
  escalation: 'bg-[#EF4444]',
  status:     'bg-[#8B5CF6]',
  approval:   'bg-[#22C55E]',
};

function relativeTime(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function NotifPanel({ onClose, onNavigate, onOpenTask }) {
  const { notifications, markAllRead, notifLastSeen, tasks } = useApp();
  const ref = useRef(null);

  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [onClose]);

  const handleClick = (n) => {
    markAllRead();
    onClose();
    // Find the task object so we can open its detail modal
    const taskId = n.taskId;
    if (taskId) {
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        // Navigate to Tasks tab first, then open the detail modal
        onNavigate('Tasks');
        // Small delay so the tab renders before the modal tries to open
        setTimeout(() => onOpenTask(task), 50);
        return;
      }
    }
    // No task linked — just navigate to Tasks tab
    onNavigate('Tasks');
  };

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-2 w-80 bg-white border border-[#E5E7EB] rounded-2xl shadow-xl z-50 overflow-hidden animate-pop-in"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#F3F4F6]">
        <p className="text-sm font-bold text-[#111827]">Notifications</p>
        <button onClick={markAllRead} className="text-xs font-semibold text-[#1E1B3A] hover:underline">
          Mark all read
        </button>
      </div>
      <ul className="max-h-72 overflow-y-auto thin-scrollbar divide-y divide-[#F3F4F6]">
        {notifications.length === 0 && (
          <li className="px-4 py-6 text-sm text-center text-[#9CA3AF]">All caught up!</li>
        )}
        {notifications.map((n) => {
          const heading  = n.title  || n.text    || n.message || '';
          const subtext  = n.detail || n.taskTitle || '';
          const timeStr  = n.createdAt ? relativeTime(n.createdAt) : (n.time ?? 'just now');
          const isUnread = n.createdAt
            ? new Date(n.createdAt) > new Date(notifLastSeen)
            : (n.unread ?? false);
          const dotCls   = TYPE_DOT[n.type] || 'bg-[#6366F1]';
          const isClickable = !!n.taskId;

          return (
            <li
              key={n.id}
              onClick={() => handleClick(n)}
              className={`flex gap-3 px-4 py-3 transition-colors
                ${isUnread ? 'bg-[#FAFBFF]' : ''}
                ${isClickable
                  ? 'cursor-pointer hover:bg-[#F5F3FF] active:bg-[#EDE9FE]'
                  : 'cursor-default'}`}
            >
              <span className={`w-2 h-2 rounded-full ${dotCls} shrink-0 mt-1.5 ${isUnread ? 'opacity-100' : 'opacity-0'}`} />
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium leading-snug ${isUnread ? 'text-[#111827]' : 'text-[#374151]'}`}>
                  {heading}
                </p>
                {subtext && <p className="text-[11px] text-[#6B7280] mt-0.5 truncate">{subtext}</p>}
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-[11px] text-[#9CA3AF]">{timeStr}</p>
                  {isClickable && (
                    <span className="text-[10px] font-semibold text-[#7C3AED] opacity-0 group-hover:opacity-100">
                      View task →
                    </span>
                  )}
                </div>
              </div>
              {isClickable && (
                <span className="shrink-0 self-center text-[#C4B5FD] text-xs">›</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── User dropdown ─────────────────────────────────────────────────────────────
function UserDropdown({ user, onLogout, onRoleSwitch }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { role } = useApp();

  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  const initials = user?.name?.split(' ').map((w) => w[0]).join('').slice(0, 2) || 'AM';
  const colors = {
    Admin:    'from-fuchsia-500 to-purple-600',
    Manager:  'from-rose-500 to-orange-500',
    Employee: 'from-sky-500 to-indigo-500',
  };
  const grad = colors[role] || colors.Admin;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-gray-100 transition-colors"
      >
        <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${grad} flex items-center justify-center text-white text-xs font-bold select-none`}>
          {initials}
        </div>
        <div className="hidden sm:block text-left">
          <p className="text-xs font-semibold text-[#111827] leading-none">{user?.name || 'Aarav M'}</p>
          <p className="text-[10px] text-[#9CA3AF] leading-none mt-0.5">{user?.email || 'aarav@flowdesk.io'}</p>
        </div>
        <ChevronDown size={14} className={`text-[#9CA3AF] transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 bg-white border border-[#E5E7EB] rounded-2xl shadow-xl z-50 overflow-hidden animate-pop-in">
          <div className="px-4 py-3 border-b border-[#F3F4F6]">
            <p className="text-[10px] font-bold tracking-widest uppercase text-[#9CA3AF]">Switch Role</p>
          </div>
          {ROLES.map((r) => (
            <button
              key={r}
              onClick={() => { onRoleSwitch(r); setOpen(false); }}
              className={`w-full text-left px-4 py-2.5 text-sm font-medium transition-colors ${
                role === r ? 'bg-[#1E1B3A] text-white' : 'text-[#374151] hover:bg-gray-50'
              }`}
            >
              {r} view
            </button>
          ))}
          <div className="border-t border-[#F3F4F6]">
            <button
              onClick={() => { setOpen(false); onLogout(); }}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-[#B91C1C] hover:bg-red-50 transition-colors"
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main shell ────────────────────────────────────────────────────────────────
function FlowDeskShell({ onLogout }) {
  const { activeUser, role, setRole, theme, toggleTheme, unreadCount, tasksLoading } = useApp();
  const [activeTab, setActiveTab]   = useState(() => DEFAULT_TAB[role] || 'Dashboard');
  const [openTaskId, setOpenTaskId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen,  setNotifOpen]  = useState(false);
  const notifRef = useRef(null);

  // Reset tab when role changes
  useEffect(() => {
    setActiveTab(DEFAULT_TAB[role] || 'Dashboard');
  }, [role]);

  // Keyboard shortcut: Cmd/Ctrl+K → search
  useEffect(() => {
    const fn = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const navItems = NAV_BY_ROLE[role] || NAV_BY_ROLE.Admin;

  const isDashboardTab =
    (role === 'Employee' && activeTab === 'MyDay') ||
    (role !== 'Employee' && activeTab === 'Dashboard');

  function renderView() {
    // Pass task ID (not object) so the modal always reads the live task from context
    const openTask = (t) => setOpenTaskId(t?.id ?? t ?? null);
    const props = { onOpenTask: openTask, onNavigate: setActiveTab };
    if (role === 'Admin') {
      switch (activeTab) {
        case 'Dashboard':   return <AdminDashboard   {...props} />;
        case 'Tasks':       return <TasksView        {...props} />;
        case 'Analytic':    return <AnalyticsView />;
        case 'Team':        return <TeamView />;
        case 'Escalations': return <EscalationsView  {...props} />;
        case 'Tracker':     return <WhatsAppHub />;
        default:            return <AdminDashboard   {...props} />;
      }
    }
    if (role === 'Manager') {
      switch (activeTab) {
        case 'Dashboard': return <ManagerDashboard {...props} />;
        case 'Tasks':     return <TasksView        {...props} />;
        case 'Approvals': return <ApprovalsView    {...props} />;
        case 'Team':      return <TeamView />;
        case 'Tracker':   return <WhatsAppHub />;
        default:          return <ManagerDashboard {...props} />;
      }
    }
    if (role === 'Employee') {
      switch (activeTab) {
        case 'MyDay':    return <EmployeeDashboard {...props} />;
        case 'MyTasks':  return <TasksView         {...props} />;
        case 'Tracker':  return <WhatsAppHub />;
        default:         return <EmployeeDashboard {...props} />;
      }
    }
    return <AdminDashboard {...props} />;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: '#ECEDF5' }}>

      {/* ── Navbar ──────────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 pt-4 z-40">
        <nav className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm max-w-[1400px] mx-auto px-4 py-2.5 flex items-center gap-3">

          {/* Logo */}
          <div className="flex items-center gap-2 mr-2 shrink-0 cursor-pointer" onClick={() => setActiveTab(DEFAULT_TAB[role])}>
            <div className="w-8 h-8 rounded-full bg-[#1E1B3A] flex items-center justify-center text-white text-sm font-black select-none">
              F
            </div>
            <span className="text-sm font-bold text-[#111827] hidden sm:block">FlowDesk</span>
          </div>

          {/* Nav pills */}
          <div className="flex items-center gap-1 flex-1 overflow-x-auto no-scrollbar">
            {navItems.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`whitespace-nowrap transition-all duration-200 ${
                  activeTab === id ? 'fd-nav-pill-active' : 'fd-nav-pill'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Search */}
            <button
              onClick={() => setSearchOpen(true)}
              title="Search (⌘K)"
              className="w-9 h-9 rounded-full flex items-center justify-center text-[#6B7280] hover:bg-gray-100 hover:text-[#111827] transition-colors"
            >
              <Search size={16} />
            </button>

            {/* Bell */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setNotifOpen((v) => !v)}
                className="relative w-9 h-9 rounded-full flex items-center justify-center text-[#6B7280] hover:bg-gray-100 hover:text-[#111827] transition-colors"
              >
                <Bell size={16} />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white" />
                )}
              </button>
              {notifOpen && (
                <NotifPanel
                  onClose={() => setNotifOpen(false)}
                  onNavigate={setActiveTab}
                  onOpenTask={(t) => setOpenTaskId(t?.id ?? t ?? null)}
                />
              )}
            </div>

            {/* Dark mode */}
            <button
              onClick={toggleTheme}
              className="w-9 h-9 rounded-full flex items-center justify-center text-[#6B7280] hover:bg-gray-100 hover:text-[#111827] transition-colors"
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            <div className="w-px h-5 bg-[#E5E7EB] mx-1" />

            <UserDropdown
              user={activeUser}
              onLogout={onLogout}
              onRoleSwitch={(r) => setRole(r)}
            />
          </div>
        </nav>
      </div>

      {/* ── Server warm-up banner ────────────────────────────────────── */}
      {tasksLoading && (
        <div className="shrink-0 mx-4 mt-2">
          <div className="max-w-[1400px] mx-auto flex items-center gap-2.5 px-4 py-2 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] text-[#92400E] text-xs font-medium">
            <span className="w-3.5 h-3.5 border-2 border-[#F59E0B]/40 border-t-[#F59E0B] rounded-full animate-spin shrink-0" />
            Server is waking up — data will appear in a few seconds…
          </div>
        </div>
      )}

      {/* ── Page Content ─────────────────────────────────────────────── */}
      <main className="flex-1 min-h-0 overflow-y-auto px-4 py-5">
        <div className="max-w-[1400px] mx-auto pb-10">

          {/* Dashboard page header (role-aware) */}
          {isDashboardTab && (
            <div className="flex items-start justify-between mb-5 animate-fade-in">
              <div>
                <h1 className="text-xl font-bold text-[#111827]">CaratSense × Client Team</h1>
                <p className="text-sm text-[#6B7280] mt-0.5">
                  WhatsApp-driven task operations · ID FD-2026-OPS{' '}
                  <button
                    onClick={() => navigator.clipboard?.writeText('FD-2026-OPS')}
                    className="inline-flex text-[#9CA3AF] hover:text-[#6B7280] transition-colors ml-0.5"
                    title="Copy ID"
                  >
                    📋
                  </button>
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex -space-x-2">
                  {[
                    'from-fuchsia-500 to-purple-600',
                    'from-rose-500 to-orange-500',
                    'from-sky-500 to-indigo-500',
                    'from-emerald-500 to-teal-500',
                  ].map((c, i) => (
                    <div key={i} className={`w-8 h-8 rounded-full bg-gradient-to-br ${c} border-2 border-white`} />
                  ))}
                  <div className="w-8 h-8 rounded-full bg-[#E5E7EB] border-2 border-white flex items-center justify-center text-[10px] font-bold text-[#6B7280]">
                    +7
                  </div>
                </div>
                <button onClick={() => setCreateOpen(true)} className="fd-btn-primary">
                  <Plus size={14} /> New Task
                </button>
              </div>
            </div>
          )}

          {/* View — key forces re-mount + fade-in on tab change */}
          <div key={`${role}-${activeTab}`} className="animate-fade-in">
            {renderView()}
          </div>

          {/* Footer */}
          <p className="mt-10 text-center text-xs text-[#9CA3AF]">
            © FlowDesk · WhatsApp Task Operations · demo build
          </p>
        </div>
      </main>

      {/* Modals */}
      <TaskDetailsModal taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
      <CreateTaskModal  open={createOpen}  onClose={() => setCreateOpen(false)} />

      {/* Search overlay */}
      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [authed,      setAuthed]      = useState(isLoggedIn);
  const [loggedInUser, setLoggedInUser] = useState(getSavedUser);

  if (!authed) {
    return <LoginView onLogin={(u) => { setLoggedInUser(u); setAuthed(true); }} />;
  }

  return (
    <AppProvider loggedInUser={loggedInUser}>
      <FlowDeskShell onLogout={() => { clearSession(); setAuthed(false); setLoggedInUser(null); }} />
    </AppProvider>
  );
}
