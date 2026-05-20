import { useState, useEffect } from 'react';
import { api } from '../lib/api';

export function useUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/users')
      .then((data) => { if (data) setUsers(data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return { users, loading };
}
