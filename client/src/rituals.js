// 仪式交互（设计文档 3.1 四层反馈：手势 / 视觉 / 声音 / 回应）。
// 每个仪式：走到对应槽位 → 手势 → 泥生动作 + 音效 → 服务端回应（功德、签文、香火）。
import { api, ApiError } from './api.js';
import { t, getLocale } from './i18n.js';
import * as audio from './audio.js';
import { $, toast, hint, openPanel, closePanel } from './ui.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function createRituals(game) {
  const { controls, net, temple, anchors, self, slug } = game;
  let busy = false;

  async function walkTo(anchor) {
    if (!anchor) return false;
    hint(t('hint.walking'));
    const ok = await controls.goTo({ ...anchor, run: true });
    hint('');
    return ok;
  }

  function act(a) { self().setAction(a); net.send({ t: 'act', a }); }
  function idle() { act('idle'); }

  // ---------- 合掌 / 问讯 ----------
  async function gassho() {
    act('pray'); await wait(450); audio.clay(0.5); self().pulse(0.8);
    await wait(900); idle();
  }
  async function bow() {
    if (game.scene?.etiquette?.bow === '2-2-1') return shrineBow();
    act('bow'); await wait(500); audio.clay(0.35);
    net.send({ t: 'rit', k: 'bow' });
    await wait(1600); idle();
  }
  /** 神社: 二禮、二拍手、一禮 */
  async function shrineBow() {
    if (busy) return; busy = true;
    try {
      hint(t('bow.etiquette'));
      for (let i = 0; i < 2; i++) { act('bow'); await wait(900); idle(); await wait(500); }
      act('pray'); await wait(500);
      for (let i = 0; i < 2; i++) { audio.clay(0.55, 1.5); self().pulse(0.6); await wait(450); }
      await wait(600);
      act('bow'); await wait(400); audio.clay(0.3);
      net.send({ t: 'rit', k: 'bow' });
      await wait(900); idle();
    } finally { hint(''); busy = false; }
  }

  // ---------- 上香 ----------
  async function incense() {
    if (busy) return; busy = true;
    try {
      if (!(await walkTo(anchors.burner))) return;
      controls.locked = true;
      const item = chooseIncense();
      const lit = await holdToLight();
      if (!lit) return;
      const chosen = item();
      act('incense'); audio.sticks(0.3);
      hint(t('incense.lit'));
      await wait(1400);
      for (let i = 0; i < 3; i++) { // 举香齐眉三拜
        self().setAction('bow'); await wait(700); self().setAction('incense'); await wait(650);
      }
      // 高香 / 龍鳳香 come from the bag and never add merit; 清香 is the free three a day
      net.send(chosen ? { t: 'rit', k: 'incense', i: chosen } : { t: 'rit', k: 'incense' });
      hint('');
      await wait(300);
      idle();
    } finally { controls.locked = false; busy = false; closePanel('incense-panel'); }
  }

  /** 清香（免費）或背包裡的高香 / 龍鳳香。Returns a getter for the choice at the moment of lighting. */
  function chooseIncense() {
    const bag = game.shop?.bag() || {};
    const kinds = [null, ...['incense_high', 'incense_dragon'].filter((k) => bag[k] > 0)];
    let chosen = null;
    const box = $('incense-kinds');
    const paint = () => {
      for (const b of box.children) b.setAttribute('aria-checked', String((b.dataset.item || null) === chosen));
      $('incense-tip').textContent = chosen ? t('incense.holdItem', t(`item.${chosen}`)) : t('incense.hold');
    };
    box.replaceChildren(...kinds.map((k) => {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'radio');
      if (k) b.dataset.item = k;
      b.textContent = k ? `${t(`item.${k}`)} ×${bag[k]}` : t('incense.plain');
      b.onclick = () => { chosen = k; paint(); };
      return b;
    }));
    box.hidden = kinds.length < 2;
    $('incense-shop').hidden = !game.shop?.enabled();
    $('incense-shop').onclick = () => game.shop.open({ context: 'incense' });
    paint();
    return () => chosen;
  }

  function holdToLight() {
    return new Promise((resolve) => {
      openPanel('incense-panel', () => resolve(false));
      const btn = $('incense-hold'), ring = $('incense-ring');
      const C = 276.5; let start = 0, raf = 0;
      const reset = () => { cancelAnimationFrame(raf); start = 0; ring.style.strokeDashoffset = C; };
      const tick = () => {
        const k = Math.min(1, (performance.now() - start) / 1200);
        ring.style.strokeDashoffset = String(C * (1 - k));
        if (k >= 1) { cleanup(); audio.crackle(0.25); self().pulse(1.2); closePanelSilently(); resolve(true); return; }
        raf = requestAnimationFrame(tick);
      };
      const down = (e) => { e.preventDefault(); start = performance.now(); raf = requestAnimationFrame(tick); };
      const up = () => reset();
      const closePanelSilently = () => { $('incense-panel').hidden = true; };
      const cleanup = () => { btn.removeEventListener('pointerdown', down); btn.removeEventListener('pointerup', up); btn.removeEventListener('pointerleave', up); reset(); };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointerleave', up);
      btn.onkeydown = (e) => { if ((e.key === ' ' || e.key === 'Enter') && !start) down(e); };
      btn.onkeyup = up;
    });
  }

  // ---------- 求签 + 掷筊 ----------
  async function fortune() {
    if (busy) return; busy = true;
    try {
      if (!(await walkTo(anchors.fortune))) return;
      controls.locked = true;
      $('lot').hidden = true; $('jiao').hidden = true; $('tube').hidden = false;
      $('fortune-jiao').hidden = true; $('fortune-shake').hidden = false; $('fortune-shake').disabled = false;
      $('fortune-jiao').textContent = t(noJiao() ? 'fortune.reveal' : 'fortune.jiao');
      $('fortune-msg').textContent = t('fortune.shaking');
      const done = new Promise((resolve) => openPanel('fortune-panel', resolve));
      try {
        const today = await api('GET', `/api/temples/${slug}/fortune/today`);
        if (today.lot) { $('fortune-msg').textContent = t('fortune.limit'); showLot(today.lot); $('fortune-shake').hidden = true; }
      } catch { /* ignore */ }
      motionShake();
      await done;
    } finally { controls.locked = false; busy = false; idle(); }
  }

  let shaking = false;
  async function shake() {
    if (shaking) return; shaking = true;
    $('fortune-shake').disabled = true;
    act('fortune');
    const tube = $('tube'); tube.classList.remove('drop'); tube.classList.add('shaking');
    for (let i = 0; i < 6; i++) { audio.sticks(0.35); await wait(260); }
    try {
      const out = await api('POST', `/api/temples/${slug}/fortune/draw`);
      tube.classList.remove('shaking'); tube.classList.add('drop'); audio.clay(0.3, 0.8);
      await wait(900);
      $('fortune-msg').textContent = t(noJiao() ? 'fortune.drawnPlain' : 'fortune.drawn', out.no);
      $('fortune-shake').hidden = true; $('fortune-jiao').hidden = false;
    } catch (e) {
      tube.classList.remove('shaking');
      if (e instanceof ApiError && e.body?.lot) { $('fortune-msg').textContent = t('fortune.limit'); showLot(e.body.lot); $('fortune-shake').hidden = true; }
      else toast(t('err.generic'));
    } finally { shaking = false; $('fortune-shake').disabled = false; self().setAction('idle'); }
  }

  // 神社の御神籤 has no 擲筊: the drawn slip is simply opened (manifest.fortune.jiao === false)
  const noJiao = () => game.scene?.fortune?.jiao === false;
  async function reveal() {
    $('fortune-jiao').disabled = true;
    try {
      const out = await api('POST', `/api/temples/${slug}/fortune/reveal`);
      audio.clay(0.25, 1.4); self().setAction('pray');
      $('fortune-msg').textContent = '';
      $('fortune-jiao').hidden = true; $('tube').hidden = true;
      showLot(out.lot);
    } catch { toast(t('err.generic')); } finally { $('fortune-jiao').disabled = false; }
  }

  async function throwJiao() {
    if (noJiao()) return reveal();
    $('fortune-jiao').disabled = true;
    const j = $('jiao'); $('tube').hidden = true; j.hidden = false; j.className = 'jiao toss';
    try {
      const out = await api('POST', `/api/temples/${slug}/fortune/jiao`);
      await wait(900);
      audio.clay(0.4, 0.7); setTimeout(() => audio.clay(0.3, 0.75), 120);
      j.className = `jiao ${out.result === 'sheng' ? 'mixed' : out.result === 'xiao' ? 'flat' : ''}`;
      // 圣筊点头 / 笑筊歪头 / 阴筊肩膀微垂
      self().setAction(out.result === 'sheng' ? 'pray' : 'idle');
      if (out.final) {
        $('fortune-msg').textContent = out.gentle ? t('fortune.gentle') : t(`jiao.${out.result}`);
        $('fortune-jiao').hidden = true;
        showLot(out.lot);
      } else {
        $('fortune-msg').textContent = t(`jiao.${out.result}`);
        $('fortune-jiao').hidden = true; $('fortune-shake').hidden = false;
        $('tube').hidden = false; j.hidden = true; $('tube').classList.remove('drop');
      }
    } catch { toast(t('err.generic')); } finally { $('fortune-jiao').disabled = false; }
  }

  function showLot(lot) {
    $('lot').hidden = false;
    $('lot-no').textContent = t('lot.no', lot.no);
    $('lot-level').textContent = lot.level;
    $('lot-poem').replaceChildren(...lot.poem.map((line) => { const s = document.createElement('span'); s.textContent = line; return s; }));
    $('lot-meaning').textContent = lot.meaning;
    const keys = Object.keys(lot.advice);
    const tabs = keys.map((k, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.role = 'tab'; b.textContent = k;
      b.setAttribute('aria-selected', String(i === 0));
      b.onclick = () => { tabs.forEach((x) => x.setAttribute('aria-selected', 'false')); b.setAttribute('aria-selected', 'true'); $('lot-advice-text').textContent = lot.advice[k]; };
      return b;
    });
    $('lot-advice').replaceChildren(...tabs);
    $('lot-advice-text').textContent = lot.advice[keys[0]];
    $('lot-share').onclick = () => shareLot(lot);
  }

  function shareLot(lot) {
    // 竖版古风签文图（朋友圈 / IG Story 尺寸）
    const c = document.createElement('canvas'); c.width = 1080; c.height = 1920;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 1920); grd.addColorStop(0, '#2a201a'); grd.addColorStop(1, '#120e0b');
    g.fillStyle = grd; g.fillRect(0, 0, 1080, 1920);
    g.strokeStyle = '#d2ad5e'; g.lineWidth = 6; g.strokeRect(70, 70, 940, 1780);
    g.fillStyle = '#d2ad5e'; g.textAlign = 'center';
    g.font = '600 64px "Noto Serif TC","Songti TC",serif'; g.fillText(`${game.templeName} · ${t('lot.no', lot.no)}`, 540, 230);
    g.font = '500 52px "Noto Serif TC","Songti TC",serif'; g.fillText(lot.level, 540, 320);
    g.fillStyle = '#efe7da'; g.font = '500 76px "Noto Serif TC","Songti TC",serif';
    lot.poem.forEach((line, i) => { [...line].forEach((ch, k) => g.fillText(ch, 760 - i * 150, 520 + k * 100)); });
    g.font = '400 40px "Noto Sans TC",sans-serif'; g.fillStyle = '#c9bfb0';
    wrap(g, lot.meaning, 540, 1360, 820, 64);
    g.font = '400 30px "Noto Sans TC",sans-serif'; g.fillStyle = '#a49a8c';
    g.fillText(t('fortune.fineprint'), 540, 1760);
    const a = document.createElement('a'); a.download = `lot-${lot.no}.png`; a.href = c.toDataURL('image/png'); a.click();
  }
  function wrap(g, text, x, y, maxW, lh) {
    let line = '';
    for (const ch of text) { if (g.measureText(line + ch).width > maxW) { g.fillText(line, x, y); line = ch; y += lh; } else line += ch; }
    g.fillText(line, x, y);
  }

  // 摇手机 = 摇签筒（Android 直接可用；iOS 需用户点击授权）
  function motionShake() {
    if (!('DeviceMotionEvent' in window)) return;
    let last = 0, energy = 0;
    const onMotion = (e) => {
      const a = e.accelerationIncludingGravity; if (!a) return;
      const m = Math.abs(a.x || 0) + Math.abs(a.y || 0) + Math.abs(a.z || 0);
      energy = energy * 0.9 + Math.abs(m - last); last = m;
      if (energy > 60 && !$('fortune-panel').hidden && !$('fortune-shake').hidden) { energy = 0; shake(); }
    };
    const start = () => window.addEventListener('devicemotion', onMotion);
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      $('fortune-shake').addEventListener('click', () => DeviceMotionEvent.requestPermission().then((s) => s === 'granted' && start()).catch(() => {}), { once: true });
    } else start();
    const stop = () => window.removeEventListener('devicemotion', onMotion);
    const obs = new MutationObserver(() => { if ($('fortune-panel').hidden) { stop(); obs.disconnect(); } });
    obs.observe($('fortune-panel'), { attributes: true, attributeFilter: ['hidden'] });
  }

  // ---------- 木鱼 / 念珠 ----------
  async function counter(kind) {
    if (busy) return; busy = true;
    try {
      if (kind === 'muyu' && !(await walkTo(anchors.muyu))) return;
      controls.locked = kind === 'muyu';
      act(kind === 'muyu' ? 'muyu' : 'bead');
      let n = 0;
      const pad = $('count-pad');
      pad.classList.toggle('beads', kind === 'bead');
      $('count-title').textContent = t(kind === 'muyu' ? 'muyu.title' : 'beads.title');
      const sub = () => { $('count-sub').textContent = kind === 'muyu' ? t('muyu.sub') : t('beads.sub', Math.floor(n / 108)); };
      $('count-n').textContent = '0'; sub();
      const hit = () => {
        n++; $('count-n').textContent = kind === 'bead' ? String(n % 108 || 108) : String(n); sub();
        if (kind === 'muyu') audio.muyu(); else audio.bead();
        if (kind === 'bead' && n % 108 === 0) audio.bell(0.25);
        net.send({ t: 'rit', k: kind === 'muyu' ? 'muyu' : 'bead' });
        if (navigator.vibrate) navigator.vibrate(8);
      };
      pad.onclick = hit;
      const key = (e) => { if (e.key === ' ' && !$('count-panel').hidden && document.activeElement !== pad) { e.preventDefault(); hit(); } };
      window.addEventListener('keydown', key);
      await new Promise((resolve) => openPanel('count-panel', resolve));
      window.removeEventListener('keydown', key);
      pad.onclick = null;
    } finally { controls.locked = false; busy = false; idle(); }
  }

  // ---------- 静坐 ----------
  let sitting = null;
  async function sit() {
    if (busy || sitting) return; busy = true;
    try {
      const seat = game.freeSeat();
      if (!seat) { toast(t('sit.full')); return; }
      hint(t('sit.find'));
      const ok = await controls.goTo({ x: seat.x, z: seat.z + 0.9, run: true });
      hint('');
      if (!ok) return;
      net.send({ t: 'sit', seat: seat.id });
      controls.place(seat.x, seat.z, seat.ry ?? Math.PI);
      controls.locked = true;
      self().setAction('sit');
      audio.clay(0.25, 1.3);
      sitting = { seat, start: performance.now() };
      startBreath();
    } finally { busy = false; }
  }
  function stand() {
    if (!sitting) return;
    net.send({ t: 'stand' });
    sitting = null; controls.locked = false; idle(); stopBreath();
  }
  let breathTimer = 0;
  function startBreath() {
    $('breath').hidden = false; $('actions').hidden = true;
    const core = document.querySelector('.breath-core');
    let inhale = true;
    const step = () => {
      if (!sitting) return;
      const mins = (performance.now() - sitting.start) / 60000;
      const len = Math.min(6000, 4000 + mins * 400); // 呼吸逐渐变慢
      core.style.transitionDuration = `${len}ms`;
      core.style.transform = inhale ? 'scale(2.6)' : 'scale(1)';
      $('breath-word').textContent = t(inhale ? 'sit.in' : 'sit.out');
      inhale = !inhale;
      breathTimer = setTimeout(step, len);
    };
    step();
    const clock = () => {
      if (!sitting) return;
      const s = Math.floor((performance.now() - sitting.start) / 1000);
      $('breath-time').textContent = t('sit.time', Math.floor(s / 60), s % 60);
      setTimeout(clock, 1000);
    };
    clock();
  }
  function stopBreath() { clearTimeout(breathTimer); $('breath').hidden = true; $('actions').hidden = false; }
  $('breath-stop').onclick = stand;

  // ---------- 祈愿 ----------
  async function wish() {
    if (busy) return; busy = true;
    try {
      await walkTo(anchors.wish);
      act('wish');
      $('wish-support').hidden = true;
      await refreshWall();
      const done = new Promise((resolve) => openPanel('wish-panel', resolve));
      $('wish-form').onsubmit = async (e) => {
        e.preventDefault();
        try {
          const out = await api('POST', `/api/temples/${slug}/wishes`, { text: $('wish-text').value, anonymous: $('wish-anon').checked });
          $('wish-text').value = '';
          if (out.support) {
            $('wish-support').hidden = false;
            $('wish-support').textContent = `${t('wish.private')} ${t('wish.support', out.support)}`;
          } else {
            toast(t('wish.done'), { gold: true }); audio.clay(0.3, 1.1);
          }
          await refreshWall();
        } catch (err) { toast(err.body?.error === 'wish_rejected' ? t('wish.rejected') : t('err.generic')); }
      };
      await done;
    } finally { busy = false; idle(); }
  }

  async function refreshWall() {
    try {
      const list = await api('GET', `/api/temples/${slug}/wishes`);
      temple.setTablets(list.length);
      $('wish-list').replaceChildren(...list.slice(0, 30).map((w) => {
        const li = document.createElement('li'); li.textContent = w.text;
        const who = document.createElement('span'); who.className = 'who'; who.textContent = w.name || t('wish.someone');
        const b = document.createElement('button'); b.type = 'button'; b.textContent = `${t('wish.rejoice')} ${w.rejoice || ''}`;
        b.onclick = async () => { try { const r = await api('POST', `/api/wishes/${w.id}/rejoice`); b.textContent = `${t('wish.rejoice')} ${r.rejoice}`; b.disabled = true; } catch { b.disabled = true; } };
        li.append(who, b);
        return li;
      }));
    } catch { /* offline wall is fine */ }
  }

  // ---------- 點燈 / 燈牆 / 祈福卡（3.2、4.3） ----------
  let lampState = { kinds: [], lamps: [], mine: [] };
  let lampCells = new Map();
  const fmtDate = (ms) => new Date(ms).toLocaleDateString(getLocale(), { month: 'long', day: 'numeric' });
  const kindName = (k) => t(`lamp.kind.${k}`);
  const cardUrl = (id) => `${location.origin}/c/${id}`;

  let lastHighlight = null; // stays marked when the wall is redrawn because someone else lit a lamp
  async function refreshLamps({ highlight } = {}) {
    if (highlight !== undefined) lastHighlight = highlight;
    try {
      lampState = await api('GET', `/api/temples/${slug}/lamps`);
      lampCells = temple.setLamps(lampState.lamps, { highlight: lastHighlight });
      $('lamp-count').textContent = t('lamp.count', lampState.lamps.length);
      renderMine();
    } catch { /* the wall can wait */ }
    return lampCells;
  }

  function renderKinds() {
    const box = $('lamp-kinds');
    box.replaceChildren(...lampState.kinds.map((k, i) => {
      const l = document.createElement('label'); l.className = `lamp-kind k-${k}`;
      const r = document.createElement('input'); r.type = 'radio'; r.name = 'lamp-kind'; r.value = k; r.checked = i === 0;
      const name = document.createElement('b'); name.textContent = kindName(k);
      const d = document.createElement('small'); d.textContent = t(`lamp.desc.${k}`);
      l.append(r, name, d);
      return l;
    }));
  }

  function renderMine() {
    const ul = $('lamp-mine');
    if (!lampState.mine.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = t('lamp.none'); ul.replaceChildren(li); return; }
    ul.replaceChildren(...lampState.mine.map((l) => {
      const li = document.createElement('li'); li.className = `k-${l.kind}`;
      const title = document.createElement('span'); title.textContent = t('lamp.for', kindName(l.kind), l.forName);
      const until = document.createElement('small');
      const out = l.expiresAt <= Date.now();
      until.textContent = out ? t('lamp.out') : t('lamp.until', fmtDate(l.expiresAt));
      li.append(title, until);
      if (l.renewable) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn-ghost small'; b.textContent = t('lamp.renew');
        b.onclick = async () => {
          b.disabled = true;
          try { await api('POST', `/api/lamps/${l.id}/renew`); toast(t('lamp.renewed'), { gold: true }); await refreshLamps(); } catch { toast(t('err.generic')); b.disabled = false; }
        };
        li.append(b);
      }
      if (!out && game.shop?.enabled()) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn-ghost small'; b.textContent = t('shop.lampMonth');
        b.onclick = () => game.shop.open({ context: 'lamp', target: { lampId: l.id }, onDone: () => refreshLamps() });
        li.append(b);
      }
      if (l.cardId && !out) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn-ghost small'; b.textContent = t('lamp.share');
        b.onclick = () => shareCard(l);
        li.append(b);
      }
      return li;
    }));
  }

  function setForOther(other) {
    $('lamp-name-label').textContent = t(other ? 'lamp.nameOther' : 'lamp.nameSelf');
    const me = game.me?.() || {};
    if (!other && !$('lamp-name').value) $('lamp-name').value = me.name || '';
    if (other && $('lamp-name').value === me.name) $('lamp-name').value = '';
    $('lamp-name').required = other;
  }

  async function lamp() {
    if (busy) return; busy = true;
    try {
      if (!(await walkTo(anchors.lamp))) return;
      act('pray');
      await refreshLamps();
      renderKinds();
      $('lamp-form').hidden = false; $('lamp-done').hidden = true; $('lamp-support').hidden = true;
      for (const r of document.querySelectorAll('input[name="lamp-for"]')) r.onchange = () => setForOther(r.value === 'other' && r.checked);
      setForOther(document.querySelector('input[name="lamp-for"]:checked').value === 'other');
      const done = new Promise((resolve) => openPanel('lamp-panel', resolve));
      bindHold();
      await done;
    } finally { busy = false; idle(); }
  }

  // 長按點亮: the same unhurried gesture as lighting incense (3.1 手勢)
  function bindHold() {
    const btn = $('lamp-hold');
    let start = 0, raf = 0;
    const reset = () => { cancelAnimationFrame(raf); start = 0; btn.style.setProperty('--p', '0'); };
    const tick = () => {
      const k = Math.min(1, (performance.now() - start) / 900);
      btn.style.setProperty('--p', String(k));
      if (k >= 1) { reset(); submitLamp(); return; }
      raf = requestAnimationFrame(tick);
    };
    let pointer = false;
    btn.onpointerdown = (e) => { pointer = true; e.preventDefault(); if (!$('lamp-form').reportValidity()) return; start = performance.now(); raf = requestAnimationFrame(tick); };
    btn.onpointerup = btn.onpointerleave = reset;
    // A tap fires `submit` too — only the keyboard (Enter / assistive tech) may submit without holding.
    $('lamp-form').onsubmit = (e) => { e.preventDefault(); if (pointer) { pointer = false; return; } submitLamp(); };
  }

  let lighting = false;
  async function submitLamp() {
    if (lighting) return; lighting = true;
    const forOther = document.querySelector('input[name="lamp-for"]:checked').value === 'other';
    const body = {
      kind: document.querySelector('input[name="lamp-kind"]:checked')?.value,
      forOther, forName: $('lamp-name').value, wish: $('lamp-wish').value, wishPrivate: $('lamp-private').checked,
    };
    try {
      const out = await api('POST', `/api/temples/${slug}/lamps`, body);
      audio.crackle(0.2); setTimeout(() => audio.bell(0.18), 500);
      self().pulse(1.2);
      game.setMe?.(out.me);
      if (out.merit) toast(t('merit.gain', out.merit));
      const cells = await refreshLamps({ highlight: out.lamp.id });
      const cell = cells.get(out.lamp.id);
      $('lamp-form').hidden = true; $('lamp-done').hidden = false;
      $('lamp-done-text').textContent = t('lamp.lit', fmtDate(out.lamp.expiresAt));
      $('lamp-done-where').textContent = cell ? t('lamp.where', cell.row, cell.col) : '';
      $('lamp-share').hidden = $('lamp-image').hidden = !out.lamp.cardId;
      $('lamp-share').onclick = () => shareCard(out.lamp);
      $('lamp-image').onclick = () => cardImage(out.lamp);
      $('lamp-again').onclick = () => { $('lamp-form').hidden = false; $('lamp-done').hidden = true; $('lamp-wish').value = ''; };
      if (out.support) {
        $('lamp-support').hidden = false;
        $('lamp-support').textContent = `${t('lamp.privateNote')} ${t('wish.support', out.support)}`;
      }
      $('lamp-wish').value = '';
    } catch (err) {
      const code = err.body?.error;
      toast(code === 'lamp_limit' ? t('lamp.limit') : code === 'lamp_rejected' ? t('lamp.rejected') : code === 'name_required' ? t('lamp.needName') : t('err.generic'));
    } finally { lighting = false; }
  }

  async function shareCard(l) {
    const url = cardUrl(l.cardId), text = t('card.shareText', l.forName, game.templeName);
    try {
      if (navigator.share) { await navigator.share({ title: game.templeName, text, url }); return; }
    } catch (e) { if (e?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(`${text}\n${url}`); toast(t('lamp.copied'), { gold: true }); }
    catch { window.prompt(t('lamp.share'), url); }
  }

  /** 祈福卡圖：豎版，適合傳給長輩或發在 Story。 */
  function cardImage(l) {
    const c = document.createElement('canvas'); c.width = 1080; c.height = 1920;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 1920); grd.addColorStop(0, '#231a14'); grd.addColorStop(1, '#0f0c0a');
    g.fillStyle = grd; g.fillRect(0, 0, 1080, 1920);
    const glow = g.createRadialGradient(540, 640, 10, 540, 640, 380);
    glow.addColorStop(0, 'rgba(255,214,140,0.95)'); glow.addColorStop(0.25, 'rgba(255,170,80,0.45)'); glow.addColorStop(1, 'rgba(255,150,60,0)');
    g.fillStyle = glow; g.fillRect(140, 240, 800, 800);
    g.fillStyle = '#c9a24a'; g.beginPath(); g.ellipse(540, 760, 120, 34, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff3d6'; g.beginPath(); g.ellipse(540, 660, 26, 70, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#d2ad5e'; g.lineWidth = 6; g.strokeRect(70, 70, 940, 1780);
    g.textAlign = 'center'; g.fillStyle = '#efe7da';
    g.font = '600 64px "Noto Serif TC","Songti TC",serif'; g.fillText(t('card.title', game.templeName), 540, 1100);
    g.fillStyle = '#d2ad5e'; g.font = '500 52px "Noto Serif TC","Songti TC",serif'; g.fillText(t('lamp.for', kindName(l.kind), l.forName), 540, 1200);
    if (l.wish) { g.fillStyle = '#c9bfb0'; g.font = '400 44px "Noto Sans TC",sans-serif'; wrap(g, `「${l.wish}」`, 540, 1320, 820, 66); }
    g.fillStyle = '#a49a8c'; g.font = '400 34px "Noto Sans TC",sans-serif';
    g.fillText(t('card.until', fmtDate(l.expiresAt)), 540, 1640);
    g.font = '400 30px "Noto Sans TC",sans-serif'; g.fillText(t('lamp.fineprint'), 540, 1760);
    const a = document.createElement('a'); a.download = `lamp-${l.id}.png`; a.href = c.toDataURL('image/png'); a.click();
  }

  /** Arriving from a blessing card: walk to the wall and point out that lamp. */
  async function visitLamp(lampId) {
    if (!anchors.lamp) return;
    await walkTo(anchors.lamp);
    const cells = await refreshLamps({ highlight: lampId });
    const cell = cells.get(lampId);
    if (cell) { toast(t('lamp.visit', cell.row, cell.col), { gold: true }); act('pray'); await wait(1600); idle(); }
  }

  $('fortune-shake').onclick = shake;
  $('fortune-jiao').onclick = throwJiao;
  void getLocale;

  return {
    gassho, bow, incense, fortune, wish, sit, stand, lamp, visitLamp,
    muyu: () => counter('muyu'), beads: () => counter('bead'),
    get sitting() { return !!sitting; },
    refreshWall, refreshLamps,
  };
}
