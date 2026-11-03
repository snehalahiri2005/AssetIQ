export const session = {
  token: () => localStorage.getItem('aiq_token'),
  user: () => JSON.parse(localStorage.getItem('aiq_user') || 'null'),
  save: (t, u) => { localStorage.setItem('aiq_token', t); localStorage.setItem('aiq_user', JSON.stringify(u)); },
  clear: () => { localStorage.removeItem('aiq_token'); localStorage.removeItem('aiq_user'); },
};

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(session.token() && { Authorization: 'Bearer ' + session.token() }) },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/auth/login') { session.clear(); location.href = '/login'; }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export const rupee = n => '₹' + Math.round(n ?? 0).toLocaleString('en-IN');
