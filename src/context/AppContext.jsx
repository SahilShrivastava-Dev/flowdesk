import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  initialTasks, initialNotifications, initialConversations, initialThreads,
  initialContacts, initialInvoices,
  users as mockUsers, setRuntimeUsers,
} from '../data/mockData.js';
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
    // "sole" | "shared". A shared task is held by several people, each of whom
    // submits their own part before it goes for approval.
    assignmentMode: t.assignmentMode ?? 'sole',
    // Everyone holding the task, with their own status. Falls back to the single
    // assignee so demo mode and any older payload render identically.
    assignees: (t.assignees ?? []).map((a) => ({
      userId: a.userId ?? a.user?.id,
      name:   a.user?.name ?? null,
      status: a.status ?? 'Pending',
      submittedAt: a.submittedAt ?? null,
    })),
    activity: (t.activities ?? t.activity ?? []).map((a, i) => ({
      // Keep the row id so lists can key on it instead of an array index.
      id:            a.id ?? `${t.id}-act-${i}`,
      at:            a.createdAt ?? a.at,
      by:            a.byId ?? a.by,
      type:          a.type,
      text:          a.text,
      mediaUrl:      a.mediaUrl      ?? null,
      transcription: a.transcription ?? null,  // Whisper ASR transcript (voice notes)
      // "web" | "whatsapp". Defaults to web so demo-mode rows and anything
      // written before the column existed render without a channel chip.
      channel:       a.channel       ?? 'web',
    })),
    // Only present on a single-task fetch — the WhatsApp messages linked to
    // this task. The full conversation lives in the Tracker, not here.
    messages: t.messages ?? [],
  };
}

/** Merge a freshly-polled page into what we already have, newest wins. */
function mergeById(existing, incoming) {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
  );
}

// Demo-mode task IDs. Mirrors backend generateTaskId(): max existing + 1,
// starting at 1 when there are none.
function nextMockTaskNumber(tasks) {
  const nums = tasks
    .map((t) => /^TSK-(\d+)$/.exec(t.id)?.[1])
    .filter(Boolean)
    .map(Number);
  return nums.length > 0 ? Math.max(...nums) + 1 : 1;
}

// Normalise a Prisma user so both reportingTo and reportingToId are set
function normaliseUser(u) {
  return {
    ...u,
    reportingTo: u.reportingToId ?? u.reportingTo ?? null,
    reportingToId: u.reportingToId ?? u.reportingTo ?? null,
  };
}

