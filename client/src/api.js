const KEY = 'simiao.token';

export function getToken() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
function setToken(t) {
  try { localStorage.setItem(KEY, t); } catch { /* private mode: session-only */ }
}

export class ApiError extends Error {
  constructor(status, body) { super(body?.error || `http_${status}`); this.status = status; this.body = body; }
}

export async function api(method, path, body) {
  const token = getToken();
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export async function startSession(mood) {
  const out = await api('POST', '/api/session', { token: getToken(), mood });
  setToken(out.token);
  return out;
}
