import test from 'node:test';
import assert from 'node:assert/strict';
import { Festivals } from '../server/domain/festival.js';
import { AncestorService } from '../server/domain/ancestors.js';
import { startApp } from './helpers.js';

const mem = () => {
  const cols = new Map();
  const col = (c) => (cols.has(c) || cols.set(c, new Map()), cols.get(c));
  return {
    get: (c, id) => col(c).get(id) ?? null,
    list: (c, f = () => true) => [...col(c).values()].filter(f),
    put: (c, id, d) => (col(c).set(id, d), d),
    remove: (c, id) => col(c).delete(id),
  };
};
const at = (d) => Date.parse(`${d}T04:00:00Z`); // noon in Taipei
const fests = () => new Festivals({ contentDir: 'content', tz: 'Asia/Taipei' });

test('清明: warm-up three weeks ahead, open ten days either side, closed otherwise', () => {
  const f = fests();
  assert.equal(f.dateOf(f.list[0], 2027), '2027-04-05');
  assert.equal(f.current(at('2026-11-13')), null);
  assert.equal(f.current(at('2027-03-14')), null);
  assert.deepEqual((({ phase, inDays, year }) => [phase, inDays, year])(f.current(at('2027-03-15'))), ['warmup', 21, 2027]);
  assert.equal(f.current(at('2027-03-25')).phase, 'warmup');
  assert.deepEqual((({ phase, inDays }) => [phase, inDays])(f.current(at('2027-03-26'))), ['open', 10]);
  assert.deepEqual((({ phase, inDays }) => [phase, inDays])(f.current(at('2027-04-05'))), ['open', 0]);
  assert.equal(f.current(at('2027-04-15')).phase, 'open');
  assert.equal(f.current(at('2027-04-16')), null);
});

test('祭掃: only in season, once per person per tablet, a card with no names on it', () => {
  const store = mem();
  const svc = new AncestorService({ store, tz: 'Asia/Taipei', hotline: { name: '1925' }, festivals: fests() });
  const a = { id: 'ua', name: '竹音居士' }, b = { id: 'ub', name: '靜葉居士' }, stranger = { id: 'ux', name: '路人' };
  const hall = svc.create(a, { name: '王家' }, at('2027-03-01'));
  svc.join(b, hall.invite, at('2027-03-01'));
  const t1 = svc.addTablet(a, hall.id, { name: '王大明', relation: '祖父', died: { date: '2019-11-12' } }, at('2027-03-01'));
  const t2 = svc.addTablet(a, hall.id, { name: '林秀英', relation: '祖母', died: { date: '2021-02-03' } }, at('2027-03-01'));

  // before the season: nothing to do yet, but the hall already knows 清明 is coming
  assert.throws(() => svc.sweep(a, hall.id, t1.id, at('2027-03-20')), /not_in_season/);
  assert.throws(() => svc.sweepCard(a, hall.id, at('2027-03-20')), /not_in_season/);
  assert.deepEqual((({ phase, swept, total }) => [phase, swept, total])(svc.view(a, hall.id, 'ritual', at('2027-03-20')).festival), ['warmup', 0, 2]);
  assert.equal(svc.view(a, hall.id, 'ritual', at('2026-11-13')).festival, null);

  const day = at('2027-04-05');
  assert.throws(() => svc.sweep(stranger, hall.id, t1.id, day), /not_found/);   // not family
  assert.throws(() => svc.sweepCard(a, hall.id, day), /nothing_swept/);
  let r = svc.sweep(a, hall.id, t1.id, day);
  assert.deepEqual([r.first, r.already], [true, false]);
  r = svc.sweep(a, hall.id, t1.id, day);
  assert.deepEqual([r.first, r.already], [false, true]);                        // again: nothing more
  assert.equal(svc.offer(a, hall.id, t1.id, 'flower', 'ritual', day).first, false); // already offered to him today → no second merit
  r = svc.sweep(b, hall.id, t1.id, day + 3600_000);
  assert.equal(r.first, true);                                                  // each family member sweeps for themselves
  assert.equal(svc.sweep(a, hall.id, t2.id, day + 86400_000).first, true);      // another day, another tablet

  let v = svc.view(a, hall.id, 'cultural', day + 86400_000);
  assert.deepEqual([v.festival.swept, v.festival.total, v.festival.mine], [2, 2, 2]);
  assert.deepEqual(v.tablets[0].swept, [{ name: '竹音居士', mine: true }, { name: '靜葉居士', mine: false }]);
  assert.equal(svc.view(b, hall.id, 'ritual', day).festival.mine, 1);
  assert.deepEqual(svc.festivalStats(day + 86400_000), { halls: 1, tablets: 2 });

  const { code } = svc.sweepCard(b, hall.id, day);
  assert.equal(svc.sweepCard(a, hall.id, day).code, code);                      // one card per hall per festival
  const card = svc.sweepCardView(code);
  assert.deepEqual(card, { festival: 'qingming', year: 2027, hallName: '王家', tablets: 2, people: 2 });
  assert.ok(!/王大明|林秀英|居士/.test(JSON.stringify(card)));                   // no one is named
  assert.throws(() => svc.sweepCardView('nope'), /not_found/);

  // the sprig is gone once the festival closes; next year starts clean
  assert.deepEqual(svc.view(a, hall.id, 'ritual', at('2027-04-20')).tablets[0].swept, []);
  const next = svc.view(a, hall.id, 'ritual', at('2028-04-04')).festival;
  assert.deepEqual([next.year, next.swept, next.card], [2028, 0, null]);
});

