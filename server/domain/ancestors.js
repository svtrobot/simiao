// 祖先堂（設計文檔 2.3、3.2 中式祭祖、4.1 忌日提醒）：給離世親人設靈位，家人共享。
// 家堂是私人的：只有家人（憑邀請連結加入）看得到靈位、照片、留言；不進大殿房間廣播。
// 燒紙只在儀式模式；文化參訪模式（含大陸）是「文明祭掃」：獻花、點燭、供果、寄語（COMPLIANCE.md）。
// 獻供每天每位親人記一次功德（慎終追遠，4.2），燒紙不記功德——P1 的付費紙紮也不記。
import { newId, HttpError, dayKey } from './util.js';
import { crisisSignal, ugcRejectReason } from './compliance.js';
import { lunarOf, solarOf, termOn, todayIn } from './almanac.js';

export const MAX_TABLETS = 24;
export const MAX_MEMBERS = 30;
export const MAX_HALLS = 6;            // halls one person can belong to
export const NOTES_KEEP = 60;
export const NOTE_DAILY = 12;
export const PHOTO_MAX = 90_000;       // data-URL length (the client sends a ~320px JPEG)
export const BURN_MS = 900;            // one sheet at a time (設計 11.x：每張 1.5 秒的動作)
export const BURN_BURST = 6;
export const BURN_DAILY = 360;         // past this the fire still burns, it just stops counting

export const OFFERINGS = {
  ritual: ['flower', 'fruit', 'candle', 'incense', 'tea'],
  cultural: ['flower', 'fruit', 'candle'],
};
export const PAPER = { ritual: ['silver', 'ingot', 'lotus'], cultural: [] };
/** 付費紙紮：種類 → 背包裡的道具。只在儀式模式，用一件少一件，同樣不記功德。 */
export const PAID_PAPER = { house: 'paper_house', car: 'paper_car', clothes: 'paper_clothes' };

const DAY = 86400000;
const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const addDays = (s, n) => new Date(Date.parse(s) + n * DAY).toISOString().slice(0, 10);

function checkText(text) {
  if (!text) return;
  const reason = ugcRejectReason(text);
  if (reason) throw new HttpError(422, 'text_rejected', { reason });
}

/** 'YYYY-MM-DD' (solar or lunar digits) → [y, m, d] or throws. */
function parseDate(s, code = 'invalid_date') {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || ''));
  if (!m) throw new HttpError(422, code);
  return [+m[1], +m[2], +m[3]];
}

/**
 * Death date. Solar: { date }. Lunar: { date: lunar y-m-d, lunar: true, leap }.
 * Stored with both forms so the anniversary can follow whichever calendar the family keeps.
 */
export function parseDeath(body, today) {
  if (!body || !body.date) throw new HttpError(422, 'death_date_required');
  const lunar = !!body.lunar, leap = lunar && !!body.leap;
  const [y, m, d] = parseDate(body.date, 'invalid_death_date');
  if (y < 1850 || m < 1 || m > 12 || d < 1 || d > (lunar ? 30 : 31)) throw new HttpError(422, 'invalid_death_date');
  let date;
  if (lunar) {
    date = solarOf(y, m, d, leap);
    if (!date) throw new HttpError(422, 'invalid_death_date');
  } else {
    date = iso(y, m, d);
    if (date !== `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`) throw new HttpError(422, 'invalid_death_date');
  }
  if (date > today) throw new HttpError(422, 'invalid_death_date');
  return lunar ? { date, lunar: true, ly: y, lm: m, ld: d, leap } : { date, lunar: false };
}

/** Birth: '' | 'YYYY' | 'YYYY-MM-DD' (solar). Many families only know the year. */
export function parseBirth(s, deathDate) {
  s = String(s || '').trim();
  if (!s) return null;
  if (/^\d{4}$/.test(s)) {
    if (+s < 1800 || s > deathDate.slice(0, 4)) throw new HttpError(422, 'invalid_birth_date');
    return s;
  }
  const [y, m, d] = parseDate(s, 'invalid_birth_date');
  const date = iso(y, m, d);
  if (y < 1800 || date.slice(5) !== `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` || date > deathDate) {
    throw new HttpError(422, 'invalid_birth_date');
  }
  return date;
}

