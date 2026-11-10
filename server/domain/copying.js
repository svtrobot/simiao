// 抄經 / 習字（設計文檔 2.2 靜修、3.2 屏幕描紅、4.2 抄經字數計功德）與禪房獨坐計時（2.3）。
// 功德只在這裡由服務端計算：寫字有最快速度，靜坐要有心跳，兩者都走 practice.js 的日封頂。
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './util.js';
import { record } from './practice.js';

const PUNCT = /[，。、：；！？「」]/g;
export const CHARS_PER_UNIT = 5;      // 5 字 = 1 功德單位（RULES.sutra）
export const MIN_MS_PER_CHAR = 900;   // nobody traces a character in under ~1 s
const BURST = 4;                      // a few characters of slack for network jitter
const MAX_PER_WRITE = 20;

export class CopyTexts {
  constructor(contentDir) {
    const file = path.join(contentDir, 'copy', 'texts.json');
    this.texts = JSON.parse(fs.readFileSync(file, 'utf8')).texts.map((t) => ({
      ...t,
      chars: Object.fromEntries(Object.entries(t.text).map(([l, s]) => [l, [...s.replace(PUNCT, '')]])),
    }));
  }

  get(id) { return this.texts.find((t) => t.id === id) || null; }

  /** Texts available in this mode (佛經只在儀式模式). */
  forMode(mode) { return this.texts.filter((t) => t.mode === 'any' || t.mode === mode); }

  view(t, locale) {
    const l = t.text[locale] ? locale : 'zh-Hant';
    return { id: t.id, title: t.title[l], by: t.by[l], dedication: t.dedication[l], text: t.text[l], length: t.chars[l].length };
  }
}

/** Per-user copying progress lives on the user record: user.copy = { [textId]: { pos, copies } }. */
export class CopyService {
  constructor({ texts, users, tz }) { Object.assign(this, { texts, users, tz }); this.pace = new Map(); }

  list(user, mode, locale) {
    return this.texts.forMode(mode).map((t) => ({ ...this.texts.view(t, locale), ...this.progress(user, t.id) }));
  }

  progress(user, id) {
    const p = user?.copy?.[id];
    return { pos: p?.pos || 0, copies: p?.copies || 0 };
  }

  /**
   * Record `n` newly traced characters starting at `from`. The client sends its own idea of the
   * position so a retried request can't count twice. Returns progress plus any merit gained.
   */
  write(user, { id, from, n }, mode, now = Date.now()) {
    const t = this.texts.get(id);
    if (!t || !this.texts.forMode(mode).includes(t)) throw new HttpError(403, 'not_in_this_mode');
    n = Math.floor(Number(n)); from = Math.floor(Number(from));
    if (!(n >= 1 && n <= MAX_PER_WRITE) || !Number.isFinite(from)) throw new HttpError(400, 'invalid_write');
    user.copy ??= {};
    const p = (user.copy[id] ??= { pos: 0, copies: 0, pending: 0 });
    // A retry of something already counted: answer with the current state, count nothing.
    if (from < p.pos) return { ...this.progress(user, id), merit: 0, done: false };
    if (from !== p.pos) throw new HttpError(409, 'out_of_step', { pos: p.pos });

    // Pace: a bucket that refills at one character per MIN_MS_PER_CHAR.
    const key = user.id;
    const pace = this.pace.get(key) || { tokens: BURST, at: now };
    pace.tokens = Math.min(BURST + MAX_PER_WRITE, pace.tokens + (now - pace.at) / MIN_MS_PER_CHAR);
    pace.at = now;
    const ok = Math.min(n, Math.floor(pace.tokens));
    pace.tokens -= ok;
    this.pace.set(key, pace);
    if (ok <= 0) throw new HttpError(429, 'too_fast', { pos: p.pos });

    const total = t.chars['zh-Hant'].length; // both scripts have the same length
    const step = Math.min(ok, total - p.pos);
    p.pos += step;
    p.pending = (p.pending || 0) + step;
    let merit = 0;
    const units = Math.floor(p.pending / CHARS_PER_UNIT);
    if (units > 0) {
      p.pending -= units * CHARS_PER_UNIT;
      const r = record(user.practice, 'sutra', { tz: this.tz, now, units });
      if (r.counted) merit = r.merit;
    }
    let done = false;
    if (p.pos >= total) { p.pos = 0; p.copies += 1; p.pending = 0; done = true; }
    this.users.save(user);
    return { pos: p.pos, copies: p.copies, accepted: step, merit, done };
  }

  /** Start over from the first character (keeps the count of finished copies). */
  restart(user, id) {
    if (!this.texts.get(id)) throw new HttpError(404, 'not_found');
    user.copy ??= {};
    user.copy[id] = { pos: 0, copies: user.copy[id]?.copies || 0, pending: 0 };
    this.users.save(user);
    return this.progress(user, id);
  }
}

/**
 * 禪房（單人）：不在房間裡，所以靜坐分鐘由這裡記。客戶端每分鐘報一次心跳；
 * 兩次心跳間隔太長（鎖屏、切走）那一段不算——只算真正在禪房裡的時間。
 */
export const BEAT_MS = 60_000;
const MAX_GAP_MS = 150_000;
const MAX_SESSION_MS = 3 * 3600_000;

export class ZenRooms {
  constructor({ users, tz, isSeatedElsewhere = () => false }) {
    Object.assign(this, { users, tz, isSeatedElsewhere });
    this.sessions = new Map(); // userId -> { since, lastBeat, credited (ms) }
  }

  start(user, now = Date.now()) {
    const s = { since: now, lastBeat: now, creditedTo: now, minutes: 0 };
    this.sessions.set(user.id, s);
    return { since: now, beatMs: BEAT_MS };
  }

  beat(user, now = Date.now()) {
    const s = this.sessions.get(user.id);
    if (!s) throw new HttpError(409, 'no_session');
    if (now - s.since > MAX_SESSION_MS) { this.sessions.delete(user.id); return { minutes: s.minutes, gained: 0, ended: true }; }
    // after a long gap (phone locked, tab hidden) start counting again from now
    if (now - s.lastBeat > MAX_GAP_MS) s.creditedTo = now;
    s.lastBeat = now;
    let gained = 0;
    const mins = Math.floor((now - s.creditedTo) / 60_000);
    if (mins > 0) {
      s.creditedTo += mins * 60_000;
      // the same account sitting in the hall at the same time doesn't count twice
      if (!this.isSeatedElsewhere(user.id)) {
        const r = record(user.practice, 'meditate', { tz: this.tz, now, units: mins });
        if (r.counted) { gained = r.merit; s.minutes += r.units; this.users.save(user); }
      }
    }
    return { minutes: s.minutes, gained };
  }

  end(user, now = Date.now()) {
    if (!this.sessions.has(user.id)) return { minutes: 0, gained: 0 };
    const out = this.beat(user, now);
    this.sessions.delete(user.id);
    return { ...out, ended: true };
  }
}
