// 抄經 / 習字（2.2、3.2「屏幕描紅」）：一次一個字，照著淡紅的底字描。
// 描到足夠覆蓋底字就自動換下一個字；寫好的字留成小圖，整部寫完可以存一張自己的抄本。
// 進度與功德以服務端為準（server/domain/copying.js 限速、日封頂）。
import { api, ApiError } from './api.js';
import { t } from './i18n.js';
import * as audio from './audio.js';
import { $, toast, openPanel, closePanel } from './ui.js';

const KAI = '"BiauKai","DFKai-SB","Kaiti TC","STKaiti","KaiTi","TW-Kai","Noto Serif TC","Noto Serif SC","Songti TC",serif';
const N = 96;              // mask resolution for the coverage check
const PUNCT = /[，。、：；！？「」]/;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked: the scroll image just won't have every glyph */ } },
};

export function createCopy(game, { slug }) {
  let texts = [], cur = null;          // cur: { id, title, by, dedication, text, chars[], pos, copies }
  let cursor = 0, serverPos = 0, pending = 0, flushTimer = 0, sending = false;
  let ink = {};                        // pos -> small PNG data URL of what you wrote
  let mask = null, maskCount = 1;
  let guideOn = true;
  let strokes = 0;
  let settling = false;               // between an accepted character and the next one: ignore the brush

  const guide = $('copy-guide'), cv = $('copy-canvas');
  const g = cv.getContext('2d'), gg = guide.getContext('2d');
  let size = 300, dpr = 1;

  const inkKey = () => `simiao.copy.${cur.id}`;

  async function open() {
    try { texts = (await api('GET', `/api/temples/${slug}/copy`)).texts; } catch { toast(t('err.generic')); return; }
    if (!texts.length) return;
    const sel = $('copy-text');
    sel.replaceChildren(...texts.map((x) => new Option(x.title, x.id)));
    sel.hidden = texts.length < 2;
    sel.onchange = () => choose(sel.value);
    const last = store.get('simiao.copy.last');
    choose(texts.some((x) => x.id === last) ? last : texts[0].id);
    sel.value = cur.id;
    openPanel('copy-panel', () => { flush(); window.removeEventListener('resize', layout); });
    window.addEventListener('resize', layout);
    layout();
  }

  function close() { closePanel('copy-panel'); }

  function choose(id) {
    flush();
    const x = texts.find((v) => v.id === id);
    cur = { ...x, chars: [...x.text].filter((c) => !PUNCT.test(c)) };
    store.set('simiao.copy.last', id);
    serverPos = cursor = x.pos; pending = 0;
    const saved = store.get(inkKey());
    ink = saved && saved.copies === x.copies ? saved.ink : {};
    $('copy-title').textContent = cur.title;
    $('copy-by').textContent = cur.by;
    $('copy-done').hidden = true; $('copy-work').hidden = false;
    showChar();
  }

  function layout() {
    const box = $('copy-box');
    size = Math.floor(box.clientWidth) || 300;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [cv, guide]) { c.width = size * dpr; c.height = size * dpr; c.style.width = c.style.height = `${size}px`; }
    drawGuide();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
  }

  const glyphFont = (px) => `500 ${Math.round(px)}px ${KAI}`;

  function drawGuide() {
    const ch = cur.chars[cursor];
    gg.setTransform(dpr, 0, 0, dpr, 0, 0);
    gg.clearRect(0, 0, size, size);
    // 米字格: a frame, the centre cross and dashed diagonals
    gg.strokeStyle = 'rgba(166,54,42,0.55)'; gg.lineWidth = 2; gg.strokeRect(1, 1, size - 2, size - 2);
    gg.lineWidth = 1; gg.setLineDash([6, 6]); gg.strokeStyle = 'rgba(166,54,42,0.3)';
    gg.beginPath(); gg.moveTo(size / 2, 0); gg.lineTo(size / 2, size); gg.moveTo(0, size / 2); gg.lineTo(size, size / 2);
    gg.moveTo(0, 0); gg.lineTo(size, size); gg.moveTo(size, 0); gg.lineTo(0, size); gg.stroke();
    gg.setLineDash([]);
    if (ch && guideOn) {
      gg.fillStyle = 'rgba(200,70,56,0.26)';
      gg.font = glyphFont(size * 0.8); gg.textAlign = 'center'; gg.textBaseline = 'middle';
      gg.fillText(ch, size / 2, size * 0.53);
    }
  }

  /** Alpha mask of the target glyph at N×N, plus a dilated copy for "ink outside the character". */
  function buildMask(ch) {
    const c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.font = glyphFont(N * 0.8); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#000';
    x.fillText(ch, N / 2, N * 0.53);
    const a = x.getImageData(0, 0, N, N).data;
    const m = new Uint8Array(N * N), d = new Uint8Array(N * N);
    let count = 0;
    for (let i = 0; i < N * N; i++) if (a[i * 4 + 3] > 100) { m[i] = 1; count++; }
    const R = 4;
    for (let y = 0; y < N; y++) for (let xx = 0; xx < N; xx++) {
      if (!m[y * N + xx]) continue;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const yy = y + dy, x2 = xx + dx;
        if (yy >= 0 && yy < N && x2 >= 0 && x2 < N) d[yy * N + x2] = 1;
      }
    }
    return { m, d, count: Math.max(1, count) };
  }

  function score() {
    const c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(cv, 0, 0, N, N);
    const a = x.getImageData(0, 0, N, N).data;
    let hit = 0, outside = 0;
    for (let i = 0; i < N * N; i++) {
      if (a[i * 4 + 3] < 60) continue;
      if (mask.m[i]) hit++;
      if (!mask.d[i]) outside++;
    }
    return { cover: hit / maskCount, outside: outside / maskCount };
  }

  function showChar() {
    const n = cur.chars.length;
    if (cursor >= n) return;
    const ch = cur.chars[cursor];
    mask = buildMask(ch); maskCount = mask.count;
    strokes = 0; settling = false;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, size, size);
    drawGuide();
    $('copy-progress').textContent = t('copy.progress', cursor + 1, n, cur.copies);
    // context strip: a few characters already written (your own ink if we have it), this one, the next few
    const strip = $('copy-strip');
    const items = [];
    for (let i = Math.max(0, cursor - 5); i < Math.min(n, cursor + 7); i++) {
      const s = document.createElement('span');
      s.className = i < cursor ? 'done' : i === cursor ? 'now' : 'next';
      if (i < cursor && ink[i]) { const im = new Image(); im.src = ink[i]; im.alt = cur.chars[i]; s.append(im); } else s.textContent = cur.chars[i];
      items.push(s);
    }
    strip.replaceChildren(...items);
  }

  // ---- brush ----
  let drawing = false, last = null, lastW = 0;
  function pt(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now(), p: e.pressure || 0.5 }; }
  cv.addEventListener('pointerdown', (e) => {
    if (!cur || cursor >= cur.chars.length || settling) return;
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic or already released */ }
    drawing = true; last = pt(e); lastW = size * 0.045;
    g.fillStyle = '#1d1915'; g.beginPath(); g.arc(last.x, last.y, lastW / 2, 0, Math.PI * 2); g.fill();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const co = e.getCoalescedEvents?.() || [];
    const evs = co.length ? co : [e];
    for (const ev of evs) {
      const p = pt(ev);
      const dist = Math.hypot(p.x - last.x, p.y - last.y);
      if (dist < 0.8) continue;
      // faster → thinner, like a soft brush lifting; pen pressure when there is one
      const speed = dist / Math.max(1, p.t - last.t);
      const pressure = ev.pointerType === 'pen' ? 0.6 + p.p * 0.8 : 1;
      const target = size * 0.06 * pressure * Math.max(0.45, Math.min(1.1, 1.1 - speed * 0.35));
      const w = lastW + (target - lastW) * 0.35;
      const steps = Math.ceil(dist / 1.5);
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        g.globalAlpha = 0.92;
        g.beginPath(); g.arc(last.x + (p.x - last.x) * k, last.y + (p.y - last.y) * k, (lastW + (w - lastW) * k) / 2, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
      last = p; lastW = w;
    }
  });
  const end = () => {
    if (!drawing) return;
    drawing = false; strokes++;
    const s = score();
    // enough of the character traced, without scribbling all over the square
    if (s.cover >= 0.55 && s.outside <= 0.9) accept();
    else if (s.outside > 2.2 && strokes > 1) { toast(t('copy.messy')); clearInk(); }
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);

  function clearInk() { g.clearRect(0, 0, size, size); strokes = 0; }

  function accept() {
    // keep a small picture of what you wrote, for the scroll at the end
    const c = document.createElement('canvas'); c.width = c.height = 64;
    c.getContext('2d').drawImage(cv, 0, 0, 64, 64);
    ink[cursor] = c.toDataURL('image/png');
    store.set(inkKey(), { copies: cur.copies, ink });
    audio.clay(0.12, 1.5);
    if (navigator.vibrate) navigator.vibrate(6);
    cursor++; pending++; settling = true;
    cv.classList.add('settle'); setTimeout(() => cv.classList.remove('settle'), 260);
    clearTimeout(flushTimer);
    if (pending >= 3 || cursor >= cur.chars.length) flush(); else flushTimer = setTimeout(flush, 2500);
    if (cursor >= cur.chars.length) { $('copy-progress').textContent = t('copy.finishing'); return; }
    setTimeout(showChar, 220);
  }

  async function flush() {
    clearTimeout(flushTimer);
    if (!cur || sending || pending <= 0) return;
    sending = true;
    const id = cur.id;
    try {
      const out = await api('POST', `/api/temples/${slug}/copy`, { id, from: serverPos, n: Math.min(pending, 20) });
      if (cur.id !== id) return;
      const accepted = out.done ? pending : out.accepted ?? 0;
      pending -= accepted; serverPos = out.pos;
      if (out.me) game.setMe(out.me);
      if (out.done) finished(out);
      else if (pending > 0) flushTimer = setTimeout(flush, 1200);
    } catch (e) {
      if (e instanceof ApiError && e.body?.error === 'too_fast') { toast(t('copy.slow')); flushTimer = setTimeout(flush, 3000); }
      else if (e instanceof ApiError && e.body?.error === 'out_of_step') { serverPos = cursor = e.body.pos; pending = 0; showChar(); }
      else flushTimer = setTimeout(flush, 5000);
    } finally { sending = false; }
  }

  function finished(out) {
    const copyNo = out.copies;
    const done = { ...cur, ink: { ...ink } };
    cur.copies = out.copies; cursor = 0; serverPos = 0; pending = 0; ink = {};
    store.set(inkKey(), { copies: cur.copies, ink: {} });
    const listed = texts.find((x) => x.id === cur.id); if (listed) { listed.copies = cur.copies; listed.pos = 0; }
    audio.bell(0.22);
    game.overlay?.avatar?.pulse(1.4);
    $('copy-work').hidden = true; $('copy-done').hidden = false;
    $('copy-done-title').textContent = t('copy.finished', copyNo);
    $('copy-dedication').textContent = cur.dedication;
    $('copy-save').onclick = () => scrollImage(done, copyNo);
    $('copy-again').onclick = () => { $('copy-done').hidden = true; $('copy-work').hidden = false; layout(); showChar(); };
  }

  /** 抄本圖：你自己寫的字，直排右起，加題名與日期。 */
  function scrollImage(d, copyNo) {
    const cols = Math.ceil(d.chars.length / 20), per = Math.ceil(d.chars.length / cols);
    const cell = 64, pitch = cell * 1.15, top = 260;
    const W = Math.max(720, cols * pitch + 380), H = top + per * cell + 300;
    // the text block (plus the title column on its right) sits in the middle of the sheet
    const right = W / 2 + (cols * pitch + 90) / 2 - 90 - pitch / 2;
    const colX = (col) => right - col * pitch;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#efe6d2'; x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(166,54,42,0.5)'; x.lineWidth = 2; x.strokeRect(40, 40, W - 80, H - 80);
    x.fillStyle = '#1e1a16'; x.textAlign = 'center';
    // title column on the right
    x.font = `500 44px ${KAI}`;
    [...d.title.replace(/ · /g, '')].forEach((ch, i) => x.fillText(ch, right + 90, top - 20 + i * 50));
    const loads = [];
    for (let i = 0; i < d.chars.length; i++) {
      const col = Math.floor(i / per), row = i % per;
      const cx = colX(col), cy = top + row * cell;
      if (d.ink[i]) loads.push(new Promise((res) => { const im = new Image(); im.onload = () => { x.drawImage(im, cx - cell / 2, cy - cell / 2, cell, cell); res(); }; im.onerror = res; im.src = d.ink[i]; }));
      else { x.font = `500 ${cell * 0.8}px ${KAI}`; x.fillStyle = '#1e1a16'; x.fillText(d.chars[i], cx, cy + cell * 0.28); }
    }
    Promise.all(loads).then(() => {
      x.fillStyle = '#5a4a3a'; x.font = `400 26px ${KAI}`; x.textAlign = 'left';
      const date = new Date().toLocaleDateString(document.documentElement.lang, { year: 'numeric', month: 'long', day: 'numeric' });
      x.fillText(`${game.me().name} · ${date} · ${t('copy.nth', copyNo)}`, 80, H - 80);
      x.fillStyle = '#a3362a'; x.fillRect(W - 120, H - 130, 44, 44);
      const a = document.createElement('a'); a.download = `copy-${d.id}-${copyNo}.png`; a.href = c.toDataURL('image/png'); a.click();
    });
  }

  $('copy-clear').onclick = clearInk;
  $('copy-guide-btn').onclick = () => {
    guideOn = !guideOn;
    $('copy-guide-btn').setAttribute('aria-pressed', String(!guideOn));
    $('copy-guide-btn').textContent = t(guideOn ? 'copy.noGuide' : 'copy.guide');
    drawGuide();
  };
  $('copy-restart').onclick = async () => {
    if (!cur || !window.confirm(t('copy.restartAsk'))) return;
    try {
      await api('POST', `/api/temples/${slug}/copy/restart`, { id: cur.id });
      pending = 0; serverPos = cursor = 0; ink = {}; store.set(inkKey(), { copies: cur.copies, ink });
      showChar();
    } catch { toast(t('err.generic')); }
  };

  return { open, close };
}
