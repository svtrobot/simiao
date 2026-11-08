// 修行与功德（设计文档 4.2 / 11.4）。
// 原则：功德全部在服务端计算并限速；付费道具不增加功德——功德买不到。
import { dayKey, hourIn, hash32 } from './util.js';

export const RANKS = [
  { id: 'novice',   minMinutes: 0,    stage: 'raw' },      // 初来居士 · 素坯
  { id: 'resident', minMinutes: 60,   stage: 'bisque' },   // 常住居士 · 素烧
  { id: 'guardian', minMinutes: 300,  stage: 'glaze' },    // 护法 · 施釉
  { id: 'novice_monk', minMinutes: 1200, stage: 'kiln' },  // 小沙弥 · 窑变
  { id: 'zen',      minMinutes: 3000, stage: 'kintsugi' }, // 禅子 · 金缮
];

/**
 * Each action: minimum interval between counted actions, daily cap of counted
 * actions, merit per counted action, and which habit it feeds (窑变 colour).
 * `every` = how many raw actions make one counted unit (e.g. 10 木鱼 = 1 功德).
 */
export const RULES = {
  bow:      { minIntervalMs: 1800, dailyCap: 324, merit: 1, habit: 'ritual' },   // 108 × 3
  incense:  { minIntervalMs: 4000, dailyCap: 3,   merit: 3, habit: 'incense' },  // 每日 3 炷清香
  muyu:     { minIntervalMs: 150,  dailyCap: 100, merit: 1, every: 10, habit: 'ritual' },
  bead:     { minIntervalMs: 120,  dailyCap: 30,  merit: 3, every: 108, habit: 'sutra' }, // 一圈 108 颗
  greet:    { minIntervalMs: 1500, dailyCap: 30,  merit: 1, habit: 'social' },
  wish:     { minIntervalMs: 10000, dailyCap: 3,  merit: 1, habit: 'incense' },
  rejoice:  { minIntervalMs: 1000, dailyCap: 20,  merit: 1, habit: 'social' },
  meditate: { minIntervalMs: 0,    dailyCap: 120, merit: 1, habit: 'meditate' }, // 每分钟 1
};

const ABSENCE_CRACK_DAYS = 7;

export function rankFor(minutes) {
  let r = RANKS[0];
  for (const x of RANKS) if (minutes >= x.minMinutes) r = x;
  return r;
}

export function blankPractice() {
  return { merit: 0, minutes: 0, habits: {}, gold: 0, lastVisit: 0, streak: 0, daily: { date: '', counts: {}, raw: {}, last: {} } };
}

function rollDay(p, tz, now) {
  const d = dayKey(tz, now);
  if (p.daily.date !== d) p.daily = { date: d, counts: {}, raw: {}, last: {} };
  return p.daily;
}

/**
 * Record one action. Returns { counted, merit, reason }. Mutates `p`.
 * `units` lets meditation credit several minutes at once.
 */
export function record(p, action, { tz, now = Date.now(), units = 1 } = {}) {
  const rule = RULES[action];
  if (!rule) return { counted: false, reason: 'unknown_action' };
  const day = rollDay(p, tz, now);
  const last = day.last[action] || 0;
  if (rule.minIntervalMs && now - last < rule.minIntervalMs) return { counted: false, reason: 'too_fast' };
  day.last[action] = now;

  if (rule.every) {
    day.raw[action] = (day.raw[action] || 0) + 1;
    if (day.raw[action] % rule.every !== 0) return { counted: false, reason: 'accumulating', progress: day.raw[action] % rule.every };
  }
  const used = day.counts[action] || 0;
  const n = Math.min(units, rule.dailyCap - used);
  if (n <= 0) return { counted: false, reason: 'daily_cap' };
  day.counts[action] = used + n;
  const gained = n * rule.merit;
  p.merit += gained;
  if (action === 'meditate') p.minutes += n;
  else p.minutes += n * 0.25; // rituals also count a little toward practice time
  const h = hourIn(tz, now);
  const habit = action === 'meditate' && (h >= 23 || h < 4) ? 'night' : rule.habit;
  p.habits[habit] = (p.habits[habit] || 0) + n;
  return { counted: true, merit: gained, units: n };
}

/** Called on every visit. Long absence → hairline cracks; returning → gold seams (金缮：回来就好). */
export function visit(p, now = Date.now()) {
  const gapDays = p.lastVisit ? (now - p.lastVisit) / 86400000 : 0;
  let repaired = false;
  if (gapDays >= ABSENCE_CRACK_DAYS) { p.gold += 1; repaired = true; }
  p.streak = gapDays < 2 && p.lastVisit ? p.streak + (gapDays >= 1 ? 1 : 0) : 1;
  p.lastVisit = now;
  return { repaired, gapDays };
}

/** Everything a client needs to draw this user's 泥生 (shader params, no textures). */
export function appearance(userId, p, now = Date.now()) {
  const rank = rankFor(p.minutes);
  const h = p.habits || {};
  const kilnOrder = [['meditate', 'celadon'], ['incense', 'ochre'], ['sutra', 'inkcrackle'], ['night', 'harefur']];
  let kiln = 'celadon', best = -1;
  for (const [k, look] of kilnOrder) if ((h[k] || 0) > best) { best = h[k] || 0; kiln = look; }
  const away = p.lastVisit ? (now - p.lastVisit) / 86400000 : 0;
  return {
    stage: rank.stage,
    rank: rank.id,
    kiln,
    cracks: Math.min(1, Math.max(0, (away - ABSENCE_CRACK_DAYS) / 30)),
    gold: Math.min(12, p.gold || 0),
    seed: hash32(userId),
  };
}
