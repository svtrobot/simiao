// 大雄寶殿主尊與脅侍（設計文檔 8.3：莊重、無戲謔；不同宗教神像不混放）。
// 釋迦牟尼佛 · 結跏趺坐、禪定印、雙領下垂袈裟、螺髮肉髻、白毫、長耳垂，蓮花須彌座 + 舟形背光。
// 左右脅侍：迦葉尊者（年長）、阿難尊者（年輕），彩塑立像、合十。
// 全部程序化生成，按材質併入 temple.js 的 Batch（每種材質一次 draw call），不增加下載量。
// 模型空間：正面朝 +z，單位為米。
import * as THREE from 'three';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const g2 = (x, s) => Math.exp(-(x / s) * (x / s));
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- generic surfaces

/** Parametric grid → indexed geometry. fn(u, v) returns Vector3, u,v ∈ [0,1]. */
function grid(fn, nu, nv, { closeU = false, twoSided = false } = {}) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const p = fn(i / nu, j / nv); pos.push(p.x, p.y, p.z); uv.push(i / nu, j / nv);
  }
  const row = nu + 1;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  void closeU;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (!twoSided) return g;
  // Back face needs its own vertices with flipped normals; sharing them would average the
  // normals to ~0 and the surface shades like crumpled foil.
  const n = pos.length / 3;
  const nrm = g.attributes.normal.array;
  const back = new Float32Array(nrm.length); for (let i = 0; i < nrm.length; i++) back[i] = -nrm[i];
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute([...pos, ...pos], 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute([...nrm, ...back], 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute([...uv, ...uv], 2));
  const idx2 = [...idx];
  for (let k = 0; k < idx.length; k += 3) idx2.push(idx[k] + n, idx[k + 2] + n, idx[k + 1] + n);
  out.setIndex(idx2);
  return out;
}

/** Piecewise-smooth profile lookup: keys [[y, value], …] sorted by y. */
function profile(keys) {
  return (y) => {
    if (y <= keys[0][0]) return keys[0][1];
    for (let i = 0; i < keys.length - 1; i++) {
      const [y0, a] = keys[i], [y1, b] = keys[i + 1];
      if (y <= y1) { const t = (y - y0) / (y1 - y0); const s = t * t * (3 - 2 * t); return a + (b - a) * s; }
    }
    return keys[keys.length - 1][1];
  };
}

/** Body of revolution with elliptic cross-section: rx(y), rz(y). Angle 0 = +x, π/2 = +z (front). */
function ellipticLathe(rx, rz, y0, y1, nu = 40, nv = 32) {
  return grid((u, v) => {
    const a = u * Math.PI * 2, y = y0 + (y1 - y0) * v;
    return V3(rx(y) * Math.cos(a), y, rz(y) * Math.sin(a));
  }, nu, nv);
}

/** A tube following points (fold lines, lapels, eyebrows). */
function tube(points, radius, radial = 5) {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, Math.max(8, points.length * 4), radius, radial, false);
}

/** Flat ribbon following a centre line, oriented by a normal function. */
function ribbon(center, normal, width, n = 24) {
  return grid((u, v) => {
    const c = center(u), nrm = normal(u), t = center(Math.min(u + 0.01, 1)).sub(center(Math.max(u - 0.01, 0))).normalize();
    const side = new THREE.Vector3().crossVectors(t, nrm).normalize();
    return c.addScaledVector(side, (v - 0.5) * width).addScaledVector(nrm, 0.004);
  }, n, 2, { twoSided: true });
}

/** Lotus petal: length along +y, outer face toward +z, cupped and with an upturned tip. */
function petal(L, W, cup = 0.25, curl = 0.18) {
  return grid((u, v) => {
    // u along the petal (0 base → 1 tip), v across (0..1)
    const outline = Math.sin(Math.PI * Math.min(u * 1.05, 1) ** 0.75) * (1 - 0.15 * u);
    const s = (v * 2 - 1) * outline;
    const x = s * W * 0.5;
    const z = -cup * W * (1 - s * s) * Math.sin(Math.PI * u) + curl * L * u ** 3;
    return V3(x, u * L, z);
  }, 5, 8, { twoSided: true });
}

// ---------------------------------------------------------------- head sculpt

