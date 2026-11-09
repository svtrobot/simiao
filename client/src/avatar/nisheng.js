// 泥生 · 招牌化身（设计文档 11.4）。
// 形体与精稿 / 3D 渲染同一套参数：钟形陶身、无嘴弯弧眼、胸口心灯、袈裟偏袒右肩（搭左肩）。
// 釉色、冰裂、兔毫、金缮线、背后指纹全部由着色器参数生成，不用贴图，
// 所以 100 尊泥生各不相同，也不增加下载量。
// 模型空间：正面朝 +z，单位为“泥生单位”（身高约 3.1），root 统一缩放到约 1.1 米。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const MODEL_SCALE = 0.355;
const ZS = 0.86;
const WAIST = 0.95;
const NECK = 2.12;
const L1 = 0.6, L2 = 0.46;

export function bodyR(y) {
  const t = Math.min(Math.max(y / 2.05, 0), 1);
  return 0.82 - 0.4 * t ** 1.5 + 0.04 * Math.sin(Math.PI * t);
}
function domeR(y) { const k = (y - 2.0) / 0.24; return k >= 1 ? 0 : 0.5 * Math.sqrt(1 - k * k); }
function surfR(y) { return y <= 2.0 ? bodyR(y) : Math.max(domeR(y), 0); }

// ---------------------------------------------------------------- geometry (shared)
function latheZ(points, segs = 32) {
  const g = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y)), segs);
  g.scale(1, 1, ZS);
  return g;
}
const strip = (g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); return n; };

