import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFrame, FrameParser, acceptKey } from '../server/realtime/ws.js';

test('accept key matches RFC 6455 example', () => {
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('masked frames round-trip, including 16-bit length and split chunks', () => {
  const p = new FrameParser(1 << 16);
  const long = Buffer.from('禪'.repeat(200));
  const f1 = encodeFrame(0x1, Buffer.from('合掌'), true);
  const f2 = encodeFrame(0x1, long, true);
  const all = Buffer.concat([f1, f2]);
  const out = [...p.push(all.subarray(0, 5)), ...p.push(all.subarray(5, 300)), ...p.push(all.subarray(300))];
  assert.equal(out.length, 2);
  assert.equal(out[0].payload.toString(), '合掌');
  assert.equal(out[1].payload.toString(), long.toString());
});

test('unmasked client frames and oversize frames are rejected', () => {
  assert.throws(() => new FrameParser(1024).push(encodeFrame(0x1, Buffer.from('x'), false)), /masked/);
  assert.throws(() => new FrameParser(10).push(encodeFrame(0x1, Buffer.alloc(50), true)), /too large/);
});
