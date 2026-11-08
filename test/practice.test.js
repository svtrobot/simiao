import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPractice, record, visit, appearance, rankFor } from '../server/domain/practice.js';

const tz = 'Asia/Taipei';

test('incense: 3 per day, rate limited, merit server-side', () => {
  const p = blankPractice(); let t = Date.UTC(2026, 10, 9, 2);
  assert.equal(record(p, 'incense', { tz, now: t }).counted, true);
  assert.equal(record(p, 'incense', { tz, now: t + 1000 }).reason, 'too_fast');
  assert.equal(record(p, 'incense', { tz, now: t += 5000 }).counted, true);
  assert.equal(record(p, 'incense', { tz, now: t += 5000 }).counted, true);
  assert.equal(record(p, 'incense', { tz, now: t += 5000 }).reason, 'daily_cap');
  assert.equal(p.merit, 9);
  // next local day resets
  assert.equal(record(p, 'incense', { tz, now: t + 86400000 }).counted, true);
});

test('木鱼 counts one merit per 10 strikes', () => {
  const p = blankPractice(); let t = Date.UTC(2026, 10, 9, 2);
  for (let i = 0; i < 25; i++) record(p, 'muyu', { tz, now: (t += 200) });
  assert.equal(p.merit, 2);
});

test('ranks follow practice minutes; 5 stages', () => {
  assert.equal(rankFor(0).stage, 'raw');
  assert.equal(rankFor(60).stage, 'bisque');
  assert.equal(rankFor(3000).stage, 'kintsugi');
});

test('金缮：回来就好 — long absence adds a gold seam on return', () => {
  const p = blankPractice(); const t = Date.UTC(2026, 0, 1);
  visit(p, t);
  assert.equal(visit(p, t + 3 * 86400000).repaired, false);
  assert.equal(visit(p, t + 20 * 86400000).repaired, true);
  assert.equal(appearance('u1', p, t + 20 * 86400000).gold, 1);
});

test('窑变 colour follows habits', () => {
  const p = blankPractice(); let t = Date.UTC(2026, 10, 9, 2);
  record(p, 'meditate', { tz, now: t, units: 30 });
  assert.equal(appearance('u', p, t).kiln, 'celadon');
  for (let i = 0; i < 3; i++) record(p, 'bead', { tz, now: (t += 200) }); // no full round yet
  assert.equal(appearance('u', p, t).kiln, 'celadon');
});
