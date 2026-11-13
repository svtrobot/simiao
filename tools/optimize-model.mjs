// Turn a heavy sculpt (.glb, hundreds of thousands of triangles, a baked texture) into something
// a phone can draw: far fewer triangles, no texture — the texture's light and dark are baked
// into vertex colours, which the client's gilding material uses as its tone (docs/SCENE_PACKAGE.md).
// Zero dependencies. The texture is read as a 24-bit BMP (convert the model's JPEG / PNG first).
//
//   node tools/optimize-model.mjs --in model.glb --tex texture.bmp --out scenes/<id>/assets/statue-high.glb --tris 90000
//     --hair-above 0.38     optional: the hairline at the FRONT of the head, as a fraction of the model's height
//                           measured from its centre (−0.5…0.5). Everything above it is hair: tinted
//                           blue-black and marked non-metal. A little below it, only dark dull texels are.
//     --hair-back 0.22      the hairline at the back (the nape), same units; defaults to --hair-above
//     --hair-z 0.05,-0.12   where front and back are, in model units along z (blend between the two lines)
//
// How: vertices are merged on a regular grid (the cell size is searched until the triangle count
// lands on the target); each merged vertex takes the mean position, colour and — importantly —
// the mean of the ORIGINAL normals, so the shading keeps detail the coarser mesh no longer has.
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const IN = arg('in'), TEX = arg('tex'), OUT = arg('out'), TARGET = Number(arg('tris', 90000));
const HAIR = arg('hair-above') !== undefined ? Number(arg('hair-above')) : null;
const HAIR_BACK = arg('hair-back') !== undefined ? Number(arg('hair-back')) : HAIR;
const [HAIR_ZF, HAIR_ZB] = (arg('hair-z', '0.05,-0.12')).split(',').map(Number);
if (!IN || !OUT) { console.error('usage: --in model.glb [--tex texture.bmp] --out out.glb [--tris 90000] [--hair-above 0.42]'); process.exit(1); }

// ---------------------------------------------------------------- read the .glb
const buf = fs.readFileSync(IN);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a .glb');
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const bin = buf.subarray(20 + jsonLen + 8);
const TYPES = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function accessor(i) {
  const a = gltf.accessors[i], bv = gltf.bufferViews[a.bufferView], T = TYPES[a.componentType], n = SIZE[a.type];
  const at = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || T.BYTES_PER_ELEMENT * n;
  const out = new T(a.count * n);
  const dv = new DataView(bin.buffer, bin.byteOffset + at, (a.count - 1) * stride + T.BYTES_PER_ELEMENT * n);
  const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = dv[get](k * stride + c * T.BYTES_PER_ELEMENT, true);
  return out;
}
const node = gltf.nodes.find((n) => n.mesh !== undefined);
const prims = gltf.meshes[node.mesh].primitives;
if (prims.length !== 1) throw new Error('expected one primitive');
const prim = prims[0];
const pos = accessor(prim.attributes.POSITION), nrm = accessor(prim.attributes.NORMAL);
const uv = prim.attributes.TEXCOORD_0 !== undefined ? accessor(prim.attributes.TEXCOORD_0) : null;
const idx = prim.indices !== undefined ? accessor(prim.indices) : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
const V = pos.length / 3;
// the node's matrix (column-major), so the output needs no transform
if (node.matrix) {
  const m = node.matrix;
  for (let i = 0; i < V; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    pos[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12]; pos[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]; pos[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    const a = nrm[i * 3], b = nrm[i * 3 + 1], c = nrm[i * 3 + 2];
    nrm[i * 3] = m[0] * a + m[4] * b + m[8] * c; nrm[i * 3 + 1] = m[1] * a + m[5] * b + m[9] * c; nrm[i * 3 + 2] = m[2] * a + m[6] * b + m[10] * c;
  }
}
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < V; i++) for (let c = 0; c < 3; c++) { const v = pos[i * 3 + c]; if (v < min[c]) min[c] = v; if (v > max[c]) max[c] = v; }
const size = max.map((v, c) => v - min[c]);
console.log(`in:  ${V.toLocaleString()} vertices, ${(idx.length / 3).toLocaleString()} triangles, ${(buf.length / 1048576).toFixed(1)} MB; size ${size.map((v) => v.toFixed(2)).join(' × ')}`);