/** Next solar occurrence of month-day on/after `today` (29 Feb → 28 Feb in common years). */
function nextSolar(md, today) {
  const [, m, d] = md.split('-').map(Number);
  let y = +today.slice(0, 4);
  for (;;) {
    let dt = iso(y, m, d);
    if (+dt.slice(5, 7) !== m) dt = iso(y, m, d - 1); // rolled into March
    if (dt >= today) return { date: dt, year: y };
    y += 1;
  }
}

/** Next occurrence of a lunar month-day; a missing 30th falls on the 29th, a missing leap month on the plain one. */
function nextLunar(lm, ld, leap, today) {
  const [ty, tm, td] = today.split('-').map(Number);
  const ly0 = lunarOf(ty, tm, td).year;
  for (let ly = ly0 - 1; ly <= ly0 + 1; ly++) {
    const date = (leap && solarOf(ly, lm, ld, true)) || solarOf(ly, lm, ld, false) || solarOf(ly, lm, ld - 1, false);
    if (date && date >= today) return { date, year: ly };
  }
  return null;
}

/** Upcoming family days within `days` from today: 忌日, 冥誕 and the three ancestor festivals. */
export function upcoming(tablets, today, { days = 30, tz } = {}) {
  const out = [];
  const end = addDays(today, days);
  for (const tb of tablets) {
    const dd = tb.died;
    const next = dd.lunar ? nextLunar(dd.lm, dd.ld, dd.leap, today) : nextSolar(dd.date, today);
    if (next && next.date <= end) {
      const years = next.year - (dd.lunar ? dd.ly : +dd.date.slice(0, 4));
      if (years >= 1) out.push({ kind: 'death', date: next.date, tabletId: tb.id, years });
    }
    if (tb.born && tb.born.length === 10) {
      const b = nextSolar(tb.born, today);
      if (b.date <= end) out.push({ kind: 'birth', date: b.date, tabletId: tb.id, years: b.year - +tb.born.slice(0, 4) });
    }
  }
  if (tablets.length) {
    for (let i = 0; i <= days; i++) {
      const s = addDays(today, i);
      const [y, m, d] = s.split('-').map(Number);
      if (termOn(y, m, d, tz) === 1) out.push({ kind: 'qingming', date: s });   // 清明 (λ = 15°)
      const l = lunarOf(y, m, d);
      if (!l.leap && l.month === 7 && l.day === 15) out.push({ kind: 'zhongyuan', date: s });
      if (!l.leap && l.month === 10 && l.day === 1) out.push({ kind: 'hanyi', date: s }); // 寒衣節
    }
  }
  for (const e of out) e.inDays = daysBetween(today, e.date);
  return out.sort((a, b) => a.inDays - b.inDays);
}

export class AncestorService {
  constructor({ store, tz, hotline, useItem = null, festivals = null }) {
    Object.assign(this, { store, tz, hotline, useItem, festivals });
    this.statsMemo = { at: 0, key: '', value: null };
  }

  // ---------------------------------------------------------------- halls

  hallsOf(user) { return this.store.list('families', (f) => f.members.some((m) => m.userId === user.id)); }

  hall(user, id) {
    const f = this.store.get('families', id);
    if (!f || !f.members.some((m) => m.userId === user.id)) throw new HttpError(404, 'not_found');
    return f;
  }

  tablets(hallId) {
    return this.store.list('tablets', (t) => t.familyId === hallId).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  }

  list(user) {
    return this.hallsOf(user).map((f) => ({
      id: f.id, name: f.name, owner: f.ownerId === user.id, members: f.members.length, tablets: this.tablets(f.id).length,
    }));
  }

  create(user, body = {}, now = Date.now()) {
    if (this.hallsOf(user).some((f) => f.ownerId === user.id)) throw new HttpError(409, 'already_have_hall');
    if (this.hallsOf(user).length >= MAX_HALLS) throw new HttpError(429, 'hall_limit', { max: MAX_HALLS });
    const name = clean(body.name, 12);
    checkText(name);
    const f = {
      id: newId(8), ownerId: user.id, name, invite: newId(9), createdAt: now,
      members: [{ userId: user.id, name: user.name, joinedAt: now }],
    };
    this.store.put('families', f.id, f);
    return f;
  }

