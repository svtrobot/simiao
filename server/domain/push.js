// 提醒（設計文檔 4.1：早 8 點黃曆、晚上靜坐；祖先堂的忌日、清明）。Web Push，零依賴：
// RFC 8291 aes128gcm 加密 + RFC 8292 VAPID 簽名都用 node:crypto。VAPID 金鑰第一次啟動時自己產生，
// 不需要任何外部帳號。推播內容端到端加密，推播服務（Google / Apple / Mozilla）讀不到逝者姓名。
// 語氣：一天最多兩則、只提醒不催促、不提斷簽（4.1「不懲罰」）。
import crypto from 'node:crypto';
import { HttpError } from './util.js';
import { almanac } from './almanac.js';

const b64u = (b) => Buffer.from(b).toString('base64url');
const fromB64u = (s, len, code) => {
  const b = typeof s === 'string' && /^[A-Za-z0-9_-]+=*$/.test(s) ? Buffer.from(s.replace(/=+$/, ''), 'base64url') : null;
  if (!b || (len && b.length !== len)) throw new HttpError(422, code);
  return b;
};

// ---------------------------------------------------------------- crypto

/** VAPID key pair as JWK (private) + the raw uncompressed public key browsers want (base64url). */
export function newVapidKeys() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  return { jwk, publicKey: b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')])) };
}

/** RFC 8292: `Authorization: vapid t=<ES256 JWT>, k=<public key>` for one push service origin. */
export function vapidAuth(endpoint, keys, subject, now = Date.now()) {
  const enc = (o) => b64u(JSON.stringify(o));
  const data = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })}`;
  const key = crypto.createPrivateKey({ key: keys.jwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${data}.${b64u(sig)}, k=${keys.publicKey}`;
}

/**
 * RFC 8291 message encryption (Content-Encoding: aes128gcm), one record.
 * p256dh: the browser's 65-byte public key; auth: its 16-byte secret.
 */
export function encryptPayload(payload, p256dh, auth) {
  const ua = Buffer.isBuffer(p256dh) ? p256dh : Buffer.from(p256dh, 'base64url');
  const authSecret = Buffer.isBuffer(auth) ? auth : Buffer.from(auth, 'base64url');
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(ua);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPublic]), 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0); header.writeUInt32BE(4096, 16); header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, body]);
}

// ---------------------------------------------------------------- words

const LUNAR_M = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '臘月'];
const lunarDay = (d) => (d === 10 ? '初十' : d === 20 ? '二十' : d === 30 ? '三十' : ['初', '十', '廿'][Math.floor(d / 10)] + '一二三四五六七八九'[(d % 10) - 1]);

const TXT = {
  'zh-Hant': {
    morning: (lunar) => `早安 · 農曆${lunar}`,
    fest: { qingming: '清明', zhongyuan: '中元', hanyi: '寒衣節' },
    today: '今天', tomorrow: '明天',
    death: (w, who, y) => `${w}是${who}的忌日（${y} 週年）`,
    birth: (w, who, y) => `${w}是${who}的冥誕（${y} 歲）`,
    festival: (w, f) => `${w}是${f}`,
    familyBody: '有空的話，到祖先堂獻一束花、說幾句話。',
    eveBody: '明天早上會再輕輕提醒你一次。',
    nightTitle: '睡前，靜坐五分鐘？', nightBody: { ritual: '禪房的燈已經點好了。', cultural: '靜室已經備好了。' },
    testTitle: '提醒已開啟', testBody: '之後會在你選的時間輕輕提醒你，一天最多兩則。',
    lunarM: LUNAR_M,
  },
  'zh-Hans': {
    morning: (lunar) => `早安 · 农历${lunar}`,
    fest: { qingming: '清明', zhongyuan: '中元', hanyi: '寒衣节' },
    today: '今天', tomorrow: '明天',
    death: (w, who, y) => `${w}是${who}的忌日（${y} 周年）`,
    birth: (w, who, y) => `${w}是${who}的诞辰（${y} 岁）`,
    festival: (w, f) => `${w}是${f}`,
    familyBody: '有空的话，到祖先堂献一束花、说几句话。',
    eveBody: '明天早上会再轻轻提醒你一次。',
    nightTitle: '睡前，静坐五分钟？', nightBody: { ritual: '静室已经备好了。', cultural: '静室已经备好了。' },
    testTitle: '提醒已开启', testBody: '之后会在你选的时间轻轻提醒你，一天最多两则。',
    lunarM: [...LUNAR_M.slice(0, 11), '腊月'],
  },
};

