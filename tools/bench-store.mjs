// How long do the request-path lookups take once there is real data? (docs/CLUSTER.md, 大集合)
//   node tools/bench-store.mjs --users 100000
// Seeds an in-memory store with N users and proportional halls / tablets / wishes / lamps / orders,
// then times the calls a single request makes. Nothing is written to disk.
import { JsonStore } from '../server/store/jsonStore.js';
import { JsonLedger } from '../server/store/ledger.js';
import { AncestorService } from '../server/domain/ancestors.js';
import { OfferingService } from '../server/domain/offerings.js';
import { LampService } from '../server/domain/lamps.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
const N = arg('users', 100_000);
const DAY = 86400000, now = Date.now();

const store = new JsonStore(null);
const anc = new AncestorService({ store, tz: 'Asia/Taipei', hotline: {} });
const offerings = new OfferingService({ store, tz: 'Asia/Taipei', hotline: {} });
const lamps = new LampService({ store, hotline: {} });
const ledger = new JsonLedger(store);

const t0 = performance.now();
const heap0 = process.memoryUsage().heapUsed;
for (let i = 0; i < N; i++) {
  const id = `u${i}`;
  store.put('users', id, { id, name: `居士${i}`, createdAt: now - i * 1000, mood: null, practice: { merit: i % 500, minutes: i % 900, streak: i % 30, days: {}, last: '2026-11-12' } });
  store.put('tokens', `t${i}`, { userId: id, createdAt: now });
  if (i % 5 === 0) {                                   // one hall per five people, three tablets each, two members
    const fid = `f${i}`;
    store.put('families', fid, { id: fid, ownerId: id, name: '王家', invite: `inv${i}`, createdAt: now, members: [{ userId: id, name: 'a', joinedAt: now }, { userId: `u${i + 1}`, name: 'b', joinedAt: now }] });
    for (let k = 0; k < 3; k++) store.put('tablets', `tb${i}_${k}`, { id: `tb${i}_${k}`, familyId: fid, createdBy: id, createdAt: now, order: k, name: '王大明', relation: '祖父', epitaph: '', died: { date: '2019-11-12', lunar: false }, born: null, notes: [], photo: null, photoV: 0 });
  }
  if (i % 2 === 0) store.put('wishes', `w${i}`, { id: `w${i}`, templeId: 'main', userId: id, name: null, text: '願家人平安健康', rejoice: 0, visibility: 'public', createdAt: now - i * 500 });
  if (i % 4 === 0) {                                   // most lamps on record have long gone out
    const lit = i % 40 === 0;
    store.put('lamps', `l${i}`, { id: `l${i}`, cardId: i % 8 === 0 ? `c${i}` : null, templeId: 'main', userId: id, fromName: 'a', kind: 'guangming', forOther: false, forName: '王小明', wish: '平安', wishPublic: true, crisis: false, litAt: now - 3 * DAY, expiresAt: lit ? now + 4 * DAY : now - 30 * DAY, renewed: 0 });
  }
  if (i % 20 === 0) store.put('orders', `o${i}`, { id: `o${i}`, userId: id, sku: 'incense_high_10', amount: 12000, currency: 'TWD', status: 'paid', provider: 'stripe', providerRef: 'pi', target: null, createdAt: now, paidAt: now, refundedAt: null, granted: true });
}
lamps.archive?.(now);
globalThis.gc?.();
const seedMs = performance.now() - t0;
const heapMb = (process.memoryUsage().heapUsed - heap0) / 1048576;

const user = { id: `u${Math.floor(N / 2 / 5) * 5}`, name: 'x' };
const hallId = `f${user.id.slice(1)}`;
const time = async (label, fn, runs = 20) => {
  await fn();
  const s = performance.now();
  for (let i = 0; i < runs; i++) await fn();
  return [label, (performance.now() - s) / runs];
};
const rows = [
  await time('祖先堂：我的家堂（每次進殿）', () => anc.hallsOf(user)),
  await time('祖先堂：打開家堂（靈位列表）', () => anc.tablets(hallId)),
  await time('祖先堂：憑邀請連結找家堂', () => anc.invitePreview(`inv${user.id.slice(1)}`)),
  await time('祈願牆：最新 60 塊', () => offerings.wall('main')),
  await time('燈牆：這座寺亮著的燈', () => lamps.active('main', now)),
  await time('我的燈', () => lamps.mine(user.id, now)),
  await time('祈福卡：憑卡號找燈', () => lamps.card(`c${Math.floor(N / 2 / 8) * 8}`, now)),
  await time('供養：24 小時內已消費', () => ledger.paidSince(user.id, 'TWD', now - DAY)),
];
console.log(`\n${N.toLocaleString()} 位用戶 · ${(N / 5 * 3).toLocaleString()} 個靈位 · ${(N / 2).toLocaleString()} 塊祈願牌 · ${(N / 4).toLocaleString()} 盞燈（建立 ${Math.round(seedMs)} ms，佔記憶體約 ${Math.round(heapMb)} MB）\n`);
for (const [label, ms] of rows) console.log(`  ${ms < 0.01 ? ms.toFixed(4) : ms.toFixed(2).padStart(8)} ms  ${label}`);
console.log(`\n  一位用戶進殿到打開家堂，這幾步合計 ${rows.reduce((n, r) => n + r[1], 0).toFixed(2)} ms（伺服器是單線程：這段時間裡其他人都在等）`);
