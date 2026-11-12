import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { REPORT_HOLD, REPORT_DAILY } from '../server/domain/moderation.js';

const ADMIN = 'test-admin';

test('檢舉: preset reasons, once per person, three people hold a wish until someone looks', async () => {
  const h = await startApp();
  try {
    const author = await h.session();
    const people = [];
    for (let i = 0; i < REPORT_HOLD; i++) people.push(await h.session());
    const wish = (await h.api('POST', '/api/temples/main/wishes', { text: '願家人平安健康', anonymous: false }, author.token)).body.wish;
    const wall = async (token) => (await h.api('GET', '/api/temples/main/wishes', null, token)).body;
    assert.equal((await wall(author.token))[0].mine, true);
    assert.equal((await wall(people[0].token))[0].mine, false);

    const report = (token, body) => h.api('POST', '/api/report', body, token);
    assert.equal((await report(null, { kind: 'wish', id: wish.id, reason: 'ad' })).status, 401);
    assert.equal((await report(people[0].token, { kind: 'wish', id: wish.id, reason: '他很壞' })).status, 422); // no free text
    assert.equal((await report(people[0].token, { kind: 'note', id: wish.id, reason: 'ad' })).status, 422);
    assert.equal((await report(people[0].token, { kind: 'wish', id: 'nope', reason: 'ad' })).status, 404);
    assert.equal((await report(author.token, { kind: 'wish', id: wish.id, reason: 'ad' })).status, 409);   // not your own

    assert.deepEqual((await report(people[0].token, { kind: 'wish', id: wish.id, reason: 'ad' })).body, { already: false });
    assert.deepEqual((await report(people[0].token, { kind: 'wish', id: wish.id, reason: 'abuse' })).body, { already: true });
    await report(people[1].token, { kind: 'wish', id: wish.id, reason: 'abuse' });
    assert.equal((await wall()).length, 1);                                  // two reports: still up
    await report(people[2].token, { kind: 'wish', id: wish.id, reason: 'abuse' });
    assert.equal((await wall()).length, 0);                                  // three: held
    assert.equal((await h.api('POST', `/api/wishes/${wish.id}/rejoice`, {}, people[0].token)).status, 404);

    // the back office sees it, with who wrote it and why it was reported
    assert.equal((await h.api('GET', '/api/admin/content', null, author.token)).status, 401);
    let r = await h.api('GET', '/api/admin/content?kind=wish&filter=reported', null, ADMIN);
    assert.equal(r.body.open, 1);
    assert.deepEqual((({ text, state, reports, reasons, authorId }) => [text, state, reports, reasons, authorId])(r.body.items[0]),
      ['願家人平安健康', 'held', 3, { ad: 1, abuse: 2 }, author.user.id]);

    // 保留: back on the wall, and more reports no longer take it down
    r = await h.api('POST', `/api/admin/content/wish/${wish.id}/restore`, {}, ADMIN);
    assert.equal(r.body.item.state, 'public');
    assert.equal((await wall()).length, 1);
    const late = await h.session();
    await report(late.token, { kind: 'wish', id: wish.id, reason: 'other' });
    assert.equal((await wall()).length, 1);
    assert.equal((await h.api('GET', '/api/admin/content?filter=reported', null, ADMIN)).body.items.length, 0);

    // 下架: gone for everyone; then it can be found under 已下架 and restored
    r = await h.api('POST', `/api/admin/content/wish/${wish.id}/hide`, { reason: '重複張貼' }, ADMIN);
    assert.deepEqual([r.body.item.state, r.body.item.removedReason], ['removed', '重複張貼']);
    assert.equal((await wall()).length, 0);
    assert.equal((await h.api('GET', '/api/admin/content?filter=hidden', null, ADMIN)).body.items.length, 1);
    assert.deepEqual((await h.api('GET', '/api/admin/modlog', null, ADMIN)).body.log.map((l) => l.action), ['hide', 'keep']);

    // a daily cap on how many reports one account can file
    const busy = await h.session();
    const ids = [];
    for (let i = 0; i <= REPORT_DAILY; i++) ids.push((await h.api('POST', '/api/temples/main/wishes', { text: `願一切順利 ${i}` }, author.token)).body.wish.id);
    for (let i = 0; i < REPORT_DAILY; i++) assert.equal((await report(busy.token, { kind: 'wish', id: ids[i], reason: 'other' })).status, 200);
    assert.equal((await report(busy.token, { kind: 'wish', id: ids[REPORT_DAILY], reason: 'other' })).status, 429);
  } finally { await h.close(); }
});

