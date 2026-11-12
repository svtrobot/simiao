// 點燈與燈牆（設計文檔 3.2 點燈、4.1「燈滅了會心疼」、4.3 為他人點燈的祈福卡）。
// P0 不接支付：每盞燈供奉 7 天，期滿前兩天內可續燈；每人同時最多 3 盞。
// P1 接支付後延長供期，但付費永不增加功德（4.2、COMPLIANCE.md）。
import { newId, HttpError } from './util.js';
import { crisisSignal, ugcRejectReason } from './compliance.js';

export const LAMP_DAYS = 7;
export const RENEW_WINDOW_DAYS = 2;
export const MAX_ACTIVE = 3;
const DAY = 86400000;
const COUNT_MS = 3000;
export const ARCHIVE_DAYS = 2;         // mine() still shows a lamp for a day after it goes out

/**
 * Lamp kinds per compliance mode. In 'cultural' mode (mainland, or a temple set to
 * cultural) there are no Buddha-named lamps — just a plain blessing lamp (8.1).
 */
export const LAMP_KINDS = {
  ritual: ['guangming', 'yaoshi', 'changming'], // 光明燈 · 藥師燈 · 長明燈
  cultural: ['qifu'],                           // 祈福燈
};

/** 王小明 → 王○明, 陳美 → 陳○, Alice → A○○○e. The public wall never shows a full name. */
export function maskName(name) {
  const chars = [...String(name || '')];
  if (chars.length <= 1) return chars.join('');
  if (chars.length === 2) return `${chars[0]}○`;
  return chars[0] + '○'.repeat(chars.length - 2) + chars[chars.length - 1];
}

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export class LampService {
  constructor({ store, hotline }) {
    this.store = store; this.hotline = hotline;
    this.counts = new Map();   // templeId → { at, n }
    store.index('lamps', 'temple', (l) => l.templeId);
    store.index('lamps', 'user', (l) => l.userId);
    store.index('lamps', 'card', (l) => l.cardId);
  }

  /**
   * Lamps that went out more than ARCHIVE_DAYS ago leave the working collection for `lamps_old`
   * (kept, not deleted: a 祈福卡 link still answers "這盞燈已經熄了"). Without this every lamp ever lit
   * would be walked each time a hall asks which lamps are burning.
   */
  archive(now = Date.now()) {
    let n = 0;
    for (const l of this.store.list('lamps', (x) => x.expiresAt < now - ARCHIVE_DAYS * DAY)) {
      this.store.put('lamps_old', l.id, l);
      this.store.remove('lamps', l.id);
      n += 1;
    }
    return n;
  }

  active(templeId, now = Date.now()) {
    return this.store.by('lamps', 'temple', templeId).filter((l) => l.expiresAt > now)
      .sort((a, b) => a.litAt - b.litAt);
  }

  /** How many lamps burn in this temple. Rooms ask every few seconds, so the answer is kept for a moment. */
  count(templeId, now = Date.now()) {
    const memo = this.counts.get(templeId);
    if (memo && Math.abs(now - memo.at) < COUNT_MS) return memo.n;
    const n = this.store.by('lamps', 'temple', templeId).filter((l) => l.expiresAt > now).length;
    this.counts.set(templeId, { at: now, n });
    return n;
  }

  mine(userId, now = Date.now()) {
    return this.store.by('lamps', 'user', userId).filter((l) => l.expiresAt > now - DAY)
      .sort((a, b) => b.litAt - a.litAt);
  }

  /**
   * Light a lamp. body: { kind, forOther, forName, wish, wishPrivate }.
   * Returns { lamp (owner view), support }.
   */
  light(user, templeId, mode, body = {}, now = Date.now()) {
    const kinds = LAMP_KINDS[mode] || LAMP_KINDS.cultural;
    const kind = kinds.includes(body.kind) ? body.kind : null;
    if (!kind) throw new HttpError(422, 'invalid_kind', { kinds });
    const forOther = !!body.forOther;
    const forName = clean(body.forName, 12) || (forOther ? '' : user.name);
    if (!forName) throw new HttpError(422, 'name_required');
    const wish = clean(body.wish, 40);
    for (const text of [forName, wish]) {
      if (!text) continue;
      const reason = ugcRejectReason(text);
      if (reason) throw new HttpError(422, 'lamp_rejected', { reason });
    }
    if (this.store.by('lamps', 'user', user.id).filter((l) => l.expiresAt > now).length >= MAX_ACTIVE) {
      throw new HttpError(429, 'lamp_limit', { max: MAX_ACTIVE });
    }
    // 涉及自傷念頭：燈照樣點亮，但心願不公開，只回給本人溫和的話與熱線（8.4）
    const crisis = crisisSignal(`${forName} ${wish}`);
    const lamp = {
      id: newId(8), cardId: forOther ? newId(12) : null,
      templeId, userId: user.id, fromName: user.name, kind, forOther, forName, wish,
      wishPublic: !!wish && !body.wishPrivate && !crisis, crisis,
      litAt: now, expiresAt: now + LAMP_DAYS * DAY, renewed: 0,
    };
    this.store.put('lamps', lamp.id, lamp);
    this.counts.delete(templeId);
    return { lamp: this.ownerView(lamp, now), support: crisis ? this.hotline : null };
  }

  renew(user, lampId, now = Date.now()) {
    const l = this.store.get('lamps', lampId);
    if (!l || l.userId !== user.id) throw new HttpError(404, 'not_found');
    if (l.expiresAt <= now) throw new HttpError(409, 'lamp_out');
    if (l.expiresAt - now > RENEW_WINDOW_DAYS * DAY) throw new HttpError(409, 'too_early', { renewFrom: l.expiresAt - RENEW_WINDOW_DAYS * DAY });
    l.expiresAt += LAMP_DAYS * DAY;
    l.renewed += 1;
    this.store.put('lamps', l.id, l);
    return this.ownerView(l, now);
  }

  /** 付費續燈（P1）：多亮 `days` 天；退款時為負。永遠不加功德。 */
  extend(lampId, days, now = Date.now()) {
    const l = this.store.get('lamps', lampId);
    if (!l) return null;
    l.expiresAt = Math.max(l.expiresAt, days > 0 ? now : 0) + days * DAY;
    this.store.put('lamps', l.id, l);
    return l;
  }

  /** What anyone in the hall sees: masked name, no user id, wish only if public. */
  publicView(l) {
    // l.hidden ('held' | 'removed', server/domain/moderation.js): the lamp keeps burning, its words leave the wall
    return { id: l.id, kind: l.kind, name: l.hidden ? '○○' : maskName(l.forName), wish: l.wishPublic && !l.hidden ? l.wish : null, litAt: l.litAt };
  }

  ownerView(l, now = Date.now()) {
    return {
      ...this.publicView(l), forName: l.forName, wish: l.wish, wishPublic: l.wishPublic, forOther: l.forOther, hidden: !!l.hidden,
      expiresAt: l.expiresAt, renewable: l.expiresAt > now && l.expiresAt - now <= RENEW_WINDOW_DAYS * DAY,
      cardId: l.cardId,
    };
  }

  /**
   * 祈福卡: whoever holds the link sees the recipient's name as the giver wrote it, and the
   * wish even if it is kept off the public wall (the card is meant for that person).
   */
  card(cardId, now = Date.now()) {
    let l = cardId ? this.store.by('lamps', 'card', cardId)[0] : null;
    if (!l && cardId) {
      this.store.index('lamps_old', 'card', (x) => x.cardId); // declared on first use: JsonStore only loads this collection now
      l = this.store.by('lamps_old', 'card', cardId)[0];
    }
    if (!l) throw new HttpError(404, 'not_found');
    return {
      lampId: l.id, templeId: l.templeId, kind: l.kind, forName: l.hidden ? maskName(l.forName) : l.forName, fromName: l.fromName,
      wish: l.crisis || l.hidden ? null : l.wish || null, litAt: l.litAt, expiresAt: l.expiresAt, lit: l.expiresAt > now,
    };
  }
}
