// 香火与愿望墙（设计文档 2.3 香炉广场、愿望墙）。
// 香火计数按寺按日聚合，房间每 5 秒广播一次（6.2）；P1 换成 Redis INCR。
import { dayKey, newId, HttpError } from './util.js';
import { crisisSignal, ugcRejectReason } from './compliance.js';

export class OfferingService {
  constructor({ store, tz, hotline }) { this.store = store; this.tz = tz; this.hotline = hotline; }

  incenseToday(templeId, now = Date.now()) {
    return this.store.get('incense_daily', `${templeId}:${dayKey(this.tz, now)}`)?.count || 0;
  }

  addIncense(templeId, sticks = 3, now = Date.now()) {
    const key = `${templeId}:${dayKey(this.tz, now)}`;
    const cur = this.store.get('incense_daily', key) || { count: 0 };
    cur.count += sticks;
    this.store.put('incense_daily', key, cur);
    return cur.count;
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

  wall(templeId, limit = 60) {
    return this.store.list('wishes', (w) => w.templeId === templeId && w.visibility === 'public')
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
      .map(({ id, name, text, rejoice, createdAt }) => ({ id, name, text, rejoice, createdAt }));
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
