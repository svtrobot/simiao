// 禪房（2.3）：單人、離線級安靜。進來時離開大殿房間（別人看不到你、你也看不到別人），
// 靜坐分鐘改由 /api/zen 心跳記錄；定時、呼吸引導、熄燈（睡前）、抄經都在這裡。
import { api } from './api.js';
import { t } from './i18n.js';
import * as audio from './audio.js';
import { $, toast } from './ui.js';
import { createCopy } from './copy.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function createZen(game, { mode, slug }) {
  let room = null, active = false, busy = false;
  let beatTimer = 0, clockTimer = 0, breathTimer = 0, startedAt = 0;
  let timer = { mins: 0, endAt: 0, rung: false };
  let wakeLock = null, dimmed = false, breathing = false;
  const copy = createCopy(game, { mode, slug });

  const onResize = () => room?.resize(window.innerWidth, window.innerHeight);

  async function fade(on, ms = 900) {
    const f = $('zen-fade');
    f.hidden = false;
    f.classList.toggle('on', on);
    await wait(ms);
    if (!on) f.hidden = true;
  }

  async function enter() {
    if (active || busy) return;
    busy = true;
    try {
      $('actions').hidden = true; $('topbar').classList.add('quiet');
      $('zen-fade-text').textContent = t('zen.entering');
      await fade(true);
      const { buildChamber } = await import('./world/chamber.js');
      room = buildChamber({ look: game.me().look, mode, quality: game.quality, hour: game.hourOverride });
      onResize(); window.addEventListener('resize', onResize);
      game.net.close();               // leave the shared hall: nobody sees you, you see nobody
      game.overlay = room;
      audio.setAmbience(0.22, 4);
      active = true; startedAt = Date.now(); dimmed = false;
      setTimer(0);
      $('zen').hidden = false; $('zen').classList.remove('dim');
      api('POST', '/api/zen/start').catch(() => {});
      beatTimer = setInterval(beat, 60_000);
      clockTimer = setInterval(tick, 1000); tick();
      document.addEventListener('visibilitychange', onVisible);
      await wait(200);
      $('zen-fade-text').textContent = '';
      await fade(false, 1600);
      audio.bell(0.18);
    } finally { busy = false; }
  }

  async function beat() {
    if (document.hidden) return; // only time actually spent in the room counts
    try {
      const r = await api('POST', '/api/zen/beat');
      if (r.me) game.setMe(r.me);
      if (r.gained && !dimmed) toast(t('merit.gain', r.gained));
    } catch { /* next beat will catch up */ }
  }
  function onVisible() { if (!document.hidden) beat(); }

  function tick() {
    if (!active) return;
    const s = Math.floor((Date.now() - startedAt) / 1000);
    $('zen-time').textContent = t('sit.time', Math.floor(s / 60), s % 60);
    if (timer.endAt) {
      const left = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
      $('zen-left').textContent = left ? t('zen.left', Math.floor(left / 60), left % 60) : '';
      if (!left && !timer.rung) { timer.rung = true; timeUp(); }
    } else $('zen-left').textContent = '';
  }

  async function timeUp() {
    releaseWake();
    if (dimmed) { audio.setAmbience(0, 30); return; } // asleep: let the room go quiet, don't wake them
    // 引磬三聲
    for (let i = 0; i < 3; i++) { audio.bell(0.22 - i * 0.04); await wait(2600); }
    toast(t('zen.timeUp'), { gold: true });
  }

  function setTimer(mins) {
    timer = { mins, endAt: mins ? Date.now() + mins * 60_000 : 0, rung: false };
    for (const b of document.querySelectorAll('[data-zen-timer]')) b.setAttribute('aria-pressed', String(Number(b.dataset.zenTimer) === mins));
    if (mins) requestWake(); else releaseWake();
    tick();
  }

  // Keep the screen on only while a timed sit is running (not all night)
  async function requestWake() {
    try { if (!wakeLock && navigator.wakeLock && !dimmed) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* not allowed: fine */ }
  }
  function releaseWake() { try { wakeLock?.release(); } catch { /* fine */ } wakeLock = null; }

  // 熄燈：the oil lamp burns down slowly, the controls fade; a tap anywhere brings them back
  function setDim(on) {
    dimmed = on;
    room?.setDim(on);
    $('zen').classList.toggle('dim', on);
    $('zen-dim').textContent = t(on ? 'zen.light' : 'zen.dim');
    audio.setAmbience(on ? 0.12 : 0.22, on ? 20 : 3);
    if (on) { releaseWake(); stopBreath(); toast(t('zen.dimHint')); } else if (timer.endAt && !timer.rung) requestWake();
  }

  function startBreath() {
    breathing = true;
    $('zen-breath').hidden = false;
    const core = $('zen-breath').querySelector('.breath-core');
    let inhale = true;
    const step = () => {
      if (!breathing) return;
      const mins = (Date.now() - startedAt) / 60000;
      const len = Math.min(6000, 4000 + mins * 400); // 呼吸逐漸變慢
      core.style.transitionDuration = `${len}ms`;
      core.style.transform = inhale ? 'scale(2.6)' : 'scale(1)';
      $('zen-breath-word').textContent = t(inhale ? 'sit.in' : 'sit.out');
      inhale = !inhale;
      breathTimer = setTimeout(step, len);
    };
    step();
    $('zen-breath-btn').setAttribute('aria-pressed', 'true');
  }
  function stopBreath() {
    breathing = false; clearTimeout(breathTimer);
    $('zen-breath').hidden = true;
    $('zen-breath-btn').setAttribute('aria-pressed', 'false');
  }

  async function leave() {
    if (!active || busy) return;
    busy = true;
    try {
      copy.close();
      clearInterval(beatTimer); clearInterval(clockTimer); stopBreath(); releaseWake();
      document.removeEventListener('visibilitychange', onVisible);
      let summary = null;
      try { summary = await api('POST', '/api/zen/end'); if (summary.me) game.setMe(summary.me); } catch { /* fine */ }
      $('zen-fade-text').textContent = '';
      await fade(true, 700);
      $('zen').hidden = true;
      game.overlay = null;
      window.removeEventListener('resize', onResize);
      room.dispose(); room = null;
      active = false;
      game.net.reopen();
      audio.setAmbience(0.5, 4);
      $('actions').hidden = false; $('topbar').classList.remove('quiet');
      await fade(false, 1200);
      const mins = Math.floor((Date.now() - startedAt) / 60000);
      toast(mins >= 1 ? t('zen.summary', mins) : t('zen.summaryShort'), { gold: mins >= 1 });
    } finally { busy = false; }
  }

  // ---- controls ----
  for (const b of document.querySelectorAll('[data-zen-timer]')) b.onclick = () => setTimer(Number(b.dataset.zenTimer));
  $('zen-breath-btn').onclick = () => (breathing ? stopBreath() : startBreath());
  $('zen-dim').onclick = (e) => { e.stopPropagation(); setDim(!dimmed); };
  $('zen-leave').onclick = leave;
  $('zen-copy').textContent = t(mode === 'ritual' ? 'zen.copy' : 'zen.write');
  $('zen-copy').onclick = () => { if (dimmed) setDim(false); copy.open(); };
  // while dimmed, any tap on the screen relights the lamp
  $('zen').addEventListener('pointerdown', (e) => { if (dimmed && !e.target.closest('button')) setDim(false); });

  return { enter, leave, get active() { return active; } };
}
