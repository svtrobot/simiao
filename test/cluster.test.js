// PostgreSQL + Redis (docs/CLUSTER.md). The protocol unit tests always run; the rest need real servers:
//   TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/simiao TEST_REDIS_URL=redis://localhost:56379 npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { PgClient, scramClientFinal } from '../server/store/pg.js';
import { RedisClient, RespParser, encodeCommand } from '../server/store/redis.js';
import { PgStore } from '../server/store/pgStore.js';
import { Cluster } from '../server/realtime/cluster.js';
import { startApp, sleep } from './helpers.js';

const PG = process.env.TEST_DATABASE_URL, REDIS = process.env.TEST_REDIS_URL;
const live = { skip: !(PG && REDIS) && 'set TEST_DATABASE_URL and TEST_REDIS_URL to run' };

test('SCRAM-SHA-256 client proof matches the RFC 7677 example', () => {
  const r = scramClientFinal('pencil', 'n=user,r=rOprNGfwEbeRWgbNEkqO',
    'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096');
  assert.equal(r.final, 'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=');
  assert.equal(r.serverSignature, '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
});

test('RESP replies parse across arbitrary chunk boundaries', () => {
  const wire = Buffer.from('+OK\r\n:42\r\n$-1\r\n$6\r\n雲上\r\n*3\r\n$7\r\nmessage\r\n$2\r\nch\r\n$5\r\nhello\r\n-ERR nope\r\n');
  for (const size of [1, 3, 7, 1000]) {
    const p = new RespParser(); const out = [];
    for (let i = 0; i < wire.length; i += size) out.push(...p.feed(wire.subarray(i, i + size)));
    assert.deepEqual(out.slice(0, 5), ['OK', 42, null, '雲上', ['message', 'ch', 'hello']]);
    assert.ok(out[5] instanceof Error && /nope/.test(out[5].message));
  }
  assert.equal(encodeCommand(['SET', 'k', '值']), '*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$3\r\n值\r\n');
});

let run = 0;
async function instance(id, { redis = true, pollMs = 0, channel } = {}) {
  const store = new PgStore({
    pg: new PgClient(PG), redis: redis ? new RedisClient(REDIS) : null, sub: redis ? new RedisClient(REDIS) : null,
    instance: id, channel, flushMs: 15, pollMs,
  });
  await store.ready();
  return store;
}
async function fresh() {
  const pg = new PgClient(PG);
  await pg.exec('CREATE TABLE IF NOT EXISTS docs (col text, id text); DROP TABLE docs;');
  await pg.close();
  return `simiao:test:${process.pid}:${++run}`;
}
const settle = () => sleep(250);

test('two instances: a change on one reaches the other, in place, and survives a restart', live, async () => {
  const channel = await fresh();
  const a = await instance('a', { channel }), b = await instance('b', { channel });
  try {
    a.put('users', 'u1', { id: 'u1', name: '慧明', practice: { merit: 1 } });
    await settle();
    const onB = b.get('users', 'u1');
    assert.equal(onB.practice.merit, 1);
    // a room on B keeps a reference to this object: later changes from A must arrive in the same object
    const onA = a.get('users', 'u1'); onA.practice = { merit: 5 }; onA.name = '慧明居士'; delete onA.id;
    a.put('users', 'u1', onA);
    await settle();
    assert.equal(onB.practice.merit, 5);
    assert.equal(onB.name, '慧明居士');
    assert.equal('id' in onB, false);
    assert.equal(b.get('users', 'u1'), onB);
    // removals replicate too, and a listener hears remote changes only
    const heard = [];
    b.onRemote((col, id, doc) => heard.push([col, id, doc && doc.kind]));
    a.put('lamps', 'l1', { kind: 'guangming' }); a.put('lamps', 'l2', { kind: 'yaoshi' });
    await settle();
    a.remove('lamps', 'l2');
    b.put('lamps', 'l3', { kind: 'local' });
    await settle();
    assert.deepEqual(heard, [['lamps', 'l1', 'guangming'], ['lamps', 'l2', 'yaoshi'], ['lamps', 'l2', null]]);
    assert.equal(b.get('lamps', 'l2'), null);
    assert.equal(a.get('lamps', 'l3').kind, 'local');
    // a new instance loads the same state from PostgreSQL
    const c = await instance('c', { channel });
    assert.equal(c.get('users', 'u1').practice.merit, 5);
    assert.deepEqual(c.list('lamps').map((l) => l.kind).sort(), ['guangming', 'local']);
    await c.close();
  } finally { await a.close(); await b.close(); }
});

test('concurrent writes to one document converge to the same winner everywhere', live, async () => {
  const channel = await fresh();
  const a = await instance('a', { channel }), b = await instance('b', { channel });
  try {
    a.put('wishes', 'w', { text: 'from a' });
    b.put('wishes', 'w', { text: 'from b' }); // same version, before either has heard of the other
    await settle(); await settle();
    assert.equal(a.get('wishes', 'w').text, 'from b'); // (1, 'b') > (1, 'a')
    assert.equal(b.get('wishes', 'w').text, 'from b');
    const c = await instance('c', { channel });
    assert.equal(c.get('wishes', 'w').text, 'from b');
    // the next write builds on the winner's version and wins
    a.put('wishes', 'w', { text: 'a again' });
    await settle();
    assert.equal(b.get('wishes', 'w').text, 'a again');
    assert.equal(c.get('wishes', 'w').text, 'a again');
    await c.close();
  } finally { await a.close(); await b.close(); }
});

test('a missed Redis message is recovered from PostgreSQL; ensure() has one winner; challenges are never persisted', live, async () => {
  const channel = await fresh();
  const a = await instance('a', { channel });
  const deaf = await instance('deaf', { channel, redis: false, pollMs: 60_000 }); // hears nothing over Redis
  const b = await instance('b', { channel });
  try {
    a.put('tablets', 't1', { name: '王大明' });
    await settle();
    assert.equal(deaf.get('tablets', 't1'), null);
    assert.equal(await deaf.catchUp(), 1);
    assert.equal(deaf.get('tablets', 't1').name, '王大明');

    const [ka, kb] = await Promise.all([a.ensure('meta', 'vapid', () => ({ key: 'A' })), b.ensure('meta', 'vapid', () => ({ key: 'B' }))]);
    assert.equal(ka.key, kb.key);

    a.put('challenges', 'c1', { id: 'c1', kind: 'get', exp: Date.now() + 1000 });
    await settle();
    assert.equal(b.get('challenges', 'c1').kind, 'get'); // replicated
    const pg = new PgClient(PG);
    const { rows } = await pg.query("SELECT count(*)::text AS n FROM docs WHERE col = 'challenges'");
    await pg.close();
    assert.equal(rows[0].n, '0');                         // but not written to the database
  } finally { await a.close(); await deaf.close(); await b.close(); }
});

test('two app instances share accounts, lamps, incense and the online count', live, async () => {
  const channel = await fresh();
  const ns = channel;
  const mk = async (id) => {
    const store = await instance(id, { channel });
    const cluster = new Cluster({ redis: new RedisClient(REDIS), instance: id, ns });
    return startApp({ store, cluster, instanceId: id });
  };
  const A = await mk('a'), B = await mk('b');
  try {
    assert.equal((await A.api('GET', '/api/health')).body.store, 'postgres');
    // a visitor created through A is known to B
    const me = await A.session();
    await settle();
    let r = await B.api('GET', '/api/me', null, me.token);
    assert.equal(r.status, 200);
    assert.equal(r.body.id, me.user.id);
    // a lamp lit through A hangs on B's wall
    r = await A.api('POST', '/api/temples/main/lamps', { kind: 'guangming', forOther: true, forName: '王小明', wish: '平安' }, me.token);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await settle();
    r = await B.api('GET', '/api/temples/main/lamps', null, me.token);
    assert.equal(r.body.lamps.length, 1);
    assert.equal(r.body.lamps[0].mine, true);
    assert.equal(r.body.mine[0].forName, '王小明');
    // incense offered through both instances adds up on both
    A.app.ctx.offerings.addIncense('main', 3); B.app.ctx.offerings.addIncense('main', 3); A.app.ctx.offerings.addIncense('main', 3);
    await settle();
    assert.equal(A.app.ctx.offerings.incenseToday('main'), 9);
    assert.equal(B.app.ctx.offerings.incenseToday('main'), 9);
    // a passkey challenge issued by A can be consumed on B
    const opts = (await A.api('POST', '/api/account/passkey/options', {}, me.token)).body;
    await settle();
    assert.equal(B.app.ctx.store.get('challenges', opts.challenge).userId, me.user.id);
    // someone standing in A's hall is counted on B
    const c = await A.connect(me.token);
    await c.wait((m) => m.t === 'welcome');
    await sleep(4500); // two presence beats
    assert.equal(B.app.ctx.lobby.templeStats('main').online, 1);
    assert.equal((await B.api('GET', '/api/health')).body.instances, 2);
    c.close();
    // only one instance runs a scheduled job
    const won = await Promise.all([A.app.ctx.cluster.leader('push', 5), B.app.ctx.cluster.leader('push', 5)]);
    assert.deepEqual(won.sort(), [false, true]);
  } finally { await A.close(); await B.close(); }
});
