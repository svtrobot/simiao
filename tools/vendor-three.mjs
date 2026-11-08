// Download the pinned three.js release into client/vendor/three so the client
// is served entirely from your own domain (required for mainland deployment,
// where public CDNs may be unreachable). Without it the server redirects to jsDelivr.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { THREE_VERSION } from '../server/http.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'client', 'vendor', 'three');
const url = `https://registry.npmjs.org/three/-/three-${THREE_VERSION}.tgz`;

console.log(`Downloading three@${THREE_VERSION} …`);
const res = await fetch(url);
if (!res.ok) { console.error(`Download failed: HTTP ${res.status}`); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'three-'));
const tgz = path.join(tmp, 'three.tgz');
fs.writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
execFileSync('tar', ['-xzf', tgz, '-C', tmp]);
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
for (const sub of ['build', path.join('examples', 'jsm')]) {
  fs.cpSync(path.join(tmp, 'package', sub), path.join(dest, sub), { recursive: true });
}
fs.copyFileSync(path.join(tmp, 'package', 'LICENSE'), path.join(dest, 'LICENSE'));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`three.js vendored to ${path.relative(root, dest)}`);
