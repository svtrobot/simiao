// 祖先堂（2.3、3.2、4.1）：家人共享的私人家堂。進來時跟禪房一樣離開大殿房間；
// 靈位、照片、寄語只在家人之間。燒紙＝把紙一張張拖進火盆（設計 3.1 手勢），只在儀式模式。
import { api } from './api.js';
import { t } from './i18n.js';
import * as audio from './audio.js';
import { $, toast, openPanel, closePanel } from './ui.js';
import { lunarDay, lunarMonth } from './almanac.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const LAST = 'simiao.anc.hall';
const store = { get() { try { return localStorage.getItem(LAST); } catch { return null; } }, set(v) { try { localStorage.setItem(LAST, v); } catch { /* fine */ } } };

/** "祖父 王大明" — relation first when there is one. */
export const who = (x) => (x.relation ? `${x.relation} ${x.name}` : x.name);

/** One line for a reminder: 今天是祖父 王大明的忌日 / 3 天後是清明節. */
export function reminderText(e) {
  const when = e.inDays === 0 ? t('anc.today') : e.inDays === 1 ? t('anc.tomorrow') : e.inDays === 2 ? t('anc.dayAfter') : t('anc.inDays', e.inDays);
  if (e.kind === 'death') return t('anc.remDeath', when, who(e), e.years);
  if (e.kind === 'birth') return t('anc.remBirth', when, who(e), e.years);
  return t('anc.remFest', when, t(`anc.fest.${e.kind}`));
}

/** Resize a picked photo to a small JPEG data URL the server accepts (≤ ~90 KB). */
async function shrinkPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const s = Math.min(1, 320 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.82, 0.7, 0.55, 0.4]) {
      const d = c.toDataURL('image/jpeg', q);
      if (d.length < 88_000) return d;
    }
    return null;
  } finally { URL.revokeObjectURL(url); }
}

