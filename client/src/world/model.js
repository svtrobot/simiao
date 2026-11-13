// Reads the small .glb files written by tools/optimize-model.mjs: one mesh, one primitive with
// POSITION (float32), NORMAL (int8, normalized, 4-byte stride), COLOR_0 (uint8 ×4, normalized) and
// 16- or 32-bit indices. Not a general glTF loader — that would be a 100 KB download for one statue;
// this is forty lines and knows exactly what our own tool produces (docs/SCENE_PACKAGE.md).
import * as THREE from 'three';

const ARRAYS = { 5120: Int8Array, 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE = { SCALAR: 1, VEC3: 3, VEC4: 4 };

export async function loadSculpt(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const data = await res.arrayBuffer();
  const dv = new DataView(data);
  if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2) throw new Error('not a glTF 2 binary');
  const jsonLen = dv.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 20, jsonLen)));
  const binAt = 20 + jsonLen + 8;
  const prim = gltf.meshes[0].primitives[0];
  const read = (index) => {
    const a = gltf.accessors[index], bv = gltf.bufferViews[a.bufferView], T = ARRAYS[a.componentType], n = SIZE[a.type];
    const at = binAt + (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || T.BYTES_PER_ELEMENT * n;
    if (stride === T.BYTES_PER_ELEMENT * n) return { array: new T(data.slice(at, at + a.count * stride)), n, normalized: !!a.normalized };
    // padded (int8 normals in 4 bytes): copy out the components we need
    const src = new T(data.slice(at, at + a.count * stride)), per = stride / T.BYTES_PER_ELEMENT, out = new T(a.count * n);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) out[i * n + c] = src[i * per + c];
    return { array: out, n, normalized: !!a.normalized };
  };
  const geo = new THREE.BufferGeometry();
  for (const [name, key] of [['position', 'POSITION'], ['normal', 'NORMAL'], ['color', 'COLOR_0']]) {
    if (prim.attributes[key] === undefined) continue;
    const { array, n, normalized } = read(prim.attributes[key]);
    geo.setAttribute(name, new THREE.BufferAttribute(array, n, normalized));
  }
  geo.setIndex(new THREE.BufferAttribute(read(prim.indices).array, 1));
  geo.computeBoundingBox();
  return geo;
}
