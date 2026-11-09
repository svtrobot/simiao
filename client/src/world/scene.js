// Game assembly: renderer + scene package + avatars + network + rituals + render loop.
import * as THREE from 'three';
import { detectQuality, createRenderer, createEnvironment, season as seasonOf } from './env.js';
import { buildTemple } from './temple.js';
import { createCollision } from './collide.js';
import { Smoke, SeasonDrift } from './fx.js';
import { Avatars } from '../avatar/avatars.js';
import { RoomClient } from '../net.js';
import { createRituals } from '../rituals.js';
import { t, localName } from '../i18n.js';
import * as audio from '../audio.js';
import { toast, updateMe, setPresence } from '../ui.js';

/**
 * Scene packages (6.5): procedural builders for the bundled scenes, glTF for
 * uploaded ones. A Gaussian-splat background layer plugs in at the same place.
 */
async function loadPackage(scene, manifest, opts) {
  const builder = manifest.render.builder;
  if (builder === 'procedural:cn-hall-v1') return buildTemple(manifest, opts);
  const group = new THREE.Group();
  if (manifest.render.gltf) {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(`/scenes/${manifest.id}/${manifest.render.gltf}`);
    gltf.scene.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    group.add(gltf.scene);
  }
  // manifest.render.splat → P1: Gaussian-splat layer (far background), mixed with the glTF near field.
  return { group, anchors: {}, plantIncense() {}, setTablets() {}, setLamps: () => new Map(), update() {}, floorY: 0 };
}

