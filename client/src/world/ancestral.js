// 祖先堂（設計文檔 2.3、3.2 中式祭祖）：一間安靜的家堂。神龕三層放靈位，供桌上的花、果、燭、香、茶
// 跟著今天家人獻過的供品出現；儀式模式有火盆，紙一張張放進去，捲曲、燃盡、紙灰上飄（11.x 煙與火）。
// 跟禪房一樣是獨立的 THREE.Scene，不連大殿房間——家堂只有家人。
import * as THREE from 'three';
import { woodPlanks, lacquer, couplet, altarCloth, softDot } from './textures.js';
import { Smoke } from './fx.js';
import { tex, rng, plaster, lathe } from './chamber.js';
import { Nisheng } from '../avatar/nisheng.js';

const W = 6, D = 5.4, H = 3.5;
const TABLE = { y: 0.92, z: -1.5, w: 2.0, d: 0.6 };
const TIERS = [ // top (elders) → bottom
  { y: 1.58, z: -2.31 },
  { y: 1.30, z: -2.13 },
  { y: 1.02, z: -1.95 },
];
const PER_TIER = 8, PITCH = 0.25;
const BASIN = new THREE.Vector3(0.05, 0, -0.45);
const KAI = '"BiauKai","DFKai-SB","Kaiti TC","STKaiti","KaiTi","Noto Serif TC","Songti TC",serif';
const CN_DIGIT = '〇一二三四五六七八九';
const cnYear = (y) => String(y).split('').map((d) => CN_DIGIT[+d]).join('');

/** 靈位 face: lacquer, gold border, relation · name 之位 · years. */
function tabletFace({ name, relation, born, died }) {
  return tex(128, 384, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, '#24130c'); grd.addColorStop(0.5, '#3a1d12'); grd.addColorStop(1, '#24130c');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c9a24a'; g.lineWidth = 4; g.strokeRect(7, 7, w - 14, h - 14);
    g.lineWidth = 1.5; g.strokeRect(13, 13, w - 26, h - 26);
    g.fillStyle = '#e6c879'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const col = (text, x, top, bottom, max) => {
      const chars = [...text];
      if (!chars.length) return;
      const size = Math.min(max, (bottom - top) / chars.length);
      g.font = `600 ${size}px ${KAI}`;
      const start = (top + bottom) / 2 - ((chars.length - 1) * size) / 2;
      chars.forEach((c, i) => g.fillText(c, x, start + i * size));
    };
    const full = [...name, '之', '位'].join('');
    col(full, w / 2, 40, h - 40, 46);
    if (relation) col(relation, w - 24, 46, 46 + Math.min(150, [...relation].length * 20), 18);
    const by = born ? cnYear(born.slice(0, 4)) : '';
    const years = by ? `${by}︱${cnYear(died.date.slice(0, 4))}` : cnYear(died.date.slice(0, 4));
    col(years, 24, h - 46 - [...years].length * 15, h - 46, 15);
  });
}

function plaque(text) {
  return tex(512, 128, (g, w, h) => {
    g.fillStyle = '#2a140c'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c9a24a'; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#e6c879'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 76px ${KAI}`;
    const chars = [...text];
    chars.forEach((c, i) => g.fillText(c, w / 2 + (i - (chars.length - 1) / 2) * 100, h / 2 + 4));
  });
}

/** 銀紙: coarse bamboo paper with a silver-foil square. 元寶 / 蓮花 get their own shapes. */
function silverPaper() {
  return tex(128, 128, (g, w, h) => {
    g.fillStyle = '#c9b48a'; g.fillRect(0, 0, w, h);
    const R = rng(4);
    for (let i = 0; i < 400; i++) { g.fillStyle = R() < 0.5 ? 'rgba(90,70,40,0.12)' : 'rgba(255,240,210,0.12)'; g.fillRect(R() * w, R() * h, 1 + R() * 3, 1); }
    const s = g.createLinearGradient(34, 34, 94, 94); s.addColorStop(0, '#e9ecef'); s.addColorStop(0.5, '#a9b0b6'); s.addColorStop(1, '#d8dde1');
    g.fillStyle = s; g.fillRect(36, 36, 56, 56);
  });
}
function goldPaper() {
  return tex(64, 64, (g, w, h) => {
    const s = g.createLinearGradient(0, 0, w, h); s.addColorStop(0, '#f2d27a'); s.addColorStop(0.5, '#c9962e'); s.addColorStop(1, '#f0cf78');
    g.fillStyle = s; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(120,70,10,0.35)'; for (let x = 0; x < w; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 6, h); g.stroke(); }
  });
}

/**
 * Burn dissolve on a standard material: noise + distance from one corner eats the paper,
 * a glowing rim runs ahead of the char.
 */
function burnable(mat, size) {
  const u = { uBurn: { value: 0 }, uSize: { value: size } };
  mat.userData.burn = u.uBurn;
  mat.customProgramCacheKey = () => 'burnable';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vBP; uniform float uBurn; uniform float uSize;
      float bh(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      float bn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(bh(i), bh(i+vec3(1,0,0)), f.x), mix(bh(i+vec3(0,1,0)), bh(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(bh(i+vec3(0,0,1)), bh(i+vec3(1,0,1)), f.x), mix(bh(i+vec3(0,1,1)), bh(i+vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
      { vec3 q = vBP / uSize;
        float field = length(q.xz + vec2(0.5)) * 0.62 + bn(q * 5.0) * 0.28 + bn(q * 13.0) * 0.1;
        float d = field - (uBurn * 1.3 - 0.12);
        if (d < 0.0) discard;
        gl_FragColor.rgb = mix(vec3(0.04, 0.03, 0.02), gl_FragColor.rgb, smoothstep(0.015, 0.12, d));
        gl_FragColor.rgb += vec3(1.0, 0.42, 0.08) * (1.0 - smoothstep(0.0, 0.03, d)) * 2.2 * step(0.001, uBurn); }`);
  };
  return mat;
}

