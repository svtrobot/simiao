import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { CopyTexts, CopyService, ZenRooms, MIN_MS_PER_CHAR } from '../server/domain/copying.js';
import { blankPractice } from '../server/domain/practice.js';
import { startApp } from './helpers.js';

const texts = new CopyTexts(path.resolve('content'));
const users = { save() {} };
const fresh = () => ({ id: 'u1', practice: blankPractice() });

test('the Heart Sutra has 260 characters and only appears in ritual mode', () => {
  assert.equal(texts.get('heart').chars['zh-Hant'].length, 260);
  assert.equal(texts.get('heart').chars['zh-Hans'].length, 260);
  assert.deepEqual(texts.forMode('ritual').map((t) => t.id), ['heart', 'yinjiu']);
  assert.deepEqual(texts.forMode('cultural').map((t) => t.id), ['yinjiu']);
});

test('copying: steady pace counts, retries do not, rushing is refused', () => {
  const svc = new CopyService({ texts, users, tz: 'Asia/Taipei' });
  const u = fresh();
  let now = 1_000_000;
  let r = svc.write(u, { id: 'heart', from: 0, n: 4 }, 'ritual', now);
  assert.equal(r.pos, 4);
  // the same request again (a network retry) changes nothing
  r = svc.write(u, { id: 'heart', from: 0, n: 4 }, 'ritual', now + 10);
  assert.equal(r.pos, 4); assert.equal(r.merit, 0);
  // too fast: the bucket is empty
  assert.throws(() => svc.write(u, { id: 'heart', from: 4, n: 3 }, 'ritual', now + 20), /too_fast/);
  // skipping ahead is out of step
  assert.throws(() => svc.write(u, { id: 'heart', from: 9, n: 1 }, 'ritual', now + 5000), /out_of_step/);
  now += MIN_MS_PER_CHAR * 3;
  r = svc.write(u, { id: 'heart', from: 4, n: 3 }, 'ritual', now);
  assert.equal(r.pos, 7);
  assert.equal(r.merit, 1); // 5 characters → 1 merit
  assert.equal(u.practice.habits.sutra, 1); // 窑变: 抄經多會生出墨色冰裂紋
  // the sutra is not available in cultural mode
  assert.throws(() => svc.write(u, { id: 'heart', from: 7, n: 1 }, 'cultural', now + 5000), /not_in_this_mode/);
});

test('a finished copy wraps around and the daily merit stops at one sutra', () => {
  const svc = new CopyService({ texts, users, tz: 'Asia/Taipei' });
  const u = fresh();
  let now = 2_000_000, pos = 0, merit = 0, done = 0;
  for (let i = 0; i < 40; i++) { // 40 × 10 = 400 characters, more than one copy
    now += MIN_MS_PER_CHAR * 10;
    const r = svc.write(u, { id: 'heart', from: pos, n: 10 }, 'ritual', now);
    pos = r.pos; merit += r.merit; if (r.done) done++;
  }
  assert.equal(done, 1);
  assert.equal(u.copy.heart.copies, 1);
  assert.equal(merit, 52); // dailyCap 52 units = 260 characters
});

test('禪房: minutes count only while the heartbeat keeps coming', () => {
  const z = new ZenRooms({ users, tz: 'Asia/Taipei' });
  const u = fresh();
  const t0 = 5_000_000;
  z.start(u, t0);
  assert.equal(z.beat(u, t0 + 61_000).gained, 1);
  assert.equal(z.beat(u, t0 + 121_000).gained, 1);
  // phone locked for ten minutes: that stretch is not counted
  assert.equal(z.beat(u, t0 + 721_000).gained, 0);
  assert.equal(z.beat(u, t0 + 781_000).gained, 1);
  const end = z.end(u, t0 + 800_000);
  assert.equal(end.minutes, 3);
  assert.equal(u.practice.minutes, 3);
  // sitting in the hall at the same time doesn't double-count
  const z2 = new ZenRooms({ users, tz: 'Asia/Taipei', isSeatedElsewhere: () => true });
  z2.start(u, t0); assert.equal(z2.beat(u, t0 + 61_000).gained, 0);
});

test('HTTP: copy list per mode, write, zen session', async () => {
  const h = await startApp();
  try {
    const s = await h.session();
    const list = await h.api('GET', '/api/temples/main/copy', null, s.token);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.texts.map((t) => t.id), ['heart', 'yinjiu']);
    assert.equal(list.body.texts[0].length, 260);
    const w = await h.api('POST', '/api/temples/main/copy', { id: 'heart', from: 0, n: 3 }, s.token);
    assert.equal(w.body.pos, 3);
    assert.equal(JSON.stringify(w.body.me).includes('copy'), false); // progress is private
    assert.equal((await h.api('POST', '/api/zen/start', {}, s.token)).status, 200);
    assert.equal((await h.api('POST', '/api/zen/beat', {}, s.token)).body.gained, 0);
    assert.equal((await h.api('POST', '/api/zen/end', {}, s.token)).body.ended, true);
  } finally { await h.close(); }
  const cn = await startApp({ region: 'cn' });
  try {
    const s = await cn.session();
    const list = await cn.api('GET', '/api/temples/main/copy', null, s.token);
    assert.deepEqual(list.body.texts.map((t) => t.id), ['yinjiu']);
    assert.equal(list.body.texts[0].title, '饮酒 · 其五');
    assert.equal((await cn.api('POST', '/api/temples/main/copy', { id: 'heart', from: 0, n: 1 }, s.token)).status, 403);
  } finally { await cn.close(); }
});
