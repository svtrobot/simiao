// 保存修行（2.1）：遊客即可玩；有了值得留下的東西（功德、家堂）才輕輕提一次。
// 通行密鑰（WebAuthn）與恢復碼，兩者都不需要電話或 email。伺服器端見 server/domain/accounts.js。
import { api, setToken, clearToken } from './api.js';
import { t } from './i18n.js';
import { $, toast, openPanel, closePanel } from './ui.js';

const NUDGED = 'simiao.nudged';
const flag = { get() { try { return localStorage.getItem(NUDGED); } catch { return '1'; } }, set() { try { localStorage.setItem(NUDGED, '1'); } catch { /* fine */ } } };
const buf = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)).buffer;
const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const passkeySupported = () => !!(window.PublicKeyCredential && window.isSecureContext && navigator.credentials?.create);

/** A label so people can tell their passkeys apart: 「iPhone · 11/10」. */
function deviceLabel() {
  const ua = navigator.userAgent;
  const d = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : t('acc.device');
  return `${d} · ${new Date().toLocaleDateString(document.documentElement.lang, { month: 'numeric', day: 'numeric' })}`;
}

async function createPasskey() {
  const o = await api('POST', '/api/account/passkey/options');
  const cred = await navigator.credentials.create({
    publicKey: {
      ...o, challenge: buf(o.challenge), user: { ...o.user, id: buf(o.user.id) },
      excludeCredentials: o.excludeCredentials.map((c) => ({ ...c, id: buf(c.id) })),
    },
  });
  return api('POST', '/api/account/passkey', {
    id: cred.id, label: deviceLabel(),
    response: { clientDataJSON: b64u(cred.response.clientDataJSON), attestationObject: b64u(cred.response.attestationObject) },
  });
}

async function passkeySignIn() {
  const o = await api('POST', '/api/account/login/options');
  const cred = await navigator.credentials.get({ publicKey: { ...o, challenge: buf(o.challenge) } });
  const r = cred.response;
  return api('POST', '/api/account/login', {
    id: cred.id,
    response: {
      clientDataJSON: b64u(r.clientDataJSON), authenticatorData: b64u(r.authenticatorData), signature: b64u(r.signature),
      userHandle: r.userHandle ? b64u(r.userHandle) : null,
    },
  });
}

/**
 * @param opts.inGame  false on the entrance screen: after signing in we just carry on into the temple.
 */
export function createAccount() {
  let status = null;
  let inGame = false;

  async function load() {
    try { status = await api('GET', '/api/account'); } catch { status = null; }
    return status;
  }

  function render() {
    if (!status) return;
    $('acc-status').textContent = status.saved ? t('acc.saved') : t('acc.guest');
    $('acc-status').classList.toggle('ok', status.saved);
    const ul = $('acc-keys');
    ul.textContent = '';
    for (const k of status.passkeys) {
      const li = document.createElement('li');
      const s = document.createElement('span'); s.textContent = `🔑 ${k.label}`;
      const x = document.createElement('button'); x.type = 'button'; x.className = 'btn-ghost small'; x.textContent = t('acc.remove');
      x.onclick = async () => {
        if (!confirm(t('acc.removeConfirm', k.label))) return;
        try { status = await api('POST', `/api/account/passkey/${k.id}/remove`); render(); } catch { toast(t('err.generic')); }
      };
      li.append(s, x); ul.append(li);
    }
    if (status.recovery) {
      const li = document.createElement('li');
      li.textContent = t('acc.hasCode', new Date(status.recovery).toLocaleDateString(document.documentElement.lang));
      ul.append(li);
    }
    $('acc-passkey').hidden = !passkeySupported();
    $('acc-recovery').textContent = t(status.recovery ? 'acc.newCode' : 'acc.recovery');
    $('acc-signout').hidden = !status.saved;
  }

  /** Called when the 我的修行 panel opens. */
  async function show() { inGame = true; await load(); render(); }

  async function savePasskey() {
    try {
      status = await createPasskey();
      render();
      toast(t('acc.passkeyDone'), { gold: true });
      closePanel('acc-nudge');
    } catch (e) {
      // NotAllowedError = the person cancelled the system sheet: say nothing
      if (e?.name === 'InvalidStateError') toast(t('acc.passkeyExists'));
      else if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') toast(t('acc.passkeyFail'));
    }
  }

  async function makeCode() {
    if (status?.recovery && !confirm(t('acc.replaceCode'))) return;
    try {
      const { code } = await api('POST', '/api/account/recovery');
      $('acc-code-text').textContent = code;
      await load(); render();
      openPanel('acc-code', () => { if (inGame) openPanel('me-panel'); });
      closePanel('acc-nudge');
    } catch { toast(t('err.generic')); }
  }

  function openRestore() {
    $('acc-restore-msg').hidden = true;
    $('acc-restore-code').value = '';
    $('acc-restore-passkey').hidden = !passkeySupported();
    openPanel('acc-restore');
  }

  async function signedIn(r) {
    setToken(r.token);
    closePanel('acc-restore');
    if (inGame) { location.reload(); return; } // a different account: start the temple over as that person
    $('intro-status').textContent = t('acc.welcomeBack', r.user.name);
  }

  function restoreError(e) {
    const m = $('acc-restore-msg');
    m.hidden = false;
    m.textContent = e?.status === 404 ? t('acc.notFound') : e?.status === 429 ? t('acc.tooMany') : t('err.generic');
  }

  // ---- nudge: once, when there is something worth keeping (merit ≥ 10, or a 靈位 placed)
  let checking = false;
  async function nudge(reason) {
    if (flag.get() || checking) return;
    checking = true;
    try {
      const s = await load();
      if (!s || s.saved) { flag.set(); return; }
      flag.set();
      $('acc-nudge-text').textContent = t(reason === 'tablet' ? 'acc.nudgeTablet' : 'acc.nudgeMerit');
      setTimeout(() => openPanel('acc-nudge'), 1500);
    } finally { checking = false; }
  }
  window.addEventListener('simiao:me', (e) => { if (e.detail?.merit >= 10) nudge('merit'); });
  window.addEventListener('simiao:keep', () => nudge('tablet'));

  // ---- wiring
  $('acc-passkey').onclick = savePasskey;
  $('acc-recovery').onclick = makeCode;
  $('acc-switch').onclick = openRestore;
  $('restore-link').onclick = () => { inGame = false; openRestore(); };
  $('acc-signout').onclick = () => {
    if (!confirm(t('acc.signoutConfirm'))) return;
    api('POST', '/api/account/signout').catch(() => {}).finally(() => { clearToken(); location.href = '/'; });
  };
  $('acc-code-copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('acc-code-text').textContent); toast(t('acc.copied')); } catch { /* select by hand */ }
  };
  $('acc-restore-passkey').onclick = async () => {
    try { await signedIn(await passkeySignIn()); } catch (e) { if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') restoreError(e); }
  };
  $('acc-restore-form').onsubmit = async (e) => {
    e.preventDefault();
    try { await signedIn(await api('POST', '/api/account/restore', { code: $('acc-restore-code').value })); } catch (err) { restoreError(err); }
  };
  $('acc-nudge-yes').onclick = () => { closePanel('acc-nudge'); $('me-chip').click(); };

  return { show, nudge };
}