function ribbon(fn, nu, nv) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const p = fn(i / nu, j / nv); pos.push(p.x, p.y, p.z); uv.push(i / nu * 5, j / nv);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i; idx.push(a, a + nu + 1, a + 1, a + 1, a + nu + 1, a + nu + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

let GEO = null;
function geometry() {
  if (GEO) return GEO;
  const lowerPts = [[0, 0.02], [0.7, 0.0], [bodyR(0) , 0.06]];
  for (let y = 0.1; y <= WAIST + 0.06; y += 0.08) lowerPts.push([bodyR(y), y]);
  lowerPts.push([0, WAIST + 0.06]);
  const lower = latheZ(lowerPts);
  const waistBall = new THREE.SphereGeometry(bodyR(WAIST) * 0.985, 28, 16); waistBall.scale(1, 0.55, ZS); waistBall.translate(0, WAIST, 0);
  const foot = new THREE.SphereGeometry(1, 16, 10);
  const footL = foot.clone(); footL.scale(0.15, 0.08, 0.16); footL.translate(0.23, 0.075, 0.74);
  const footR = foot.clone(); footR.scale(0.15, 0.08, 0.16); footR.translate(-0.23, 0.075, 0.74);
  const lowerClay = mergeGeometries([strip(lower), strip(waistBall)]);
  const feet = mergeGeometries([strip(footL), strip(footR)]);

  const upperPts = [[0, WAIST - 0.06]];
  for (let y = WAIST - 0.06; y <= 2.0; y += 0.07) upperPts.push([bodyR(y), y]);
  for (const y of [2.04, 2.09, 2.14, 2.18, 2.21, 2.235]) upperPts.push([Math.max(domeR(y), 0.02), y]);
  upperPts.push([0, 2.24]);
  const upper = latheZ(upperPts); upper.translate(0, -WAIST, 0); // upper pivot at waist

  // hem: open felt skirt with uneven folds
  const hem = new THREE.CylinderGeometry(1, 1, 1, 64, 6, true);
  const p = hem.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y01 = p.getY(i) + 0.5;
    const y = y01 * 0.5;
    const ang = Math.atan2(p.getZ(i), p.getX(i));
    const fold = (1 - y01) * (0.05 + 0.018 * Math.sin(ang * 11) + 0.007 * Math.sin(ang * 23));
    const r = bodyR(y) + 0.03 + fold;
    p.setXYZ(i, Math.cos(ang) * r, y - (1 - y01) * 0.012 * (1 + Math.sin(ang * 7)), Math.sin(ang) * r * ZS);
  }
  hem.computeVertexNormals();
  const stitch = new THREE.TorusGeometry(bodyR(0.42) + 0.045, 0.007, 4, 90); stitch.rotateX(Math.PI / 2); stitch.scale(1, 1, ZS); stitch.translate(0, 0.42, 0);

  // sash over the LEFT shoulder (character's left = +x), down across to the right hip
  const top = new THREE.Vector2(0.34, 2.14), bot = new THREE.Vector2(-0.64, 0.98);
  const dir = bot.clone().sub(top).normalize(); const nrm = new THREE.Vector2(-dir.y, dir.x);
  const sashFn = (side) => (u, v) => {
    const c = top.clone().lerp(bot, u);
    const q = c.clone().addScaledVector(nrm, (v - 0.5) * 0.33);
    const R = surfR(q.y) + 0.035;
    const x = THREE.MathUtils.clamp(q.x, -R * 0.995, R * 0.995);
    const z = side * ZS * Math.sqrt(Math.max(R * R - x * x, 0)) + side * 0.008;
    return new THREE.Vector3(x, q.y - WAIST, z);
  };
  const sash = mergeGeometries([strip(ribbon(sashFn(1), 26, 4)), strip(ribbon(sashFn(-1), 26, 4))]);

  // 心灯：胸口莲苞形小窗
  const lampY = 1.18, lampZ = ZS * bodyR(lampY);
  const lamp = new THREE.SphereGeometry(1, 18, 14); lamp.scale(0.085, 0.14, 0.035); lamp.translate(0, lampY - WAIST, lampZ - 0.004);
  const rim = new THREE.TorusGeometry(1, 0.13, 6, 28); rim.scale(0.1, 0.155, 0.12); rim.translate(0, lampY - WAIST, lampZ - 0.01);
  const ringY = 1.88, ringX = 0.14;
  const ringZ = ZS * Math.sqrt(bodyR(ringY) ** 2 - ringX ** 2) + 0.07;
  const ring = new THREE.TorusGeometry(0.06, 0.017, 8, 20); ring.translate(ringX, ringY - WAIST, ringZ);
  const brass = mergeGeometries([strip(ring)]);

  // head (in neck-pivot space) and engraved closed eyes
  const head = new THREE.SphereGeometry(1, 36, 24); head.scale(0.68, 0.47, 0.58); head.translate(0, 2.62 - NECK, 0);
  const eyes = [];
  for (const xc of [-0.215, 0.215]) {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10, x = xc + (t - 0.5) * 0.19, y = 2.61 - 0.05 * Math.sin(Math.PI * t);
      const z = 0.58 * Math.sqrt(Math.max(1 - (x / 0.68) ** 2 - ((y - 2.62) / 0.47) ** 2, 0)) + 0.003;
      pts.push(new THREE.Vector3(x, y - NECK, z));
    }
    // thick carved slot, as in the reference renders
    eyes.push(strip(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.032, 8, false)));
  }

  // limbs (oriented along +y, centred)
  const upperArm = new THREE.CapsuleGeometry(0.115, L1, 4, 12);
  const foreArm = new THREE.CapsuleGeometry(0.1, L2, 4, 12);
  // 半包指手：拇指独立，其余合为一（mitten）
  const palm = new THREE.SphereGeometry(1, 16, 12); palm.scale(0.075, 0.13, 0.05); palm.translate(0, 0.1, 0);
  const thumb = new THREE.CapsuleGeometry(0.028, 0.07, 3, 8); thumb.rotateZ(0.6); thumb.translate(0.065, 0.05, 0.02);
  const hand = mergeGeometries([strip(palm), strip(thumb)]);

  // props
  const stick = new THREE.CylinderGeometry(0.012, 0.012, 1.0, 5); stick.translate(0, 0.5, 0);
  const sticks = mergeGeometries([-0.045, 0, 0.045].map((x) => { const g = strip(stick.clone()); g.translate(x, 0, 0); return g; }));
  const tip = new THREE.SphereGeometry(0.025, 6, 4);
  const tips = mergeGeometries([-0.045, 0, 0.045].map((x) => { const g = strip(tip.clone()); g.translate(x, 1.0, 0); return g; }));
  const mallet = mergeGeometries([strip(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6).translate(0, 0.25, 0)), strip(new THREE.SphereGeometry(0.07, 10, 8).translate(0, 0.52, 0))]);
  const beads = new THREE.TorusGeometry(0.16, 0.03, 6, 40); beads.rotateX(Math.PI / 2.4);

  GEO = { lowerClay, feet, hem, stitch, upper, sash, lamp, rim, brass, head, eyes: mergeGeometries(eyes), upperArm, foreArm, hand, sticks, tips, mallet, beads };
  return GEO;
}

