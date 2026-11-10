// 分线（6.2）：同一座殿按容量切分成多个房间，用户无感；全寺在线与香火每 5 秒聚合广播。
// 单进程版本；多进程时把 templeStats / recentSitters / incense 换到 Redis，房间发现走 Redis。
import { Room } from './room.js';
import { effectiveMode } from '../domain/compliance.js';

export class Lobby {
  constructor(ctx) {
    this.ctx = ctx;
    this.temples = new Map(); // templeId -> { rooms: Room[], sitters: [], incense, n }
    this.statsTimer = setInterval(() => this.broadcastStats(), ctx.config.room.statsBroadcastMs);
    this.statsTimer.unref?.();
  }

  _t(id) {
    let t = this.temples.get(id);
    if (!t) { t = { rooms: [], sitters: [], incense: null, n: 0 }; this.temples.set(id, t); }
    return t;
  }

  /** Put a user into the least-full room that still has space; open a new one if needed. */
  join(ws, user, temple) {
    const { scenes, config, templesSvc } = this.ctx;
    const scene = scenes.get(temple.sceneId);
    if (!scene) { ws.close(4004, 'scene_missing'); return null; }
    const t = this._t(temple.id);
    // One body per account: a second tab in another shard replaces the first.
    for (const r of t.rooms) {
      const old = r.members.get(user.id);
      if (old) old.ws.close(4001, 'replaced');
    }
    const capacity = Math.min(config.room.capacity, templesSvc.tier(temple).roomCapacity, scene.seats.length || Infinity);
    let room = t.rooms.filter((r) => !r.full).sort((a, b) => b.size - a.size)[0];
    // Prefer filling rooms (more company), but open a new one when every room is full.
    if (!room) {
      t.n += 1;
      room = new Room({
        id: `${temple.id}#${t.n}`, temple, scene, capacity, ctx: this.ctx,
        mode: effectiveMode({ regionPolicy: config.regionPolicy, scene, temple }),
        onEmpty: (r) => this._close(temple.id, r),
      });
      t.rooms.push(room);
    }
    room.join(ws, user);
    return room;
  }

  _close(templeId, room) {
    const t = this._t(templeId);
    // keep one warm room per temple
    if (t.rooms.length > 1) { room.dispose(); t.rooms = t.rooms.filter((r) => r !== room); }
  }

  templeStats(templeId) {
    const t = this._t(templeId);
    if (t.incense === null) t.incense = this.ctx.offerings.incenseToday(templeId);
    return { online: t.rooms.reduce((s, r) => s + r.size, 0), rooms: t.rooms.length, incense: t.incense, lamps: this.ctx.lamps.count(templeId) };
  }

  totalOnline() {
    let n = 0;
    for (const t of this.temples.values()) for (const r of t.rooms) n += r.size;
    return n;
  }

  /** Is this account sitting on a seat in any hall right now? (禪房 must not double-count.) */
  isSeated(userId) {
    for (const t of this.temples.values()) for (const r of t.rooms) if (r.members.get(userId)?.seat) return true;
    return false;
  }

  bumpIncense(templeId, total) { this._t(templeId).incense = total; }

  /** A lamp was lit: push fresh stats now so everyone's lamp wall updates without waiting 5 s. */
  bumpLamps(templeId) {
    const t = this._t(templeId);
    const stats = this.templeStats(templeId);
    for (const r of t.rooms) if (r.size) r.broadcast({ t: 'stats', ...stats, shadows: r._shadows() });
  }

  rememberSitter(templeId, s) {
    const t = this._t(templeId);
    t.sitters = [s, ...t.sitters.filter((x) => x.seat !== s.seat)].slice(0, 40);
  }

  recentSitters(templeId) { return this._t(templeId).sitters; }

  broadcastStats() {
    for (const [id, t] of this.temples) {
      if (!t.rooms.length) continue;
      t.incense = this.ctx.offerings.incenseToday(id);
      const stats = this.templeStats(id);
      for (const r of t.rooms) if (r.size) r.broadcast({ t: 'stats', ...stats, shadows: r._shadows() });
    }
  }

  dispose() {
    clearInterval(this.statsTimer);
    for (const t of this.temples.values()) for (const r of t.rooms) r.dispose();
  }
}