  rename(user, id, name) {
    const f = this.hall(user, id);
    if (f.ownerId !== user.id) throw new HttpError(403, 'owner_only');
    name = clean(name, 12); checkText(name);
    f.name = name; this.store.put('families', f.id, f);
    return { name };
  }

  /** What someone holding an invite link sees before joining: no tablet names, no photos. */
  invitePreview(code) {
    const f = code && this.store.list('families', (x) => x.invite === code)[0];
    if (!f) throw new HttpError(404, 'invite_not_found');
    const owner = f.members.find((m) => m.userId === f.ownerId);
    return { name: f.name, ownerName: owner?.name || '', members: f.members.length, tablets: this.tablets(f.id).length };
  }

  join(user, code, now = Date.now()) {
    const f = code && this.store.list('families', (x) => x.invite === code)[0];
    if (!f) throw new HttpError(404, 'invite_not_found');
    if (f.members.some((m) => m.userId === user.id)) return { id: f.id, already: true };
    if (f.members.length >= MAX_MEMBERS) throw new HttpError(429, 'member_limit', { max: MAX_MEMBERS });
    if (this.hallsOf(user).length >= MAX_HALLS) throw new HttpError(429, 'hall_limit', { max: MAX_HALLS });
    f.members.push({ userId: user.id, name: user.name, joinedAt: now });
    this.store.put('families', f.id, f);
    return { id: f.id, already: false };
  }

  /** Owner: new link (old one stops working). */
  resetInvite(user, id) {
    const f = this.hall(user, id);
    if (f.ownerId !== user.id) throw new HttpError(403, 'owner_only');
    f.invite = newId(9); this.store.put('families', f.id, f);
    return { invite: f.invite };
  }

  /** A member leaves, or the owner removes someone. The owner cannot leave their own hall. */
  removeMember(user, id, memberId) {
    const f = this.hall(user, id);
    const target = memberId || user.id;
    if (target === f.ownerId) throw new HttpError(409, 'owner_stays');
    if (target !== user.id && f.ownerId !== user.id) throw new HttpError(403, 'owner_only');
    f.members = f.members.filter((m) => m.userId !== target);
    this.store.put('families', f.id, f);
    return { ok: true };
  }

  // ---------------------------------------------------------------- tablets

  addTablet(user, hallId, body = {}, now = Date.now()) {
    const f = this.hall(user, hallId);
    const list = this.tablets(f.id);
    if (list.length >= MAX_TABLETS) throw new HttpError(429, 'tablet_limit', { max: MAX_TABLETS });
    const tb = { id: newId(8), familyId: f.id, createdBy: user.id, createdAt: now, order: list.length, notes: [], photo: null, photoV: 0 };
    this.fill(tb, body, now);
    this.store.put('tablets', tb.id, tb);
    return tb;
  }

  editTablet(user, hallId, tabletId, body = {}, now = Date.now()) {
    const tb = this.tabletFor(user, hallId, tabletId, { edit: true });
    this.fill(tb, body, now);
    this.store.put('tablets', tb.id, tb);
    return tb;
  }

  removeTablet(user, hallId, tabletId) {
    const tb = this.tabletFor(user, hallId, tabletId, { edit: true });
    this.store.remove('tablets', tb.id);
    return { ok: true };
  }

  tabletFor(user, hallId, tabletId, { edit = false } = {}) {
    const f = this.hall(user, hallId);
    const tb = this.store.get('tablets', tabletId);
    if (!tb || tb.familyId !== f.id) throw new HttpError(404, 'not_found');
    if (edit && tb.createdBy !== user.id && f.ownerId !== user.id) throw new HttpError(403, 'not_yours');
    return tb;
  }

  fill(tb, body, now) {
    const today = todayIn(this.tz, now);
    const name = clean(body.name ?? tb.name, 12);
    if (!name) throw new HttpError(422, 'name_required');
    const relation = clean(body.relation ?? tb.relation, 8);
    const epitaph = clean(body.epitaph ?? tb.epitaph, 30);
    for (const s of [name, relation, epitaph]) checkText(s);
    const died = body.died ? parseDeath(body.died, today) : tb.died;
    if (!died) throw new HttpError(422, 'death_date_required');
    const born = body.born !== undefined ? parseBirth(body.born, died.date) : tb.born ?? null;
    if (body.photo !== undefined) {
      if (body.photo === null || body.photo === '') tb.photo = null;
      else {
        const p = String(body.photo);
        if (!/^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(p) || p.length > PHOTO_MAX) throw new HttpError(422, 'invalid_photo');
        tb.photo = p;
      }
      tb.photoV = (tb.photoV || 0) + 1;
    }
    Object.assign(tb, { name, relation, epitaph, died, born });
  }

