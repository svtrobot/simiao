// 场景扩展底座（设计文档 6.5）：场景是数据，不是代码。
// 每个场景包 = scenes/<id>/manifest.json（+ 可选 glTF / 高斯泼溅资源）。
// 实时服务只认 scene_id 与槽位表，不关心模型长什么样。
import fs from 'node:fs';
import path from 'node:path';

export const HARD_BUDGET = { triangles: 300000, drawCalls: 150, textureMB: 25, firstScreenMB: 3 }; // 6.3
export const SLOT_TYPES = new Set([
  'incense_burner', 'fortune_table', 'muyu', 'bell', 'wish_wall', 'lamp_wall', 'seat', 'photo_spot',
  'paper_brazier', 'ancestor_hall', 'main_altar', 'gate',
  // scenery that also blocks walking: landmark tree (r), pond (w × d), stone pagoda, 手水舍, guardian statue, stone lantern
  'tree', 'pond', 'pagoda', 'temizuya', 'guardian', 'lantern',
  // decoration only: a string of lanterns from (x, z) to (x2, z2) overhead
  'lantern_line',
]);
export const ARCHITECTURES = new Set(['cn-hall', 'kr-temple', 'jp-shrine']);
const RITUALS = new Set(['incense', 'fortune', 'muyu', 'bead', 'bow']);
const REGION_IDS = new Set(['tw', 'overseas', 'cn']);
const MODES = new Set(['ritual', 'cultural']);

export function validateManifest(m) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  need(m && typeof m === 'object', 'manifest must be an object');
  if (errors.length) return errors;
  need(/^[a-z0-9][a-z0-9-]{1,62}$/.test(m.id || ''), 'id: lowercase letters, digits, dashes');
  need(Number.isInteger(m.version) && m.version > 0, 'version: positive integer');
  need(m.name && typeof m.name['zh-Hant'] === 'string', 'name["zh-Hant"] required');
  need(typeof m.culture === 'string', 'culture required');
  need(Array.isArray(m.regions) && m.regions.length && m.regions.every((r) => REGION_IDS.has(r)), 'regions ⊂ {tw, overseas, cn}');
  need(Array.isArray(m.complianceModes) && m.complianceModes.length && m.complianceModes.every((x) => MODES.has(x)), 'complianceModes ⊂ {ritual, cultural}');
  if (m.regions?.includes('cn')) need(m.complianceModes?.includes('cultural'), 'scenes listed in cn must support cultural mode (8.1)');
  const r = m.render || {};
  need(typeof r.builder === 'string' || typeof r.gltf === 'string' || typeof r.splat === 'string', 'render: builder, gltf or splat');
  const b = m.budget || {};
  for (const [k, max] of Object.entries(HARD_BUDGET)) {
    need(typeof b[k] === 'number', `budget.${k} required`);
    if (typeof b[k] === 'number') need(b[k] <= max, `budget.${k}=${b[k]} exceeds platform limit ${max}`);
  }
  const w = m.walkArea || {};
  need(['minX', 'maxX', 'minZ', 'maxZ'].every((k) => typeof w[k] === 'number') && w.minX < w.maxX && w.minZ < w.maxZ, 'walkArea {minX,maxX,minZ,maxZ}');
  need(m.spawn && typeof m.spawn.x === 'number' && typeof m.spawn.z === 'number', 'spawn {x,z}');
  need(Array.isArray(m.slots), 'slots[] required');
  const ids = new Set();
  for (const s of m.slots || []) {
    need(typeof s.id === 'string' && !ids.has(s.id), `slot id missing or duplicate: ${s.id}`);
    ids.add(s.id);
    need(SLOT_TYPES.has(s.type), `slot ${s.id}: unknown type ${s.type}`);
    need(typeof s.x === 'number' && typeof s.z === 'number', `slot ${s.id}: x,z required`);
  }
  if (m.style !== undefined) need(m.style && ARCHITECTURES.has(m.style.architecture), `style.architecture ∈ {${[...ARCHITECTURES].join(', ')}}`);
  if (m.rituals !== undefined) need(Array.isArray(m.rituals) && m.rituals.every((r) => RITUALS.has(r)), 'rituals ⊂ {incense, fortune, muyu, bead, bow}');
  if (m.fortune !== undefined) need(m.fortune && typeof m.fortune.jiao === 'boolean', 'fortune.jiao must be true or false');
  if (m.license?.status === 'licensed') need(!!m.license.expires, 'licensed scenes need license.expires');
  return errors;
}

/** Expand `seatGrid` into concrete seat slots so the room server can assign cushions. */
export function seatsOf(m) {
  const seats = (m.slots || []).filter((s) => s.type === 'seat');
  const g = m.seatGrid;
  if (g) {
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        seats.push({ id: `seat-${r}-${c}`, type: 'seat', x: g.x0 + c * g.dx, z: g.z0 + r * g.dz, ry: g.ry ?? Math.PI, row: r });
      }
    }
  }
  return seats;
}

export class SceneRegistry {
  constructor(dir) { this.dir = dir; this.scenes = new Map(); this.errors = new Map(); }

  load() {
    this.scenes.clear(); this.errors.clear();
    if (!fs.existsSync(this.dir)) return this;
    for (const name of fs.readdirSync(this.dir)) {
      if (name.startsWith('_')) continue; // _template etc.
      const f = path.join(this.dir, name, 'manifest.json');
      if (!fs.existsSync(f)) continue;
      let m;
      try { m = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { this.errors.set(name, [`invalid JSON: ${e.message}`]); continue; }
      const errs = validateManifest(m);
      if (m.id !== name) errs.push(`folder name "${name}" must equal id "${m.id}"`);
      if (errs.length) { this.errors.set(name, errs); console.warn(`[scenes] ${name} rejected:\n  - ${errs.join('\n  - ')}`); continue; }
      m.seats = seatsOf(m);
      this.scenes.set(m.id, m);
    }
    return this;
  }

  get(id) { return this.scenes.get(id) || null; }
  forRegion(region) { return [...this.scenes.values()].filter((s) => s.regions.includes(region)); }
  summary(s) {
    return { id: s.id, version: s.version, name: s.name, culture: s.culture, regions: s.regions,
      complianceModes: s.complianceModes, seats: s.seats.length, license: s.license?.status || 'original', geo: s.geo || null };
  }
}
