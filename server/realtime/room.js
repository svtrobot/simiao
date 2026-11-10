// 同殿共修的权威房间（设计文档 6.2）。
// 同步：位置 / 朝向 / 当前动作 / 法名与外观；10 Hz 只发变化量。
// 不同步：烟雾、烛光、粒子——客户端根据事件自己生成。
import { clamp } from '../domain/util.js';
import { record } from '../domain/practice.js';
import { actionAllowed } from '../domain/compliance.js';
import { metrics } from '../metrics.js';
import { encodeFrame } from './ws.js';

// Order matters: the index is the wire code (protocol.md). Append only.
export const ACTION_LIST = ['idle', 'walk', 'pray', 'bow', 'prostrate', 'incense', 'muyu', 'bead', 'sit', 'fortune', 'wish'];
export const ACTIONS = new Set(ACTION_LIST);
const ACODE = Object.fromEntries(ACTION_LIST.map((a, i) => [a, i]));
const GREETS = new Set(['gassho', 'bow', 'rejoice', 'wellwish']);
const MAX_SPEED = 4.5;           // m/s, generous: walk is ~1.4 m/s, run-to-seat ~3
const MSG_BUDGET = 30;           // messages per second per client
const SHADOW_FILL = 30;          // 少于 30 人的房间用“影子同修”补位

const r2 = (v) => Math.round(v * 100) / 100;

export class Room {
  constructor({ id, temple, scene, mode, capacity, ctx, onEmpty }) {
    Object.assign(this, { id, temple, scene, mode, capacity, ctx, onEmpty });
    this.members = new Map();     // id -> member
    this.seats = new Map();       // seatId -> memberId
    this.seatById = new Map(scene.seats.map((s) => [s.id, s]));
    this.seatIndex = new Map(scene.seats.map((s, i) => [s.id, i]));
    this.nextN = 1;              // short per-room member number used on the wire
    this.dirty = new Set();
    this.joined = [];
    this.left = [];
    this.events = [];
    this.seq = 0;
    this.timer = setInterval(() => this.tick(), 1000 / ctx.config.room.tickHz);
    this.timer.unref?.();
  }

  get size() { return this.members.size; }
  get full() { return this.members.size >= this.capacity; }

  join(ws, user) {
    const { users } = this.ctx;
    const view = users.publicView(user);
    const sp = this.scene.spawn;
    const m = {
      id: user.id, n: this.nextN++, ws, user, name: view.name, look: view.look, rank: view.rank,
      x: sp.x + (Math.random() - 0.5) * 2, z: sp.z + (Math.random() - 0.5) * 1.5, ry: sp.ry ?? Math.PI, a: 'idle',
      seat: null, sitSince: 0, lastCredit: 0, lastMoveAt: Date.now(), lastMsgAt: Date.now(),
      budget: MSG_BUDGET, budgetAt: Date.now(), strikes: 0,
    };
    // Same account in two tabs: newest wins.
    const prev = this.members.get(user.id);
    if (prev) { prev.ws.close(4001, 'replaced'); this._remove(prev, true); }
    this.members.set(m.id, m);
    this.joined.push(m.id);

    this._send(m, {
      t: 'welcome',
      you: view,
      room: { id: this.id, temple: this.temple.slug, scene: this.scene.id, mode: this.mode, capacity: this.capacity, tickHz: this.ctx.config.room.tickHz, actions: ACTION_LIST },
      members: [...this.members.values()].map((x) => this._full(x)),
      shadows: this._shadows(),
      stats: this.ctx.lobby.templeStats(this.temple.id),
    });
    ws.on('message', (raw) => this._onMessage(m, raw));
    ws.on('close', () => this._remove(m));
  }

  _full(m) { return { id: m.id, n: m.n, name: m.name, look: m.look, rank: m.rank, x: r2(m.x), z: r2(m.z), ry: r2(m.ry), a: m.a, seat: m.seat }; }

  _shadows() {
    const n = SHADOW_FILL - this.members.size;
    if (n <= 0) return [];
    return this.ctx.lobby.recentSitters(this.temple.id)
      .filter((s) => !this.seats.has(s.seat)).slice(0, n)
      .map((s) => ({ seat: s.seat, look: s.look }));
  }

  _send(m, msg) { m.ws.send(JSON.stringify(msg)); }