// ---------------------------------------------------------------- service

export const SLOTS = { morning: 8, eve: 20, night: 22 }; // local hours
export const DAILY_MAX = 2;
const MAX_DEVICES = 10;
export const DEFAULT_PREFS = { morning: true, family: true, night: false };

const validTz = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };
const localParts = (tz, now) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
};

export class PushService {
  /**
   * @param transport  async (endpoint, { headers, body }) → { status }; defaults to fetch
   * @param subject    VAPID contact (https URL or mailto:) — the push services may use it to reach the operator
   */
  constructor({ store, users, ancestors, daily, tz, locale, mode, subject, keys = null, transport = null }) {
    Object.assign(this, { store, users, ancestors, daily, tz, locale, mode, subject });
    this.txt = TXT[locale] || TXT['zh-Hant'];
    this._keys = keys;
    this.transport = transport || (async (endpoint, init) => {
      const r = await fetch(endpoint, { method: 'POST', ...init, signal: AbortSignal.timeout(10_000) });
      return { status: r.status };
    });
  }

  /** VAPID keys: from env, else generated once and kept in the store. */
  keys() {
    if (this._keys) return this._keys;
    let k = this.store.get('meta', 'vapid');
    if (!k) { k = newVapidKeys(); this.store.put('meta', 'vapid', k); }
    return (this._keys = k);
  }

  prefsOf(user) { return { ...DEFAULT_PREFS, ...(user.notify || {}) }; }

  status(user) {
    return { devices: this.store.list('push_subs', (s) => s.userId === user.id).length, prefs: this.prefsOf(user), publicKey: this.keys().publicKey };
  }

  /** body: { subscription: { endpoint, keys: { p256dh, auth } }, tz, prefs } */
  subscribe(user, body = {}, now = Date.now()) {
    const sub = body.subscription || {};
    let url;
    try { url = new URL(sub.endpoint); } catch { throw new HttpError(422, 'invalid_endpoint'); }
    if (url.protocol !== 'https:') throw new HttpError(422, 'invalid_endpoint');
    const p256dh = fromB64u(sub.keys?.p256dh, 65, 'invalid_keys');
    const auth = fromB64u(sub.keys?.auth, 16, 'invalid_keys');
    if (p256dh[0] !== 4) throw new HttpError(422, 'invalid_keys');
    const id = crypto.createHash('sha256').update(sub.endpoint).digest('base64url');
    const mine = this.store.list('push_subs', (s) => s.userId === user.id && s.id !== id);
    if (mine.length >= MAX_DEVICES) this.store.remove('push_subs', mine.sort((a, b) => a.createdAt - b.createdAt)[0].id);
    const prev = this.store.get('push_subs', id);
    this.store.put('push_subs', id, {
      id, userId: user.id, endpoint: sub.endpoint, p256dh: b64u(p256dh), auth: b64u(auth),
      tz: validTz(body.tz) ? body.tz : this.tz, sent: prev?.userId === user.id ? prev.sent : {}, createdAt: prev?.createdAt || now,
    });
    if (body.prefs) this.setPrefs(user, body.prefs);
    return this.status(user);
  }

  setPrefs(user, prefs = {}) {
    const cur = this.prefsOf(user);
    for (const k of Object.keys(DEFAULT_PREFS)) if (typeof prefs[k] === 'boolean') cur[k] = prefs[k];
    user.notify = cur;
    this.users.save(user);
    return this.status(user);
  }

  unsubscribe(user, endpoint) {
    const id = crypto.createHash('sha256').update(String(endpoint || '')).digest('base64url');
    const s = this.store.get('push_subs', id);
    if (s && s.userId === user.id) this.store.remove('push_subs', id);
    return this.status(user);
  }