/** Short-lived points: embers (additive, quick) and ash flakes (slow, swaying up). */
class Motes {
  constructor(scene, { max, color, size, additive, life, rise, sway }) {
    Object.assign(this, { max, life, rise, sway });
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(1); this.seed = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('age', new THREE.BufferAttribute(this.age, 1));
    g.setAttribute('seed', new THREE.BufferAttribute(this.seed, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { map: { value: softDot('#ffffff') }, size: { value: size }, color: { value: new THREE.Color(color) }, px: { value: 600 } },
      vertexShader: `attribute float age; attribute float seed; varying float vA; varying float vS; uniform float size; uniform float px;
        void main(){ vA = age; vS = seed; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (0.6 + seed * 0.8) * (1.0 - age * 0.4) * px / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 color; varying float vA; varying float vS;
        void main(){ if (vA >= 1.0) discard; vec4 c = texture2D(map, gl_PointCoord);
          float a = c.a * smoothstep(0.0, 0.06, vA) * (1.0 - vA);
          gl_FragColor = vec4(color * (0.8 + vS * 0.4), a); }`,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false;
    scene.add(this.points);
    this.cursor = 0;
  }
  spawn(p, spread = 0.08) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    this.pos.set([p.x + (Math.random() - 0.5) * spread, p.y, p.z + (Math.random() - 0.5) * spread], i * 3);
    this.vel.set([(Math.random() - 0.5) * 0.2, this.rise * (0.6 + Math.random() * 0.8), (Math.random() - 0.5) * 0.2], i * 3);
    this.age[i] = 0; this.seed[i] = Math.random();
  }
  update(dt, t) {
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= 1) continue;
      this.age[i] = Math.min(1, this.age[i] + dt / (this.life * (0.7 + this.seed[i] * 0.6)));
      const s = this.seed[i] * 40;
      this.pos[i * 3] += (this.vel[i * 3] + Math.sin(t * 2.3 + s) * this.sway) * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += (this.vel[i * 3 + 2] + Math.cos(t * 1.9 + s) * this.sway) * dt;
      this.vel[i * 3 + 1] *= 1 - dt * 0.25;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.age.needsUpdate = true;
  }
}

function flameTexture() {
  return tex(64, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h * 0.72, 2, w / 2, h * 0.62, h * 0.5);
    r.addColorStop(0, 'rgba(255,245,200,1)'); r.addColorStop(0.25, 'rgba(255,190,80,0.9)');
    r.addColorStop(0.6, 'rgba(230,90,20,0.45)'); r.addColorStop(1, 'rgba(120,20,0,0)');
    g.fillStyle = r;
    g.beginPath(); g.moveTo(w / 2, 0);
    g.bezierCurveTo(w * 0.95, h * 0.45, w, h * 0.95, w / 2, h);
    g.bezierCurveTo(0, h * 0.95, w * 0.05, h * 0.45, w / 2, 0); g.fill();
  });
}

/**
 * @param opts.look  the visitor's 泥生 look
 * @param opts.mode  'ritual' | 'cultural' (cultural: no censer, no tea, no fire basin)
 */
