import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

export function useTasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastSynced, setLastSynced] = useState(null);

  const fetch = useCallback(async () => {
    try {
      const data = await api.get('/api/tasks');
      if (data) {
        // Normalise: API returns Prisma relations, map to frontend shape
        setTasks(data.map(normaliseTask));
        setLastSynced(new Date());
      }
    } catch (err) {
      console.error('[useTasks]', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, 30_000);
    return () => clearInterval(id);
  }, [fetch]);

  return { tasks, setTasks, loading, lastSynced, refetch: fetch };
}

// Map Prisma task shape → AppContext task shape so all components work unchanged
function normaliseTask(t) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    assignedTo: t.assignedToId,
    assignedBy: t.assignedById,
    status: t.status,
    priority: t.priority,
    deadline: t.deadline,
    createdAt: t.createdAt,
    escalationLevel: t.escalationLevel,
    approved: t.approved,
    customFields: t.customFields ?? {},
    activity: (t.activities ?? []).map((a) => ({
      at: a.createdAt,
      by: a.byId,
      type: a.type,
      text: a.text,
    })),
    // Keep relation objects for components that need them
    _assignedTo: t.assignedTo,
    _assignedBy: t.assignedBy,
  };
}
