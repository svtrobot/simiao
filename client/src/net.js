// Room connection. Movement is sent at most 10×/s; remote avatars are rendered
// ~120 ms in the past and interpolated between server snapshots (6.2).
import { getToken } from './api.js';

const INTERP_DELAY = 260; // > one 5 Hz movement interval

export class RoomClient extends EventTarget {
  constructor(temple) {
    super();
    this.temple = temple;
    this.members = new Map();  // id -> { id, n, name, look, rank, seat, a, buf: [{t,x,z,ry}] }
    this.byN = new Map();      // short wire number -> id
    this.me = null;
    this.room = null;
    this.retry = 0;
    this.lastSent = 0;
    this.pending = null;
    this.closed = false;
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?temple=${encodeURIComponent(this.temple)}&token=${encodeURIComponent(getToken() || '')}`);
    this.ws = ws;
    ws.onmessage = (e) => this._onMessage(JSON.parse(e.data));
    ws.onclose = (e) => {
      if (this.closed || e.code === 4001) return;
      this._emit('disconnected', { code: e.code });
      const wait = Math.min(15000, 800 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    };
    ws.onopen = () => { this.retry = 0; };
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => this.send({ t: 'ping', c: Date.now() }), 15000);
  }

  /** Seat ids in manifest order, so seat indexes on the wire can be decoded. */
  setSeats(seats) { this.seatIds = seats.map((s) => s.id); }

  close() { this.closed = true; clearInterval(this.pingTimer); this.ws?.close(); }

  send(msg) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg)); }

  /** Throttled movement update (5 Hz is plenty for a slow temple walk). */
  move(x, z, ry) {
    const now = performance.now();
    this.pending = { t: 'mv', x: +x.toFixed(2), z: +z.toFixed(2), ry: +ry.toFixed(2) };
    if (now - this.lastSent >= 200) { this.send(this.pending); this.pending = null; this.lastSent = now; }
  }
  flush() {
    if (this.pending && performance.now() - this.lastSent >= 200) { this.send(this.pending); this.pending = null; this.lastSent = performance.now(); }
  }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  _upsert(m) {
    const now = performance.now();
    let cur = this.members.get(m.id);
    if (!cur) { cur = { ...m, buf: [] }; this.members.set(m.id, cur); this._emit('join', cur); }
    this.byN.set(m.n, m.id);
    Object.assign(cur, { name: m.name, look: m.look, rank: m.rank, seat: m.seat, a: m.a });
    cur.buf.push({ t: now, x: m.x, z: m.z, ry: m.ry });
    return cur;
  }

  _onMessage(msg) {
    switch (msg.t) {
      case 'welcome': {
        this.room = msg.room;
        this.me = msg.you;
        this.actions = msg.room.actions;
        this.seats = null; this.byN.clear();
        for (const id of [...this.members.keys()]) { this.members.delete(id); this._emit('leave', { id }); }
        for (const m of msg.members) if (m.id !== this.me.id) this._upsert(m);
        const self = msg.members.find((m) => m.id === this.me.id);
        this.myN = self?.n;
        this._emit('welcome', { ...msg, self });
        break;
      }
      case 'tick': {
        for (const m of msg.j) {
          if (m.id === this.me?.id) { this.myN = m.n; continue; }
          this._upsert(m);
        }
        const now = performance.now();
        for (const e of msg.u) {
          const [n, xq, zq] = e;
          const full = e.length > 3;
          if (n === this.myN) { if (full) this._emit('self', { a: this.actions[e[4]], seat: e[5] >= 0 ? this.seatIds?.[e[5]] : null }); continue; }
          const cur = this.members.get(this.byN.get(n));
          if (!cur) continue;
          const x = xq / 10, z = zq / 10;
          const prev = cur.buf[cur.buf.length - 1];
          let ry;
          if (full) {
            cur.a = this.actions[e[4]] || 'idle';
            cur.seat = e[5] >= 0 ? this.seatIds?.[e[5]] ?? null : null;
            ry = e[3] / 50;
          } else {
            // position-only walking update: face the direction of travel
            ry = prev && Math.hypot(x - prev.x, z - prev.z) > 0.02 ? Math.atan2(x - prev.x, z - prev.z) : prev?.ry ?? 0;
          }
          cur.buf.push({ t: now, x, z, ry });
          if (cur.buf.length > 20) cur.buf.splice(0, cur.buf.length - 20);
        }
        for (const n of msg.l) {
          const id = this.byN.get(n); this.byN.delete(n);
          if (id && this.members.delete(id)) this._emit('leave', { id });
        }
        for (const e of msg.e) this._emit('event', e);
        break;
      }
      case 'stats': this._emit('stats', msg); break;
      case 'merit': this._emit('merit', msg); break;
      case 'fix': this._emit('fix', msg); break;
      case 'err': this._emit('error', msg); break;
      default: break;
    }
  }

  /** Interpolated pose of a remote member at render time. */
  sample(m) {
    const t = performance.now() - INTERP_DELAY;
    const b = m.buf;
    if (!b.length) return null;
    while (b.length >= 2 && b[1].t <= t) b.shift();
    if (b.length === 1 || t <= b[0].t) return b[0];
    const [p, q] = b;
    const k = Math.min(1, (t - p.t) / Math.max(1, q.t - p.t));
    let dr = q.ry - p.ry;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    return { x: p.x + (q.x - p.x) * k, z: p.z + (q.z - p.z) * k, ry: p.ry + dr * k };
  }
}
