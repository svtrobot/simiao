import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/store/jsonStore.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'simiao-store-'));

test('flushes append only what changed; a reload replays snapshot + log', () => {
  const dir = tmp();
  const s = new JsonStore(dir);
  for (let i = 0; i < 1000; i++) s.put('users', `u${i}`, { id: `u${i}`, merit: 0 });
  s.flush();
  const first = fs.statSync(path.join(dir, 'users.log')).size;
  s.get('users', 'u7').merit = 5; s.put('users', 'u7', s.get('users', 'u7'));
  s.remove('users', 'u8');
  s.flush();
  const grew = fs.statSync(path.join(dir, 'users.log')).size - first;
  assert.ok(grew < 100, `second flush wrote ${grew} bytes, not the whole collection`);
  const r = new JsonStore(dir);
  assert.equal(r.get('users', 'u7').merit, 5);
  assert.equal(r.get('users', 'u8'), null);
  assert.equal(r.list('users').length, 999);
});

test('compaction folds the log into the snapshot; a torn last line is skipped', () => {
  const dir = tmp();
  const s = new JsonStore(dir);
  for (let i = 0; i < 50; i++) s.put('lamps', `l${i}`, { id: `l${i}` });
  s.flush({ compact: true });
  assert.equal(fs.statSync(path.join(dir, 'lamps.log')).size, 0);
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'lamps.json'), 'utf8'))).length, 50);
  s.put('lamps', 'l50', { id: 'l50' });
  s.flush();
  fs.appendFileSync(path.join(dir, 'lamps.log'), '["l51",{"id":"l5'); // crash mid-write
  const r = new JsonStore(dir);
  assert.equal(r.list('lamps').length, 51);
  assert.equal(r.get('lamps', 'l51'), null);
});

test('old data written as a single JSON file still loads', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'temples.json'), JSON.stringify({ main: { id: 'main' } }));
  assert.equal(new JsonStore(dir).get('temples', 'main').id, 'main');
});
