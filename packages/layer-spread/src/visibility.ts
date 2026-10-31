import type { Point, ProjectedSpread, SpreadPick, Visibility } from './types.js';
import { barycentric } from './projection.js';

/** Acyclic ranks preserve the prototype; cycles keep direct local relations. */
export function visibility(faceCount: number, orders: readonly Point[], back = false): Visibility {
  const above = Array.from({ length: faceCount }, () => new Set<number>());
  const degree = new Int32Array(faceCount);
  for (const order of orders) {
    const [lo, hi] = back ? [order[1], order[0]] : order;
    if (!above[lo].has(hi)) {
      above[lo].add(hi);
      degree[hi]++;
    }
  }
  const queue: number[] = [];
  degree.forEach((n, f) => {
    if (n === 0) queue.push(f);
  });
  const ranks = new Array<number>(faceCount).fill(0);
  for (let i = 0; i < queue.length; i++) {
    const face = queue[i];
    for (const next of above[face]) {
      ranks[next] = Math.max(ranks[next], ranks[face] + 1);
      if (--degree[next] === 0) queue.push(next);
    }
  }
  return { ranks: queue.length === faceCount ? ranks : null, above: above.map((s) => [...s].sort((a, b) => a - b)) };
}

/** Exact same winner rule as the depth-band / local-mask GPU pass. */
export function winner<T extends Pick<SpreadPick, 'face' | 'triangle' | 'depth'>>(
  candidates: readonly T[],
  order: Visibility,
): T | null {
  if (!candidates.length) return null;
  let eligible = candidates;
  if (order.ranks) {
    let rank = -1;
    for (const c of candidates) rank = Math.max(rank, order.ranks[c.face]);
    eligible = candidates.filter((c) => order.ranks![c.face] === rank);
  } else {
    const present = new Set(candidates.map((c) => c.face));
    const survivors = candidates.filter((c) => !order.above[c.face].some((f) => present.has(f)));
    if (survivors.length) eligible = survivors; // All excluded: preserve the physical baseline.
  }
  return eligible.reduce((a, b) =>
    b.depth > a.depth + 1e-10 || (Math.abs(a.depth - b.depth) <= 1e-10 && b.triangle > a.triangle) ? b : a,
  );
}

export function coveringTriangles(mesh: ProjectedSpread, point: Point, triangles?: readonly number[]): SpreadPick[] {
  const candidates: SpreadPick[] = [];
  const ids = triangles ?? mesh.triangles.map((_, t) => t);
  for (const t of ids) {
    const corners = mesh.triangles[t].map((v) => mesh.positions[v]);
    const weights = barycentric(corners[0], corners[1], corners[2], point);
    if (!weights || Math.min(...weights) < -1e-9) continue;
    candidates.push({
      triangle: t,
      face: mesh.triangleFaces[t],
      weights,
      depth: weights.reduce((s, w, i) => s + w * corners[i][2], 0),
    });
  }
  return candidates;
}

export function pickSpread(mesh: ProjectedSpread, point: Point, triangles?: readonly number[]): SpreadPick | null {
  return winner(coveringTriangles(mesh, point, triangles), mesh.visibility);
}

/** Keep the previous side in the edge-on band; cold captures default to front. */
export function orderSide(normalTowardEye: number, previous: 'front' | 'back' = 'front'): 'front' | 'back' {
  return Math.abs(normalTowardEye) < 1e-5 ? previous : normalTowardEye > 0 ? 'front' : 'back';
}
