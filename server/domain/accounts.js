// 保存修行（設計文檔 2.1「遊客即可玩，第一次保存功德時才引導登錄」）。
// 遊客令牌只存在這台裝置；清掉瀏覽資料或換手機，功德、燈、家堂就找不回來。這裡提供兩種不依賴任何
// 外部服務的保存方式：通行密鑰（WebAuthn passkey，跟著手機的密碼管理器同步）與恢復碼（自己抄下來）。
// 手機號 / Google / Apple / LINE 登入在拿到各平台憑證後接在同一層（credentials 指向同一個 userId）。
// 不收集任何個人資料：沒有電話、沒有 email，只有公鑰與恢復碼的雜湊。
import crypto from 'node:crypto';
import { HttpError } from './util.js';

const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) throw new HttpError(422, 'invalid_encoding');
  return Buffer.from(s, 'base64url');
};

// ---------------------------------------------------------------- recovery codes

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** 16 Crockford base32 characters = 80 random bits, shown as XXXX-XXXX-XXXX-XXXX. */
export function newRecoveryCode() {
  const bytes = crypto.randomBytes(10);
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let s = '';
  for (let i = 0; i < 16; i++) { s = CROCKFORD[Number(bits & 31n)] + s; bits >>= 5n; }
  return s.match(/.{4}/g).join('-');
}
/** Forgiving input: case, spaces and dashes don't matter; O → 0, I / L → 1. */
export function normalizeCode(s) {
  return String(s || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}
const codeKey = (code) => sha256(`recovery:${normalizeCode(code)}`).toString('base64url');

// ---------------------------------------------------------------- CBOR (the subset WebAuthn uses)

/** Decode one CBOR item at `pos`. Returns [value, nextPos]. Maps become Map (keys may be negative ints). */
export function cborDecode(buf, pos = 0) {
  if (pos >= buf.length) throw new HttpError(422, 'invalid_cbor');
  const ib = buf[pos++], major = ib >> 5, info = ib & 31;
  let len;
  if (info < 24) len = info;
  else if (info === 24) len = buf[pos++];
  else if (info === 25) { len = buf.readUInt16BE(pos); pos += 2; }
  else if (info === 26) { len = buf.readUInt32BE(pos); pos += 4; }
  else if (info === 27) { const v = buf.readBigUInt64BE(pos); pos += 8; if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new HttpError(422, 'invalid_cbor'); len = Number(v); }
  else throw new HttpError(422, 'invalid_cbor'); // indefinite lengths are not used by authenticators
  switch (major) {
    case 0: return [len, pos];
    case 1: return [-1 - len, pos];
    case 2: if (pos + len > buf.length) throw new HttpError(422, 'invalid_cbor'); return [buf.subarray(pos, pos + len), pos + len];
    case 3: if (pos + len > buf.length) throw new HttpError(422, 'invalid_cbor'); return [buf.subarray(pos, pos + len).toString('utf8'), pos + len];
    case 4: { const a = []; for (let i = 0; i < len; i++) { let v; [v, pos] = cborDecode(buf, pos); a.push(v); } return [a, pos]; }
    case 5: { const m = new Map(); for (let i = 0; i < len; i++) { let k, v; [k, pos] = cborDecode(buf, pos); [v, pos] = cborDecode(buf, pos); m.set(k, v); } return [m, pos]; }
    case 7: if (info === 20) return [false, pos]; if (info === 21) return [true, pos]; if (info === 22) return [null, pos];
      throw new HttpError(422, 'invalid_cbor');
    default: throw new HttpError(422, 'invalid_cbor');
  }
}

/** COSE_Key → JWK (ES256 on P-256, or RS256). */
export function coseToJwk(cose) {
  const kty = cose.get(1), alg = cose.get(3);
  if (kty === 2 && cose.get(-1) === 1 && (alg === -7 || alg === undefined)) {
    return { alg: -7, jwk: { kty: 'EC', crv: 'P-256', x: b64u(cose.get(-2)), y: b64u(cose.get(-3)) } };
  }
  if (kty === 3 && (alg === -257 || alg === undefined)) {
    return { alg: -257, jwk: { kty: 'RSA', n: b64u(cose.get(-1)), e: b64u(cose.get(-2)) } };
  }
  throw new HttpError(422, 'unsupported_key');
}

/** authenticatorData: rpIdHash(32) flags(1) signCount(4) [aaguid(16) credIdLen(2) credId coseKey] */
export function parseAuthData(buf) {
  if (buf.length < 37) throw new HttpError(422, 'invalid_auth_data');
  const out = { rpIdHash: buf.subarray(0, 32), flags: buf[32], signCount: buf.readUInt32BE(33) };
  out.up = !!(out.flags & 0x01); out.uv = !!(out.flags & 0x04); out.at = !!(out.flags & 0x40);
  if (out.at) {
    if (buf.length < 55) throw new HttpError(422, 'invalid_auth_data');
    const n = buf.readUInt16BE(53);
    out.credId = buf.subarray(55, 55 + n);
    const [cose] = cborDecode(buf, 55 + n);
    if (!(cose instanceof Map)) throw new HttpError(422, 'invalid_auth_data');
    out.cose = cose;
  }
  return out;
}

// ---------------------------------------------------------------- service

const CHALLENGE_MS = 5 * 60 * 1000;
const RESTORE_WINDOW_MS = 10 * 60 * 1000, RESTORE_TRIES = 10;
export const MAX_PASSKEYS = 10;

export class AccountService {
  /**
   * @param publicOrigin  e.g. https://yun.example — when set, WebAuthn accepts only this origin;
   *                      otherwise the request's own Host decides (fine for localhost and simple deploys).
   */
  constructor({ store, users, publicOrigin = '' }) {
    this.store = store; this.users = users; this.publicOrigin = publicOrigin;
    this.challenges = new Map(); // b64u challenge → { kind, userId, exp } (single instance; Redis in P1 infra)
    this.tries = new Map();      // ip → { n, reset }
  }

  /** Expected { origin, rpId } for a request. */
  site(req) {
    if (this.publicOrigin) return { origin: this.publicOrigin, rpId: new URL(this.publicOrigin).hostname };
    const host = String(req.headers.host || '');
    const proto = String(req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http')).split(',')[0].trim();
    return { origin: `${proto}://${host}`, rpId: host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '') };
  }

  status(user) {
    const passkeys = this.store.list('passkeys', (p) => p.userId === user.id)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((p) => ({ id: p.id, label: p.label, createdAt: p.createdAt, lastUsed: p.lastUsed || null }));
    const recovery = user.account?.recoveryAt || null;
    return { saved: passkeys.length > 0 || !!recovery, passkeys, recovery };
  }

  // ---- recovery code

  /** Make (or replace) this account's recovery code. The code itself is shown once and only its hash is kept. */
  createRecovery(user, now = Date.now()) {
    const code = newRecoveryCode();
    if (user.account?.recoveryKey) this.store.remove('recovery', user.account.recoveryKey);
    const key = codeKey(code);
    this.store.put('recovery', key, { userId: user.id, createdAt: now });
    user.account = { ...(user.account || {}), recoveryKey: key, recoveryAt: now };
    this.users.save(user);
    return { code };
  }

  /** Recovery code → a new session token on this device. Rate-limited per address. */
  restore(code, ip, now = Date.now()) {
    this.throttle(ip, now);
    const ref = normalizeCode(code).length === 16 ? this.store.get('recovery', codeKey(code)) : null;
    const user = ref && this.store.get('users', ref.userId);
    if (!user) throw new HttpError(404, 'code_not_found');
    return this.signIn(user);
  }

  throttle(ip, now) {
    const t = this.tries.get(ip);
    if (!t || t.reset < now) { this.tries.set(ip, { n: 1, reset: now + RESTORE_WINDOW_MS }); return; }
    if (++t.n > RESTORE_TRIES) throw new HttpError(429, 'too_many_tries', { retryAfter: Math.ceil((t.reset - now) / 1000) });
  }

  signIn(user) {
    const token = this.users.issueToken(user.id);
    return { token, user: this.users.publicView(user) };
  }

  // ---- passkeys (WebAuthn)

  challenge(kind, userId, now = Date.now()) {
    for (const [k, c] of this.challenges) if (c.exp < now) this.challenges.delete(k);
    const c = b64u(crypto.randomBytes(32));
    this.challenges.set(c, { kind, userId, exp: now + CHALLENGE_MS });
    return c;
  }

  /** Take a challenge once; it must be fresh, of the right kind and (for registration) for this user. */
  consume(clientData, kind, site, userId, now = Date.now()) {
    let cd;
    try { cd = JSON.parse(clientData.toString('utf8')); } catch { throw new HttpError(422, 'invalid_client_data'); }
    if (cd.type !== (kind === 'create' ? 'webauthn.create' : 'webauthn.get')) throw new HttpError(422, 'wrong_type');
    const c = this.challenges.get(cd.challenge);
    this.challenges.delete(cd.challenge);
    if (!c || c.kind !== kind || c.exp < now || (userId && c.userId !== userId)) throw new HttpError(409, 'challenge_expired');
    if (cd.origin !== site.origin) throw new HttpError(403, 'wrong_origin');
    return cd;
  }

  registerOptions(user, req, now = Date.now()) {
    const site = this.site(req);
    const mine = this.store.list('passkeys', (p) => p.userId === user.id);
    return {
      challenge: this.challenge('create', user.id, now),
      rp: { id: site.rpId, name: '雲上寺' },
      user: { id: b64u(Buffer.from(user.id)), name: user.name, displayName: user.name },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
      excludeCredentials: mine.map((p) => ({ type: 'public-key', id: p.id })),
      attestation: 'none', timeout: CHALLENGE_MS,
    };
  }

  /** body: { id, response: { clientDataJSON, attestationObject }, label } (all binary as base64url) */
  register(user, body, req, now = Date.now()) {
    const site = this.site(req);
    if (this.store.list('passkeys', (p) => p.userId === user.id).length >= MAX_PASSKEYS) throw new HttpError(429, 'passkey_limit');
    const r = body?.response || {};
    this.consume(unb64u(r.clientDataJSON), 'create', site, user.id, now);
    const [att] = cborDecode(unb64u(r.attestationObject));
    if (!(att instanceof Map) || !Buffer.isBuffer(att.get('authData'))) throw new HttpError(422, 'invalid_attestation');
    // Attestation statements are not checked (attestation: 'none'): we only need the public key, not the device make.
    const ad = parseAuthData(att.get('authData'));
    if (!ad.rpIdHash.equals(sha256(site.rpId))) throw new HttpError(403, 'wrong_rp');
    if (!ad.up || !ad.at) throw new HttpError(422, 'no_user_presence');
    const id = b64u(ad.credId);
    if (body.id !== id) throw new HttpError(422, 'id_mismatch');
    if (this.store.get('passkeys', id)) throw new HttpError(409, 'already_registered');
    const { alg, jwk } = coseToJwk(ad.cose);
    crypto.createPublicKey({ key: jwk, format: 'jwk' }); // throws on a malformed key
    const label = String(body.label || '').replace(/\s+/g, ' ').trim().slice(0, 24) || '通行密鑰';
    this.store.put('passkeys', id, { id, userId: user.id, alg, jwk, signCount: ad.signCount, createdAt: now, lastUsed: null, label });
    return this.status(user);
  }

  loginOptions(req, now = Date.now()) {
    const site = this.site(req);
    return { challenge: this.challenge('get', null, now), rpId: site.rpId, allowCredentials: [], userVerification: 'preferred', timeout: CHALLENGE_MS };
  }

  /** body: { id, response: { clientDataJSON, authenticatorData, signature, userHandle } } */
  login(body, req, now = Date.now()) {
    const site = this.site(req);
    const r = body?.response || {};
    const clientData = unb64u(r.clientDataJSON);
    this.consume(clientData, 'get', site, null, now);
    const cred = typeof body?.id === 'string' ? this.store.get('passkeys', body.id) : null;
    if (!cred) throw new HttpError(404, 'passkey_not_found');
    const authData = unb64u(r.authenticatorData);
    const ad = parseAuthData(authData);
    if (!ad.rpIdHash.equals(sha256(site.rpId))) throw new HttpError(403, 'wrong_rp');
    if (!ad.up) throw new HttpError(422, 'no_user_presence');
    const data = Buffer.concat([authData, sha256(clientData)]);
    const key = crypto.createPublicKey({ key: cred.jwk, format: 'jwk' });
    const ok = cred.alg === -7
      ? crypto.verify('sha256', data, { key, dsaEncoding: 'der' }, unb64u(r.signature))
      : crypto.verify('sha256', data, { key, padding: crypto.constants.RSA_PKCS1_PADDING }, unb64u(r.signature));
    if (!ok) throw new HttpError(403, 'bad_signature');
    // Synced passkeys report 0; a hardware key whose counter goes backwards may have been cloned.
    if (cred.signCount > 0 && ad.signCount <= cred.signCount) throw new HttpError(403, 'counter_regressed');
    const user = this.store.get('users', cred.userId);
    if (!user) throw new HttpError(404, 'passkey_not_found');
    cred.signCount = ad.signCount; cred.lastUsed = now;
    this.store.put('passkeys', cred.id, cred);
    return this.signIn(user);
  }

  removePasskey(user, id) {
    const p = this.store.get('passkeys', id);
    if (!p || p.userId !== user.id) throw new HttpError(404, 'not_found');
    this.store.remove('passkeys', id);
    return this.status(user);
  }
}

