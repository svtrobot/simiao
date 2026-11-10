// Architecture vocabularies for procedural halls (manifest.style.architecture).
// A style answers "what does a column / roof / gate / lantern look like here"; WHERE things stand
// still comes from the manifest (hall rect, slots), so any number of Korean temples or Japanese
// shrines are just more manifests. 'cn-hall' is the original builder in temple.js.
//
//   kr-temple  韓式山寺：丹青彩繪、八作屋頂、一柱門、石塔、石燈、蓮燈
//   jp-shrine  神社：朱塗、銅板葺入母屋＋向拝、千木鰹木、鳥居、注連縄、石燈籠、手水舎、狛犬、御神籤、繪馬
//
// 參照的是建築類型，不是任何一座真實寺社的外觀（設計文檔 8.2 授權）。
import * as THREE from 'three';
import * as TX from './textures.js';

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** 丹青: green ground, banded ends (머리초) with red / blue / white / ochre rings. One tile ≈ 1.5 m of beam. */
function dancheong() {
  return canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#2f6b57'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1d3f5c'; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
    g.fillStyle = '#e9e4d6'; g.fillRect(0, 6, w, 2); g.fillRect(0, h - 8, w, 2);
    const motif = (cx) => {
      for (const [r, c] of [[26, '#b0402a'], [21, '#e9e4d6'], [17, '#2c5a8a'], [12, '#e8b84a'], [7, '#b0402a'], [3, '#e9e4d6']]) {
        g.fillStyle = c; g.beginPath(); g.ellipse(cx, h / 2, r * 0.9, Math.min(r, 25), 0, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = '#b0402a';
      for (const dx of [-38, 38]) { g.beginPath(); g.moveTo(cx + dx, 10); g.lineTo(cx + dx * 0.78, h / 2); g.lineTo(cx + dx, h - 10); g.lineTo(cx + dx * 1.15, h / 2); g.fill(); }
    };
    motif(w / 2);
    g.fillStyle = '#e8b84a'; for (let x = 4; x < w; x += 16) g.fillRect(x, 9, 6, 3);
  });
}

/** Box with u stretched to the beam length, so the 丹青 repeats instead of smearing. */
function beamGeo(len, tile = 1.5) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * Math.max(1, len / tile));
  return g;
}

/** Vertical triangle (a gable end), in the yz plane, base on y = 0. */
function gableGeo(halfD, h) {
  const s = new THREE.Shape(); s.moveTo(-halfD, 0); s.lineTo(halfD, 0); s.lineTo(0, h); s.closePath();
  const g = new THREE.ShapeGeometry(s); g.rotateY(Math.PI / 2);
  return g;
}

/** A sagging rope / string between two points. */
function ropeGeo(a, b, sag, radius, segs = 24) {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const k = i / 8;
    pts.push(new THREE.Vector3(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k - sag * 4 * k * (1 - k), a.z + (b.z - a.z) * k));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, radius, 6, false);
}

/** 紙垂: a zigzag strip of white paper. */
function shide(B, M, x, y, z, ry = 0, s = 1) {
  const g = new THREE.BoxGeometry(0.09 * s, 0.13 * s, 0.006);
  for (let i = 0; i < 4; i++) B.add('paperW', g, M(x + (i % 2 ? 0.05 : -0.02) * s * Math.cos(ry), y - i * 0.12 * s, z - (i % 2 ? 0.05 : -0.02) * s * Math.sin(ry), 0, ry, i % 2 ? 0.25 : -0.25));
}

/** Place a point given in a slot's local frame (x right, z forward when ry = 0). */
const local = (s, ry) => (dx, dz) => [s.x + dx * Math.cos(ry) + dz * Math.sin(ry), s.z - dx * Math.sin(ry) + dz * Math.cos(ry)];

// =============================================================== 韓式山寺

