// Renderer, sky, light and time of day. 天色跟随用户本地时间，季节跟随月份（2.3）。
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** Rough device tier: low-end phones get no shadows and lower pixel ratio (6.3 自动降级). */
export function detectQuality() {
  const q = new URLSearchParams(location.search).get('q');
  if (q === 'low' || q === 'med' || q === 'high') return q;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const cores = navigator.hardwareConcurrency || 4;
  if (mobile && cores <= 4) return 'low';
  if (mobile) return 'med';
  return 'high';
}

export function createRenderer(canvas, quality) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : quality === 'med' ? 1.5 : 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = quality !== 'low';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

/** Key colours for a given local hour (0–24). */
function palette(hour) {
  const keys = [
    // hemi / env are the fill light. three.js r155+ no longer scales light intensity by PI,
    // so the old values (≈0.7) left shaded sides at ~20% and avatars read as black.
    [0, { top: '#0b0f1c', bottom: '#1b1d29', sun: '#6d7fae', sunI: 0.15, hemi: 0.35, env: 0.06, fog: '#14161f', exp: 0.95 }],
    [5.5, { top: '#2a3150', bottom: '#d49a7a', sun: '#ffb27a', sunI: 0.6, hemi: 0.8, env: 0.2, fog: '#9c8577', exp: 1.0 }],
    [8, { top: '#6f97c2', bottom: '#e8dccb', sun: '#fff1da', sunI: 2.2, hemi: 1.1, env: 0.3, fog: '#cfc6b8', exp: 1.0 }],
    [13, { top: '#5f8fc4', bottom: '#e6e2d8', sun: '#fffaf0', sunI: 2.6, hemi: 1.2, env: 0.32, fog: '#d3cdc2', exp: 1.0 }],
    [17, { top: '#6b7fa8', bottom: '#f0c08e', sun: '#ffc27a', sunI: 1.8, hemi: 0.9, env: 0.26, fog: '#c9a988', exp: 1.0 }],
    [19, { top: '#232a48', bottom: '#a36a5a', sun: '#ff9466', sunI: 0.45, hemi: 0.6, env: 0.15, fog: '#5b4a4c', exp: 1.0 }],
    [21, { top: '#0d1222', bottom: '#2a2633', sun: '#7083b5', sunI: 0.18, hemi: 0.4, env: 0.07, fog: '#1a1a24', exp: 0.95 }],
    [24, { top: '#0b0f1c', bottom: '#1b1d29', sun: '#6d7fae', sunI: 0.15, hemi: 0.35, env: 0.06, fog: '#14161f', exp: 0.95 }],
  ];
  let i = 0;
  while (i < keys.length - 2 && hour >= keys[i + 1][0]) i++;
  const [h0, a] = keys[i], [h1, b] = keys[i + 1];
  const k = (hour - h0) / (h1 - h0);
  const mix = (x, y) => new THREE.Color(x).lerp(new THREE.Color(y), k);
  return {
    top: mix(a.top, b.top), bottom: mix(a.bottom, b.bottom), sun: mix(a.sun, b.sun), fog: mix(a.fog, b.fog),
    sunI: a.sunI + (b.sunI - a.sunI) * k, hemi: a.hemi + (b.hemi - a.hemi) * k, exp: a.exp + (b.exp - a.exp) * k,
    env: a.env + (b.env - a.env) * k,
    night: hour < 5.5 || hour >= 19.5,
  };
}

export function season(month = new Date().getMonth()) {
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'autumn';
  return 'winter';
}

export function createEnvironment(scene, renderer, quality, manifest) {
  // Sky dome with vertical gradient
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3() }, sunCol: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vP;
      void main(){ float h = clamp(vP.y*1.6+0.12, 0.0, 1.0); vec3 c = mix(bottom, top, pow(h, 0.7));
        float s = max(dot(normalize(vP), normalize(sunDir)), 0.0); c += sunCol * (pow(s, 600.0)*1.5 + pow(s, 8.0)*0.12);
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat);
  sky.renderOrder = -1;
  scene.add(sky);

  const fogCfg = manifest.environment?.fog || { near: 20, far: 100 };
  scene.fog = new THREE.Fog(0xcfc6b8, fogCfg.near, fogCfg.far);

  const hemi = new THREE.HemisphereLight(0xdfe6f0, 0x8a7560, 0.6);
  scene.add(hemi);
  // Soft studio-like reflections so glazed avatars read as ceramic (matches the reference renders).
  // Skipped on low tier to save the PMREM bake and per-pixel cost.
  if (quality !== 'low') {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.castShadow = quality !== 'low';
  sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
  Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 140 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  sun.target.position.set(0, 0, -10);

  const state = { night: false, hour: 12 };

  function update(hourOverride) {
    const now = new Date();
    const hour = hourOverride ?? (now.getHours() + now.getMinutes() / 60);
    const p = palette(hour);
    state.night = p.night; state.hour = hour;
    skyMat.uniforms.top.value.copy(p.top);
    skyMat.uniforms.bottom.value.copy(p.bottom);
    scene.fog.color.copy(p.fog);
    hemi.intensity = p.hemi;
    scene.environmentIntensity = p.env;
    hemi.color.copy(p.top).lerp(new THREE.Color('#ffffff'), 0.6);
    sun.color.copy(p.sun);
    sun.intensity = p.sunI;
    // Sun arc: east (+x) in the morning, high at noon, west in the evening; moon-ish at night.
    const dayK = THREE.MathUtils.clamp((hour - 6) / 12, 0, 1);
    const ang = p.night ? 0.9 : Math.PI * dayK;
    const elev = p.night ? 0.8 : Math.max(0.15, Math.sin(ang) * 1.05);
    const dir = new THREE.Vector3(Math.cos(ang) * 0.9, elev, 0.55).normalize();
    sun.position.copy(dir).multiplyScalar(70).add(sun.target.position);
    skyMat.uniforms.sunDir.value.copy(dir);
    skyMat.uniforms.sunCol.value.copy(p.sun).multiplyScalar(p.night ? 0.2 : 1);
    renderer.toneMappingExposure = p.exp;
    return state;
  }
  update(new URLSearchParams(location.search).has('hour') ? Number(new URLSearchParams(location.search).get('hour')) : undefined);
  return { sky, sun, hemi, state, update };
}
