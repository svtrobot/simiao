import test from 'node:test';
import assert from 'node:assert/strict';
import { AncestorService, upcoming, parseDeath, BURN_MS, BURN_BURST } from '../server/domain/ancestors.js';
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
const svc = () => new AncestorService({ store: mem(), tz: 'Asia/Taipei', hotline: { name: '1925' } });
const NOV10 = Date.parse('2026-11-10T04:00:00Z'); // noon in Taipei

test('anniversaries follow the calendar the family keeps', () => {
  // solar 忌日 on 11-12, lunar 忌日 on 十月初一 (寒衣節 is also 十月初一; 2026-11-09 has passed by the 10th)
  const solar = { id: 'a', died: parseDeath({ date: '2019-11-12' }, '2026-11-10'), born: '1932-11-20' };
  const lunar = { id: 'b', died: parseDeath({ date: '2015-10-1', lunar: true }, '2026-11-10'), born: '1940' };
  const ev = upcoming([solar, lunar], '2026-11-10', { days: 30, tz: 'Asia/Taipei' });
  const death = ev.find((e) => e.tabletId === 'a' && e.kind === 'death');
  assert.deepEqual([death.date, death.years, death.inDays], ['2026-11-12', 7, 2]);
  assert.equal(ev.find((e) => e.tabletId === 'a' && e.kind === 'birth').years, 94); // 冥誕
  assert.ok(!ev.some((e) => e.tabletId === 'b' && e.kind === 'birth'), 'year-only birth has no 冥誕');
  // the lunar 十月初一 of 2027 is outside 30 days
  assert.ok(!ev.some((e) => e.tabletId === 'b'));
  const next = upcoming([lunar], '2027-10-20', { days: 30, tz: 'Asia/Taipei' });
  const l = next.find((e) => e.kind === 'death');
  assert.equal(l.years, 12);
  assert.ok(next.some((e) => e.kind === 'hanyi' && e.date === l.date), '寒衣節 is the same day');
  // 清明 2027 is on April 5
  assert.equal(upcoming([solar], '2027-03-20', { days: 30, tz: 'Asia/Taipei' }).find((e) => e.kind === 'qingming').date, '2027-04-05');
  // a 29 Feb death is remembered on 28 Feb in common years
  const leap = { id: 'c', died: parseDeath({ date: '2020-02-29' }, '2026-11-10') };
  assert.equal(upcoming([leap], '2027-02-01', { days: 30, tz: 'Asia/Taipei' })[0].date, '2027-02-28');
  assert.throws(() => parseDeath({ date: '2027-01-01' }, '2026-11-10'), /invalid_death_date/);
  assert.throws(() => parseDeath({ date: '2019-02-30' }, '2026-11-10'), /invalid_death_date/);
});

test('family halls are private: only members see tablets; invite link joins', () => {
  const s = svc();
  const owner = { id: 'o', name: '慧明' }, kin = { id: 'k', name: '靜安' }, stranger = { id: 's', name: '路人' };
  const f = s.create(owner, { name: '王家' }, NOV10);
  const tb = s.addTablet(owner, f.id, { name: '王大明', relation: '祖父', died: { date: '2019-11-12' } }, NOV10);
  assert.throws(() => s.view(stranger, f.id, 'ritual', NOV10), /not_found/);
  assert.throws(() => s.offer(stranger, f.id, tb.id, 'flower', 'ritual', NOV10), /not_found/);
  const pre = s.invitePreview(f.invite);
  assert.deepEqual(pre, { name: '王家', ownerName: '慧明', members: 1, tablets: 1 }); // no names of the departed
  s.join(kin, f.invite, NOV10);
  const v = s.view(kin, f.id, 'ritual', NOV10);
  assert.equal(v.tablets[0].name, '王大明');
  assert.equal(v.tablets[0].canEdit, false);
  assert.throws(() => s.removeTablet(kin, f.id, tb.id), /not_yours/);
  assert.equal(v.upcoming.find((e) => e.kind === 'death').inDays, 2);
  assert.equal(s.reminders(kin, NOV10)[0].name, '王大明');
  // a new link cuts the old one
  const old = f.invite;
  s.resetInvite(owner, f.id);
  assert.throws(() => s.join(stranger, old, NOV10), /invite_not_found/);
  // owner removes a member; the owner cannot leave
  s.removeMember(owner, f.id, kin.id);
  assert.throws(() => s.view(kin, f.id, 'ritual', NOV10), /not_found/);
  assert.throws(() => s.removeMember(owner, f.id), /owner_stays/);
});

