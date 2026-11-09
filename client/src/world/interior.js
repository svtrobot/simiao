// 大殿內部陳設：天花與藻井、供桌與供品、拜墊、幡、宮燈、楹聯、背屏與壁畫。
// 靜態幾何按材質併入 Batch；帶貼圖或需要動態發光的物件單獨返回。
import * as THREE from 'three';
import * as TX from './textures.js';

const lathe = (pts, segs = 24) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);

/** Plane whose UVs are in metres / tile, so one repeating material can cover pieces of any size. */
function tiledShape(shape, tile) {
  const g = new THREE.ShapeGeometry(shape);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / tile, p.getY(i) / tile);
  return g;
}

export function interiorMaterials() {
  const ceil = TX.ceilingPanels(); ceil.repeat.set(1, 1);
  return {
    // tinted down: old painted ceilings are smoky, and the images must stay the brightest thing
    ceiling: new THREE.MeshStandardMaterial({ map: ceil, color: '#8f8a80', roughness: 0.85, side: THREE.DoubleSide }),
    caisson: new THREE.MeshStandardMaterial({ color: '#1f4a45', roughness: 0.7, side: THREE.DoubleSide }),
    brass: new THREE.MeshStandardMaterial({ color: '#b08a45', metalness: 0.85, roughness: 0.35 }),
    candle: new THREE.MeshStandardMaterial({ color: '#b3261c', roughness: 0.55 }),
    fruitOrange: new THREE.MeshStandardMaterial({ color: '#e0812b', roughness: 0.55 }),
    fruitApple: new THREE.MeshStandardMaterial({ color: '#b5302a', roughness: 0.45 }),
    stem: new THREE.MeshStandardMaterial({ color: '#4f6b34', roughness: 0.8, side: THREE.DoubleSide }),
    lotusPink: new THREE.MeshStandardMaterial({ color: '#e7a7b4', roughness: 0.6, side: THREE.DoubleSide }),
    cushion: new THREE.MeshStandardMaterial({ color: '#c7972f', roughness: 0.9 }),
    cushionRim: new THREE.MeshStandardMaterial({ color: '#8e2a20', roughness: 0.9 }),
    water: new THREE.MeshStandardMaterial({ color: '#cfe0dc', roughness: 0.05, metalness: 0.1 }),
    tassel: new THREE.MeshStandardMaterial({ color: '#a8231a', roughness: 0.9 }),
  };
}

/**
 * Adds the hall interior to the Batch. Returns { extras: Mesh[], flames: Mesh[], lanternMat }.
 * ctx: { hall, floorY, colTop, frontZ, altar }
 */
