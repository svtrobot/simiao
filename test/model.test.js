import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** What tools/optimize-model.mjs wrote: the JSON chunk and the file size. */
function glb(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.readUInt32LE(0), 0x46546c67, `${file} is a .glb`);
  const jsonLen = b.readUInt32LE(12);
  return { json: JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8')), bytes: b.length, bin: b.subarray(20 + jsonLen + 8) };
}

test('the main hall statue: both tiers exist, carry tone instead of a texture, and stay small', () => {
  const dir = 'scenes/tw-main-hall';
  const manifest = JSON.parse(fs.readFileSync(`${dir}/manifest.json`, 'utf8'));
  assert.ok(manifest.statue.height > 2 && manifest.statue.rev >= 1);
  assert.ok(manifest.statue.source.license, 'where the sculpt came from and under what terms is written down');
  const limits = { high: [100_000, 1.6], med: [45_000, 0.75] };
  let highTris = 0;
  for (const [tier, [maxTris, maxMB]] of Object.entries(limits)) {
    const { json, bytes } = glb(`${dir}/${manifest.statue.gltf[tier]}`);
    const prim = json.meshes[0].primitives[0];
    assert.deepEqual(Object.keys(prim.attributes).sort(), ['COLOR_0', 'NORMAL', 'POSITION']);   // no UVs, no texture
    assert.equal(json.images, undefined);
    const tris = json.accessors[prim.indices].count / 3;
    assert.ok(tris <= maxTris, `${tier}: ${tris} triangles`);
    assert.ok(bytes <= maxMB * 1048576, `${tier}: ${(bytes / 1048576).toFixed(2)} MB`);
    if (tier === 'high') highTris = tris;
  }
  // the scene's declared budget has room for the sculpt on top of the hall itself
  assert.ok(manifest.budget.triangles >= highTris + 120_000);
});

test('optimize-model: merges a dense mesh down to the target and keeps its shape', () => {
  // a dense sphere: 128 × 64 segments = 16,256 triangles, written as a minimal .glb
  const U = 128, Vn = 64, pos = [], nrm = [], idx = [];
  for (let j = 0; j <= Vn; j++) for (let i = 0; i <= U; i++) {
    const th = (j / Vn) * Math.PI, ph = (i / U) * Math.PI * 2, x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph);
    pos.push(x, y, z); nrm.push(x, y, z);
  }
  for (let j = 0; j < Vn; j++) for (let i = 0; i < U; i++) { const a = j * (U + 1) + i, b = a + 1, c = a + U + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const P = Buffer.from(new Float32Array(pos).buffer), N = Buffer.from(new Float32Array(nrm).buffer), I = Buffer.from(new Uint32Array(idx).buffer);
  let json = Buffer.from(JSON.stringify({
    asset: { version: '2.0' }, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3' }, { bufferView: 1, componentType: 5126, count: pos.length / 3, type: 'VEC3' }, { bufferView: 2, componentType: 5125, count: idx.length, type: 'SCALAR' }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: P.length }, { buffer: 0, byteOffset: P.length, byteLength: N.length }, { buffer: 0, byteOffset: P.length + N.length, byteLength: I.length }],
    buffers: [{ byteLength: P.length + N.length + I.length }],
  }));
  json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const body = Buffer.concat([P, N, I]);
  const head = Buffer.alloc(20); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(28 + json.length + body.length, 8); head.writeUInt32LE(json.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(body.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simiao-model-'));
  try {
    const src = path.join(dir, 'in.glb'), out = path.join(dir, 'out.glb');
    fs.writeFileSync(src, Buffer.concat([head, json, bh, body]));
    execFileSync(process.execPath, ['tools/optimize-model.mjs', '--in', src, '--out', out, '--tris', '2000']);
    const o = glb(out), prim = o.json.meshes[0].primitives[0];
    const tris = o.json.accessors[prim.indices].count / 3;
    assert.ok(tris > 1500 && tris < 2500, `${tris} triangles`);
    const acc = o.json.accessors[prim.attributes.POSITION];
    for (let c = 0; c < 3; c++) { assert.ok(acc.max[c] > 0.9 && acc.max[c] <= 1.001); assert.ok(acc.min[c] < -0.9 && acc.min[c] >= -1.001); }   // still a unit sphere
    assert.ok(o.bytes < fs.statSync(src).size / 4);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
