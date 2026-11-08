// 云上寺 client entry: intro → session → scene → room.
import { t, setLocale, applyI18n, localName } from './i18n.js';
import { api, startSession } from './api.js';
import * as audio from './audio.js';
import { $, toast, hint, bindPanelClose, updateMe, renderMe, setPresence, openPanel } from './ui.js';

const params = new URLSearchParams(location.search);
const slug = (location.pathname.match(/^\/t\/([a-z0-9-]+)/) || [])[1] || params.get('t') || 'main';

// Heavy 3D modules start downloading right away, while the intro text is on screen.
const three = Promise.all([import('three'), import('./world/scene.js')]).catch((e) => { console.error(e); return null; });

let config = { locale: 'zh-Hant', ritualsAllowed: true };
api('GET', '/api/config').then((c) => { config = c; setLocale(c.locale); applyI18n(); }).catch(() => applyI18n());
bindPanelClose();

function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

$('enter').addEventListener('click', () => {
  audio.unlockAudio();
  audio.bell(0.45);
  $('enter').hidden = true;
  $('moods').hidden = false;
});

for (const b of document.querySelectorAll('[data-mood]')) {
  b.addEventListener('click', () => enter(b.dataset.mood));
}

async function enter(mood) {
  $('moods').hidden = true;
  $('intro-status').textContent = t('intro.loading');
  if (!webglOK()) { $('intro-status').textContent = t('intro.noWebgl'); return; }
  try {
    const [session, info, mods] = await Promise.all([startSession(mood), api('GET', `/api/temples/${slug}`), three]);
    if (!mods) throw new Error('3d_modules');
    const [, sceneMod] = mods;
    const game = await sceneMod.createGame({ canvas: $('scene'), info, session, mood, config, slug });
    start(game, session, info);
  } catch (e) {
    console.error(e);
    $('intro-status').textContent = t('err.generic');
  }
}

function start(game, session, info) {
  audio.startAmbience();
  $('intro').classList.add('fade');
  setTimeout(() => { $('intro').hidden = true; }, 2600);
  $('topbar').hidden = false; $('actions').hidden = false;
  $('temple-name').textContent = localName(info.temple.name);
  if (info.temple.label) { $('temple-label').hidden = false; $('temple-label').textContent = t(`label.${info.temple.label}`); }
  else if (info.temple.certified && info.temple.type !== 'official') { $('temple-label').hidden = false; $('temple-label').textContent = t('label.certified'); }
  updateMe(session.user);
  setPresence(info.stats);
  if (session.returned?.repaired) setTimeout(() => toast(t('returned'), { gold: true }), 2500);

  // 文化参访模式：隐藏上香、念诵等宗教仪式（6.5 合规模式）
  if (info.mode === 'cultural') {
    document.querySelectorAll('[data-ritual]').forEach((b) => { b.hidden = true; });
    toast(t('mode.cultural'));
  }

  // 第一个任务永远是“上一炷香”（2.1）
  const first = info.mode !== 'cultural' && session.user.merit === 0;
  if (first) {
    document.querySelector('[data-act="incense"]').classList.add('pulse');
    setTimeout(() => hint(t('hint.first'), 7000), 2600);
  } else {
    setTimeout(() => hint(t('hint.walk'), 5000), 2600);
  }

  const r = game.rituals;
  const handlers = {
    gassho: r.gassho, bow: r.bow, incense: r.incense, fortune: r.fortune, muyu: r.muyu, beads: r.beads, sit: r.sit, wish: r.wish,
  };
  for (const b of document.querySelectorAll('[data-act]')) {
    b.addEventListener('click', () => {
      if (b.dataset.act === 'incense') b.classList.remove('pulse');
      handlers[b.dataset.act]?.();
    });
  }
  $('me-chip').addEventListener('click', async () => {
    try { const me = await api('GET', '/api/me'); renderMe(me); openPanel('me-panel'); } catch { /* ignore */ }
  });
}