// ---------------------------------------------------------------- materials (cached by look)
const STAGE = {
  // Base colours sampled from the reference renders in docs/design/character/.
  raw: { color: '#b8ab9a', rough: 0.95, glaze: false },
  bisque: { color: '#cf8a5e', rough: 0.86, glaze: false },
  glaze: { color: '#f3f1ea', rough: 0.2, glaze: true },
  kiln: { color: '#b6cec9', rough: 0.18, glaze: true },
  kintsugi: { color: '#b6cec9', rough: 0.18, glaze: true },
};
const KILN = { celadon: '#b6cec9', ochre: '#c98e5a', inkcrackle: '#e6e1d6', harefur: '#3e3128' };

const GLSL_NOISE = `
  vec3 nsHash(vec3 p){ p = fract(p*vec3(.1031,.1030,.0973)); p += dot(p, p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }
  float nsWorley(vec3 p){ vec3 i=floor(p), f=fract(p); float f1=9.0, f2=9.0;
    for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) for(int z=-1;z<=1;z++){
      vec3 o=vec3(float(x),float(y),float(z)); vec3 r=o+nsHash(i+o)-f; float d=dot(r,r);
      if(d<f1){f2=f1;f1=d;} else if(d<f2){f2=d;} }
    return sqrt(f2)-sqrt(f1); }
  float nsValue(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(mix(nsHash(i).x,nsHash(i+vec3(1,0,0)).x,f.x),mix(nsHash(i+vec3(0,1,0)).x,nsHash(i+vec3(1,1,0)).x,f.x),f.y),
               mix(mix(nsHash(i+vec3(0,0,1)).x,nsHash(i+vec3(1,0,1)).x,f.x),mix(nsHash(i+vec3(0,1,1)).x,nsHash(i+vec3(1,1,1)).x,f.x),f.y),f.z); }
`;

const matCache = new Map();
/**
 * Clay material for a look: { stage, kiln, cracks 0..1, gold 0..12, seed }.
 * part: 'upper' (carries the fingerprint on the back), 'lower' or 'part'. Seeds are bucketed
 * so materials can be shared across avatars.
 */
