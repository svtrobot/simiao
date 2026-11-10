// 云上寺 client entry: intro → session → scene → room.
import { t, setLocale, applyI18n, localName } from './i18n.js';
import { api, startSession } from './api.js';
import * as audio from './audio.js';
import { $, toast, hint, bindPanelClose, updateMe, renderMe, setPresence, openPanel, closePanel } from './ui.js';
import { createAlmanac } from './almanac.js';
import { createZen } from './zen.js';

const params = new URLSearchParams(location.search);
let slug = (location.pathname.match(/^\/t\/([a-z0-9-]+)/) || [])[1] || params.get('t') || 'main';
// 4.3 祈福卡: /c/<id> shows the card first, then enters the temple where that lamp hangs.
const cardId = (location.pathname.match(/^\/c\/([A-Za-z0-9_-]+)/) || [])[1] || null;
let card = null;

// Heavy 3D modules start downloading right away, while the intro text is on screen.
const three = Promise.all([import('three'), import('./world/scene.js')]).catch((e) => { console.error(e); return null; });

let config = { locale: 'zh-Hant', ritualsAllowed: true };
const configured = api('GET', '/api/config').then((c) => { config = c; setLocale(c.locale); applyI18n(); }).catch(() => applyI18n());
bindPanelClose();
if (cardId) configured.then(showCard); // after applyI18n, which would reset the button text

async function showCard() {
  try {
    card = await api('GET', `/api/cards/${cardId}`);
    slug = card.temple.slug;
    $('card-title').textContent = t('card.title', localName(card.temple.name));
    $('card-kind').textContent = t('lamp.for', t(`lamp.kind.${card.kind}`), card.forName);
    $('card-wish').hidden = !card.wish;
    $('card-wish').textContent = card.wish ? `「${card.wish}」` : '';
    $('card-from').textContent = t('card.from', card.fromName);
    const until = new Date(card.expiresAt).toLocaleDateString(document.documentElement.lang, { month: 'long', day: 'numeric' });
    $('card-until').textContent = card.lit ? t('card.until', until) : t('card.out');
    $('card-view').classList.toggle('out', !card.lit);
    $('card-view').hidden = false;
    document.querySelector('.intro-line').hidden = true;
    $('enter').textContent = t('card.enter');
  } catch {
    card = null;
    $('intro-status').textContent = t('card.notFound');
  }
}

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
  // 每天一個回來的理由（4.1）：黃曆小籤在寺名旁，當天沒看過時帶一個小點
  createAlmanac({ slug, templeName: localName(info.temple.name) }).load().catch(() => {});
  if (session.returned?.repaired) setTimeout(() => toast(t('returned'), { gold: true }), 2500);

  // 文化参访模式：隐藏上香、念诵等宗教仪式（6.5 合规模式）
  if (info.mode === 'cultural') {
    document.querySelectorAll('[data-ritual]').forEach((b) => { b.hidden = true; });
    toast(t('mode.cultural'));
  }

  // 第一个任务永远是“上一炷香”（2.1）——从祈福卡进来的人，先带他去看那盏灯
  if (card) setTimeout(() => game.rituals.visitLamp(card.lampId), 2800);
  const first = !card && info.mode !== 'cultural' && session.user.merit === 0;
  if (first) {
    document.querySelector('[data-act="incense"]').classList.add('pulse');
    setTimeout(() => hint(t('hint.first'), 7000), 2600);
  } else {
    setTimeout(() => hint(t('hint.walk'), 5000), 2600);
  }

  const r = game.rituals;
  // 靜坐: sit with everyone in the hall, or alone in the 禪房 (2.2 同修 / 靜修)
  const zen = createZen(game, { mode: info.mode, slug });
  const sitChoice = () => {
    if (r.sitting) return;
    openPanel('sit-choice');
    $('sit-hall').onclick = () => { closePanel('sit-choice'); r.sit(); };
    $('sit-zen').onclick = () => { closePanel('sit-choice'); zen.enter(); };
  };
  const handlers = {
    gassho: r.gassho, bow: r.bow, incense: r.incense, fortune: r.fortune, muyu: r.muyu, beads: r.beads, sit: sitChoice, wish: r.wish, lamp: r.lamp,
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
