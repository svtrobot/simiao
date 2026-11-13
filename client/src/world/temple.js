// Procedural builder for scene packages with render.builder = "procedural:cn-hall-v1" / "procedural:hall-v2".
// hall-v2 reads manifest.style.architecture (cn-hall | kr-temple | jp-shrine): the vocabulary of
// columns, roofs, gates and lanterns comes from styles.js; positions still come from the manifest.
// Everything is placed from the manifest (hall rect, slots, seat grid), so another
// layout of the same style is just another manifest. glTF / Gaussian-splat packages
// go through loadPackage() in scene.js instead.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';
import { addShrine, addSculpt, STATUE_MATERIALS } from './statue.js';
import { addInterior, interiorMaterials } from './interior.js';
import { addLandscape, landscapeMaterials } from './landscape.js';
import { addLampWall } from './lampwall.js';
import { STYLES, SCENERY } from './styles.js';
import { frameOf } from './layout.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(V3(x, y, z), tmpQ.setFromEuler(tmpE.set(rx, ry, rz)), V3(sx, sy, sz));
}

/** Collects static geometry per material and merges it → one draw call per material. */
class Batch {
  constructor() { this.parts = new Map(); }
  add(key, geom, matrix) {
    const g = geom.index ? geom.toNonIndexed() : geom.clone();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (matrix) g.applyMatrix4(matrix);
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
  }
  build(materials, { castShadow = true, receiveShadow = true } = {}) {
    const group = new THREE.Group();
    for (const [key, list] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(list, false), materials[key]);
      mesh.castShadow = castShadow && !['ground', 'gravel', 'floor', 'mountain'].includes(key);
      mesh.receiveShadow = receiveShadow;
      mesh.name = key;
      group.add(mesh);
    }
    return group;
  }
}

