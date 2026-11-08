import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, sleep } from './helpers.js';

test('two pilgrims see each other, greet, and share the incense counter', async () => {
  const h = await startApp();
  try {
    const a = await h.session(); const b = await h.session();
    const ca = await h.connect(a.token);
    const wa = await ca.wait((m) => m.t === 'welcome');
    assert.equal(wa.room.capacity, 100);
    assert.equal(wa.room.mode, 'ritual');
    const cb = await h.connect(b.token);
    const jb = await ca.wait((m) => m.t === 'tick' && m.j.some((x) => x.id === b.user.id));
    const bn = jb.j.find((x) => x.id === b.user.id).n;
    cb.send({ t: 'greet', to: a.user.id, k: 'gassho' });
    const g = await ca.wait((m) => m.t === 'tick' && m.e.some((e) => e.k === 'greet'));
    assert.equal(g.e.find((e) => e.k === 'greet').from, b.user.id);
    ca.send({ t: 'rit', k: 'incense' });
    await cb.wait((m) => m.t === 'tick' && m.e.some((e) => e.k === 'incense' && e.id === a.user.id));
    const merit = await ca.wait((m) => m.t === 'merit' && m.action === 'incense');
    assert.equal(merit.gained, 3);
    const an = wa.members.find((x) => x.id === a.user.id).n;
    ca.close(); await cb.wait((m) => m.t === 'tick' && m.l.includes(an));
    assert.ok(bn > an);
    cb.close();
  } finally { await h.close(); }
});

test('seats are exclusive; moving stands you up; teleports are clamped', async () => {
  const h = await startApp();
  try {
    const a = await h.session(); const b = await h.session();
    const ca = await h.connect(a.token); const cb = await h.connect(b.token);
    await ca.wait((m) => m.t === 'welcome'); await cb.wait((m) => m.t === 'welcome');
    ca.send({ t: 'sit', seat: 'seat-0-0' });
    // the seat shows up either in a join snapshot or in a later delta, depending on tick timing
    await cb.wait((m) => m.t === 'tick' && (m.u.some((u) => u[5] === 0) // seat-0-0 is index 0
      || m.j.some((j) => j.id === a.user.id && j.seat === 'seat-0-0')));
    cb.send({ t: 'sit', seat: 'seat-0-0' });
    assert.equal((await cb.wait((m) => m.t === 'err')).code, 'seat_taken');
    await sleep(150);
    cb.send({ t: 'mv', x: 0, z: -27, ry: 0 }); // from the gate straight to the altar
    const fix = await cb.wait((m) => m.t === 'fix');
    assert.ok(fix.z > 0, 'server keeps the pilgrim near where they were');
    ca.close(); cb.close();
  } finally { await h.close(); }
});

test('rooms shard by capacity (分线) and stats aggregate across shards', async () => {
  const h = await startApp({ room: { capacity: 3, tickHz: 10, statsBroadcastMs: 5000, idleKickMs: 1800000 } });
  try {
    const clients = [];
    for (let i = 0; i < 7; i++) {
      const s = await h.session();
      const c = await h.connect(s.token);
      clients.push(await c.wait((m) => m.t === 'welcome').then((w) => ({ c, room: w.room.id })));
    }
    const rooms = new Set(clients.map((x) => x.room));
    assert.equal(rooms.size, 3);
    const st = (await h.api('GET', '/api/temples/main')).body.stats;
    assert.equal(st.online, 7);
    assert.equal(st.rooms, 3);
    for (const x of clients) x.c.close();
  } finally { await h.close(); }
});

test('cultural mode (mainland deployment) rejects rituals over both WS and HTTP', async () => {
  const h = await startApp({ region: 'cn' });
  try {
    // tw-main-hall is not listed for cn: use a cultural tenant scene instead
    h.app.ctx.scenes.get('tw-main-hall').regions.push('cn');
    const s = await h.session();
    const c = await h.connect(s.token);
    const w = await c.wait((m) => m.t === 'welcome');
    assert.equal(w.room.mode, 'cultural');
    c.send({ t: 'rit', k: 'incense' });
    assert.equal((await c.wait((m) => m.t === 'err')).code, 'not_in_this_mode');
    const r = await h.api('POST', '/api/temples/main/fortune/draw', {}, s.token);
    assert.equal(r.status, 403);
    c.close();
  } finally { await h.close(); }
});

test('wishes: crisis text stays private and returns a hotline', async () => {
  const h = await startApp();
  try {
    const s = await h.session();
    const ok = await h.api('POST', '/api/temples/main/wishes', { text: '願家人平安健康' }, s.token);
    assert.equal(ok.body.wish.visibility, 'public');
    const sad = await h.api('POST', '/api/temples/main/wishes', { text: '我真的不想活了' }, s.token);
    assert.equal(sad.body.wish.visibility, 'private');
    assert.equal(sad.body.support.phone, '1925');
    const wall = await h.api('GET', '/api/temples/main/wishes');
    assert.equal(wall.body.length, 1);
    const other = await h.session();
    assert.equal((await h.api('POST', `/api/wishes/${ok.body.wish.id}/rejoice`, {}, other.token)).body.rejoice, 1);
  } finally { await h.close(); }
});

test('admin endpoints require the admin token', async () => {
  const h = await startApp();
  try {
    assert.equal((await h.api('GET', '/api/admin/applications')).status, 401);
    assert.equal((await h.api('GET', '/api/admin/applications', null, 'test-admin')).status, 200);
  } finally { await h.close(); }
});
