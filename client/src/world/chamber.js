// 禪房（單人，設計文檔 2.3）：離線級安靜，不顯示其他人，用於深度冥想與睡前。
// 一間小小的木構禪房：圓窗望出去是此刻的天色（跟大殿同一條天色曲線），油燈、書案、掛軸、蒲團。
// 獨立的 THREE.Scene，不跟大殿共用燈光；進出禪房只是換一個場景渲染。
import * as THREE from 'three';
import { palette } from './env.js';
import { woodPlanks, cushionWeave } from './textures.js';
import { Smoke } from './fx.js';
import { Nisheng } from '../avatar/nisheng.js';

const W = 4.6, D = 4.6, H = 3.1;           // room size (m)
const WIN = { y: 1.5, r: 0.82 };            // 圓窗 on the back wall (z = -D/2)

function tex(w, h, draw, { repeat = false } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function rng(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9 >>> 0) / 4294967296); }

/** Lime plaster, slightly mottled. */
function plaster() {
  return tex(256, 256, (g, w, h) => {
    g.fillStyle = '#d9ccb4'; g.fillRect(0, 0, w, h);
    const R = rng(11);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = R() < 0.5 ? 'rgba(120,100,70,0.05)' : 'rgba(255,250,235,0.06)';
      const s = 2 + R() * 14; g.beginPath(); g.arc(R() * w, R() * h, s, 0, Math.PI * 2); g.fill();
    }
  }, { repeat: true });
}

/** 掛軸: mounted paper with vertical calligraphy. */
function scroll(text) {
  return tex(256, 1024, (g, w, h) => {
    g.fillStyle = '#5b4a36'; g.fillRect(0, 0, w, h);                 // silk mount
    g.fillStyle = '#7a6448'; g.fillRect(14, 70, w - 28, h - 150);
    g.fillStyle = '#efe6d2'; g.fillRect(34, 130, w - 68, h - 260);   // paper
    const chars = [...text];
    const size = Math.min(150, (h - 360) / chars.length);
    g.fillStyle = '#1e1a16'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `500 ${size}px "BiauKai","DFKai-SB","Kaiti TC","STKaiti","KaiTi","Noto Serif TC","Songti TC",serif`;
    const top = h / 2 - ((chars.length - 1) * size * 1.08) / 2;
    chars.forEach((ch, i) => g.fillText(ch, w / 2, top + i * size * 1.08));
    g.fillStyle = '#a3362a'; g.fillRect(w / 2 + 26, h - 210, 26, 26); // small seal
  });
}

/** 障子: paper panels in a wood lattice, lit warm from behind. */
function shoji() {
  return tex(256, 512, (g, w, h) => {
    g.fillStyle = '#efe4cc'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#4a3423'; g.lineWidth = 6;
    for (let x = 0; x <= w; x += w / 4) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += h / 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.lineWidth = 14; g.strokeRect(0, 0, w, h);
  });
}

/** Distant ridges + a pine bough, drawn once; the sky behind them is a live gradient. */
function outsideLayer() {
  return tex(1024, 1024, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const ridge = (y0, amp, color, seed) => {
      const R = rng(seed);
      g.fillStyle = color; g.beginPath(); g.moveTo(0, h);
      let y = y0;
      for (let x = 0; x <= w; x += 16) { y += (R() - 0.5) * amp; y = Math.max(y0 - amp * 3, Math.min(y0 + amp * 2, y)); g.lineTo(x, y); }
      g.lineTo(w, h); g.closePath(); g.fill();
    };
    ridge(h * 0.62, 26, 'rgba(70,82,96,0.55)', 3);
    ridge(h * 0.7, 30, 'rgba(46,58,60,0.8)', 7);
    ridge(h * 0.8, 18, 'rgba(28,34,32,0.95)', 9);
    // pine bough from the upper right
    const R = rng(21);
    g.strokeStyle = '#1b1f1a'; g.lineCap = 'round';
    g.lineWidth = 14; g.beginPath(); g.moveTo(w * 0.86, h * 0.24); g.quadraticCurveTo(w * 0.7, h * 0.32, w * 0.54, h * 0.41); g.stroke();
    g.lineWidth = 7; g.beginPath(); g.moveTo(w * 0.72, h * 0.31); g.quadraticCurveTo(w * 0.67, h * 0.42, w * 0.61, h * 0.48); g.stroke();
    g.fillStyle = '#1d2a1f';
    for (const [cx, cy, n] of [[0.56, 0.4, 26], [0.62, 0.47, 20], [0.72, 0.33, 26], [0.8, 0.3, 20], [0.66, 0.37, 18]]) {
      for (let i = 0; i < n; i++) {
        const a = R() * Math.PI * 2, r = 20 + R() * 60;
        g.save(); g.translate(cx * w + Math.cos(a) * r * 0.9, cy * h + Math.sin(a) * r * 0.35);
        g.rotate(a); g.fillRect(0, -1.5, 34 + R() * 20, 3); g.restore();
      }
    }
  });
}