/**
 * Sculpted head on a unit sphere (x right, y up, z front), then scaled by radii.
 * opts: { age 0..1 (deeper sockets, sunken cheeks), buddha (fuller face, smaller mouth) }
 */
function headDisplace(x, y, z, { age = 0, buddha = false } = {}) {
  const front = smooth(0.25, 0.75, z);
  let d = 0;
  const ax = Math.abs(x);
  // brow ridge and soft forehead
  d += 0.028 * g2(y - 0.17, 0.06) * g2(x, 0.48) * front;
  // eye sockets (deeper with age) and downcast upper lids
  d -= (0.065 + 0.04 * age) * g2(ax - 0.29, 0.14) * g2(y - 0.05, 0.085) * front;
  d += 0.04 * g2(ax - 0.29, 0.12) * g2(y - 0.015, 0.045) * front;
  // nose: ridge rising to the tip, nostril wings
  const ridge = smooth(0.12, -0.24, y) * (y > -0.3 ? 1 : g2(y + 0.3, 0.04));
  d += (buddha ? 0.17 : 0.18) * g2(x, 0.075) * ridge * front;
  d += 0.045 * g2(ax - 0.085, 0.045) * g2(y + 0.25, 0.05) * front;
  // lips: upper, lower, the line between
  d += 0.036 * g2(x, buddha ? 0.12 : 0.14) * g2(y + 0.43, 0.03) * front;
  d += 0.042 * g2(x, buddha ? 0.1 : 0.12) * g2(y + 0.51, 0.035) * front;
  d -= 0.028 * g2(x, buddha ? 0.11 : 0.13) * g2(y + 0.465, 0.012) * front;
  // chin, cheeks (full for the Buddha, hollow with age)
  d += 0.035 * g2(x, 0.15) * g2(y + 0.7, 0.08) * front;
  d += ((buddha ? 0.03 : 0.012) - 0.035 * age) * g2(ax - 0.4, 0.16) * g2(y + 0.22, 0.16) * front;
  return d;
}

function sculptHead(r, opts = {}, seg = 64) {
  const g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.75));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = headDisplace(x, y, z, opts);
    // narrower jaw, flatter face plane
    if (y < 0) x *= 1 - 0.2 * (-y) ** 1.6;
    if (z > 0) z *= 1 - 0.06 * smooth(0.6, 1, z);
    p.setXYZ(i, x * (1 + d) * r.x, y * (1 + d) * r.y, z * (1 + d) * r.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Point on the sculpted face for a given (x, y) on the unit sphere front, pushed out by `lift`. */
function facePoint(x, y, r, opts, lift = 0) {
  let z = Math.sqrt(Math.max(1 - x * x - y * y, 0));
  const d = headDisplace(x, y, z, opts);
  if (y < 0) x *= 1 - 0.2 * (-y) ** 1.6;
  z *= 1 - 0.06 * smooth(0.6, 1, z);
  return V3(x * (1 + d) * r.x, y * (1 + d) * r.y, z * (1 + d) * r.z + lift);
}

/** Closed, downcast eyes + brows as thin painted lines on the face. */
function faceLines(r, opts, { brows = true, browDrop = 0 } = {}) {
  const out = [];
  for (const s of [-1, 1]) {
    const eye = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, x = s * (0.17 + 0.25 * t), y = 0.0 - 0.035 * Math.sin(Math.PI * t) + 0.012 * t;
      eye.push(facePoint(x, y, r, opts, 0.002));
    }
    out.push({ key: 'line', geo: tube(eye, Math.max(r.x, r.y) * 0.011) });
    if (brows) {
      const brow = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8, x = s * (0.1 + 0.36 * t), y = 0.2 + 0.04 * Math.sin(Math.PI * t) - 0.05 * t * t - browDrop * t;
        brow.push(facePoint(x, y, r, opts, 0.003));
      }
      out.push({ key: 'line', geo: tube(brow, Math.max(r.x, r.y) * 0.012) });
    }
  }
  return out;
}