export function addInterior(B, M, ctx) {
  const { hall, floorY, colTop, frontZ, altar } = ctx;
  const extras = [], flames = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: '#ffd28a' });
  const flame = (x, y, z, s = 1) => { const f = new THREE.Mesh(new THREE.SphereGeometry(0.035 * s, 8, 6), flameMat); f.scale.set(1, 2.2, 1); f.position.set(x, y, z); flames.push(f); extras.push(f); };

  // ---- ceiling (天花) with an octagonal opening for the 藻井 above the worship area
  const ceilY = colTop + 0.79;
  const cx = altar ? altar.x : 0, cz = altar ? altar.z + 6.5 : (hall.z0 + hall.z1) / 2;
  const outer = new THREE.Shape();
  outer.moveTo(hall.x0 + 0.2, hall.z0 + 0.2); outer.lineTo(hall.x1 - 0.2, hall.z0 + 0.2); outer.lineTo(hall.x1 - 0.2, hall.z1 + 0.2); outer.lineTo(hall.x0 + 0.2, hall.z1 + 0.2); outer.closePath();
  const hole = new THREE.Path(); const OR = 2.4;
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; const fn = i ? 'lineTo' : 'moveTo'; hole[fn](cx + Math.cos(a) * OR, cz + Math.sin(a) * OR); }
  outer.holes.push(hole);
  const ceil = tiledShape(outer, 1.2); ceil.rotateX(Math.PI / 2); // shape y → world z, facing down
  B.add('ceiling', ceil, M(0, ceilY, 0));
  // stepped octagonal 藻井: three tiers rising, gold rims, painted centre disc
  let r = OR, y = ceilY;
  for (const [h, nr] of [[0.28, 1.9], [0.26, 1.4], [0.24, 0.95]]) {
    const wall = new THREE.CylinderGeometry(r, r, h, 8, 1, true); wall.rotateY(Math.PI / 8);
    B.add('caisson', wall, M(cx, y + h / 2, cz));
    B.add('gold', new THREE.TorusGeometry(r, 0.035, 4, 8).rotateX(Math.PI / 2).rotateY(Math.PI / 8), M(cx, y, cz));
    const step = new THREE.RingGeometry(nr, r, 8, 1); step.rotateZ(Math.PI / 8); step.rotateX(Math.PI / 2);
    B.add('ceiling', step, M(cx, y + h, cz));
    y += h; r = nr;
  }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 32), new THREE.MeshStandardMaterial({ map: TX.caissonCenter(), roughness: 0.6, side: THREE.DoubleSide }));
  disc.rotation.x = Math.PI / 2; disc.position.set(cx, y - 0.005, cz); extras.push(disc);

  if (altar) {
    const ax = altar.x, az = altar.z, top = floorY + 1.25;
    // ---- offering table (供桌) with embroidered front cloth (桌圍)
    const tz = az + 2.4, tw = 4.2, td = 1.0, th = 1.0;
    B.add('lacquer', new THREE.BoxGeometry(1, 1, 1), M(ax, floorY + th / 2, tz, 0, 0, 0, tw, th, td));
    B.add('gold', new THREE.BoxGeometry(1, 1, 1), M(ax, floorY + th + 0.015, tz, 0, 0, 0, tw + 0.08, 0.03, td + 0.08));
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(tw - 0.1, th - 0.12), new THREE.MeshStandardMaterial({ map: TX.altarCloth(), roughness: 0.85 }));
    cloth.position.set(ax, floorY + (th - 0.12) / 2 + 0.06, tz + td / 2 + 0.012); extras.push(cloth);
    const ty = floorY + th + 0.03;
    // 三足鼎爐 at the centre, with three lit sticks
    B.add('bronze', lathe([[0, 0], [0.16, 0.0], [0.24, 0.06], [0.27, 0.16], [0.25, 0.24], [0.27, 0.26], [0.25, 0.28], [0, 0.27]], 24), M(ax, ty + 0.12, tz - 0.1));
    for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3 + Math.PI / 2; B.add('bronze', new THREE.CylinderGeometry(0.02, 0.03, 0.14, 6), M(ax + Math.cos(a) * 0.16, ty + 0.07, tz - 0.1 + Math.sin(a) * 0.16)); }
    for (const s of [-1, 1]) B.add('bronze', new THREE.TorusGeometry(0.06, 0.015, 6, 12, Math.PI), M(ax + s * 0.2, ty + 0.4, tz - 0.1, 0, Math.PI / 2, 0));
    for (let k = -1; k <= 1; k++) {
      B.add('candle', new THREE.CylinderGeometry(0.006, 0.006, 0.36, 4), M(ax + k * 0.04, ty + 0.56, tz - 0.1));
      flame(ax + k * 0.04, ty + 0.745, tz - 0.1, 0.35);
    }
    // candlesticks
    for (const s of [-1, 1]) {
      const x = ax + s * 1.55;
      B.add('brass', lathe([[0, 0], [0.13, 0], [0.13, 0.03], [0.05, 0.08], [0.04, 0.32], [0.1, 0.36], [0.1, 0.38], [0, 0.38]], 18), M(x, ty, tz - 0.05));
      B.add('candle', new THREE.CylinderGeometry(0.045, 0.045, 0.32, 14), M(x, ty + 0.54, tz - 0.05));
      flame(x, ty + 0.74, tz - 0.05, 1.2);
    }
    // vases with lotus
    for (const s of [-1, 1]) {
      const x = ax + s * 1.0;
      B.add('bronze', lathe([[0, 0], [0.08, 0], [0.12, 0.08], [0.12, 0.18], [0.06, 0.3], [0.05, 0.36], [0.08, 0.42], [0, 0.4]], 18), M(x, ty, tz - 0.2));
      for (let k = 0; k < 3; k++) {
        const lean = (k - 1) * 0.25, hgt = 0.45 + (k === 1 ? 0.18 : 0);
        B.add('stem', new THREE.CylinderGeometry(0.008, 0.008, hgt, 4), M(x + Math.sin(lean) * hgt / 2, ty + 0.4 + hgt / 2, tz - 0.2, 0, 0, -lean));
        const fx = x + Math.sin(lean) * hgt, fy = ty + 0.4 + Math.cos(lean) * hgt;
        if (k === 1) {
          for (let p = 0; p < 8; p++) B.add('lotusPink', new THREE.SphereGeometry(1, 8, 6, 0, Math.PI), M(fx, fy + 0.02, tz - 0.2, -0.5, (p / 8) * Math.PI * 2, 0, 0.03, 0.07, 0.015));
          B.add('gold', new THREE.SphereGeometry(0.02, 8, 6), M(fx, fy + 0.04, tz - 0.2));
        } else {
          B.add('stem', new THREE.CircleGeometry(0.12, 14), M(fx, fy, tz - 0.2, -Math.PI / 2 + lean, 0, 0));
        }
      }
    }
    // fruit plates
    for (const s of [-1, 1]) {
      const x = ax + s * 0.52, key = s < 0 ? 'fruitOrange' : 'fruitApple';
      B.add('gold', new THREE.CylinderGeometry(0.16, 0.1, 0.06, 20), M(x, ty + 0.03, tz + 0.15));
      const fr = new THREE.SphereGeometry(0.055, 14, 10);
      for (const [dx, dz, dy] of [[-0.06, -0.04, 0], [0.06, -0.04, 0], [0, 0.06, 0], [0, 0, 0.08]]) B.add(key, fr, M(x + dx, ty + 0.11 + dy, tz + 0.15 + dz));
    }
    // seven water offering cups along the back edge
    for (let k = 0; k < 7; k++) {
      const x = ax + (k - 3) * 0.26;
      B.add('brass', lathe([[0, 0], [0.04, 0], [0.025, 0.03], [0.05, 0.07], [0.055, 0.1], [0, 0.09]], 12), M(x, ty, tz - 0.38));
      B.add('water', new THREE.CircleGeometry(0.048, 12), M(x, ty + 0.095, tz - 0.38, -Math.PI / 2));
    }
    // 磬 (bowl bell) at the altar's right front corner, 木魚 at the left (blockers in collide.js)
    const [mx, mz] = [4.6, az + 1.5];
    B.add('lacquer', new THREE.BoxGeometry(0.55, 0.5, 0.55), M(ax + mx, floorY + 0.25, mz));
    B.add('cushionRim', new THREE.CylinderGeometry(0.22, 0.24, 0.08, 16), M(ax + mx, floorY + 0.54, mz));
    B.add('bronze', lathe([[0, 0], [0.08, 0], [0.18, 0.06], [0.22, 0.17], [0.21, 0.21], [0.19, 0.19], [0.16, 0.08], [0, 0.04]], 24), M(ax + mx, floorY + 0.58, mz));
    B.add('lacquer', new THREE.BoxGeometry(0.55, 0.4, 0.55), M(ax - mx, floorY + 0.2, mz));
    B.add('cushionRim', new THREE.CylinderGeometry(0.22, 0.24, 0.06, 16), M(ax - mx, floorY + 0.43, mz));
    B.add('wood', new THREE.SphereGeometry(1, 16, 12), M(ax - mx, floorY + 0.6, mz, 0, 0, 0, 0.24, 0.17, 0.2));
    // 長明燈 on the main altar, both sides of the throne
    for (const s of [-1, 1]) {
      const x = ax + s * 2.1, z = az + 1.1;
      B.add('brass', lathe([[0, 0], [0.12, 0], [0.12, 0.03], [0.04, 0.06], [0.03, 0.3], [0.1, 0.34], [0.12, 0.4], [0, 0.38]], 16), M(x, top, z));
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.16, 14, 1, true), new THREE.MeshStandardMaterial({ color: '#ffe2a8', emissive: '#ffb860', emissiveIntensity: 0.9, transparent: true, opacity: 0.65, side: THREE.DoubleSide }));
      glass.position.set(x, top + 0.48, z); extras.push(glass);
      flame(x, top + 0.46, z, 0.8);
    }
    // ---- 背屏 (painted screen) behind the images; murals on the side walls
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(11, 4.7), new THREE.MeshStandardMaterial({ map: TX.mural({ seed: 31 }), roughness: 0.9 }));
    screen.position.set(ax, top + 2.35, hall.z0 + 0.52); extras.push(screen);
    const sideMural = new THREE.MeshStandardMaterial({ map: TX.mural({ seed: 47, scale: 0.5 }), roughness: 0.9 });
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(12, 3.4), sideMural);
      m.position.set(s * (hall.x1 - 0.42), floorY + 2.6, (hall.z0 + hall.z1) / 2 - 1.5); m.rotation.y = -s * Math.PI / 2; extras.push(m);
    }
  }

  // ---- 幡: long banners hanging from the ceiling along the aisle
  const bannerTex = TX.banner('南無本師釋迦牟尼佛');
  const bannerMat = new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.85, side: THREE.DoubleSide, alphaTest: 0.5 });
  for (const z of [-17.5, -23.5]) for (const s of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 3.3), bannerMat);
    b.position.set(s * 5.6, ceilY - 1.65 - 0.05, z); b.rotation.y = s * 0.15; extras.push(b);
    B.add('gold', new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6), M(s * 5.6, ceilY - 0.06, z, 0, 0, Math.PI / 2));
  }

  // ---- 宮燈: hexagonal palace lanterns
  const lanternMat = new THREE.MeshStandardMaterial({ color: '#8e1f14', emissive: '#ff6a2a', emissiveIntensity: 0.3, roughness: 0.6, side: THREE.DoubleSide });
  for (const z of [-15.2, -20.5]) for (const s of [-1, 1]) {
    const x = s * 3.2, y = ceilY - 1.6;
    B.add('gold', new THREE.CylinderGeometry(0.008, 0.008, 1.05, 4), M(x, ceilY - 0.52, z));
    B.add('gold', new THREE.CylinderGeometry(0.34, 0.3, 0.08, 6), M(x, y + 0.36, z));
    B.add('gold', new THREE.CylinderGeometry(0.3, 0.34, 0.08, 6), M(x, y - 0.36, z));
    const silk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.64, 6, 1, true), lanternMat);
    silk.position.set(x, y, z); extras.push(silk);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; B.add('gold', new THREE.CylinderGeometry(0.012, 0.012, 0.66, 4), M(x + Math.cos(a) * 0.31, y, z + Math.sin(a) * 0.31)); }
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + 0.5; B.add('tassel', new THREE.CylinderGeometry(0.015, 0.005, 0.32, 4), M(x + Math.cos(a) * 0.33, y - 0.56, z + Math.sin(a) * 0.33)); }
  }

  // ---- 楹聯 on the two central front columns (上聯在右：面向大殿時的右手 = +x)
  const pairs = [[3.9, '慈雲廣被千山靜'], [-3.9, '法雨長滋萬物新']];
  for (const [x, text] of pairs) {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 3.6), new THREE.MeshStandardMaterial({ map: TX.couplet(text), roughness: 0.6 }));
    c.position.set(x, floorY + 3.2, frontZ + 0.32); extras.push(c);
  }

  return { extras, flames, lanternMat };
}
