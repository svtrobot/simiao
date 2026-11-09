// Procedural canvas textures: zero downloads for the P0 scene. Real PBR sets
// (KTX2) replace these per scene package later without touching game code.
import * as THREE from 'three';

function canvas(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function rng(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9 >>> 0) / 4294967296); }

function speckle(g, w, h, n, colors, r = [0.5, 1.6], seed = 1) {
  const R = rng(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(R() * colors.length)];
    g.globalAlpha = 0.05 + R() * 0.12;
    const s = r[0] + R() * (r[1] - r[0]);
    g.fillRect(R() * w, R() * h, s, s);
  }
  g.globalAlpha = 1;
}

export function stoneTiles({ base = '#9b958b', seed = 3, tiles = 4 } = {}) {
  return canvas(512, 512, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const R = rng(seed), s = w / tiles;
    for (let y = 0; y < tiles; y++) for (let x = 0; x < tiles; x++) {
      const off = (y % 2) * s * 0.5;
      const v = 0.86 + R() * 0.2;
      g.fillStyle = `rgba(${Math.round(150 * v)},${Math.round(144 * v)},${Math.round(134 * v)},0.55)`;
      g.fillRect(x * s + off + 2, y * s + 2, s - 4, s - 4);
    }
    speckle(g, w, h, 9000, ['#5a554e', '#cfc8bc', '#7b756c'], [0.5, 2], seed);
    g.strokeStyle = 'rgba(40,36,32,0.55)'; g.lineWidth = 3;
    for (let y = 0; y <= tiles; y++) { g.beginPath(); g.moveTo(0, y * s); g.lineTo(w, y * s); g.stroke(); }
    for (let y = 0; y < tiles; y++) for (let x = 0; x <= tiles; x++) {
      const off = (y % 2) * s * 0.5; g.beginPath(); g.moveTo(x * s + off, y * s); g.lineTo(x * s + off, (y + 1) * s); g.stroke();
    }
  });
}

export function woodPlanks({ base = '#6b4a30', seed = 5 } = {}) {
  return canvas(512, 512, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const R = rng(seed), n = 8, s = h / n;
    for (let i = 0; i < n; i++) {
      const v = 0.82 + R() * 0.3;
      g.fillStyle = `rgba(${Math.round(110 * v)},${Math.round(76 * v)},${Math.round(48 * v)},0.6)`;
      g.fillRect(0, i * s + 1, w, s - 2);
      g.strokeStyle = 'rgba(30,18,10,0.18)';
      for (let k = 0; k < 7; k++) {
        g.beginPath(); const y = i * s + R() * s;
        g.moveTo(0, y); for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + k) * 2.5); g.stroke();
      }
      g.fillStyle = 'rgba(20,12,6,0.6)'; g.fillRect(0, i * s, w, 2);
      g.fillRect(R() * w, i * s, 2, s);
    }
  });
}

export function roofTiles({ base = '#3b3a38' } = {}) {
  return canvas(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const cols = 8, s = w / cols;
    for (let i = 0; i < cols; i++) {
      const grd = g.createLinearGradient(i * s, 0, (i + 1) * s, 0);
      grd.addColorStop(0, 'rgba(0,0,0,0.45)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.10)'); grd.addColorStop(1, 'rgba(0,0,0,0.45)');
      g.fillStyle = grd; g.fillRect(i * s, 0, s, h);
    }
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 3);
    speckle(g, w, h, 2500, ['#6b6a66', '#1e1d1c'], [0.5, 1.5], 9);
  });
}

export function lacquer({ base = '#7a2e22' } = {}) {
  return canvas(128, 512, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.08; g.fillStyle = '#000';
    for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
    g.globalAlpha = 1;
    speckle(g, w, h, 1200, ['#3a120c', '#a24a36'], [0.5, 2], 11);
  });
}

export function grass({ base = '#5d6a46', seed = 7 } = {}) {
  return canvas(512, 512, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 30000, ['#46523a', '#76835a', '#6b6d4c', '#3c4532'], [1, 3], seed);
  });
}

export function gravel({ base = '#b3aa9b', seed = 8 } = {}) {
  return canvas(512, 512, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 26000, ['#8f877a', '#d3cbbd', '#7d756a', '#a59c8c'], [1, 3.5], seed);
  });
}

