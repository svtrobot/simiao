// 黃曆 / 本命佛 / 流年太歲 / 日籤（設計文檔 3.3 玄學系統、4.1 每天一個回來的理由）。
// 零依賴：農曆用 Intl 的 chinese 曆法；干支用儒略日；節氣用簡化的太陽黃經公式（誤差約十幾分鐘）。
// 服務端只回代碼（索引 / 英文鍵），文字在 client/src/i18n.js，繁簡兩套。
// 語氣：民俗參考與善意提醒，不作吉凶斷語，不引導「花錢消災」（3.3、8.3）。
import fs from 'node:fs';
import path from 'node:path';
import { hash32 } from './util.js';

const DAY = 86400000;

// ---------------------------------------------------------------- calendar maths

/** Julian day number of a Gregorian date. */
export function jdn(y, m, d) {
  const a = Math.floor((14 - m) / 12), Y = y + 4800 - a, M = m + 12 * a - 3;
  return d + Math.floor((153 * M + 2) / 5) + 365 * Y + Math.floor(Y / 4) - Math.floor(Y / 100) + Math.floor(Y / 400) - 32045;
}

/** Sexagenary index (0 = 甲子) of a day. 1949-10-01 → 0, 2000-01-01 → 54 (戊午). */
export const dayCycle = (y, m, d) => ((jdn(y, m, d) + 49) % 60 + 60) % 60;

/** Apparent solar longitude in degrees (Meeus, low precision). */
export function sunLongitude(ms) {
  const T = (ms / DAY + 2440587.5 - 2451545) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * Math.PI / 180;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) + (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
  const om = (125.04 - 1934.136 * T) * Math.PI / 180;
  return ((L0 + C - 0.00569 - 0.00478 * Math.sin(om)) % 360 + 360) % 360;
}

/** UTC ms of local midnight that starts `y-m-d` in a fixed-offset sense, using the zone's offset that day. */
function localMidnight(y, m, d, tz) {
  const guess = Date.UTC(y, m - 1, d);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(guess)).reduce((o, p) => ((o[p.type] = p.value), o), {});
  const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
  return guess - (asLocal - guess);
}

/**
 * Solar term index 0..23 counted from 春分 (λ = 0°) if one begins during this local day, else null.
 * Index k ↔ λ = 15k: 0 春分, 3 立夏, 6 夏至, 9 立秋, 12 秋分, 15 立冬, 18 冬至, 21 立春.
 */
function termOn(y, m, d, tz) {
  const a = sunLongitude(localMidnight(y, m, d, tz)), b = sunLongitude(localMidnight(y, m, d, tz) + DAY);
  const ka = Math.floor(a / 15), kb = Math.floor(b / 15);
  return ka === kb ? null : kb % 24;
}

function nextTerm(y, m, d, tz) {
  for (let i = 1; i <= 17; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    const k = termOn(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), tz);
    if (k !== null) return { term: k, date: dt.toISOString().slice(0, 10), days: i };
  }
  return null;
}