export function createAncestors(game, { mode, slug }) {
  const q = `?t=${encodeURIComponent(slug)}`;
  let halls = [], hall = null, room = null, active = false, busy = false;
  let sel = null;                 // selected tablet id
  let editing = null;             // tablet id being edited, or null for a new one
  let photoData;                  // undefined = unchanged, null = remove, string = new
  const photos = new Map();       // `${id}:${v}` → data URL
  const burn = { on: false, kind: null, pending: 0, timer: 0, sending: false };
  // 清明雲祭掃: wiping a tablet (distance dragged back and forth), then a willow sprig
  const sweep = { on: false, tablet: null, dist: 0, turns: 0, dir: 0, x: 0, y: 0, down: false, sending: false, ended: 0 };
  const SWEEP_PX = 620;

  const tablet = (id) => hall?.tablets.find((x) => x.id === id);
  let remindOn = false;
  const checkRemind = async () => {
    try { const r = await navigator.serviceWorker?.getRegistration(); remindOn = !!(await r?.pushManager.getSubscription()) && Notification.permission === 'granted'; } catch { remindOn = false; }
  };
  const onResize = () => room?.resize(window.innerWidth, window.innerHeight);

  async function fade(on, ms = 900) {
    const f = $('zen-fade');
    f.hidden = false;
    f.classList.toggle('on', on);
    await wait(ms);
    if (!on) f.hidden = true;
  }

  /** On arrival in the temple: which family days are near (shown as a toast + a dot on 祖). */
  async function init() {
    try {
      const r = await api('GET', `/api/ancestors${q}`);
      halls = r.halls;
      return r.reminders || [];
    } catch { return []; }
  }

  async function load(id) {
    hall = await api('GET', `/api/ancestors/${id}${q}`);
    store.set(hall.id);
    return hall;
  }

  // ---------------------------------------------------------------- enter / leave

  async function enter(hallId) {
    if (active || busy) return;
    if (!hallId) {
      if (!halls.length) { try { halls = (await api('GET', `/api/ancestors${q}`)).halls; } catch { /* offline */ } }
      if (!halls.length) return openStart();
      hallId = halls.find((h) => h.id === store.get())?.id || halls[0].id;
    }
    busy = true;
    try {
      $('actions').hidden = true; $('topbar').classList.add('quiet');
      $('zen-fade-text').textContent = t('anc.entering');
      await fade(true);
      const [{ buildAncestral }] = await Promise.all([import('./world/ancestral.js'), load(hallId)]);
      room = buildAncestral({ look: game.me().look, mode, quality: game.quality });
      onResize(); window.addEventListener('resize', onResize);
      room.setTablets(hall.tablets);
      await checkRemind();
      game.net.close();
      game.overlay = room;
      audio.setAmbience(0.18, 4);
      active = true;
      $('anc').hidden = false;
      render();
      await wait(200);
      $('zen-fade-text').textContent = '';
      await fade(false, 1400);
      audio.bell(0.14);
      if (!hall.tablets.length) setTimeout(() => openForm(null), 600);
    } catch (e) {
      console.error(e);
      toast(t('err.generic'));
      await cleanup();
      await fade(false, 600);
    } finally { busy = false; }
  }

  async function cleanup() {
    stopBurn();
    endSweep();
    selectTablet(null);
    for (const p of ['anc-form-panel', 'anc-fam', 'anc-start']) closePanel(p);
    $('anc').hidden = true;
    game.overlay = null;
    window.removeEventListener('resize', onResize);
    if (room) { room.dispose(); room = null; }
    if (active) game.net.reopen();
    active = false;
    audio.setAmbience(0.5, 4);
    $('actions').hidden = false; $('topbar').classList.remove('quiet');
  }

  async function leave() {
    if (!active || busy) return;
    busy = true;
    try {
      await flushBurn();
      $('zen-fade-text').textContent = '';
      await fade(true, 700);
      await cleanup();
      await fade(false, 1200);
    } finally { busy = false; }
  }

  async function switchTo(id) {
    if (!active || id === hall?.id) return;
    await flushBurn();
    stopBurn(); selectTablet(null);
    await load(id);
    room.setTablets(hall.tablets);
    render();
  }

  // ---------------------------------------------------------------- hall view

  function render() {
    if (!hall) return;
    $('anc-title').textContent = hall.name ? t('anc.titleOf', hall.name) : t('anc.title');
    const next = hall.upcoming.find((e) => e.inDays <= 14);
    $('anc-upcoming').textContent = next ? reminderText({ ...next, ...(next.tabletId ? tablet(next.tabletId) : {}) }) : '';
    // 提醒我: once there is a date worth remembering, offer reminders (opens 我的修行 → 提醒)
    $('anc-remind').hidden = !hall.tablets.length || remindOn;
    $('anc-tip').textContent = !hall.tablets.length ? t('anc.emptyTip') : mode === 'ritual' ? t('anc.tapTip') : `${t('anc.tapTip')} · ${t('anc.culturalNote')}`;
    // 清明: the hall's own progress replaces the reminder line while the festival is open
    const fest = hall.festival;
    if (fest?.phase === 'open' && hall.tablets.length) $('anc-upcoming').textContent = fest.swept >= fest.total ? t('anc.festAll') : t('anc.festLine', fest.swept, fest.total);
    else if (fest?.phase === 'warmup' && !next) $('anc-upcoming').textContent = t('fest.warmup', fest.inDays);
    $('anc-share-sweep').hidden = !(fest?.phase === 'open' && fest.swept > 0);
    room?.setFestival(!!fest);
    $('anc-bar').hidden = !!sel || burn.on || sweep.on;
    if (sel) renderSheet();
  }

  function selectTablet(id) {
    sel = id && tablet(id) ? id : null;
    room?.focus(sel);
    $('anc-sheet').hidden = !sel;
    $('anc-support').hidden = true;
    render();
  }

  async function photoFor(tb) {
    if (!tb.photoV) return null;
    const k = `${tb.id}:${tb.photoV}`;
    if (!photos.has(k)) {
      try { photos.set(k, (await api('GET', `/api/ancestors/${hall.id}/tablets/${tb.id}/photo`)).photo); } catch { return null; }
    }
    return photos.get(k);
  }

  function dates(tb) {
    const d = tb.died;
    const died = d.lunar ? t('anc.lunarDate', d.ly, lunarMonth(d.lm, d.leap) + lunarDay(d.ld)) : d.date;
    return tb.born ? t('anc.lifespan', tb.born, died) : t('anc.diedOn', died);
  }

  function renderSheet() {
    const tb = tablet(sel);
    if (!tb) return selectTablet(null);
    $('anc-name').textContent = who(tb);
    $('anc-meta').textContent = dates(tb);
    $('anc-epitaph').textContent = tb.epitaph ? `「${tb.epitaph}」` : '';
    $('anc-epitaph').hidden = !tb.epitaph;
    const img = $('anc-photo');
    img.hidden = true;
    photoFor(tb).then((src) => { if (src && sel === tb.id) { img.src = src; img.hidden = false; } });

    const box = $('anc-offers');
    box.textContent = '';
    for (const kind of hall.offerings) {
      const done = tb.today.offers.some((o) => o.kind === kind && o.mine);
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'anc-offer'; b.dataset.kind = kind;
      b.innerHTML = `<span class="glyph"></span><span></span>`;
      b.firstChild.textContent = t(`anc.glyph.${kind}`);
      b.lastChild.textContent = t(done ? `anc.done.${kind}` : `anc.offer.${kind}`);
      b.disabled = done;
      b.onclick = () => offer(kind);
      box.appendChild(b);
    }
    const names = new Map();
    for (const o of tb.today.offers) {
      const k = o.mine ? t('anc.me') : o.name;
      names.set(k, [...(names.get(k) || []), t(`anc.offer.${o.kind}`)]);
    }
    const burned = Object.entries(tb.today.burned || {}).filter(([, n]) => n > 0).map(([k, n]) => t(PAID[k] ? 'anc.burnedItem' : 'anc.burnedN', t(`anc.paper.${k}`), n));
    const today = [...names].map(([n, ks]) => `${n} ${ks.join('、')}`);
    if (burned.length) today.push(burned.join('、'));
    $('anc-today').textContent = today.length ? t('anc.todayList', today.join('；')) : t('anc.nobodyYet');
    const swept = !!tb.swept?.some((s) => s.mine);
    $('anc-sweep').hidden = hall.festival?.phase !== 'open';
    $('anc-sweep').disabled = swept;
    $('anc-sweep').textContent = t(swept ? 'anc.swept' : 'anc.sweep');
    $('anc-burn-btn').hidden = !hall.paper.length;
    $('anc-edit').hidden = !tb.canEdit;
    $('anc-gild').hidden = tb.permanent || !game.shop?.enabled();

    const ul = $('anc-notes');
    ul.textContent = '';
    for (const n of [...tb.notes].reverse()) {
      const li = document.createElement('li');
      const b = document.createElement('b'); b.textContent = n.mine ? t('anc.me') : n.name;
      const p = document.createElement('span'); p.textContent = n.text;
      const time = document.createElement('small'); time.textContent = new Date(n.at).toLocaleDateString(document.documentElement.lang, { month: 'numeric', day: 'numeric' });
      li.append(b, p, time);
      if (n.private) { const s = document.createElement('small'); s.textContent = t('anc.onlyYou'); li.append(s); }
      if (n.mine || hall.owner) {
        const x = document.createElement('button'); x.type = 'button'; x.className = 'anc-x small'; x.textContent = '×'; x.setAttribute('aria-label', t('anc.delNote'));
        x.onclick = () => removeNote(n.id);
        li.append(x);
      }
      ul.appendChild(li);
    }
    $('anc-notes').hidden = !tb.notes.length;
  }

  function replaceTablet(tb) {
    const i = hall.tablets.findIndex((x) => x.id === tb.id);
    if (i >= 0) hall.tablets[i] = tb; else hall.tablets.push(tb);
  }

  async function offer(kind) {
    const tb = tablet(sel);
    if (!tb) return;
    try {
      const r = await api('POST', `/api/ancestors/${hall.id}/tablets/${tb.id}/offer${q}`, { kind });
      replaceTablet(r.tablet);
      room.refreshOffers(hall.tablets);
      room.offer(kind);
      if (kind === 'incense') audio.sticks(0.35); else audio.clay(0.25, 1.2);
      if (r.me) game.setMe(r.me);
      if (r.merit) toast(t('merit.gain', r.merit), { gold: true });
      renderSheet();
    } catch { toast(t('err.generic')); }
  }

  async function sendNote(e) {
    e.preventDefault();
    const text = $('anc-note').value.trim();
    const tb = tablet(sel);
    if (!text || !tb) return;
    try {
      const r = await api('POST', `/api/ancestors/${hall.id}/tablets/${tb.id}/note`, { text });
      tb.notes.push(r.note);
      $('anc-note').value = '';
      if (r.support) {
        $('anc-support').hidden = false;
        $('anc-support').textContent = t('wish.support', r.support);
      }
      renderSheet();
    } catch (err) {
      toast(err.status === 422 ? t('anc.noteRejected') : err.status === 429 ? t('anc.noteLimit') : t('err.generic'));
    }
  }

  async function removeNote(id) {
    const tb = tablet(sel);
    try {
      await api('POST', `/api/ancestors/${hall.id}/tablets/${tb.id}/notes/${id}/remove`);
      tb.notes = tb.notes.filter((n) => n.id !== id);
      renderSheet();
    } catch { toast(t('err.generic')); }
  }

  // ---------------------------------------------------------------- 清明雲祭掃

  function startSweep() {
    const tb = tablet(sel);
    if (!tb || hall.festival?.phase !== 'open' || sweep.on) return;
    Object.assign(sweep, { on: true, tablet: tb.id, dist: 0, turns: 0, dir: 0, down: false });
    $('anc').classList.add('sweeping');
    $('anc-sheet').hidden = true; $('anc-bar').hidden = true; $('anc-sweep-ui').hidden = false;
    $('anc-sweep-for').textContent = t('anc.sweepHint', who(tb));
    paintSweep();
  }
  function paintSweep() {
    const k = Math.min(1, sweep.dist / SWEEP_PX);
    $('anc-sweep-fill').style.width = `${Math.round(k * 100)}%`;
    $('anc-sweep-fill').parentElement.setAttribute('aria-valuenow', String(Math.round(k * 100)));
    room?.wipe(sweep.tablet, Math.min(0.985, Math.max(0.015, k)));
  }
  function endSweep() {
    if (!sweep.on) return;
    sweep.on = false; sweep.down = false; sweep.ended = performance.now();
    $('anc').classList.remove('sweeping');
    $('anc-sweep-ui').hidden = true;
    room?.wipe(null, 0);
    if (sel) $('anc-sheet').hidden = false;
    render();
  }
  function onSweepMove(e) {
    if (!sweep.on || !sweep.down) return;
    const dx = e.clientX - sweep.x, dy = e.clientY - sweep.y;
    if (Math.abs(dx) + Math.abs(dy) < 3) return;
    const dir = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : Math.sign(dy) * 2;
    if (dir && dir !== sweep.dir) { sweep.turns += 1; sweep.dir = dir; }
    sweep.dist += Math.hypot(dx, dy);
    sweep.x = e.clientX; sweep.y = e.clientY;
    paintSweep();
    // back and forth, not one long drag off the screen
    if (sweep.dist >= SWEEP_PX && sweep.turns >= 3) finishSweep();
  }
  async function finishSweep() {
    if (sweep.sending || !sweep.on) return;
    sweep.sending = true;
    const tid = sweep.tablet;
    try {
      const r = await api('POST', `/api/ancestors/${hall.id}/tablets/${tid}/sweep${q}`);
      replaceTablet(r.tablet);
      const before = hall.festival;
      hall.festival = r.festival;
      endSweep();
      room.setTablets(hall.tablets);
      room.focus(sel);
      room.offer('sweep');
      audio.bell(0.12);
      if (r.me) game.setMe(r.me);
      toast(r.merit ? `${t('anc.sweepDone', who(r.tablet))} · ${t('merit.gain', r.merit)}` : t('anc.sweepDone', who(r.tablet)), { gold: true });
      if (r.festival && r.festival.swept >= r.festival.total && before && before.swept < before.total) setTimeout(() => toast(t('anc.festAll'), { gold: true }), 2600);
      render();
    } catch (err) {
      endSweep();
      toast(err.status === 409 ? t('anc.err.not_in_season') : t('err.generic'));
    } finally { sweep.sending = false; }
  }
  async function shareSweep() {
    try {
      const { code } = await api('POST', `/api/ancestors/${hall.id}/sweep-card`);
      const url = `${location.origin}/q/${code}`;
      if (navigator.share) { await navigator.share({ title: t('sweep.shareTitle', hall.name), text: t('sweep.shareText'), url }).catch(() => {}); return; }
      try { await navigator.clipboard.writeText(url); toast(t('anc.copied')); } catch { toast(url); }
    } catch { toast(t('err.generic')); }
  }

  // ---------------------------------------------------------------- 燒紙

  function startBurn() {
    const tb = tablet(sel);
    if (!tb || !hall.paper.length) return;
    burn.on = true; burn.tablet = tb.id;
    const kinds = paperKinds();
    burn.kind = burn.kind && kinds.includes(burn.kind) ? burn.kind : hall.paper[0];
    $('anc-sheet').hidden = true; $('anc-bar').hidden = true; $('anc-burn').hidden = false;
    $('anc-burn-for').textContent = t('anc.burnFor', who(tb));
    const box = $('anc-papers');
    box.textContent = '';
    for (const k of kinds) {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.kind = k;
      b.textContent = PAID[k] ? `${t(`anc.paper.${k}`)} ×${hall.bag[PAID[k]]}` : t(`anc.paper.${k}`);
      b.onclick = () => { burn.kind = k; paintPapers(); };
      box.appendChild(b);
    }
    paintPapers();
    $('anc-paper-shop').hidden = !game.shop?.enabled();
    room.setView('burn');
    countLine();
  }
  // 付費紙紮: kinds the family member holds in their bag (used up one by one)
  const PAID = { house: 'paper_house', car: 'paper_car', clothes: 'paper_clothes' };
  function paperKinds() { return [...hall.paper, ...Object.keys(PAID).filter((k) => (hall.bag?.[PAID[k]] || 0) > 0)]; }
  function paintPapers() {
    for (const b of $('anc-papers').children) b.setAttribute('aria-checked', String(b.dataset.kind === burn.kind));
    $('anc-stack').dataset.kind = burn.kind;
  }
  function countLine() {
    const tb = tablet(burn.tablet);
    const n = Object.values(tb?.today.burned || {}).reduce((a, b) => a + b, 0) + burn.pending;
    $('anc-burn-count').textContent = n ? t('anc.burnCount', n) : '';
  }

  function stopBurn() {
    if (!burn.on) return;
    burn.on = false;
    $('anc-burn').hidden = true; $('anc-ring').hidden = true; $('anc-drag').hidden = true;
    room?.setView('altar');
    if (sel) { room?.focus(sel); $('anc-sheet').hidden = false; }
    render();
  }

  /** A sheet went into the fire (ndc = where it was let go). */
  function putSheet(ndc) {
    const item = PAID[burn.kind];
    if (item) {
      if (!(hall.bag?.[item] > 0)) { toast(t('shop.noItem')); return; }
      hall.bag[item] -= 1;
    }
    room.burn(burn.kind, ndc);
    audio.crackle(0.12);
    burn.pending += 1;
    burn.kinds = burn.kinds || {};
    burn.kinds[burn.kind] = (burn.kinds[burn.kind] || 0) + 1;
    countLine();
    if (item) startBurn(); // repaint the counts; falls back to free paper when the last one is gone
    clearTimeout(burn.timer);
    if (burn.pending >= 3) flushBurn(); else burn.timer = setTimeout(flushBurn, 2200);
  }

  /** Send sheets in small batches, one request per paper kind. 429 → try again shortly. */
  async function flushBurn() {
    clearTimeout(burn.timer);
    if (burn.sending || !burn.pending || !hall) return;
    burn.sending = true;
    const kinds = burn.kinds || {};
    burn.kinds = {}; burn.pending = 0;
    const tid = burn.tablet;
    try {
      for (const [kind, n] of Object.entries(kinds)) {
        try {
          const r = await api('POST', `/api/ancestors/${hall.id}/tablets/${tid}/burn${q}`, { kind, n });
          const tb = tablet(tid);
          if (tb) tb.today.burned = r.burned;
          if (r.bag) { if (!burn.pending) hall.bag = r.bag; game.shop?.setBag(r.bag); }
        } catch (e) {
          if (e.status === 429) { burn.kinds[kind] = (burn.kinds[kind] || 0) + n; burn.pending += n; }
        }
      }
    } finally {
      burn.sending = false;
      countLine();
      if (burn.pending) burn.timer = setTimeout(flushBurn, 2000);
    }
  }

  // drag a sheet from the stack into the basin
  let drag = null;
  function basinPx() {
    const b = room?.basinScreen();
    if (!b) return null;
    const w = window.innerWidth, h = window.innerHeight;
    return { x: (b.x + 1) / 2 * w, y: (1 - b.y) / 2 * h, r: Math.max(56, b.r * w / 2 * 1.25) };
  }
  function showRing(over) {
    const b = basinPx(), ring = $('anc-ring');
    if (!b) return;
    ring.hidden = false;
    Object.assign(ring.style, { left: `${b.x - b.r}px`, top: `${b.y - b.r * 0.55}px`, width: `${b.r * 2}px`, height: `${b.r * 1.1}px` });
    ring.classList.toggle('over', !!over);
  }
  function onStackDown(e) {
    if (!burn.on) return;
    e.preventDefault();
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false };
    try { $('anc-stack').setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    const g = $('anc-drag');
    g.dataset.kind = burn.kind; g.hidden = false;
    moveGhost(e.clientX, e.clientY);
    showRing(false);
  }
  function moveGhost(x, y) { const g = $('anc-drag'); g.style.transform = `translate(${x - 32}px, ${y - 32}px) rotate(${(x % 30) - 15}deg)`; }
  function overBasin(x, y) { const b = basinPx(); return b && Math.hypot(x - b.x, (y - b.y) / 0.6) < b.r; }
  function onStackMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 8) drag.moved = true;
    moveGhost(e.clientX, e.clientY);
    showRing(overBasin(e.clientX, e.clientY));
  }
  function onStackUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    $('anc-drag').hidden = true; $('anc-ring').hidden = true;
    const w = window.innerWidth, h = window.innerHeight;
    if (!d.moved) return putSheet(null); // a tap puts one sheet in
    if (overBasin(e.clientX, e.clientY)) putSheet({ x: e.clientX / w * 2 - 1, y: -(e.clientY / h * 2 - 1) });
  }

  // ---------------------------------------------------------------- tablet form

  const RELS = ['祖父', '祖母', '外祖父', '外祖母', '父親', '母親', '伯父', '叔叔', '姑姑', '舅舅', '阿姨', '哥哥', '姐姐', '弟弟', '妹妹', '先生', '太太', '孩子', '朋友'];
  function fillDays() {
    const lunar = $('anc-f-lunar').checked;
    const sel2 = $('anc-f-dd'), cur = sel2.value;
    sel2.textContent = '';
    for (let d = 1; d <= (lunar ? 30 : 31); d++) sel2.add(new Option(lunar ? lunarDay(d) : t('anc.day', d), d));
    if (cur) sel2.value = cur;
    const msel = $('anc-f-dm'), mcur = msel.value;
    msel.textContent = '';
    for (let m = 1; m <= 12; m++) msel.add(new Option(lunar ? lunarMonth(m) : t('anc.month', m), m));
    if (mcur) msel.value = mcur;
    $('anc-f-leap-row').hidden = !lunar;
  }

  function openForm(id) {
    editing = id;
    const tb = id ? tablet(id) : null;
    photoData = undefined;
    $('anc-form-title').textContent = t(tb ? 'anc.editTitle' : 'anc.add');
    $('anc-rels').textContent = '';
    for (const r of RELS) $('anc-rels').append(new Option(t('anc.rel', r)));
    $('anc-f-name').value = tb?.name || '';
    $('anc-f-rel').value = tb?.relation || '';
    $('anc-f-lunar').checked = !!tb?.died.lunar;
    $('anc-f-leap').checked = !!tb?.died.leap;
    fillDays();
    const [y, m, d] = tb ? (tb.died.lunar ? [tb.died.ly, tb.died.lm, tb.died.ld] : tb.died.date.split('-').map(Number)) : ['', 1, 1];
    $('anc-f-dy').value = y; $('anc-f-dy').max = new Date().getFullYear();
    $('anc-f-dm').value = m; $('anc-f-dd').value = d;
    $('anc-f-born').value = tb?.born || '';
    $('anc-f-epi').value = tb?.epitaph || '';
    $('anc-f-photo').value = '';
    $('anc-f-err').hidden = true;
    $('anc-f-remove').hidden = !tb;
    const img = $('anc-f-photo-img');
    img.hidden = true; $('anc-f-photo-clear').hidden = true;
    if (tb?.photoV) photoFor(tb).then((src) => { if (src && editing === id) { img.src = src; img.hidden = false; $('anc-f-photo-clear').hidden = false; } });
    openPanel('anc-form-panel');
  }

  async function submitForm(e) {
    e.preventDefault();
    const pad = (n) => String(n).padStart(2, '0');
    const body = {
      name: $('anc-f-name').value, relation: $('anc-f-rel').value, epitaph: $('anc-f-epi').value, born: $('anc-f-born').value.trim(),
      died: { date: `${$('anc-f-dy').value}-${pad($('anc-f-dm').value)}-${pad($('anc-f-dd').value)}`, lunar: $('anc-f-lunar').checked, leap: $('anc-f-leap').checked },
    };
    if (photoData !== undefined) body.photo = photoData;
    try {
      const tb = await api('POST', `/api/ancestors/${hall.id}/tablets${editing ? `/${editing}` : ''}`, body);
      replaceTablet(tb);
      closePanel('anc-form-panel');
      await load(hall.id); // order + reminders come from the server
      room.setTablets(hall.tablets);
      if (!editing) { toast(t('anc.placed', who(tb)), { gold: true }); audio.bell(0.16); window.dispatchEvent(new Event('simiao:keep')); }
      selectTablet(tb.id);
    } catch (err) {
      $('anc-f-err').hidden = false;
      $('anc-f-err').textContent = t(`anc.err.${err.body?.error}`) !== `anc.err.${err.body?.error}` ? t(`anc.err.${err.body?.error}`) : t('err.generic');
    }
  }

  async function removeTablet() {
    const tb = tablet(editing);
    if (!tb || !confirm(t('anc.removeConfirm', who(tb)))) return;
    try {
      await api('POST', `/api/ancestors/${hall.id}/tablets/${tb.id}/remove`);
      closePanel('anc-form-panel');
      selectTablet(null);
      await load(hall.id);
      room.setTablets(hall.tablets);
      render();
    } catch { toast(t('err.generic')); }
  }

  // ---------------------------------------------------------------- family

  const inviteUrl = () => `${location.origin}/f/${hall.invite}`;

  function openFamily() {
    $('anc-rename').hidden = !hall.owner;
    $('anc-rename-input').value = hall.name;
    const ul = $('anc-members');
    ul.textContent = '';
    for (const m of hall.members) {
      const li = document.createElement('li');
      li.textContent = m.me ? `${m.name}（${t('anc.me')}）` : m.name;
      if (m.owner) { const s = document.createElement('small'); s.textContent = t('anc.ownerTag'); li.append(s); }
      if (hall.owner && !m.owner) {
        const x = document.createElement('button'); x.type = 'button'; x.className = 'btn-ghost small'; x.textContent = t('anc.removeMember');
        x.onclick = async () => {
          if (!confirm(t('anc.removeMemberConfirm', m.name))) return;
          try { await api('POST', `/api/ancestors/${hall.id}/leave`, { memberId: m.id }); await load(hall.id); openFamily(); } catch { toast(t('err.generic')); }
        };
        li.append(x);
      }
      ul.appendChild(li);
    }
    $('anc-invite-link').value = inviteUrl();
    $('anc-invite-share').hidden = !navigator.share;
    $('anc-invite-reset').hidden = !hall.owner;
    $('anc-quit').hidden = hall.owner;
    $('anc-own').hidden = halls.some((h) => h.owner);
    $('anc-halls-sec').hidden = halls.length < 2;
    const hl = $('anc-halls');
    hl.textContent = '';
    for (const h of halls) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn-ghost small'; b.textContent = h.name || t('anc.title');
      b.disabled = h.id === hall.id;
      b.onclick = async () => { closePanel('anc-fam'); await switchTo(h.id); };
      const li = document.createElement('li'); li.append(b); hl.append(li);
    }
    openPanel('anc-fam');
  }

  async function refreshHalls() { try { halls = (await api('GET', `/api/ancestors${q}`)).halls; } catch { /* keep */ } }

  // ---------------------------------------------------------------- start / join

  function openStart() {
    $('anc-hall-name').value = '';
    openPanel('anc-start');
  }
  async function createHall(e) {
    e.preventDefault();
    try {
      const h = await api('POST', `/api/ancestors${q}`, { name: $('anc-hall-name').value });
      closePanel('anc-start');
      await refreshHalls();
      if (active) { await switchTo(h.id); } else await enter(h.id);
    } catch (err) {
      toast(err.status === 422 ? t('anc.err.text_rejected') : t('err.generic'));
    }
  }

  /** /f/<code>: join a family hall from an invite link, then go in. */
  async function joinByInvite(code) {
    try {
      const r = await api('POST', `/api/invites/${encodeURIComponent(code)}/join`);
      await refreshHalls();
      if (!r.already) toast(t('anc.joined'), { gold: true });
      await enter(r.id);
    } catch { toast(t('anc.inviteGone')); }
  }

  // ---------------------------------------------------------------- wiring

  $('anc-leave').onclick = leave;
  $('anc-family').onclick = openFamily;
  $('anc-remind').onclick = () => { $('me-chip').click(); setTimeout(() => $('rem')?.scrollIntoView({ block: 'center' }), 500); };
  $('anc-add').onclick = () => openForm(null);
  $('anc-sheet-close').onclick = () => selectTablet(null);
  $('anc-edit').onclick = () => openForm(sel);
  $('anc-burn-btn').onclick = startBurn;
  $('anc-sweep').onclick = startSweep;
  $('anc-sweep-skip').onclick = () => { sweep.dist = SWEEP_PX; paintSweep(); finishSweep(); }; // no drag needed (keyboard, switch access)
  $('anc-sweep-cancel').onclick = endSweep;
  $('anc-share-sweep').onclick = shareSweep;
  const reloadHall = async () => { await load(hall.id); room.setTablets(hall.tablets); render(); };
  $('anc-gild').onclick = () => game.shop.open({ context: 'tablet', target: { hallId: hall.id, tabletId: sel }, onDone: reloadHall });
  $('anc-paper-shop').onclick = async () => {
    await flushBurn();
    game.shop.open({ context: 'paper', onDone: async () => { await load(hall.id); if (burn.on) startBurn(); } });
  };
  $('anc-burn-done').onclick = async () => { await flushBurn(); stopBurn(); };
  $('anc-note-form').onsubmit = sendNote;
  $('anc-form').onsubmit = submitForm;
  $('anc-f-lunar').onchange = fillDays;
  $('anc-f-remove').onclick = removeTablet;
  $('anc-f-photo').onchange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const d = await shrinkPhoto(f).catch(() => null);
    if (!d) { toast(t('anc.err.invalid_photo')); return; }
    photoData = d;
    $('anc-f-photo-img').src = d; $('anc-f-photo-img').hidden = false; $('anc-f-photo-clear').hidden = false;
  };
  $('anc-f-photo-clear').onclick = () => { photoData = null; $('anc-f-photo-img').hidden = true; $('anc-f-photo-clear').hidden = true; $('anc-f-photo').value = ''; };
  $('anc-start-form').onsubmit = createHall;
  $('anc-own').onclick = () => { closePanel('anc-fam'); openStart(); };
  $('anc-rename').onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api('POST', `/api/ancestors/${hall.id}/name`, { name: $('anc-rename-input').value }); hall.name = r.name; await refreshHalls(); render(); toast(t('anc.renamed')); } catch { toast(t('anc.err.text_rejected')); }
  };
  $('anc-invite-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(inviteUrl()); toast(t('anc.copied')); } catch { $('anc-invite-link').select(); }
  };
  $('anc-invite-share').onclick = () => navigator.share?.({ title: t('anc.shareTitle', hall.name || t('anc.title')), text: t('anc.shareText'), url: inviteUrl() }).catch(() => {});
  $('anc-invite-reset').onclick = async () => {
    if (!confirm(t('anc.resetConfirm'))) return;
    try { hall.invite = (await api('POST', `/api/ancestors/${hall.id}/invite`)).invite; $('anc-invite-link').value = inviteUrl(); toast(t('anc.resetDone')); } catch { toast(t('err.generic')); }
  };
  $('anc-quit').onclick = async () => {
    if (!confirm(t('anc.quitConfirm'))) return;
    try {
      await api('POST', `/api/ancestors/${hall.id}/leave`, {});
      closePanel('anc-fam');
      await refreshHalls();
      if (halls.length) await switchTo(halls[0].id); else await leave();
    } catch { toast(t('err.generic')); }
  };

  // taps on the hall pick a tablet; taps on empty space put the camera back
  $('anc-hit').addEventListener('click', (e) => {
    if (!room || burn.on || sweep.on || performance.now() - sweep.ended < 400) return;
    const id = room.pick(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight * 2 - 1), window.innerWidth, window.innerHeight);
    selectTablet(id);
  });
  const hit = $('anc-hit');
  hit.addEventListener('pointerdown', (e) => { if (!sweep.on) return; sweep.down = true; sweep.x = e.clientX; sweep.y = e.clientY; try { hit.setPointerCapture(e.pointerId); } catch { /* synthetic */ } });
  hit.addEventListener('pointermove', onSweepMove);
  for (const ev of ['pointerup', 'pointercancel']) hit.addEventListener(ev, () => { sweep.down = false; });
  const stack = $('anc-stack');
  stack.addEventListener('pointerdown', onStackDown);
  stack.addEventListener('pointermove', onStackMove);
  stack.addEventListener('pointerup', onStackUp);
  stack.addEventListener('pointercancel', () => { drag = null; $('anc-drag').hidden = true; $('anc-ring').hidden = true; });
  stack.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (burn.on) putSheet(null); } });

  return { init, enter, leave, joinByInvite, get active() { return active; } };
}
