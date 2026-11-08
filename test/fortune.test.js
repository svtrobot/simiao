import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { JsonStore } from '../server/store/jsonStore.js';
import { FortuneService } from '../server/domain/fortune.js';

const svc = () => new FortuneService({ contentDir: path.resolve('content'), store: new JsonStore(null), tz: 'Asia/Taipei' });

test('content: 12 lots with poem, meaning and advice', () => {
  const s = svc();
  assert.equal(s.set.lots.length, 12);
  for (const l of s.set.lots) { assert.equal(l.poem.length, 4); assert.ok(l.meaning && l.advice['健康']); }
});

test('draw → 掷筊 until revealed (max 3 attempts), then one per day', () => {
  const s = svc(); const now = Date.UTC(2026, 10, 9, 3);
  let out;
  for (let i = 0; i < 3; i++) {
    s.draw('u', 'main', now);
    out = s.throwJiao('u', 'main', now);
    if (out.final) break;
  }
  assert.ok(out.final && out.lot);
  assert.throws(() => s.draw('u', 'main', now), /fortune_daily_limit/);
  assert.equal(s.today('u', 'main', now).no, out.lot.no);
  // other temple, other day: allowed
  assert.ok(s.draw('u', 'other', now).no);
  assert.ok(s.draw('u', 'main', now + 86400000).no);
});

test('jiao without draw is refused', () => {
  assert.throws(() => svc().throwJiao('u', 'main'), /fortune_draw_first/);
});
