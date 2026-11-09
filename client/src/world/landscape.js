// 寺外景觀：層疊遠山、松林與四季闊葉樹、院牆、古銀杏、放生池與錦鯉（設計文檔 2.3、11.1）。
// Static parts go into the Batch; mountains (no fog, so they stay visible through the mist),
// pond water and koi are returned as their own meshes.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

function seeded(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

/** Periodic 1-D value noise over [0, 1) so a ridge closes around the valley seamlessly. */
function ridgeNoise(seed, octaves = [[5, 1], [11, 0.5], [23, 0.22], [47, 0.1]]) {
  const rnd = seeded(seed);
  const tables = octaves.map(([n]) => Array.from({ length: n }, () => rnd()));
  return (t) => {
    let v = 0, sum = 0;
    octaves.forEach(([n, amp], k) => {
      const x = t * n, i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f);
      const a = tables[k][((i % n) + n) % n], b = tables[k][(((i + 1) % n) + n) % n];
      v += (a + (b - a) * s) * amp; sum += amp;
    });
    return v / sum;
  };
}

/** A ring of mountain ridges around (cx, cz): radius r, crest heights h0..h1. */
function ridgeRing({ cx = 0, cz = 0, r, depth, h0, h1, seed, segs = 200 }) {
  const n = ridgeNoise(seed);
  const peaks = ridgeNoise(seed + 5, [[17, 1], [41, 0.6], [83, 0.3]]);
  const gully = ridgeNoise(seed + 9, [[60, 1], [130, 0.5]]);
  const pos = [], idx = [];
  // front slope (toward the valley) in several rows so ravines can cut into it
  const rows = [[-depth, 0], [-depth * 0.75, 0.2], [-depth * 0.5, 0.45], [-depth * 0.28, 0.7], [-depth * 0.1, 0.9], [0, 1], [depth * 0.6, 0.4], [depth, 0]];
  const sm = (x) => x * x * (3 - 2 * x);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, a = t * Math.PI * 2;
    const base = sm(Math.min(Math.max((n(t) - 0.25) / 0.55, 0), 1));
    const crest = h0 + (h1 - h0) * (0.75 * base + 0.25 * peaks(t) * base + 0.15 * peaks(t));
    for (const [dr, k] of rows) {
      const rr = r + dr + (n((t + 0.37) % 1) - 0.5) * depth * 0.6;
      // ravines: dips on the mid slope, strongest halfway up
      const cut = k > 0 && k < 1 ? (gully(t) - 0.5) * 0.35 * Math.sin(Math.PI * k) : 0;
      pos.push(cx + Math.cos(a) * rr, crest * Math.max(k + cut, 0) - 1, cz + Math.sin(a) * rr);
    }
  }
  const R = rows.length;
  for (let i = 0; i < segs; i++) for (let j = 0; j < R - 1; j++) {
    const a = i * R + j, b = a + 1, c = a + R, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** Foliage clump: subdivided icosahedron with jittered vertices (smooth-shaded). */
function lumpy(rnd) {
  // icosahedron faces don't share vertices; merge first so normals are smooth, not faceted
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 2).deleteAttribute('normal').deleteAttribute('uv'));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 0.82 + rnd() * 0.3;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Scattered fallen leaves on a transparent canvas, densest at the centre. */
function leafLitter() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), rnd = seeded(97);
  for (let i = 0; i < 900; i++) {
    const r = Math.sqrt(rnd()) * 120 * (0.5 + 0.5 * rnd()), a = rnd() * Math.PI * 2;
    const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r;
    g.save(); g.translate(x, y); g.rotate(rnd() * 6.28);
    g.globalAlpha = 0.55 + rnd() * 0.45 - r / 300;
    g.fillStyle = ['#e3b23c', '#d9a22e', '#f0c95a', '#c9902a'][Math.floor(rnd() * 4)];
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 3 + rnd() * 2, -0.9, 0.9); g.closePath(); g.fill();
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function landscapeMaterials(season) {
  const leaf = { spring: '#e8b6c4', summer: '#4d7a3a', autumn: '#c0562c', winter: '#8b8076' }[season];
  const ginkgo = { spring: '#a9c86a', summer: '#5f8a3a', autumn: '#e3b23c', winter: null }[season];
  return {
    pineDark: new THREE.MeshStandardMaterial({ color: season === 'winter' ? '#3a4d45' : '#24402f', roughness: 0.95, flatShading: true }),
    maple: new THREE.MeshStandardMaterial({ color: leaf, roughness: 0.9, flatShading: true }),
    ginkgo: new THREE.MeshStandardMaterial({ color: ginkgo || '#6a5a48', roughness: 0.9 }),
    wallYellow: new THREE.MeshStandardMaterial({ color: '#c9a456', roughness: 0.95 }),
    wallBase: new THREE.MeshStandardMaterial({ color: '#7d766b', roughness: 0.95 }),
    pondStone: new THREE.MeshStandardMaterial({ color: '#a39c90', roughness: 0.9 }),
    lotusLeaf: new THREE.MeshStandardMaterial({ color: season === 'winter' ? '#6b6a4a' : '#4f7a3c', roughness: 0.7, side: THREE.DoubleSide }),
  };
}

