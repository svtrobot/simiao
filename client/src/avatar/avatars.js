// Avatar registry: self, remote pilgrims (interpolated) and 影子同修 (ghosts on empty seats).
// Self is a full Nisheng with its own meshes and shadow. Everyone else is a rig drawn by the
// instanced crowd renderer (crowd.js), and their name tags share one atlas: a full room of 100
// stays within a few dozen draw calls instead of ~1,600.
import * as THREE from 'three';
import { Nisheng } from './nisheng.js';
import { Crowd, TagAtlas, LOD_NEAR } from './crowd.js';
import { nameTag } from '../world/textures.js';
import { t } from '../i18n.js';

const TAG_Y = 1.42;
const TAG_FAR = 22;     // metres: no tag, and IK only every other frame

function tagSprite(name, sub, ghost) {
  const mat = new THREE.SpriteMaterial({ map: nameTag(name, sub, { ghost }), depthWrite: false, transparent: true });
  const s = new THREE.Sprite(mat);
  s.scale.set(1.1, 0.275, 1);
  s.position.y = TAG_Y;
  s.renderOrder = 10;
  return s;
}

const _frustum = new THREE.Frustum(), _pv = new THREE.Matrix4(), _sphere = new THREE.Sphere(new THREE.Vector3(), 0.9), _tag = new THREE.Vector3();

export class Avatars {
  constructor(scene, { quality, heightAt, seats }) {
    this.scene = scene; this.quality = quality; this.heightAt = heightAt;
    this.seats = new Map(seats.map((s) => [s.id, s]));
    this.list = new Map();    // id -> { av, tag (self sprite) | cell (atlas), member, self }
    this.ghosts = new Map();  // seatId -> av
    this.ghostCell = -1;      // the one 影子同修 label
    this.hit = [];            // invisible pick proxies
    this.crowd = new Crowd(scene, { shadows: quality === 'high' });
    this.tags = new TagAtlas(scene);
  }

  _proxy(id) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.2, 8), new THREE.MeshBasicMaterial({ visible: false }));
    m.position.y = 0.6; m.userData.memberId = id;
    return m;
  }

  add(member, { self = false } = {}) {
    if (this.list.has(member.id)) return this.list.get(member.id);
    const av = new Nisheng(member.look, { castShadow: self, crowd: !self });
    const entry = { av, member, self, cell: -1, tag: null };
    if (self) { entry.tag = tagSprite(member.name, t(`rank.${member.rank}`), false); av.root.add(entry.tag); }
    else {
      entry.cell = this.tags.alloc(member.name, t(`rank.${member.rank}`));
      const p = this._proxy(member.id); av.root.add(p); this.hit.push(p);
    }
    this.scene.add(av.root);
    this.list.set(member.id, entry);
    if (member.x !== undefined) { av.root.position.set(member.x, this.heightAt(member.x, member.z), member.z); av.root.rotation.y = member.ry; }
    if (member.a) av.setAction(member.a);
    return entry;
  }

  remove(id) {
    const e = this.list.get(id);
    if (!e) return;
    this.hit = this.hit.filter((h) => h.userData.memberId !== id);
    if (e.tag) { e.tag.material.map.dispose(); e.tag.material.dispose(); }
    this.tags.release(e.cell);
    e.av.dispose();
    this.list.delete(id);
  }

  get(id) { return this.list.get(id); }

  relabel(id, member) {
    const e = this.list.get(id); if (!e) return;
    if (e.tag) {
      e.tag.material.map.dispose();
      e.tag.material.map = nameTag(member.name, t(`rank.${member.rank}`));
      e.tag.material.needsUpdate = true;
    } else if (e.cell >= 0) this.tags.draw(e.cell, member.name, t(`rank.${member.rank}`));
  }

  /** 少于 30 人时用半透明“影子同修”补位，明确标注为此前来过的人，不假装是真人（6.2）。 */
  setShadows(list, occupied) {
    const keep = new Set();
    for (const s of list || []) {
      if (occupied.has(s.seat)) continue;
      const seat = this.seats.get(s.seat); if (!seat) continue;
      keep.add(s.seat);
      if (this.ghosts.has(s.seat)) continue;
      const av = new Nisheng(s.look, { ghost: true, crowd: true });
      av.setAction('sit');
      av.root.position.set(seat.x, this.heightAt(seat.x, seat.z), seat.z);
      av.root.rotation.y = seat.ry ?? Math.PI;
      this.scene.add(av.root);
      this.ghosts.set(s.seat, av);
    }
    for (const [seat, av] of this.ghosts) if (!keep.has(seat)) { av.dispose(); this.ghosts.delete(seat); }
    // one label for the whole group of 影子同修, over the first of them
    if (this.ghosts.size && this.ghostCell < 0) this.ghostCell = this.tags.alloc(t('shadow'), '', { ghost: true });
    if (!this.ghosts.size && this.ghostCell >= 0) { this.tags.release(this.ghostCell); this.ghostCell = -1; }
  }

  update(dt, camera, sample) {
    const camPos = camera.position;
    camera.updateMatrixWorld();
    _frustum.setFromProjectionMatrix(_pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const inView = (root) => { _sphere.center.copy(root.position); _sphere.center.y += 0.6; return _frustum.intersectsSphere(_sphere); };
    this.crowd.begin(); this.tags.begin();

    for (const e of this.list.values()) {
      if (e.self) { e.av.update(dt, e.moving || 0); continue; }
      let moving = 0;
      const p = sample(e.member);
      const r = e.av.root;
      if (p) {
        const dist = Math.hypot(p.x - r.position.x, p.z - r.position.z);
        moving = Math.min(1, dist / (1.4 * dt + 1e-6));
        r.position.set(p.x, this.heightAt(p.x, p.z), p.z);
        let dr = p.ry - r.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
        r.rotation.y += dr * Math.min(1, dt * 8);
      }
      e.av.setAction(e.member.a === 'walk' ? 'idle' : e.member.a);
      const d = r.position.distanceTo(camPos);
      const visible = inView(r);
      // cheap LOD: far pilgrims skip IK detail every other frame; off-screen ones only every fourth
      const far = d > TAG_FAR;
      e.skip = (e.skip || 0) + 1;
      e.acc = (e.acc || 0) + dt;
      if ((!far && visible) || e.skip % (visible ? 2 : 4) === 0) { e.av.update(Math.min(e.acc, 0.1), moving); e.acc = 0; }
      if (!visible) continue;
      this.crowd.add(e.av, d < LOD_NEAR ? 0 : 1);
      if (!far) this.tags.add(e.cell, _tag.copy(r.position).setY(r.position.y + TAG_Y));
    }
    let first = true;
    for (const g of this.ghosts.values()) {
      g.update(dt, 0);
      if (!inView(g.root)) { first = false; continue; }
      this.crowd.add(g, g.root.position.distanceTo(camPos) < LOD_NEAR ? 0 : 1);
      if (first && this.ghostCell >= 0) this.tags.add(this.ghostCell, _tag.copy(g.root.position).setY(g.root.position.y + TAG_Y));
      first = false;
    }
    this.crowd.end(); this.tags.end();
  }
}
