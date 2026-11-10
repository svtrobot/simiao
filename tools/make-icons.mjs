// App icons for the home screen and notifications, drawn procedurally (zero dependencies):
// a warm lamp flame over a small lotus, on the night-temple background.
// Usage: node tools/make-icons.mjs  → client/icons/*.png
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'icons');

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w, h, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Signed distances (in icon units 0..1) for the flame and the three lotus petals. */
function flameSD(x, y) {
  const cx = 0.5, cy = 0.5, r = 0.105, tip = 0.22;
  if (y >= cy) return Math.hypot(x - cx, y - cy) - r;
  const k = clamp((y - tip) / (cy - tip));
  const half = r * Math.pow(k, 0.85);
  return Math.max(Math.abs(x - cx) - half, tip - y);
}
function petalSD(x, y, cx, cy, rx, ry, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const dx = (x - cx) * c + (y - cy) * s, dy = -(x - cx) * s + (y - cy) * c;
  return (Math.hypot(dx / rx, dy / ry) - 1) * Math.min(rx, ry);
}
const lotusSD = (x, y) => Math.min(
  petalSD(x, y, 0.5, 0.7, 0.07, 0.13, 0),
  petalSD(x, y, 0.4, 0.72, 0.06, 0.11, -0.75),
  petalSD(x, y, 0.6, 0.72, 0.06, 0.11, 0.75),
  petalSD(x, y, 0.33, 0.76, 0.05, 0.085, -1.25),
  petalSD(x, y, 0.67, 0.76, 0.05, 0.085, 1.25),
);

function draw(size, { badge = false, pad = 0 } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const px = 1 / size;
  const BG_TOP = [38, 30, 24], BG_BOT = [18, 14, 11];
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    // pad > 0 shrinks the drawing toward the centre (maskable safe zone)
    const x = 0.5 + ((i + 0.5) / size - 0.5) / (1 - pad), y = 0.5 + ((j + 0.5) / size - 0.5) / (1 - pad);
    const fl = flameSD(x, y), lo = lotusSD(x, y);
    const fa = 1 - smooth(-px, px, fl), la = 1 - smooth(-px, px, lo);
    let rgb, a;
    if (badge) { // Android status-bar badge: white silhouette on transparent
      a = Math.max(fa, la); rgb = [255, 255, 255];
    } else {
      rgb = mix(BG_TOP, BG_BOT, (j + 0.5) / size);
      const glow = Math.exp(-((x - 0.5) ** 2 + (y - 0.46) ** 2) / 0.045) * 0.75;
      rgb = mix(rgb, [255, 170, 80], glow * 0.6);
      const core = clamp(1 - Math.hypot((x - 0.5) * 1.8, (y - 0.47)) / 0.12);
      rgb = mix(rgb, mix([255, 150, 50], [255, 246, 214], core), fa);
      const shade = clamp((y - 0.6) / 0.25);
      rgb = mix(rgb, mix([236, 196, 110], [176, 132, 58], shade), la);
      a = 1;
    }
    const o = (j * size + i) * 4;
    buf[o] = Math.round(rgb[0]); buf[o + 1] = Math.round(rgb[1]); buf[o + 2] = Math.round(rgb[2]); buf[o + 3] = Math.round(clamp(a) * 255);
  }
  return png(size, size, buf);
}

fs.mkdirSync(OUT, { recursive: true });
const files = {
  'icon-192.png': draw(192), 'icon-512.png': draw(512), 'apple-touch-icon.png': draw(180),
  'maskable-512.png': draw(512, { pad: 0.2 }), 'badge-96.png': draw(96, { badge: true }),
};
for (const [name, data] of Object.entries(files)) { fs.writeFileSync(path.join(OUT, name), data); console.log(name, data.length, 'bytes'); }
