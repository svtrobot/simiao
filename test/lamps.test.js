import test from 'node:test';
import assert from 'node:assert/strict';
import { LampService, maskName, LAMP_DAYS } from '../server/domain/lamps.js';
import { JsonStore } from '../server/store/jsonStore.js';
import { REGIONS } from '../server/config.js';
import { startApp } from './helpers.js';

const DAY = 86400000;
const user = (id = 'u1') => ({ id, name: '清風居士' });

test('public lamp wall masks names; owner and card see them in full', () => {
  assert.equal(maskName('王小明'), '王○明');
  assert.equal(maskName('陳美'), '陳○');
  assert.equal(maskName('歐陽靜文'), '歐○○文');
  const svc = new LampService({ store: new JsonStore(null), hotline: REGIONS.tw.hotline });
  const { lamp } = svc.light(user(), 'main', 'ritual', { kind: 'yaoshi', forOther: true, forName: '王小明', wish: '早日康復' });
  const [wall] = svc.active('main').map((l) => svc.publicView(l));
  assert.equal(wall.name, '王○明');
  assert.equal(wall.wish, '早日康復');
  assert.equal('userId' in wall, false);
  assert.equal(lamp.forName, '王小明');
  assert.equal(svc.card(lamp.cardId).forName, '王小明');
});

test('kinds follow the compliance mode; at most three lamps lit at once', () => {
  const svc = new LampService({ store: new JsonStore(null), hotline: REGIONS.tw.hotline });
  assert.throws(() => svc.light(user(), 'main', 'cultural', { kind: 'yaoshi' }), /invalid_kind/);
  svc.light(user(), 'main', 'cultural', { kind: 'qifu' });
  svc.light(user(), 'main', 'ritual', { kind: 'guangming' });
  svc.light(user(), 'main', 'ritual', { kind: 'changming', forOther: true, forName: '外婆' });
  assert.throws(() => svc.light(user(), 'main', 'ritual', { kind: 'guangming' }), (e) => e.code === 'lamp_limit');
  assert.throws(() => svc.light(user('u2'), 'main', 'ritual', { kind: 'guangming', forOther: true }), /name_required/);
  assert.throws(() => svc.light(user('u2'), 'main', 'ritual', { kind: 'guangming', wish: '加line詳談' }), /lamp_rejected/);
});

test('a lamp with a self-harm signal stays lit but its wish is kept private (8.4)', () => {
  const svc = new LampService({ store: new JsonStore(null), hotline: REGIONS.tw.hotline });
  const out = svc.light(user(), 'main', 'ritual', { kind: 'guangming', forOther: true, forName: '小美', wish: '我不想活了' });
  assert.ok(out.support?.phone);
  assert.equal(svc.publicView(svc.active('main')[0]).wish, null);
  assert.equal(svc.card(out.lamp.cardId).wish, null);
});

test('lamps go out after seven days and can only be renewed in the last two', () => {
  const svc = new LampService({ store: new JsonStore(null), hotline: REGIONS.tw.hotline });
  const t0 = Date.UTC(2026, 10, 1);
  const { lamp } = svc.light(user(), 'main', 'ritual', { kind: 'guangming' }, t0);
  assert.throws(() => svc.renew(user(), lamp.id, t0 + DAY), (e) => e.code === 'too_early');
  const renewed = svc.renew(user(), lamp.id, t0 + (LAMP_DAYS - 1) * DAY);
  assert.equal(renewed.expiresAt, t0 + 2 * LAMP_DAYS * DAY);
  assert.equal(svc.count('main', t0 + 2 * LAMP_DAYS * DAY + 1), 0);
  assert.throws(() => svc.renew(user('other'), lamp.id, t0), /not_found/);
});

test('HTTP: lighting for someone else earns merit and a card; for yourself it does not', async () => {
  const h = await startApp();
  try {
    const s = await h.session();
    const self = await h.api('POST', '/api/temples/main/lamps', { kind: 'guangming', wish: '前路光明' }, s.token);
    assert.equal(self.status, 200);
    assert.equal(self.body.merit, 0);
    assert.equal(self.body.lamp.cardId, null);
    const other = await h.api('POST', '/api/temples/main/lamps', { kind: 'yaoshi', forOther: true, forName: '林阿嬤', wish: '身體安康' }, s.token);
    assert.equal(other.body.merit, 2);
    const card = await h.api('GET', `/api/cards/${other.body.lamp.cardId}`);
    assert.equal(card.body.forName, '林阿嬤');
    assert.equal(card.body.temple.slug, 'main');
    const wall = await h.api('GET', '/api/temples/main/lamps', null, s.token);
    assert.deepEqual(wall.body.kinds, ['guangming', 'yaoshi', 'changming']);
    assert.equal(wall.body.lamps.length, 2);
    assert.ok(wall.body.lamps.every((l) => l.mine));
    assert.equal(wall.body.mine.length, 2);
    const anon = await h.api('GET', '/api/temples/main/lamps');
    assert.ok(anon.body.lamps.every((l) => !l.mine && l.name !== '林阿嬤'));
  } finally { await h.close(); }
});

test('HTTP: mainland deployment only offers the plain blessing lamp', async () => {
  const h = await startApp({ region: 'cn' });
  try {
    const s = await h.session();
    const wall = await h.api('GET', '/api/temples/main/lamps');
    assert.deepEqual(wall.body.kinds, ['qifu']);
    const bad = await h.api('POST', '/api/temples/main/lamps', { kind: 'yaoshi' }, s.token);
    assert.equal(bad.status, 422);
    const ok = await h.api('POST', '/api/temples/main/lamps', { kind: 'qifu' }, s.token);
    assert.equal(ok.status, 200);
  } finally { await h.close(); }
});
