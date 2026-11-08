import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateManifest, SceneRegistry } from '../server/domain/scenes.js';
import { effectiveMode, actionAllowed, crisisSignal, ugcRejectReason, claimsReligiousVenue } from '../server/domain/compliance.js';
import { REGIONS } from '../server/config.js';
import { JsonStore } from '../server/store/jsonStore.js';
import { TempleService } from '../server/domain/temples.js';

test('bundled scene packages validate; template is a valid example', () => {
  const reg = new SceneRegistry('scenes').load();
  assert.deepEqual(Object.fromEntries(reg.errors), {});
  assert.equal(reg.get('tw-main-hall').seats.length, 100);
  const tpl = JSON.parse(fs.readFileSync('scenes/_template/manifest.json', 'utf8'));
  assert.deepEqual(validateManifest(tpl), []);
});

test('scene over the 6.3 budget or cn without cultural mode is rejected', () => {
  const m = JSON.parse(fs.readFileSync('scenes/tw-main-hall/manifest.json', 'utf8'));
  assert.match(validateManifest({ ...m, budget: { ...m.budget, triangles: 400000 } }).join(), /exceeds/);
  assert.match(validateManifest({ ...m, regions: ['cn'], complianceModes: ['ritual'] }).join(), /cultural/);
});

test('mainland region forces cultural mode and hides rituals', () => {
  const scene = { complianceModes: ['ritual', 'cultural'] };
  assert.equal(effectiveMode({ regionPolicy: REGIONS.cn, scene, temple: {} }), 'cultural');
  assert.equal(effectiveMode({ regionPolicy: REGIONS.tw, scene, temple: {} }), 'ritual');
  assert.equal(actionAllowed('cultural', 'incense'), false);
  assert.equal(actionAllowed('cultural', 'meditate'), true);
});

test('safety filters', () => {
  assert.ok(crisisSignal('最近真的不想活了'));
  assert.ok(!crisisSignal('希望家人平安'));
  assert.equal(ugcRejectReason('加line聯絡我'), 'contact_or_link');
  assert.equal(ugcRejectReason('供奉保證靈驗'), 'marketing');
  assert.equal(ugcRejectReason('願考試順利'), null);
  assert.ok(claimsReligiousVenue('清水宮'));
});

test('temple applications: venue names need a certificate; approval creates a tenant', () => {
  const scenes = new SceneRegistry('scenes').load();
  const svc = new TempleService({ store: new JsonStore(null), scenes, regionPolicy: REGIONS.tw, region: 'tw' });
  const base = { applicant: '王小明', contact: 'a@b.c', sceneId: 'tw-main-hall', tier: 'starter' };
  assert.throws(() => svc.apply({ ...base, orgType: 'culture', name: '靜心寺' }), (e) => e.extra.issues.includes('venue_name_requires_certificate'));
  const { id } = svc.apply({ ...base, orgType: 'culture', name: '晨光冥想空間' });
  const { temple } = svc.decide(id, { approve: true, slug: 'morning-light' });
  assert.equal(temple.label, 'culture');
  assert.equal(svc.listPublic().length, 2);
  const cn = new TempleService({ store: new JsonStore(null), scenes, regionPolicy: REGIONS.cn, region: 'cn' });
  assert.throws(() => cn.apply({ ...base, orgType: 'culture', name: '晨光' }), /self_service_disabled/);
});
