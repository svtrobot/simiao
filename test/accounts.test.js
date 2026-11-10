import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { newRecoveryCode, normalizeCode, cborDecode } from '../server/domain/accounts.js';
import { startApp } from './helpers.js';

// ---- a tiny CBOR encoder + software authenticator, standing in for a phone's passkey
function cbor(v) {
  const head = (major, n) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
    const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
  };
  if (v === true) return Buffer.from([0xf5]);
  if (v === false) return Buffer.from([0xf4]);
  if (v === null) return Buffer.from([0xf6]);
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('cbor: unsupported');
}
const sha = (b) => crypto.createHash('sha256').update(b).digest();
const b64u = (b) => Buffer.from(b).toString('base64url');

function authenticator(rpId) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credId = crypto.randomBytes(16);
  let counter = 0;
  const authData = (flags, attested) => {
    const head = Buffer.alloc(37); sha(rpId).copy(head, 0); head[32] = flags; head.writeUInt32BE(counter, 33);
    if (!attested) return head;
    const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
    const len = Buffer.alloc(2); len.writeUInt16BE(credId.length);
    return Buffer.concat([head, Buffer.alloc(16), len, credId, cose]);
  };
  return {
    id: b64u(credId),
    create(challenge, origin) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin }));
      const attestationObject = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData(0x45, true)]]));
      return { id: b64u(credId), response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject) }, label: '測試手機' };
    },
    get(challenge, origin, { counterStep = 0 } = {}) {
      counter += counterStep;
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
      const ad = authData(0x05, false);
      const signature = crypto.sign('sha256', Buffer.concat([ad, sha(clientDataJSON)]), { key: privateKey, dsaEncoding: 'der' });
      return { id: b64u(credId), response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(ad), signature: b64u(signature), userHandle: null } };
    },
  };
}

test('recovery codes: 80 random bits, forgiving to type', () => {
  const c = newRecoveryCode();
  assert.match(c, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  assert.notEqual(c, newRecoveryCode());
  assert.equal(normalizeCode(' ab1o-il00 '), 'AB10110' + '0');
  const [m] = cborDecode(cbor(new Map([[1, 2], [-3, Buffer.from([1, 2])], ['k', [true, null]]])));
  assert.equal(m.get(1), 2); assert.deepEqual([...m.get(-3)], [1, 2]); assert.deepEqual(m.get('k'), [true, null]);
});

test('a recovery code brings the account to a new device; a new code replaces the old one', async () => {
  const h = await startApp();
  try {
    const me = await h.session();
    let r = await h.api('GET', '/api/account', null, me.token);
    assert.equal(r.body.saved, false);
    const { code } = (await h.api('POST', '/api/account/recovery', {}, me.token)).body;
    r = await h.api('GET', '/api/account', null, me.token);
    assert.equal(r.body.saved, true);
    // new phone: type the code in lower case with spaces
    r = await h.api('POST', '/api/account/restore', { code: code.toLowerCase().replace(/-/g, ' ') });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.id, me.user.id);
    assert.notEqual(r.body.token, me.token);
    const other = r.body.token;
    assert.equal((await h.api('GET', '/api/me', null, other)).body.id, me.user.id);
    // regenerate: the old code stops working
    const fresh = (await h.api('POST', '/api/account/recovery', {}, me.token)).body.code;
    assert.equal((await h.api('POST', '/api/account/restore', { code })).status, 404);
    assert.equal((await h.api('POST', '/api/account/restore', { code: fresh })).status, 200);
    // signing out one device leaves the others signed in
    await h.api('POST', '/api/account/signout', {}, other);
    assert.equal((await h.api('GET', '/api/me', null, other)).status, 401);
    assert.equal((await h.api('GET', '/api/me', null, me.token)).status, 200);
    // guessing is throttled (10 tries per 10 minutes per address, counting the ones above)
    let last;
    for (let i = 0; i < 10; i++) last = await h.api('POST', '/api/account/restore', { code: 'AAAA-AAAA-AAAA-AAAA' });
    assert.equal(last.status, 429);
  } finally { await h.close(); }
});

test('passkeys: register, sign in on another device, and refuse replays, wrong origins and bad signatures', async () => {
  const h = await startApp();
  try {
    const origin = h.base, rpId = '127.0.0.1';
    const me = await h.session();
    const key = authenticator(rpId);
    let opts = (await h.api('POST', '/api/account/passkey/options', {}, me.token)).body;
    assert.equal(opts.rp.id, rpId);
    assert.equal(opts.authenticatorSelection.residentKey, 'required');
    // wrong origin is refused, and the challenge is spent
    let r = await h.api('POST', '/api/account/passkey', key.create(opts.challenge, 'https://evil.example'), me.token);
    assert.equal(r.status, 403);
    r = await h.api('POST', '/api/account/passkey', key.create(opts.challenge, origin), me.token);
    assert.equal(r.status, 409);
    opts = (await h.api('POST', '/api/account/passkey/options', {}, me.token)).body;
    r = await h.api('POST', '/api/account/passkey', key.create(opts.challenge, origin), me.token);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.saved, true);
    assert.equal(r.body.passkeys[0].label, '測試手機');

    // sign in elsewhere (no token)
    let lo = (await h.api('POST', '/api/account/login/options', {})).body;
    const assertion = key.get(lo.challenge, origin);
    r = await h.api('POST', '/api/account/login', assertion);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.user.id, me.user.id);
    // the same assertion again: challenge already used
    assert.equal((await h.api('POST', '/api/account/login', assertion)).status, 409);
    // tampered signature
    lo = (await h.api('POST', '/api/account/login/options', {})).body;
    const bad = key.get(lo.challenge, origin);
    const sig = Buffer.from(bad.response.signature, 'base64url'); sig[sig.length - 1] ^= 1;
    bad.response.signature = b64u(sig);
    assert.equal((await h.api('POST', '/api/account/login', bad)).status, 403);
    // a registration challenge cannot be used to sign in
    opts = (await h.api('POST', '/api/account/passkey/options', {}, me.token)).body;
    assert.equal((await h.api('POST', '/api/account/login', key.get(opts.challenge, origin))).status, 409);

    // remove it: it no longer signs in
    const id = (await h.api('GET', '/api/account', null, me.token)).body.passkeys[0].id;
    r = await h.api('POST', `/api/account/passkey/${id}/remove`, {}, me.token);
    assert.equal(r.body.saved, false);
    lo = (await h.api('POST', '/api/account/login/options', {})).body;
    assert.equal((await h.api('POST', '/api/account/login', key.get(lo.challenge, origin))).status, 404);
  } finally { await h.close(); }
});
