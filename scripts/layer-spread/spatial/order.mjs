// Camera-dependent, plane-local counterpart of the flat spread's mask policy.
// Every pair has a source-cell witness. No order is invented between planes,
// unrelated faces, or transitively through a face absent from the pixel.
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);

export function prepareOrder(source) {
  return source.map((plane) => {
    const peers = new Map();
    plane.faces.forEach((face, i) => {
      const group = plane.groups[i];
      if (!peers.has(group)) peers.set(group, []);
      peers.get(group).push(face);
    });
    const groupOf = new Map(
      plane.faces.map((face, i) => [face, plane.groups[i]])
    );
    const above = new Map(plane.faces.map((face) => [face, new Set()]));
    const below = new Map(plane.faces.map((face) => [face, new Set()]));
    for (const [lower, upper] of plane.orders) {
      if (groupOf.get(lower) === groupOf.get(upper)) continue;
      for (const lo of peers.get(groupOf.get(lower)))
        for (const hi of peers.get(groupOf.get(upper))) {
          above.get(lo).add(hi);
          below.get(hi).add(lo);
        }
    }
    const degree = new Map(
      plane.faces.map((face) => [face, below.get(face).size])
    );
    const queue = plane.faces.filter((face) => degree.get(face) === 0);
    for (let i = 0; i < queue.length; i++)
      for (const next of above.get(queue[i])) {
        degree.set(next, degree.get(next) - 1);
        if (degree.get(next) === 0) queue.push(next);
      }
    const packed = (map) =>
      new Map(
        [...map].map(([face, ids]) => [face, [...ids].sort((a, b) => a - b)])
      );
    return {
      ...plane,
      front: packed(above),
      back: packed(below),
      cyclic: queue.length !== plane.faces.length,
      side: 1,
    };
  });
}

export function planeSide(normal, origin, eye, previous = 1) {
  const ray = eye.map((x, i) => x - origin[i]);
  const facing = dot(normal, ray) / Math.max(Math.hypot(...ray), 1e-12);
  // History only in the edge-on band; a cold capture starts on the +up side.
  return Math.abs(facing) < 1e-5 ? previous : facing > 0 ? 1 : -1;
}

export function orientOrder(planes, eye) {
  return planes.map((plane) => {
    plane.side = planeSide(plane.normal, plane.origin, eye, plane.side);
    return { ...plane, blockers: plane.side > 0 ? plane.front : plane.back };
  });
}

/** CPU reference for the GPU mask pass. Depth increases toward the camera. */
export function orderedWinner(candidates, planes) {
  const ahead = (a, b) =>
    !a ||
    b.depth > a.depth + 1e-10 ||
    (Math.abs(a.depth - b.depth) <= 1e-10 && b.triangle > a.triangle)
      ? b
      : a;
  let best = null;
  for (const plane of planes) {
    const local = candidates.filter((c) => c.plane === plane.id);
    const present = new Set(local.map((c) => c.face));
    const survivors = local.filter(
      (c) => !plane.blockers.get(c.face).some((f) => present.has(f))
    );
    // A projected cycle can mask every local participant; preserve its
    // physical baseline at those pixels, then compare with the other planes.
    const visible = survivors.length ? survivors : plane.cyclic ? local : [];
    for (const candidate of visible) best = ahead(best, candidate);
  }
  return best;
}