/** 匾额：深色底、金色字、金框。 */
export function plaque(text, { vertical = false } = {}) {
  const w = vertical ? 256 : 1024, h = vertical ? 768 : 320;
  const tex = canvas(w, h, (g) => {
    g.fillStyle = '#1d2433'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c9a24a'; g.lineWidth = 18; g.strokeRect(14, 14, w - 28, h - 28);
    g.lineWidth = 4; g.strokeRect(40, 40, w - 80, h - 80);
    g.fillStyle = '#e2c27a';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const chars = [...text];
    const fs = vertical ? Math.min(200, (h - 120) / chars.length) : Math.min(210, (w - 160) / chars.length);
    g.font = `700 ${fs}px "Noto Serif TC","Songti TC","STSong","PMingLiU",serif`;
    chars.forEach((ch, i) => {
      const x = vertical ? w / 2 : w / 2 + (i - (chars.length - 1) / 2) * fs * 1.08;
      const y = vertical ? h / 2 + (i - (chars.length - 1) / 2) * fs * 1.05 : h / 2 + 6;
      g.fillText(ch, x, y);
    });
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export function softDot(color = '#ffffff') {
  const tex = canvas(64, 64, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, color); grd.addColorStop(0.35, color + 'aa'); grd.addColorStop(1, color + '00');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export function petal(color) {
  const tex = canvas(64, 64, (g) => {
    g.fillStyle = color; g.beginPath(); g.ellipse(32, 32, 14, 24, 0.4, 0, Math.PI * 2); g.fill();
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** Name tag sprite texture (法名 + 阶位徽记). */
export function nameTag(name, sub, { ghost = false } = {}) {
  const w = 512, h = 128;
  const tex = canvas(w, h, (g) => {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '600 46px "Noto Serif TC","Songti TC",serif';
    g.shadowColor = 'rgba(0,0,0,0.85)'; g.shadowBlur = 10;
    g.fillStyle = ghost ? 'rgba(239,231,218,0.55)' : '#f2ead9';
    g.fillText(name, w / 2, 46);
    if (sub) { g.font = '400 30px "Noto Sans TC",sans-serif'; g.fillStyle = ghost ? 'rgba(210,173,94,0.5)' : '#d2ad5e'; g.fillText(sub, w / 2, 98); }
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

const SERIF = '"Noto Serif TC","Songti TC","STSong","PMingLiU",serif';

/** 天花彩畫：方格天花，綠框、藍地、中心金色團蓮。One texel tile = one 1.2 m panel. */
export function ceilingPanels() {
  return canvas(256, 256, (g, w, h) => {
    g.fillStyle = '#1f4a45'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c9a24a'; g.fillRect(10, 10, w - 20, h - 20);
    g.fillStyle = '#21366b'; g.fillRect(18, 18, w - 36, h - 36);
    g.strokeStyle = '#2f7a6e'; g.lineWidth = 6; g.strokeRect(34, 34, w - 68, h - 68);
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.save(); g.translate(cx + Math.cos(a) * 40, cy + Math.sin(a) * 40); g.rotate(a + Math.PI / 2);
      g.fillStyle = i % 2 ? '#e2c27a' : '#c9a24a'; g.beginPath(); g.ellipse(0, 0, 14, 30, 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
    g.fillStyle = '#9e2b20'; g.beginPath(); g.arc(cx, cy, 22, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e2c27a'; g.beginPath(); g.arc(cx, cy, 10, 0, Math.PI * 2); g.fill();
    for (const [x, y] of [[34, 34], [w - 34, 34], [34, h - 34], [w - 34, h - 34]]) { g.fillStyle = '#e2c27a'; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill(); }
  });
}

/** 藻井中心：團龍改為不具象的蓮花寶相紋（避免神像以外的具象圖騰）。 */
export function caissonCenter() {
  const tex = canvas(512, 512, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    g.fillStyle = '#1b2f5e'; g.fillRect(0, 0, w, h);
    for (let ring = 0; ring < 3; ring++) {
      const n = 8 + ring * 8, r = 70 + ring * 70;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + ring * 0.2;
        g.save(); g.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.rotate(a + Math.PI / 2);
        g.fillStyle = ['#e2c27a', '#c9a24a', '#2f7a6e'][ring]; g.beginPath(); g.ellipse(0, 0, 16 + ring * 4, 34 + ring * 8, 0, 0, Math.PI * 2); g.fill(); g.restore();
      }
    }
    g.fillStyle = '#e2c27a'; g.beginPath(); g.arc(cx, cy, 46, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#9e2b20'; g.beginPath(); g.arc(cx, cy, 30, 0, Math.PI * 2); g.fill();
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** 幡：黃地、紅邊、垂直佛號、下端燕尾。Transparent outside the banner shape. */
export function banner(text) {
  const w = 160, h = 960;
  const tex = canvas(w, h, (g) => {
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, h - 60); g.lineTo(w / 2, h - 10); g.lineTo(0, h - 60); g.closePath();
    g.fillStyle = '#d9a83c'; g.fill();
    g.save(); g.clip();
    g.fillStyle = '#9e2b20'; g.fillRect(0, 0, w, 70); g.fillRect(0, 0, 14, h); g.fillRect(w - 14, 0, 14, h);
    g.fillStyle = '#2f7a6e'; g.fillRect(0, 70, w, 10);
    g.restore();
    g.fillStyle = '#5a1f1a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const chars = [...text], fs = Math.min(84, (h - 220) / chars.length);
    g.font = `700 ${fs}px ${SERIF}`;
    chars.forEach((ch, i) => g.fillText(ch, w / 2, 130 + fs / 2 + i * fs * 1.04));
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** 楹聯：紅地金字。 */
export function couplet(text) {
  const w = 160, h = 1024;
  const tex = canvas(w, h, (g) => {
    g.fillStyle = '#7a1e16'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c9a24a'; g.lineWidth = 8; g.strokeRect(10, 10, w - 20, h - 20);
    g.fillStyle = '#e2c27a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const chars = [...text], fs = Math.min(110, (h - 80) / chars.length);
    g.font = `700 ${fs}px ${SERIF}`;
    chars.forEach((ch, i) => g.fillText(ch, w / 2, 40 + fs / 2 + i * (h - 80) / chars.length));
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** 桌圍：紅緞、金邊、正中團蓮。 */
export function altarCloth() {
  const tex = canvas(512, 256, (g, w, h) => {
    g.fillStyle = '#8e2a20'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c9a24a'; g.fillRect(0, 0, w, 26); g.fillRect(0, h - 14, w, 14);
    g.fillStyle = '#2f7a6e'; g.fillRect(0, 26, w, 8);
    for (let x = 8; x < w; x += 24) { g.fillStyle = '#e2c27a'; g.beginPath(); g.moveTo(x, 34); g.lineTo(x + 12, 52); g.lineTo(x + 24, 34); g.fill(); }
    const cx = w / 2, cy = h / 2 + 20;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.save(); g.translate(cx + Math.cos(a) * 34, cy + Math.sin(a) * 34); g.rotate(a + Math.PI / 2);
      g.fillStyle = '#e2c27a'; g.beginPath(); g.ellipse(0, 0, 10, 24, 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
    g.fillStyle = '#c9a24a'; g.beginPath(); g.arc(cx, cy, 16, 0, Math.PI * 2); g.fill();
    speckle(g, w, h, 1500, ['#5a1a12', '#b04a36'], [0.5, 1.5], 21);
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** 背屏 / 壁畫：赭金地、青綠祥雲、淡遠山。 */
export function mural({ seed = 31, scale = 1 } = {}) {
  // drawn in 1024×512 units; `scale` shrinks the canvas for walls seen from far away
  return canvas(1024 * scale, 512 * scale, (g, cw, ch) => {
    g.scale(scale, scale); const w = cw / scale, h = ch / scale;
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#c8a76a'); grd.addColorStop(1, '#a9844c');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    const R = rng(seed);
    // far mountains
    g.fillStyle = 'rgba(70,110,100,0.35)';
    g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += 16) g.lineTo(x, h * 0.62 - Math.abs(Math.sin(x * 0.011 + 1.3)) * 90 - Math.sin(x * 0.037) * 18);
    g.lineTo(w, h); g.fill();
    // auspicious clouds (祥雲): rows of scroll heads
    for (let i = 0; i < 14; i++) {
      const x = R() * w, y = 60 + R() * h * 0.5, s = 18 + R() * 16;
      g.strokeStyle = 'rgba(40,98,90,0.45)'; g.fillStyle = 'rgba(230,214,176,0.28)'; g.lineWidth = 3;
      for (let k = 0; k < 3; k++) {
        g.beginPath(); g.arc(x + k * s * 1.4, y - (k === 1 ? s * 0.5 : 0), s, Math.PI, Math.PI * 2.85); g.fill(); g.stroke();
      }
      g.beginPath(); g.moveTo(x - s, y + 4); g.quadraticCurveTo(x + s * 2, y + s, x + s * 4.4, y + 2); g.stroke();
    }
    speckle(g, w, h, 6000, ['#6b5634', '#e2cfa0'], [0.5, 2], seed);
  });
}

/** 蒲團編織：沿車削 v 方向的同心草繩紋（lathe uv.v 從底到頂）。 */
export function cushionWeave() {
  return canvas(64, 256, (g, w, h) => {
    g.fillStyle = '#9c7440'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) {
      const grd = g.createLinearGradient(0, y, 0, y + 8);
      grd.addColorStop(0, 'rgba(60,40,18,0.55)'); grd.addColorStop(0.5, 'rgba(230,200,140,0.35)'); grd.addColorStop(1, 'rgba(60,40,18,0.55)');
      g.fillStyle = grd; g.fillRect(0, y, w, 8);
    }
    speckle(g, w, h, 800, ['#5a3e1c', '#d8b47a'], [0.5, 1.5], 41);
  });
}