export async function createGame({ canvas, info, session, mood, slug }) {
  const manifest = info.scene;
  const quality = detectQuality();
  const renderer = createRenderer(canvas, quality);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 900);
  const env = createEnvironment(scene, renderer, quality, manifest);
  const season = seasonOf();
  const temple = await loadPackage(scene, manifest, { quality, season, plaqueText: info.temple.plaque, mode: info.mode });
  scene.add(temple.group);
  const collision = createCollision(manifest);
  const smoke = new Smoke(scene);
  const drift = new SeasonDrift(scene, season, quality);
  const avatars = new Avatars(scene, { quality, heightAt: collision.heightAt, seats: manifest.seats || [] });

  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize); resize();

  const net = new RoomClient(slug);
  net.setSeats(manifest.seats || []);
  let me = session.user;
  let selfEntry = null;
  let greetTarget = null;
  let stats = info.stats;
  const showStats = (st) => { stats = { ...stats, ...st }; setPresence(stats); };

  const controls = new (await import('../controls.js')).Controls({
    camera, dom: canvas, collision,
    pickables: () => avatars.hit,
    onTapAvatar: (id, x, y) => openGreet(id, x, y),
  });
  const sp = manifest.spawn;
  controls.place(sp.x, sp.z, sp.ry ?? Math.PI);

  const game = {
    controls, net, temple, slug, anchors: temple.anchors, templeName: localName(info.temple.name),
    self: () => selfEntry?.av,
    me: () => me,
    setMe(u) { me = { ...me, ...u }; updateMe(me); },
    freeSeat() {
      const taken = new Set([...net.members.values()].map((m) => m.seat).filter(Boolean));
      const seats = manifest.seats || [];
      // fill from the front, centre first
      return seats.filter((s) => !taken.has(s.id))
        .sort((a, b) => (a.row - b.row) || (Math.abs(a.x) - Math.abs(b.x)))[0] || null;
    },
  };
  game.rituals = createRituals(game);

  // ---- greeting menu (预设致意，不做文字聊天) ----
  const menu = document.getElementById('greet-menu');
  function openGreet(id, x, y) {
    const e = avatars.get(id); if (!e) return;
    greetTarget = id;
    document.getElementById('greet-name').textContent = e.member.name;
    menu.hidden = false;
    menu.style.left = `${Math.min(x, window.innerWidth - 160)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 220)}px`;
  }
  menu.addEventListener('click', (ev) => {
    const k = ev.target.closest('[data-greet]')?.dataset.greet;
    if (!k || !greetTarget) return;
    net.send({ t: 'greet', to: greetTarget, k });
    faceTowards(greetTarget);
    game.rituals.gassho();
    menu.hidden = true;
  });
  window.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });

  function faceTowards(id) {
    const e = avatars.get(id); if (!e || controls.locked) return;
    const p = e.av.root.position;
    controls.ry = Math.atan2(p.x - controls.pos.x, p.z - controls.pos.z);
  }

  // ---- network events ----
  net.addEventListener('welcome', ({ detail }) => {
    me = detail.you;
    if (!selfEntry) {
      selfEntry = avatars.add({ ...detail.self, look: me.look, name: me.name, rank: me.rank }, { self: true });
      // 心情表现在身体上：焦虑时肩膀微耸、呼吸稍快（随着静坐慢慢放下）
      if (mood === 'anxious') selfEntry.av.upperPivot.scale.y = 1.02;
    }
    if (detail.self) controls.place(detail.self.x, detail.self.z, detail.self.ry);
    for (const m of net.members.values()) avatars.add(m);
    avatars.setShadows(detail.shadows, occupiedSeats());
    showStats(detail.stats);
    game.rituals.refreshWall();
    game.rituals.refreshLamps();
  });
  net.addEventListener('join', ({ detail }) => avatars.add(detail));
  net.addEventListener('leave', ({ detail }) => avatars.remove(detail.id));
  net.addEventListener('stats', ({ detail }) => {
    // someone lit (or a lamp went out): redraw the lamp wall
    if (detail.lamps !== undefined && detail.lamps !== stats?.lamps) game.rituals.refreshLamps();
    showStats(detail); avatars.setShadows(detail.shadows, occupiedSeats());
  });
  net.addEventListener('fix', ({ detail }) => { controls.pos.x = detail.x; controls.pos.z = detail.z; });
  net.addEventListener('disconnected', () => toast(t('err.net')));
  net.addEventListener('merit', ({ detail }) => {
    me = { ...me, merit: detail.merit, minutes: detail.minutes, rank: detail.rank, look: detail.look || me.look };
    updateMe(me);
    if (detail.look) { selfEntry?.av.setLook(detail.look); avatars.relabel(me.id, me); toast(t('rank.up', t(`rank.${detail.rank}`)), { gold: true }); }
    if (['incense', 'bow', 'meditate', 'greet'].includes(detail.action)) toast(t('merit.gain', detail.gained));
  });
  net.addEventListener('error', ({ detail }) => {
    if (detail.code === 'incense_daily_limit') toast(t('incense.limit'));
    else if (detail.code === 'seat_taken') toast(t('sit.full'));
  });
  net.addEventListener('event', ({ detail: e }) => {
    if (e.k === 'incense') {
      temple.plantIncense(smoke);
      showStats({ incense: (stats?.incense || 0) + 3 }); // 香火旺：立即可见
      if (e.id === me.id) { toast(t('incense.done'), { gold: true }); audio.bell(0.2); }
    } else if (e.k === 'greet') {
      const from = avatars.get(e.from);
      if (from && !from.self) { from.av.setAction('greet'); setTimeout(() => from.av.setAction(from.member.a || 'idle'), 1800); }
      if (e.to === me.id && from) {
        toast(t('greet.recv', from.member.name, e.kind));
        // 回礼：先转头看向对方，再自动回一个问讯
        if (!game.rituals.sitting) { faceTowards(e.from); setTimeout(() => game.rituals.bow(), 600); }
      }
    } else if (e.k === 'bow') {
      const a = avatars.get(e.id); if (a && !a.self) a.av.pulse(0.6);
    } else if (e.k === 'look') {
      const a = avatars.get(e.id); if (a) { a.member.look = e.look; a.member.rank = e.rank; a.av.setLook(e.look); avatars.relabel(e.id, a.member); }
    }
  });
  function occupiedSeats() { return new Set([...net.members.values()].map((m) => m.seat).filter(Boolean)); }
  net.connect();

  // ---- loop ----
  const clock = new THREE.Clock();
  let lastSent = { x: 0, z: 0, ry: 0 };
  let envTimer = 0;
  function frame() {
    const dt = Math.min(0.05, clock.getDelta());
    const tt = clock.elapsedTime;
    controls.update(dt);
    if (selfEntry) {
      const r = selfEntry.av.root;
      r.position.copy(controls.pos);
      r.rotation.y = controls.ry;
      selfEntry.moving = controls.moving;
      if (!game.rituals.sitting && (Math.abs(lastSent.x - controls.pos.x) > 0.02 || Math.abs(lastSent.z - controls.pos.z) > 0.02 || Math.abs(lastSent.ry - controls.ry) > 0.05)) {
        net.move(controls.pos.x, controls.pos.z, controls.ry);
        lastSent = { x: controls.pos.x, z: controls.pos.z, ry: controls.ry };
      }
    }
    net.flush();
    avatars.update(dt, camera, (m) => net.sample(m));
    temple.update(tt, env.state);
    smoke.update(dt, tt);
    drift.update(dt, tt, env.state.night);
    if ((envTimer += dt) > 60) { envTimer = 0; env.update(); }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  game.debug = { renderer, scene, camera, avatars, env };
  window.__simiao = game;
  return game;
}
