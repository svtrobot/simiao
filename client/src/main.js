// 云上寺 client entry: intro → session → scene → room.
import { t, setLocale, setCulture, applyI18n, localName } from './i18n.js';
import { api, startSession } from './api.js';
import * as audio from './audio.js';
import { $, toast, hint, bindPanelClose, updateMe, renderMe, setPresence, openPanel, closePanel } from './ui.js';
import { createAlmanac } from './almanac.js';
import { createZen } from './zen.js';
import { createAncestors, reminderText } from './ancestors.js';
import { createAccount } from './account.js';
import { createReminders } from './remind.js';
import { createShop } from './shop.js';

const params = new URLSearchParams(location.search);
let slug = (location.pathname.match(/^\/t\/([a-z0-9-]+)/) || [])[1] || params.get('t') || 'main';
// 4.3 祈福卡: /c/<id> shows the card first, then enters the temple where that lamp hangs.
const cardId = (location.pathname.match(/^\/c\/([A-Za-z0-9_-]+)/) || [])[1] || null;
let card = null;
// 祖先堂邀請: /f/<code> shows who invited you, then joins that family hall once you are in
const inviteCode = (location.pathname.match(/^\/f\/([A-Za-z0-9_-]+)/) || [])[1] || null;

// Heavy 3D modules start downloading right away, while the intro text is on screen.
const three = Promise.all([import('three'), import('./world/scene.js')]).catch((e) => { console.error(e); return null; });

let config = { locale: 'zh-Hant', ritualsAllowed: true };
const configured = api('GET', '/api/config').then((c) => { config = c; setLocale(c.locale); applyI18n(); }).catch(() => applyI18n());
bindPanelClose();
// 保存修行: passkey / recovery code; the entrance screen offers 「找回我的修行」 before a session starts
const account = createAccount();
// 提醒 (Web Push): registers the service worker; subscribing happens only when the person turns it on
const reminders = createReminders();
if (cardId) configured.then(showCard); // after applyI18n, which would reset the button text
if (inviteCode) configured.then(showInvite);

async function showInvite() {
  try {
    const inv = await api('GET', `/api/invites/${inviteCode}`);
    $('card-title').textContent = inv.name ? t('anc.titleOf', inv.name) : t('anc.title');
    $('card-kind').textContent = t('anc.inviteCard', inv.ownerName);
    $('card-wish').hidden = true;
    $('card-from').textContent = t('anc.inviteMeta', inv.members, inv.tablets);
    $('card-until').textContent = t('anc.private');
    $('card-view').classList.add('invite');
    $('card-view').hidden = false;
    document.querySelector('.intro-line').hidden = true;
    $('enter').textContent = t('anc.inviteEnter');
  } catch {
    $('intro-status').textContent = t('anc.inviteGone');
  }
}

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

