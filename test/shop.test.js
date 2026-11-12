import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { validateCatalog } from '../server/domain/shop.js';
import { stripe, verifyStripeSignature } from '../server/domain/payments.js';
import { PgLedger } from '../server/store/ledger.js';
import { PgClient } from '../server/store/pg.js';
import { startApp, sleep } from './helpers.js';

const catalog = JSON.parse(fs.readFileSync('content/shop/catalog.json', 'utf8'));
const SANDBOX = { payments: { provider: 'sandbox' } };

test('the catalog sells ceremony only: no merit, no chance, no promises', () => {
  assert.deepEqual(validateCatalog(catalog), []);
  const sku = catalog.skus[0];
  const bad = (patch) => validateCatalog({ skus: [{ ...sku, ...patch }] }).join('\n');
  assert.match(bad({ merit: 10 }), /never grant merit/);
  assert.match(bad({ pool: ['a', 'b'], chance: 0.1 }), /random contents/);       // 不做抽卡
  assert.match(bad({ name: { 'zh-Hant': '消災高香' } }), /prohibited marketing/);
  assert.match(bad({ desc: { 'zh-Hant': '保證靈驗' } }), /prohibited marketing/);
  assert.match(bad({ price: { TWD: 12.5 } }), /positive integers/);
  assert.match(bad({ grants: { incense_high: 0 } }), /fixed positive counts/);
});

test('buying and using paid incense never changes merit; free incense still does', async () => {
  const h = await startApp(SANDBOX);
  try {
    const me = await h.session();
    let r = await h.api('GET', '/api/shop?t=main', null, me.token);
    assert.equal(r.body.enabled, true);
    assert.equal(r.body.currency, 'TWD');
    assert.ok(r.body.skus.some((s) => s.id === 'incense_high_10' && s.price === 12000));
    r = await h.api('POST', '/api/shop/orders', { sku: 'incense_high_10' }, me.token);
    assert.equal(r.body.checkout.kind, 'sandbox');
    const id = r.body.order.id;
    // someone else cannot pay or read my order
    const other = await h.session();
    assert.equal((await h.api('POST', `/api/shop/sandbox/${id}/pay`, {}, other.token)).status, 404);
    r = await h.api('POST', `/api/shop/sandbox/${id}/pay`, {}, me.token);
    assert.equal(r.body.order.status, 'paid');
    assert.equal(r.body.bag.incense_high, 10);
    assert.equal(r.body.me.merit, 0);                       // 功德買不到
    r = await h.api('POST', `/api/shop/sandbox/${id}/pay`, {}, me.token); // a retry grants nothing more
    assert.equal(r.body.bag.incense_high, 10);

    const c = await h.connect(me.token);
    await c.wait((m) => m.t === 'welcome');
    c.send({ t: 'rit', k: 'incense', i: 'incense_high' });
    const bag = await c.wait((m) => m.t === 'bag');
    assert.equal(bag.bag.incense_high, 9);
    const tick = await c.wait((m) => m.t === 'tick' && m.e.some((e) => e.k === 'incense'));
    assert.equal(tick.e.find((e) => e.k === 'incense').item, 'incense_high');
    assert.equal((await h.api('GET', '/api/me', null, me.token)).body.merit, 0);
    // something not in the bag is refused
    c.send({ t: 'rit', k: 'incense', i: 'incense_dragon' });
    assert.equal((await c.wait((m) => m.t === 'err')).code, 'no_item');
    // the three free sticks a day still earn merit as before
    await sleep(50);
    c.send({ t: 'rit', k: 'incense' });
    assert.equal((await c.wait((m) => m.t === 'merit')).gained, 3);
    c.close();
  } finally { await h.close(); }
});