/** Ear: long-lobed for the Buddha. Flat against the head side. */
function ear(r, side, long = false) {
  const len = long ? 0.95 : 0.42;
  const g = new THREE.CapsuleGeometry(1, 1, 4, 10);
  g.scale(0.11 * r.x, len * r.y * 0.5, 0.2 * r.z);
  g.translate(side * r.x * 0.96, (long ? -0.18 : 0.02) * r.y, -0.06 * r.z);
  return g;
}

// ---------------------------------------------------------------- 釋迦牟尼佛坐像

/** Returns [{key, geo}] in local space: seat surface at y = 0, facing +z. */
function seatedBuddha() {
  const parts = [];
  const add = (key, geo) => parts.push({ key, geo });

  // torso (robe) — wider at the shoulders, elliptic
  const rx = profile([[0.3, 0.62], [0.8, 0.6], [1.2, 0.57], [1.55, 0.64], [1.8, 0.68], [1.93, 0.52], [2.03, 0.2]]);
  const rz = profile([[0.3, 0.44], [0.8, 0.39], [1.2, 0.37], [1.55, 0.39], [1.8, 0.33], [1.93, 0.26], [2.03, 0.15]]);
  add('statue', ellipticLathe(rx, rz, 0.3, 2.03));
  const torsoPt = (a, y, lift = 0) => V3((rx(y) + lift) * Math.cos(a), y, (rz(y) + lift) * Math.sin(a));

  // crossed legs (lap) + knees, robe covering
  const lap = new THREE.SphereGeometry(1, 40, 20); lap.scale(1.18, 0.32, 0.78); lap.translate(0, 0.27, 0.22); add('statue', lap);
  for (const s of [-1, 1]) {
    const knee = new THREE.SphereGeometry(1, 20, 14); knee.scale(0.33, 0.26, 0.36); knee.translate(s * 0.93, 0.24, 0.5); add('statue', knee);
  }
  // right foot resting sole-up on the left thigh (吉祥坐)
  const foot = new THREE.SphereGeometry(1, 16, 10); foot.scale(0.11, 0.055, 0.25);
  foot.rotateY(-0.5); foot.rotateZ(-0.25); foot.translate(-0.42, 0.55, 0.62); add('statue', foot);
  for (let k = 0; k < 5; k++) {
    const toe = new THREE.SphereGeometry(0.028 - k * 0.002, 8, 6);
    toe.translate(-0.42 - 0.2 * Math.sin(0.5) + (k - 2) * 0.03, 0.6, 0.62 + 0.2 * Math.cos(0.5) + 0.02);
    add('statue', toe);
  }

  // outer robe (雙領下垂): one shell over both shoulders and the upper arms, open at the
  // front to show the chest. This is what gives a seated image its broad triangular outline.
  const OPEN = 0.42; // half-angle of the front opening
  const sx = profile([[0.55, 1.06], [0.8, 1.0], [1.2, 0.93], [1.6, 0.82], [1.82, 0.74], [1.95, 0.5], [2.02, 0.24]]);
  const sz = profile([[0.55, 0.62], [0.8, 0.56], [1.2, 0.5], [1.6, 0.46], [1.82, 0.41], [1.95, 0.31], [2.02, 0.18]]);
  const shellPt = (a, y, lift = 0) => V3((sx(y) + lift) * Math.cos(a), y, (sz(y) + lift) * Math.sin(a));
  add('statue', grid((u, v) => {
    const a = Math.PI / 2 + OPEN + u * (Math.PI * 2 - 2 * OPEN);
    const y = 0.55 + v * 1.47;
    // soft vertical drapery ripples on the sides and back
    const rip = 0.012 * Math.sin(a * 14) * smooth(1.9, 1.2, y);
    return shellPt(a, y, rip);
  }, 64, 24, { twoSided: true }));
  // lapels follow the opening, from the neck down to the lap
  for (const s of [-1, 1]) {
    const lapel = [];
    for (let i = 0; i <= 12; i++) { const y = 2.0 - (i / 12) * 1.4; lapel.push(shellPt(Math.PI / 2 - s * (OPEN - 0.02), y, 0.02)); }
    add('statue', tube(lapel, 0.045, 6));
    // drapery folds running down the sleeves
    for (const da of [0.75, 1.15, 1.6]) {
      const pts = [];
      for (let i = 0; i <= 10; i++) { const y = 1.85 - (i / 10) * 1.2; pts.push(shellPt(Math.PI / 2 - s * (da + 0.12 * (i / 10)), y, 0.01)); }
      add('statue', tube(pts, 0.018, 5));
    }
  }
  // forearms emerge from the sleeves and meet at the lap, hands in 禪定印
  for (const s of [-1, 1]) {
    const el = shellPt(Math.PI / 2 - s * (OPEN + 0.12), 0.95, -0.05), wr = V3(s * 0.2, 0.66, 0.64);
    const len = el.distanceTo(wr), cap = new THREE.CapsuleGeometry(0.14, len, 6, 14);
    cap.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), wr.clone().sub(el).normalize()));
    cap.translate((el.x + wr.x) / 2, (el.y + wr.y) / 2, (el.z + wr.z) / 2);
    add('statue', cap);
    // sleeve hanging under the forearm
    add('statue', grid((u, v) => {
      const c = el.clone().lerp(wr, 0.05 + u * 0.75);
      return V3(c.x, c.y - 0.08 - v * (0.12 + 0.14 * Math.sin(Math.PI * u)), c.z - 0.04 + 0.03 * v);
    }, 10, 4, { twoSided: true }));
  }
  // palms up, right over left; thumbs meeting above
  const palmL = new THREE.SphereGeometry(1, 20, 12); palmL.scale(0.24, 0.055, 0.15); palmL.translate(0, 0.6, 0.66); add('statue', palmL);
  const palmR = new THREE.SphereGeometry(1, 20, 12); palmR.scale(0.23, 0.05, 0.14); palmR.translate(0, 0.66, 0.68); add('statue', palmR);
  for (const s of [-1, 1]) add('statue', tube([V3(s * 0.15, 0.68, 0.62), V3(s * 0.08, 0.76, 0.66), V3(0, 0.78, 0.67)], 0.03, 8));

  // inner garment (僧祇支): band with a knot, U-folds on the chest
  const band = []; for (let i = 0; i <= 10; i++) band.push(torsoPt(Math.PI / 2 + (i / 10 - 0.5) * 1.1, 1.16, 0.012)); add('trim', tube(band, 0.03, 6));
  for (const s of [-1, 1]) add('trim', new THREE.TorusGeometry(0.06, 0.018, 6, 14).rotateY(s * 0.4).translate(s * 0.07, 1.16, rz(1.16) + 0.03));
  for (const s of [-1, 1]) add('trim', tube([V3(s * 0.03, 1.13, rz(1.13) + 0.03), V3(s * 0.06, 0.98, rz(1.0) + 0.05), V3(s * 0.05, 0.86, rz(0.86) + 0.08)], 0.016, 5));
  for (let k = 0; k < 4; k++) {
    const y0 = 1.62 - k * 0.14, pts = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12 * 2 - 1; pts.push(torsoPt(Math.PI / 2 + t * (0.36 - k * 0.03), y0 - 0.1 * (1 - t * t), 0.008)); }
    add('statue', tube(pts, 0.016, 5));
  }
  // lap folds sweeping from the knees to the hands
  const lapY = (x, z) => 0.27 + 0.32 * Math.sqrt(Math.max(1 - (x / 1.18) ** 2 - ((z - 0.22) / 0.78) ** 2, 0));
  for (let k = 0; k < 4; k++) for (const s of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10, x = s * (0.95 - t * 0.7), z = 0.5 + 0.38 * Math.sin(Math.PI * t * 0.8) - k * 0.1;
      pts.push(V3(x, lapY(x, z) + 0.012, z));
    }
    add('statue', tube(pts, 0.016, 5));
  }

  // short, full neck with 三道
  const neck = new THREE.CylinderGeometry(0.19, 0.23, 0.24, 24); neck.translate(0, 2.04, 0.03); add('statue', neck);
  for (const y of [1.99, 2.04, 2.09]) add('statue', new THREE.TorusGeometry(0.215 - (y - 1.99) * 0.25, 0.008, 4, 28).rotateX(Math.PI / 2).translate(0, y, 0.03));

  // head
  const R = V3(0.31, 0.37, 0.33), HY = 2.4, HZ = 0.05;
  const opts = { buddha: true };
  add('statue', sculptHead(R, opts).translate(0, HY, HZ));
  for (const s of [-1, 1]) add('statue', ear(R, s, true).translate(0, HY, HZ));
  for (const l of faceLines(R, opts)) add(l.key, l.geo.translate(0, HY, HZ));
  // 白毫
  const urna = facePoint(0, 0.2, R, opts, 0.01); add('pearl', new THREE.SphereGeometry(0.022, 10, 8).translate(urna.x, urna.y + HY, urna.z + HZ));
  // hair cap + 螺髮 + 肉髻 + 髻珠
  // hairline: forehead high, temples lower, nape lowest — shared by the cap and the curls
  const hairline = (z) => 0.38 - 0.34 * (1 - Math.max(z, 0)) - 0.27 * Math.max(-z, 0);
  add('hair', grid((u, v) => {
    const phi = u * Math.PI * 2, polarMax = Math.acos(hairline(Math.sin(phi) * 0.95) - 0.02);
    const th = v * polarMax, y = Math.cos(th), rr = Math.sin(th);
    return V3(Math.cos(phi) * rr * R.x * 1.012, y * R.y * 1.012 + HY, Math.sin(phi) * rr * R.z * 1.012 + HZ);
  }, 48, 14));
  const ushY = HY + R.y * 0.92;
  const ush = new THREE.SphereGeometry(1, 24, 16); ush.scale(0.17, 0.15, 0.17); ush.translate(0, ushY, HZ - 0.01); add('hair', ush);
  // 螺髮: dense small curls (low-poly, they are tiny on screen)
  const curl = new THREE.SphereGeometry(1, 5, 3);
  const N = 1300, golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, rr = Math.sqrt(1 - y * y), a = i * golden;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (y < hairline(z)) continue;
    const c = curl.clone(); c.scale(0.019, 0.016, 0.019);
    c.translate(x * R.x * 1.03, y * R.y * 1.03 + HY, z * R.z * 1.03 + HZ);
    add('hair', c);
  }
  for (let i = 0; i < 150; i++) {
    const y = 1 - (i / 149) * 1.3, rr = Math.sqrt(Math.max(1 - y * y, 0)), a = i * golden;
    const c = curl.clone(); c.scale(0.018, 0.015, 0.018);
    c.translate(Math.cos(a) * rr * 0.175, y * 0.155 + ushY, Math.sin(a) * rr * 0.175 + HZ - 0.01);
    add('hair', c);
  }
  add('jewel', new THREE.SphereGeometry(0.035, 12, 8).translate(0, ushY - 0.08, HZ + 0.16));
  return parts;
}