/** Hip roof (庑殿顶) with concave slopes and lifted corners (翼角起翘). */
function hipRoof({ halfW, halfD, ridgeHalf, ridgeY, eaveY, lift = 0.9, flare = 0.6, nu = 28, nv = 10 }) {
  const pos = [], uv = [], idx = [];
  const prof = (v) => ridgeY - (ridgeY - eaveY) * (2 * v - v * v);
  const face = (fn) => {
    const base = pos.length / 3;
    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      for (let i = 0; i <= nu; i++) {
        const u = i / nu * 2 - 1;
        const p = fn(u, v);
        pos.push(p.x, p.y, p.z); uv.push(i / nu * 6, v * 3);
      }
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  };
  const corner = (s, v) => Math.abs(s) ** 4 * v ** 2.5;
  for (const sz of [1, -1]) {
    face((u, v) => {
      const half = ridgeHalf + (halfW - ridgeHalf) * v;
      const c = corner(u, v);
      return V3(u * half * (1 + flare * 0.05 * c), prof(v) + lift * c, sz * (halfD * v + flare * c));
    });
  }
  for (const sx of [1, -1]) {
    face((s, v) => {
      const c = corner(s, v);
      return V3(sx * (ridgeHalf + (halfW - ridgeHalf) * v + flare * c), prof(v) + lift * c, s * halfD * v * (1 + flare * 0.05 * c));
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function lathe(points, segs = 24) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segs);
}

function seeded(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

export function buildTemple(manifest, { quality, season, plaqueText, mode = 'ritual' }) {
  const env = manifest.environment || {};
  const pal = { wood: '#7a2e22', roof: '#3b3a38', stone: '#9b958b', gold: '#c9a24a', ...(env.palette || {}) };
  const hall = manifest.hall;
  const floorY = hall.floorY;
  const slot = Object.fromEntries(manifest.slots.map((s) => [s.id, s]));
  const byType = (type) => manifest.slots.find((s) => s.type === type);
  const rnd = seeded(20261109);
  const frame = frameOf(manifest);
  const S = STYLES[frame.arch] || null; // null = the original Chinese hall below

  const stoneTex = TX.stoneTiles({ base: pal.stone }); stoneTex.repeat.set(6, 6);
  const gravelTex = TX.gravel(); gravelTex.repeat.set(10, 10);
  const grassTex = TX.grass({ base: season === 'winter' ? '#c9ccc8' : season === 'autumn' ? '#7a6a42' : '#5d6a46' }); grassTex.repeat.set(30, 30);
  const floorTex = TX.woodPlanks(); floorTex.repeat.set(5, 4);
  const roofTex = TX.roofTiles({ base: pal.roof }); roofTex.repeat.set(1, 1);
  const lacquerTex = TX.lacquer({ base: pal.wood });

  const mat = {
    ground: new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }),
    gravel: new THREE.MeshStandardMaterial({ map: gravelTex, color: '#b9b1a4', roughness: 0.95 }), // tinted: bare gravel blew out to white at noon
    stone: new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.9 }),
    stoneDark: new THREE.MeshStandardMaterial({ color: '#6f6a62', roughness: 0.92 }),
    floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.62, color: '#d8c4ad' }),
    lacquer: new THREE.MeshStandardMaterial({ map: lacquerTex, roughness: 0.42 }),
    beam: new THREE.MeshStandardMaterial({ color: '#2f5a55', roughness: 0.6 }),
    gold: new THREE.MeshStandardMaterial({ color: pal.gold, metalness: 0.85, roughness: 0.32 }),
    roof: new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.75, side: THREE.DoubleSide }),
    ridge: new THREE.MeshStandardMaterial({ color: '#2b2a29', roughness: 0.7 }),
    plaster: new THREE.MeshStandardMaterial({ color: '#c9b894', roughness: 0.95 }),
    lattice: new THREE.MeshStandardMaterial({ color: '#5c2219', roughness: 0.55 }),
    bronze: new THREE.MeshStandardMaterial({ color: '#6b5133', metalness: 0.8, roughness: 0.42 }),
    wood: new THREE.MeshStandardMaterial({ color: '#6a4a33', roughness: 0.7 }),
    cloth: new THREE.MeshStandardMaterial({ color: '#8e2a20', roughness: 0.85 }),
    pine: new THREE.MeshStandardMaterial({ color: season === 'winter' ? '#3c5148' : '#2f4a35', roughness: 0.95, flatShading: true }),
    leaf: new THREE.MeshStandardMaterial({ color: { spring: '#e8b6c4', summer: '#4d7a3a', autumn: '#c0562c', winter: '#8b8076' }[season], roughness: 0.9, flatShading: true }),
    bark: new THREE.MeshStandardMaterial({ color: '#4a3a2e', roughness: 1 }),
    mountain: new THREE.MeshStandardMaterial({ color: '#6c7686', roughness: 1, flatShading: true }),
    tablet: new THREE.MeshStandardMaterial({ color: '#d6bd8f', roughness: 0.8 }),
    ribbon: new THREE.MeshStandardMaterial({ color: '#b23a2a', roughness: 0.8 }),
    ...STATUE_MATERIALS({ quality }),
    ...interiorMaterials(),
    ...landscapeMaterials(season),
    ...(S ? S.materials(pal, season) : {}),
  };

  const B = new Batch();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 18);
  const cyl8 = new THREE.CylinderGeometry(1, 1, 1, 8);
  const sph = new THREE.SphereGeometry(1, 16, 12);
  const cone = new THREE.ConeGeometry(1, 1, 7);

  // ---- ground, courtyard, path ----
  B.add('ground', new THREE.PlaneGeometry(300, 300), M(0, -0.02, 0, -Math.PI / 2));
  const w = manifest.walkArea;
  B.add('gravel', new THREE.PlaneGeometry(w.maxX - w.minX + 2, w.maxZ - hall.z1 + 2), M(0, 0.0, (hall.z1 + w.maxZ) / 2, -Math.PI / 2));
  for (let z = w.maxZ - 0.5; z > hall.z1 + 2; z -= 1.05) {
    B.add('stone', box, M((rnd() - 0.5) * 0.06, 0.03, z, 0, (rnd() - 0.5) * 0.03, 0, 3.0, 0.08, 0.98));
  }

  // ---- hall platform & steps ----
  const hw = (hall.x1 - hall.x0), hd = (hall.z1 - hall.z0), hcx = (hall.x0 + hall.x1) / 2, hcz = (hall.z0 + hall.z1) / 2;
  B.add('stone', box, M(hcx, floorY / 2, hcz, 0, 0, 0, hw + 0.6, floorY, hd + 0.6));
  B.add('floor', new THREE.PlaneGeometry(hw - 0.6, hd - 0.6), M(hcx, floorY + 0.005, hcz, -Math.PI / 2));
  const steps = hall.steps;
  for (let i = 0; i < 3; i++) {
    const h = floorY * (3 - i) / 3;
    B.add('stone', box, M(steps.x, h / 2, hall.z1 + 0.3 + i * 0.6 + 0.3, 0, 0, 0, steps.width, h, 0.6));
  }

  // ---- columns, beams, brackets ----
  const colH = frame.colH, colTop = floorY + colH;
  const frontZ = hall.z1 - 0.7;
  const inHallAt = (x, z) => x > hall.x0 && x < hall.x1 && z > hall.z0 && z < hall.z1;
  const ctx = {
    B, M, mat, hall, floorY, colTop, frontZ, hw, hd, hcx, hcz, frame, rnd, season, quality,
    box, cyl, cyl8, sph, cone, lathe, hipRoof, yAt: (x, z) => (inHallAt(x, z) ? floorY : 0),
  };
  if (S) S.frame(ctx);
  else {
  const colXs = frame.front;
  for (const x of colXs) {
    B.add('stoneDark', cyl8, M(x, floorY + 0.12, frontZ, 0, 0, 0, 0.5, 0.24, 0.5));
    B.add('lacquer', cyl, M(x, floorY + colH / 2, frontZ, 0, 0, 0, 0.3, colH, 0.3));
  }
  for (const [x, z] of frame.inner) {
    B.add('stoneDark', cyl8, M(x, floorY + 0.12, z, 0, 0, 0, 0.5, 0.24, 0.5));
    B.add('lacquer', cyl, M(x, floorY + colH / 2, z, 0, 0, 0, 0.3, colH, 0.3));
  }
  B.add('beam', box, M(0, colTop - 0.25, frontZ, 0, 0, 0, hw, 0.55, 0.42));
  B.add('gold', box, M(0, colTop - 0.52, frontZ - 0.22, 0, 0, 0, hw, 0.06, 0.04));
  B.add('lacquer', box, M(0, colTop + 0.15, frontZ, 0, 0, 0, hw + 0.4, 0.25, 0.5));
  for (let x = hall.x0 + 0.6; x <= hall.x1 - 0.6; x += 1.2) {
    B.add('beam', box, M(x, colTop + 0.45, frontZ - 0.1, 0, 0, 0, 0.42, 0.35, 0.7));
    B.add('gold', box, M(x, colTop + 0.67, frontZ - 0.25, 0, 0, 0, 0.5, 0.08, 0.5));
  }

  // ---- walls ----
  const wallH = colH + 0.4;
  B.add('lacquer', box, M(hcx, floorY + wallH / 2, hall.z0 + 0.3, 0, 0, 0, hw, wallH, 0.4));
  for (const sx of [-1, 1]) B.add('lacquer', box, M(sx * (hw / 2 - 0.2), floorY + wallH / 2, hcz - 0.35, 0, 0, 0, 0.4, wallH, hd - 1.2));
  B.add('plaster', box, M(hcx, floorY + wallH - 1.0, hall.z0 + 0.52, 0, 0, 0, hw - 0.8, 1.6, 0.05));
  // lattice doors on the outer bays (中间三间敞开，可见殿内)
  for (const [x0, x1] of [[-11.4, -8], [8, 11.4]]) {
    const cx = (x0 + x1) / 2, bw = x1 - x0 - 0.35;
    B.add('lattice', box, M(cx, floorY + 0.5, frontZ, 0, 0, 0, bw, 1.0, 0.12));
    for (let k = 0; k <= 8; k++) B.add('lattice', box, M(cx - bw / 2 + k * bw / 8, floorY + 3.1, frontZ, 0, 0, 0, 0.07, 4.2, 0.1));
    for (let k = 0; k <= 10; k++) B.add('lattice', box, M(cx, floorY + 1.0 + k * 0.42, frontZ, 0, 0, 0, bw, 0.06, 0.1));
  }
  }

  // ---- roof ----
  if (S) S.roof(ctx);
  else {
  const roofG = hipRoof({ halfW: hw / 2 + 2.2, halfD: hd / 2 + 2.4, ridgeHalf: hw / 2 - 4.5, ridgeY: colTop + 3.6, eaveY: colTop + 0.85, lift: 1.1, flare: 0.8 });
  B.add('roof', roofG, M(hcx, 0, hcz));
  const ridgeLen = (hw / 2 - 4.5) * 2;
  B.add('ridge', box, M(hcx, colTop + 3.85, hcz, 0, 0, 0, ridgeLen + 0.6, 0.55, 0.55));
  for (const sx of [-1, 1]) {
    // 鸱吻：简化的卷尾
    const tor = new THREE.TorusGeometry(0.55, 0.16, 8, 16, Math.PI * 1.4);
    B.add('ridge', tor, M(hcx + sx * (ridgeLen / 2 + 0.2), colTop + 4.55, hcz, 0, 0, sx > 0 ? -0.4 : Math.PI + 0.4));
    B.add('gold', sph, M(hcx + sx * (ridgeLen / 2 + 0.25), colTop + 4.15, hcz, 0, 0, 0, 0.16));
  }
  }
  // ---- altar & seated figure (自建模，庄重、无戏谑) ----
  const altar = byType('main_altar');
  const shrineExtras = [];
  let sculpt = null;
  if (altar && S && !S.buddhist) shrineExtras.push(...S.altar(ctx, altar));
  else if (altar) {
    const ax = altar.x, az = altar.z;
    // deep enough that the lotus plinth (r ≈ 1.6) does not overhang the front edge
    B.add('lacquer', box, M(ax, floorY + 0.6, az + 0.05, 0, 0, 0, 8, 1.2, 3.3));
    B.add('gold', box, M(ax, floorY + 1.22, az + 0.05, 0, 0, 0, 8.1, 0.06, 3.4));
    // 釋迦牟尼佛坐像 + 迦葉、阿難（statue.js）
    // 主尊: a sculpted model when the scene package declares one (manifest.statue) and the tier can afford it
    const model = quality !== 'low' ? manifest.statue?.gltf?.[quality] || manifest.statue?.gltf?.high : null;
    const shrine = addShrine(B, M, { x: ax, topY: floorY + 1.25, z: az, width: 8, quality, image: !model, imageHeight: model ? manifest.statue.height || 2.9 : 2.9 });
    shrineExtras.push(...shrine);
    if (model) sculpt = { url: `/scenes/${manifest.id}/${model}?r=${manifest.statue.rev || 1}`, seat: shrine.seat, height: manifest.statue.height || 2.9, quality };
  }
  // ceiling, 藻井, offering table, cushions, banners, lanterns, couplets, murals (interior.js)
  const lampSlot = manifest.slots.find((s) => s.type === 'lamp_wall');
  const inside = S && !S.buddhist ? S.interior(ctx) : addInterior(B, M, { hall, floorY, colTop, frontZ, altar, skipMuralSide: lampSlot ? Math.sign(lampSlot.x) : 0 });
  // 燈牆 (lampwall.js)
  const lampWall = lampSlot ? addLampWall(B, M, { slot: lampSlot, floorY: lampSlot.z < hall.z1 && lampSlot.z > hall.z0 ? floorY : 0, mode }) : null;

  // ---- courtyard furniture ----
  const lanternPos = manifest.slots.filter((s) => s.type === 'photo_spot' && s.id.startsWith('lantern'));
  const lanternGlows = lanternPos.map((l) => ({ x: l.x, y: 1.95, z: l.z, size: 0.34 }));
  for (const l of manifest.slots.filter((s) => s.type === 'lantern')) {
    if (S) lanternGlows.push(S.lantern(ctx, l));
    else lanternPos.push(l);
  }
  for (const l of lanternPos) {
    B.add('stone', cyl8, M(l.x, 0.15, l.z, 0, 0, 0, 0.55, 0.3, 0.55));
    B.add('stone', cyl8, M(l.x, 0.9, l.z, 0, 0, 0, 0.16, 1.3, 0.16));
    B.add('stone', box, M(l.x, 1.6, l.z, 0, 0, 0, 0.75, 0.12, 0.75));
    B.add('stoneDark', box, M(l.x, 1.95, l.z, 0, 0, 0, 0.5, 0.55, 0.5));
    B.add('stone', cone, M(l.x, 2.5, l.z, 0, Math.PI / 4, 0, 0.7, 0.55, 0.7));
  }

  // 香炉（鼎）
  const bz = byType('incense_burner');
  if (bz) {
    B.add('stone', cyl8, M(bz.x, 0.2, bz.z, 0, Math.PI / 8, 0, 1.5, 0.4, 1.5));
    const bowl = lathe([[0, 0], [0.55, 0.02], [0.85, 0.25], [0.95, 0.55], [0.9, 0.82], [0.98, 0.88], [0.96, 0.95], [0.84, 0.92], [0.84, 0.82], [0, 0.8]], 28);
    B.add('bronze', bowl, M(bz.x, 0.95, bz.z));
    for (let k = 0; k < 3; k++) {
      const a = k * Math.PI * 2 / 3 + Math.PI / 2;
      B.add('bronze', cyl8, M(bz.x + Math.cos(a) * 0.58, 0.7, bz.z + Math.sin(a) * 0.58, Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18, 0.11, 0.65, 0.11));
    }
    for (const sx of [-1, 1]) B.add('bronze', new THREE.TorusGeometry(0.2, 0.05, 8, 16), M(bz.x + sx * 0.92, 2.05, bz.z, 0, Math.PI / 2, 0));
    B.add('stoneDark', new THREE.CircleGeometry(0.84, 24), M(bz.x, 1.7, bz.z, -Math.PI / 2));
  }

  // 钟亭
  const bell = byType('bell');
  if (bell && S?.bell) S.bell(ctx, bell);
  else if (bell) {
    for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) B.add('lacquer', cyl, M(bell.x + dx, 1.8, bell.z + dz, 0, 0, 0, 0.14, 3.6, 0.14));
    B.add('stone', box, M(bell.x, 0.12, bell.z, 0, 0, 0, 3.6, 0.24, 3.6));
    B.add('roof', hipRoof({ halfW: 2.5, halfD: 2.5, ridgeHalf: 0.05, ridgeY: 5.2, eaveY: 3.7, lift: 0.4, flare: 0.3, nu: 10, nv: 6 }), M(bell.x, 0, bell.z));
    B.add('beam', box, M(bell.x, 3.55, bell.z, 0, 0, 0, 2.8, 0.18, 0.18));
    B.add('bronze', lathe([[0, 1.3], [0.35, 1.28], [0.5, 1.1], [0.55, 0.4], [0.68, 0.05], [0.7, 0], [0.62, 0], [0, 0.02]], 24), M(bell.x, 2.0, bell.z));
    B.add('wood', cyl8, M(bell.x + 1.05, 2.6, bell.z, 0, 0, Math.PI / 2, 0.1, 1.1, 0.1));
  }

  // 祈愿牌架
  const ww = byType('wish_wall');
  const tabletSlots = [];
  if (ww) {
    const rot = ww.ry || 0;
    const along = V3(Math.cos(rot), 0, -Math.sin(rot));
    for (const k of [-1.6, 1.6]) B.add('wood', box, M(ww.x + along.x * k, 1.2, ww.z + along.z * k, 0, rot, 0, 0.16, 2.4, 0.16));
    for (const y of [1.15, 1.75]) B.add('wood', box, M(ww.x, y, ww.z, 0, rot, 0, 3.4, 0.08, 0.08));
    B.add('roof', box, M(ww.x, 2.45, ww.z, 0, rot, 0, 3.8, 0.12, 0.7));
    for (const y of [1.0, 1.6]) for (let i = 0; i < 11; i++) {
      const k = -1.45 + i * 0.29;
      tabletSlots.push({ x: ww.x + along.x * k, y, z: ww.z + along.z * k, ry: rot });
    }
  }

  // 签桌 / 木鱼
  const ft = byType('fortune_table');
  if (ft && S?.fortune) S.fortune(ctx, ft);
  else if (ft) {
    B.add('lacquer', box, M(ft.x, floorY + 0.45, ft.z, 0, ft.ry || 0, 0, 0.9, 0.9, 1.6));
    B.add('cloth', cyl, M(ft.x, floorY + 1.15, ft.z, 0, 0, 0, 0.13, 0.5, 0.13));
    for (let i = 0; i < 9; i++) B.add('wood', cyl8, M(ft.x + (rnd() - 0.5) * 0.12, floorY + 1.55, ft.z + (rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.15, 0, (rnd() - 0.5) * 0.15, 0.012, 0.45, 0.012));
    for (const dz of [-0.45, 0.45]) B.add('cloth', sph, M(ft.x, floorY + 0.95, ft.z + dz, 0, 0, 0, 0.12, 0.05, 0.07));
  }
  const my = byType('muyu');
  if (my) {
    B.add('lacquer', box, M(my.x, floorY + 0.3, my.z, 0, 0, 0, 0.9, 0.6, 0.9));
    B.add('cloth', cyl, M(my.x, floorY + 0.65, my.z, 0, 0, 0, 0.36, 0.1, 0.36));
    B.add('wood', sph, M(my.x, floorY + 0.92, my.z, 0, 0, 0, 0.32, 0.24, 0.28));
    B.add('wood', cyl8, M(my.x - 0.2, floorY + 0.75, my.z + 0.3, 0, 0.6, Math.PI / 2.3, 0.025, 0.5, 0.025));
  }

  // 山门牌坊
  const gate = byType('gate');
  const gateInfo = gate && S ? S.gate(ctx, gate) : null;
  if (gate && !S) {
    const gx = gate.x, gz = gate.z;
    for (const x of [-4.2, -1.6, 1.6, 4.2]) {
      B.add('stone', box, M(gx + x, 0.3, gz, 0, 0, 0, 0.9, 0.6, 0.9));
      B.add('lacquer', box, M(gx + x, 2.4, gz, 0, 0, 0, 0.42, 4.8, 0.42));
    }
    B.add('beam', box, M(gx, 4.2, gz, 0, 0, 0, 9.4, 0.4, 0.38));
    B.add('lacquer', box, M(gx, 4.75, gz, 0, 0, 0, 9.8, 0.25, 0.4));
    B.add('roof', hipRoof({ halfW: 2.4, halfD: 0.9, ridgeHalf: 1.6, ridgeY: 6.1, eaveY: 5.15, lift: 0.35, flare: 0.25, nu: 12, nv: 4 }), M(gx, 0, gz));
    for (const sx of [-1, 1]) B.add('roof', hipRoof({ halfW: 1.6, halfD: 0.8, ridgeHalf: 0.9, ridgeY: 5.5, eaveY: 4.75, lift: 0.3, flare: 0.2, nu: 10, nv: 4 }), M(gx + sx * 4.0, -0.3, gz));
  }

  // ---- scenery by slot type: 石塔, 手水舎, 狛犬, 蓮燈, 御神木の注連縄 (styles.js) ----
  const sceneryExtras = [], sceneryUpdates = [];
  for (const s of manifest.slots) {
    if (s.type === 'pagoda') SCENERY.pagoda(ctx, s);
    else if (s.type === 'temizuya') SCENERY.temizuya(ctx, s);
    else if (s.type === 'guardian') SCENERY.guardian(ctx, s);
    else if (s.type === 'tree' && s.rope) SCENERY.treeRope(ctx, s);
    else if (s.type === 'lantern_line') { const r = SCENERY.lanternLine(ctx, s); sceneryExtras.push(...r.extras); sceneryUpdates.push(r.update); }
  }
  const styleLights = S ? S.lights(ctx) : null;

  // ---- mountains, forest, courtyard walls, landmark trees, ponds (landscape.js) ----
  const land = addLandscape(B, M, { manifest, hall, season, quality });

  const group = B.build(mat);
  for (const m of land.extras) group.add(m);
  if (lampWall) for (const m of lampWall.extras) group.add(m);
  for (const m of sceneryExtras) group.add(m);
  if (styleLights) for (const m of styleLights.extras) group.add(m);

  // ---- dynamic / special objects ----
  // 匾额
  const plaqueMat = new THREE.MeshStandardMaterial({ map: TX.plaque(plaqueText || '雲上寺'), roughness: 0.5, metalness: 0.1 });
  const hp = S ? S.plaques(ctx).hall : { x: 0, y: colTop + 0.45, z: frontZ + 0.42, w: 4.2, h: 1.3 };
  const plq = new THREE.Mesh(new THREE.PlaneGeometry(hp.w, hp.h), plaqueMat);
  plq.position.set(hp.x, hp.y, hp.z);
  group.add(plq);
  if (gateInfo?.plaque) {
    const g = gateInfo.plaque;
    const m = g.vertical ? new THREE.MeshStandardMaterial({ map: TX.plaque(plaqueText || '雲上寺', { vertical: true }), roughness: 0.5, metalness: 0.1 }) : plaqueMat;
    const gp = new THREE.Mesh(new THREE.PlaneGeometry(g.w, g.h), m);
    gp.position.set(g.x, g.y, g.z);
    group.add(gp);
  } else if (gate) {
    const gp = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.75), plq.material);
    gp.position.set(gate.x, 4.2, gate.z + 0.21);
    group.add(gp);
  }

  // mandorla (背光) and textured / glowing interior pieces
  for (const m of shrineExtras) group.add(m);
  if (sculpt) addSculpt(group, { ...sculpt, materials: mat }); // arrives a moment after the hall; the seat waits for it
  for (const m of inside.extras) group.add(m);

  // cushions (蒲团) — one instanced draw call for all seats
  const seats = manifest.seats || [];
  // 蒲團: puffed round straw cushion with coiled rings (one instanced draw call)
  const puff = [[0, 0], [0.3, 0], [0.37, 0.02], [0.4, 0.06], [0.39, 0.11], [0.34, 0.15], [0.2, 0.17], [0, 0.17]];
  // 座布団 / 방석: square cushions for the Japanese and Korean halls
  const square = S?.cushion?.shape === 'square';
  const cushionGeo = square ? new THREE.BoxGeometry(0.7, 0.1, 0.7, 2, 1, 2).translate(0, 0.05, 0) : lathe(puff, 16);
  const cushionTex = TX.cushionWeave();
  const cushion = new THREE.InstancedMesh(cushionGeo, new THREE.MeshStandardMaterial(square ? { color: S.cushion.color, roughness: 0.95 } : { map: cushionTex, color: '#c8a46a', roughness: 0.95 }), seats.length);
  seats.forEach((s, i) => cushion.setMatrixAt(i, M(s.x, floorY, s.z)));
  cushion.receiveShadow = true; cushion.castShadow = quality === 'high';
  group.add(cushion);

  // wish tablets (instanced, count grows with the wall)
  const tablets = new THREE.InstancedMesh(S?.tabletGeo ? S.tabletGeo() : new THREE.BoxGeometry(0.2, 0.3, 0.025), S?.tabletGeo ? mat.hinoki : mat.tablet, Math.max(1, tabletSlots.length));
  tablets.count = 0;
  group.add(tablets);
  const setTablets = (n) => {
    const k = Math.min(n, tabletSlots.length);
    for (let i = 0; i < k; i++) { const t = tabletSlots[i]; tablets.setMatrixAt(i, M(t.x, t.y - 0.2, t.z, (rnd() - 0.5) * 0.1, t.ry + Math.PI / 2, (rnd() - 0.5) * 0.12)); }
    tablets.count = k; tablets.instanceMatrix.needsUpdate = true;
  };

  // warm lights: candles + lanterns (only a few real lights; the rest is emissive)
  const lanternGlow = new THREE.MeshStandardMaterial({ color: '#2a2018', emissive: '#ffb45e', emissiveIntensity: 0.2 });
  for (const l of lanternGlows) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(l.size, l.size, l.size), lanternGlow);
    m.position.set(l.x, l.y, l.z); group.add(m);
  }
  const redLantern = new THREE.MeshStandardMaterial({ color: '#8e1f14', emissive: '#ff5a2a', emissiveIntensity: 0.25, roughness: 0.6 });
  for (const sx of S ? [] : [-1, 1]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.45, 18, 12), redLantern);
    m.scale.set(1, 1.15, 1);
    m.position.set(sx * 5.9, colTop - 1.4, frontZ + 0.6); group.add(m);
  }
  const candles = inside.flames;
  const altarLight = new THREE.PointLight('#ffb36b', 14, 16, 1.4);
  if (altar) altarLight.position.set(altar.x, floorY + 2.5, altar.z + 3.2);
  group.add(altarLight);
  const burnerLight = new THREE.PointLight('#ff9a4a', 0, 8, 1.6);
  if (bz) burnerLight.position.set(bz.x, 2.3, bz.z);
  group.add(burnerLight);

  // incense sticks in the burner (instanced, recycled)
  const MAXS = 96;
  const stickGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5); stickGeo.translate(0, 0.5, 0);
  const sticks = new THREE.InstancedMesh(stickGeo, new THREE.MeshStandardMaterial({ color: '#7e2f1e', roughness: 0.8 }), MAXS);
  const tips = new THREE.InstancedMesh(new THREE.SphereGeometry(0.02, 6, 4), new THREE.MeshBasicMaterial({ color: '#ff6a2a' }), MAXS);
  sticks.count = tips.count = 0;
  group.add(sticks, tips);
  const stickState = [];
  /** item: undefined = 三炷清香; 'incense_high' = 高香 (taller); 'incense_dragon' = 龍鳳香 (one thick, long stick). */
  function plantIncense(smoke, item) {
    if (!bz) return;
    const r = 0.45 * Math.sqrt(rnd()), a = rnd() * Math.PI * 2;
    const cx = bz.x + Math.cos(a) * r, cz = bz.z + Math.sin(a) * r;
    const dragon = item === 'incense_dragon', high = item === 'incense_high';
    const n = dragon ? 1 : 3, lenK = dragon ? 2.1 : high ? 1.55 : 1, thick = dragon ? 3.2 : high ? 1.5 : 1;
    for (let k = 0; k < n; k++) {
      const x = cx + (dragon ? 0 : (k - 1) * 0.05), z = cz + (rnd() - 0.5) * 0.02;
      const len = (0.62 + rnd() * 0.06) * lenK;
      stickState.push({ x, z, len, thick, born: performance.now() / 1000, tilt: (rnd() - 0.5) * (dragon ? 0.03 : 0.1) });
      if (smoke) smoke.emitter(V3(x, 1.7 + len, z), 120, 4 * thick);
    }
    while (stickState.length > MAXS) stickState.shift();
  }
  function updateSticks() {
    const now = performance.now() / 1000;
    stickState.forEach((s, i) => {
      const burnt = Math.min(0.75, (now - s.born) / 600); // burns down over 10 minutes
      const L = s.len * (1 - burnt);
      sticks.setMatrixAt(i, M(s.x, 1.7, s.z, s.tilt, 0, s.tilt * 0.7, s.thick || 1, L, s.thick || 1));
      tips.setMatrixAt(i, M(s.x + Math.sin(s.tilt * 0.7) * -L, 1.7 + L, s.z + Math.sin(s.tilt) * L, 0, 0, 0, 1));
    });
    sticks.count = tips.count = stickState.length;
    sticks.instanceMatrix.needsUpdate = tips.instanceMatrix.needsUpdate = true;
  }

  // stand `dist` in front of a slot (its front faces ry), turned to look at it
  const facing = (s, dist) => { const ry = s.ry ?? 0; return { x: s.x + Math.sin(ry) * dist, z: s.z + Math.cos(ry) * dist, ry: ry + Math.PI }; };
  const anchors = {
    burner: bz && { x: bz.x, z: bz.z + 2.3, ry: Math.PI },
    fortune: ft && facing(ft, 1.35),
    muyu: my && facing(my, 1.0),
    wish: ww && facing(ww, 1.6),
    bell: bell && { x: bell.x - 2.0, z: bell.z, ry: Math.PI / 2 },
    altar: altar && { x: altar.x, z: altar.z + 4.2, ry: Math.PI },
    lamp: lampWall?.anchor,
  };
  const setLamps = (list, opts) => (lampWall ? lampWall.setLamps(list, opts) : new Map());

  function update(t, envState) {
    const night = envState.night;
    lanternGlow.emissiveIntensity = night ? 2.4 : 0.15;
    redLantern.emissiveIntensity = night ? 1.6 : 0.25;
    altarLight.intensity = (night ? 22 : 12) * (0.92 + Math.sin(t * 9) * 0.04 + Math.sin(t * 13.7) * 0.03);
    burnerLight.intensity = stickState.length ? (night ? 6 : 1.5) : 0;
    for (const c of candles) c.scale.set(1, 2.2 + Math.sin(t * 11 + c.position.x * 7) * 0.3, 1);
    inside.lanternMat.emissiveIntensity = night ? 0.85 : 0.3; // higher washes the red silk out to cream
    land.update(t);
    styleLights?.update(t, night);
    for (const u of sceneryUpdates) u(t, night);
    lampWall?.update(t, night);
    updateSticks();
  }

  group.traverse((o) => { if (o.isMesh && o.name === 'roof') o.castShadow = true; });
  return { group, anchors, plantIncense, setTablets, setLamps, update, floorY };
}
