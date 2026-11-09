// 點燈與燈牆（設計文檔 3.2 點燈、4.1「燈滅了會心疼」、4.3 為他人點燈的祈福卡）。
// P0 不接支付：每盞燈供奉 7 天，期滿前兩天內可續燈；每人同時最多 3 盞。
// P1 接支付後延長供期，但付費永不增加功德（4.2、COMPLIANCE.md）。
import { newId, HttpError } from './util.js';
import { crisisSignal, ugcRejectReason } from './compliance.js';

export const LAMP_DAYS = 7;
export const RENEW_WINDOW_DAYS = 2;
export const MAX_ACTIVE = 3;
const DAY = 86400000;

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
  constructor({ store, hotline }) { this.store = store; this.hotline = hotline; }

  active(templeId, now = Date.now()) {
    return this.store.list('lamps', (l) => l.templeId === templeId && l.expiresAt > now)
      .sort((a, b) => a.litAt - b.litAt);
  }

  count(templeId, now = Date.now()) { return this.active(templeId, now).length; }

  mine(userId, now = Date.now()) {
    return this.store.list('lamps', (l) => l.userId === userId && l.expiresAt > now - DAY)
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
    if (this.store.list('lamps', (l) => l.userId === user.id && l.expiresAt > now).length >= MAX_ACTIVE) {
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

  /** What anyone in the hall sees: masked name, no user id, wish only if public. */
  publicView(l) {
    return { id: l.id, kind: l.kind, name: maskName(l.forName), wish: l.wishPublic ? l.wish : null, litAt: l.litAt };
  }

  ownerView(l, now = Date.now()) {
    return {
      ...this.publicView(l), forName: l.forName, wish: l.wish, wishPublic: l.wishPublic, forOther: l.forOther,
      expiresAt: l.expiresAt, renewable: l.expiresAt > now && l.expiresAt - now <= RENEW_WINDOW_DAYS * DAY,
      cardId: l.cardId,
    };
  }

  /**
   * 祈福卡: whoever holds the link sees the recipient's name as the giver wrote it, and the
   * wish even if it is kept off the public wall (the card is meant for that person).
   */
  card(cardId, now = Date.now()) {
    const l = this.store.list('lamps', (x) => x.cardId === cardId)[0];
    if (!l) throw new HttpError(404, 'not_found');
    return {
      lampId: l.id, templeId: l.templeId, kind: l.kind, forName: l.forName, fromName: l.fromName,
      wish: l.crisis ? null : l.wish || null, litAt: l.litAt, expiresAt: l.expiresAt, lit: l.expiresAt > now,
    };
  }
}