// ---------------------------------------------------------------- 蓮花須彌座

function lotusThrone(height = 1.0) {
  const parts = [];
  const add = (key, geo) => parts.push({ key, geo });
  const H = height;
  // 須彌座: octagonal plinth with mouldings
  const tiers = [[0.0, 0.14, 1.58], [0.14, 0.22, 1.5], [0.22, 0.42, 1.32], [0.42, 0.5, 1.46], [0.5, 0.56, 1.36]];
  for (const [y0, y1, r] of tiers) {
    const c = new THREE.CylinderGeometry(r, r, (y1 - y0) * H, 8); c.rotateY(Math.PI / 8); c.translate(0, (y0 + y1) / 2 * H - H, 0);
    add(y1 - y0 > 0.1 ? 'throne' : 'statue', c);
  }
  // drum (mostly hidden behind the petals)
  const drum = new THREE.CylinderGeometry(1.0, 1.05, 0.4 * H, 32); drum.translate(0, -0.24 * H, 0); add('throne', drum);
  // 覆蓮: broad petals turned down over the plinth edge
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const p = petal(0.4, 0.5, 0.18, 0.2);
    p.rotateX(Math.PI * 0.6); p.translate(0, 0, 1.18); p.rotateY(a); p.translate(0, -0.43 * H, 0);
    add('statue', p);
  }
  // 仰蓮: three staggered rows opening upward around the seat
  for (const [row, n, r, L, W, tilt, y] of [[0, 20, 1.14, 0.56, 0.5, 0.6, -0.42], [1, 20, 1.04, 0.5, 0.46, 0.38, -0.3], [2, 20, 0.94, 0.4, 0.4, 0.2, -0.18]]) {
    for (let i = 0; i < n; i++) {
      const a = ((i + row * 0.5) / n) * Math.PI * 2;
      const p = petal(L, W, 0.24, 0.16);
      p.rotateX(tilt); p.translate(0, 0, r); p.rotateY(a); p.translate(0, y * H, 0); // +x rotation leans the tip outward
      add('statue', p);
    }
  }
  // seat disc
  const seat = new THREE.CylinderGeometry(1.0, 1.05, 0.08, 32); seat.translate(0, -0.04, 0); add('statue', seat);
  return parts;
}

