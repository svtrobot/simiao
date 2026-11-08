// Avatar registry: self, remote pilgrims (interpolated) and 影子同修 (ghosts on empty seats).
import * as THREE from 'three';
import { Nisheng } from './nisheng.js';
import { nameTag } from '../world/textures.js';
import { t } from '../i18n.js';

function tagSprite(name, sub, ghost) {
  const mat = new THREE.SpriteMaterial({ map: nameTag(name, sub, { ghost }), depthWrite: false, transparent: true });
  const s = new THREE.Sprite(mat);
  s.scale.set(1.1, 0.275, 1);
  s.position.y = 1.42;
  s.renderOrder = 10;
  return s;
}

export class Avatars {
  constructor(scene, { quality, heightAt, seats }) {
    this.scene = scene; this.quality = quality; this.heightAt = heightAt;
    this.seats = new Map(seats.map((s) => [s.id, s]));
    this.list = new Map();    // id -> { av, tag, member }
    this.ghosts = new Map();  // seatId -> av
    this.hit = [];            // invisible pick proxies
  }

  _proxy(id) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.2, 8), new THREE.MeshBasicMaterial({ visible: false }));
    m.position.y = 0.6; m.userData.memberId = id;
    return m;
  }

  add(member, { self = false } = {}) {
    if (this.list.has(member.id)) return this.list.get(member.id);
    const av = new Nisheng(member.look, { castShadow: self || this.quality === 'high' });
    const tag = tagSprite(member.name, t(`rank.${member.rank}`), false);
    av.root.add(tag);
    if (!self) { const p = this._proxy(member.id); av.root.add(p); this.hit.push(p); }
    this.scene.add(av.root);
    const entry = { av, tag, member, self };
    this.list.set(member.id, entry);
    if (member.x !== undefined) { av.root.position.set(member.x, this.heightAt(member.x, member.z), member.z); av.root.rotation.y = member.ry; }
    if (member.a) av.setAction(member.a);
    return entry;
  }

  remove(id) {
    const e = this.list.get(id);
    if (!e) return;
    this.hit = this.hit.filter((h) => h.userData.memberId !== id);
    e.tag.material.map.dispose(); e.tag.material.dispose();
    e.av.dispose();
    this.list.delete(id);
  }

  get(id) { return this.list.get(id); }

  relabel(id, member) {
    const e = this.list.get(id); if (!e) return;
    e.tag.material.map.dispose();
    e.tag.material.map = nameTag(member.name, t(`rank.${member.rank}`));
    e.tag.material.needsUpdate = true;
  }

  /** 少于 30 人时用半透明“影子同修”补位，明确标注为此前来过的人，不假装是真人（6.2）。 */
  setShadows(list, occupied) {
    const keep = new Set();
    for (const s of list || []) {
      if (occupied.has(s.seat)) continue;
      const seat = this.seats.get(s.seat); if (!seat) continue;
      keep.add(s.seat);
      if (this.ghosts.has(s.seat)) continue;
      const av = new Nisheng(s.look, { ghost: true });
      av.setAction('sit');
      av.root.position.set(seat.x, this.heightAt(seat.x, seat.z), seat.z);
      av.root.rotation.y = seat.ry ?? Math.PI;
      if (this.ghosts.size === 0) av.root.add(tagSprite(t('shadow'), '', true));
      this.scene.add(av.root);
      this.ghosts.set(s.seat, av);
    }
    for (const [seat, av] of this.ghosts) if (!keep.has(seat)) { av.dispose(); this.ghosts.delete(seat); }
  }

  update(dt, camera, sample) {
    const camPos = camera.position;
    for (const e of this.list.values()) {
      let moving = 0;
      if (!e.self) {
        const p = sample(e.member);
        if (p) {
          const r = e.av.root;
          const dist = Math.hypot(p.x - r.position.x, p.z - r.position.z);
          moving = Math.min(1, dist / (1.4 * dt + 1e-6));
          r.position.set(p.x, this.heightAt(p.x, p.z), p.z);
          let dr = p.ry - r.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
          r.rotation.y += dr * Math.min(1, dt * 8);
        }
        e.av.setAction(e.member.a === 'walk' ? 'idle' : e.member.a);
        // cheap LOD: far pilgrims skip IK detail every other frame and drop shadows
        const far = e.av.root.position.distanceTo(camPos) > 22;
        e.tag.visible = !far;
        if (far && (e.skip = !e.skip)) continue;
      } else {
        moving = e.moving || 0;
      }
      e.av.update(dt, moving);
    }
    for (const g of this.ghosts.values()) g.update(dt, 0);
  }
}