export function clayMaterial(look, part = 'part', { ghost = false } = {}) {
  const stage = STAGE[look.stage] ? look.stage : 'raw';
  const kiln = stage === 'kiln' || stage === 'kintsugi' ? (KILN[look.kiln] ? look.kiln : 'celadon') : 'none';
  const cracks = Math.round((look.cracks || 0) * 4) / 4;
  const gold = stage === 'kintsugi' ? 1 : Math.min(1, Math.round((look.gold || 0)) / 6);
  const seed = (look.seed || 0) % 8;
  const key = `${stage}|${kiln}|${cracks}|${gold}|${seed}|${part}|${ghost}`;
  if (matCache.has(key)) return matCache.get(key);
  const s = STAGE[stage];
  const color = kiln !== 'none' ? KILN[kiln] : s.color;
  const m = s.glaze
    ? new THREE.MeshPhysicalMaterial({ color, roughness: s.rough, clearcoat: 1, clearcoatRoughness: 0.12, sheen: 0 })
    : new THREE.MeshStandardMaterial({ color, roughness: s.rough });
  if (ghost) { m.transparent = true; m.opacity = 0.28; m.depthWrite = false; m.color.lerp(new THREE.Color('#ffffff'), 0.4); }
  const pattern = kiln === 'inkcrackle' ? 1 : kiln === 'harefur' ? 2 : 0;
  const uniforms = {
    uCrack: { value: cracks }, uGold: { value: gold }, uSeed: { value: seed * 7.31 }, uPattern: { value: pattern },
    uPrint: { value: part === 'upper' ? 1 : 0 }, uGrain: { value: s.glaze ? 0.02 : 0.16 },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vObj; uniform float uCrack, uGold, uSeed, uPattern, uPrint, uGrain;\n${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 nsP = vObj*3.2 + uSeed;
        float nsGrain = nsValue(vObj*55.0+uSeed);
        diffuseColor.rgb *= 1.0 - uGrain*0.5 + uGrain*nsGrain;
        diffuseColor.rgb *= 0.9 + 0.2*nsValue(vObj*4.0+uSeed);
        // Large cell network shared by crackle and kintsugi (reference: stages_lineup.png).
        float nsE = nsWorley(nsP*0.95);
        float nsNet = 1.0 - smoothstep(0.0, 0.05, nsE);
        if (uPattern > 0.5 && uPattern < 1.5) diffuseColor.rgb *= mix(0.35, 1.0, smoothstep(0.0, 0.05, nsE));
        if (uPattern > 1.5) { float nsSt = nsValue(vec3(vObj.x*40.0, vObj.y*1.5, vObj.z*40.0)+uSeed); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78,0.74,0.68), smoothstep(0.72,0.9,nsSt)); }
        float nsHair = 1.0 - smoothstep(0.0, 0.025, nsWorley(nsP*2.1+7.0));
        diffuseColor.rgb *= 1.0 - (nsNet*0.6 + nsHair*0.25)*uCrack;
        float nsGold = (1.0 - smoothstep(0.0, 0.075, nsE)) * step(0.001, uGold) * step(nsValue(nsP*0.7), uGold+0.15);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85,0.64,0.24), nsGold);
        if (uPrint > 0.5 && vObj.z < -0.3) {
          vec2 nsQ = (vObj.xy - vec2(0.05, 0.38)) * vec2(1.0, 0.8);
          float nsD = length(nsQ) + 0.006*sin(atan(nsQ.y,nsQ.x)*3.0 + uSeed);
          diffuseColor.rgb *= 1.0 - 0.12*step(nsD, 0.13)*step(0.5, fract(nsD*70.0));
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, nsGold);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 1.0, nsGold);');
  };
  m.customProgramCacheKey = () => `nisheng-${s.glaze ? 'g' : 'c'}-${ghost ? 'h' : 's'}`;
  m.userData.uniforms = uniforms;
  matCache.set(key, m);
  return m;
}

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#cfc6b6'; g.fillRect(0, 0, 256, 64);
  g.strokeStyle = 'rgba(110,100,88,0.6)'; g.setLineDash([5, 4]); g.lineWidth = 2;
  for (const y of [6, 32, 58]) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  for (const x of [0, 64, 128, 192]) { g.beginPath(); g.moveTo(x + 2, 0); g.lineTo(x + 2, 64); g.stroke(); }
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  SHARED = {
    sash: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, side: THREE.DoubleSide }),
    hem: new THREE.MeshStandardMaterial({ color: '#9e968b', roughness: 1, side: THREE.DoubleSide }),
    stitch: new THREE.MeshBasicMaterial({ color: '#e8e1d4' }),
    brass: new THREE.MeshStandardMaterial({ color: '#c9a060', metalness: 0.9, roughness: 0.35 }),
    eyes: new THREE.MeshStandardMaterial({ color: '#3a2418', roughness: 0.9 }),
    rim: new THREE.MeshStandardMaterial({ color: '#5a3a26', roughness: 0.9 }),
    stick: new THREE.MeshStandardMaterial({ color: '#7e2f1e', roughness: 0.8 }),
    tip: new THREE.MeshBasicMaterial({ color: '#ff6a2a' }),
    wood: new THREE.MeshStandardMaterial({ color: '#6a4a33', roughness: 0.7 }),
    beads: new THREE.MeshStandardMaterial({ color: '#4a2a1a', roughness: 0.5 }),
    ghost: new THREE.MeshBasicMaterial({ color: '#efe7da', transparent: true, opacity: 0.16, depthWrite: false }),
  };
  return SHARED;
}