const KR = {
  buddhist: true,
  cushion: { shape: 'square', color: '#6b3a2e' },
  materials() {
    const dan = dancheong();
    return {
      kcol: new THREE.MeshStandardMaterial({ color: '#7d3324', roughness: 0.62 }),
      dan: new THREE.MeshStandardMaterial({ map: dan, roughness: 0.6 }),
      kgreen: new THREE.MeshStandardMaterial({ color: '#2f6b57', roughness: 0.6 }),
      kred: new THREE.MeshStandardMaterial({ color: '#a8382a', roughness: 0.6 }),
      kblue: new THREE.MeshStandardMaterial({ color: '#2c5a8a', roughness: 0.6 }),
      kochre: new THREE.MeshStandardMaterial({ color: '#d8a845', roughness: 0.6 }),
      kwhite: new THREE.MeshStandardMaterial({ color: '#ebe5d6', roughness: 0.95 }),
      kpaper: new THREE.MeshStandardMaterial({ color: '#efe6cf', roughness: 1, emissive: '#3a2a10', emissiveIntensity: 0.15 }),
      kdoor: new THREE.MeshStandardMaterial({ color: '#7a5636', roughness: 0.7 }),
      wallYellow: new THREE.MeshStandardMaterial({ color: '#cbb995', roughness: 0.95 }),
    };
  },

  frame(c) {
    const { B, M, mat, hall, floorY, colTop, frontZ, hw, hd, hcx, hcz, frame, box, cyl, cyl8 } = c;
    void mat;
    const colH = frame.colH;
    const column = (x, z) => {
      B.add('stoneDark', cyl8, M(x, floorY + 0.12, z, 0, 0, 0, 0.48, 0.24, 0.48));
      B.add('kcol', cyl, M(x, floorY + colH / 2, z, 0, 0, 0, 0.28, colH, 0.28));
    };
    for (const x of frame.front) column(x, frontZ);
    for (const [x, z] of frame.inner) column(x, z);
    // 창방 / 평방: painted lintels across the front, and round the other three sides
    B.add('dan', beamGeo(hw + 0.2), M(hcx, colTop - 0.25, frontZ, 0, 0, 0, hw + 0.2, 0.46, 0.36));
    B.add('dan', beamGeo(hw + 0.5), M(hcx, colTop + 0.1, frontZ, 0, 0, 0, hw + 0.5, 0.22, 0.52));
    B.add('dan', beamGeo(hw), M(hcx, colTop - 0.25, hall.z0 + 0.3, 0, 0, 0, hw, 0.46, 0.44));
    for (const sx of [-1, 1]) B.add('dan', beamGeo(hd), M(sx * (hw / 2 - 0.2), colTop - 0.25, hcz - 0.35, 0, Math.PI / 2, 0, hd - 1.0, 0.46, 0.44));
    // 다포 brackets every bay-third: block, red arm, green arm, ochre cap, layered outward
    for (let x = hall.x0 + 0.5; x <= hall.x1 - 0.5; x += 1.1) {
      B.add('kgreen', box, M(x, colTop + 0.36, frontZ + 0.05, 0, 0, 0, 0.36, 0.26, 0.52));
      B.add('kred', box, M(x, colTop + 0.56, frontZ + 0.16, 0, 0, 0, 0.78, 0.14, 0.32));
      B.add('kblue', box, M(x, colTop + 0.72, frontZ + 0.32, 0, 0, 0, 0.32, 0.2, 0.74));
      B.add('kochre', box, M(x, colTop + 0.88, frontZ + 0.46, 0, 0, 0, 0.92, 0.1, 0.3));
    }
    // walls: white plaster between wooden bands (중방 / 하방)
    const wallH = colH + 0.25;
    B.add('kwhite', box, M(hcx, floorY + wallH / 2, hall.z0 + 0.3, 0, 0, 0, hw, wallH, 0.36));
    for (const sx of [-1, 1]) B.add('kwhite', box, M(sx * (hw / 2 - 0.2), floorY + wallH / 2, hcz - 0.35, 0, 0, 0, 0.36, wallH, hd - 1.2));
    for (const y of [floorY + 0.4, floorY + wallH * 0.55]) {
      B.add('kcol', box, M(hcx, y, hall.z0 + 0.5, 0, 0, 0, hw - 0.4, 0.16, 0.06));
      for (const sx of [-1, 1]) B.add('kcol', box, M(sx * (hw / 2 - 0.4), y, hcz - 0.35, 0, 0, 0, 0.06, 0.16, hd - 1.4));
    }
    // 꽃살문: latticed paper doors on the two end bays; the middle three stand open
    for (const b of [0, frame.bays - 1]) {
      const xa = frame.front[b], xb = frame.front[b + 1], cx = (xa + xb) / 2, bw = xb - xa - 0.42;
      B.add('kdoor', box, M(cx, floorY + 0.45, frontZ, 0, 0, 0, bw, 0.9, 0.12));
      const top = floorY + 0.9, ph = colH - 1.45;
      B.add('kpaper', box, M(cx, top + ph / 2, frontZ - 0.02, 0, 0, 0, bw, ph, 0.03));
      for (let k = 0; k <= 4; k++) B.add('kdoor', box, M(cx - bw / 2 + k * bw / 4, top + ph / 2, frontZ + 0.02, 0, 0, 0, 0.08, ph, 0.08));
      for (let k = 0; k <= 9; k++) B.add('kdoor', box, M(cx, top + k * ph / 9, frontZ + 0.02, 0, 0, 0, bw, 0.05, 0.07));
      // carved flower lattice in the upper panel: small diagonal crosses
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
        const fx = cx - bw / 2 + (i + 0.5) * bw / 4, fy = top + ph - 0.45 - j * 0.42;
        for (const r of [Math.PI / 4, -Math.PI / 4]) B.add('kochre', box, M(fx, fy, frontZ + 0.05, 0, 0, r, 0.04, 0.34, 0.03));
      }
    }
  },

  /** 팔작지붕: hipped below, gabled above, with long sweeping lifted corners. */
  roof(c) {
    const { B, M, hw, hd, hcx, hcz, colTop, hipRoof, box, cyl8 } = c;
    const halfW = hw / 2 + 2.3, halfD = hd / 2 + 2.5, ridgeHalf = hw / 2 - 3.4, ridgeY = colTop + 4.2, eaveY = colTop + 1.2;
    const lift = 1.55, flare = 1.15;
    B.add('roof', hipRoof({ halfW, halfD, ridgeHalf, ridgeY, eaveY, lift, flare }), M(hcx, 0, hcz));
    for (const sx of [-1, 1]) {
      B.add('kcol', gableGeo(halfD * 0.42, 1.9), M(hcx + sx * (ridgeHalf + 0.35), ridgeY - 1.75, hcz));
      B.add('kwhite', gableGeo(halfD * 0.3, 1.25), M(hcx + sx * (ridgeHalf + 0.38), ridgeY - 1.62, hcz));
    }
    // 용마루: dark ridge with a white lime band, 취두 rising at both ends
    B.add('ridge', box, M(hcx, ridgeY + 0.28, hcz, 0, 0, 0, ridgeHalf * 2 + 1.0, 0.52, 0.52));
    B.add('kwhite', box, M(hcx, ridgeY + 0.16, hcz, 0, 0, 0, ridgeHalf * 2 + 0.9, 0.16, 0.58));
    for (const sx of [-1, 1]) B.add('ridge', box, M(hcx + sx * (ridgeHalf + 0.55), ridgeY + 0.8, hcz, 0, 0, sx * 0.28, 0.36, 1.1, 0.46));
    // 서까래: painted rafter ends under the front and back eaves, following the corner lift
    for (let x = -halfW + 0.6; x <= halfW - 0.6; x += 0.34) {
      const u = Math.abs(x) / halfW, k = u ** 4;
      for (const sz of [1, -1]) {
        B.add(k > 0.3 ? 'kred' : 'kgreen', cyl8, M(hcx + x, eaveY - 0.22 + lift * k * 0.9, hcz + sz * (halfD - 0.4 + flare * k * 0.8), Math.PI / 2, 0, 0, 0.075, 0.7, 0.075));
      }
    }
  },

  /** 일주문: two pillars in one line under a heavy bracketed roof. */
  gate(c, s) {
    const { B, M, box, cyl, cyl8, hipRoof, frame } = c;
    for (const x of frame.gatePosts) {
      B.add('stone', cyl8, M(s.x + x, 0.3, s.z, 0, 0, 0, 0.62, 0.6, 0.62));
      B.add('kcol', cyl, M(s.x + x, 2.6, s.z, 0, 0, 0, 0.32, 4.6, 0.32));
    }
    B.add('dan', beamGeo(6.2), M(s.x, 4.7, s.z, 0, 0, 0, 6.2, 0.46, 0.44));
    B.add('dan', beamGeo(6.6), M(s.x, 5.08, s.z, 0, 0, 0, 6.6, 0.22, 0.62));
    for (let x = -3.0; x <= 3.01; x += 0.6) {
      for (const sz of [1, -1]) {
        B.add('kred', box, M(s.x + x, 5.32, s.z + sz * 0.3, 0, 0, 0, 0.5, 0.14, 0.4));
        B.add('kgreen', box, M(s.x + x, 5.48, s.z + sz * 0.5, 0, 0, 0, 0.28, 0.18, 0.5));
      }
    }
    B.add('roof', hipRoof({ halfW: 4.6, halfD: 2.0, ridgeHalf: 2.6, ridgeY: 7.7, eaveY: 6.0, lift: 0.9, flare: 0.65, nu: 18, nv: 6 }), M(s.x, 0, s.z));
    B.add('ridge', box, M(s.x, 7.85, s.z, 0, 0, 0, 5.8, 0.36, 0.36));
    B.add('kwhite', box, M(s.x, 7.76, s.z, 0, 0, 0, 5.7, 0.12, 0.4));
    return { plaque: { x: s.x, y: 4.7, z: s.z + 0.24, w: 2.4, h: 0.62 } };
  },

  /** 범종각 with a Korean bell (rounder shoulders, no flared lip) and a hanging log striker. */
  bell(c, s) {
    const { B, M, box, cyl, cyl8, lathe, hipRoof } = c;
    for (const [dx, dz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) B.add('kcol', cyl, M(s.x + dx, 1.9, s.z + dz, 0, 0, 0, 0.16, 3.8, 0.16));
    B.add('stone', box, M(s.x, 0.15, s.z, 0, 0, 0, 3.8, 0.3, 3.8));
    B.add('dan', beamGeo(3.2), M(s.x, 3.75, s.z + 1.4, 0, 0, 0, 3.2, 0.24, 0.2));
    B.add('dan', beamGeo(3.2), M(s.x, 3.75, s.z - 1.4, 0, 0, 0, 3.2, 0.24, 0.2));
    B.add('kgreen', box, M(s.x, 3.6, s.z, 0, 0, 0, 0.2, 0.2, 3.0));
    B.add('roof', hipRoof({ halfW: 2.7, halfD: 2.7, ridgeHalf: 0.9, ridgeY: 5.7, eaveY: 3.95, lift: 0.7, flare: 0.5, nu: 12, nv: 6 }), M(s.x, 0, s.z));
    B.add('bronze', lathe([[0, 1.45], [0.38, 1.4], [0.56, 1.18], [0.6, 0.7], [0.62, 0.2], [0.6, 0], [0, 0.02]], 24), M(s.x, 1.85, s.z));
    B.add('bronze', new THREE.TorusGeometry(0.12, 0.04, 6, 12), M(s.x, 3.4, s.z));
    B.add('wood', cyl8, M(s.x, 2.5, s.z + 1.05, Math.PI / 2, 0, 0, 0.11, 1.3, 0.11));
  },

  /** 석등: octagonal stone lantern on a lotus base. Returns where its light glows. */
  lantern(c, s) {
    const { B, M, cyl8, lathe, yAt } = c;
    const y = yAt(s.x, s.z);
    B.add('stone', cyl8, M(s.x, y + 0.12, s.z, 0, Math.PI / 8, 0, 0.62, 0.24, 0.62));
    B.add('stone', lathe([[0.5, 0], [0.42, 0.14], [0.2, 0.22], [0, 0.22]], 8), M(s.x, y + 0.24, s.z));
    B.add('stone', cyl8, M(s.x, y + 0.95, s.z, 0, Math.PI / 8, 0, 0.14, 1.1, 0.14));
    B.add('stone', lathe([[0, 0], [0.2, 0.02], [0.42, 0.14], [0.45, 0.2], [0, 0.2]], 8), M(s.x, y + 1.48, s.z));
    B.add('stone', new THREE.CylinderGeometry(0.3, 0.3, 0.5, 8, 1, true), M(s.x, y + 1.93, s.z, 0, Math.PI / 8, 0));
    B.add('stone', new THREE.ConeGeometry(0.58, 0.34, 8), M(s.x, y + 2.35, s.z, 0, Math.PI / 8, 0));
    B.add('stone', new THREE.SphereGeometry(0.12, 10, 8), M(s.x, y + 2.6, s.z));
    return { x: s.x, y: y + 1.93, z: s.z, size: 0.44 };
  },

  plaques(c) {
    const { colTop, frontZ, hcx } = c;
    return { hall: { x: hcx, y: colTop + 0.62, z: frontZ + 0.66, w: 3.4, h: 1.05 } };
  },

  lights() { return { extras: [], update() {} }; },
};