test('targets, paper from the bag, the daily cap, and where the shop is closed', async () => {
  const h = await startApp(SANDBOX);
  try {
    const me = await h.session(), other = await h.session();
    const buy = async (sku, target, token = me.token) => {
      const r = await h.api('POST', '/api/shop/orders', { sku, target }, token);
      if (r.status !== 200) return r;
      return h.api('POST', `/api/shop/sandbox/${r.body.order.id}/pay`, {}, token);
    };
    // 續燈: only my own lit lamp
    const lamp = (await h.api('POST', '/api/temples/main/lamps', { kind: 'guangming', forName: '我' }, me.token)).body.lamp;
    assert.equal((await buy('lamp_month', { lampId: lamp.id }, other.token)).status, 404);
    assert.equal((await buy('lamp_month', { lampId: lamp.id })).status, 200);
    const mine = (await h.api('GET', '/api/temples/main/lamps', null, me.token)).body.mine[0];
    assert.ok(mine.expiresAt - lamp.expiresAt >= 30 * 86400000 - 1000);
    // 描金靈位 and 紙紮
    const hall = (await h.api('POST', '/api/ancestors?t=main', { name: '王家' }, me.token)).body;
    const tb = (await h.api('POST', `/api/ancestors/${hall.id}/tablets`, { name: '王大明', died: { date: '2019-11-12' } }, me.token)).body;
    let r = await h.api('POST', `/api/ancestors/${hall.id}/tablets/${tb.id}/burn?t=main`, { kind: 'house', n: 1 }, me.token);
    assert.equal(r.status, 409);                                    // nothing in the bag yet
    assert.equal((await buy('paper_set')).body.bag.paper_house, 1);
    r = await h.api('POST', `/api/ancestors/${hall.id}/tablets/${tb.id}/burn?t=main`, { kind: 'house', n: 1 }, me.token);
    assert.deepEqual([r.body.burned.house, r.body.bag.paper_house, r.body.bag.paper_clothes], [1, 0, 2]);
    assert.equal((await buy('tablet_permanent', { hallId: hall.id, tabletId: tb.id })).status, 200);
    r = await h.api('GET', `/api/ancestors/${hall.id}?t=main`, null, me.token);
    assert.equal(r.body.tablets[0].permanent, true);
    assert.equal((await buy('tablet_permanent', { hallId: hall.id, tabletId: tb.id })).status, 404); // already done
    // NT$600 in 24 h: 30 + 90 + 300 so far; another 300 goes over
    r = await h.api('POST', '/api/shop/orders', { sku: 'tablet_permanent', target: { hallId: hall.id, tabletId: 'x' } }, me.token);
    assert.equal(r.status, 404);
    r = await h.api('POST', '/api/shop/orders', { sku: 'incense_dragon_5' }, me.token);
    assert.equal(r.status, 200);                                    // 150 → 570 once paid
    await h.api('POST', `/api/shop/sandbox/${r.body.order.id}/pay`, {}, me.token);
    r = await h.api('POST', '/api/shop/orders', { sku: 'paper_clothes_10' }, me.token);
    assert.equal(r.status, 429);
    assert.equal(r.body.error, 'daily_spend_cap');
    assert.equal((await h.api('GET', '/api/me', null, me.token)).body.merit, 0);
    assert.equal((await h.api('GET', '/api/shop/orders', null, me.token)).body.orders.filter((o) => o.status === 'paid').length, 4);
  } finally { await h.close(); }

  const off = await startApp();          // no PAYMENTS: prices are shown, nothing can be bought
  try {
    const { token } = await off.session();
    assert.equal((await off.api('GET', '/api/shop', null, token)).body.enabled, false);
    assert.equal((await off.api('POST', '/api/shop/orders', { sku: 'incense_high_10' }, token)).status, 403);
  } finally { await off.close(); }
  const cn = await startApp({ region: 'cn', ...SANDBOX });   // mainland: closed even with a provider configured
  try {
    const { token } = await cn.session();
    const r = await cn.api('GET', '/api/shop', null, token);
    assert.equal(r.body.enabled, false);
    assert.equal(r.body.skus.length, 0);
  } finally { await cn.close(); }
});