  /** Today's offerings & paper for a tablet; yesterday's are cleared when first touched today. */
  day(tb, now = Date.now()) {
    const date = dayKey(this.tz, now);
    if (!tb.day || tb.day.date !== date) tb.day = { date, offers: [], burned: {} };
    return tb.day;
  }

  // ---------------------------------------------------------------- 祭拜

  /**
   * One offering of a kind per person per tablet per day; offering again is a no-op.
   * Returns { first } — true for this person's first offering to this tablet today (merit).
   */
  offer(user, hallId, tabletId, kind, mode, now = Date.now()) {
    if (!(OFFERINGS[mode] || OFFERINGS.cultural).includes(kind)) throw new HttpError(422, 'invalid_offering', { kinds: OFFERINGS[mode] });
    const tb = this.tabletFor(user, hallId, tabletId);
    const day = this.day(tb, now);
    const mine = day.offers.filter((o) => o.userId === user.id);
    if (mine.some((o) => o.kind === kind)) return { tablet: tb, first: false, already: true };
    day.offers.push({ kind, userId: user.id, name: user.name, at: now });
    this.store.put('tablets', tb.id, tb);
    return { tablet: tb, first: mine.length === 0, already: false };
  }

  // ---------------------------------------------------------------- 清明雲祭掃（節日活動，server/domain/festival.js）

  /** The festival open right now and the key its records are kept under, or null. */
  season(now = Date.now()) {
    const fest = this.festivals?.current(now);
    return fest && fest.phase === 'open' ? { fest, key: `${fest.id}-${fest.year}` } : null;
  }

  /**
   * 祭掃: wipe the dust off a tablet and leave a willow sprig. Once per person per tablet per festival;
   * the sprig stays for the whole festival. It also counts as today's offering to this person, so merit
   * follows the same once-a-day rule as 獻供 (4.2) — sweeping twice, or sweeping and then offering, adds nothing.
   * Allowed in both modes: this is the 文明祭掃 form (COMPLIANCE.md).
   */
  sweep(user, hallId, tabletId, now = Date.now()) {
    const s = this.season(now);
    if (!s) throw new HttpError(409, 'not_in_season');
    const tb = this.tabletFor(user, hallId, tabletId);
    tb.sweeps = tb.sweeps || {};
    const list = tb.sweeps[s.key] || (tb.sweeps[s.key] = []);
    if (list.some((x) => x.userId === user.id)) return { tablet: tb, first: false, already: true };
    list.push({ userId: user.id, name: user.name, at: now });
    const day = this.day(tb, now);
    const first = !day.offers.some((o) => o.userId === user.id);
    day.offers.push({ kind: 'sweep', userId: user.id, name: user.name, at: now });
    this.store.put('tablets', tb.id, tb);
    this.statsMemo.at = 0;
    return { tablet: tb, first, already: false };
  }

  /** How far this family has got: tablets swept by anyone, by me, and the share card if one was made. */
  festivalView(f, tablets, user, now = Date.now()) {
    const fest = this.festivals?.current(now);
    if (!fest) return null;
    const key = `${fest.id}-${fest.year}`;
    const swept = tablets.filter((tb) => tb.sweeps?.[key]?.length);
    return {
      ...fest, total: tablets.length, swept: swept.length,
      mine: swept.filter((tb) => tb.sweeps[key].some((x) => x.userId === user.id)).length,
      card: f.cards?.[key] || null,
    };
  }

  /** 祭掃卡: a link the family can pass on. Made once per hall per festival, after at least one tablet is swept. */
  sweepCard(user, hallId, now = Date.now()) {
    const s = this.season(now);
    if (!s) throw new HttpError(409, 'not_in_season');
    const f = this.hall(user, hallId);
    if (!this.tablets(f.id).some((tb) => tb.sweeps?.[s.key]?.length)) throw new HttpError(409, 'nothing_swept');
    f.cards = f.cards || {};
    if (!f.cards[s.key]) {
      f.cards[s.key] = newId(10);
      this.store.put('sweepcards', f.cards[s.key], { id: f.cards[s.key], familyId: f.id, key: s.key, festival: s.fest.id, year: s.fest.year, createdAt: now });
      this.store.put('families', f.id, f);
    }
    return { code: f.cards[s.key] };
  }

