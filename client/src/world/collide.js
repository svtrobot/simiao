// Walkability for the procedural hall layout: ground height, platform edge, blockers.
// The server only enforces the walk rectangle and speed; finer collision is client-side.
export function createCollision(manifest) {
  const h = manifest.hall;
  const w = manifest.walkArea;
  if (!h) {
    // glTF scene packages: walk rectangle only until a navmesh is provided (P1)
    const walkable = (x, z) => x >= w.minX && x <= w.maxX && z >= w.minZ && z <= w.maxZ;
    return {
      heightAt: () => 0, walkable, blockers: [], inHall: () => false,
      slide: (x, z, dx, dz) => (walkable(x + dx, z + dz) ? [x + dx, z + dz] : [x, z]),
    };
  }
  const steps = h.steps;
  const stepZ0 = h.z1, stepZ1 = h.z1 + 1.8;
  const blockers = [];
  const rects = [];
  const add = (x, z, r) => blockers.push({ x, z, r });
  const slot = Object.fromEntries(manifest.slots.map((s) => [s.id, s]));
  for (const s of manifest.slots) {
    if (s.type === 'incense_burner') add(s.x, s.z, (s.radius || 1.4) + 0.2);
    if (s.id.startsWith('lantern')) add(s.x, s.z, 0.6);
    if (s.type === 'bell') add(s.x, s.z, 2.0);
    if (s.type === 'fortune_table') add(s.x, s.z, 0.9);
    if (s.type === 'muyu') add(s.x, s.z, 0.6);
    if (s.type === 'main_altar') {
      add(s.x, s.z, 2.4); add(s.x - 3, s.z, 1.4); add(s.x + 3, s.z, 1.4);
      // offering table (4.2 m wide), bowl bell and wooden fish at the altar's front corners
      add(s.x, s.z + 2.4, 1.0); add(s.x - 1.5, s.z + 2.4, 0.75); add(s.x + 1.5, s.z + 2.4, 0.75);
      add(s.x - 4.6, s.z + 1.5, 0.5); add(s.x + 4.6, s.z + 1.5, 0.5);
    }
    if (s.type === 'wish_wall') { for (const dz of [-1.6, 0, 1.6]) add(s.x, s.z + dz, 0.5); }
    if (s.type === 'gate') { for (const x of [-4.2, -1.6, 1.6, 4.2]) add(s.x + x, s.z, 0.6); }
    if (s.type === 'tree') add(s.x, s.z, (s.r || 0.6) + 0.2);
    if (s.type === 'lamp_wall') {
      // cabinet footprint (cols × 0.3 m wide, ~0.6 m deep), turned by ry; axis-aligned box around it
      const half = (s.cols || 18) * 0.15 + 0.35, depth = 0.65, ry = s.ry || 0;
      const ax = Math.abs(Math.cos(ry)) * half + Math.abs(Math.sin(ry)) * depth;
      const az = Math.abs(Math.sin(ry)) * half + Math.abs(Math.cos(ry)) * depth;
      rects.push({ x0: s.x - ax, x1: s.x + ax, z0: s.z - az, z1: s.z + az });
    }
    if (s.type === 'pond') rects.push({ x0: s.x - s.w / 2 - 0.25, x1: s.x + s.w / 2 + 0.25, z0: s.z - s.d / 2 - 0.25, z1: s.z + s.d / 2 + 0.25 });
  }
  for (const x of [-11.4, -8, -3.9, 3.9, 8, 11.4]) add(x, h.z1 - 0.7, 0.42);
  for (const x of [-8, 8]) for (const z of [-18.5, -24.5]) add(x, z, 0.42);
  void slot;

  const inHall = (x, z) => x > h.x0 + 0.6 && x < h.x1 - 0.6 && z > h.z0 + 0.8 && z < h.z1;
  const onSteps = (x, z) => Math.abs(x - steps.x) < steps.width / 2 - 0.2 && z >= stepZ0 - 0.01 && z <= stepZ1;
  const onPlatformFootprint = (x, z) => x > h.x0 - 0.3 && x < h.x1 + 0.3 && z > h.z0 - 0.3 && z < h.z1 + 0.3;

  function heightAt(x, z) {
    if (inHall(x, z)) return h.floorY;
    if (onSteps(x, z)) return h.floorY * (1 - (z - stepZ0) / (stepZ1 - stepZ0));
    return 0;
  }

  function walkable(x, z) {
    if (x < w.minX || x > w.maxX || z < w.minZ || z > w.maxZ) return false;
    if (onPlatformFootprint(x, z) && !inHall(x, z) && !onSteps(x, z)) return false; // platform edge / walls
    // crossing between hall and outside only through the steps
    for (const b of blockers) if ((x - b.x) ** 2 + (z - b.z) ** 2 < b.r * b.r) return false;
    for (const r of rects) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return false;
    return true;
  }

  /** Move from (x,z) by (dx,dz) sliding along obstacles. */
  function slide(x, z, dx, dz) {
    if (walkable(x + dx, z + dz)) return [x + dx, z + dz];
    if (walkable(x + dx, z)) return [x + dx, z];
    if (walkable(x, z + dz)) return [x, z + dz];
    return [x, z];
  }

  /**
   * Waypoints for an auto-walk (tap a ritual → walk there). Straight lines get stuck on the
   * hall platform edge and on round obstacles, so: go through the front steps when entering or
   * leaving the hall, and step around any blocker circle a leg would cut through.
   */
  function route(x0, z0, x1, z1) {
    const inside = (x, z) => inHall(x, z);
    const legs = [];
    if (inside(x0, z0) !== inside(x1, z1)) {
      const out = { x: steps.x, z: stepZ1 + 0.7 }, inn = { x: steps.x, z: h.z1 - 0.9 };
      legs.push(...(inside(x0, z0) ? [inn, out] : [out, inn]));
    }
    legs.push({ x: x1, z: z1 });
    const pts = [];
    let px = x0, pz = z0;
    for (const p of legs) {
      for (const b of blockers) {
        // closest point of segment (px,pz)→p to the blocker centre
        const dx = p.x - px, dz = p.z - pz, L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((b.x - px) * dx + (b.z - pz) * dz) / L2));
        const cx = px + dx * t, cz = pz + dz * t;
        const d = Math.hypot(b.x - cx, b.z - cz);
        if (t <= 0.02 || t >= 0.98 || d >= b.r + 0.15) continue;
        // detour on the side the path already leans toward
        const L = Math.sqrt(L2), nx = -dz / L, nz = dx / L;
        const side = ((cx - b.x) * nx + (cz - b.z) * nz) >= 0 ? 1 : -1;
        const w = { x: b.x + nx * side * (b.r + 0.6), z: b.z + nz * side * (b.r + 0.6) };
        if (walkable(w.x, w.z)) { pts.push(w); px = w.x; pz = w.z; }
      }
      pts.push(p); px = p.x; pz = p.z;
    }
    return pts;
  }

  return { heightAt, walkable, slide, route, blockers, rects, inHall };
}
