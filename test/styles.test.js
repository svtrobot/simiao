import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneRegistry, validateManifest } from '../server/domain/scenes.js';
import { actionAllowed } from '../server/domain/compliance.js';
import { startApp } from './helpers.js';

const scenes = new SceneRegistry('scenes').load();

test('the Korean temple and the Japanese shrine load as plain scene packages', () => {
  assert.deepEqual([...scenes.errors.keys()], []);
  const kr = scenes.get('kr-sansa'), jp = scenes.get('jp-shrine');
  assert.equal(kr.style.architecture, 'kr-temple');
  assert.equal(jp.style.architecture, 'jp-shrine');
  assert.equal(kr.seats.length, 100);
  assert.ok(!kr.regions.includes('cn') && !jp.regions.includes('cn'));
  // a style must be one the client knows how to build; rituals must be real ritual actions
  const bad = { ...jp, style: { architecture: 'gothic' }, rituals: ['incense', 'dance'], fortune: { jiao: 'no' } };
  const errs = validateManifest(bad).join('\n');
  assert.match(errs, /style\.architecture/);
  assert.match(errs, /rituals/);
  assert.match(errs, /fortune\.jiao/);
});

test('a scene narrows rituals to its own tradition', () => {
  const jp = scenes.get('jp-shrine'), kr = scenes.get('kr-sansa'), cn = scenes.get('tw-main-hall');
  assert.equal(actionAllowed('ritual', 'incense', jp), false);  // no incense at a Shinto shrine
  assert.equal(actionAllowed('ritual', 'muyu', jp), false);
  assert.equal(actionAllowed('ritual', 'bow', jp), true);
  assert.equal(actionAllowed('ritual', 'fortune', kr), false);  // no 求籤 at the Korean temple
  assert.equal(actionAllowed('ritual', 'incense', kr), true);
  assert.equal(actionAllowed('ritual', 'incense', cn), true);   // no list = everything
  assert.equal(actionAllowed('cultural', 'bow', jp), false);     // cultural mode still wins
  assert.equal(actionAllowed('ritual', 'lamp', jp), true);       // 獻燈 is not a restricted ritual
});

test('御神籤 opens the drawn slip without 擲筊; other halls still require it', async () => {
  const h = await startApp();
  try {
    const { token } = await h.session();
    let r = await h.api('GET', '/api/temples');
    assert.deepEqual(r.body.map((t) => [t.slug, t.culture]).sort(), [['jinja', 'jp-shinto'], ['main', 'zh-buddhist'], ['sansa', 'kr-buddhist']]);
    r = await h.api('POST', '/api/temples/jinja/fortune/draw', {}, token);
    assert.equal(r.status, 200);
    r = await h.api('POST', '/api/temples/jinja/fortune/reveal', {}, token);
    assert.equal(r.status, 200);
    assert.equal(r.body.lot.no > 0, true);
    assert.equal((await h.api('POST', '/api/temples/jinja/fortune/draw', {}, token)).status, 429); // one a day
    // the Chinese hall keeps 擲筊
    await h.api('POST', '/api/temples/main/fortune/draw', {}, token);
    assert.equal((await h.api('POST', '/api/temples/main/fortune/reveal', {}, token)).status, 409);
    // the Korean temple has no 求籤 at all
    assert.equal((await h.api('POST', '/api/temples/sansa/fortune/draw', {}, token)).status, 403);
  } finally { await h.close(); }
});

test('incense sent to the shrine room is refused by the server', async () => {
  const h = await startApp();
  try {
    const { token } = await h.session();
    const c = await h.connect(token, 'jinja');
    await c.wait((m) => m.t === 'welcome');
    c.send({ t: 'rit', k: 'incense' });
    const err = await c.wait((m) => m.t === 'err');
    assert.equal(err.code, 'not_in_this_mode');
    c.close();
  } finally { await h.close(); }
});
