// Crowd renderer (設計文檔 9.3 P1：100 尊泥生同屏 ≤ 150 draw calls).
// Every other pilgrim is a Nisheng *rig* (crowd: true): it still poses itself with IK, but its parts
// are never drawn one by one. Each frame the rigs' part matrices are gathered into one InstancedMesh
// per (detail level × part × material class). Glaze colour, crackle, 金缮 and the seed travel as
// per-instance attributes, so 100 different-looking 泥生 share a handful of draw calls.
// Name tags go into one canvas atlas and are drawn as a single instanced billboard batch.
import * as THREE from 'three';
import { geometry, shared, GLSL_NOISE, CLAY_FRAG, CLAY_ROUGH, CLAY_METAL } from './nisheng.js';

export const LOD_NEAR = 12;   // metres: closer pilgrims get full tessellation (and shadows on high)

/** Clay / glaze material whose look comes from instance attributes instead of uniforms. */
function crowdClay(glaze, print) {
  const m = glaze
    ? new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.12, sheen: 0 })
    : new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPrint = { value: print ? 1 : 0 };
    sh.uniforms.uGrain = { value: glaze ? 0.02 : 0.16 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aLook0; attribute vec4 aLook1;\nvarying vec4 vLook0; varying vec4 vLook1; varying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position; vLook0 = aLook0; vLook1 = aLook1;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec4 vLook0; varying vec4 vLook1; varying vec3 vObj; uniform float uPrint, uGrain;
#define uCrack vLook0.x
#define uGold vLook0.y
#define uSeed vLook0.z
#define uPattern vLook0.w
${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = vLook1.rgb;\n${CLAY_FRAG}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = vLook1.a;\n${CLAY_ROUGH}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${CLAY_METAL}`);
  };
  m.customProgramCacheKey = () => `crowd-clay-${glaze ? 'g' : 'c'}${print ? 'p' : ''}`;
  return m;
}

/** 心燈: emissive strength per instance (breathing, longer sits glow brighter). */
function crowdLamp() {
  const m = new THREE.MeshStandardMaterial({ color: '#2a1608', emissive: '#ffb04a', emissiveIntensity: 1 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow; varying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vGlow;');
  };
  m.customProgramCacheKey = () => 'crowd-lamp';
  return m;
}

let MATS = null;
function materials() {
  if (MATS) return MATS;
  MATS = { g: crowdClay(true, false), gp: crowdClay(true, true), c: crowdClay(false, false), cp: crowdClay(false, true), lamp: crowdLamp() };
  return MATS;
}

/** A geometry view that shares the part's GPU buffers but can carry its own instance attributes. */
function view(geo) {
  const g = new THREE.BufferGeometry();
  g.setIndex(geo.index);
  for (const [k, a] of Object.entries(geo.attributes)) g.setAttribute(k, a);
  g.boundingSphere = geo.boundingSphere; g.boundingBox = geo.boundingBox;
  return g;
}

class Bucket {
  constructor(scene, geo, mat, { castShadow, receiveShadow, look, glow }) {
    Object.assign(this, { scene, geo: view(geo), mat, castShadow, receiveShadow, look, glow });
    this.n = 0; this.cap = 0; this.mesh = null;
    this.grow(16);
  }

  grow(cap) {
    const old = this.mesh;
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; // rigs are culled per avatar on the CPU
    mesh.castShadow = this.castShadow; mesh.receiveShadow = this.receiveShadow;
    const attr = (name, size) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      if (old) a.array.set(old.geometry.attributes[name].array.subarray(0, this.n * size));
      this.geo.setAttribute(name, a);
      return a;
    };
    if (this.look) { this.l0 = attr('aLook0', 4); this.l1 = attr('aLook1', 4); }
    if (this.glow) this.g = attr('aGlow', 1);
    if (old) { mesh.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, this.n * 16)); old.removeFromParent(); old.dispose(); }
    this.mesh = mesh; this.cap = cap;
    this.scene.add(mesh);
  }

  push(matrix, inst, glow) {
    if (this.n >= this.cap) this.grow(this.cap * 2);
    const i = this.n++;
    matrix.toArray(this.mesh.instanceMatrix.array, i * 16);
    if (this.look) {
      this.l0.array.set([inst.cracks, inst.gold, inst.seed * 7.31, inst.pattern], i * 4);
      this.l1.array.set([inst.color.r, inst.color.g, inst.color.b, inst.rough], i * 4);
    }
    if (this.glow) this.g.array[i] = glow;
  }

  end() {
    const m = this.mesh;
    m.count = this.n;
    m.visible = this.n > 0;
    if (!this.n) return;
    m.instanceMatrix.needsUpdate = true;
    if (this.look) { this.l0.needsUpdate = true; this.l1.needsUpdate = true; }
    if (this.glow) this.g.needsUpdate = true;
  }

  dispose() { this.mesh.removeFromParent(); this.mesh.dispose(); }
}

const NO_SHADOW = new Set(['ghost', 'lamp', 'tip', 'stitch', 'eyes']);

export class Crowd {
  /** @param opts.shadows  near pilgrims cast shadows (quality 'high') */
  constructor(scene, { shadows = false } = {}) {
    this.scene = scene; this.shadows = shadows;
    this.buckets = new Map();
    this.group = new THREE.Group(); this.group.name = 'crowd';
    scene.add(this.group);
  }

  bucket(lod, geoName, mat) {
    const key = `${lod}|${geoName}|${mat}`;
    let b = this.buckets.get(key);
    if (b) return b;
    const M = materials(), S = shared();
    const clay = mat in M && mat !== 'lamp';
    const material = clay ? M[mat] : mat === 'lamp' ? M.lamp : S[mat];
    b = new Bucket(this.group, geometry(lod)[geoName], material, {
      castShadow: this.shadows && lod === 0 && !NO_SHADOW.has(mat),
      receiveShadow: mat !== 'ghost', look: clay, glow: mat === 'lamp',
    });
    this.buckets.set(key, b);
    return b;
  }

  begin() { for (const b of this.buckets.values()) b.n = 0; }

  /** Queue one rig's visible parts. lod 0 = near, 1 = far. */
  add(av, lod) {
    av.root.updateMatrixWorld(true);
    const inst = av.ghost ? null : av.instanceLook();
    const glow = av.lampMat.emissiveIntensity;
    for (const s of av.slots) {
      if (!s.mesh.visible) continue;
      let mat = s.mat;
      if (mat === 'clay' || mat === 'clayPrint') mat = (inst.glaze ? 'g' : 'c') + (mat === 'clayPrint' ? 'p' : '');
      this.bucket(lod, s.geo, mat).push(s.mesh.matrixWorld, inst, glow);
    }
  }

  end() { for (const b of this.buckets.values()) b.end(); }

  dispose() { for (const b of this.buckets.values()) b.dispose(); this.buckets.clear(); this.group.removeFromParent(); }
}

// ---------------------------------------------------------------- name tags

const CELL_W = 256, CELL_H = 64, ATLAS_W = 2048, ATLAS_H = 1024;
const COLS = ATLAS_W / CELL_W, ROWS = ATLAS_H / CELL_H; // 8 × 16 = 128 tags (a room holds 100)

/** All name tags in one canvas texture, drawn as one batch of camera-facing quads. */
export class TagAtlas {
  constructor(scene) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_W; this.canvas.height = ATLAS_H;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.generateMipmaps = true; this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.free = Array.from({ length: COLS * ROWS }, (_, i) => COLS * ROWS - 1 - i);
    this.dirty = false;
    const max = COLS * ROWS;
    const geo = new THREE.PlaneGeometry(1.1, 0.275);
    this.cell = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.cell.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aCell', this.cell);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { map: { value: this.tex } },
      vertexShader: `attribute vec4 aCell; varying vec2 vUv;
        void main() {
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          mv.xy += position.xy;              // always faces the camera, world-sized like a sprite
          gl_Position = projectionMatrix * mv;
          vUv = aCell.xy + uv * aCell.zw;
        }`,
      fragmentShader: `uniform sampler2D map; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(map, vUv);
          if (c.a < 0.01) discard;
          gl_FragColor = c;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.n = 0;
    this._m = new THREE.Matrix4();
  }

  /** Draw a tag into a free cell; returns the cell index (or -1 when full). */
  alloc(name, sub, { ghost = false } = {}) {
    const c = this.free.pop();
    if (c === undefined) return -1;
    this.draw(c, name, sub, ghost);
    return c;
  }

  draw(c, name, sub, ghost = false) {
    const g = this.g, x = (c % COLS) * CELL_W, y = Math.floor(c / COLS) * CELL_H;
    g.clearRect(x, y, CELL_W, CELL_H);
    g.save();
    g.beginPath(); g.rect(x, y, CELL_W, CELL_H); g.clip();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.85)'; g.shadowBlur = 5;
    g.font = '600 23px "Noto Serif TC","Songti TC",serif';
    g.fillStyle = ghost ? 'rgba(239,231,218,0.55)' : '#f2ead9';
    g.fillText(name, x + CELL_W / 2, y + 23);
    if (sub) { g.font = '400 15px "Noto Sans TC",sans-serif'; g.fillStyle = ghost ? 'rgba(210,173,94,0.5)' : '#d2ad5e'; g.fillText(sub, x + CELL_W / 2, y + 49); }
    g.restore();
    this.dirty = true;
  }

  release(c) {
    if (c < 0) return;
    this.g.clearRect((c % COLS) * CELL_W, Math.floor(c / COLS) * CELL_H, CELL_W, CELL_H);
    this.free.push(c);
  }

  begin() { this.n = 0; }

  add(c, pos) {
    if (c < 0) return;
    const i = this.n++;
    this._m.makeTranslation(pos.x, pos.y, pos.z);
    this._m.toArray(this.mesh.instanceMatrix.array, i * 16);
    // canvas y runs down; texture v runs up (flipY)
    this.cell.array.set([(c % COLS) / COLS, 1 - (Math.floor(c / COLS) + 1) / ROWS, 1 / COLS, 1 / ROWS], i * 4);
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.cell.needsUpdate = true;
    if (this.dirty) { this.tex.needsUpdate = true; this.dirty = false; } // one upload per frame at most
  }

  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.tex.dispose(); }
}