test('over HTTP: sweeping earns the once-a-day memorial merit, cultural mode included; the card page is public', async () => {
  const closed = await startApp();
  try {
    const me = await closed.session();
    const r = await closed.api('GET', '/api/festival');
    // (run during the real 清明 window this would be open; the preview flag below is what the test relies on)
    if (!r.body.festival) {
      const hall = (await closed.api('POST', '/api/ancestors?t=main', { name: '王家' }, me.token)).body;
      const tb = (await closed.api('POST', `/api/ancestors/${hall.id}/tablets`, { name: '王大明', died: { date: '2019-11-12' } }, me.token)).body;
      assert.equal((await closed.api('POST', `/api/ancestors/${hall.id}/tablets/${tb.id}/sweep?t=main`, {}, me.token)).status, 409);
    }
  } finally { await closed.close(); }

  for (const region of ['tw', 'cn']) {
    const h = await startApp({ region, festivalPreview: 'qingming' });
    try {
      const me = await h.session(), other = await h.session();
      assert.equal((await h.api('GET', '/api/festival')).body.festival.phase, 'open');
      const hall = (await h.api('POST', '/api/ancestors?t=main', { name: '王家' }, me.token)).body;
      assert.deepEqual([hall.festival.phase, hall.festival.total], ['open', 0]);
      const tb = (await h.api('POST', `/api/ancestors/${hall.id}/tablets`, { name: '王大明', died: { date: '2019-11-12' } }, me.token)).body;
      assert.equal((await h.api('POST', `/api/ancestors/${hall.id}/tablets/${tb.id}/sweep?t=main`, {}, other.token)).status, 404);
      let r = await h.api('POST', `/api/ancestors/${hall.id}/tablets/${tb.id}/sweep?t=main`, {}, me.token);
      assert.equal(r.status, 200);
      assert.ok(r.body.merit > 0);
      assert.deepEqual([r.body.tablet.swept.length, r.body.festival.swept, r.body.festival.total], [1, 1, 1]);
      const merit = r.body.me.merit;
      r = await h.api('POST', `/api/ancestors/${hall.id}/tablets/${tb.id}/sweep?t=main`, {}, me.token);
      assert.deepEqual([r.body.already, r.body.merit, r.body.me.merit], [true, 0, merit]);
      const code = (await h.api('POST', `/api/ancestors/${hall.id}/sweep-card`, {}, me.token)).body.code;
      r = await h.api('GET', `/api/sweeps/${code}`);                              // no token: anyone with the link
      assert.deepEqual([r.body.hallName, r.body.tablets, r.body.people, r.body.stats.halls], ['王家', 1, 1, 1]);
      assert.ok(!JSON.stringify(r.body).includes('王大明'));
      assert.equal((await h.api('GET', '/api/sweeps/unknown')).status, 404);
      assert.equal((await fetch(`${h.base}/q/${code}`)).status, 200);             // the landing page is the app shell
      assert.equal((await h.api('GET', '/api/admin/stats', null, 'test-admin')).body.festival.stats.tablets, 1);
    } finally { await h.close(); }
  }
});
