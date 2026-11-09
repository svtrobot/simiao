import test from 'node:test';
import assert from 'node:assert/strict';
import { almanac, dayCycle, lunarOf, solarOf, zodiacOf, taisuiRelation, personal } from '../server/domain/almanac.js';
import { startApp } from './helpers.js';

const S = '甲乙丙丁戊己庚辛壬癸', B = '子丑寅卯辰巳午未申酉戌亥';
const gz = ([s, b]) => S[s] + B[b];

test('day stems and branches match well-known dates', () => {
  assert.equal(dayCycle(1949, 10, 1), 0); // 甲子
  const d = dayCycle(2000, 1, 1); assert.equal(S[d % 10] + B[d % 12], '戊午');
});

test('lunar dates, leap months and the way back', () => {
  assert.deepEqual(lunarOf(2026, 2, 17), { year: 2026, month: 1, leap: false, day: 1 }); // 2026 春節
  assert.deepEqual(lunarOf(2023, 3, 22), { year: 2023, month: 2, leap: true, day: 1 }); // 閏二月初一
  assert.equal(solarOf(2023, 2, 1, true), '2023-03-22');
  assert.equal(solarOf(2023, 2, 1, false), '2023-02-20');
});

test('the 2026-11-10 almanac: 丙午年 己亥月 戊子日, 十月初二, 除日, next term 小雪', () => {
  const a = almanac('2026-11-10', { tz: 'Asia/Taipei' });
  assert.equal(gz(a.gz.year), '丙午');
  assert.equal(gz(a.gz.month), '己亥');
  assert.equal(gz(a.gz.day), '戊子');
  assert.deepEqual(a.lunar, { year: 2026, month: 10, leap: false, day: 2 });
  assert.equal(a.officer, 'chu');
  assert.equal(a.term, null);
  assert.deepEqual(a.next, { term: 16, date: '2026-11-22', days: 12 });
  assert.equal(a.clash.zodiac, 6); // 子日沖馬
  assert.equal(a.hours.filter(Boolean).length, 6);
});

test('立春 starts the stem-branch year and the 寅 month', () => {
  assert.equal(gz(almanac('2026-02-03').gz.year), '乙巳');
  const lichun = almanac('2026-02-04');
  assert.equal(lichun.term, 21);
  assert.equal(gz(lichun.gz.year), '丙午');
  assert.equal(gz(lichun.gz.month), '庚寅');
});

test('太歲 2026 (午): 值馬 沖鼠 害牛 破兔', () => {
  const kinds = Object.fromEntries(almanac('2026-06-01').taisui.affected.map((x) => [x.zodiac, x.kind]));
  assert.deepEqual(kinds, { 6: 'zhi', 0: 'chong', 1: 'hai', 3: 'po' });
  assert.equal(taisuiRelation(2, 5), 'xing'); // 寅刑巳
});

test('Buddhist holy days only in ritual mode; folk festivals in both', () => {
  const birth = solarOf(2026, 4, 8);
  assert.ok(almanac(birth, { mode: 'ritual' }).festivals.includes('buddha_birth'));
  assert.ok(!almanac(birth, { mode: 'cultural' }).festivals.includes('buddha_birth'));
  assert.ok(almanac(solarOf(2026, 8, 15), { mode: 'cultural' }).festivals.includes('midautumn'));
  assert.ok(almanac('2026-12-22').festivals.includes('dongzhi'));
});

test('zodiac follows the lunar new year; guardian only in ritual mode', () => {
  assert.equal(zodiacOf('2026-02-10'), 5); // still 蛇 before 春節 (2-17)
  assert.equal(zodiacOf('2026-02-20'), 6); // 馬
  const a = almanac('2026-06-01');
  assert.equal(personal(a, { date: '1990-05-01', zodiac: 6 }).guardian, 'dashizhi');
  assert.equal(personal(a, { date: '1990-05-01', zodiac: 6 }, { mode: 'cultural' }).guardian, null);
  assert.equal(personal(a, { date: '1990-05-01', zodiac: 6 }).taisui, 'zhi');
});

test('HTTP: almanac, private birthday, steady daily line', async () => {
  const h = await startApp();
  try {
    const s = await h.session();
    const a1 = await h.api('GET', '/api/temples/main/almanac?date=2026-11-10', null, s.token);
    assert.equal(a1.status, 200);
    assert.equal(a1.body.me.hasBirthday, false);
    assert.ok(a1.body.daily.text);
    const a2 = await h.api('GET', '/api/temples/main/almanac?date=2026-11-10', null, s.token);
    assert.equal(a2.body.daily.text, a1.body.daily.text);
    // lunar birthday 1990 正月初一 → 1990-01-27, 馬
    const b = await h.api('POST', '/api/me/birthday', { date: '1990-01-01', lunar: true }, s.token);
    assert.deepEqual(b.body.birthday, { date: '1990-01-27', lunar: true, zodiac: 6 });
    assert.equal((await h.api('POST', '/api/me/birthday', { date: '2999-01-01' }, s.token)).status, 422);
    assert.equal((await h.api('POST', '/api/me/birthday', { date: '1990-02-30' }, s.token)).status, 422);
    const me = await h.api('GET', '/api/me', null, s.token);
    assert.equal(me.body.birthday.zodiac, 6);
    const a3 = await h.api('GET', '/api/temples/main/almanac?date=2026-11-10', null, s.token);
    assert.equal(a3.body.me.guardian, 'dashizhi');
    assert.equal(a3.body.me.clashToday, true); // 子日沖馬
    // the room never sees a birthday
    const ws = await h.connect(s.token);
    const welcome = await ws.wait((m) => m.t === 'welcome');
    assert.equal(JSON.stringify(welcome).includes('1990-01-27'), false);
    ws.close();
    await h.api('DELETE', '/api/me/birthday', null, s.token);
    assert.equal((await h.api('GET', '/api/me', null, s.token)).body.birthday, null);
  } finally { await h.close(); }
});
