// 香火与愿望墙（设计文档 2.3 香炉广场、愿望墙）。
// 香火计数按寺按日聚合，房间每 5 秒广播一次（6.2）。多实例时每个实例只写自己的计数文档
// （键带 #实例号），读取时求和——并发上香不会互相覆盖（docs/CLUSTER.md）。
import { dayKey, newId, HttpError } from './util.js';
import { crisisSignal, ugcRejectReason } from './compliance.js';

export const WALL = 60;

export class OfferingService {
  constructor({ store, tz, hotline, shard = '' }) {
    this.store = store; this.tz = tz; this.hotline = hotline; this.shard = shard;
    // the wall is "the newest public wishes of this temple": kept sorted, never scanned (store/indexes.js)
    store.index('wishes', 'wall', (w) => (w.visibility === 'public' ? w.templeId : null), { order: (w) => w.createdAt, limit: WALL });
    store.index('wishes', 'user', (w) => w.userId);
    store.index('incense_daily', 'shards', (d) => (d.shard ? `${d.templeId}:${d.day}` : null));
  }

  incenseToday(templeId, now = Date.now()) {
    const day = dayKey(this.tz, now);
    const single = this.store.get('incense_daily', `${templeId}:${day}`)?.count || 0;
    if (!this.shard) return single;
    return single + this.store.by('incense_daily', 'shards', `${templeId}:${day}`).reduce((n, d) => n + d.count, 0);
  }

  addIncense(templeId, sticks = 3, now = Date.now()) {
    const day = dayKey(this.tz, now);
    const key = this.shard ? `${templeId}:${day}#${this.shard}` : `${templeId}:${day}`;
    const cur = this.store.get('incense_daily', key) || (this.shard ? { count: 0, templeId, day, shard: this.shard } : { count: 0 });
    cur.count += sticks;
    this.store.put('incense_daily', key, cur);
    return this.shard ? this.incenseToday(templeId, now) : cur.count;
  }

  addWish(user, templeId, { text, anonymous = true }) {
    text = String(text || '').trim().slice(0, 60);
    const reason = ugcRejectReason(text);
    if (reason) throw new HttpError(422, 'wish_rejected', { reason });
    const crisis = crisisSignal(text);
    const id = newId(8);
    const wish = {
      id, templeId, userId: user.id, name: anonymous ? null : user.name, text, rejoice: 0,
      // 涉及自伤念头的愿望不公开悬挂，只给本人温和回应 + 热线（8.4）
      visibility: crisis ? 'private' : 'public',
      createdAt: Date.now(),
    };
    this.store.put('wishes', id, wish);
    return { wish, support: crisis ? this.hotline : null };
  }

  wall(templeId, limit = WALL, viewerId = null) {
    return this.store.by('wishes', 'wall', templeId).slice(0, Math.min(limit, WALL))
      .map(({ id, name, text, rejoice, createdAt, userId }) => ({ id, name, text, rejoice, createdAt, mine: !!viewerId && userId === viewerId }));
  }

  rejoice(user, wishId) {
    const w = this.store.get('wishes', wishId);
    if (!w || w.visibility !== 'public') throw new HttpError(404, 'not_found');
    if (w.userId === user.id) throw new HttpError(409, 'own_wish');
    const k = `${wishId}:${user.id}`;
    if (this.store.get('rejoices', k)) return { rejoice: w.rejoice, already: true };
    this.store.put('rejoices', k, { at: Date.now() });
    w.rejoice += 1;
    this.store.put('wishes', wishId, w);
    return { rejoice: w.rejoice, already: false };
  }
}
