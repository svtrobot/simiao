// 節日活動（設計文檔 4.3 節日；9.3 清明雲祭掃是公開上線的節點）。節日是資料：content/events/festivals.json。
// 每個節日有一個錨點日（清明 = 太陽黃經 15°，按部署地區的時區算），前後各開若干天：
//   warmup  錨點前 warmupDays 天起：預熱（提醒先把靈位設好）
//   open    錨點前 beforeDays 天 ～ 後 afterDays 天：活動進行（清明掃墓「前十後十」）
// 節日只改變「能做什麼儀式感的事」，不發功德以外的東西，也不賣東西（CLAUDE.md 規則 1）。
import fs from 'node:fs';
import path from 'node:path';
import { termOn, todayIn } from './almanac.js';

const DAY = 86400000;
const addDays = (s, n) => new Date(Date.parse(s) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

export class Festivals {
  /** @param preview  festival id to treat as open today (local testing: FESTIVAL_PREVIEW=qingming) */
  constructor({ contentDir, tz, preview = '' }) {
    const f = path.join(contentDir, 'events', 'festivals.json');
    this.list = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).festivals || [] : [];
    this.tz = tz;
    this.preview = preview;
    this.anchors = new Map();   // `${id}:${year}` → 'YYYY-MM-DD'
    this.memo = { day: '', value: null };
  }

  /** The festival's own day in a given year, in this deployment's time zone. */
  dateOf(fest, year) {
    const k = `${fest.id}:${year}`;
    if (!this.anchors.has(k)) {
      let found = null;
      if (fest.anchor?.solarTerm !== undefined) {
        for (let i = 0; i < 366 && !found; i++) {
          const dt = new Date(Date.UTC(year, 0, 1 + i));
          if (dt.getUTCFullYear() !== year) break;
          if (termOn(year, dt.getUTCMonth() + 1, dt.getUTCDate(), this.tz) === fest.anchor.solarTerm) found = dt.toISOString().slice(0, 10);
        }
      }
      this.anchors.set(k, found);
    }
    return this.anchors.get(k);
  }

  /** The festival that is warming up or open right now, or null. */
  current(now = Date.now()) {
    const today = todayIn(this.tz, now);
    if (this.memo.day === today) return this.memo.value;
    let value = null;
    for (const fest of this.list) {
      if (this.preview === fest.id) {
        value = { id: fest.id, phase: 'open', date: today, inDays: 0, year: +today.slice(0, 4), opens: today, closes: addDays(today, fest.afterDays), preview: true };
        break;
      }
      const date = this.dateOf(fest, +today.slice(0, 4));
      if (!date) continue;
      const opens = addDays(date, -fest.beforeDays), closes = addDays(date, fest.afterDays), warm = addDays(date, -fest.warmupDays);
      if (today < warm || today > closes) continue;
      value = { id: fest.id, phase: today >= opens ? 'open' : 'warmup', date, inDays: daysBetween(today, date), year: +date.slice(0, 4), opens, closes };
      break;
    }
    this.memo = { day: today, value };
    return value;
  }
}
