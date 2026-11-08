// 行走与视角：点地面行走（手机友好）、WASD / 方向键、拖曳旋转、滚轮或双指缩放。
import * as THREE from 'three';

const WALK_SPEED = 1.5; // m/s：小步、慢走
const RUN_SPEED = 2.6;  // 走向远处的仪式点

export class Controls {
  constructor({ camera, dom, collision, onTapAvatar, pickables }) {
    Object.assign(this, { camera, dom, collision, onTapAvatar, pickables });
    this.pos = new THREE.Vector3();
    this.ry = Math.PI;
    this.yaw = 0;      // camera orbit around the player (relative to world)
    this.pitch = 0.32;
    this.dist = 4.2;
    this.keys = new Set();
    this.target = null;     // { x, z, ry, run, onArrive }
    this.locked = false;    // seated / in a ritual: no walking
    this.moving = 0;
    this.ray = new THREE.Raycaster();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._bind();
  }

  _bind() {
    const el = this.dom;
    let down = null, pinch = null;
    const pointers = new Map();
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: this.dist }; }
    });
    el.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        this.dist = THREE.MathUtils.clamp(pinch.dist * pinch.d / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), 1.8, 9);
        return;
      }
      if (down) down.moved += Math.abs(dx) + Math.abs(dy);
      this.yaw -= dx * 0.006;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, 0.05, 1.1);
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (down && down.moved < 8 && performance.now() - down.t < 400) this._tap(e.clientX, e.clientY);
      down = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); down = null; pinch = null; });
    el.addEventListener('wheel', (e) => { this.dist = THREE.MathUtils.clamp(this.dist * (1 + Math.sign(e.deltaY) * 0.1), 1.8, 9); e.preventDefault(); }, { passive: false });
    window.addEventListener('keydown', (e) => { if (e.target.closest?.('input,textarea')) return; this.keys.add(e.key.toLowerCase()); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  _tap(cx, cy) {
    const r = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hits = this.ray.intersectObjects(this.pickables(), true);
    if (hits.length) {
      let o = hits[0].object;
      while (o && !o.userData.memberId) o = o.parent;
      if (o) { this.onTapAvatar?.(o.userData.memberId, cx, cy); return; }
    }
    if (this.locked) return;
    // ground: try hall floor height first, then courtyard
    for (const h of [this.collision.heightAt(this.pos.x, this.pos.z), 0.9, 0]) {
      this.ground.constant = -h;
      const p = new THREE.Vector3();
      if (this.ray.ray.intersectPlane(this.ground, p) && Math.abs(this.collision.heightAt(p.x, p.z) - h) < 0.05 && this.collision.walkable(p.x, p.z)) {
        this.goTo({ x: p.x, z: p.z });
        return;
      }
    }
  }

  /** Walk to a point; resolves when arrived (or when interrupted → false). */
  goTo({ x, z, ry, run = false }) {
    if (this.target?.resolve) this.target.resolve(false);
    return new Promise((resolve) => { this.target = { x, z, ry, run, resolve }; });
  }

  place(x, z, ry) { this.pos.set(x, this.collision.heightAt(x, z), z); this.ry = ry; this.yaw = ry + Math.PI; this.target = null; }

  update(dt) {
    let dx = 0, dz = 0;
    const k = this.keys;
    const fwd = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const side = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    let speed = WALK_SPEED;
    if (!this.locked && (fwd || side)) {
      if (this.target?.resolve) { this.target.resolve(false); }
      this.target = null;
      // camera-relative: forward = away from camera
      const f = new THREE.Vector2(-Math.sin(this.yaw), -Math.cos(this.yaw));
      dx = f.x * fwd - f.y * side; dz = f.y * fwd + f.x * side;
      const n = Math.hypot(dx, dz); dx /= n; dz /= n;
    } else if (this.target && !this.locked) {
      const tx = this.target.x - this.pos.x, tz = this.target.z - this.pos.z;
      const d = Math.hypot(tx, tz);
      speed = this.target.run && d > 3 ? RUN_SPEED : WALK_SPEED;
      if (d < 0.08) {
        const tgt = this.target; this.target = null;
        if (tgt.ry !== undefined) this.ry = tgt.ry;
        tgt.resolve?.(true);
      } else { dx = tx / d; dz = tz / d; if (d < speed * dt) speed = d / dt; }
    }
    if (dx || dz) {
      const [nx, nz] = this.collision.slide(this.pos.x, this.pos.z, dx * speed * dt, dz * speed * dt);
      const moved = Math.hypot(nx - this.pos.x, nz - this.pos.z);
      if (moved < 1e-4 && this.target) { const t = this.target; this.target = null; t.resolve?.(false); }
      this.pos.x = nx; this.pos.z = nz;
      const want = Math.atan2(dx, dz);
      let dr = want - this.ry; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
      this.ry += dr * Math.min(1, dt * 8);
      this.moving = Math.min(1, moved / (WALK_SPEED * dt + 1e-6));
    } else {
      this.moving = 0;
    }
    const gy = this.collision.heightAt(this.pos.x, this.pos.z);
    this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 10);
    // camera: gently follow behind when walking
    if (this.moving > 0.2 && !this.keys.size) {
      let dyaw = (this.ry + Math.PI) - this.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      this.yaw += dyaw * Math.min(1, dt * 1.2);
    }
    const head = new THREE.Vector3(this.pos.x, this.pos.y + 1.0, this.pos.z);
    const off = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(this.dist);
    const want = head.clone().add(off);
    // keep the camera under the hall ceiling when inside
    if (this.collision.inHall(this.pos.x, this.pos.z)) want.y = Math.min(want.y, 6.0);
    this.camera.position.lerp(want, Math.min(1, dt * 6));
    this.camera.lookAt(head);
  }
}