// ---------------------------------------------------------------- poses
// Wrist targets / hand frames in MODEL space (before the upper-body bend) are
// resolved per frame by 2-bone IK. Values mirror the storyboard key frames.
const POSES = {
  idle:      { bend: 0, nod: 0, drop: 0, squash: 1, hands: 'side' },
  walk:      { bend: 0.04, nod: 0, drop: 0, squash: 1, hands: 'side' },
  pray:      { bend: 0, nod: 0.26, drop: 0, squash: 1, hands: 'pray' },
  bow:       { bend: 0.52, nod: 0.26, drop: 0, squash: 1, hands: 'pray' },
  prostrate: { bend: 1.78, nod: 0, drop: 0.12, squash: 0.92, hands: 'floor' },
  incense:   { bend: 0.1, nod: 0.22, drop: 0, squash: 1, hands: 'incense' },
  sit:       { bend: 0, nod: 0.08, drop: 0.32, squash: 0.8, hands: 'mudra' },
  muyu:      { bend: 0.08, nod: 0.12, drop: 0.32, squash: 0.8, hands: 'muyu' },
  bead:      { bend: 0.05, nod: 0.18, drop: 0, squash: 1, hands: 'bead' },
  fortune:   { bend: 0.2, nod: 0.2, drop: 0, squash: 1, hands: 'fortune' },
  wish:      { bend: 0, nod: -0.12, drop: 0, squash: 1, hands: 'wish' },
  greet:     { bend: 0.3, nod: 0.26, drop: 0, squash: 1, hands: 'pray' },
};

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function handTargets(kind, side, t, a) {
  // returns { center: Vector3 (upper-local, unbent), finger: Vector3, palm: Vector3, world?: bool }
  const s = side; // +1 = character's left (+x)
  switch (kind) {
    case 'pray': return { c: new THREE.Vector3(0.036 * s, 1.78, 0.74), f: new THREE.Vector3(0, 1, 0.12), p: new THREE.Vector3(-s, 0, 0) };
    case 'incense': return { c: new THREE.Vector3(0.036 * s, 1.97, 0.8), f: new THREE.Vector3(0, 1, 0.45), p: new THREE.Vector3(-s, 0, 0) };
    case 'mudra': return { c: new THREE.Vector3(0.07 * s, 1.02, 0.7), f: new THREE.Vector3(-s, 0, 0.25), p: new THREE.Vector3(0, 1, 0) };
    case 'muyu': return s < 0
      ? { c: new THREE.Vector3(-0.28, 1.12 + Math.max(0, Math.sin(t * 6)) * 0.12 * a, 0.82), f: new THREE.Vector3(0.3, 0.2, 1), p: new THREE.Vector3(0, 1, 0) }
      : { c: new THREE.Vector3(0.36, 1.0, 0.74), f: new THREE.Vector3(0, -0.2, 1), p: new THREE.Vector3(0, 1, 0) };
    case 'bead': return s > 0
      ? { c: new THREE.Vector3(0.1, 1.48, 0.74), f: new THREE.Vector3(-1, 0.4, 0.2), p: new THREE.Vector3(0, 1, 0) }
      : { c: new THREE.Vector3(-0.07, 1.52 + Math.sin(t * 8) * 0.02, 0.78), f: new THREE.Vector3(1, 0.3, 0.3), p: new THREE.Vector3(0, -1, 0) };
    case 'fortune': return { c: new THREE.Vector3(0.12 * s, 1.55 + Math.sin(t * 14) * 0.04 * a, 0.78), f: new THREE.Vector3(0, 0.5, 1), p: new THREE.Vector3(-s, 0, 0) };
    case 'wish': return s < 0
      ? { c: new THREE.Vector3(-0.32, 2.15, 0.7), f: new THREE.Vector3(0, 1, 0.3), p: new THREE.Vector3(0, 0, 1) }
      : { c: new THREE.Vector3(0.85, 1.15, 0.25), f: new THREE.Vector3(0.1, -1, 0.15), p: new THREE.Vector3(-1, 0, 0) };
    case 'floor': return { c: new THREE.Vector3(0.62 * s, 0.07, 1.85), f: new THREE.Vector3(0, 0, 1), p: new THREE.Vector3(0, 1, 0), model: true };
    case 'side':
    default: {
      const swing = Math.sin(t * 5.2) * 0.13 * a * s;
      // hands hang just outside the bell-shaped body (radius ≈ 0.72 at y = 1)
      return { c: new THREE.Vector3(0.86 * s, 1.05, 0.22 + swing), f: new THREE.Vector3(0.12 * s, -1, 0.15), p: new THREE.Vector3(-s, 0, 0) };
    }
  }
}