test('Stripe: signatures are checked, a paid webhook grants once, a refund takes it back', async () => {
  const secret = 'whsec_test', now = Date.now();
  const sign = (body, t = Math.floor(now / 1000), key = secret) => `t=${t},v1=${crypto.createHmac('sha256', key).update(`${t}.${body}`).digest('hex')}`;
  assert.doesNotThrow(() => verifyStripeSignature('{"a":1}', sign('{"a":1}'), secret, now));
  assert.throws(() => verifyStripeSignature('{"a":2}', sign('{"a":1}'), secret, now), /bad_signature/);
  assert.throws(() => verifyStripeSignature('{"a":1}', sign('{"a":1}', undefined, 'other'), secret, now), /bad_signature/);
  assert.throws(() => verifyStripeSignature('{"a":1}', sign('{"a":1}', Math.floor(now / 1000) - 3600), secret, now), /stale_signature/);
  assert.throws(() => verifyStripeSignature('{"a":1}', '', secret, now), /bad_signature/);

  const h = await startApp({ payments: { provider: 'stripe', stripeSecretKey: 'sk_test_x', stripeWebhookSecret: secret } });
  try {
    const sent = [];
    h.app.ctx.shop.provider = stripe({
      secretKey: 'sk_test_x', webhookSecret: secret,
      fetchImpl: async (url, init) => { sent.push({ url, init }); return { ok: true, json: async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }) }; },
    });
    const me = await h.session();
    let r = await h.api('POST', '/api/shop/orders', { sku: 'incense_high_10' }, me.token);
    assert.equal(r.body.checkout.url, 'https://checkout.stripe.com/c/pay/cs_test_1');
    const id = r.body.order.id;
    const form = new URLSearchParams(sent[0].init.body);
    assert.equal(sent[0].url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(sent[0].init.headers.Authorization, 'Bearer sk_test_x');
    assert.equal(form.get('client_reference_id'), id);
    assert.equal(form.get('line_items[0][price_data][unit_amount]'), '12000');
    assert.equal(form.get('line_items[0][price_data][currency]'), 'twd');
    assert.match(form.get('success_url'), new RegExp(`/\\?paid=${id}$`));
    // the sandbox shortcut does not exist on a real-payment deployment
    assert.equal((await h.api('POST', `/api/shop/sandbox/${id}/pay`, {}, me.token)).status, 404);

    const post = (body, sig) => fetch(`${h.base}/api/pay/stripe/webhook`, { method: 'POST', headers: { 'Stripe-Signature': sig }, body });
    const paid = JSON.stringify({ type: 'checkout.session.completed', data: { object: { client_reference_id: id, payment_status: 'paid', payment_intent: 'pi_1' } } });
    assert.equal((await post(paid, 't=1,v1=00')).status, 400);              // forged
    assert.equal((await h.api('GET', `/api/shop/orders/${id}`, null, me.token)).body.order.status, 'pending');
    assert.equal((await post(paid, sign(paid))).status, 200);
    assert.equal((await post(paid, sign(paid))).status, 200);                 // Stripe retries: still granted once
    r = await h.api('GET', `/api/shop/orders/${id}`, null, me.token);
    assert.deepEqual([r.body.order.status, r.body.bag.incense_high], ['paid', 10]);
    const refund = JSON.stringify({ type: 'charge.refunded', data: { object: { id: 'ch_1', metadata: { order: id } } } });
    assert.equal((await post(refund, sign(refund))).status, 200);
    r = await h.api('GET', `/api/shop/orders/${id}`, null, me.token);
    assert.deepEqual([r.body.order.status, r.body.bag.incense_high], ['refunded', 0]);
  } finally { await h.close(); }
});

