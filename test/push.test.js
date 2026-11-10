import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { encryptPayload, vapidAuth, newVapidKeys, PushService } from '../server/domain/push.js';
import { JsonStore } from '../server/store/jsonStore.js';
import { UserService } from '../server/domain/users.js';
import { AncestorService } from '../server/domain/ancestors.js';
import { DailyLines } from '../server/domain/almanac.js';
import { startApp } from './helpers.js';

/** A browser's side of Web Push: its key pair, and RFC 8291 decryption. */
function browser() {
  const ecdh = crypto.createECDH('prime256v1');
  const pub = ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    keys: { p256dh: pub.toString('base64url'), auth: auth.toString('base64url') },
    decrypt(buf) {
      const salt = buf.subarray(0, 16), rs = buf.readUInt32BE(16), idlen = buf[20];
      const asPub = buf.subarray(21, 21 + idlen), ct = buf.subarray(21 + idlen);
      assert.equal(rs, 4096);
      const shared = ecdh.computeSecret(asPub);
      const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), pub, asPub]), 32));
      const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
      const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
      const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
      d.setAuthTag(ct.subarray(ct.length - 16));
      const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
      assert.equal(plain[plain.length - 1], 2); // last-record delimiter
      return JSON.parse(plain.subarray(0, -1).toString('utf8'));
    },
  };
}

/** What a push service checks: the ES256 JWT signed by the key it is given. */
function verifyVapid(header, endpoint) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.ok(m, header);
  const [h, c, s] = m[1].split('.');
  const raw = Buffer.from(m[2], 'base64url');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.aud, new URL(endpoint).origin);
  return claims;
}

test('Web Push payloads decrypt the way a browser does, and VAPID verifies', () => {
  const b = browser();
  const msg = { title: '早安', body: '慢慢來，比較快。', url: '/' };
  assert.deepEqual(b.decrypt(encryptPayload(JSON.stringify(msg), b.keys.p256dh, b.keys.auth)), msg);
  const keys = newVapidKeys();
  const now = Date.now();
  const claims = verifyVapid(vapidAuth('https://fcm.googleapis.com/fcm/send/abc', keys, 'https://example.org', now), 'https://fcm.googleapis.com/fcm/send/abc');
  assert.equal(claims.sub, 'https://example.org');
  assert.ok(claims.exp > now / 1000 && claims.exp <= now / 1000 + 24 * 3600);
});

test('the day of reminders: 08:00 almanac, 20:00 eve of a 忌日, 08:00 the day itself; at most two a day', async () => {
  const store = new JsonStore(null);
  const users = new UserService({ store, locale: 'zh-Hant' });
  const ancestors = new AncestorService({ store, tz: 'Asia/Taipei', hotline: {} });
  const sent = [];
  const b = browser();
  const push = new PushService({
    store, users, ancestors, daily: new DailyLines(path.resolve('content')), tz: 'Asia/Taipei', locale: 'zh-Hant', mode: 'ritual',
    subject: 'https://example.org',
    transport: async (endpoint, init) => { sent.push({ endpoint, msg: b.decrypt(init.body), auth: init.headers.Authorization }); return { status: 201 }; },
  });
  const at = (iso) => Date.parse(iso);
  const { user } = users.session();
  const hall = ancestors.create(user, { name: '王家' }, at('2026-11-10T00:00:00Z'));
  ancestors.addTablet(user, hall.id, { name: '王大明', relation: '祖父', died: { date: '2019-11-11' } }, at('2026-11-10T00:00:00Z'));
  push.subscribe(user, { subscription: { endpoint: 'https://push.example.org/send/1', keys: b.keys }, tz: 'Asia/Taipei', prefs: { night: true } });

  await push.tick(at('2026-11-10T00:05:00Z')); // 08:05 Taipei
  assert.equal(sent.length, 1);
  assert.match(sent[0].msg.title, /^早安 · 農曆十月/);
  assert.ok(sent[0].msg.body.length > 0);
  verifyVapid(sent[0].auth, 'https://push.example.org/send/1');
  await push.tick(at('2026-11-10T00:30:00Z')); // same slot again: nothing
  assert.equal(sent.length, 1);
  await push.tick(at('2026-11-10T12:10:00Z')); // 20:10: tomorrow is the 忌日
  assert.equal(sent[1].msg.title, '明天是祖父 王大明的忌日（7 週年）');
  await push.tick(at('2026-11-10T14:10:00Z')); // 22:10: night sit is on, but two already today
  assert.equal(sent.length, 2);
  await push.tick(at('2026-11-11T00:10:00Z')); // next morning: the 忌日 itself replaces the almanac
  assert.equal(sent[2].msg.title, '今天是祖父 王大明的忌日（7 週年）');
  assert.equal(sent[2].msg.url, '/?go=ancestor');
  await push.tick(at('2026-11-11T14:10:00Z')); // 22:10 on a lighter day: the night sit goes out
  assert.equal(sent[3].msg.title, '睡前，靜坐五分鐘？');

  // a subscription the push service says is gone is forgotten
  push.transport = async () => ({ status: 410 });
  await push.tick(at('2026-11-12T00:10:00Z'));
  assert.equal(push.status(user).devices, 0);
});

test('push over HTTP: subscribe validates the browser keys; prefs persist', async () => {
  const h = await startApp();
  try {
    const { token } = await h.session();
    let r = await h.api('GET', '/api/push', null, token);
    assert.equal(Buffer.from(r.body.publicKey, 'base64url').length, 65);
    assert.deepEqual(r.body.prefs, { morning: true, family: true, night: false });
    const b = browser();
    r = await h.api('POST', '/api/push/subscribe', { subscription: { endpoint: 'http://insecure.example/x', keys: b.keys } }, token);
    assert.equal(r.status, 422);
    r = await h.api('POST', '/api/push/subscribe', { subscription: { endpoint: 'https://push.example.org/s/2', keys: { ...b.keys, auth: 'AAAA' } } }, token);
    assert.equal(r.status, 422);
    r = await h.api('POST', '/api/push/subscribe', { subscription: { endpoint: 'https://push.example.org/s/2', keys: b.keys }, tz: 'America/Los_Angeles', prefs: { morning: false } }, token);
    assert.equal(r.status, 200);
    assert.equal(r.body.devices, 1);
    assert.equal(r.body.prefs.morning, false);
    r = await h.api('POST', '/api/push/prefs', { night: true }, token);
    assert.deepEqual(r.body.prefs, { morning: false, family: true, night: true });
    r = await h.api('POST', '/api/push/unsubscribe', { endpoint: 'https://push.example.org/s/2' }, token);
    assert.equal(r.body.devices, 0);
  } finally { await h.close(); }
});