// ---------------------------------------------------------------- 脅侍立像（迦葉、阿難）

function standingMonk({ old = false } = {}) {
  const parts = [];
  const add = (key, geo) => parts.push({ key, geo });
  const skin = old ? 'skinOld' : 'skinYoung';
  // body: inner robe below, kasaya over it (偏袒右肩: left shoulder covered)
  const rx = profile([[0.0, 0.36], [0.25, 0.31], [0.8, 0.28], [1.15, 0.28], [1.45, 0.31], [1.62, 0.34], [1.74, 0.24], [1.8, 0.1]]);
  const rz = profile([[0.0, 0.3], [0.25, 0.25], [0.8, 0.21], [1.15, 0.2], [1.45, 0.21], [1.62, 0.19], [1.74, 0.15], [1.8, 0.07]]);
  add('robeInner', ellipticLathe(rx, rz, 0.05, 1.8, 32, 24));
  const kx = (y) => rx(y) + 0.02, kz = (y) => rz(y) + 0.02;
  add('robeOuter', grid((u, v) => {
    const a = u * Math.PI * 2, y = 0.42 + v * 0.95 + 0.06 * Math.sin(a * 3) * (1 - v);
    return V3(kx(y) * Math.cos(a), y, kz(y) * Math.sin(a));
  }, 32, 12, { twoSided: true }));
  // kasaya band from the left shoulder across the chest to the right hip
  const sash = (u) => { const y = 1.74 - u * 0.95; const a = Math.PI / 2 + (0.95 - u * 1.9); return V3((kx(y) + 0.012) * Math.cos(a) * (u < 0.1 ? 0.9 : 1), y, (kz(y) + 0.012) * Math.sin(a)); };
  const sashN = (u) => { const p = sash(u); return V3(p.x, 0, p.z).normalize(); };
  add('robeOuter', ribbon((u) => { const p = sash(u); return p; }, sashN, 0.22));
  // kasaya 田相: a few dark seams in a grid on the outer robe (not gold: it is cloth)
  for (let k = 0; k < 3; k++) {
    const pts = []; const yy = 0.7 + k * 0.22;
    for (let i = 0; i <= 20; i++) { const a = (i / 20) * Math.PI * 2; pts.push(V3((kx(yy) + 0.004) * Math.cos(a), yy, (kz(yy) + 0.004) * Math.sin(a))); }
    add('robeSeam', tube(pts, 0.005, 3));
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2, pts = [];
    for (let i = 0; i <= 6; i++) { const yy = 0.5 + i * 0.13; pts.push(V3((kx(yy) + 0.004) * Math.cos(a), yy, (kz(yy) + 0.004) * Math.sin(a))); }
    add('robeSeam', tube(pts, 0.005, 3));
  }
  // feet (cloth shoes) peeking out under the hem
  for (const s of [-1, 1]) add('line', new THREE.SphereGeometry(1, 10, 6).scale(0.055, 0.035, 0.1).translate(s * 0.09, 0.03, 0.27));
  // arms → hands joined (合十) at the chest
  for (const s of [-1, 1]) {
    const sh = V3(s * 0.31, 1.6, 0), el = V3(s * 0.3, 1.25, 0.12), wr = V3(s * 0.04, 1.42, 0.3);
    for (const [a, b, rad] of [[sh, el, 0.075], [el, wr, 0.065]]) {
      const len = a.distanceTo(b), cap = new THREE.CapsuleGeometry(rad, len, 4, 10);
      cap.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), b.clone().sub(a).normalize()));
      cap.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      add(s > 0 ? 'robeOuter' : 'robeInner', cap);
    }
    add(skin, new THREE.SphereGeometry(1, 12, 10).scale(0.025, 0.1, 0.055).rotateX(-0.25).translate(s * 0.022, 1.5, 0.33));
  }
  // neck + head (shaved)
  add(skin, new THREE.CylinderGeometry(0.06, 0.07, 0.14, 14).translate(0, 1.84, 0.01));
  const R = V3(0.12, 0.155, 0.14), HY = 2.02;
  const opts = { age: old ? 1 : 0 };
  add(skin, sculptHead(R, opts, 36).translate(0, HY, 0.02));
  for (const s of [-1, 1]) add(skin, ear(R, s, false).translate(0, HY, 0.02));
  for (const l of faceLines(R, opts, { browDrop: old ? 0.05 : 0 })) add(old ? 'lineWhite' : 'line', l.geo.translate(0, HY, 0.02));
  if (old) {
    // forehead lines
    for (let k = 0; k < 3; k++) {
      const pts = []; for (let i = 0; i <= 8; i++) pts.push(facePoint((i / 8 - 0.5) * 0.5, 0.36 + k * 0.08, R, opts, 0.001));
      add('lineSoft', tube(pts, 0.0016, 3).translate(0, HY, 0.02));
    }
  }
  // small lotus pedestal
  for (let i = 0; i < 12; i++) {
    const p = petal(0.16, 0.16, 0.2, 0.25); p.rotateX(0.5); p.translate(0, 0, 0.3); p.rotateY((i / 12) * Math.PI * 2); p.translate(0, -0.14, 0);
    add('statue', p);
  }
  add('throne', new THREE.CylinderGeometry(0.34, 0.38, 0.14, 20).translate(0, -0.07, 0));
  return parts;
}