// ---------------------------------------------------------------- texture → a tone per vertex
// tone = how light the baked texture is there, relative to its bright gold (crevices and undersides are darker)
const col = new Float32Array(V * 4).fill(1);
if (TEX && uv) {
  const b = fs.readFileSync(TEX);
  if (b.toString('latin1', 0, 2) !== 'BM' || b.readUInt16LE(28) !== 24) throw new Error('texture must be a 24-bit BMP');
  const off = b.readUInt32LE(10), w = b.readInt32LE(18), hRaw = b.readInt32LE(22), h = Math.abs(hRaw), row = Math.ceil(w * 3 / 4) * 4;
  const texel = (x, y) => { const yy = hRaw > 0 ? h - 1 - y : y, o = off + yy * row + x * 3; return [b[o + 2] / 255, b[o + 1] / 255, b[o] / 255]; };
  const sample = (u, v) => {
    u -= Math.floor(u); v -= Math.floor(v);
    const fx = u * w - 0.5, fy = v * h - 0.5, x0 = Math.max(0, Math.floor(fx)), y0 = Math.max(0, Math.floor(fy)), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    const tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0));
    const a = texel(x0, y0), c = texel(x1, y0), d = texel(x0, y1), e = texel(x1, y1);
    return [0, 1, 2].map((k) => (a[k] * (1 - tx) + c[k] * tx) * (1 - ty) + (d[k] * (1 - tx) + e[k] * tx) * ty);
  };
  const luma = new Float32Array(V), sat = new Float32Array(V);
  for (let i = 0; i < V; i++) {
    const [r, g, bl] = sample(uv[i * 2], uv[i * 2 + 1]);
    const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
    luma[i] = 0.2126 * r + 0.7152 * g + 0.0722 * bl; sat[i] = mx > 0 ? (mx - mn) / mx : 0;
  }
  const sorted = Float32Array.from(luma).sort();
  const bright = sorted[Math.floor(V * 0.85)], dark = sorted[Math.floor(V * 0.03)];
  let hair = 0;
  const cy = (min[1] + max[1]) / 2;
  for (let i = 0; i < V; i++) {
    // 0.55…1: never black — the gilding still catches light in the hollows
    const tone = 0.55 + 0.45 * Math.min(1, Math.max(0, (luma[i] - dark) / (bright - dark)));
    let isHair = false;
    if (HAIR !== null) {
      const k = Math.min(1, Math.max(0, (HAIR_ZF - pos[i * 3 + 2]) / (HAIR_ZF - HAIR_ZB)));   // 0 at the face, 1 at the back of the head
      const line = HAIR + (HAIR_BACK - HAIR) * k, hgt = (pos[i * 3 + 1] - cy) / size[1];
      // curls at the temples dip below the line; the forehead between them does not
      const temple = Math.abs(pos[i * 3] - (min[0] + max[0]) / 2) > size[0] * 0.095;
      isHair = hgt > line || (temple && hgt > line - 0.09 && sat[i] < 0.56 && luma[i] < bright * 0.72);
    }
    if (isHair) { hair += 1; col[i * 4] = 0.07 * tone; col[i * 4 + 1] = 0.11 * tone; col[i * 4 + 2] = 0.45 * tone; col[i * 4 + 3] = 0.12; }
    else { col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = tone; col[i * 4 + 3] = 1; }
  }
  console.log(`tex: ${w}×${h}; ${hair.toLocaleString()} vertices marked as hair`);
}

