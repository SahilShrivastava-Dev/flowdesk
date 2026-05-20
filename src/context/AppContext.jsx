import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { initialTasks, initialNotifications, users as mockUsers, setRuntimeUsers } from '../data/mockData.js';
import { api } from '../lib/api.js';
import { isLoggedIn, getSavedUser } from '../lib/auth.js';

const AppContext = createContext(null);

// Demo role → canonical seed user ID
const ROLE_TO_USER = {
  Admin:    'U001',
  Manager:  'U010',
  Employee: 'U102',
};

// Normalise a Prisma task to the shape components expect
function normaliseTask(t) {
  return {
    id: t.id,
    title: t.title,
    description: t.description ?? '',
    assignedTo: t.assignedToId ?? t.assignedTo,
    assignedBy: t.assignedById ?? t.assignedBy,
    status: t.status,
    priority: t.priority,
    deadline: t.deadline,
    createdAt: t.createdAt,
    escalationLevel: t.escalationLevel ?? 0,
    approved: t.approved ?? false,
    customFields: t.customFields ?? {},
    activity: (t.activities ?? t.activity ?? []).map((a) => ({
      at:       a.createdAt ?? a.at,
      by:       a.byId ?? a.by,
      type:     a.type,
      text:     a.text,
      mediaUrl: a.mediaUrl ?? null,
    })),
  };
}

// Normalise a Prisma user so both reportingTo and reportingToId are set
function normaliseUser(u) {
  return {
    ...u,
    reportingTo: u.reportingToId ?? u.reportingTo ?? null,
    reportingToId: u.reportingToId ?? u.reportingTo ?? null,
  };
}

const usingApi = isLoggedIn();