test('offerings: once per kind per day, incense and paper only in ritual mode, notes keep crisis private', () => {
  const s = svc();
  const u = { id: 'u', name: '慧明' };
  const f = s.create(u, {}, NOV10);
  const tb = s.addTablet(u, f.id, { name: '陳美', died: { date: '2001-03-03' } }, NOV10);
  assert.equal(s.offer(u, f.id, tb.id, 'flower', 'ritual', NOV10).first, true);
  assert.equal(s.offer(u, f.id, tb.id, 'flower', 'ritual', NOV10).already, true);
  assert.equal(s.offer(u, f.id, tb.id, 'incense', 'ritual', NOV10).first, false);
  assert.throws(() => s.offer(u, f.id, tb.id, 'incense', 'cultural', NOV10), /invalid_offering/);
  // tomorrow the altar is fresh again
  assert.equal(s.offer(u, f.id, tb.id, 'flower', 'ritual', NOV10 + 86400000).first, true);

  assert.throws(() => s.burn(u, f.id, tb.id, { kind: 'silver', n: 1 }, 'cultural', NOV10), /not_in_this_mode/);
  let now = NOV10;
  assert.equal(s.burn(u, f.id, tb.id, { kind: 'silver', n: 4 }, 'ritual', now).counted, 4);
  assert.throws(() => s.burn(u, f.id, tb.id, { kind: 'silver', n: BURN_BURST }, 'ritual', now + 10), /too_fast/);
  now += BURN_MS * 3;
  s.burn(u, f.id, tb.id, { kind: 'ingot', n: 2 }, 'ritual', now);
  assert.deepEqual(s.tabletView(s.store.get('tablets', tb.id), u, f, now).today.burned, { silver: 4, ingot: 2 });

  const r = s.note(u, f.id, tb.id, '媽，我好想你，有時候真的不想活了', now);
  assert.ok(r.support && r.note.private);
  const other = { id: 'x', name: '家人' };
  s.join(other, f.invite, now);
  assert.equal(s.view(other, f.id, 'ritual', now).tablets[0].notes.length, 0);
  assert.equal(s.view(u, f.id, 'ritual', now).tablets[0].notes.length, 1);
  assert.throws(() => s.note(u, f.id, tb.id, '加line 12345678', now), /text_rejected/);
});

test('ancestor hall over HTTP: merit once per tablet per day, paper refused in cn', async () => {
  const h = await startApp();
  try {
    const { token } = await h.session();
    let r = await h.api('POST', '/api/ancestors?t=main', { name: '林家' }, token);
    assert.equal(r.status, 200);
    const hall = r.body;
    assert.equal(hall.paper.length, 3);
    r = await h.api('POST', `/api/ancestors/${hall.id}/tablets`, {
      name: '林阿嬤', relation: '祖母', died: { date: '2010-8-15', lunar: true }, photo: 'data:image/jpeg;base64,AAAA',
    }, token);
    assert.equal(r.status, 200);
    const tb = r.body;
    assert.equal(tb.died.lunar, true);
    assert.ok(tb.photoV > 0);
    r = await h.api('GET', `/api/ancestors/${hall.id}/tablets/${tb.id}/photo`, null, token);
    assert.equal(r.body.photo, 'data:image/jpeg;base64,AAAA');
    r = await h.api('POST', `/api/ancestors/${hall.id}/tablets/${tb.id}/offer?t=main`, { kind: 'flower' }, token);
    assert.equal(r.body.merit, 2);
    r = await h.api('POST', `/api/ancestors/${hall.id}/tablets/${tb.id}/offer?t=main`, { kind: 'candle' }, token);
    assert.equal(r.body.merit, 0);
    r = await h.api('POST', `/api/ancestors/${hall.id}/tablets/${tb.id}/burn?t=main`, { kind: 'lotus', n: 2 }, token);
    assert.deepEqual(r.body.burned, { lotus: 2 });
    // someone without the invite gets nothing
    const other = await h.session();
    r = await h.api('GET', `/api/ancestors/${hall.id}`, null, other.token);
    assert.equal(r.status, 404);
    r = await h.api('GET', `/api/invites/${hall.invite}`);
    assert.equal(r.body.name, '林家');
    r = await h.api('POST', `/api/invites/${hall.invite}/join`, {}, other.token);
    assert.equal(r.body.id, hall.id);
    r = await h.api('GET', '/api/ancestors?t=main', null, other.token);
    assert.equal(r.body.halls[0].tablets, 1);
  } finally { await h.close(); }

  const cn = await startApp({ region: 'cn' });
  try {
    const { token } = await cn.session();
    const hall = (await cn.api('POST', '/api/ancestors', {}, token)).body;
    assert.deepEqual(hall.paper, []);
    assert.deepEqual(hall.offerings, ['flower', 'fruit', 'candle']);
    const tb = (await cn.api('POST', `/api/ancestors/${hall.id}/tablets`, { name: '张三', died: { date: '2020-01-01' } }, token)).body;
    const r = await cn.api('POST', `/api/ancestors/${hall.id}/tablets/${tb.id}/burn`, { kind: 'silver', n: 1 }, token);
    assert.equal(r.status, 403);
  } finally { await cn.close(); }
});