function solveIK(S, T, pole, out) {
  const d0 = _v.copy(T).sub(S);
  let d = d0.length();
  const dir = d0.normalize();
  d = THREE.MathUtils.clamp(d, Math.abs(L1 - L2) + 0.01, L1 + L2 - 0.005);
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(L1 * L1 - a * a, 0));
  const pd = _w.copy(pole).sub(S); pd.addScaledVector(dir, -pd.dot(dir)).normalize();
  out.E.copy(S).addScaledVector(dir, a).addScaledVector(pd, h);
  out.W.copy(S).addScaledVector(dir, d);
}

function placeSegment(mesh, A, B) {
  mesh.position.copy(A).add(B).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, _u.copy(B).sub(A).normalize());
}

// ---------------------------------------------------------------- avatar
export class Nisheng {
  /**
   * @param look  appearance from the server ({stage, kiln, cracks, gold, seed})
   * @param opts  { ghost, castShadow }
   */
  constructor(look, { ghost = false, castShadow = false } = {}) {
    const G = geometry(), S = shared();
    this.look = look; this.ghost = ghost;
    this.root = new THREE.Group();
    this.model = new THREE.Group(); this.model.scale.setScalar(MODEL_SCALE);
    this.root.add(this.model);
    this.body = new THREE.Group(); this.model.add(this.body);
    this.lowerG = new THREE.Group(); this.body.add(this.lowerG);
    this.upperPivot = new THREE.Group(); this.upperPivot.position.y = WAIST; this.body.add(this.upperPivot);
    this.neck = new THREE.Group(); this.neck.position.y = NECK - WAIST; this.upperPivot.add(this.neck);

    const ghostMat = ghost ? S.ghost : null;
    const mk = (geo, m, parent) => { const mesh = new THREE.Mesh(geo, ghostMat || m); mesh.castShadow = castShadow && !ghost; mesh.receiveShadow = !ghost; parent.add(mesh); return mesh; };
    this.mat = { upper: clayMaterial(look, 'upper', { ghost }), lower: clayMaterial(look, 'lower', { ghost }), part: clayMaterial(look, 'part', { ghost }) };
    this.meshes = {
      lower: mk(G.lowerClay, this.mat.lower, this.lowerG),
      feet: mk(G.feet, this.mat.part, this.lowerG),
      hem: mk(G.hem, S.hem, this.lowerG),
      upper: mk(G.upper, this.mat.upper, this.upperPivot),
      sash: mk(G.sash, S.sash, this.upperPivot),
      brass: mk(G.brass, S.brass, this.upperPivot),
      rim: mk(G.rim, S.rim, this.upperPivot),
      head: mk(G.head, this.mat.part, this.neck),
      eyes: mk(G.eyes, S.eyes, this.neck),
    };
    if (!ghost) this.meshes.stitch = mk(G.stitch, S.stitch, this.lowerG);
    this.lampMat = new THREE.MeshStandardMaterial({ color: '#2a1608', emissive: '#ffb04a', emissiveIntensity: 1.2 });
    if (ghost) { this.lampMat.transparent = true; this.lampMat.opacity = 0.5; }
    this.meshes.lamp = mk(G.lamp, this.lampMat, this.upperPivot);
    this.meshes.lamp.castShadow = false;

    this.arms = [1, -1].map((side) => ({
      side,
      upper: mk(G.upperArm, this.mat.part, this.body),
      fore: mk(G.foreArm, this.mat.part, this.body),
      hand: mk(G.hand, this.mat.part, this.body),
      E: new THREE.Vector3(), W: new THREE.Vector3(),
    }));
    // props held in hand (hidden unless the pose needs them)
    this.props = {
      sticks: mk(G.sticks, S.stick, this.body), tips: mk(G.tips, S.tip, this.body),
      mallet: mk(G.mallet, S.wood, this.body), beads: mk(G.beads, S.beads, this.body),
    };
    for (const p of Object.values(this.props)) p.visible = false;

    this.state = { action: 'idle', t: Math.random() * 10, walk: 0, bend: 0, nod: 0, drop: 0, squash: 1, lampBoost: 0, sitT: 0, look: 0 };
    this.cur = { ...POSES.idle };
    this.handBlend = new Map();
    this.prevHands = null;
    this.lookAt = null; // world position to glance at (回礼 / 烟)
  }

