import { createApp } from '../server/app.js';
import { REGIONS } from '../server/config.js';

export async function startApp(overrides = {}) {
  const region = overrides.region || 'tw';
  const app = createApp({ dataDir: null, port: 0, region, regionPolicy: REGIONS[region], adminToken: 'test-admin', ...overrides });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const api = async (method, path, body, token) => {
    const res = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const session = async () => (await api('POST', '/api/session', {})).body;
  /** Connect a websocket client that records every message. */
  const connect = (token, temple = 'main') => new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?temple=${temple}&token=${token}`);
    const inbox = [];
    const waiters = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data); inbox.push(m);
      for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
    };
    ws.onerror = reject;
    const client = {
      ws, inbox,
      send: (m) => ws.send(JSON.stringify(m)),
      wait: (pred, ms = 3000) => new Promise((res, rej) => {
        const hit = inbox.find(pred); if (hit) return res(hit);
        const w = { pred, resolve: res }; waiters.push(w);
        setTimeout(() => rej(new Error('timeout waiting for message')), ms);
      }),
      close: () => ws.close(),
    };
    ws.onopen = () => resolve(client);
  });
  return { app, base, api, session, connect, close: () => app.close() };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
