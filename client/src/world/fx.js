// Lightweight GPU particles: incense smoke and seasonal drift (petals / leaves / snow).
// All particles are client-side only; the server just says "someone offered incense" (6.2).
import * as THREE from 'three';
import { softDot, petal } from './textures.js';

export class Smoke {
  constructor(scene, { max = 700 } = {}) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(1);   // 0..1, 1 = dead
    this.life = new Float32Array(max).fill(1);
    this.seed = new Float32Array(max);
    this.origin = new Float32Array(max * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('age', new THREE.BufferAttribute(this.age, 1));
    g.setAttribute('seed', new THREE.BufferAttribute(this.seed, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { map: { value: softDot('#ffffff') }, scale: { value: 280 }, tint: { value: new THREE.Color('#d9d4cc') } },
      vertexShader: `attribute float age; attribute float seed; varying float vA;
        uniform float scale;
        void main(){ vA = age; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = (0.05 + age*0.6) * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 tint; varying float vA;
        void main(){ if (vA >= 1.0) discard; vec4 c = texture2D(map, gl_PointCoord);
          float a = c.a * smoothstep(0.0,0.08,vA) * (1.0-vA) * 0.32; gl_FragColor = vec4(tint, a); }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.emitters = [];  // { pos: Vector3, until: time, rate }
    this.cursor = 0;
    this.acc = 0;
  }

  /** Emit from a point for `seconds` (a burning stick). */
  emitter(pos, seconds = 90, rate = 6) { this.emitters.push({ pos: pos.clone(), until: performance.now() / 1000 + seconds, rate, acc: 0 }); }

  _spawn(p) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    this.origin.set([p.x, p.y, p.z], i * 3);
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.age[i] = 0; this.life[i] = 5 + Math.random() * 3; this.seed[i] = Math.random() * 100;
  }

  update(dt, t, wind = 0.15) {
    const now = performance.now() / 1000;
    this.emitters = this.emitters.filter((e) => e.until > now);
    for (const e of this.emitters) {
      e.acc += dt * e.rate;
      while (e.acc >= 1) { e.acc -= 1; this._spawn(e.pos); }
    }
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= 1) continue;
      this.age[i] = Math.min(1, this.age[i] + dt / this.life[i]);
      const a = this.age[i], s = this.seed[i];
      const h = a * 3.2;
      this.pos[i * 3] = this.origin[i * 3] + Math.sin(h * 2.1 + s + t * 0.6) * 0.12 * (0.2 + a) + wind * h * h * 0.35;
      this.pos[i * 3 + 1] = this.origin[i * 3 + 1] + h;
      this.pos[i * 3 + 2] = this.origin[i * 3 + 2] + Math.cos(h * 1.7 + s) * 0.08 * a;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.age.needsUpdate = true;
  }
}

const SEASON_FX = {
  spring: { color: '#f4c6d2', count: 260, fall: 0.6, size: 0.16, tex: 'petal' },
  summer: { color: '#ffffb0', count: 120, fall: -0.02, size: 0.08, tex: 'dot', glowNight: true }, // fireflies
  autumn: { color: '#c8572c', count: 220, fall: 0.8, size: 0.2, tex: 'petal' },
  winter: { color: '#ffffff', count: 700, fall: 0.9, size: 0.09, tex: 'dot' },
};

export class SeasonDrift {
  constructor(scene, season, quality) {
    const cfg = SEASON_FX[season];
    const n = Math.floor(cfg.count * (quality === 'low' ? 0.4 : 1));
    this.cfg = cfg; this.n = n;
    this.base = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) this.base.set([(Math.random() - 0.5) * 60, Math.random() * 14, (Math.random() - 0.5) * 60 - 6], i * 3);
    this.pos = new Float32Array(this.base);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({
      size: cfg.size, map: cfg.tex === 'petal' ? petal(cfg.color) : softDot(cfg.color), transparent: true, depthWrite: false,
      opacity: 0.85, sizeAttenuation: true, color: 0xffffff,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(dt, t, night) {
    const { fall } = this.cfg;
    if (this.cfg.glowNight) this.mat.opacity = night ? 0.9 : 0.0;
    for (let i = 0; i < this.n; i++) {
      const k = i * 3;
      let y = this.base[k + 1] - fall * dt;
      if (y < 0) y += 14; if (y > 14) y -= 14;
      this.base[k + 1] = y;
      this.pos[k] = this.base[k] + Math.sin(t * 0.5 + i) * 0.6;
      this.pos[k + 1] = y + (fall < 0 ? Math.sin(t + i) * 0.3 : 0);
      this.pos[k + 2] = this.base[k + 2] + Math.cos(t * 0.4 + i * 1.3) * 0.5;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
