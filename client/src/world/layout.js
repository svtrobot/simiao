// Where the structural pieces of a procedural hall stand, per architecture (manifest.style).
// Shared by the builder (temple.js / styles.js) and walk collision (collide.js), so what you see
// is what you bump into.

export const ARCH_DEFAULT = 'cn-hall';
export const archOf = (manifest) => manifest.style?.architecture || ARCH_DEFAULT;

/**
 * { front: x[] of the front colonnade, inner: [x, z][] free-standing inside columns,
 *   gatePosts: x offsets of the gate's posts, colH: column height, bays, porch: [x, z][] posts }
 */
export function frameOf(manifest) {
  const h = manifest.hall;
  const arch = archOf(manifest);
  if (arch === 'cn-hall') {
    return { arch, front: [-11.4, -8, -3.9, 3.9, 8, 11.4], inner: [[-8, -18.5], [8, -18.5], [-8, -24.5], [8, -24.5]], gatePosts: [-4.2, -1.6, 1.6, 4.2], colH: 5.8, porch: [] };
  }
  // evenly spaced bays across the hall front (5 bays for a Korean 大雄殿, 3 + side aisles for a 拝殿)
  const bays = arch === 'kr-temple' ? 5 : 5;
  const x0 = h.x0 + 0.6, x1 = h.x1 - 0.6;
  const front = Array.from({ length: bays + 1 }, (_, i) => x0 + (x1 - x0) * i / bays);
  const midZ = (h.z0 + h.z1) / 2;
  const inner = arch === 'kr-temple'
    ? [[front[1], midZ + 2.5], [front[bays - 1], midZ + 2.5], [front[1], h.z0 + 5.5], [front[bays - 1], h.z0 + 5.5]]
    : [[front[1], midZ], [front[bays - 1], midZ]];
  return {
    arch, front, inner, bays,
    gatePosts: arch === 'jp-shrine' ? [-2.6, 2.6] : [-2.3, 2.3],
    colH: arch === 'jp-shrine' ? 4.6 : 5.4,
    // 向拝: the shrine's porch posts stand on the ground either side of the steps
    porch: arch === 'jp-shrine' ? [[-(h.steps.width / 2 + 0.45), h.z1 + 1.6], [h.steps.width / 2 + 0.45, h.z1 + 1.6]] : [],
  };
}