/** 前往其他寺社: the public halls in this region, each in its own tradition. */
async function openTemples(here) {
  try {
    const list = await api('GET', '/api/temples');
    const ul = $('temples-list');
    ul.textContent = '';
    for (const tp of list) {
      const li = document.createElement('li');
      const a = document.createElement(tp.slug === here ? 'div' : 'a');
      a.className = 'temple-row';
      if (tp.slug !== here) a.href = tp.slug === 'main' ? '/' : `/t/${tp.slug}`;
      const n = document.createElement('b'); n.textContent = localName(tp.name);
      const c = document.createElement('small'); c.textContent = [tp.culture ? t(`culture.${tp.culture}`) : '', t('temples.online', tp.online)].filter(Boolean).join(' · ');
      const g = document.createElement('span'); g.textContent = tp.slug === here ? t('temples.here') : t('temples.go');
      a.append(n, c, g); li.append(a); ul.append(li);
    }
    openPanel('temples-panel');
  } catch { toast(t('err.generic')); }
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
  // the scene's tradition renames a few things (參拜, 繪馬, 木鐸…)
  setCulture(info.scene.culture); applyI18n();
  $('temple-name').textContent = localName(info.temple.name);
  $('temple-name').onclick = () => openTemples(slug);
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
  // a scene only offers the rituals its tradition has (manifest.rituals; the server enforces the same list)
  const offered = info.scene.rituals;
  if (offered) {
    document.querySelectorAll('[data-ritual]').forEach((b) => {
      const a = b.dataset.act === 'beads' ? 'bead' : b.dataset.act;
      if (!offered.includes(a)) b.hidden = true;
    });
  }
  const firstAct = !offered || offered.includes('incense') ? 'incense' : 'bow';

  // 第一个任务永远是“上一炷香”（2.1）——从祈福卡进来的人，先带他去看那盏灯
  if (card) setTimeout(() => game.rituals.visitLamp(card.lampId), 2800);
  const first = !card && info.mode !== 'cultural' && session.user.merit === 0;
  if (first) {
    document.querySelector(`[data-act="${firstAct}"]`).classList.add('pulse');
    setTimeout(() => hint(t('hint.first'), 7000), 2600);
  } else {
    setTimeout(() => hint(t('hint.walk'), 5000), 2600);
  }

  // 供養: paid items add ceremony only, never merit (七章). The bag follows the account.
  game.shop = createShop({ slug });
  game.shop.load().then(() => game.shop.checkReturn());
  const bagLine = (bag) => Object.entries(bag).filter(([, n]) => n > 0).map(([k, n]) => `${t(`item.${k}`)} ×${n}`).join('、');
  $('me-shop').onclick = () => game.shop.open();
  const r = game.rituals;
  // 靜坐: sit with everyone in the hall, or alone in the 禪房 (2.2 同修 / 靜修)
  const zen = createZen(game, { mode: info.mode, slug });
  const sitChoice = () => {
    if (r.sitting || anc.active) return;
    openPanel('sit-choice');
    $('sit-hall').onclick = () => { closePanel('sit-choice'); r.sit(); };
    $('sit-zen').onclick = () => { closePanel('sit-choice'); zen.enter(); };
  };
  // 祖先堂: private family hall; reminders for 忌日 / 冥誕 / 清明 show on arrival (4.1)
  const anc = createAncestors(game, { mode: info.mode, slug });
  anc.init().then((rem) => {
    const near = rem.filter((e) => e.inDays <= 3);
    if (!near.length) return;
    document.querySelector('[data-act="ancestor"]').classList.add('dot');
    setTimeout(() => toast(reminderText(near[0]), { gold: near[0].inDays === 0 }), 4200);
  });
  // a tapped reminder opens where it points: /?go=ancestor | zen | almanac
  const go = params.get('go');
  if (go) {
    history.replaceState(null, '', location.pathname);
    setTimeout(() => {
      if (go === 'ancestor') anc.enter();
      else if (go === 'zen') zen.enter();
      else if (go === 'almanac') $('alm-chip')?.click();
    }, 2800);
  }
  if (inviteCode) {
    history.replaceState(null, '', '/');
    setTimeout(() => anc.joinByInvite(inviteCode), 2800);
  }
  const handlers = {
    gassho: r.gassho, bow: r.bow, incense: r.incense, fortune: r.fortune, muyu: r.muyu, beads: r.beads, sit: sitChoice, wish: r.wish, lamp: r.lamp,
    ancestor: () => { if (zen.active) return; document.querySelector('[data-act="ancestor"]').classList.remove('dot'); anc.enter(); },
  };
  for (const b of document.querySelectorAll('[data-act]')) {
    b.addEventListener('click', () => {
      b.classList.remove('pulse');
      handlers[b.dataset.act]?.();
    });
  }
  $('me-chip').addEventListener('click', async () => {
    try { const me = await api('GET', '/api/me'); renderMe(me); $('me-bag').textContent = bagLine(game.shop.bag()) || t('shop.bagEmpty'); await Promise.all([account.show(), reminders.show()]); openPanel('me-panel'); } catch { /* ignore */ }
  });
}
