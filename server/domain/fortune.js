// 求签 + 掷筊（设计文档 3.2 / 11.4）。随机数只在服务端产生，客户端只负责动画。
// 流程：draw() 摇出一支签 → throwJiao() 掷筊确认；圣筊才揭示签文，否则重新摇签。
// 每人每座寺每天揭示 1 签（免费），签文好坏与付费无关。
import fs from 'node:fs';
import path from 'node:path';
import { randInt, dayKey, HttpError } from './util.js';

const MAX_ATTEMPTS = 3; // 连续三次未得圣筊，按传统也给出最后一支签，并温和说明

export class FortuneService {
  constructor({ contentDir, store, tz }) {
    this.store = store;
    this.tz = tz;
    const f = path.join(contentDir, 'fortunes', 'zh-Hant.json');
    this.set = JSON.parse(fs.readFileSync(f, 'utf8'));
    this.byNo = new Map(this.set.lots.map((l) => [l.no, l]));
  }

  _state(userId, templeId, now) {
    const key = `${userId}:${templeId}`;
    const day = dayKey(this.tz, now);
    let s = this.store.get('fortune_state', key);
    if (!s || s.day !== day) s = { day, revealed: null, pending: null, attempts: 0 };
    return { key, s };
  }

  draw(userId, templeId, now = Date.now()) {
    const { key, s } = this._state(userId, templeId, now);
    if (s.revealed) throw new HttpError(429, 'fortune_daily_limit', { lot: this.byNo.get(s.revealed) });
    if (s.pending) return { no: s.pending, attempts: s.attempts };
    s.pending = this.set.lots[randInt(this.set.lots.length)].no;
    this.store.put('fortune_state', key, s);
    return { no: s.pending, attempts: s.attempts };
  }

  /** 圣筊 1/2 (一正一反)，笑筊 1/4 (两平面朝上)，阴筊 1/4 (两凸面朝上)。 */
  throwJiao(userId, templeId, now = Date.now()) {
    const { key, s } = this._state(userId, templeId, now);
    if (s.revealed) throw new HttpError(429, 'fortune_daily_limit', { lot: this.byNo.get(s.revealed) });
    if (!s.pending) throw new HttpError(409, 'fortune_draw_first');
    const a = randInt(2), b = randInt(2);
    const result = a !== b ? 'sheng' : a === 1 ? 'xiao' : 'yin';
    s.attempts += 1;
    let lot = null;
    if (result === 'sheng' || s.attempts >= MAX_ATTEMPTS) {
      s.revealed = s.pending;
      lot = this.byNo.get(s.pending);
    }
    s.pending = null; // revealed, or a non-圣筊: either way the next step is a fresh shake
    this.store.put('fortune_state', key, s);
    return { result, attempts: s.attempts, lot, final: !!lot, gentle: lot && result !== 'sheng' };
  }

  /** Traditions without 擲筊 (神社の御神籤): the drawn lot is the answer. */
  reveal(userId, templeId, now = Date.now()) {
    const { key, s } = this._state(userId, templeId, now);
    if (s.revealed) throw new HttpError(429, 'fortune_daily_limit', { lot: this.byNo.get(s.revealed) });
    if (!s.pending) throw new HttpError(409, 'fortune_draw_first');
    s.revealed = s.pending; s.pending = null;
    this.store.put('fortune_state', key, s);
    return { lot: this.byNo.get(s.revealed), final: true };
  }

  today(userId, templeId, now = Date.now()) {
    const { s } = this._state(userId, templeId, now);
    return s.revealed ? this.byNo.get(s.revealed) : null;
  }
}
