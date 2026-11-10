import { t } from './i18n.js';

export const $ = (id) => document.getElementById(id);

export function toast(text, { gold = false } = {}) {
  const el = document.createElement('div');
  el.className = `toast${gold ? ' gold' : ''}`;
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3700);
}

let hintTimer = 0;
export function hint(text, ms = 0) {
  const el = $('hint');
  clearTimeout(hintTimer);
  if (!text) { el.hidden = true; return; }
  el.textContent = text; el.hidden = false;
  if (ms) hintTimer = setTimeout(() => { el.hidden = true; }, ms);
}

const panels = ['incense-panel', 'fortune-panel', 'count-panel', 'wish-panel', 'lamp-panel', 'alm-panel', 'me-panel', 'sit-choice', 'copy-panel', 'anc-start', 'anc-form-panel', 'anc-fam', 'acc-code', 'acc-restore', 'acc-nudge'];
let onCloseCb = new Map();
export function openPanel(id, onClose) {
  for (const p of panels) if (p !== id && !$(p).hidden) closePanel(p);
  $(id).hidden = false;
  if (onClose) onCloseCb.set(id, onClose);
  const focusable = $(id).querySelector('button, textarea');
  focusable?.focus({ preventScroll: true });
}
export function closePanel(id) {
  if ($(id).hidden) return;
  $(id).hidden = true;
  const cb = onCloseCb.get(id); onCloseCb.delete(id);
  cb?.();
}
export function bindPanelClose() {
  for (const p of panels) {
    $(p).querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closePanel(p)));
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') for (const p of panels) closePanel(p);
  });
}

export function updateMe(me) {
  window.dispatchEvent(new CustomEvent('simiao:me', { detail: me }));
  $('me-name').textContent = me.name;
  $('me-rank').textContent = t(`rank.${me.rank}`);
  $('me-merit').textContent = me.merit;
}

export function renderMe(me) {
  const rows = [
    ['me.name', me.name], ['me.rank', t(`rank.${me.rank}`)], ['me.stage', t(`stage.${me.look.stage}`)],
    ['me.merit', me.merit], ['me.minutes', t('me.mins', me.minutes)], ['me.streak', t('me.days', me.streak)],
  ];
  if (me.look.gold) rows.push(['me.gold', me.look.gold]);
  $('me-stats').replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement('dt'); dt.textContent = t(k);
    const dd = document.createElement('dd'); dd.textContent = v;
    return [dt, dd];
  }));
}

export function setPresence(stats) {
  if (!stats) return;
  $('online-line').textContent = t('online', stats.online);
  $('incense-line').textContent = t('incense', stats.incense || 0);
}