export function AppProvider({ children, loggedInUser }) {
  // ── Theme ──────────────────────────────────────────────────────────
  const [theme, setTheme] = useState(() => localStorage.getItem('flowdesk-theme') || 'light');
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark'); else root.classList.remove('dark');
    localStorage.setItem('flowdesk-theme', theme);
  }, [theme]);
  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  // ── Role / active user ─────────────────────────────────────────────
  const defaultRole = loggedInUser?.role ?? 'Admin';
  const [role, setRole] = useState(defaultRole);

  // ── Users ──────────────────────────────────────────────────────────
  const [users, setUsersState] = useState(mockUsers.map(normaliseUser));

  useEffect(() => {
    if (!usingApi) return;
    api.get('/api/users').then((data) => {
      if (data) {
        const normalised = data.map(normaliseUser);
        setUsersState(normalised);
        setRuntimeUsers(normalised); // keep findUser / directReports in sync
      }
    }).catch(console.error);
  }, []);

  // Keep mockData helpers in sync whenever users change
  useEffect(() => { setRuntimeUsers(users); }, [users]);

  const addUser = useCallback(async (userData) => {
    if (usingApi) {
      // Backend hashes the password; throws on 409 duplicate email
      const created = await api.post('/api/users', userData);
      if (created) {
        setUsersState((prev) => [...prev, normaliseUser(created)]);
      }
    } else {
      // Mock mode — generate a local ID, no real auth
      const { password: _pw, ...rest } = userData; // strip password from mock state
      setUsersState((prev) => [
        ...prev,
        normaliseUser({
          id: `U${900 + prev.length}`,
          createdAt: new Date().toISOString(),
          ...rest,
        }),
      ]);
    }
  }, []);

  const activeUser = useMemo(
    () => users.find((u) => u.id === ROLE_TO_USER[role]) ?? loggedInUser ?? users[0],
    [role, users, loggedInUser]
  );

  // ── Tasks ──────────────────────────────────────────────────────────
  const [tasks, setTasks] = useState(() =>
    usingApi ? [] : initialTasks.map(normaliseTask)
  );
  const pollingRef = useRef(null);

  const fetchTasks = useCallback(async () => {
    try {
      const data = await api.get('/api/tasks');
      if (data) setTasks(data.map(normaliseTask));
    } catch (err) {
      console.error('[AppContext] fetchTasks', err);
    }
  }, []);

  useEffect(() => {
    if (!usingApi) return;
    fetchTasks();
    pollingRef.current = setInterval(fetchTasks, 30_000);
    return () => clearInterval(pollingRef.current);
  }, [fetchTasks]);

  // ── Task mutations ─────────────────────────────────────────────────

  const addTask = useCallback(async (task) => {
    if (usingApi) {
      try {
        // Backend expects `assignedToId`; the frontend uses `assignedTo`
        const { assignedTo, assignedBy, ...rest } = task;
        const payload = { ...rest, assignedToId: assignedTo };
        const created = await api.post('/api/tasks', payload);
        if (created) setTasks((prev) => [normaliseTask(created), ...prev]);
      } catch (err) { console.error(err); }
    } else {
      setTasks((prev) => [
        normaliseTask({
          id: `TSK-${1100 + prev.length}`,
          createdAt: new Date().toISOString(),
          escalationLevel: 0,
          activities: [{ createdAt: new Date().toISOString(), byId: task.assignedBy, type: 'created', text: 'Task created' }],
          ...task,
        }),
        ...prev,
      ]);
    }
  }, []);

  // Optimistic helper: apply patch locally, roll back on error
  const optimistic = useCallback((id, patch, apiFn) => {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, ...patch } : t));
    if (usingApi) {
      apiFn().then((updated) => {
        if (updated) setTasks((prev) => prev.map((t) => t.id === id ? normaliseTask(updated) : t));
      }).catch((err) => {
        console.error(err);
        fetchTasks(); // roll back
      });
    }
  }, [fetchTasks]);

  const updateTask = useCallback((id, patch, activityEntry) => {
    if (usingApi) {
      optimistic(id, patch, () => api.patch(`/api/tasks/${id}`, patch));
    } else {
      setTasks((prev) => prev.map((t) => {
        if (t.id !== id) return t;
        const next = { ...t, ...patch };
        if (activityEntry) {
          next.activity = [...(t.activity || []), { at: new Date().toISOString(), ...activityEntry }];
        }
        return next;
      }));
    }
  }, [optimistic]);

  const setTaskStatus = useCallback((id, status, byUserId) => {
    if (usingApi) {
      optimistic(id, { status }, () => api.post(`/api/tasks/${id}/status`, { status }));
    } else {
      updateTask(id, { status }, { by: byUserId, type: 'status', text: `Status changed to ${status}` });
    }
  }, [optimistic, updateTask]);

  const approveTask = useCallback((id, byUserId) => {
    if (usingApi) {
      optimistic(id, { approved: true, status: 'Done' }, () => api.post(`/api/tasks/${id}/approve`));
    } else {
      updateTask(id, { status: 'Done', approved: true }, { by: byUserId, type: 'approval', text: 'Approved by manager' });
    }
  }, [optimistic, updateTask]);

  const retractTask = useCallback((id, byUserId) => {
    if (usingApi) {
      optimistic(id, { approved: false }, () => api.post(`/api/tasks/${id}/retract`));
    } else {
      updateTask(id, { approved: false }, { by: byUserId, type: 'retract', text: 'Approval retracted' });
    }
  }, [optimistic, updateTask]);

  const rejectTask = useCallback((id, byUserId, reason = 'Needs rework') => {
    if (usingApi) {
      optimistic(id, { status: 'Pending', approved: false }, () => api.post(`/api/tasks/${id}/reject`, { reason }));
    } else {
      updateTask(id, { status: 'Pending', approved: false }, { by: byUserId, type: 'reject', text: `Rejected: ${reason}` });
    }
  }, [optimistic, updateTask]);

  const reassignTask = useCallback((id, newAssignee, byUserId) => {
    const u = users.find((u) => u.id === newAssignee);
    if (usingApi) {
      optimistic(id, { assignedTo: newAssignee }, () => api.post(`/api/tasks/${id}/reassign`, { newAssigneeId: newAssignee }));
    } else {
      updateTask(id, { assignedTo: newAssignee }, { by: byUserId, type: 'reassign', text: `Reassigned to ${u?.name ?? newAssignee}` });
    }
  }, [users, optimistic, updateTask]);

  const escalateTask = useCallback((id, byUserId) => {
    if (usingApi) {
      setTasks((prev) => prev.map((t) => t.id === id ? { ...t, escalationLevel: (t.escalationLevel || 0) + 1 } : t));
      api.post(`/api/tasks/${id}/escalate`).then((updated) => {
        if (updated) setTasks((prev) => prev.map((t) => t.id === id ? normaliseTask(updated) : t));
      }).catch(fetchTasks);
    } else {
      setTasks((prev) => prev.map((t) => {
        if (t.id !== id) return t;
        return {
          ...t,
          escalationLevel: (t.escalationLevel || 0) + 1,
          activity: [...(t.activity || []), { at: new Date().toISOString(), by: byUserId, type: 'escalation', text: 'Manually escalated' }],
        };
      }));
    }
  }, [fetchTasks]);

  // ── Notifications ──────────────────────────────────────────────────
  // When logged in: fetched from API and polled every 30s.
  // Read/unread tracked by a lastSeen ISO timestamp stored in localStorage.
  // When in demo mode: fall back to the mock initialNotifications.
  const [notifications, setNotifications] = useState(usingApi ? [] : initialNotifications);
  const [notifLastSeen, setNotifLastSeen] = useState(
    () => localStorage.getItem('fd_notif_last_seen') ?? new Date(0).toISOString()
  );

  useEffect(() => {
    if (!usingApi) return;
    const fetchNotifs = () =>
      api.get('/api/notifications')
        .then((data) => { if (data) setNotifications(data); })
        .catch(console.error);
    fetchNotifs();
    // Poll every 5s so WhatsApp replies appear near-instantly in the bell
    const id = setInterval(fetchNotifs, 5_000);
    return () => clearInterval(id);
  }, []);

  const markAllRead = useCallback(() => {
    const now = new Date().toISOString();
    localStorage.setItem('fd_notif_last_seen', now);
    setNotifLastSeen(now);
    if (!usingApi) {
      setNotifications((prev) => prev.map((n) => ({ ...n, unread: false })));
    }
  }, []);

  const unreadCount = usingApi
    ? notifications.filter((n) => new Date(n.createdAt) > new Date(notifLastSeen)).length
    : notifications.filter((n) => n.unread).length;

  // ── Search ─────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');

  const value = {
    theme, toggleTheme,
    role, setRole, activeUser,
    users, addUser,
    tasks, addTask, updateTask, setTaskStatus, approveTask, retractTask, rejectTask, reassignTask, escalateTask,
    notifications, markAllRead, unreadCount, notifLastSeen,
    search, setSearch,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
