import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

/** Fetch on mount; returns { data, error, loading, reload }. */
export function useApi(path) {
  const [s, set] = useState({ data: null, error: null, loading: true });
  const load = useCallback(() => {
    api(path).then(data => set({ data, error: null, loading: false }))
             .catch(e => set({ data: null, error: e.message, loading: false }));
  }, [path]);
  useEffect(load, [load]);
  return { ...s, reload: load };
}

let push;
export const toast = m => push?.(m);
export function useToastHost() {
  const [msg, setMsg] = useState('');
  useEffect(() => { push = m => { setMsg(m); setTimeout(() => setMsg(''), 3000); }; return () => { push = null; }; }, []);
  return msg;
}

export const useCategories = () => useApi('/categories');