  /** Encrypt and deliver. Gone subscriptions (404 / 410) are forgotten. */
  async deliver(sub, msg, now = Date.now()) {
    const keys = this.keys();
    const body = encryptPayload(JSON.stringify(msg), sub.p256dh, sub.auth);
    let res;
    try {
      res = await this.transport(sub.endpoint, {
        headers: {
          Authorization: vapidAuth(sub.endpoint, keys, this.subject, now),
          'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
          TTL: String(6 * 3600), Urgency: 'normal', Topic: msg.tag?.slice(0, 32),
        },
        body,
      });
    } catch { return { ok: false, status: 0 }; }
    if (res.status === 404 || res.status === 410) this.store.remove('push_subs', sub.id);
    return { ok: res.status >= 200 && res.status < 300, status: res.status };
  }

  async test(user, now = Date.now()) {
    const subs = this.store.list('push_subs', (s) => s.userId === user.id);
    const msg = { title: this.txt.testTitle, body: this.txt.testBody, tag: 'test', url: '/' };
    const out = await Promise.all(subs.map((s) => this.deliver(s, msg, now)));
    return { sent: out.filter((r) => r.ok).length };
  }

  // ---- what to say

  familyLine(e, when) {
    const who = e.relation ? `${e.relation} ${e.name}` : e.name;
    if (e.kind === 'death') return this.txt.death(when, who, e.years);
    if (e.kind === 'birth') return this.txt.birth(when, who, e.years);
    return this.txt.festival(when, this.txt.fest[e.kind] || e.kind);
  }

  /** The message for one slot of one person's day, or null when there is nothing worth saying. */
  compose(user, slot, date, now = Date.now()) {
    const prefs = this.prefsOf(user);
    const events = prefs.family && this.ancestors ? this.ancestors.reminders(user, now, 2) : [];
    if (slot === 'morning') {
      const today = events.filter((e) => e.inDays === 0);
      if (today.length) {
        return { title: this.familyLine(today[0], this.txt.today), body: this.txt.familyBody, tag: `family-${date}`, url: '/?go=ancestor' };
      }
      if (!prefs.morning) return null;
      const alm = almanac(date, { tz: this.tz, mode: this.mode });
      const lunar = `${alm.lunar.leap ? '閏' : ''}${this.txt.lunarM[alm.lunar.month - 1]}${lunarDay(alm.lunar.day)}`;
      const line = this.daily?.pick(this.locale, date, user.id);
      return { title: this.txt.morning(lunar), body: line?.text || '', tag: `morning-${date}`, url: '/?go=almanac' };
    }
    if (slot === 'eve') {
      const tomorrow = events.filter((e) => e.inDays === 1);
      if (!tomorrow.length) return null;
      return { title: this.familyLine(tomorrow[0], this.txt.tomorrow), body: this.txt.eveBody, tag: `eve-${date}`, url: '/?go=ancestor' };
    }
    if (slot === 'night' && prefs.night) {
      return { title: this.txt.nightTitle, body: this.txt.nightBody[this.mode] || this.txt.nightBody.cultural, tag: `night-${date}`, url: '/?go=zen' };
    }
    return null;
  }

  /**
   * Run every minute. Each device gets each slot at most once per local day, and at most
   * DAILY_MAX messages a day; a slot that was missed (server down at 08:00) still goes out
   * later within the same hour.
   */
  async tick(now = Date.now()) {
    const jobs = [];
    for (const sub of this.store.list('push_subs')) {
      const { date, hour } = localParts(sub.tz, now);
      const slot = Object.keys(SLOTS).find((k) => SLOTS[k] === hour);
      if (!slot) continue;
      const sent = sub.sent || {};
      if (sent[slot] === date) continue;
      const user = this.store.get('users', sub.userId);
      if (!user) { this.store.remove('push_subs', sub.id); continue; }
      // the slot is decided for today even when there is nothing to say; only real messages count toward DAILY_MAX
      const count = sub.count?.date === date ? sub.count : { date, n: 0 };
      const msg = count.n < DAILY_MAX ? this.compose(user, slot, date, now) : null;
      if (msg) count.n += 1;
      sub.sent = { ...sent, [slot]: date }; sub.count = count;
      this.store.put('push_subs', sub.id, sub);
      if (msg) jobs.push(this.deliver(sub, msg, now).then((r) => ({ ...r, slot, user: user.id })));
    }
    return Promise.all(jobs);
  }
}