export function buildAncestral({ look, mode, quality }) {
  const ritual = mode === 'ritual';
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#120d0a');
  scene.fog = new THREE.Fog('#120d0a', 6, 12);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 40);

  // ---- room ----
  const floorTex = woodPlanks({ base: '#4a3222' }); floorTex.repeat.set(3, 3);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.75 }));
  floor.rotation.x = -Math.PI / 2; floor.position.z = -D / 2 + 1.6; floor.receiveShadow = true; scene.add(floor);
  const wallTex = plaster(); wallTex.repeat.set(2, 1);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, color: '#8a7a64', roughness: 0.95 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat); back.position.set(0, H / 2, -2.5); back.receiveShadow = true; scene.add(back);
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(D, H), wallMat);
    side.position.set(s * W / 2, H / 2, -D / 2 + 1.6); side.rotation.y = -s * Math.PI / 2; scene.add(side);
  }
  const darkWood = new THREE.MeshStandardMaterial({ color: '#2b1a10', roughness: 0.6 });
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), darkWood); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, H, -D / 2 + 1.6); scene.add(ceil);
  for (let i = -2; i <= 2; i++) { // beams
    const b = new THREE.Mesh(new THREE.BoxGeometry(W, 0.14, 0.16), darkWood); b.position.set(0, H - 0.07, -2.3 + i * 0.95 + 1.6); scene.add(b);
  }

  // ---- 神龕: base cabinet, three tiers, posts, back panel, plaque ----
  const red = new THREE.MeshStandardMaterial({ map: lacquer({ base: '#5e2118' }), roughness: 0.45 });
  const gold = new THREE.MeshStandardMaterial({ color: '#b8923e', metalness: 0.7, roughness: 0.35 });
  const shrine = new THREE.Group(); scene.add(shrine);
  const box = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; shrine.add(o); return o; };
  box(2.4, 0.98, 0.62, red, 0, 0.49, -2.17);
  box(2.44, 0.04, 0.66, gold, 0, 0.98, -2.17);
  TIERS.forEach((tr, i) => box(2.2, tr.y - 0.98, 0.2, red, 0, (tr.y + 0.98) / 2, tr.z - 0.0).position.z = tr.z - (i === 0 ? 0.02 : 0));
  box(2.4, 1.4, 0.04, new THREE.MeshStandardMaterial({ color: '#3a1610', roughness: 0.6 }), 0, 1.68, -2.46);
  for (const s of [-1, 1]) {
    box(0.1, 1.42, 0.1, red, s * 1.17, 1.69, -1.92);
    const cp = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.95), new THREE.MeshStandardMaterial({ map: couplet(s < 0 ? '春露秋霜' : '木本水源'), roughness: 0.6 }));
    cp.position.set(s * 1.17, 1.66, -1.865); shrine.add(cp);
  }
  box(2.56, 0.3, 0.7, red, 0, 2.5, -2.15);
  box(2.62, 0.05, 0.74, gold, 0, 2.35, -2.15);
  const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.25), new THREE.MeshStandardMaterial({ map: plaque('慎終追遠'), roughness: 0.5 }));
  pl.position.set(0, 2.5, -1.795); shrine.add(pl);
  for (const s of [-1, 1]) { // 垂簾 tassels
    const tassel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, 0.34, 6), new THREE.MeshStandardMaterial({ color: '#a8241a', roughness: 0.8 }));
    tassel.position.set(s * 1.05, 2.13, -1.86); shrine.add(tassel);
  }

  // ---- 供桌 ----
  const table = new THREE.Group(); table.position.set(0, 0, TABLE.z); scene.add(table);
  const top = new THREE.Mesh(new THREE.BoxGeometry(TABLE.w, 0.06, TABLE.d), red); top.position.y = TABLE.y - 0.03; top.castShadow = top.receiveShadow = true; table.add(top);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(TABLE.w - 0.1, TABLE.y - 0.08), new THREE.MeshStandardMaterial({ map: altarCloth(), roughness: 0.85 }));
  cloth.position.set(0, (TABLE.y - 0.08) / 2 + 0.02, TABLE.d / 2 + 0.002); table.add(cloth);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, TABLE.y - 0.06, 0.07), red); leg.position.set(sx * (TABLE.w / 2 - 0.06), (TABLE.y - 0.06) / 2, sz * (TABLE.d / 2 - 0.06)); table.add(leg);
  }
  const onTable = (o, x, z = 0) => { o.position.set(x, TABLE.y, z); table.add(o); return o; };

  // Each offering kind: a group that grows in when someone in the family offered it today.
  const items = {};
  const grow = (kind, group) => { group.userData.k = 0; group.scale.setScalar(0.001); group.visible = false; items[kind] = group; return group; };
  const bronze = new THREE.MeshStandardMaterial({ color: '#6b5532', metalness: 0.65, roughness: 0.4 });
  const porcelain = new THREE.MeshStandardMaterial({ color: '#eae6dc', roughness: 0.3 });

  // candlesticks (always there) + candles (offered)
  const candles = new THREE.Group(); grow('candle', candles); table.add(candles);
  const candleLights = [];
  const flameTex = flameTexture();
  for (const s of [-1, 1]) {
    const stick = onTable(new THREE.Mesh(lathe([[0, 0], [0.07, 0], [0.07, 0.015], [0.02, 0.03], [0.018, 0.24], [0.06, 0.25], [0.055, 0.27]]), bronze), s * 0.82);
    stick.castShadow = true;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.2, 12), new THREE.MeshStandardMaterial({ color: '#b3261c', roughness: 0.5 }));
    c.position.set(s * 0.82, TABLE.y + 0.37, 0); candles.add(c);
    const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    f.scale.set(0.045, 0.09, 1); f.position.set(s * 0.82, TABLE.y + 0.505, 0); candles.add(f);
    const L = new THREE.PointLight('#ffb060', 0, 5, 1.6); L.position.set(s * 0.82, TABLE.y + 0.55, 0.05);
    L.castShadow = quality === 'high' && s < 0; L.shadow.mapSize.set(512, 512); L.shadow.bias = -0.003;
    table.add(L); candleLights.push({ L, f });
  }
  // vases + chrysanthemums
  const flowers = new THREE.Group(); grow('flower', flowers); table.add(flowers);
  const R = rng(17);
  for (const s of [-1, 1]) {
    onTable(new THREE.Mesh(lathe([[0, 0], [0.045, 0], [0.07, 0.08], [0.06, 0.16], [0.03, 0.22], [0.04, 0.26]]), porcelain), s * 0.6, -0.12).castShadow = true;
    for (let i = 0; i < 7; i++) {
      const a = R() * Math.PI * 2, rr = R() * 0.07;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.3, 4), new THREE.MeshStandardMaterial({ color: '#4a6a32' }));
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 6), new THREE.MeshStandardMaterial({ color: i % 3 ? '#f1ead2' : '#e7c24a', roughness: 0.9 }));
      head.scale.y = 0.55;
      const x = s * 0.6 + Math.cos(a) * rr, z = -0.12 + Math.sin(a) * rr, y = TABLE.y + 0.38 + R() * 0.08;
      stem.position.set((x + s * 0.6) / 2, (y + TABLE.y + 0.24) / 2, (z - 0.12) / 2); stem.lookAt(x, y, z); stem.rotateX(Math.PI / 2);
      head.position.set(x, y, z);
      flowers.add(stem, head);
    }
  }
  // fruit plate
  onTable(new THREE.Mesh(lathe([[0, 0], [0.05, 0], [0.05, 0.02], [0.13, 0.04], [0.14, 0.05]], 24), porcelain), ritual ? -0.3 : 0.3, 0.05);
  const fruit = new THREE.Group(); grow('fruit', fruit); table.add(fruit);
  const orange = new THREE.MeshStandardMaterial({ color: '#e08a2a', roughness: 0.6 });
  [[0, 0.075, 0], [0.065, 0.07, 0.03], [-0.06, 0.07, 0.035], [0.01, 0.07, -0.06], [0.0, 0.13, 0.0]].forEach(([x, y, z]) => {
    const o = new THREE.Mesh(new THREE.SphereGeometry(0.042, 14, 10), orange); o.position.set((ritual ? -0.3 : 0.3) + x, TABLE.y + y, 0.05 + z); o.castShadow = true; fruit.add(o);
  });

  let smoke = null, incenseTip = null;
  if (ritual) {
    // 香爐 + sticks
    onTable(new THREE.Mesh(lathe([[0, 0], [0.08, 0], [0.11, 0.04], [0.11, 0.1], [0.095, 0.13], [0.105, 0.14]], 24), bronze), 0, 0.02).castShadow = true;
    for (const s of [-1, 1]) { const ear = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.007, 6, 12), bronze); ear.position.set(s * 0.115, TABLE.y + 0.12, 0.02); ear.rotation.y = Math.PI / 2; table.add(ear); }
    const incense = new THREE.Group(); grow('incense', incense); table.add(incense);
    const stickMat = new THREE.MeshStandardMaterial({ color: '#7a3b22' });
    for (const dx of [-0.025, 0, 0.025]) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.26, 4), stickMat);
      st.position.set(dx, TABLE.y + 0.25, 0.02); st.rotation.z = dx * 3; incense.add(st);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.004, 6, 4), new THREE.MeshBasicMaterial({ color: '#ff6a2a' }));
      tip.position.set(dx - Math.sin(dx * 3) * 0.13, TABLE.y + 0.38, 0.02); incense.add(tip);
    }
    smoke = new Smoke(scene, { max: 220 }); smoke.mat.uniforms.scale.value = 140;
    incenseTip = new THREE.Vector3(0, TABLE.y + 0.38, TABLE.z + 0.02);
    // 奉茶: three cups
    const tea = new THREE.Group(); grow('tea', tea); table.add(tea);
    [-0.07, 0, 0.07].forEach((dx) => {
      onTable(new THREE.Mesh(lathe([[0, 0], [0.018, 0], [0.026, 0.035]], 16), porcelain), 0.3 + dx, 0.06);
      const liquid = new THREE.Mesh(new THREE.CircleGeometry(0.023, 16), new THREE.MeshStandardMaterial({ color: '#8a6a2a', roughness: 0.15 }));
      liquid.rotation.x = -Math.PI / 2; liquid.position.set(0.3 + dx, TABLE.y + 0.03, 0.06); tea.add(liquid);
    });
  }

  // ---- tablets ----
  const tabletG = new THREE.Group(); scene.add(tabletG);
  const tabletMeshes = new Map(); // id → { group, slab, lamp, pos }
  const baseMat = new THREE.MeshStandardMaterial({ color: '#2a140c', roughness: 0.4 });
  const sideMat = new THREE.MeshStandardMaterial({ color: '#2f1810', roughness: 0.45 });
  const lampTex = softDot('#ffc477');
  // 牌位 crown: a low arch over the slab
  const capShape = new THREE.Shape(); capShape.absarc(0, 0, 0.1, 0, Math.PI, false); capShape.lineTo(0.1, 0);
  const capGeo = new THREE.ExtrudeGeometry(capShape, { depth: 0.036, bevelEnabled: false, curveSegments: 16 });
  capGeo.translate(0, 0, -0.018); capGeo.scale(1, 0.42, 1);
  let picks = [];

  function tabletPos(i, n) {
    const tier = Math.min(TIERS.length - 1, Math.floor(i / PER_TIER));
    const inTier = Math.min(PER_TIER, n - tier * PER_TIER);
    const k = i - tier * PER_TIER;
    return new THREE.Vector3((k - (inTier - 1) / 2) * PITCH, TIERS[tier].y, TIERS[tier].z);
  }

  function setTablets(list) {
    for (const t of tabletMeshes.values()) { t.group.removeFromParent(); t.faceMat.map.dispose(); t.faceMat.dispose(); }
    tabletMeshes.clear(); picks = [];
    list.forEach((tb, i) => {
      const g = new THREE.Group();
      const pos = tabletPos(i, list.length);
      g.position.copy(pos);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.09), baseMat); base.position.y = 0.025;
      const faceMat = new THREE.MeshStandardMaterial({ map: tabletFace(tb), roughness: 0.35 });
      const slab = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.39, 0.026), [sideMat, sideMat, sideMat, sideMat, faceMat, sideMat]);
      slab.position.y = 0.05 + 0.195;
      const cap = new THREE.Mesh(capGeo, baseMat);
      cap.position.y = 0.44;
      for (const m of [base, slab, cap]) { m.castShadow = true; m.userData.tabletId = tb.id; g.add(m); }
      // a little oil lamp in front, lit when the family offered anything to this person today
      const lamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: lampTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      lamp.scale.setScalar(0.08); lamp.position.set(0, 0.035, 0.085); g.add(lamp);
      tabletG.add(g);
      tabletMeshes.set(tb.id, { group: g, slab, lamp, faceMat, pos: pos.clone().add(new THREE.Vector3(0, 0.25, 0)), lit: tb.today?.offers?.length > 0 });
      picks.push(base, slab, cap);
    });
    refreshOffers(list);
  }

  function refreshOffers(list) {
    const kinds = new Set();
    for (const tb of list) {
      for (const o of tb.today?.offers || []) kinds.add(o.kind);
      const t = tabletMeshes.get(tb.id);
      if (t) t.lit = (tb.today?.offers?.length || 0) > 0;
    }
    for (const [k, g] of Object.entries(items)) g.userData.on = kinds.has(k);
  }

  // ---- 火盆 (ritual only) ----
  let basin = null, fire = 0, fireLight = null;
  const flames = [];
  const embers = ritual ? new Motes(scene, { max: 260, color: '#ff8a2a', size: 0.022, additive: true, life: 1.4, rise: 0.9, sway: 0.25 }) : null;
  const ash = ritual ? new Motes(scene, { max: 200, color: '#3a3532', size: 0.03, additive: false, life: 4.5, rise: 0.38, sway: 0.18 }) : null;
  const sheets = [];
  if (ritual) {
    basin = new THREE.Group(); basin.position.copy(BASIN); scene.add(basin);
    const iron = new THREE.MeshStandardMaterial({ color: '#3b2f26', metalness: 0.55, roughness: 0.55, side: THREE.DoubleSide });
    const bowl = new THREE.Mesh(lathe([[0, 0.16], [0.18, 0.17], [0.26, 0.26], [0.3, 0.4], [0.33, 0.42], [0.31, 0.42], [0.28, 0.4], [0.24, 0.28], [0.16, 0.2], [0, 0.19]], 28), iron);
    bowl.castShadow = bowl.receiveShadow = true; basin.add(bowl);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.3;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.025, 0.2, 6), iron); leg.position.set(Math.cos(a) * 0.17, 0.1, Math.sin(a) * 0.17); basin.add(leg);
    }
    for (const s of [-1, 1]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.008, 6, 14), iron); ring.position.set(s * 0.33, 0.36, 0); ring.rotation.y = Math.PI / 2; basin.add(ring); }
    const bed = new THREE.Mesh(new THREE.CircleGeometry(0.25, 24), new THREE.MeshStandardMaterial({ color: '#1a1614', roughness: 1, emissive: '#ff5a1a', emissiveIntensity: 0 }));
    bed.rotation.x = -Math.PI / 2; bed.position.y = 0.3; basin.add(bed); basin.userData.bed = bed;
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      f.position.set((i - 1.5) * 0.06, 0.42, (i % 2 ? 0.03 : -0.03)); basin.add(f); flames.push(f);
    }
    fireLight = new THREE.PointLight('#ff8a3a', 0, 4, 1.8); fireLight.position.set(0, 0.6, 0); basin.add(fireLight);
  }
  const silverTex = ritual ? silverPaper() : null, goldTex = ritual ? goldPaper() : null;

  function makeSheet(kind) {
    let geo, size;
    if (kind === 'silver') { geo = new THREE.PlaneGeometry(0.15, 0.15, 6, 6); geo.rotateX(-Math.PI / 2); size = 0.15; }
    else if (kind === 'ingot') {
      geo = new THREE.SphereGeometry(0.06, 16, 10); geo.scale(1.3, 0.55, 0.7);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); if (y > 0) p.setY(i, y * (0.4 + Math.abs(x) * 9)); } // raised ends, dipped middle
      geo.computeVertexNormals(); size = 0.16;
    } else {
      geo = new THREE.LatheGeometry([[0, 0], [0.04, 0.005], [0.07, 0.04], [0.075, 0.07]].map(([r, y]) => new THREE.Vector2(r, y)), 24, 0, Math.PI * 2);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)); const k = 0.75 + 0.25 * Math.abs(Math.cos(a * 4)); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); p.setY(i, p.getY(i) * (0.6 + 0.6 * Math.abs(Math.cos(a * 4)))); }
      geo.computeVertexNormals(); size = 0.15;
    }
    const mat = burnable(new THREE.MeshStandardMaterial({
      map: kind === 'silver' ? silverTex : goldTex, color: kind === 'lotus' ? '#f6b8a8' : '#ffffff',
      metalness: kind === 'silver' ? 0.1 : 0.35, roughness: 0.6, side: THREE.DoubleSide,
    }), size);
    const m = new THREE.Mesh(geo, mat); m.castShadow = true;
    return m;
  }

  /** One sheet into the fire, dropped from screen point (x, y) if given. */
  function burn(kind, from) {
    if (!basin) return;
    const m = makeSheet(kind);
    const target = BASIN.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.12, 0.33, (Math.random() - 0.5) * 0.1));
    let start = target.clone().add(new THREE.Vector3(0, 0.45, 0.25));
    if (from) {
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(from.x, from.y), camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(BASIN.z + 0.25));
      const hit = new THREE.Vector3();
      if (ray.ray.intersectPlane(plane, hit)) start = hit.clamp(new THREE.Vector3(-1.2, 0.5, -2), new THREE.Vector3(1.2, 1.6, 2));
    }
    m.position.copy(start);
    m.rotation.set(Math.random() * 0.6 - 0.3, Math.random() * Math.PI, Math.random() * 0.6 - 0.3);
    scene.add(m);
    sheets.push({ m, start, target, t: 0, spin: (Math.random() - 0.5) * 2 });
    me.lookAt = target.clone().add(new THREE.Vector3(0, 0.6, 0));
    gazeUntil = clock + 4;
  }

  // ---- lights ----
  const hemi = new THREE.HemisphereLight('#c9b8a0', '#2a1a10', 0.5); scene.add(hemi);
  const key = new THREE.SpotLight('#ffd9a8', 13, 8, 0.6, 0.7, 1.4);
  key.position.set(0.3, 3.3, 0.4); key.target.position.set(0, 1.2, -2.1);
  key.castShadow = quality !== 'low'; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.002;
  scene.add(key, key.target);
  const fill = new THREE.PointLight('#ffd2a0', 1.1, 7, 1.5); fill.position.set(-0.6, 1.9, 1.8); scene.add(fill);
  // a pair of red lanterns
  for (const s of [-1, 1]) {
    const lan = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), new THREE.MeshStandardMaterial({ color: '#b3261c', emissive: '#c23a1c', emissiveIntensity: 0.9, roughness: 0.7 }));
    lan.scale.y = 1.15; lan.position.set(s * 1.75, 2.75, -1.6); scene.add(lan);
    for (const dy of [-0.2, 0.2]) { const capL = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 12), gold); capL.position.set(s * 1.75, 2.75 + dy, -1.6); scene.add(capL); }
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.55, 4), darkWood); cord.position.set(s * 1.75, 3.2, -1.6); scene.add(cord);
    const L = new THREE.PointLight('#ff7a4a', 0.5, 3, 2); L.position.set(s * 1.75, 2.6, -1.4); scene.add(L);
  }

  // ---- 泥生, standing before the altar ----
  const me = new Nisheng(look, { castShadow: true });
  const SPOT = { altar: new THREE.Vector3(-1.3, 0, -0.9), burn: new THREE.Vector3(-0.52, 0, -0.32) };
  me.root.position.copy(SPOT.altar);
  scene.add(me.root);
  const faceTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
  me.root.rotation.y = faceTo(SPOT.altar, new THREE.Vector3(0, 0, TABLE.z));
  let walkTo = null, gazeUntil = 0, clock = 0;
  const acts = []; // queued [action, seconds]
  function act(seq) { acts.length = 0; acts.push(...seq.map(([a, s]) => ({ a, s }))); }

  /** 泥生 offers: incense is held up and bowed with; the rest is a 合掌 and a bow. */
  function offer(kind) {
    act(kind === 'incense' ? [['incense', 2.6], ['bow', 1.6], ['idle', 0]] : [['pray', 1.4], ['bow', 1.4], ['idle', 0]]);
  }

  // ---- camera ----
  const views = {
    altar: { pos: new THREE.Vector3(0, 1.75, 2.75), at: new THREE.Vector3(0, 1.2, -1.8) },
  };
  let view = 'altar', focusId = null;
  const camPos = views.altar.pos.clone(), camAt = views.altar.at.clone();
  let portrait = false;

  function setView(v) {
    view = v; focusId = null;
    walkTo = v === 'burn' ? SPOT.burn : SPOT.altar;
  }
  function focus(id) {
    focusId = id && tabletMeshes.has(id) ? id : null;
    view = focusId ? 'tablet' : 'altar';
    walkTo = SPOT.altar;
  }

  function target() {
    if (view === 'tablet') {
      const p = tabletMeshes.get(focusId)?.pos;
      if (p) {
        // the tablet sits in the upper part of the screen; the detail panel takes the lower half on phones
        // put the tablet halfway up the top half of the screen (NDC y ≈ 0.5), clear of the sheet
        // portrait: the sheet is below, so the tablet sits in the upper half;
        // landscape: the sheet is on the right, so the tablet sits left of centre
        const d = portrait ? 1.55 : 1.15;
        const half = d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        if (portrait) return { pos: new THREE.Vector3(p.x * 0.85, p.y + 0.1, p.z + d), at: new THREE.Vector3(p.x * 0.95, p.y + 0.1 - half * 0.5, p.z) };
        const halfW = half * camera.aspect;
        return { pos: new THREE.Vector3(p.x + 0.15, p.y + 0.12, p.z + d), at: new THREE.Vector3(p.x + halfW * 0.42, p.y + 0.02, p.z) };
      }
    }
    const v = views[view] || views.altar;
    if (portrait && view === 'altar') return { pos: v.pos.clone().add(new THREE.Vector3(0, 0.1, 1.2)), at: v.at.clone().add(new THREE.Vector3(0, -0.2, 0)) };
    if (view === 'burn') {
      // the basin mouth sits above the paper tray: aim below it so it lands at NDC y ≈ +0.3
      const mouth = BASIN.clone().add(new THREE.Vector3(0, 0.42, 0));
      const pos = portrait ? new THREE.Vector3(0.3, 1.95, 1.85) : new THREE.Vector3(0.75, 1.55, 1.45);
      const half = pos.distanceTo(mouth) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      return { pos, at: mouth.add(new THREE.Vector3(portrait ? 0 : -0.05, -half * 0.36, 0)) };
    }
    return v;
  }

  function update(dt, t) {
    clock = t;
    // avatar: walk between the altar and the basin, then run any queued gestures
    if (walkTo) {
      const d = walkTo.clone().sub(me.root.position); d.y = 0;
      const dist = d.length();
      if (dist > 0.02) {
        const step = Math.min(dist, dt * 0.9);
        me.root.position.addScaledVector(d.normalize(), step);
        me.root.rotation.y += ((Math.atan2(d.x, d.z) - me.root.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 6);
        me.update(dt, 1);
      } else {
        walkTo = null;
        const face = view === 'burn' ? BASIN : new THREE.Vector3(0, 0, TABLE.z);
        me.root.userData.face = faceTo(me.root.position, face);
      }
    }
    if (!walkTo) {
      const f = me.root.userData.face;
      if (f !== undefined) me.root.rotation.y += ((f - me.root.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 4);
      if (acts.length) {
        const a = acts[0];
        me.setAction(a.a);
        a.s -= dt;
        if (a.s <= 0) acts.shift();
      }
      me.update(dt, 0);
    }
    if (gazeUntil && t > gazeUntil) { me.lookAt = null; gazeUntil = 0; }

    // offerings grow in / out
    for (const g of Object.values(items)) {
      const k = g.userData.k = THREE.MathUtils.clamp(g.userData.k + (g.userData.on ? dt : -dt) * 1.6, 0, 1);
      g.visible = k > 0.001;
      const e = 1 - Math.pow(1 - k, 3);
      g.scale.setScalar(Math.max(0.001, e));
    }
    const candleOn = items.candle.userData.k;
    candleLights.forEach(({ L, f }, i) => {
      const fl = 1 + Math.sin(t * 9 + i * 2) * 0.06 + Math.sin(t * 17.3 + i) * 0.04;
      L.intensity = 1.1 * candleOn * fl;
      f.scale.set(0.045, 0.09 * fl, 1);
    });
    for (const tm of tabletMeshes.values()) {
      const o = tm.lamp.material.opacity;
      tm.lamp.material.opacity = o + ((tm.lit ? 0.85 + Math.sin(t * 6 + tm.pos.x * 9) * 0.1 : 0) - o) * Math.min(1, dt * 2);
    }
    if (smoke) {
      if (items.incense.userData.k > 0.9 && Math.random() < dt * 5) smoke._spawn(incenseTip);
      smoke.update(dt, t, 0.03);
    }

    // paper: fall, flutter, settle, burn
    for (let i = sheets.length - 1; i >= 0; i--) {
      const s = sheets[i];
      s.t += dt;
      const fall = Math.min(1, s.t / 0.7);
      const e = fall * fall;
      s.m.position.lerpVectors(s.start, s.target, e);
      s.m.position.x += Math.sin(s.t * 9) * 0.03 * (1 - fall);
      s.m.rotation.y += s.spin * dt * (1 - fall);
      if (fall >= 1) {
        const b = Math.min(1, (s.t - 0.7) / 1.6);
        s.m.material.userData.burn.value = b;
        s.m.scale.y = 1 - b * 0.5;                    // curls as it goes
        s.m.rotation.x += dt * 0.4 * (1 - b);
        fire = Math.min(1, fire + dt * 1.5);
        if (Math.random() < dt * 40) embers.spawn(s.m.position, 0.1);
        if (Math.random() < dt * 14 * b) ash.spawn(s.m.position.clone().add(new THREE.Vector3(0, 0.05, 0)), 0.1);
        if (b >= 1) { s.m.removeFromParent(); s.m.geometry.dispose(); s.m.material.dispose(); sheets.splice(i, 1); }
      }
    }
    if (basin) {
      fire = Math.max(0, fire - dt * (sheets.length ? 0 : 0.18));
      flames.forEach((f, i) => {
        const fl = 0.75 + 0.25 * Math.sin(t * (11 + i * 2.3) + i) + (Math.random() - 0.5) * 0.15;
        f.material.opacity = fire * 0.9;
        f.scale.set(0.12 * (0.6 + fire * 0.5), 0.26 * fire * fl, 1);
        f.position.y = 0.42 + 0.13 * fire * fl;
      });
      fireLight.intensity = fire * (1.8 + Math.sin(t * 13) * 0.3 + (Math.random() - 0.5) * 0.3);
      basin.userData.bed.material.emissiveIntensity = fire * 0.8 + 0.04;
      if (fire > 0.05 && Math.random() < dt * 14 * fire) embers.spawn(BASIN.clone().add(new THREE.Vector3(0, 0.45, 0)), 0.2);
      embers.update(dt, t); ash.update(dt, t);
    }

    // camera eases toward its target, with a breath-slow drift
    const tg = target();
    const k = Math.min(1, dt * 2.2);
    camPos.lerp(tg.pos, k); camAt.lerp(tg.at, k);
    camera.position.set(camPos.x + Math.sin(t * 0.06) * 0.03, camPos.y + Math.sin(t * 0.08) * 0.015, camPos.z);
    camera.lookAt(camAt);
  }

  const ray = new THREE.Raycaster();
  return {
    scene, camera, avatar: me, update, setTablets, refreshOffers, focus, setView, offer, burn,
    get view() { return view; },
    /** tablet id under a screen point (NDC), or null */
    pick(x, y, w = 1, h = 1) {
      ray.setFromCamera(new THREE.Vector2(x, y), camera);
      const hit = ray.intersectObjects(picks, false)[0];
      if (hit) return hit.object.userData.tabletId;
      // tablets are small on a phone: accept a tap within a fingertip (~36 px) of one
      let best = null, bestD = 36;
      for (const [id, t] of tabletMeshes) {
        const c = t.pos.clone().project(camera);
        const d = Math.hypot((c.x - x) * w / 2, (c.y - y) * h / 2);
        if (d < bestD) { best = id; bestD = d; }
      }
      return best;
    },
    /** where the basin mouth is on screen (NDC centre + radius), for drag-and-drop */
    basinScreen() {
      if (!basin) return null;
      const c = BASIN.clone().add(new THREE.Vector3(0, 0.42, 0)).project(camera);
      const e = BASIN.clone().add(new THREE.Vector3(0.33, 0.42, 0)).project(camera);
      return { x: c.x, y: c.y, r: Math.abs(e.x - c.x) };
    },
    resize(w, h) {
      portrait = w < h;
      camera.aspect = w / h; camera.fov = portrait ? 64 : 48; camera.updateProjectionMatrix();
      for (const m of [embers, ash]) if (m) m.mat.uniforms.px.value = h;
    },
    dispose() {
      for (const s of sheets) s.m.removeFromParent();
      scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; if (m) for (const x of [].concat(m)) { x.map?.dispose?.(); x.dispose?.(); } });
      me.dispose();
    },
  };
}