// =============================================================== 神社

const JP = {
  buddhist: false,
  cushion: { shape: 'square', color: '#4b3b5e' },
  materials(pal) {
    return {
      shu: new THREE.MeshStandardMaterial({ color: pal.wood || '#c8432b', roughness: 0.5 }),
      jwhite: new THREE.MeshStandardMaterial({ color: '#efebe0', roughness: 0.95 }),
      jblack: new THREE.MeshStandardMaterial({ color: '#211f1d', roughness: 0.45 }),
      roof: new THREE.MeshStandardMaterial({ color: pal.roof || '#5f8a79', roughness: 0.55, metalness: 0.18, side: THREE.DoubleSide }),
      ridge: new THREE.MeshStandardMaterial({ color: '#4e7566', roughness: 0.55, metalness: 0.2 }),
      hinoki: new THREE.MeshStandardMaterial({ color: '#c4a074', roughness: 0.7 }),
      straw: new THREE.MeshStandardMaterial({ color: '#cdb57c', roughness: 1 }),
      paperW: new THREE.MeshStandardMaterial({ color: '#f7f5ef', roughness: 1, side: THREE.DoubleSide }),
      mirror: new THREE.MeshStandardMaterial({ color: '#d9d3c3', metalness: 1, roughness: 0.16 }),
      water: new THREE.MeshStandardMaterial({ color: '#3d6670', roughness: 0.08, metalness: 0.1 }),
      sakaki: new THREE.MeshStandardMaterial({ color: '#2f5a33', roughness: 0.8, flatShading: true }),
      maku: new THREE.MeshStandardMaterial({ color: '#4c2f5e', roughness: 0.9, side: THREE.DoubleSide }),
      wallYellow: new THREE.MeshStandardMaterial({ color: '#e9e3d5', roughness: 0.95 }),
    };
  },

  frame(c) {
    const { B, M, hall, floorY, colTop, frontZ, hw, hd, hcx, hcz, frame, box, cyl, cyl8 } = c;
    const colH = frame.colH;
    const column = (x, z) => {
      B.add('stoneDark', cyl8, M(x, floorY + 0.1, z, 0, 0, 0, 0.42, 0.2, 0.42));
      B.add('shu', cyl, M(x, floorY + colH / 2, z, 0, 0, 0, 0.24, colH, 0.24));
    };
    for (const x of frame.front) column(x, frontZ);
    for (const [x, z] of frame.inner) column(x, z);
    // 長押 and head ties
    B.add('shu', box, M(hcx, colTop - 0.18, frontZ, 0, 0, 0, hw + 0.1, 0.3, 0.3));
    B.add('shu', box, M(hcx, colTop - 1.0, frontZ + 0.02, 0, 0, 0, hw, 0.18, 0.24));
    // 斗栱: plain unpainted bearing blocks over each column
    for (const x of frame.front) {
      B.add('hinoki', box, M(x, colTop + 0.12, frontZ, 0, 0, 0, 0.46, 0.24, 0.46));
      B.add('hinoki', box, M(x, colTop + 0.32, frontZ + 0.18, 0, 0, 0, 1.1, 0.16, 0.3));
      B.add('hinoki', box, M(x, colTop + 0.48, frontZ + 0.36, 0, 0, 0, 0.4, 0.16, 0.6));
    }
    // walls: white plaster framed in vermilion
    const wallH = colH + 0.15;
    B.add('jwhite', box, M(hcx, floorY + wallH / 2, hall.z0 + 0.3, 0, 0, 0, hw, wallH, 0.32));
    for (const sx of [-1, 1]) B.add('jwhite', box, M(sx * (hw / 2 - 0.2), floorY + wallH / 2, hcz - 0.35, 0, 0, 0, 0.32, wallH, hd - 1.2));
    for (const y of [floorY + 0.25, floorY + wallH - 0.9, floorY + wallH - 0.1]) {
      B.add('shu', box, M(hcx, y, hall.z0 + 0.48, 0, 0, 0, hw - 0.3, 0.16, 0.06));
      for (const sx of [-1, 1]) B.add('shu', box, M(sx * (hw / 2 - 0.38), y, hcz - 0.35, 0, 0, 0, 0.06, 0.16, hd - 1.3));
    }
    for (let x = hall.x0 + 0.6; x <= hall.x1 - 0.6; x += (hw - 1.2) / 6) B.add('shu', box, M(x, floorY + wallH / 2, hall.z0 + 0.48, 0, 0, 0, 0.16, wallH, 0.06));
    // 蔀戸: black lattice shutters over white panels on the end bays
    for (const b of [0, frame.bays - 1]) {
      const xa = frame.front[b], xb = frame.front[b + 1], cx = (xa + xb) / 2, bw = xb - xa - 0.36;
      B.add('jwhite', box, M(cx, floorY + 0.5, frontZ, 0, 0, 0, bw, 1.0, 0.1));
      const top = floorY + 1.0, ph = colH - 2.0;
      B.add('jwhite', box, M(cx, top + ph / 2, frontZ - 0.03, 0, 0, 0, bw, ph, 0.03));
      for (let k = 0; k <= 10; k++) B.add('jblack', box, M(cx - bw / 2 + k * bw / 10, top + ph / 2, frontZ + 0.02, 0, 0, 0, 0.04, ph, 0.05));
      for (let k = 0; k <= 8; k++) B.add('jblack', box, M(cx, top + k * ph / 8, frontZ + 0.02, 0, 0, 0, bw, 0.04, 0.05));
    }
    // 注連縄 across the open bays, with 紙垂
    const xa = frame.front[1] + 0.3, xb = frame.front[frame.bays - 1] - 0.3, ry = colTop - 0.6, rz = frontZ + 0.28;
    B.add('straw', ropeGeo(new THREE.Vector3(xa, ry, rz), new THREE.Vector3(xb, ry, rz), 0.45, 0.13), M());
    for (let x = xa + 1.2; x < xb - 0.6; x += 1.9) {
      const k = (x - xa) / (xb - xa);
      shide(B, M, x, ry - 0.45 * 4 * k * (1 - k) - 0.1, rz + 0.05, 0, 1.4);
    }
    // 鈴 and its rope, 賽銭箱 below
    B.add('gold', new THREE.SphereGeometry(0.2, 14, 10), M(0, colTop - 0.95, frontZ + 0.32));
    B.add('shu', cyl8, M(-0.03, floorY + 1.7, frontZ + 0.32, 0, 0, 0, 0.035, colTop - floorY - 2.6, 0.035));
    B.add('jwhite', cyl8, M(0.03, floorY + 1.7, frontZ + 0.32, 0, 0, 0, 0.035, colTop - floorY - 2.6, 0.035));
    B.add('hinoki', box, M(0, floorY + 0.36, frontZ + 0.55, 0, 0, 0, 1.6, 0.72, 0.6));
    for (let k = -3; k <= 3; k++) B.add('jblack', box, M(k * 0.2, floorY + 0.74, frontZ + 0.55, 0.5, 0, 0, 0.05, 0.05, 0.56));
    // 向拝: the porch roof over the steps, on two vermilion posts
    for (const [x, z] of frame.porch) {
      B.add('stone', cyl8, M(x, 0.12, z, 0, 0, 0, 0.42, 0.24, 0.42));
      B.add('shu', cyl, M(x, (colTop - 0.3) / 2, z, 0, 0, 0, 0.22, colTop - 0.3, 0.22));
    }
    if (frame.porch.length) {
      const pz = frame.porch[0][1];
      B.add('shu', box, M(0, colTop - 0.45, pz, 0, 0, 0, Math.abs(frame.porch[0][0]) * 2 + 0.5, 0.3, 0.28));
      B.add('shu', box, M(0, colTop - 0.45, (pz + frontZ) / 2, 0, 0, 0, 0.18, 0.18, pz - frontZ));
    }
  },

  /** 入母屋, copper-sheet roof with gentle curve, 千木 and 鰹木 on the ridge, plus the 向拝 roof. */
  roof(c) {
    const { B, M, hw, hd, hcx, hcz, colTop, hipRoof, box, cyl8, frame } = c;
    const halfW = hw / 2 + 1.9, halfD = hd / 2 + 2.1, ridgeHalf = hw / 2 - 2.6, ridgeY = colTop + 4.5, eaveY = colTop + 0.7;
    B.add('roof', hipRoof({ halfW, halfD, ridgeHalf, ridgeY, eaveY, lift: 0.5, flare: 0.35 }), M(hcx, 0, hcz));
    for (const sx of [-1, 1]) {
      B.add('shu', gableGeo(halfD * 0.45, 2.1), M(hcx + sx * (ridgeHalf + 0.3), ridgeY - 2.05, hcz));
      B.add('jwhite', gableGeo(halfD * 0.33, 1.45), M(hcx + sx * (ridgeHalf + 0.33), ridgeY - 1.9, hcz));
      // 千木: crossed boards rising past the ridge ends
      for (const r of [0.55, -0.55]) B.add('ridge', box, M(hcx + sx * (ridgeHalf + 0.25), ridgeY + 0.9, hcz, r, 0, 0, 0.12, 2.0, 0.32));
    }
    B.add('ridge', box, M(hcx, ridgeY + 0.22, hcz, 0, 0, 0, ridgeHalf * 2 + 0.6, 0.44, 0.62));
    B.add('jblack', box, M(hcx, ridgeY + 0.47, hcz, 0, 0, 0, ridgeHalf * 2 + 0.4, 0.08, 0.5));
    // 鰹木: logs laid across the ridge
    const n = 5;
    for (let i = 0; i < n; i++) {
      const x = hcx - ridgeHalf + 1.2 + i * (ridgeHalf * 2 - 2.4) / (n - 1);
      B.add('jblack', cyl8, M(x, ridgeY + 0.68, hcz, Math.PI / 2, 0, 0, 0.16, 1.4, 0.16));
      for (const sz of [-1, 1]) B.add('gold', cyl8, M(x, ridgeY + 0.68, hcz + sz * 0.71, Math.PI / 2, 0, 0, 0.165, 0.04, 0.165));
    }
    if (frame.porch.length) {
      const pz = frame.porch[0][1], pw = Math.abs(frame.porch[0][0]) + 0.9;
      B.add('roof', hipRoof({ halfW: pw, halfD: 1.25, ridgeHalf: pw - 0.6, ridgeY: colTop + 0.95, eaveY: colTop - 0.1, lift: 0.3, flare: 0.25, nu: 14, nv: 5 }), M(0, 0, pz - 0.35));
    }
  },

  /** 本殿の御扉, 神鏡, 榊, 三方 and 御幣 — no image of a deity (Shinto shrines have none). */
  altar(c, s) {
    const { B, M, box, cyl, cyl8, sph, floorY, hipRoof } = c;
    const ax = s.x, az = s.z, y0 = floorY;
    B.add('hinoki', box, M(ax, y0 + 0.36, az, 0, 0, 0, 7, 0.72, 3.2));
    B.add('jblack', box, M(ax, y0 + 0.74, az, 0, 0, 0, 7.1, 0.05, 3.3));
    for (let i = 0; i < 3; i++) B.add('hinoki', box, M(ax, y0 + 0.12 + i * 0.12, az + 1.75 + (2 - i) * 0.18, 0, 0, 0, 2.2, 0.24 + i * 0.24, 0.18));
    const ty = y0 + 0.76, bz = az - 0.5;
    B.add('shu', box, M(ax, ty + 1.05, bz, 0, 0, 0, 2.8, 2.1, 1.8));
    B.add('jblack', box, M(ax, ty + 0.95, bz + 0.91, 0, 0, 0, 1.7, 1.6, 0.04));
    for (const dx of [-0.42, 0.42]) for (const dy of [0.35, 1.55]) B.add('gold', box, M(ax + dx, ty + dy, bz + 0.94, 0, 0, 0, 0.5, 0.06, 0.02));
    B.add('gold', box, M(ax, ty + 0.95, bz + 0.94, 0, 0, 0, 0.03, 1.6, 0.02));
    B.add('roof', hipRoof({ halfW: 2.0, halfD: 1.55, ridgeHalf: 1.3, ridgeY: ty + 3.0, eaveY: ty + 2.15, lift: 0.18, flare: 0.14, nu: 12, nv: 5 }), M(ax, 0, bz));
    for (const sx of [-1, 1]) for (const r of [0.55, -0.55]) B.add('ridge', box, M(ax + sx * 1.35, ty + 3.35, bz, r, 0, 0, 0.06, 0.9, 0.14));
    // 神鏡 on its cloud stand
    B.add('hinoki', box, M(ax, ty + 0.25, az + 0.95, 0, 0, 0, 0.5, 0.5, 0.3));
    B.add('mirror', new THREE.CylinderGeometry(0.32, 0.32, 0.04, 32), M(ax, ty + 0.85, az + 0.95, Math.PI / 2 - 0.08, 0, 0));
    B.add('gold', new THREE.TorusGeometry(0.33, 0.025, 6, 32), M(ax, ty + 0.85, az + 0.96, -0.08, 0, 0));
    // 榊 in white vases, 三方 with offerings, 御幣
    for (const sx of [-1, 1]) {
      B.add('jwhite', cyl8, M(ax + sx * 1.9, ty + 0.25, az + 0.9, 0, 0, 0, 0.12, 0.5, 0.12));
      for (let k = 0; k < 6; k++) B.add('sakaki', sph, M(ax + sx * 1.9 + Math.cos(k) * 0.12, ty + 0.65 + (k % 3) * 0.12, az + 0.9 + Math.sin(k) * 0.1, 0, k, 0.5, 0.12, 0.05, 0.08));
      B.add('hinoki', box, M(ax + sx * 0.95, ty + 0.15, az + 1.15, 0, 0, 0, 0.38, 0.3, 0.38));
      B.add('jwhite', cyl, M(ax + sx * 0.95, ty + 0.36, az + 1.15, 0, 0, 0, 0.1, 0.14, 0.1));
      B.add('hinoki', cyl8, M(ax + sx * 2.9, ty + 0.55, az + 0.4, 0, 0, 0, 0.025, 1.1, 0.025));
      shide(B, M, ax + sx * 2.9, ty + 1.05, az + 0.42, 0, 1.6);
    }
    return [];
  },

  interior(c) {
    const { B, M, hall, colTop, hw, hd, hcx, hcz, box, lathe, frontZ } = c;
    const extras = [];
    // 格天井: plain cypress coffers
    const ceilY = colTop + 0.25;
    B.add('hinoki', box, M(hcx, ceilY + 0.05, hcz, 0, 0, 0, hw - 0.4, 0.08, hd - 0.4));
    for (let x = hall.x0 + 0.8; x < hall.x1 - 0.5; x += 1.2) B.add('jblack', box, M(x, ceilY - 0.02, hcz, 0, 0, 0, 0.07, 0.07, hd - 0.5));
    for (let z = hall.z0 + 0.8; z < hall.z1 - 0.3; z += 1.2) B.add('jblack', box, M(hcx, ceilY - 0.02, z, 0, 0, 0, hw - 0.5, 0.07, 0.07));
    // 御簾 curtain band inside the front beam, with white crests
    B.add('maku', box, M(hcx, colTop - 0.55, frontZ - 0.25, 0, 0, 0, hw - 0.8, 0.7, 0.02));
    for (let x = hall.x0 + 2.5; x < hall.x1 - 2; x += 4.6) B.add('jwhite', new THREE.CircleGeometry(0.2, 20), M(x, colTop - 0.55, frontZ - 0.235));
    // 提灯 along the side walls (glow at night)
    const lanternMat = new THREE.MeshStandardMaterial({ color: '#f3ead6', emissive: '#ffcf8a', emissiveIntensity: 0.3, roughness: 0.9 });
    const geo = lathe([[0.02, 0], [0.16, 0.03], [0.24, 0.18], [0.25, 0.32], [0.22, 0.48], [0.14, 0.58], [0.02, 0.6]], 16);
    for (const sx of [-1, 1]) for (const z of [hall.z1 - 4, hcz, hall.z0 + 5]) {
      const m = new THREE.Mesh(geo, lanternMat); m.position.set(sx * (hw / 2 - 1.2), colTop - 1.6, z); extras.push(m);
      B.add('jblack', new THREE.CylinderGeometry(0.15, 0.15, 0.06, 12), M(sx * (hw / 2 - 1.2), colTop - 1.0, z));
      B.add('jblack', new THREE.CylinderGeometry(0.15, 0.15, 0.06, 12), M(sx * (hw / 2 - 1.2), colTop - 1.62, z));
      B.add('jblack', box, M(sx * (hw / 2 - 1.2), colTop - 0.5, z, 0, 0, 0, 0.02, 1.0, 0.02));
    }
    return { extras, flames: [], lanternMat };
  },

  /** 明神鳥居: two vermilion pillars, black 笠木 curving up at the ends, 貫, 額束 with a vertical 扁額. */
  gate(c, s) {
    const { B, M, box, cyl, frame } = c;
    const H = 5.6, px = Math.abs(frame.gatePosts[0]);
    for (const sx of [-1, 1]) {
      B.add('jblack', cyl, M(s.x + sx * px, 0.28, s.z, 0, 0, 0, 0.4, 0.56, 0.4));
      B.add('shu', cyl, M(s.x + sx * px, H / 2, s.z, 0, 0, -sx * 0.035, 0.31, H, 0.31));
    }
    B.add('shu', box, M(s.x, H - 1.35, s.z, 0, 0, 0, px * 2 + 1.6, 0.3, 0.26));
    B.add('shu', box, M(s.x, H - 0.12, s.z, 0, 0, 0, px * 2 + 1.9, 0.3, 0.42));
    const len = px * 2 + 3.0;
    const kasagi = new THREE.BoxGeometry(len, 0.34, 0.56, 24, 1, 1);
    const p = kasagi.attributes.position;
    for (let i = 0; i < p.count; i++) { const u = p.getX(i) / (len / 2); p.setY(i, p.getY(i) + 0.42 * u ** 2 + (p.getY(i) > 0 ? 0.04 * u ** 2 : 0)); }
    kasagi.computeVertexNormals();
    B.add('jblack', kasagi, M(s.x, H + 0.2, s.z));
    B.add('shu', box, M(s.x, H - 0.72, s.z, 0, 0, 0, 0.32, 0.95, 0.22));
    return { plaque: { x: s.x, y: H - 0.72, z: s.z + 0.14, w: 0.62, h: 1.05, vertical: true } };
  },

  /** 石燈籠 (春日形): hexagonal. */
  lantern(c, s) {
    const { B, M, yAt } = c;
    const y = yAt(s.x, s.z);
    const hex = (r, h, top = r) => new THREE.CylinderGeometry(top, r, h, 6);
    B.add('stone', hex(0.46, 0.2), M(s.x, y + 0.1, s.z));
    B.add('stone', hex(0.34, 0.16, 0.26), M(s.x, y + 0.28, s.z));
    B.add('stone', new THREE.CylinderGeometry(0.12, 0.13, 1.0, 10), M(s.x, y + 0.86, s.z));
    B.add('stone', new THREE.TorusGeometry(0.13, 0.03, 6, 12), M(s.x, y + 0.86, s.z, Math.PI / 2, 0, 0));
    B.add('stone', hex(0.22, 0.16, 0.4), M(s.x, y + 1.44, s.z));
    B.add('stone', new THREE.CylinderGeometry(0.27, 0.27, 0.42, 6, 1, true), M(s.x, y + 1.73, s.z));
    B.add('stone', new THREE.ConeGeometry(0.6, 0.38, 6), M(s.x, y + 2.13, s.z));
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; B.add('stone', new THREE.SphereGeometry(0.06, 6, 4), M(s.x + Math.cos(a) * 0.56, y + 1.98, s.z + Math.sin(a) * 0.56)); }
    B.add('stone', new THREE.SphereGeometry(0.1, 10, 8), M(s.x, y + 2.42, s.z));
    B.add('stone', new THREE.ConeGeometry(0.06, 0.14, 8), M(s.x, y + 2.56, s.z));
    return { x: s.x, y: y + 1.73, z: s.z, size: 0.4 };
  },

  /** 御神籤: a little roofed stand, the hexagonal 籤箱, and a rack where people tie their slips. */
  fortune(c, s) {
    const { B, M, box, cyl8, hipRoof, yAt } = c;
    const ry = s.ry || 0, at = local(s, ry), y = yAt(s.x, s.z);
    B.add('hinoki', box, M(s.x, y + 0.45, s.z, 0, ry, 0, 1.6, 0.9, 0.9));
    B.add('shu', box, M(s.x, y + 0.92, s.z, 0, ry, 0, 1.7, 0.06, 1.0));
    B.add('hinoki', new THREE.CylinderGeometry(0.13, 0.13, 0.45, 6), M(s.x, y + 1.18, s.z));
    B.add('jblack', new THREE.CylinderGeometry(0.135, 0.135, 0.05, 6), M(s.x, y + 1.42, s.z));
    for (const dx of [-0.75, 0.75]) { const [x, z] = at(dx, -0.4); B.add('shu', cyl8, M(x, y + 1.2, z, 0, 0, 0, 0.06, 2.4, 0.06)); }
    const [rx, rz] = at(0, -0.4);
    B.add('roof', hipRoof({ halfW: 1.1, halfD: 0.75, ridgeHalf: 0.9, ridgeY: 2.75, eaveY: 2.3, lift: 0.08, flare: 0.06, nu: 8, nv: 3 }), M(rx, y, rz, 0, ry, 0));
    // the tying rack behind, hung with folded white slips
    const [bx, bz] = at(0, -1.5);
    for (const dx of [-1.1, 1.1]) { const [x, z] = at(dx, -1.5); B.add('hinoki', cyl8, M(x, y + 0.8, z, 0, 0, 0, 0.05, 1.6, 0.05)); }
    for (const h of [0.9, 1.35]) B.add('jblack', box, M(bx, y + h, bz, 0, ry, 0, 2.2, 0.02, 0.02));
    let k = 0;
    for (const h of [0.9, 1.35]) for (let dx = -1.0; dx <= 1.0; dx += 0.09) {
      if ((k++ * 7919) % 5 === 0) continue;
      const [x, z] = at(dx, -1.5);
      B.add('paperW', box, M(x, y + h - 0.03, z, 0, ry, ((k % 3) - 1) * 0.2, 0.035, 0.09, 0.02));
    }
  },

  /** 繪馬: the pentagonal wooden plaque. */
  tabletGeo() {
    const s = new THREE.Shape();
    s.moveTo(-0.12, -0.08); s.lineTo(0.12, -0.08); s.lineTo(0.12, 0.04); s.lineTo(0, 0.1); s.lineTo(-0.12, 0.04); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.014, bevelEnabled: false });
    g.translate(0, 0, -0.007);
    g.rotateY(Math.PI / 2); // the rack code turns tablets by +90°
    return g;
  },

  plaques(c) {
    const { colTop, frame } = c;
    const pz = frame.porch.length ? frame.porch[0][1] : c.frontZ;
    return { hall: { x: 0, y: colTop - 0.12, z: pz + 0.3, w: 1.9, h: 0.6 } };
  },

  /** Two big 提灯 hanging from the 向拝 beam. */
  lights(c) {
    const { lathe, colTop, frame } = c;
    const mat = new THREE.MeshStandardMaterial({ color: '#f1e6cf', emissive: '#ffb066', emissiveIntensity: 0.2, roughness: 0.9 });
    const band = new THREE.MeshStandardMaterial({ color: '#211f1d', roughness: 0.5 });
    const extras = [];
    if (frame.porch.length) {
      const pz = frame.porch[0][1];
      const geo = lathe([[0.03, 0], [0.3, 0.06], [0.42, 0.3], [0.44, 0.55], [0.4, 0.8], [0.28, 1.0], [0.03, 1.05]], 20);
      for (const sx of [-1, 1]) {
        const m = new THREE.Mesh(geo, mat); m.position.set(sx * 1.5, colTop - 1.85, pz); extras.push(m);
        for (const y of [colTop - 1.86, colTop - 0.8]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.08, 16), band); b.position.set(sx * 1.5, y, pz); extras.push(b); }
      }
    }
    return { extras, update(t, night) { mat.emissiveIntensity = night ? 1.6 : 0.2; } };
  },
};