// ---------------------------------------------------------------- mandorla (背光)

function mandorlaTexture() {
  // drawn in 768×1152 units on a 2/3-size canvas (texture memory budget, SCENE_PACKAGE.md)
  const w = 768, h = 1152, k = 2 / 3;
  const c = document.createElement('canvas'); c.width = w * k; c.height = h * k;
  const g = c.getContext('2d'); g.scale(k, k);
  const cx = w / 2;
  // body aureole: pointed oval
  const body = new Path2D();
  body.moveTo(cx, 40);
  body.bezierCurveTo(cx + 260, 220, cx + 360, 640, cx + 340, h - 40);
  body.lineTo(cx - 340, h - 40);
  body.bezierCurveTo(cx - 360, 640, cx - 260, 220, cx, 40);
  // flame border
  g.save(); g.clip(body);
  g.fillStyle = '#b8862e'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 46; i++) {
    const t = i / 45, y = 60 + t * (h - 120), side = i % 2 ? 1 : -1;
    g.fillStyle = i % 3 ? '#d8a948' : '#e9c46a';
    g.beginPath(); const x = cx + side * (180 + 150 * Math.sin(Math.PI * Math.min(t * 1.1, 1)));
    g.moveTo(x, y + 40); g.quadraticCurveTo(x + side * 50, y, x + side * 20, y - 50); g.quadraticCurveTo(x - side * 20, y - 10, x, y + 40); g.fill();
  }
  // inner bands: deep red, teal, gold rings like painted 背光
  const inner = (s, col) => { g.save(); g.translate(cx, h - 40); g.scale(s, s); g.translate(-cx, -(h - 40)); g.fillStyle = col; g.fill(body); g.restore(); };
  inner(0.86, '#7a2a20'); inner(0.8, '#c9a24a'); inner(0.76, '#24524c'); inner(0.7, '#c9a24a'); inner(0.66, '#5a1f1a');
  // fine gold rays (光芒) radiating from behind the body
  g.strokeStyle = 'rgba(226,194,122,0.45)'; g.lineWidth = 3;
  for (let i = 0; i < 64; i++) {
    const a = Math.PI + (i / 63) * Math.PI;
    g.beginPath(); g.moveTo(cx, h - 140); g.lineTo(cx + Math.cos(a) * 900, h - 140 + Math.sin(a) * 900); g.stroke();
  }
  g.restore();
  g.strokeStyle = '#e2c27a'; g.lineWidth = 10; g.stroke(body);
  // head halo (頭光): rings + lotus petals
  const hy = 330, hr = 230;
  const ring = (r, col) => { g.fillStyle = col; g.beginPath(); g.arc(cx, hy, r, 0, Math.PI * 2); g.fill(); };
  ring(hr, '#e2c27a'); ring(hr - 14, '#7a2a20'); ring(hr - 26, '#c9a24a');
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.save(); g.translate(cx + Math.cos(a) * (hr - 72), hy + Math.sin(a) * (hr - 72)); g.rotate(a + Math.PI / 2);
    g.fillStyle = i % 2 ? '#e9c46a' : '#d8a948'; g.beginPath(); g.ellipse(0, 0, 18, 40, 0, 0, Math.PI * 2); g.fill(); g.restore();
  }
  ring(hr - 112, '#24524c'); ring(hr - 124, '#e2c27a'); ring(hr - 132, '#3a1a14');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------- assembly