  /** What anyone holding the card link sees: the hall's name and two counts. No names of the departed, no members, no photos. */
  sweepCardView(code) {
    const c = code && this.store.get('sweepcards', code);
    const f = c && this.store.get('families', c.familyId);
    if (!f || f.cards?.[c.key] !== c.id) throw new HttpError(404, 'not_found');
    const swept = this.tablets(f.id).filter((tb) => tb.sweeps?.[c.key]?.length);
    const people = new Set(swept.flatMap((tb) => tb.sweeps[c.key].map((x) => x.userId)));
    return { festival: c.festival, year: c.year, hallName: f.name, tablets: swept.length, people: people.size };
  }

  /** Whole-platform totals for the open festival (cached a minute; a scan — see CLAUDE.md on large collections). */
  festivalStats(now = Date.now()) {
    const fest = this.festivals?.current(now);
    if (!fest) return null;
    const key = `${fest.id}-${fest.year}`;
    if (this.statsMemo.key !== key || now - this.statsMemo.at > 60_000) {
      const halls = new Set(); let tablets = 0;
      for (const tb of this.store.list('tablets', (x) => x.sweeps?.[key]?.length)) { tablets += 1; halls.add(tb.familyId); }
      this.statsMemo = { at: now, key, value: { halls: halls.size, tablets } };
    }
    return this.statsMemo.value;
  }

  /** 寄語: a few words to the departed, seen by the family. Self-harm thoughts stay private + hotline (8.4). */
  note(user, hallId, tabletId, text, now = Date.now()) {
    const tb = this.tabletFor(user, hallId, tabletId);
    text = clean(text, 60);
    if (!text) throw new HttpError(422, 'empty');
    checkText(text);
    const date = dayKey(this.tz, now);
    const notesToday = this.store.list('tablets', (x) => x.familyId === tb.familyId)
      .reduce((n, x) => n + x.notes.filter((o) => o.userId === user.id && dayKey(this.tz, o.at) === date).length, 0);
    if (notesToday >= NOTE_DAILY) throw new HttpError(429, 'note_limit', { max: NOTE_DAILY });
    const crisis = crisisSignal(text);
    const n = { id: newId(6), userId: user.id, name: user.name, text, at: now, private: crisis };
    tb.notes.push(n);
    if (tb.notes.length > NOTES_KEEP) tb.notes.splice(0, tb.notes.length - NOTES_KEEP);
    this.store.put('tablets', tb.id, tb);
    return { note: this.noteView(n, user), support: crisis ? this.hotline : null };
  }

  removeNote(user, hallId, tabletId, noteId) {
    const f = this.hall(user, hallId);
    const tb = this.tabletFor(user, hallId, tabletId);
    const n = tb.notes.find((x) => x.id === noteId);
    if (!n) throw new HttpError(404, 'not_found');
    if (n.userId !== user.id && f.ownerId !== user.id) throw new HttpError(403, 'not_yours');
    tb.notes = tb.notes.filter((x) => x.id !== noteId);
    this.store.put('tablets', tb.id, tb);
    return { ok: true };
  }

  /**
   * 燒紙: sheets are sent in small batches as they go into the fire. Rate-limited like copying
   * (a bucket of BURN_BURST sheets refilling one per BURN_MS). Never merit.
   */
  burn(user, hallId, tabletId, { kind, n = 1 } = {}, mode, now = Date.now()) {
    const paid = PAID_PAPER[kind];
    if (mode !== 'ritual') throw new HttpError(403, 'not_in_this_mode');
    if (!paid && !PAPER[mode].includes(kind)) throw new HttpError(422, 'invalid_paper');
    n = Math.floor(Number(n));
    if (!(n >= 1 && n <= 10)) throw new HttpError(422, 'invalid_count');
    const tb = this.tabletFor(user, hallId, tabletId);
    const date = dayKey(this.tz, now);
    const b = user.burn && user.burn.date === date ? user.burn : (user.burn = { date, n: 0, tokens: BURN_BURST, at: now });
    b.tokens = Math.min(BURN_BURST, b.tokens + (now - b.at) / BURN_MS); b.at = now;
    if (b.tokens < n) throw new HttpError(429, 'too_fast');
    // take the paid item only once the sheet is really going into the fire
    if (paid && !this.useItem?.(user, paid, n)) throw new HttpError(409, 'no_item');
    b.tokens -= n;
    const counted = paid ? n : Math.max(0, Math.min(n, BURN_DAILY - b.n));
    b.n += n;
    const day = this.day(tb, now);
    if (counted) day.burned[kind] = (day.burned[kind] || 0) + counted;
    this.store.put('tablets', tb.id, tb);
    return { tablet: tb, counted };
  }