function lathe(points, segs = 20) { return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segs); }

/**
 * @param opts.look   the visitor's 泥生 look
 * @param opts.mode   'ritual' | 'cultural' — cultural rooms have no censer and a secular scroll
 */
export function buildChamber({ look, mode, quality, hour: hourOverride }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 60);
  const wood = new THREE.MeshStandardMaterial({ color: '#5a3d27', roughness: 0.75 });
  const darkWood = new THREE.MeshStandardMaterial({ color: '#3a271a', roughness: 0.7 });
  const floorTex = woodPlanks({ base: '#6a4a30', seed: 17 }); floorTex.repeat.set(2, 2);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.6, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), darkWood);
  ceil.rotation.x = Math.PI / 2; ceil.position.y = H; scene.add(ceil);

  const plasterTex = plaster(); plasterTex.repeat.set(2, 1.4);
  const wallMat = new THREE.MeshStandardMaterial({ map: plasterTex, roughness: 0.95 });

  // back wall with the round window cut out
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, 0); shape.lineTo(W / 2, 0); shape.lineTo(W / 2, H); shape.lineTo(-W / 2, H); shape.closePath();
  const hole = new THREE.Path(); hole.absarc(0, WIN.y, WIN.r, 0, Math.PI * 2, true); shape.holes.push(hole);
  const backGeo = new THREE.ShapeGeometry(shape, 48);
  // planar UVs for the plaster
  const uv = backGeo.attributes.uv; const pos = backGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + W / 2) / W, pos.getY(i) / H);
  const back = new THREE.Mesh(backGeo, wallMat); back.position.z = -D / 2; back.receiveShadow = true; scene.add(back);
  // window frame: a deep wooden ring
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(WIN.r + 0.02, WIN.r + 0.02, 0.24, 64, 1, true), darkWood);
  ring.material = darkWood.clone(); ring.material.side = THREE.DoubleSide;
  ring.rotation.x = Math.PI / 2; ring.position.set(0, WIN.y, -D / 2 - 0.1); scene.add(ring);
  const sill = new THREE.Mesh(new THREE.TorusGeometry(WIN.r + 0.05, 0.035, 8, 64), wood);
  sill.position.set(0, WIN.y, -D / 2 + 0.02); scene.add(sill);

  // the view: live sky gradient + moon/sun glow, then ridges and pine as a cut-out layer
  const skyMat = new THREE.ShaderMaterial({
    depthWrite: false,
    uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() }, glow: { value: new THREE.Color() }, glowPos: { value: new THREE.Vector2(0.3, 0.72) }, moon: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 glow; uniform vec2 glowPos; uniform float moon; varying vec2 vUv;
      void main(){ vec3 c = mix(bottom, top, smoothstep(0.35, 1.0, vUv.y));
        float d = distance(vUv, glowPos);
        c += glow * (exp(-d*9.0)*0.55);
        c = mix(c, vec3(0.96,0.94,0.86), moon * smoothstep(0.032, 0.027, d));
        vec2 cell = floor(vUv * 140.0); float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
        float star = step(0.993, h) * smoothstep(0.45, 0.75, vUv.y) * moon * (0.5 + 0.5 * h);
        c += vec3(star * 0.55);
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), skyMat);
  sky.position.set(0, WIN.y + 0.4, -D / 2 - 1.6); scene.add(sky);
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), new THREE.MeshBasicMaterial({ map: outsideLayer(), transparent: true, depthWrite: false, fog: false }));
  outside.position.set(0, WIN.y + 0.4, -D / 2 - 1.2); scene.add(outside);

  // side walls, front wall (behind the camera, mostly unseen), posts and a beam
  const side = (x, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(D, H), wallMat); m.position.set(x, H / 2, 0); m.rotation.y = ry; m.receiveShadow = true; scene.add(m); return m; };
  side(-W / 2, Math.PI / 2); side(W / 2, -Math.PI / 2);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat); front.position.set(0, H / 2, D / 2); front.rotation.y = Math.PI; scene.add(front);
  for (const x of [-W / 2 + 0.08, W / 2 - 0.08]) for (const z of [-D / 2 + 0.08, D / 2 - 0.08]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.16, H, 0.16), wood); p.position.set(x, H / 2, z); scene.add(p);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(W, 0.18, 0.14), wood); beam.position.set(0, H - 0.09, -D / 2 + 0.07); scene.add(beam);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(W, 0.12, 0.04), darkWood); skirt.position.set(0, 0.06, -D / 2 + 0.02); scene.add(skirt);

  // 障子 sliding door on the right wall, glowing faintly
  const shojiMat = new THREE.MeshStandardMaterial({ map: shoji(), emissive: '#ffcf8a', emissiveIntensity: 0.05, roughness: 0.9 });
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.2), shojiMat);
  door.position.set(W / 2 - 0.01, 1.1, 0.7); door.rotation.y = -Math.PI / 2; scene.add(door);

  // 掛軸 on the left wall
  const scrollText = mode === 'ritual' ? '心無罣礙' : '心遠地自偏';
  const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 2.0), new THREE.MeshStandardMaterial({ map: scroll(scrollText), roughness: 0.9 }));
  sc.position.set(-W / 2 + 0.015, 1.65, -0.7); sc.rotation.y = Math.PI / 2; scene.add(sc);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.6, 8), darkWood);
  rod.rotation.x = Math.PI / 2; rod.position.set(-W / 2 + 0.04, 0.66, -0.7); scene.add(rod);

  // 蒲團
  const puff = [[0, 0], [0.3, 0], [0.37, 0.02], [0.4, 0.06], [0.39, 0.11], [0.34, 0.15], [0.2, 0.17], [0, 0.17]];
  const cushion = new THREE.Mesh(lathe(puff, 24), new THREE.MeshStandardMaterial({ map: cushionWeave(), color: '#c8a46a', roughness: 0.95 }));
  const seat = { x: 0, z: -0.55 };
  cushion.position.set(seat.x, 0, seat.z); cushion.receiveShadow = true; scene.add(cushion);

  // 書案 with paper, inkstone and brush (where 抄經 happens)
  const desk = new THREE.Group(); desk.position.set(1.05, 0, -1.45); desk.rotation.y = -0.3; scene.add(desk);
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.46), wood); top.position.y = 0.34; top.castShadow = true; desk.add(top);
  for (const sx of [-0.44, 0.44]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.32, 0.4), darkWood); leg.position.set(sx, 0.16, 0); desk.add(leg); }
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.3), new THREE.MeshStandardMaterial({ color: '#f1e8d4', roughness: 0.95 }));
  paper.rotation.x = -Math.PI / 2; paper.position.set(-0.1, 0.366, 0.02); desk.add(paper);
  const inkstone = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 0.18), new THREE.MeshStandardMaterial({ color: '#1d1c1b', roughness: 0.4 }));
  inkstone.position.set(0.3, 0.375, 0); desk.add(inkstone);
  const brush = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.24, 6), new THREE.MeshStandardMaterial({ color: '#8b6a3c', roughness: 0.6 }));
  brush.rotation.z = Math.PI / 2; brush.rotation.y = 0.2; brush.position.set(0.18, 0.375, 0.16); desk.add(brush);

  // a vase with one branch (both modes); a small censer with one thread of smoke (ritual only)
  const vase = new THREE.Mesh(lathe([[0, 0], [0.05, 0], [0.07, 0.06], [0.05, 0.16], [0.025, 0.2], [0.03, 0.22]]), new THREE.MeshStandardMaterial({ color: '#cfd8d0', roughness: 0.25 }));
  vase.position.set(-1.65, 0, -1.85); scene.add(vase);
  const twig = new THREE.Group(); twig.position.set(-1.65, 0.2, -1.85); scene.add(twig);
  const twigMat = new THREE.MeshStandardMaterial({ color: '#3a2a1c', roughness: 0.9 });
  const bloom = new THREE.MeshStandardMaterial({ color: '#f3e3e0', emissive: '#f3d0c8', emissiveIntensity: 0.05, roughness: 0.8 });
  for (const [len, rz, rx] of [[0.55, 0.25, 0.1], [0.35, -0.4, -0.15], [0.28, 0.7, 0.2]]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.007, len, 5), twigMat);
    b.geometry.translate(0, len / 2, 0); b.rotation.set(rx, 0, rz); twig.add(b);
    for (let i = 1; i <= 3; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 4), bloom);
      f.position.set(-Math.sin(rz) * len * i / 3.4, Math.cos(rz) * len * i / 3.4, Math.sin(rx) * len * i / 3.4);
      twig.add(f);
    }
  }
  let smoke = null;
  if (mode === 'ritual') {
    const censer = new THREE.Mesh(lathe([[0, 0], [0.06, 0], [0.08, 0.03], [0.075, 0.07], [0.06, 0.08]]), new THREE.MeshStandardMaterial({ color: '#6b5532', metalness: 0.6, roughness: 0.45 }));
    censer.position.set(0.45, 0.365, -0.08); desk.add(censer);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.16, 4), new THREE.MeshStandardMaterial({ color: '#7a3b22' }));
    stick.position.set(0.45, 0.365 + 0.13, -0.08); desk.add(stick);
    smoke = new Smoke(scene, { max: 160 });
    smoke.mat.uniforms.scale.value = 120;
    const tip = new THREE.Vector3(0.45, 0.365 + 0.21, -0.08).applyMatrix4(desk.matrixWorld.compose(desk.position, desk.quaternion, desk.scale));
    smoke.emitter(tip, 1e7, 3);
  }

  // 油燈 on a low stand: the room's warm light
  const lampG = new THREE.Group(); lampG.position.set(-1.25, 0, -1.4); scene.add(lampG);
  const stand = new THREE.Mesh(lathe([[0, 0], [0.13, 0], [0.13, 0.03], [0.03, 0.05], [0.025, 0.55], [0.09, 0.58], [0.1, 0.6], [0, 0.6]]), darkWood);
  lampG.add(stand);
  const dish = new THREE.Mesh(lathe([[0, 0], [0.07, 0.01], [0.085, 0.035]]), new THREE.MeshStandardMaterial({ color: '#8a6a3a', metalness: 0.5, roughness: 0.5, side: THREE.DoubleSide }));
  dish.position.y = 0.6; lampG.add(dish);
  const flameMat = new THREE.MeshBasicMaterial({ color: '#ffd9a0', transparent: true, opacity: 0.95, depthWrite: false });
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), flameMat); flame.scale.set(1, 2.4, 1);
  flame.position.y = 0.66; lampG.add(flame);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,200,120,0.9)'); r.addColorStop(1, 'rgba(255,160,60,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  halo.scale.setScalar(0.5); halo.position.y = 0.66; lampG.add(halo);
  const lampLight = new THREE.PointLight('#ffb36a', 2.2, 7, 1.6);
  lampLight.position.set(0, 0.75, 0); lampLight.castShadow = quality !== 'low';
  lampLight.shadow.mapSize.set(512, 512); lampLight.shadow.bias = -0.002;
  lampG.add(lampLight);

  // window light (sky through the round window) + a soft fill
  const hemi = new THREE.HemisphereLight('#c8d2e0', '#4a3626', 0.3); scene.add(hemi);
  const winLight = new THREE.SpotLight('#cfe0ff', 3, 9, 0.75, 0.9, 1.2);
  winLight.position.set(0, WIN.y + 0.3, -D / 2 - 0.6); winLight.target.position.set(0, 0, 0.6);
  winLight.castShadow = quality !== 'low'; winLight.shadow.mapSize.set(512, 512);
  scene.add(winLight, winLight.target);
  // a faint warm bounce from the room behind the camera, so 泥生's back isn't a silhouette
  const fill = new THREE.PointLight('#ffd2a0', 0.9, 6, 1.5); fill.position.set(0.6, 1.7, 1.6); scene.add(fill);

  // 泥生, seated on the cushion facing the window
  const me = new Nisheng(look, { castShadow: true });
  me.root.position.set(seat.x, 0, seat.z); me.root.rotation.y = Math.PI;
  me.setAction('sit');
  scene.add(me.root);

  const state = { dim: 0, dimTarget: 0, hour: 12 };
  function setHour(hour) {
    const p = palette(hour);
    state.hour = hour;
    skyMat.uniforms.top.value.copy(p.top);
    skyMat.uniforms.bottom.value.copy(p.bottom).lerp(p.fog, 0.3);
    skyMat.uniforms.glow.value.copy(p.sun);
    skyMat.uniforms.moon.value = p.night ? 1 : 0;
    skyMat.uniforms.glowPos.value.set(p.night ? 0.4 : 0.6, p.night ? 0.6 : 0.56);
    // daylight pours in through the window; at night the lamp carries the room
    winLight.color.copy(p.night ? new THREE.Color('#9fb4e0') : p.sun);
    winLight.intensity = p.night ? 1.2 : 2 + p.sunI * 1.5;
    hemi.intensity = 0.12 + p.hemi * 0.22;
    lampLight.userData.base = p.night ? 2.6 : 1.3;
    outside.material.color.setScalar(p.night ? 0.55 : 1);
  }
  setHour(hourOverride ?? new Date().getHours() + new Date().getMinutes() / 60);

  // camera: behind and to the right, looking past 泥生's back (背後指紋) to the window
  const camBase = new THREE.Vector3(1.25, 1.4, 1.95);
  const lookAt = new THREE.Vector3(-0.1, 0.95, -1.6);

  function update(dt, t) {
    me.update(dt, 0);
    if (smoke) smoke.update(dt, t, 0.02);
    // lamp flicker: two slow sines and a little noise
    const fl = 1 + Math.sin(t * 7.3) * 0.04 + Math.sin(t * 13.1 + 1.7) * 0.03 + (Math.random() - 0.5) * 0.04;
    state.dim += (state.dimTarget - state.dim) * Math.min(1, dt * 0.35);
    const lampK = 1 - state.dim;
    lampLight.intensity = (lampLight.userData.base || 2) * fl * lampK;
    flameMat.opacity = 0.95 * lampK; halo.material.opacity = lampK;
    flame.scale.set(1, 2.4 * fl, 1);
    shojiMat.emissiveIntensity = 0.05 * lampK;
    // a breath-slow drift of the camera
    camera.position.set(camBase.x + Math.sin(t * 0.05) * 0.06, camBase.y + Math.sin(t * 0.07) * 0.02, camBase.z);
    camera.lookAt(lookAt);
  }

  return {
    scene, camera, avatar: me, update, setHour,
    /** 熄燈: the lamp burns down slowly; only the window light stays (睡前). */
    setDim(on) { state.dimTarget = on ? 1 : 0; },
    resize(w, h) { camera.aspect = w / h; camera.fov = w < h ? 62 : 48; camera.updateProjectionMatrix(); },
    dispose() {
      scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; if (m) for (const x of [].concat(m)) { x.map?.dispose?.(); x.dispose?.(); } });
      me.dispose();
    },
  };
}