test('back office: orders are listed, a refund sends the money back first, then takes the items — once', async () => {
  // no admin token configured: the back office does not exist
  const closed = await startApp({ ...SANDBOX, adminToken: '' });
  try { assert.equal((await closed.api('GET', '/api/admin/orders', null, 'anything')).status, 401); } finally { await closed.close(); }

  const secret = 'whsec_test', ADMIN = 'admin-test-token';
  const h = await startApp({ adminToken: ADMIN, payments: { provider: 'stripe', stripeSecretKey: 'sk_test_x', stripeWebhookSecret: secret } });
  try {
    const sent = []; let refundOk = false;
    h.app.ctx.shop.provider = stripe({
      secretKey: 'sk_test_x', webhookSecret: secret,
      fetchImpl: async (url, init) => {
        sent.push({ url, init });
        if (url.endsWith('/refunds')) return refundOk ? { ok: true, json: async () => ({ id: 're_1' }) } : { ok: false, status: 402, json: async () => ({ error: { code: 'insufficient_funds' } }) };
        return { ok: true, json: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }) };
      },
    });
    const me = await h.session();
    const sign = (body) => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`; };
    const pay = async (sku, pi) => {
      const id = (await h.api('POST', '/api/shop/orders', { sku }, me.token)).body.order.id;
      const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { client_reference_id: id, payment_status: 'paid', payment_intent: pi } } });
      await fetch(`${h.base}/api/pay/stripe/webhook`, { method: 'POST', headers: { 'Stripe-Signature': sign(body) }, body });
      return id;
    };
    const a = await pay('incense_high_10', 'pi_a');
    const pending = (await h.api('POST', '/api/shop/orders', { sku: 'paper_set' }, me.token)).body.order.id;

    // a visitor's token is not an admin token
    assert.equal((await h.api('GET', '/api/admin/orders', null, me.token)).status, 401);
    assert.equal((await h.api('POST', `/api/admin/orders/${a}/refund`, {}, me.token)).status, 401);

    let r = await h.api('GET', '/api/admin/orders', null, ADMIN);
    assert.equal(r.body.provider, 'stripe');
    assert.deepEqual(r.body.orders.map((o) => [o.id, o.status]).sort(), [[a, 'paid'], [pending, 'pending']].sort());
    assert.deepEqual(r.body.summary.day, [{ currency: 'TWD', status: 'paid', n: 1, amount: 12000 }]);
    const row = r.body.orders.find((o) => o.id === a);
    assert.deepEqual([typeof row.userId, row.providerRef, row.granted], ['string', 'pi_a', true]);
    assert.equal((await h.api('GET', '/api/admin/orders?status=paid', null, ADMIN)).body.orders.length, 1);
    assert.equal((await h.api('GET', '/api/admin/orders?user=nobody', null, ADMIN)).body.orders.length, 0);
    assert.equal((await h.api('GET', '/api/admin/orders?status=weird', null, ADMIN)).status, 422);

    // Stripe refuses: nothing changes on our side
    r = await h.api('POST', `/api/admin/orders/${a}/refund`, { reason: '客人買錯' }, ADMIN);
    assert.equal(r.status, 502);
    r = await h.api('GET', `/api/shop/orders/${a}`, null, me.token);
    assert.deepEqual([r.body.order.status, r.body.bag.incense_high], ['paid', 10]);

    refundOk = true;
    r = await h.api('POST', `/api/admin/orders/${a}/refund`, { reason: '客人買錯' }, ADMIN);
    assert.deepEqual([r.status, r.body.order.status, r.body.order.refundReason], [200, 'refunded', '客人買錯']);
    const req = sent.filter((s) => s.url === 'https://api.stripe.com/v1/refunds').pop();
    assert.equal(new URLSearchParams(req.init.body).get('payment_intent'), 'pi_a');
    assert.equal(req.init.headers['Idempotency-Key'], `refund-${a}`);
    r = await h.api('GET', `/api/shop/orders/${a}`, null, me.token);
    assert.deepEqual([r.body.order.status, r.body.bag.incense_high], ['refunded', 0]);
    assert.equal((await h.api('GET', '/api/me', null, me.token)).body.merit, 0);

    // a second click, an unpaid order, an unknown order: all refused, and Stripe is not called again
    const calls = sent.length;
    assert.equal((await h.api('POST', `/api/admin/orders/${a}/refund`, {}, ADMIN)).status, 409);
    assert.equal((await h.api('POST', `/api/admin/orders/${pending}/refund`, {}, ADMIN)).status, 409);
    assert.equal((await h.api('POST', '/api/admin/orders/nope/refund', {}, ADMIN)).status, 404);
    assert.equal(sent.length, calls);
    // Stripe's own refund notice arriving afterwards takes nothing more
    const note = JSON.stringify({ type: 'charge.refunded', data: { object: { id: 'ch_1', metadata: { order: a } } } });
    await fetch(`${h.base}/api/pay/stripe/webhook`, { method: 'POST', headers: { 'Stripe-Signature': sign(note) }, body: note });
    r = await h.api('GET', '/api/admin/orders?status=refunded', null, ADMIN);
    assert.deepEqual(r.body.summary.day, [{ currency: 'TWD', status: 'refunded', n: 1, amount: 12000 }]);
    // the refunded money no longer counts against the buyer's 24-hour cap
    assert.equal((await h.api('GET', '/api/shop?t=main', null, me.token)).body.cap.spent, 0);
  } finally { await h.close(); }
});

const PG = process.env.TEST_DATABASE_URL;
test('PostgreSQL ledger: two servers racing to mark one order paid — only one wins, one grants', { skip: !PG && 'set TEST_DATABASE_URL to run' }, async () => {
  const a = new PgClient(PG), b = new PgClient(PG);
  try {
    const la = await new PgLedger(a).ready(), lb = new PgLedger(b);
    const id = `t${Date.now()}`;
    await la.create({ id, userId: 'u', sku: 'incense_high_10', amount: 12000, currency: 'TWD', provider: 'stripe', target: { lampId: 'x' }, createdAt: Date.now() });
    const paid = await Promise.all([la.markPaid(id, 'pi_a', Date.now()), lb.markPaid(id, 'pi_b', Date.now())]);
    assert.equal(paid.filter((r) => r.changed).length, 1);
    const claims = await Promise.all([la.claimGrant(id), lb.claimGrant(id), la.claimGrant(id)]);
    assert.equal(claims.filter(Boolean).length, 1);
    const o = await lb.get(id);
    assert.deepEqual([o.status, o.granted, o.amount, o.target.lampId], ['paid', true, 12000, 'x']);
    assert.equal(await la.paidSince('u', 'TWD', Date.now() - 60000) >= 12000, true);
    assert.ok((await la.list({ status: 'paid', userId: 'u', limit: 500 })).some((x) => x.id === id));
    assert.ok((await lb.totals(Date.now() - 60000)).some((t) => t.currency === 'TWD' && t.status === 'paid' && t.amount >= 12000));
    const back = await la.markRefunded(id, Date.now(), 'test');
    assert.deepEqual([back.changed, back.order.refundReason], [true, 'test']);
    assert.equal((await lb.markRefunded(id, Date.now())).changed, false);
    assert.equal((await lb.list({ status: 'refunded', userId: 'u', limit: 500 })).find((x) => x.id === id).refundReason, 'test');
  } finally { await a.close(); await b.close(); }
});
