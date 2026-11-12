// 內容與帳號管理（設計文檔 8 章 合規、8.4 心理安全）。平台方只管「公開看得到的東西」：
//   · 祈願牌、燈牆上的心願——可被檢舉、可下架、可恢復
//   · 祖先堂是私人的（只有家人看得到），後台不讀、不列（docs/MODERATION.md）
//   · 涉及自傷念頭的內容本來就不公開（CLAUDE.md 規則 4）：後台同樣看不到，只有本人看得到
// 檢舉只有預設理由（沒有自由文字，與「只有預設致意」同一個精神）。三個不同的人檢舉 → 先收起，等人工看。
// 禁言：這個帳號不能再掛祈願牌、燈上不能再寫字；修行、功德、家堂都不受影響。
import { newId, HttpError, dayKey } from './util.js';
import { maskName } from './lamps.js';

export const REPORT_REASONS = ['ad', 'abuse', 'other'];
export const REPORT_HOLD = 3;      // distinct reporters before the content is held for review
export const REPORT_DAILY = 10;    // reports one account can file per local day
const COL = { wish: 'wishes', lamp: 'lamps' };
const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export class ModerationService {
  /** @param onChange(kind, doc)  called after a public item is hidden or restored (rooms refresh their lamp wall) */
  constructor({ store, tz, onChange = () => {} }) {
    Object.assign(this, { store, tz, onChange });
    store.index('wishes', 'user', (w) => w.userId);
    store.index('lamps', 'user', (l) => l.userId);
    store.index('families', 'member', (f) => f.members.map((m) => m.userId));
    store.index('reports', 'author', (r) => r.authorId);
  }

  // ---------------------------------------------------------------- what is public

  /** 'public' | 'held' | 'removed', or null when the item was never public (private wish, crisis, expired lamp). */
  stateOf(kind, doc, now = Date.now()) {
    if (!doc) return null;
    if (kind === 'wish') return ['public', 'held', 'removed'].includes(doc.visibility) ? doc.visibility : null;
    if (doc.crisis || doc.expiresAt <= now) return null;
    return doc.hidden || 'public';
  }

  setState(kind, doc, state, extra = {}) {
    if (kind === 'wish') doc.visibility = state;
    else if (state === 'public') delete doc.hidden; else doc.hidden = state;
    if (state === 'removed') doc.removed = extra; else delete doc.removed;
    this.store.put(COL[kind], doc.id, doc);
    this.onChange(kind, doc);
  }

  /** The words anyone in the hall can read: exactly what the wall shows, nothing more. */
  textOf(kind, doc) {
    if (kind === 'wish') return doc.text;
    return `${maskName(doc.forName)}${doc.wish && doc.wishPublic ? `「${doc.wish}」` : ''}`;
  }

  // ---------------------------------------------------------------- 檢舉

  report(user, { kind, id, reason } = {}, now = Date.now()) {
    if (!COL[kind]) throw new HttpError(422, 'invalid_kind');
    if (!REPORT_REASONS.includes(reason)) throw new HttpError(422, 'invalid_reason', { reasons: REPORT_REASONS });
    if (user.muted) throw new HttpError(403, 'muted');
    const doc = this.store.get(COL[kind], String(id || ''));
    if (this.stateOf(kind, doc, now) !== 'public') throw new HttpError(404, 'not_found');
    if (doc.userId === user.id) throw new HttpError(409, 'own_content');
    const rid = `${kind}:${doc.id}`;
    const rep = this.store.get('reports', rid) || { id: rid, kind, targetId: doc.id, templeId: doc.templeId, authorId: doc.userId, reporters: [], reasons: {}, status: 'open', createdAt: now };
    if (rep.reporters.includes(user.id)) return { already: true };
    const date = dayKey(this.tz, now);
    const quota = user.reportDay && user.reportDay.date === date ? user.reportDay : (user.reportDay = { date, n: 0 });
    if (quota.n >= REPORT_DAILY) throw new HttpError(429, 'report_limit', { max: REPORT_DAILY });
    quota.n += 1;
    this.store.put('users', user.id, user);
    rep.reporters.push(user.id);
    rep.reasons[reason] = (rep.reasons[reason] || 0) + 1;
    rep.lastAt = now;
    this.store.put('reports', rid, rep);
    // enough different people: take it off the wall until someone has looked (a reviewed-and-kept item stays up)
    if (rep.status === 'open' && rep.reporters.length >= REPORT_HOLD) this.setState(kind, doc, 'held');
    return { already: false };
  }

  // ---------------------------------------------------------------- 後台：內容

  item(kind, doc, now = Date.now()) {
    const rep = this.store.get('reports', `${kind}:${doc.id}`);
    return {
      kind, id: doc.id, templeId: doc.templeId, text: this.textOf(kind, doc), state: this.stateOf(kind, doc, now),
      authorId: doc.userId, authorName: this.store.get('users', doc.userId)?.name || null, authorMuted: !!this.store.get('users', doc.userId)?.muted,
      createdAt: kind === 'wish' ? doc.createdAt : doc.litAt,
      reports: rep ? rep.reporters.length : 0, reasons: rep ? rep.reasons : {}, reportStatus: rep ? rep.status : null,
      removedReason: doc.removed?.reason || null,
    };
  }

  /** filter: 'reported' (open reports, most-reported first) | 'hidden' (held or removed) | 'all'. */
  content({ kind = 'wish', filter = 'reported', q = '', authorId = '', limit = 100 } = {}, now = Date.now()) {
    if (!COL[kind]) throw new HttpError(422, 'invalid_kind');
    if (!['reported', 'hidden', 'all'].includes(filter)) throw new HttpError(422, 'invalid_filter');
    q = clean(q, 40);
    const pool = authorId ? this.store.by(COL[kind], 'user', authorId) : this.store.list(COL[kind]);
    let items = pool.filter((d) => this.stateOf(kind, d, now)).map((d) => this.item(kind, d, now));
    if (filter === 'reported') items = items.filter((i) => i.reportStatus === 'open');
    else if (filter === 'hidden') items = items.filter((i) => i.state !== 'public');
    if (q) items = items.filter((i) => i.text.includes(q));
    items.sort((a, b) => (filter === 'reported' ? b.reports - a.reports : 0) || b.createdAt - a.createdAt);
    return items.slice(0, Math.min(Math.max(1, limit | 0), 500));
  }

  target(kind, id, now = Date.now()) {
    if (!COL[kind]) throw new HttpError(422, 'invalid_kind');
    const doc = this.store.get(COL[kind], id);
    if (!this.stateOf(kind, doc, now)) throw new HttpError(404, 'not_found');
    return doc;
  }

  resolve(kind, id, resolution, now) {
    const rep = this.store.get('reports', `${kind}:${id}`);
    if (rep) { Object.assign(rep, { status: 'resolved', resolution, resolvedAt: now }); this.store.put('reports', rep.id, rep); }
  }

  /** 下架: off the wall for everyone except its author's own records. */
  hide(kind, id, reason = '', now = Date.now()) {
    const doc = this.target(kind, id, now);
    reason = clean(reason, 100);
    this.setState(kind, doc, 'removed', { at: now, reason });
    this.resolve(kind, id, 'removed', now);
    this.log('hide', `${kind}:${id}`, reason, now);
    return this.item(kind, doc, now);
  }

  /** 恢復 / 保留: back on the wall, and the reports on it are closed (it will not be auto-held again). */
  restore(kind, id, now = Date.now()) {
    const doc = this.target(kind, id, now);
    if (this.stateOf(kind, doc, now) !== 'public') this.setState(kind, doc, 'public');
    this.resolve(kind, id, 'kept', now);
    this.log('keep', `${kind}:${id}`, '', now);
    return this.item(kind, doc, now);
  }

  // ---------------------------------------------------------------- 後台：帳號

  userRow(u, now = Date.now()) {
    return {
      id: u.id, name: u.name, createdAt: u.createdAt, merit: u.practice.merit, minutes: Math.floor(u.practice.minutes), streak: u.practice.streak,
      muted: u.muted ? { at: u.muted.at, reason: u.muted.reason } : null,
      wishes: this.store.by('wishes', 'user', u.id).filter((w) => this.stateOf('wish', w, now)).length,
      lamps: this.store.by('lamps', 'user', u.id).filter((l) => l.expiresAt > now).length,
      halls: this.store.by('families', 'member', u.id).length,
      reported: this.store.by('reports', 'author', u.id).length,
    };
  }

  /** Search by exact id or part of the name; with no query, the newest accounts. */
  users({ q = '', limit = 50 } = {}, now = Date.now()) {
    q = clean(q, 40);
    const exact = q && this.store.get('users', q);
    const list = exact ? [exact] : this.store.list('users', (u) => !q || u.name.includes(q)).sort((a, b) => b.createdAt - a.createdAt);
    return list.slice(0, Math.min(Math.max(1, limit | 0), 200)).map((u) => this.userRow(u, now));
  }

  user(id, now = Date.now()) {
    const u = this.store.get('users', id);
    if (!u) throw new HttpError(404, 'not_found');
    return { ...this.userRow(u, now), content: [...this.content({ kind: 'wish', filter: 'all', authorId: id, limit: 50 }, now), ...this.content({ kind: 'lamp', filter: 'all', authorId: id, limit: 50 }, now)] };
  }

  /** 禁言. hideAll also takes this account's public wishes and lamp wishes off the wall. */
  mute(id, { reason = '', hideAll = false } = {}, now = Date.now()) {
    const u = this.store.get('users', id);
    if (!u) throw new HttpError(404, 'not_found');
    reason = clean(reason, 100);
    u.muted = { at: now, reason };
    this.store.put('users', u.id, u);
    this.log('mute', `user:${id}`, reason, now);
    let hidden = 0;
    if (hideAll) {
      for (const kind of ['wish', 'lamp']) {
        for (const d of this.store.by(COL[kind], 'user', id).filter((x) => ['public', 'held'].includes(this.stateOf(kind, x, now)))) { this.hide(kind, d.id, reason, now); hidden += 1; }
      }
    }
    return { user: this.userRow(u, now), hidden };
  }

  unmute(id, now = Date.now()) {
    const u = this.store.get('users', id);
    if (!u) throw new HttpError(404, 'not_found');
    delete u.muted;
    this.store.put('users', u.id, u);
    this.log('unmute', `user:${id}`, '', now);
    return { user: this.userRow(u, now) };
  }

  // ---------------------------------------------------------------- 操作記錄

  log(action, target, reason, now = Date.now()) {
    const id = `${now.toString(36)}-${newId(4)}`;
    this.store.put('modlog', id, { id, at: now, action, target, reason });
  }

  logs(limit = 50) { return this.store.list('modlog').sort((a, b) => b.at - a.at).slice(0, limit); }

  openReports() { return this.store.list('reports', (r) => r.status === 'open').length; }
}