/**
 * ctx: { manifest, hall, season, rnd } — returns { extras: Object3D[], update(t) }.
 */
export function addLandscape(B, M, ctx) {
  const { manifest, hall, season, quality } = ctx;
  const density = quality === 'low' ? 0.5 : 1; // low-end phones: half the forest
  const rnd = seeded(7331);
  const extras = [];
  const w = manifest.walkArea;
  const cyl8 = new THREE.CylinderGeometry(1, 1, 1, 8);
  const cone = (seg) => new THREE.ConeGeometry(1, 1, seg);

  // ---- mountains: three layers, farther = paler and bluer (aerial perspective without fog)
  const mtn = [
    { r: 240, depth: 50, h0: 45, h1: 110, seed: 11, color: '#6f7b8a' },
    { r: 165, depth: 40, h0: 26, h1: 62, seed: 23, color: '#66776f' },
    { r: 105, depth: 28, h0: 10, h1: 30, seed: 37, color: '#4f6650' },
  ];
  for (const m of mtn) {
    const mesh = new THREE.Mesh(ridgeRing({ cz: -20, ...m }), new THREE.MeshStandardMaterial({ color: m.color, roughness: 1, flatShading: true, fog: false, envMapIntensity: 0 }));
    mesh.receiveShadow = false; extras.push(mesh);
  }

  // ---- trees
  const pine = (x, z, s, key = 'pine') => {
    B.add('bark', cyl8, M(x, 1.4 * s, z, 0, 0, 0, 0.16 * s, 2.8 * s, 0.16 * s));
    const tiers = 5;
    for (let k = 0; k < tiers; k++) {
      const t = k / (tiers - 1), rad = (2.3 - 1.7 * t) * s, hgt = (1.5 - 0.3 * t) * s;
      B.add(k % 2 ? 'pineDark' : key, cone(8), M(x + (rnd() - 0.5) * 0.2 * s, (2.2 + k * 1.15) * s, z + (rnd() - 0.5) * 0.2 * s, (rnd() - 0.5) * 0.12, rnd() * 3, (rnd() - 0.5) * 0.12, rad, hgt, rad * (0.85 + rnd() * 0.3)));
    }
  };
  const broadleaf = (x, z, s, key) => {
    B.add('bark', cyl8, M(x, 1.1 * s, z, 0, 0, 0, 0.17 * s, 2.2 * s, 0.17 * s));
    for (const [dx, dy, dz, r] of [[0, 3.0, 0, 1.6], [0.9, 2.6, 0.3, 1.1], [-0.8, 2.7, -0.4, 1.2], [0.2, 3.7, -0.3, 1.0], [-0.3, 2.4, 0.8, 1.0]]) {
      B.add(key, new THREE.IcosahedronGeometry(1, 0), M(x + dx * s, dy * s, z + dz * s, rnd(), rnd(), rnd(), r * s * (0.9 + rnd() * 0.25)));
    }
  };
  // forest belts on both sides and behind the hall, thinner in front of the gate
  for (let i = 0; i < 150 * density; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * (17 + rnd() * 30), z = -55 + rnd() * 80;
    const s = 0.8 + rnd() * 0.7;
    if (rnd() < 0.72) pine(x, z, s, rnd() < 0.5 ? 'pine' : 'pineDark'); else broadleaf(x, z, s * 0.9, 'maple');
  }
  for (let i = 0; i < 50 * density; i++) { const x = (rnd() - 0.5) * 60, z = -36 - rnd() * 22; pine(x, z, 0.9 + rnd() * 0.8); }
  for (let i = 0; i < 24 * density; i++) { const x = (rnd() < 0.5 ? -1 : 1) * (7 + rnd() * 30), z = 18 + rnd() * 22; rnd() < 0.6 ? pine(x, z, 0.8 + rnd() * 0.5) : broadleaf(x, z, 0.8, 'maple'); }

  // ---- courtyard walls (yellow plaster, stone base, tiled coping) around the walk area
  const WX = w.maxX + 1.6, WZ0 = w.maxZ + 0.4, WZ1 = hall.z0 - 3, WH = 3.0;
  const gate = manifest.slots.find((s) => s.type === 'gate');
  const wall = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(x1 - x0, z1 - z0);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    B.add('wallBase', new THREE.BoxGeometry(1, 1, 1), M(cx, 0.3, cz, 0, ang, 0, 0.62, 0.6, len));
    B.add('wallYellow', new THREE.BoxGeometry(1, 1, 1), M(cx, WH / 2 + 0.3, cz, 0, ang, 0, 0.5, WH - 0.6, len));
    const cap = new THREE.CylinderGeometry(0.62, 0.62, 1, 3); cap.rotateZ(Math.PI / 2); cap.rotateY(Math.PI / 2); cap.scale(1, 0.55, 1);
    B.add('roof', cap, M(cx, WH + 0.2, cz, 0, ang, 0, 1, 1, len + 0.3));
    B.add('ridge', new THREE.BoxGeometry(1, 1, 1), M(cx, WH + 0.5, cz, 0, ang, 0, 0.14, 0.12, len + 0.3));
  };
  wall(WX, WZ0, WX, WZ1); wall(-WX, WZ0, -WX, WZ1); wall(-WX, WZ1, WX, WZ1);
  const gx = gate ? 5.8 : 0;
  wall(gx, WZ0, WX, WZ0); wall(-WX, WZ0, -gx, WZ0);

  // ---- landmark trees (古銀杏) from slots
  const fallen = [];
  for (const t of manifest.slots.filter((s) => s.type === 'tree')) {
    const s = 1.35;
    B.add('bark', new THREE.CylinderGeometry(0.62, 1, 1, 10), M(t.x, 1.8 * s, t.z, 0, rnd(), 0, 0.42, 3.6 * s, 0.42));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + rnd(), len = 2.2 + rnd();
      B.add('bark', cyl8, M(t.x + Math.cos(a) * len * 0.45, 3.6 * s + 0.8, t.z + Math.sin(a) * len * 0.45, Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9, 0.12, len, 0.12));
    }
    if (season !== 'winter') {
      // many small, lumpy clusters read as foliage; a few big ones read as balloons
      for (let k = 0; k < 22; k++) {
        const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * 2.6, y = 5.0 + rnd() * 3.4;
        const taper = 1 - (y - 5) / 5;
        B.add('ginkgo', lumpy(rnd), M(t.x + Math.cos(a) * rr * taper, y, t.z + Math.sin(a) * rr * taper, rnd(), rnd(), rnd(), 0.8 + rnd() * 0.6));
      }
    }
    if (season === 'autumn') fallen.push([t.x, t.z]);
  }
  // fallen ginkgo leaves: a transparent decal of scattered leaves, not a solid disc
  if (fallen.length) {
    const decal = new THREE.MeshStandardMaterial({ map: leafLitter(), transparent: true, depthWrite: false, roughness: 0.9 });
    for (const [x, z] of fallen) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), decal);
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.02, z); m.renderOrder = 1; extras.push(m);
    }
  }

  // ---- 放生池: stone rim, water, lotus leaves, koi
  const ponds = manifest.slots.filter((s) => s.type === 'pond');
  const waterMat = new THREE.MeshStandardMaterial({ color: '#2d4a46', roughness: 0.06, metalness: 0.25, transparent: true, opacity: 0.82 });
  const koiPaths = [];
  for (const p of ponds) {
    const hw = p.w / 2, hd = p.d / 2, rim = 0.32, rh = 0.42;
    for (const [x, z, sx, sz] of [[p.x, p.z - hd - rim / 2, p.w + rim * 2, rim], [p.x, p.z + hd + rim / 2, p.w + rim * 2, rim], [p.x - hw - rim / 2, p.z, rim, p.d], [p.x + hw + rim / 2, p.z, rim, p.d]]) {
      B.add('pondStone', new THREE.BoxGeometry(1, 1, 1), M(x, rh / 2, z, 0, 0, 0, sx, rh, sz));
    }
    B.add('stoneDark', new THREE.PlaneGeometry(p.w, p.d), M(p.x, -0.35, p.z, -Math.PI / 2));
    const water = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.d), waterMat);
    water.rotation.x = -Math.PI / 2; water.position.set(p.x, 0.26, p.z); water.renderOrder = 2; extras.push(water);
    for (let k = 0; k < 7; k++) {
      const lx = p.x + (rnd() - 0.5) * (p.w - 0.8), lz = p.z + (rnd() - 0.5) * (p.d - 0.8), r = 0.22 + rnd() * 0.18;
      const leaf = new THREE.CircleGeometry(r, 14, 0.3, Math.PI * 2 - 0.3);
      B.add('lotusLeaf', leaf, M(lx, 0.275, lz, -Math.PI / 2, 0, rnd() * 6));
      if (season === 'summer' && k % 3 === 0) B.add('lotusPink', new THREE.SphereGeometry(0.07, 8, 6), M(lx, 0.36, lz, 0, 0, 0, 1, 1.4, 1));
    }
    for (let k = 0; k < 6; k++) koiPaths.push({ cx: p.x, cz: p.z, rx: hw * (0.35 + rnd() * 0.45), rz: hd * (0.3 + rnd() * 0.4), sp: (0.15 + rnd() * 0.2) * (rnd() < 0.5 ? -1 : 1), ph: rnd() * 6.28, kind: k % 3 });
  }
  let update = () => {};
  if (koiPaths.length) {
    const body = new THREE.SphereGeometry(1, 10, 6); body.scale(0.05, 0.035, 0.16);
    const tail = new THREE.ConeGeometry(0.05, 0.1, 4); tail.rotateX(-Math.PI / 2); tail.scale(1, 0.3, 1); tail.translate(0, 0, -0.2);
    const geo = (() => { const g1 = body.toNonIndexed(), g2 = tail.toNonIndexed(); const pos = [...g1.attributes.position.array, ...g2.attributes.position.array]; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g; })();
    const koi = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.4 }), koiPaths.length);
    const colors = [new THREE.Color('#ff7a2a'), new THREE.Color('#f4efe6'), new THREE.Color('#d83a2a')];
    koiPaths.forEach((k, i) => koi.setColorAt(i, colors[k.kind]));
    extras.push(koi);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = V3(1, 1, 1), pos = V3(0, 0, 0);
    update = (t) => {
      koiPaths.forEach((k, i) => {
        const a = k.ph + t * k.sp;
        pos.set(k.cx + Math.cos(a) * k.rx, 0.16, k.cz + Math.sin(a) * k.rz);
        const dx = -Math.sin(a) * k.rx * Math.sign(k.sp), dz = Math.cos(a) * k.rz * Math.sign(k.sp);
        q.setFromEuler(e.set(0, Math.atan2(dx, dz) + Math.sin(t * 6 + i) * 0.15, 0));
        koi.setMatrixAt(i, m4.compose(pos, q, one));
      });
      koi.instanceMatrix.needsUpdate = true;
    };
    update(0);
  }
  return { extras, update };
}