  // ---------------------------------------------------------------- views

  noteView(n, viewer) {
    return { id: n.id, name: n.name, text: n.text, at: n.at, mine: n.userId === viewer.id, private: !!n.private };
  }

  tabletView(tb, viewer, f, now = Date.now()) {
    const day = tb.day && tb.day.date === dayKey(this.tz, now) ? tb.day : { offers: [], burned: {} };
    return {
      id: tb.id, name: tb.name, relation: tb.relation, epitaph: tb.epitaph, born: tb.born,
      died: tb.died.lunar ? { date: tb.died.date, lunar: true, ly: tb.died.ly, lm: tb.died.lm, ld: tb.died.ld, leap: tb.died.leap } : { date: tb.died.date, lunar: false },
      photoV: tb.photo ? tb.photoV : 0, permanent: !!tb.permanent,
      swept: ((s) => (s ? (tb.sweeps?.[s.key] || []).map((x) => ({ name: x.name, mine: x.userId === viewer.id })) : []))(this.season(now)),
      canEdit: tb.createdBy === viewer.id || f.ownerId === viewer.id,
      today: {
        offers: day.offers.map((o) => ({ kind: o.kind, name: o.name, mine: o.userId === viewer.id })),
        burned: day.burned,
      },
      notes: tb.notes.filter((n) => !n.private || n.userId === viewer.id).slice(-20).map((n) => this.noteView(n, viewer)),
    };
  }

  /** Full hall for a member. Only members ever get here (hall() throws 404 otherwise). */
  view(user, id, mode, now = Date.now()) {
    const f = this.hall(user, id);
    const tablets = this.tablets(f.id);
    return {
      id: f.id, name: f.name, owner: f.ownerId === user.id, invite: f.invite,
      members: f.members.map((m) => ({ id: m.userId, name: m.name, owner: m.userId === f.ownerId, me: m.userId === user.id })),
      tablets: tablets.map((tb) => this.tabletView(tb, user, f, now)),
      upcoming: upcoming(tablets, todayIn(this.tz, now), { days: 45, tz: this.tz }),
      offerings: OFFERINGS[mode] || OFFERINGS.cultural, paper: PAPER[mode] || [],
      festival: this.festivalView(f, tablets, user, now),
    };
  }

  /** 描金靈位 · 長明燈（付費，P1）。只改外觀，不影響免費靈位的保存。 */
  setPermanent(tabletId, on) {
    const tb = this.store.get('tablets', tabletId);
    if (!tb) return null;
    tb.permanent = !!on;
    this.store.put('tablets', tb.id, tb);
    return tb;
  }

  photo(user, hallId, tabletId) {
    const tb = this.tabletFor(user, hallId, tabletId);
    if (!tb.photo) throw new HttpError(404, 'no_photo');
    return { photo: tb.photo, v: tb.photoV };
  }

  /** Reminders across every hall this person belongs to (shown on entering the temple). */
  reminders(user, now = Date.now(), days = 7) {
    const today = todayIn(this.tz, now);
    const out = [];
    const festivals = new Map();
    for (const f of this.hallsOf(user)) {
      const tablets = this.tablets(f.id);
      for (const e of upcoming(tablets, today, { days, tz: this.tz })) {
        if (!e.tabletId) { festivals.set(e.kind, e); continue; }
        const tb = tablets.find((x) => x.id === e.tabletId);
        out.push({ ...e, hallId: f.id, name: tb.name, relation: tb.relation });
      }
    }
    return [...out, ...festivals.values()].sort((a, b) => a.inDays - b.inDays);
  }
}
