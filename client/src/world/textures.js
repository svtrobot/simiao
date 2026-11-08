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
