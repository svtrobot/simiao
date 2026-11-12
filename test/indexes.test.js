import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/store/jsonStore.js';
import { PgStore } from '../server/store/pgStore.js';
import { PgClient } from '../server/store/pg.js';
import { OfferingService, WALL } from '../server/domain/offerings.js';
import { LampService, ARCHIVE_DAYS } from '../server/domain/lamps.js';
import { AncestorService } from '../server/domain/ancestors.js';

const DAY = 86400000;
const ids = (docs) => docs.map((d) => d.id).sort();

test('indexes follow put, remove and a changed key; several keys per document', () => {
  const s = new JsonStore(null);
  s.put('families', 'f1', { id: 'f1', members: [{ userId: 'a' }, { userId: 'b' }] });
  s.index('families', 'member', (f) => f.members.map((m) => m.userId));   // declared after data exists
  s.index('families', 'member', () => 'ignored');                         // declaring again changes nothing
  s.put('families', 'f2', { id: 'f2', members: [{ userId: 'b' }] });
  assert.deepEqual(ids(s.by('families', 'member', 'a')), ['f1']);
  assert.deepEqual(ids(s.by('families', 'member', 'b')), ['f1', 'f2']);
  assert.deepEqual(s.by('families', 'member', 'nobody'), []);
  const f1 = s.get('families', 'f1');
  f1.members = f1.members.filter((m) => m.userId !== 'b');                // b leaves
  s.put('families', 'f1', f1);
  assert.deepEqual(ids(s.by('families', 'member', 'b')), ['f2']);
  s.remove('families', 'f2');
  assert.deepEqual(s.by('families', 'member', 'b'), []);
  assert.equal(s.by('families', 'member', 'a')[0], f1);                   // the live document, not a copy
  assert.throws(() => s.by('families', 'owner', 'a'), /no index/);
});

test('the wish wall: newest first, capped, and it refills after wishes are taken down', () => {
  const s = new JsonStore(null);
  const svc = new OfferingService({ store: s, tz: 'Asia/Taipei', hotline: {} });
  const N = WALL * 3;
  for (let i = 0; i < N; i++) s.put('wishes', `w${i}`, { id: `w${i}`, templeId: i % 10 === 9 ? 'other' : 'main', userId: 'u', name: null, text: 't', rejoice: 0, visibility: 'public', createdAt: 1000 + i });
  const expected = () => s.list('wishes', (w) => w.templeId === 'main' && w.visibility === 'public').sort((a, b) => b.createdAt - a.createdAt).slice(0, WALL).map((w) => w.id);
  assert.deepEqual(svc.wall('main').map((w) => w.id), expected());
  assert.equal(svc.wall('main').length, WALL);
  // an old wish gets a 隨喜 (a put): it does not jump the queue
  const old = s.get('wishes', 'w0'); old.rejoice = 5; s.put('wishes', 'w0', old);
  assert.deepEqual(svc.wall('main').map((w) => w.id), expected());
  // take down far more than the slack the index keeps: older wishes move up, in order
  for (const w of s.list('wishes', (x) => x.templeId === 'main').sort((a, b) => b.createdAt - a.createdAt).slice(0, WALL * 2 + 5)) { w.visibility = 'removed'; s.put('wishes', w.id, w); }
  assert.deepEqual(svc.wall('main').map((w) => w.id), expected());
  assert.ok(svc.wall('main').length > 0);
  // one comes back
  const back = s.list('wishes', (x) => x.visibility === 'removed')[0]; back.visibility = 'public'; s.put('wishes', back.id, back);
  assert.deepEqual(svc.wall('main').map((w) => w.id), expected());
  assert.equal(svc.wall('other').length, N / 10);
});

test('lamps that went out are archived, and their 祈福卡 still answers', () => {
  const s = new JsonStore(null), now = Date.now();
  const svc = new LampService({ store: s, hotline: {} });
  const lamp = (id, expiresAt, cardId = null) => s.put('lamps', id, { id, cardId, templeId: 'main', userId: 'u', fromName: 'a', kind: 'guangming', forOther: !!cardId, forName: '王小明', wish: '平安', wishPublic: true, crisis: false, litAt: expiresAt - 7 * DAY, expiresAt, renewed: 0 });
  lamp('lit', now + DAY); lamp('justOut', now - DAY / 2); lamp('longOut', now - (ARCHIVE_DAYS + 1) * DAY, 'card1');
  assert.equal(svc.archive(now), 1);
  assert.equal(svc.archive(now), 0);
  assert.deepEqual(ids(svc.active('main', now)), ['lit']);
  assert.deepEqual(ids(svc.mine('u', now)), ['justOut', 'lit']);          // still shown for a day after going out
  assert.equal(s.get('lamps', 'longOut'), null);
  assert.equal(s.get('lamps_old', 'longOut').forName, '王小明');           // kept, not deleted
  assert.deepEqual((({ lampId, lit }) => [lampId, lit])(svc.card('card1', now)), ['longOut', false]);
  assert.throws(() => svc.card('nope', now), /not_found/);
});