test('what the back office never sees: private wishes with a crisis signal, and family halls', async () => {
  const h = await startApp();
  try {
    const me = await h.session(), other = await h.session();
    const r = await h.api('POST', '/api/temples/main/wishes', { text: '我不想活了' }, me.token);
    assert.equal(r.body.wish.visibility, 'private');
    assert.ok(r.body.support);                                                // 規則 4：只回本人 + 熱線
    const hall = (await h.api('POST', '/api/ancestors?t=main', { name: '王家' }, me.token)).body;
    const tb = (await h.api('POST', `/api/ancestors/${hall.id}/tablets`, { name: '王大明', died: { date: '2019-11-12' } }, me.token)).body;
    await h.api('POST', `/api/ancestors/${hall.id}/tablets/${tb.id}/note`, { text: '爺爺我很想你' }, me.token);

    for (const filter of ['all', 'reported', 'hidden']) {
      const items = (await h.api('GET', `/api/admin/content?kind=wish&filter=${filter}`, null, ADMIN)).body.items;
      assert.equal(items.length, 0, filter);
    }
    // it cannot be reported, hidden or "restored" into public either
    assert.equal((await h.api('POST', '/api/report', { kind: 'wish', id: r.body.wish.id, reason: 'other' }, other.token)).status, 404);
    assert.equal((await h.api('POST', `/api/admin/content/wish/${r.body.wish.id}/hide`, {}, ADMIN)).status, 404);
    assert.equal((await h.api('POST', `/api/admin/content/wish/${r.body.wish.id}/restore`, {}, ADMIN)).status, 404);
    assert.equal((await h.api('GET', '/api/temples/main/wishes')).body.length, 0);

    const detail = (await h.api('GET', `/api/admin/users/${me.user.id}`, null, ADMIN)).body;
    assert.deepEqual([detail.wishes, detail.halls, detail.content.length], [0, 1, 0]);
    assert.ok(!/王大明|想你|不想活/.test(JSON.stringify(detail)));
    assert.ok(!/王大明|想你|不想活/.test(JSON.stringify((await h.api('GET', '/api/admin/users', null, ADMIN)).body)));
  } finally { await h.close(); }
});

test('禁言: no more wishes, lamps without words; practice and merit go on; lamps can be hidden without going out', async () => {
  const h = await startApp();
  try {
    const me = await h.session(), viewer = await h.session();
    await h.api('POST', '/api/temples/main/wishes', { text: '願考試順利', anonymous: false }, me.token);
    const lamp = (await h.api('POST', '/api/temples/main/lamps', { kind: 'guangming', forOther: true, forName: '陳小美', wish: '早日康復' }, me.token)).body.lamp;
    const lamps = async () => (await h.api('GET', '/api/temples/main/lamps', null, viewer.token)).body.lamps;
    assert.deepEqual((({ name, wish }) => [name, wish])((await lamps())[0]), ['陳○美', '早日康復']);

    // the lamp wall in the back office shows the same masked name the hall shows
    let r = await h.api('GET', '/api/admin/content?kind=lamp&filter=all', null, ADMIN);
    assert.equal(r.body.items[0].text, '陳○美「早日康復」');
    assert.ok(!JSON.stringify(r.body).includes('陳小美'));
    r = await h.api('POST', `/api/admin/content/lamp/${lamp.id}/hide`, { reason: '測試' }, ADMIN);
    assert.equal(r.body.item.state, 'removed');
    assert.deepEqual((({ name, wish }) => [name, wish])((await lamps())[0]), ['○○', null]);   // still burning, no words
    assert.equal((await h.api('GET', `/api/cards/${lamp.cardId}`)).body.wish, null);
    assert.equal((await h.api('GET', '/api/temples/main/lamps', null, me.token)).body.mine[0].hidden, true);
    await h.api('POST', `/api/admin/content/lamp/${lamp.id}/restore`, {}, ADMIN);
    assert.equal((await lamps())[0].wish, '早日康復');

    r = await h.api('GET', `/api/admin/users?q=${me.user.id}`, null, ADMIN);
    assert.deepEqual([r.body.users.length, r.body.users[0].wishes, r.body.users[0].lamps, r.body.users[0].muted], [1, 1, 1, null]);
    assert.equal((await h.api('GET', `/api/admin/users?q=${encodeURIComponent(me.user.name.slice(0, 2))}`, null, ADMIN)).body.users.some((u) => u.id === me.user.id), true);
    assert.equal((await h.api('POST', '/api/admin/users/nobody/mute', {}, ADMIN)).status, 404);
    assert.equal((await h.api('POST', `/api/admin/users/${me.user.id}/mute`, {}, me.token)).status, 401);

    r = await h.api('POST', `/api/admin/users/${me.user.id}/mute`, { reason: '洗版', hideAll: true }, ADMIN);
    assert.deepEqual([r.body.hidden, r.body.user.muted.reason], [2, '洗版']);
    assert.equal((await h.api('GET', '/api/temples/main/wishes')).body.length, 0);
    assert.equal((await lamps())[0].wish, null);
    r = await h.api('POST', '/api/temples/main/wishes', { text: '再掛一塊' }, me.token);
    assert.deepEqual([r.status, r.body.error], [403, 'muted']);
    assert.equal((await h.api('POST', '/api/report', { kind: 'lamp', id: lamp.id, reason: 'ad' }, me.token)).status, 403);
    // a lamp for themselves is still allowed; whatever they type is dropped
    r = await h.api('POST', '/api/temples/main/lamps', { kind: 'guangming', forOther: true, forName: '廣告', wish: '加我好友' }, me.token);
    assert.deepEqual([r.status, r.body.lamp.forName, r.body.lamp.wish, r.body.lamp.cardId], [200, me.user.name, '', null]);
    // practice goes on
    const c = await h.connect(me.token);
    await c.wait((m) => m.t === 'welcome');
    c.send({ t: 'rit', k: 'incense' });
    assert.ok((await c.wait((m) => m.t === 'merit')).gained > 0);
    c.close();

    await h.api('POST', `/api/admin/users/${me.user.id}/unmute`, {}, ADMIN);
    assert.equal((await h.api('POST', '/api/temples/main/wishes', { text: '願大家平安' }, me.token)).status, 200);
    assert.deepEqual((await h.api('GET', '/api/admin/modlog', null, ADMIN)).body.log.map((l) => l.action).sort(), ['hide', 'hide', 'hide', 'keep', 'mute', 'unmute']);
  } finally { await h.close(); }
});