export const STATUE_MATERIALS = () => ({
  // 鎏金：metal with a little roughness so it reads as gilded bronze, not chrome
  statue: new THREE.MeshStandardMaterial({ color: '#d4a64a', metalness: 0.75, roughness: 0.38 }),
  trim: new THREE.MeshStandardMaterial({ color: '#b5852e', metalness: 0.7, roughness: 0.45 }),
  hair: new THREE.MeshStandardMaterial({ color: '#2a3a63', roughness: 0.55, metalness: 0.15 }),
  line: new THREE.MeshStandardMaterial({ color: '#2a1d14', roughness: 0.8 }),
  lineWhite: new THREE.MeshStandardMaterial({ color: '#e8e2d6', roughness: 0.8 }),
  lineSoft: new THREE.MeshStandardMaterial({ color: '#8a6648', roughness: 0.9 }),
  pearl: new THREE.MeshStandardMaterial({ color: '#f4efe4', emissive: '#fff3d6', emissiveIntensity: 0.4, roughness: 0.25 }),
  jewel: new THREE.MeshStandardMaterial({ color: '#9e1b16', metalness: 0.3, roughness: 0.25 }),
  throne: new THREE.MeshStandardMaterial({ color: '#7a2a20', roughness: 0.5 }),
  skinOld: new THREE.MeshStandardMaterial({ color: '#c49a72', roughness: 0.75 }),
  skinYoung: new THREE.MeshStandardMaterial({ color: '#e3c29d', roughness: 0.7 }),
  robeInner: new THREE.MeshStandardMaterial({ color: '#b08a52', roughness: 0.85 }),
  robeOuter: new THREE.MeshStandardMaterial({ color: '#8c3424', roughness: 0.8, side: THREE.DoubleSide }),
  robeSeam: new THREE.MeshStandardMaterial({ color: '#5e2016', roughness: 0.9 }),
});