  _onMessage(m, raw) {
    const now = Date.now();
    // token bucket
    m.budget = Math.min(MSG_BUDGET, m.budget + ((now - m.budgetAt) / 1000) * MSG_BUDGET);
    m.budgetAt = now;
    metrics.in();
    if (m.budget < 1) { if (++m.strikes > 50) m.ws.close(4008, 'rate'); return; }
    m.budget -= 1;
    m.lastMsgAt = now;
    if (typeof raw !== 'string' || raw.length > 512) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case 'mv': return this._move(m, msg, now);
      case 'act': return this._act(m, msg.a);
      case 'sit': return this._sit(m, msg.seat, now);
      case 'stand': return this._stand(m, now);
      case 'rit': return this._ritual(m, msg.k, now);
      case 'greet': return this._greet(m, msg, now);
      case 'ping': return this._send(m, { t: 'pong', c: msg.c, s: now });
      default: return undefined;
    }
  }

  _move(m, { x, z, ry }, now) {
    if (![x, z, ry].every(Number.isFinite)) return;
    if (m.seat) this._stand(m, now);
    const w = this.scene.walkArea;
    x = clamp(x, w.minX, w.maxX); z = clamp(z, w.minZ, w.maxZ);
    const dt = Math.max(0.05, (now - m.lastMoveAt) / 1000);
    const d = Math.hypot(x - m.x, z - m.z);
    if (d > MAX_SPEED * dt + 0.5) {
      // too fast: accept the reachable part and tell the client where we think it is
      const k = (MAX_SPEED * dt + 0.5) / d;
      x = m.x + (x - m.x) * k; z = m.z + (z - m.z) * k;
      this._send(m, { t: 'fix', x: r2(x), z: r2(z) });
    }
    m.x = x; m.z = z; m.ry = ry; m.lastMoveAt = now;
    if (m.a !== 'walk') m.a = 'walk';
    this.dirty.add(m.id);
  }

  _act(m, a) {
    if (!ACTIONS.has(a) || a === 'sit') return;
    const ritualPose = { bow: 'bow', prostrate: 'prostrate', incense: 'incense', muyu: 'muyu', bead: 'bead', fortune: 'fortune' };
    if (ritualPose[a] && !actionAllowed(this.mode, a, this.scene)) return;
    m.a = a;
    this.dirty.add(m.id);
  }

  _sit(m, seatId, now) {
    const seat = this.seatById.get(seatId);
    if (!seat) return this._send(m, { t: 'err', code: 'no_such_seat' });
    const owner = this.seats.get(seatId);
    if (owner && owner !== m.id) return this._send(m, { t: 'err', code: 'seat_taken', seat: seatId });
    if (m.seat && m.seat !== seatId) this.seats.delete(m.seat);
    this.seats.set(seatId, m.id);
    Object.assign(m, { seat: seatId, x: seat.x, z: seat.z, ry: seat.ry ?? Math.PI, a: 'sit', sitSince: now, lastCredit: now });
    this.dirty.add(m.id);
  }

  _stand(m, now) {
    if (!m.seat) return;
    this._creditMeditation(m, now);
    this.ctx.lobby.rememberSitter(this.temple.id, { seat: m.seat, look: m.look, at: now });
    this.seats.delete(m.seat);
    m.seat = null; m.a = 'idle';
    this.dirty.add(m.id);
  }

  _creditMeditation(m, now) {
    const mins = Math.floor((now - m.lastCredit) / 60000);
    if (mins <= 0) return;
    m.lastCredit += mins * 60000;
    this._merit(m, 'meditate', now, mins);
  }

  _ritual(m, kind, now) {
    if (!['incense', 'muyu', 'bead', 'bow'].includes(kind)) return;
    if (!actionAllowed(this.mode, kind, this.scene)) return this._send(m, { t: 'err', code: 'not_in_this_mode' });
    if (kind === 'incense') {
      // 每日 3 炷免费清香，服务端为准；超出则不落香也不加功德
      const res = this._merit(m, 'incense', now);
      if (!res.counted) return this._send(m, { t: 'err', code: res.reason === 'daily_cap' ? 'incense_daily_limit' : res.reason });
      const total = this.ctx.offerings.addIncense(this.temple.id, 3, now);
      this.events.push({ k: 'incense', id: m.id, slot: 'burner-main' });
      this.ctx.lobby.bumpIncense(this.temple.id, total);
      return;
    }
    const res = this._merit(m, kind, now);
    if (kind === 'bow' && res.counted) this.events.push({ k: 'bow', id: m.id });
  }

  _greet(m, { to, k }, now) {
    if (!GREETS.has(k)) return;
    const target = to ? this.members.get(String(to)) : null;
    if (to && !target) return;
    this._merit(m, 'greet', now);
    this.events.push({ k: 'greet', from: m.id, to: target?.id || null, kind: k });
  }

  _merit(m, action, now, units = 1) {
    const { config, users } = this.ctx;
    const res = record(m.user.practice, action, { tz: config.regionPolicy.tz, now, units });
    if (res.counted) {
      users.save(m.user);
      const view = users.publicView(m.user);
      const rankUp = view.rank !== m.rank;
      m.rank = view.rank; m.look = view.look;
      if (rankUp) { this.events.push({ k: 'look', id: m.id, look: m.look, rank: m.rank }); }
      this._send(m, { t: 'merit', action, gained: res.merit, merit: view.merit, minutes: view.minutes, rank: view.rank, look: rankUp ? view.look : undefined });
    } else if (res.progress !== undefined) {
      // accumulating 木鱼 / 念珠: nothing to tell yet
    }
    return res;
  }

  _remove(m, replaced = false) {
    if (this.members.get(m.id) !== m) return;
    this._stand(m, Date.now());
    this.members.delete(m.id);
    this.dirty.delete(m.id);
    if (!replaced) this.left.push({ n: m.n });
    if (this.members.size === 0 && !replaced) this.onEmpty?.(this);
  }

  tick() {
    const t0 = performance.now();
    try { this._tick(); } finally { metrics.tick(performance.now() - t0); }
  }

  _tick() {
    const now = Date.now();
    for (const m of this.members.values()) {
      if (m.seat && now - m.lastCredit >= 60000) this._creditMeditation(m, now);
      if (now - m.lastMsgAt > this.ctx.config.room.idleKickMs) m.ws.close(4000, 'idle');
      if (m.a === 'walk' && now - m.lastMoveAt > 400) { m.a = 'idle'; this.dirty.add(m.id); }
    }
    if (!this.dirty.size && !this.joined.length && !this.left.length && !this.events.length) return;
    this.seq++;
    const even = this.seq % 2 === 0;
    const u = [];
    for (const id of this.dirty) {
      const m = this.members.get(id);
      if (!m || this.joined.includes(id)) { this.dirty.delete(id); continue; }
      const sent = m.sent || {};
      const onlyMoved = m.a === 'walk' && sent.a === 'walk' && sent.seat === m.seat;
      if (onlyMoved) {
        // walking: position only, 5 Hz; the client derives facing from the direction of travel
        if (!even) continue;
        u.push([m.n, Math.round(m.x * 10), Math.round(m.z * 10)]);
      } else {
        // compact full delta: [n, x·10, z·10, ry·50, actionCode, seatIndex|-1]
        u.push([m.n, Math.round(m.x * 10), Math.round(m.z * 10), Math.round(m.ry * 50), ACODE[m.a], m.seat ? this.seatIndex.get(m.seat) : -1]);
      }
      m.sent = { a: m.a, seat: m.seat };
      this.dirty.delete(id);
    }
    if (!u.length && !this.joined.length && !this.left.length && !this.events.length) return;
    const msg = {
      t: 'tick', s: this.seq, u,
      j: this.joined.map((id) => this.members.get(id)).filter(Boolean).map((m) => { m.sent = { a: m.a, seat: m.seat }; return this._full(m); }),
      l: this.left.map((x) => x.n),
      e: this.events,
    };
    this.joined = []; this.left = []; this.events = [];
    this.broadcast(msg);
  }

  /** One JSON encoding and one WebSocket frame for the whole room (server frames are unmasked, so identical). */
  broadcast(msg) {
    const raw = JSON.stringify(msg);
    const frame = encodeFrame(0x1, Buffer.from(raw, 'utf8'));
    for (const m of this.members.values()) (m.ws.sendFrame ? m.ws.sendFrame(frame) : m.ws.send(raw));
    metrics.out(this.members.size, frame.length);
  }

  dispose() { clearInterval(this.timer); }
}