  setLook(look) {
    this.look = look;
    if (this.ghost) return;
    this.mat = { upper: clayMaterial(look, 'upper'), lower: clayMaterial(look, 'lower'), part: clayMaterial(look, 'part') };
    this.meshes.upper.material = this.mat.upper; this.meshes.lower.material = this.mat.lower;
    for (const k of ['feet', 'head']) this.meshes[k].material = this.mat.part;
    for (const a of this.arms) a.upper.material = a.fore.material = a.hand.material = this.mat.part;
  }

  setAction(a) {
    if (!POSES[a]) a = 'idle';
    if (a === this.state.action) return;
    if (a === 'sit') this.state.sitT = 0;
    this.state.action = a;
  }

  /** dt seconds, moving: 0..1 walking intensity */
  update(dt, moving = 0) {
    const st = this.state;
    st.t += dt;
    st.walk += (moving - st.walk) * Math.min(1, dt * 8);
    const action = st.walk > 0.3 && !['sit', 'muyu'].includes(st.action) ? 'walk' : st.action;
    const target = POSES[action] || POSES.idle;
    // 陶是重的：下去快、起来慢约 30%
    const goingDown = target.bend > this.cur.bend || target.drop > this.cur.drop;
    const k = Math.min(1, dt * (goingDown ? 3.2 : 2.4));
    for (const key of ['bend', 'nod', 'drop', 'squash']) this.cur[key] += (target[key] - this.cur[key]) * k;
    if (st.action === 'sit') st.sitT += dt;

    // breathing: 12 → 6 per minute while seated
    const bpm = st.action === 'sit' ? Math.max(6, 12 - st.sitT / 20) : 12;
    const breath = Math.sin(st.t * (bpm / 60) * Math.PI * 2);
    const bob = st.walk * Math.abs(Math.sin(st.t * 5.2)) * 0.035;

    this.body.position.y = -this.cur.drop + bob;
    this.lowerG.scale.y = this.cur.squash;
    this.upperPivot.position.y = WAIST * this.cur.squash;
    this.upperPivot.rotation.x = this.cur.bend;
    this.upperPivot.scale.setScalar(1 + breath * 0.012);
    this.body.rotation.z = st.walk * Math.sin(st.t * 5.2) * 0.045;
    this.neck.rotation.x = this.cur.nod + (action === 'idle' ? Math.sin(st.t * 0.31) * 0.03 : 0);
    this.neck.rotation.y = action === 'idle' ? Math.sin(st.t * 0.17) * 0.12 : 0;
    this.meshes.feet.visible = this.cur.drop < 0.15;
    this.meshes.feet.position.z = st.walk * Math.sin(st.t * 5.2) * 0.06;

    // 心灯：吸气时微亮；静坐越久越亮
    const sitGlow = st.action === 'sit' ? Math.min(1.6, st.sitT / 120) : 0;
    st.lampBoost = Math.max(0, st.lampBoost - dt * 1.5);
    this.lampMat.emissiveIntensity = 1.0 + breath * 0.18 + sitGlow + st.lampBoost;

    // arms by IK
    this.upperPivot.updateMatrix();
    const upperM = this.upperPivot.matrix;
    const hk = target.hands;
    for (const arm of this.arms) {
      const s = arm.side;
      const ht = handTargets(hk, s, st.t, action === 'walk' ? st.walk : 1);
      const Sh = new THREE.Vector3(0.42 * s, 1.92 - WAIST, 0.14).applyMatrix4(upperM);
      let C = ht.c.clone();
      let F = ht.f.clone().normalize(), P = ht.p.clone().normalize();
      if (!ht.model) {
        C.y -= WAIST; C.applyMatrix4(upperM);
        const R = new THREE.Matrix3().setFromMatrix4(upperM);
        F.applyMatrix3(R).normalize(); P.applyMatrix3(R).normalize();
      } else {
        C.y += this.cur.drop; // floor targets are in model space relative to the floor
      }
      // smooth hand travel
      const key = s;
      const prev = this.handBlend.get(key);
      if (prev) { prev.c.lerp(C, Math.min(1, dt * 7)); prev.f.lerp(F, Math.min(1, dt * 7)).normalize(); prev.p.lerp(P, Math.min(1, dt * 7)).normalize(); }
      const hb = prev || { c: C.clone(), f: F.clone(), p: P.clone() };
      this.handBlend.set(key, hb);
      const wrist = hb.c.clone().addScaledVector(hb.f, -0.1);
      const pole = Sh.clone().add(new THREE.Vector3(0.7 * s, -0.5, -0.35));
      solveIK(Sh, wrist, pole, arm);
      placeSegment(arm.upper, Sh, arm.E);
      placeSegment(arm.fore, arm.E, arm.W);
      // hand frame: y = finger direction, z = palm normal
      const y = hb.f.clone(); const z = hb.p.clone().addScaledVector(y, -hb.p.dot(y)).normalize(); const x = new THREE.Vector3().crossVectors(y, z);
      arm.hand.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      arm.hand.position.copy(arm.W);
    }
    // props
    const L = this.arms[0], R = this.arms[1];
    const both = L.hand.position.clone().add(R.hand.position).multiplyScalar(0.5);
    const showSticks = action === 'incense';
    this.props.sticks.visible = this.props.tips.visible = showSticks;
    if (showSticks) {
      for (const p of [this.props.sticks, this.props.tips]) { p.position.copy(both).add(new THREE.Vector3(0, 0.02, 0.03)); p.quaternion.copy(L.hand.quaternion); }
    }
    this.props.mallet.visible = action === 'muyu';
    if (action === 'muyu') { this.props.mallet.position.copy(R.hand.position); this.props.mallet.quaternion.copy(R.hand.quaternion); this.props.mallet.rotateX(Math.PI / 2.2); }
    this.props.beads.visible = action === 'bead';
    if (action === 'bead') this.props.beads.position.copy(L.hand.position).add(new THREE.Vector3(-0.05, 0.03, 0.02));
  }

  /** brief lamp flash on key frames (合掌碰合、点灯…) */
  pulse(amount = 1) { this.state.lampBoost = Math.max(this.state.lampBoost, amount); }

  dispose() { this.root.removeFromParent(); this.lampMat.dispose(); }
}

export const POSE_NAMES = Object.keys(POSES);
