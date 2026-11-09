// 燈牆（設計文檔 3.2「點亮後供於燈牆，燈牆上可見自己的燈」）。
// Driven by a `lamp_wall` slot: { x, z, ry, rows, cols }. The wall faces local +z, turned by ry.
// Niches and lamp bases are static (Batch); lit lamps are two instanced meshes (flame + halo),
// so 108 lamps cost two draw calls.
import * as THREE from 'three';
import * as TX from './textures.js';

const CELL_W = 0.3, CELL_H = 0.36; // keep in sync with collide.js (lamp_wall footprint)
// glow colour per lamp kind: 光明 warm gold, 藥師 lapis blue (琉璃光), 長明 amber red, 祈福 soft gold
export const LAMP_COLORS = { guangming: '#ffc861', yaoshi: '#7fb4ff', changming: '#ff8a4a', qifu: '#ffd88a' };

/** World matrix for a point in wall space (u along the wall, v up, w out of the wall). */
function wallFrame(slot, floorY) {
  const ry = slot.ry || 0;
  const right = new THREE.Vector3(Math.cos(ry), 0, -Math.sin(ry));
  const out = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
  const origin = new THREE.Vector3(slot.x, floorY, slot.z);
  return { ry, right, out, at: (u, v, w) => origin.clone().addScaledVector(right, u).addScaledVector(out, w).setY(floorY + v) };
}

/** Fill order: eye-level rows first, centre columns first, so a few lamps already look intentional. */
function fillOrder(rows, cols) {
  const eye = Math.min(rows - 1, 2);
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ r, c });
  return cells.sort((a, b) => (Math.abs(a.r - eye) - Math.abs(b.r - eye)) || (Math.abs(a.c - (cols - 1) / 2) - Math.abs(b.c - (cols - 1) / 2)));
}

export function addLampWall(B, M, { slot, floorY, mode }) {
  const rows = slot.rows || 6, cols = slot.cols || 18;
  const F = wallFrame(slot, floorY);
  const W = cols * CELL_W, H = rows * CELL_H, base = 0.85;
  const box = new THREE.BoxGeometry(1, 1, 1);
  const place = (key, geo, u, v, w, sx, sy, sz) => { const p = F.at(u, v, w); B.add(key, geo, M(p.x, p.y, p.z, 0, F.ry, 0, sx, sy, sz)); };

  // cabinet: back panel, plinth, side posts, cornice; shelves and dividers form the niches
  place('lampWood', box, 0, base + H / 2, -0.2, W + 0.3, H + 0.1, 0.06);
  place('lacquer', box, 0, base / 2, 0, W + 0.4, base, 0.5);
  for (const s of [-1, 1]) place('lacquer', box, s * (W / 2 + 0.1), base + H / 2, 0, 0.2, H + 0.1, 0.5);
  place('lacquer', box, 0, base + H + 0.12, 0, W + 0.5, 0.24, 0.56);
  place('gold', box, 0, base + H + 0.01, 0.27, W + 0.3, 0.04, 0.02);
  for (let r = 0; r <= rows; r++) {
    place('lampWood', box, 0, base + r * CELL_H, 0, W, 0.025, 0.42);
    place('gold', box, 0, base + r * CELL_H + 0.005, 0.212, W, 0.012, 0.006);
  }
  for (let c = 1; c < cols; c++) place('lampWood', box, -W / 2 + c * CELL_W, base + H / 2, 0, 0.018, H, 0.4);
  // small lotus lamp base in every niche (lit or not)
  const cup = new THREE.LatheGeometry([[0, 0], [0.045, 0], [0.03, 0.03], [0.06, 0.07], [0.075, 0.1], [0, 0.09]].map(([a, b]) => new THREE.Vector2(a, b)), 10);
  const cells = fillOrder(rows, cols);
  const pos = cells.map(({ r, c }) => ({ r, c, ...F.at(-W / 2 + (c + 0.5) * CELL_W, base + r * CELL_H + 0.015, 0.02) }));
  for (const p of pos) B.add('gold', cup, M(p.x, p.y, p.z));

  // plaque on the cornice
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.46), new THREE.MeshStandardMaterial({ map: TX.plaque(mode === 'cultural' ? '祈福燈' : '光明燈'), roughness: 0.5 }));
  plaque.position.copy(F.at(0, base + H + 0.48, 0.25)); plaque.rotation.y = F.ry;

  // lit lamps: a flame and a soft halo per lamp, coloured by kind
  const n = pos.length;
  const flame = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 8, 6).scale(1, 1.9, 1), new THREE.MeshBasicMaterial({ color: '#ffffff' }), n);
  const halo = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.34, 0.34), new THREE.MeshBasicMaterial({
    map: TX.softDot('#ffffff'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7,
  }), n);
  flame.count = halo.count = 0;
  flame.frustumCulled = halo.frustumCulled = false;
  // the visitor's own lamp (or the one a blessing card points to) gets a slow breathing ring
  const mark = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.15, 32), new THREE.MeshBasicMaterial({ color: '#ffe3a0', transparent: true, opacity: 0, depthWrite: false }));
  mark.rotation.y = F.ry;
  const light = new THREE.PointLight('#ffbf70', 0, 7, 1.6);
  light.position.copy(F.at(0, base + H / 2, 1.2));

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, F.ry, 0)), one = new THREE.Vector3(1, 1, 1);
  const col = new THREE.Color();
  let marked = [];
  /** list: lamps sorted oldest first ({ id, kind, mine }); returns the cell for each id. */
  function setLamps(list, { highlight = null } = {}) {
    const shown = list.slice(-n); // a full wall shows the newest 108
    const where = new Map();
    marked = [];
    shown.forEach((l, i) => {
      const p = pos[i];
      m4.compose(new THREE.Vector3(p.x, p.y + 0.14, p.z), q, one);
      flame.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(p.x, p.y + 0.14, p.z).addScaledVector(F.out, 0.05), q, one);
      halo.setMatrixAt(i, m4);
      col.set(LAMP_COLORS[l.kind] || LAMP_COLORS.qifu);
      flame.setColorAt(i, col); halo.setColorAt(i, col);
      where.set(l.id, { row: rows - p.r, col: p.c + 1, pos: new THREE.Vector3(p.x, p.y + 0.14, p.z) });
      if (l.id === highlight || (!highlight && l.mine)) marked.push(where.get(l.id).pos);
    });
    flame.count = halo.count = shown.length;
    for (const im of [flame, halo]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    light.intensity = Math.min(1, shown.length / 20);
    return where;
  }

  function update(t, night) {
    light.intensity = Math.min(1, flame.count / 20) * (night ? 4 : 1.2) * (0.94 + Math.sin(t * 7.3) * 0.06);
    halo.material.opacity = (night ? 0.85 : 0.55) * (0.93 + Math.sin(t * 5.1) * 0.07);
    if (marked.length) {
      const p = marked[Math.floor(t / 3) % marked.length];
      mark.position.copy(p).addScaledVector(F.out, 0.07);
      mark.material.opacity = 0.35 + 0.35 * Math.sin(t * 2.2);
      mark.scale.setScalar(1 + 0.15 * Math.sin(t * 2.2));
    } else mark.material.opacity = 0;
  }

  const anchor = (() => { const p = F.at(0, 0, 1.8); return { x: p.x, z: p.z, ry: F.ry + Math.PI }; })();
  return { extras: [plaque, flame, halo, mark, light], setLamps, update, anchor, capacity: n };
}
