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
  const add = (x, z, r) => blockers.push({ x, z, r });
  const slot = Object.fromEntries(manifest.slots.map((s) => [s.id, s]));
  for (const s of manifest.slots) {
    if (s.type === 'incense_burner') add(s.x, s.z, (s.radius || 1.4) + 0.2);
    if (s.id.startsWith('lantern')) add(s.x, s.z, 0.6);
    if (s.type === 'bell') add(s.x, s.z, 2.0);
    if (s.type === 'fortune_table') add(s.x, s.z, 0.9);
    if (s.type === 'muyu') add(s.x, s.z, 0.6);
    if (s.type === 'main_altar') { add(s.x, s.z, 2.4); add(s.x - 3, s.z, 1.4); add(s.x + 3, s.z, 1.4); add(s.x, s.z + 2.4, 1.0); add(s.x - 1.2, s.z + 2.4, 0.8); add(s.x + 1.2, s.z + 2.4, 0.8); }
    if (s.type === 'wish_wall') { for (const dz of [-1.6, 0, 1.6]) add(s.x, s.z + dz, 0.5); }
    if (s.type === 'gate') { for (const x of [-4.2, -1.6, 1.6, 4.2]) add(s.x + x, s.z, 0.6); }
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
    return true;
  }

  /** Move from (x,z) by (dx,dz) sliding along obstacles. */
  function slide(x, z, dx, dz) {
    if (walkable(x + dx, z + dz)) return [x + dx, z + dz];
    if (walkable(x + dx, z)) return [x + dx, z];
    if (walkable(x, z + dz)) return [x, z + dz];
    return [x, z];
  }

  return { heightAt, walkable, slide, blockers, inHall };
}