const usingApi = Boolean(import.meta.env.VITE_API_URL) && isLoggedIn();

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
  // In API mode start empty so mock users never flash before /api/users loads.
  const [users, setUsersState] = useState(
    usingApi ? [] : mockUsers.map(normaliseUser)
  );

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

  const updateUser = useCallback(async (id, patch) => {
    if (usingApi) {
      const updated = await api.patch(`/api/users/${id}`, patch);
      if (updated) {
        setUsersState(prev => prev.map(u => u.id === id ? normaliseUser(updated) : u));
      }
    } else {
      setUsersState(prev => prev.map(u => u.id === id ? normaliseUser({ ...u, ...patch }) : u));
    }
  }, []);

  const deleteUser = useCallback(async (id) => {
    if (usingApi) {
      await api.delete(`/api/users/${id}`);
    }
    setUsersState(prev => prev.filter(u => u.id !== id));
  }, []);

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

  // API mode: the active user IS the authenticated account.
  // Demo mode: map the selected role to its canonical seed user.
  const activeUser = useMemo(
    () =>
      usingApi
        ? users.find((u) => u.id === loggedInUser?.id) ?? loggedInUser ?? users[0]
        : users.find((u) => u.id === ROLE_TO_USER[role]) ?? loggedInUser ?? users[0],
    [role, users, loggedInUser]
  );

  // ── Tasks ──────────────────────────────────────────────────────────
  const [tasks, setTasks] = useState(() =>
    usingApi ? [] : initialTasks.map(normaliseTask)
  );
  const [tasksLoading, setTasksLoading] = useState(usingApi);
  const pollingRef = useRef(null);

  const fetchTasks = useCallback(async () => {
    try {
      const data = await api.get('/api/tasks');
      if (data) setTasks(data.map(normaliseTask));
    } catch (err) {
      console.error('[AppContext] fetchTasks', err);
    } finally {
      setTasksLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!usingApi) return;
    fetchTasks();
    pollingRef.current = setInterval(fetchTasks, 30_000);
    return () => clearInterval(pollingRef.current);
  }, [fetchTasks]);

  /**
   * Load one task's full detail, including the WhatsApp messages linked to it.
   *
   * `/api/tasks` deliberately omits `messages` — including them would put every
   * message of every task into the list payload. So the task objects in state
   * have no messages until this runs, which is why the modal has to ask for
   * them explicitly when it opens.
   */
  const fetchTaskDetail = useCallback(async (taskId) => {
    if (!usingApi || !taskId) return;
    try {
      const data = await api.get(`/api/tasks/${taskId}`);
      if (!data) return;
      const detailed = normaliseTask(data);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...detailed } : t)));
    } catch (err) {
      console.error('[AppContext] fetchTaskDetail', err);
    }
  }, []);

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
          // Mirror the backend's generateTaskId: continue from the current max
          // so demo IDs stay in the same sequence as the seed data.
          id: `TSK-${nextMockTaskNumber(prev)}`,
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

  const MAX_ESCALATION_LEVEL = 4;

  const escalateTask = useCallback((id, byUserId) => {
    if (usingApi) {
      setTasks((prev) => prev.map((t) => {
        if (t.id !== id) return t;
        if ((t.escalationLevel || 0) >= MAX_ESCALATION_LEVEL) return t; // hard cap
        return { ...t, escalationLevel: (t.escalationLevel || 0) + 1 };
      }));
      api.post(`/api/tasks/${id}/escalate`).then((updated) => {
        if (updated) setTasks((prev) => prev.map((t) => t.id === id ? normaliseTask(updated) : t));
      }).catch(fetchTasks);
    } else {
      setTasks((prev) => prev.map((t) => {
        if (t.id !== id) return t;
        if ((t.escalationLevel || 0) >= MAX_ESCALATION_LEVEL) return t; // hard cap
        const newLevel = (t.escalationLevel || 0) + 1;
        return {
          ...t,
          escalationLevel: newLevel,
          activity: [...(t.activity || []), {
            at: new Date().toISOString(),
            by: byUserId,
            type: 'escalation',
            text: `Manually escalated to L${newLevel} by ${byUserId}`,
          }],
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

  // ── Conversations ──────────────────────────────────────────────────
  // One thread per person, matching how WhatsApp actually works. Messages are
  // NOT nested inside tasks — a message can belong to no task at all, and
  // nesting them under tasks is exactly the model this replaced.
  const [conversations, setConversations] = useState(usingApi ? [] : initialConversations);
  const [convLoading, setConvLoading] = useState(usingApi);
  const [threads, setThreads] = useState(usingApi ? {} : initialThreads);
  const [activeConvUserId, setActiveConvUserId] = useState(null);

  const fetchConversations = useCallback(async () => {
    if (!usingApi) return;
    try {
      const data = await api.get('/api/conversations');
      if (data) setConversations(data);
    } catch (err) { console.error(err); }
    finally { setConvLoading(false); }
  }, []);

  /**
   * Load one thread.
   *
   * A thread key is either a user id or a contact id, and the two live behind
   * different endpoints. The party is read from the conversation list rather
   * than passed in by every caller, so the six existing call sites are
   * unchanged — a thread that is not in the list yet is a colleague, which is
   * the pre-existing behaviour.
   */
  const fetchThread = useCallback(async (userId, { before } = {}) => {
    if (!usingApi || !userId) return;
    try {
      const isContact = conversations.some((c) => c.userId === userId && c.party === 'contact');

      // Contact threads are not paginated: an external party has tens of
      // messages, not thousands, and the endpoint returns the lot.
      const data = isContact
        ? await api.get(`/api/contacts/${userId}/messages`)
        : await api.get(`/api/conversations/${userId}/messages?${new URLSearchParams({
            limit: '50', ...(before && { before }),
          })}`);
      if (!data) return;

      setThreads((prev) => {
        const existing = prev[userId];
        // A `before` fetch is older history — prepend it and keep what we have.
        const messages = before
          ? [...data.messages, ...(existing?.messages ?? [])]
          : mergeById(existing?.messages ?? [], data.messages);

        return {
          ...prev,
          [userId]: { ...data, messages, pending: existing?.pending ?? [] },
        };
      });
    } catch (err) { console.error(err); }
  }, [conversations]);

  const loadMoreMessages = useCallback(async (userId) => {
    const t = threads[userId];
    if (!t?.hasMore || !t.nextBefore) return;
    await fetchThread(userId, { before: t.nextBefore });
  }, [threads, fetchThread]);

  // Polling cadence. A chat has to feel immediate, so the open thread refreshes
  // faster than anything else in the app.
  const CONVERSATION_POLL_MS = 6_000;
  const THREAD_POLL_MS       = 2_500;

  useEffect(() => {
    if (!usingApi) return;
    fetchConversations();
    const id = setInterval(() => {
      if (!document.hidden) fetchConversations();
    }, CONVERSATION_POLL_MS);
    return () => clearInterval(id);
  }, [fetchConversations]);

  useEffect(() => {
    if (!usingApi || !activeConvUserId) return;
    fetchThread(activeConvUserId);
    const id = setInterval(() => {
      if (!document.hidden) fetchThread(activeConvUserId);
    }, THREAD_POLL_MS);
    return () => clearInterval(id);
  }, [activeConvUserId, fetchThread]);

  /**
   * Catch up the moment the window becomes usable again.
   *
   * Polls are skipped while the tab is hidden, and the backend runs on a free
   * Render instance that sleeps when idle — so coming back to the tab could
   * otherwise leave stale messages on screen until the next tick, which reads
   * as "I had to refresh the page".
   */
  useEffect(() => {
    if (!usingApi) return;
    const catchUp = () => {
      if (document.hidden) return;
      fetchConversations();
      if (activeConvUserId) fetchThread(activeConvUserId);
    };
    window.addEventListener('focus', catchUp);
    document.addEventListener('visibilitychange', catchUp);
    return () => {
      window.removeEventListener('focus', catchUp);
      document.removeEventListener('visibilitychange', catchUp);
    };
  }, [activeConvUserId, fetchConversations, fetchThread]);

  /**
   * Send a WhatsApp message, showing it immediately rather than waiting for
   * the next poll. The optimistic bubble is replaced by the real row when the
   * server responds, or marked failed if the send didn't reach Meta.
   */
  const sendWhatsApp = useCallback(async (userId, text, taskId = null) => {
    const clientId = `pending-${Date.now()}`;
    const optimistic = {
      id: clientId,
      direction: 'outbound',
      kind: 'text',
      text,
      taskId,
      senderId: activeUser?.id ?? null,
      deliveryStatus: 'pending',
      createdAt: new Date().toISOString(),
      _optimistic: true,
    };

    setThreads((prev) => ({
      ...prev,
      [userId]: {
        ...(prev[userId] ?? { messages: [] }),
        messages: [...(prev[userId]?.messages ?? []), optimistic],
      },
    }));

    if (!usingApi) return { ok: true, mode: 'free_text' };

    try {
      // A contact thread goes to a different endpoint. Colleagues get a
      // template fallback when their window has closed; an external party does
      // not — see the comment on the contact send route for why.
      const isContact = conversations.some((c) => c.userId === userId && c.party === 'contact');
      const res = isContact
        ? await api.post(`/api/contacts/${userId}/messages`, { message: text })
        : await api.post('/api/whatsapp/send', { userId, taskId, message: text });
      setThreads((prev) => ({
        ...prev,
        [userId]: {
          ...prev[userId],
          messages: (prev[userId]?.messages ?? []).map((m) =>
            m.id === clientId ? { ...(res?.message ?? m), _optimistic: false } : m,
          ),
        },
      }));
      // Pull the thread straight away rather than waiting for the next tick —
      // the reply to what you just sent is the thing you're watching for.
      fetchConversations();
      fetchThread(userId);
      return res;
    } catch (err) {
      setThreads((prev) => ({
        ...prev,
        [userId]: {
          ...prev[userId],
          messages: (prev[userId]?.messages ?? []).map((m) =>
            m.id === clientId
              ? { ...m, deliveryStatus: 'failed', deliveryError: err.message }
              : m,
          ),
        },
      }));
      throw err;
    }
  }, [activeUser, conversations, fetchConversations, fetchThread]);

  /** Correct which task a message belongs to (or unlink it entirely). */
  const reattributeMessage = useCallback(async (userId, messageId, taskId) => {
    if (!usingApi) {
      setThreads((prev) => ({
        ...prev,
        [userId]: {
          ...prev[userId],
          messages: (prev[userId]?.messages ?? []).map((m) =>
            m.id === messageId
              ? { ...m, taskId, needsAttribution: false, attributedBy: 'manual' }
              : m,
          ),
        },
      }));
      return { revertHint: null };
    }

    const res = await api.patch(`/api/conversations/messages/${messageId}`, { taskId });
    await Promise.all([fetchThread(userId), fetchConversations(), fetchTasks()]);
    return res ?? { revertHint: null };
  }, [fetchThread, fetchConversations, fetchTasks]);

  // ── Search ─────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');

  // ── External parties and invoices ──────────────────────────────────
  //
  // Loaded lazily: the directory is a page most sessions never open, and a
  // fetch on every login would be two more requests before the dashboard
  // paints. `contactsLoaded` is what stops a re-open re-fetching.
  const [contacts, setContacts] = useState(usingApi ? [] : initialContacts);
  const [invoices, setInvoices] = useState(usingApi ? [] : initialInvoices);
  const [contactsLoading, setContactsLoading] = useState(false);
  const contactsLoaded = useRef(!usingApi);

  const loadContacts = useCallback(async ({ force = false } = {}) => {
    if (!usingApi) return;
    if (contactsLoaded.current && !force) return;
    setContactsLoading(true);
    try {
      const [c, i] = await Promise.all([
        api.get('/api/contacts'),
        api.get('/api/invoices'),
      ]);
      setContacts(c ?? []);
      setInvoices(i ?? []);
      contactsLoaded.current = true;
    } catch (err) {
      console.error(err);
    } finally {
      setContactsLoading(false);
    }
  }, []);

  const addContact = useCallback(async (data) => {
    if (usingApi) {
      const created = await api.post('/api/contacts', data);
      setContacts((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      return created;
    }
    const created = {
      id: `C${Date.now()}`, aliases: [], optInAt: null, optOutAt: null,
      archivedAt: null, createdAt: new Date().toISOString(),
      openInvoiceCount: 0, outstandingBalance: 0, lastMessageAt: null,
      ownerId: activeUser?.id ?? 'U101', preferredLanguage: 'en', type: 'other',
      ...data,
    };
    setContacts((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    return created;
  }, [activeUser]);

  const updateContact = useCallback(async (id, patch) => {
    if (usingApi) {
      const updated = await api.patch(`/api/contacts/${id}`, patch);
      setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...updated } : c)));
      return updated;
    }
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const archiveContact = useCallback(async (id) => {
    if (usingApi) {
      await api.delete(`/api/contacts/${id}`);
    }
    // Removed from the list either way — archived is not deleted, but it is
    // not somebody you can message today, which is what this list is for.
    setContacts((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const addInvoice = useCallback(async (data) => {
    if (usingApi) {
      const created = await api.post('/api/invoices', data);
      setInvoices((prev) => [...prev, created]);
      // The outstanding total on the contact row is now stale.
      await loadContacts({ force: true });
      return created;
    }
    const contact = contacts.find((c) => c.id === data.contactId);
    const created = {
      id: `INV${Date.now()}`, currency: 'INR', status: 'open', payable: false,
      notes: '', balance: data.amount, ...data,
      contact: contact
        ? { id: contact.id, name: contact.name, companyName: contact.companyName, type: contact.type }
        : null,
    };
    setInvoices((prev) => [...prev, created]);
    return created;
  }, [contacts, loadContacts]);

  const updateInvoice = useCallback(async (id, patch) => {
    if (usingApi) {
      const updated = await api.patch(`/api/invoices/${id}`, patch);
      setInvoices((prev) => prev.map((i) => (i.id === id ? { ...i, ...updated } : i)));
      await loadContacts({ force: true });
      return updated;
    }
    setInvoices((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }, [loadContacts]);

  /** The full record behind one party — invoices, tasks and the message thread. */
  const fetchContactDetail = useCallback(async (id) => {
    if (!usingApi) {
      const contact = contacts.find((c) => c.id === id);
      if (!contact) return null;
      return {
        ...contact,
        invoices: invoices.filter((i) => i.contactId === id),
        tasks: tasks.filter((t) => t.contactId === id),
        messages: [],
      };
    }
    return api.get(`/api/contacts/${id}`);
  }, [contacts, invoices, tasks]);

  const value = {
    theme, toggleTheme,
    role, setRole, activeUser,
    users, addUser, updateUser, deleteUser,
    tasks, tasksLoading, addTask, updateTask, setTaskStatus, approveTask, retractTask, rejectTask, reassignTask, escalateTask, fetchTaskDetail,
    notifications, markAllRead, unreadCount, notifLastSeen,
    conversations, convLoading, threads, activeConvUserId, setActiveConvUserId,
    fetchThread, loadMoreMessages, sendWhatsApp, reattributeMessage,
    search, setSearch,
    contacts, invoices, contactsLoading, loadContacts, fetchContactDetail,
    addContact, updateContact, archiveContact, addInvoice, updateInvoice,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
