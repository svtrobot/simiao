// 提醒（4.1）：早上的黃曆、家人的忌日與清明、睡前靜坐。Web Push，伺服器見 server/domain/push.js。
// 一天最多兩則；只有本人在「我的修行」裡打開才會訂閱，每個開關隨時可關。
import { api } from './api.js';
import { t } from './i18n.js';
import { $, toast } from './ui.js';

const ua = navigator.userAgent;
const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
/** iPhone / iPad only deliver Web Push to a site added to the home screen (iOS 16.4+). */
const iosNeedsInstall = () => /iPhone|iPad|iPod/.test(ua) && !standalone();

const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const PREFS = ['morning', 'family', 'night'];

export function createReminders() {
  let status = null;
  const reg = pushSupported() ? navigator.serviceWorker.register('/sw.js').catch(() => null) : Promise.resolve(null);

  async function current() {
    const r = await reg;
    return r ? r.pushManager.getSubscription() : null;
  }

  async function show() {
    try { status = await api('GET', '/api/push'); } catch { return; }
    for (const k of PREFS) $(`rem-${k}`).checked = !!status.prefs[k];
    const sub = await current().catch(() => null);
    const on = !!sub && Notification.permission === 'granted';
    let line;
    if (!pushSupported()) line = iosNeedsInstall() ? t('rem.ios') : t('rem.unsupported');
    else if (iosNeedsInstall()) line = t('rem.ios');
    else if (Notification.permission === 'denied') line = t('rem.denied');
    else line = on ? t('rem.on') : t('rem.off');
    $('rem-status').textContent = line;
    $('rem-status').classList.toggle('ok', on);
    $('rem-on').hidden = on || !pushSupported() || iosNeedsInstall() || Notification.permission === 'denied';
    $('rem-test').hidden = !on;
    $('rem-off').hidden = !on;
    return on;
  }

  async function enable() {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { await show(); return; }
      const r = await reg;
      if (!status) status = await api('GET', '/api/push');
      const key = keyBytes(status.publicKey);
      let sub = await r.pushManager.getSubscription();
      // subscribed earlier with another server key (e.g. the keys were rotated): start over
      if (sub && sub.options?.applicationServerKey && new Uint8Array(sub.options.applicationServerKey).join() !== key.join()) { await sub.unsubscribe(); sub = null; }
      if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const prefs = Object.fromEntries(PREFS.map((k) => [k, $(`rem-${k}`).checked]));
      status = await api('POST', '/api/push/subscribe', { subscription: sub.toJSON(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone, prefs });
      toast(t('rem.enabled'), { gold: true });
    } catch (e) {
      console.warn('[push]', e);
      toast(t('rem.failed'));
    }
    await show();
  }

  async function disable() {
    const sub = await current().catch(() => null);
    if (sub) {
      await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
    await show();
  }

  for (const k of PREFS) {
    $(`rem-${k}`).onchange = async () => {
      try { status = await api('POST', '/api/push/prefs', { [k]: $(`rem-${k}`).checked }); } catch { toast(t('err.generic')); }
    };
  }
  $('rem-on').onclick = enable;
  $('rem-off').onclick = disable;
  $('rem-test').onclick = async () => {
    try { const r = await api('POST', '/api/push/test'); toast(r.sent ? t('rem.testSent') : t('rem.failed')); } catch { toast(t('err.generic')); }
  };

  /** True when this device already gets reminders (used to hide the 祖先堂「提醒我」link). */
  async function isOn() { const s = await current().catch(() => null); return !!s && Notification.permission === 'granted'; }

  return { show, isOn };
}