// ---------------------------------------------------------------- merge vertices on a grid
function cluster(cell) {
  const K = Math.ceil(Math.max(...size) / cell) + 2;
  const ids = new Map(), of = new Uint32Array(V);
  let n = 0;
  for (let i = 0; i < V; i++) {
    const key = Math.floor((pos[i * 3] - min[0]) / cell) + K * (Math.floor((pos[i * 3 + 1] - min[1]) / cell) + K * Math.floor((pos[i * 3 + 2] - min[2]) / cell));
    let id = ids.get(key);
    if (id === undefined) { id = n++; ids.set(key, id); }
    of[i] = id;
  }
  const seen = new Set(), tris = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = of[idx[t]], b = of[idx[t + 1]], c = of[idx[t + 2]];
    if (a === b || b === c || a === c) continue;
    const lo = Math.min(a, b, c), hi = Math.max(a, b, c), mid = a + b + c - lo - hi;
    const key = lo * n * n + mid * n + hi;                 // exact for n < ~200k (below 2^53)
    if (seen.has(key)) continue;
    seen.add(key); tris.push(a, b, c);
  }
  return { of, n, tris };
}
let lo = Math.max(...size) / 2000, hi = Math.max(...size) / 4, best = null;
for (let it = 0; it < 22; it++) {
  const cell = Math.sqrt(lo * hi), c = cluster(cell);
  if (!best || Math.abs(c.tris.length / 3 - TARGET) < Math.abs(best.tris.length / 3 - TARGET)) best = { ...c, cell };
  if (c.tris.length / 3 > TARGET) lo = cell; else hi = cell;
  if (Math.abs(c.tris.length / 3 - TARGET) / TARGET < 0.01) break;
}
const { of, n: N, tris, cell } = best;
const P = new Float64Array(N * 3), Nn = new Float64Array(N * 3), C = new Float64Array(N * 4), cnt = new Uint32Array(N);
for (let i = 0; i < V; i++) {
  const k = of[i]; cnt[k] += 1;
  for (let c = 0; c < 3; c++) { P[k * 3 + c] += pos[i * 3 + c]; Nn[k * 3 + c] += nrm[i * 3 + c]; }
  for (let c = 0; c < 4; c++) C[k * 4 + c] += col[i * 4 + c];
}
// The baked texture also holds its own highlights and noise; a few rounds of averaging with the
// neighbours keep the broad light and dark (hollows, undersides) and lose the speckle.
{
  const nb = Array.from({ length: N }, () => new Set());
  for (let t = 0; t < tris.length; t += 3) { const a = tris[t], b = tris[t + 1], c = tris[t + 2]; nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); }
  for (let k = 0; k < N; k++) if (cnt[k]) for (let c = 0; c < 4; c++) C[k * 4 + c] /= cnt[k];
  for (let round = 0; round < 6; round++) {
    const next = Float64Array.from(C);
    for (let k = 0; k < N; k++) {
      if (!nb[k].size) continue;
      for (let c = 0; c < 4; c++) { let sum = 0; for (const j of nb[k]) sum += C[j * 4 + c]; next[k * 4 + c] = 0.4 * C[k * 4 + c] + 0.6 * sum / nb[k].size; }
    }
    C.set(next);
  }
  // after smoothing, decide hair or gold cleanly so the edge of the hair is a line, not a blur
  for (let k = 0; k < N; k++) {
    const hair = C[k * 4 + 3] < 0.56, tone = hair ? Math.min(1, C[k * 4 + 2] / 0.45) : Math.max(C[k * 4], C[k * 4 + 1], C[k * 4 + 2]);
    if (hair) { C[k * 4] = 0.07 * tone; C[k * 4 + 1] = 0.11 * tone; C[k * 4 + 2] = 0.45 * tone; C[k * 4 + 3] = 0.12; }
    else { C[k * 4] = C[k * 4 + 1] = C[k * 4 + 2] = Math.min(1, tone); C[k * 4 + 3] = 1; }
  }
}
// drop vertices no triangle uses, and write
const used = new Int32Array(N).fill(-1);
let M = 0;
for (const v of tris) if (used[v] < 0) used[v] = M++;
const oPos = new Float32Array(M * 3), oNrm = new Int8Array(M * 4), oCol = new Uint8Array(M * 4);
const oMin = [Infinity, Infinity, Infinity], oMax = [-Infinity, -Infinity, -Infinity];
for (let k = 0; k < N; k++) {
  const m = used[k];
  if (m < 0) continue;
  const len = Math.hypot(Nn[k * 3], Nn[k * 3 + 1], Nn[k * 3 + 2]) || 1;
  for (let c = 0; c < 3; c++) {
    const v = P[k * 3 + c] / cnt[k];
    oPos[m * 3 + c] = v; if (v < oMin[c]) oMin[c] = v; if (v > oMax[c]) oMax[c] = v;
    oNrm[m * 4 + c] = Math.round(Nn[k * 3 + c] / len * 127);
  }
  for (let c = 0; c < 4; c++) oCol[m * 4 + c] = Math.round(Math.min(1, C[k * 4 + c]) * 255);
}
const Idx = M <= 65535 ? Uint16Array.from(tris, (v) => used[v]) : Uint32Array.from(tris, (v) => used[v]);

const views = [], chunks = [];
let at = 0;
const push = (typed, target) => {
  const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength), pad = (4 - bytes.length % 4) % 4;
  views.push({ buffer: 0, byteOffset: at, byteLength: bytes.length, target });
  chunks.push(bytes, Buffer.alloc(pad)); at += bytes.length + pad;
  return views.length - 1;
};
const out = {
  asset: { version: '2.0', generator: 'simiao tools/optimize-model.mjs' },
  extensionsUsed: ['KHR_mesh_quantization'], extensionsRequired: ['KHR_mesh_quantization'],
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0, mode: 4 }] }],
  materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0.81, 0.42, 1], metallicFactor: 1, roughnessFactor: 0.3 } }],
  accessors: [
    { bufferView: push(oPos, 34962), componentType: 5126, count: M, type: 'VEC3', min: oMin, max: oMax },
    { bufferView: push(oNrm, 34962), componentType: 5120, normalized: true, count: M, type: 'VEC3' },
    { bufferView: push(oCol, 34962), componentType: 5121, normalized: true, count: M, type: 'VEC4' },
    { bufferView: push(Idx, 34963), componentType: Idx instanceof Uint16Array ? 5123 : 5125, count: Idx.length, type: 'SCALAR' },
  ],
  bufferViews: views, buffers: [{ byteLength: at }],
};
views[1].byteStride = 4; // int8 normals are padded to 4 bytes per vertex
let json = Buffer.from(JSON.stringify(out));
json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const body = Buffer.concat(chunks);
const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + json.length + 8 + body.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(body.length, 0); bh.writeUInt32LE(0x004e4942, 4);
fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([head, jh, json, bh, body]));
console.log(`out: ${M.toLocaleString()} vertices, ${(tris.length / 3).toLocaleString()} triangles, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB (grid ${(cell * 1000).toFixed(1)} per 1000 units) → ${OUT}`);