const lunarFmt = new Intl.DateTimeFormat('en-u-ca-chinese', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
/** Lunar date of a Gregorian day: { year (Gregorian year the lunar year starts in), month 1..12, leap, day }. */
export function lunarOf(y, m, d) {
  const p = Object.fromEntries(lunarFmt.formatToParts(new Date(Date.UTC(y, m - 1, d, 12))).map((x) => [x.type, x.value]));
  return { year: +p.relatedYear, month: parseInt(p.month, 10), leap: /bis/.test(p.month), day: +p.day };
}

/** Gregorian date for a lunar date (scans the ~13 months the lunar year can span). */
export function solarOf(ly, lm, ld, leap = false) {
  for (let i = 0; i < 400; i++) {
    const dt = new Date(Date.UTC(ly, 0, 1 + i, 12));
    const l = lunarOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    if (l.year === ly && l.month === lm && l.day === ld && l.leap === !!leap) return dt.toISOString().slice(0, 10);
  }
  return null;
}

function isLastLunarDay(y, m, d) {
  const n = new Date(Date.UTC(y, m - 1, d + 1));
  return lunarOf(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate()).day === 1;
}

// ---------------------------------------------------------------- folk tables

// 建除十二神 → 宜 / 忌 (everyday-life items; codes rendered by the client)
export const OFFICERS = ['jian', 'chu', 'man', 'ping', 'ding', 'zhi', 'po', 'wei', 'cheng', 'shou', 'kai', 'bi'];
const YI_JI = {
  jian:  { yi: ['pray', 'travel', 'meet', 'study'],          ji: ['build', 'marry'] },
  chu:   { yi: ['clean', 'bathe', 'medical', 'ancestor'],    ji: ['move', 'open'] },
  man:   { yi: ['pray', 'ancestor', 'open', 'meet'],         ji: ['medical', 'build'] },
  ping:  { yi: ['repair', 'clean', 'meet'],                  ji: ['plant', 'open'] },
  ding:  { yi: ['ancestor', 'pray', 'sign', 'marry'],        ji: ['travel', 'medical'] },
  zhi:   { yi: ['sign', 'plant', 'repair'],                  ji: ['move', 'open'] },
  po:    { yi: ['medical', 'clean', 'rest'],                 ji: ['marry', 'sign', 'open'] },
  wei:   { yi: ['ancestor', 'rest', 'study'],                ji: ['travel', 'climb'] },
  cheng: { yi: ['marry', 'open', 'sign', 'travel', 'pray'],  ji: ['lawsuit'] },
  shou:  { yi: ['plant', 'sign', 'ancestor'],                ji: ['travel', 'move'] },
  kai:   { yi: ['open', 'travel', 'study', 'pray', 'marry'], ji: ['build'] },
  bi:    { yi: ['rest', 'repair', 'plant'],                  ji: ['open', 'travel', 'medical'] },
};
// 黃道吉時: 青龍 starts at this hour branch, by day branch; good gods at these offsets
const QINGLONG_START = [8, 10, 0, 2, 4, 6, 8, 10, 0, 2, 4, 6];
const GOOD_GODS = new Set([0, 1, 4, 5, 7, 10]); // 青龍 明堂 金匱 天德 玉堂 司命
const WEALTH = ['ne', 'ne', 'sw', 'sw', 'n', 'n', 'e', 'e', 's', 's']; // 財神方位 by day stem
const ELEMENT = ['wood', 'wood', 'fire', 'fire', 'earth', 'earth', 'metal', 'metal', 'water', 'water'];
const SHA = ['s', 'e', 'n', 'w', 's', 'e', 'n', 'w', 's', 'e', 'n', 'w']; // 煞方 by day branch (申子辰煞南…)

// 本命佛（八大守護）by zodiac branch — ritual mode only
export const GUARDIANS = ['qianshou', 'xukongzang', 'xukongzang', 'wenshu', 'puxian', 'puxian', 'dashizhi', 'dari', 'dari', 'budong', 'amituo', 'amituo'];

// 太歲 relations of branch u to the year branch Y
const HAI = [[0, 7], [1, 6], [2, 5], [3, 4], [8, 11], [9, 10]];
const PO = [[0, 9], [6, 3], [2, 11], [8, 5], [4, 1], [10, 7]];
const XING = [[2, 5], [5, 8], [8, 2], [1, 10], [10, 7], [7, 1], [0, 3], [3, 0]];
const pair = (list, a, b) => list.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
export function taisuiRelation(yearBranch, u) {
  if (u === yearBranch) return 'zhi';
  if (u === (yearBranch + 6) % 12) return 'chong';
  if (pair(XING, yearBranch, u)) return 'xing';
  if (pair(HAI, yearBranch, u)) return 'hai';
  if (pair(PO, yearBranch, u)) return 'po';
  return null;
}

// Festivals by lunar month-day. `buddhist` ones only appear in ritual mode.
const LUNAR_FESTIVALS = {
  '1-1': ['spring', 'maitreya'], '1-15': ['lantern'], '2-19': ['guanyin_birth'], '4-8': ['buddha_birth'],
  '5-5': ['duanwu'], '6-19': ['guanyin_enlight'], '7-7': ['qixi'], '7-15': ['zhongyuan'], '7-30': ['dizang'],
  '8-15': ['midautumn'], '9-9': ['chongyang'], '9-19': ['guanyin_leave'], '12-8': ['laba', 'enlightenment'],
};
const BUDDHIST = new Set(['maitreya', 'guanyin_birth', 'buddha_birth', 'guanyin_enlight', 'dizang', 'guanyin_leave', 'enlightenment']);

// ---------------------------------------------------------------- almanac

/** 'YYYY-MM-DD' for "now" in a zone. */
export function todayIn(tz, now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

/**
 * The almanac for one local day. mode 'cultural' drops Buddhist holy days.
 * Every text field is a code; see i18n.js `alm.*`.
 */
export function almanac(dateStr, { tz = 'Asia/Taipei', mode = 'ritual' } = {}) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const noon = localMidnight(y, m, d, tz) + DAY / 2;
  const lam = sunLongitude(noon);
  // 干支年以立春為界
  const gzYear = m <= 2 && lam >= 270 && lam < 315 ? y - 1 : y;
  const yStem = ((gzYear - 4) % 10 + 10) % 10, yBranch = ((gzYear - 4) % 12 + 12) % 12;
  const mIdx = Math.floor(((lam - 315 + 360) % 360) / 30); // 0 = 寅月 (from 立春)
  const mBranch = (2 + mIdx) % 12, mStem = ((yStem % 5) * 2 + 2 + mIdx) % 10;
  const dc = dayCycle(y, m, d), dStem = dc % 10, dBranch = dc % 12;
  const officer = OFFICERS[(dBranch - mBranch + 12) % 12];
  const lunar = lunarOf(y, m, d);
  const term = termOn(y, m, d, tz);

  // leap months repeat the month number but carry none of its festivals
  const out = (lunar.leap ? [] : LUNAR_FESTIVALS[`${lunar.month}-${lunar.day}`] || []).filter((f) => mode === 'ritual' || !BUDDHIST.has(f));
  if (!lunar.leap && lunar.month === 12 && isLastLunarDay(y, m, d)) out.push('chuxi');
  // 地藏誕 is 7/30; in a 29-day seventh month it is kept on the 29th
  if (mode === 'ritual' && !lunar.leap && lunar.month === 7 && lunar.day === 29 && isLastLunarDay(y, m, d)) out.push('dizang');
  if (term === 1) out.push('qingming'); // λ 15°
  if (term === 18) out.push('dongzhi'); // λ 270°
  if (!lunar.leap && (lunar.day === 1 || lunar.day === 15)) out.push(lunar.day === 1 ? 'shuo' : 'wang');

  const start = QINGLONG_START[dBranch];
  const hours = Array.from({ length: 12 }, (_, h) => GOOD_GODS.has((h - start + 12) % 12));
  return {
    date: dateStr, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay(),
    lunar,
    gz: { year: [yStem, yBranch], month: [mStem, mBranch], day: [dStem, dBranch] },
    term, next: nextTerm(y, m, d, tz),
    officer, yi: YI_JI[officer].yi, ji: YI_JI[officer].ji,
    hours, wealth: WEALTH[dStem], color: ELEMENT[dStem],
    clash: { zodiac: (dBranch + 6) % 12, sha: SHA[dBranch] },
    festivals: out,
    taisui: {
      branch: yBranch,
      affected: Array.from({ length: 12 }, (_, u) => ({ zodiac: u, kind: taisuiRelation(yBranch, u) })).filter((x) => x.kind),
    },
  };
}

/** Folk zodiac (by lunar new year, the way people know their 生肖) of a Gregorian birthday. */
export function zodiacOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return ((lunarOf(y, m, d).year - 4) % 12 + 12) % 12;
}

/** Personal part of the almanac for a user who shared a birthday. */
export function personal(alm, birthday, { mode = 'ritual' } = {}) {
  if (!birthday) return null;
  const z = birthday.zodiac;
  const [, bm, bd] = birthday.date.split('-').map(Number);
  const [, m, d] = alm.date.split('-').map(Number);
  return {
    zodiac: z,
    guardian: mode === 'ritual' ? GUARDIANS[z] : null,
    taisui: taisuiRelation(alm.taisui.branch, z),
    clashToday: alm.clash.zodiac === z,
    birthdayToday: bm === m && bd === d,
  };
}

// ---------------------------------------------------------------- 日籤 (one gentle line a day)

export class DailyLines {
  constructor(contentDir) {
    this.lines = {};
    const dir = path.join(contentDir, 'daily');
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      if (f.endsWith('.json')) this.lines[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    }
  }
  /** Same line all day for the same person; everyone gets a different one. */
  pick(locale, date, userId = 'guest') {
    const list = this.lines[locale] || this.lines['zh-Hant'] || [];
    if (!list.length) return null;
    const i = hash32(`${userId}:${date}`) % list.length;
    return { no: i + 1, ...list[i] };
  }
}