export const STYLES = { 'kr-temple': KR, 'jp-shrine': JP };

// =============================================================== scenery by slot type (any architecture)

export const SCENERY = {
  /** 三層石塔 */
  pagoda(c, s) {
    const { B, M, box, cyl8, sph } = c;
    B.add('stone', box, M(s.x, 0.25, s.z, 0, 0, 0, 3.4, 0.5, 3.4));
    B.add('stone', box, M(s.x, 0.72, s.z, 0, 0, 0, 2.7, 0.44, 2.7));
    B.add('stone', box, M(s.x, 0.98, s.z, 0, 0, 0, 2.95, 0.1, 2.95));
    let y = 1.03;
    for (const [bw, bh, rw] of [[1.2, 1.0, 2.3], [0.98, 0.56, 2.0], [0.82, 0.48, 1.72]]) {
      B.add('stone', box, M(s.x, y + bh / 2, s.z, 0, 0, 0, bw, bh, bw));
      for (const sx of [-1, 1]) for (const r of [0, Math.PI / 2]) B.add('stoneDark', box, M(s.x + (r ? 0 : sx * (bw / 2 + 0.005)), y + bh / 2, s.z + (r ? sx * (bw / 2 + 0.005) : 0), 0, r, 0, 0.01, bh * 0.9, 0.08));
      y += bh;
      for (let k = 0; k < 3; k++) B.add('stone', box, M(s.x, y + 0.04 + k * 0.07, s.z, 0, 0, 0, bw + 0.15 + k * 0.18, 0.07, bw + 0.15 + k * 0.18));
      y += 0.2;
      const roofG = new THREE.ConeGeometry(rw * 0.72, 0.36, 4, 1); roofG.rotateY(Math.PI / 4);
      B.add('stone', box, M(s.x, y + 0.04, s.z, 0, 0, 0, rw, 0.09, rw));
      B.add('stone', roofG, M(s.x, y + 0.26, s.z));
      y += 0.38;
    }
    B.add('stone', cyl8, M(s.x, y + 0.15, s.z, 0, 0, 0, 0.24, 0.3, 0.24));
    B.add('stone', sph, M(s.x, y + 0.42, s.z, 0, 0, 0, 0.18));
    B.add('stoneDark', cyl8, M(s.x, y + 0.95, s.z, 0, 0, 0, 0.05, 0.9, 0.05));
    for (const [h, r] of [[0.7, 0.14], [0.9, 0.12], [1.1, 0.1]]) B.add('stoneDark', cyl8, M(s.x, y + h, s.z, 0, 0, 0, r, 0.04, r));
  },

  /** 手水舎: a stone basin under a small roof, with ladles. */
  temizuya(c, s) {
    const { B, M, box, cyl8, hipRoof } = c;
    const ry = s.ry || 0, at = local(s, ry);
    B.add('stone', box, M(s.x, 0.45, s.z, 0, ry, 0, 2.0, 0.9, 0.9));
    const water = new THREE.PlaneGeometry(1.8, 0.7); water.rotateX(-Math.PI / 2);
    B.add('water', water, M(s.x, 0.905, s.z, 0, ry, 0));
    for (const sx of [-1, 1]) { const [x, z] = at(sx * 0.95, 0); B.add('stone', box, M(x, 0.95, z, 0, ry, 0, 0.1, 0.1, 0.9)); } // raised rim
    for (const [dx, dz] of [[-1.3, -0.85], [1.3, -0.85], [-1.3, 0.85], [1.3, 0.85]]) {
      const [x, z] = at(dx, dz);
      B.add('stone', cyl8, M(x, 0.1, z, 0, 0, 0, 0.22, 0.2, 0.22));
      B.add('hinoki', box, M(x, 1.4, z, 0, ry, 0, 0.18, 2.6, 0.18));
    }
    B.add('hinoki', box, M(s.x, 2.68, s.z, 0, ry, 0, 2.9, 0.2, 0.2));
    B.add('roof', hipRoof({ halfW: 2.0, halfD: 1.45, ridgeHalf: 1.75, ridgeY: 3.75, eaveY: 2.75, lift: 0.14, flare: 0.1, nu: 10, nv: 4 }), M(s.x, 0, s.z, 0, ry, 0));
    // bamboo rack with ladles
    const [lx, lz] = at(0, 0.5);
    B.add('hinoki', box, M(lx, 0.93, lz, 0, ry, 0, 1.6, 0.04, 0.06));
    for (let k = -2; k <= 2; k++) {
      const [x, z] = at(k * 0.3, 0.38);
      B.add('hinoki', cyl8, M(x, 0.95, z, Math.PI / 2 - 0.2, ry, 0, 0.012, 0.42, 0.012));
      const [cx, cz] = at(k * 0.3, 0.16);
      B.add('hinoki', new THREE.CylinderGeometry(0.05, 0.045, 0.08, 10), M(cx, 0.98, cz));
    }
  },

  /** 狛犬 / 해태: a seated stone guardian on a plinth, facing ry. */
  guardian(c, s) {
    const { B, M, box, sph, cyl8 } = c;
    const ry = s.ry || 0, at = local(s, ry);
    B.add('stone', box, M(s.x, 0.55, s.z, 0, ry, 0, 0.9, 1.1, 1.1));
    B.add('stone', box, M(s.x, 1.13, s.z, 0, ry, 0, 1.0, 0.08, 1.2));
    const put = (dx, dy, dz, sx, sy, sz, rx = 0) => { const [x, z] = at(dx, dz); B.add('stoneDark', sph, M(x, dy, z, rx, ry, 0, sx, sy, sz)); };
    put(0, 1.45, -0.2, 0.36, 0.32, 0.4);       // haunches
    put(0, 1.72, 0.08, 0.3, 0.42, 0.3);        // chest
    put(0, 2.18, 0.2, 0.3, 0.27, 0.29);        // head
    put(0, 2.12, 0.45, 0.15, 0.11, 0.13);      // muzzle
    for (let k = 0; k < 7; k++) { const a = (k / 6 - 0.5) * 2.6; put(Math.sin(a) * 0.3, 2.15 + Math.cos(a) * 0.18, 0.02, 0.1, 0.1, 0.1); } // mane curls
    for (const sx of [-1, 1]) {
      const [x, z] = at(sx * 0.15, 0.3);
      B.add('stoneDark', cyl8, M(x, 1.45, z, 0, 0, 0, 0.08, 0.6, 0.08));
      put(sx * 0.15, 1.18, 0.36, 0.1, 0.06, 0.12);
    }
    const [tx, tz] = at(0, -0.5);
    B.add('stoneDark', new THREE.ConeGeometry(0.16, 0.6, 8), M(tx, 1.85, tz, 0, ry, 0));
  },

  /** 연등: a string of lotus lanterns overhead. Returns meshes and a night-glow updater. */
  lanternLine(c, s) {
    const { B, M } = c;
    const n = Math.max(2, Math.min(40, s.count || 16)), y0 = 3.7, sag = 0.35;
    const a = new THREE.Vector3(s.x, y0, s.z), b = new THREE.Vector3(s.x2 ?? s.x, y0, s.z2 ?? s.z);
    B.add('ridge', ropeGeo(a, b, sag, 0.012, 32), M());
    for (const p of [a, b]) B.add('wood', new THREE.CylinderGeometry(0.06, 0.07, y0 + 0.1, 8), M(p.x, (y0 + 0.1) / 2, p.z));
    const geo = new THREE.LatheGeometry([[0.02, 0], [0.12, 0.02], [0.2, 0.09], [0.23, 0.2], [0.19, 0.31], [0.09, 0.38], [0.02, 0.4]].map(([r, y]) => new THREE.Vector2(r, y)), 32);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { // eight petals
      const ang = Math.atan2(p.getZ(i), p.getX(i)), k = 0.86 + 0.14 * Math.abs(Math.cos(ang * 4));
      p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k);
    }
    geo.computeVertexNormals();
    const glow = { value: 0.1 };
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uGlow = glow;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\ntotalEmissiveRadiance += vColor * uGlow;\n#endif');
    };
    mat.customProgramCacheKey = () => 'lotus-lantern';
    const lanterns = new THREE.InstancedMesh(geo, mat, n);
    const colors = ['#f2a0b4', '#f5d46a', '#9ad4a6', '#f4efe2', '#e8705e', '#93b8e8'];
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const k = (i + 0.5) / n;
      const x = a.x + (b.x - a.x) * k, z = a.z + (b.z - a.z) * k, y = y0 - sag * 4 * k * (1 - k) - 0.62;
      lanterns.setMatrixAt(i, M(x, y, z, 0, k * 9, 0));
      lanterns.setColorAt(i, col.set(colors[(i * 5 + Math.round(s.x)) % colors.length]));
      B.add('ridge', new THREE.CylinderGeometry(0.004, 0.004, 0.24, 3), M(x, y + 0.52, z));
    }
    lanterns.castShadow = false;
    return { extras: [lanterns], update(t, night) { glow.value = night ? 0.9 : 0.06; } };
  },

  /** 注連縄 round a sacred tree (御神木). */
  treeRope(c, s) {
    const { B, M } = c;
    const r = (s.r || 0.6) * 0.9 + 0.06;
    B.add('straw', new THREE.TorusGeometry(r, 0.08, 8, 28), M(s.x, 1.7, s.z, Math.PI / 2, 0, 0));
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; shide(B, M, s.x + Math.cos(a) * (r + 0.05), 1.62, s.z + Math.sin(a) * (r + 0.05), -a, 1.3); }
  },
};