/**
 * Adds the main image and attendants to a Batch. (x, topY, z) = centre of the altar top.
 * Returns extra meshes (mandorla) that need their own material.
 */
export function addShrine(B, M, { x, topY, z, width = 8 }) {
  const place = (parts, mtx) => { for (const p of parts) B.add(p.key, p.geo, mtx); };
  const throneH = 0.95, seatY = topY + throneH;
  place(lotusThrone(throneH), M(x, seatY, z));
  place(seatedBuddha(), M(x, seatY, z + 0.05));
  // attendants stand on the altar ends, turned slightly inward (迦葉 at the Buddha's left = +x)
  const ax = Math.min(width / 2 - 0.9, 3.0);
  place(standingMonk({ old: true }), M(x + ax, topY + 0.14, z + 0.3, 0, -0.22, 0, 1.25));
  place(standingMonk({ old: false }), M(x - ax, topY + 0.14, z + 0.3, 0, 0.22, 0, 1.25));

  // Texture layout: head-halo centre sits 28.6% from the top, aureole base 96.5% → size the
  // plane so the halo is centred on the head (seatY + 2.46) and the base meets the throne.
  const H = 4.8, W = H * 768 / 1152;
  const mand = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({
    map: mandorlaTexture(), roughness: 0.5, metalness: 0.35, emissive: '#3a2410', emissiveIntensity: 0.25, alphaTest: 0.5,
  }));
  mand.position.set(x, seatY + 2.4 - (0.5 - 0.286) * H, z - 0.7);
  return [mand];
}