test('tablet photos live outside the document, on disk and in memory alike; old embedded photos are moved', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simiao-blob-'));
  try {
    const s = new JsonStore(dir);
    const svc = new AncestorService({ store: s, tz: 'Asia/Taipei', hotline: {} });
    const me = { id: 'u1', name: '竹音居士' };
    const hall = svc.create(me, { name: '王家' });
    const PHOTO = `data:image/jpeg;base64,${'A'.repeat(4000)}`;
    const tb = svc.addTablet(me, hall.id, { name: '王大明', died: { date: '2019-11-12' }, photo: PHOTO });
    assert.equal((await svc.photo(me, hall.id, tb.id)).photo, PHOTO);
    assert.ok(!JSON.stringify(s.get('tablets', tb.id)).includes('AAAA'));  // not in the document…
    s.flush();
    assert.ok(!fs.readFileSync(path.join(dir, 'tablets.log'), 'utf8').includes('AAAA')); // …so not rewritten with every offering
    assert.equal(fs.readFileSync(path.join(dir, 'blobs', 'photos', tb.id), 'utf8'), PHOTO);
    assert.equal(svc.tabletView(s.get('tablets', tb.id), me, hall).photoV, 1);
    // a restart finds it again
    const again = new AncestorService({ store: new JsonStore(dir), tz: 'Asia/Taipei', hotline: {} });
    assert.equal((await again.photo(me, hall.id, tb.id)).photo, PHOTO);
    // remove the photo, then the tablet
    svc.editTablet(me, hall.id, tb.id, { photo: null });
    await assert.rejects(svc.photo(me, hall.id, tb.id), /no_photo/);
    assert.equal(fs.existsSync(path.join(dir, 'blobs', 'photos', tb.id)), false);
    // a tablet saved before this change carries its photo inside the document
    const legacy = svc.addTablet(me, hall.id, { name: '林秀英', died: { date: '2021-02-03' } });
    Object.assign(s.get('tablets', legacy.id), { photo: PHOTO, photoV: 3 }); delete s.get('tablets', legacy.id).hasPhoto;
    assert.equal(svc.tabletView(s.get('tablets', legacy.id), me, hall).photoV, 3);
    assert.equal(await svc.movePhotos(), 1);
    assert.equal(s.get('tablets', legacy.id).photo, undefined);
    assert.deepEqual(await svc.photo(me, hall.id, legacy.id), { photo: PHOTO, v: 3 });
    svc.removeTablet(me, hall.id, legacy.id);
    assert.equal(await s.getBlob('photos', legacy.id), null);
    await assert.rejects(s.getBlob('photos', '../users'), /bad blob key/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const PG = process.env.TEST_DATABASE_URL;
test('PostgreSQL: blobs are read on demand, and indexes follow changes that arrive from another instance', { skip: !PG && 'set TEST_DATABASE_URL to run' }, async () => {
  const a = new PgStore({ pg: new PgClient(PG), instance: `a${Date.now()}`, pollMs: 60_000 });
  const b = new PgStore({ pg: new PgClient(PG), instance: `b${Date.now()}`, pollMs: 60_000 });
  try {
    await a.ready(); await b.ready();
    const id = `t${Date.now()}`;
    const write = a.putBlob('photos', id, 'data:image/jpeg;base64,QUJD');
    assert.equal(await a.getBlob('photos', id), 'data:image/jpeg;base64,QUJD');   // readable before the write lands
    await write;
    assert.equal(await b.getBlob('photos', id), 'data:image/jpeg;base64,QUJD');   // another instance reads it from PostgreSQL
    await a.removeBlob('photos', id);
    assert.equal(await b.getBlob('photos', id), null);

    b.index('tablets', 'family', (t) => t.familyId);
    a.put('tablets', id, { id, familyId: `f${id}` });
    await a.flush();
    await b.catchUp();
    assert.deepEqual(ids(b.by('tablets', 'family', `f${id}`)), [id]);
    a.remove('tablets', id);
    await a.flush();
    await b.catchUp();
    assert.deepEqual(b.by('tablets', 'family', `f${id}`), []);
  } finally { await a.close(); await b.close(); }
});
