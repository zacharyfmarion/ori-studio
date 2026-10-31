import type { Point, ProjectedSpread, SpreadPick, Visibility } from './types.js';
import { barycentric } from './projection.js';

/** Flat creases subdivide one layer without changing its stacking position.
 * Rank those pieces together. Acyclic stacks use global depth bands, including
 * newly overlapping faces; genuinely cyclic stacks retain local masks.
 */
export function visibility(faceCount: number, orders: readonly Point[], back = false, planeGroups?: readonly number[]): Visibility {
  if (planeGroups && new Set(planeGroups).size < faceCount) {
    const members = new Map<number, number[]>();
    planeGroups.forEach((group, face) => {
      if (!members.has(group)) members.set(group, []);
      members.get(group)!.push(face);
    });
    const groups = [...members.values()];
    const groupOf = new Int32Array(faceCount);
    groups.forEach((faces, group) => faces.forEach(face => { groupOf[face] = group; }));
    const groupedOrders: Point[] = [];
    for (const [lo, hi] of orders)
      if (groupOf[lo] !== groupOf[hi]) groupedOrders.push([groupOf[lo], groupOf[hi]]);
    const grouped = visibility(groups.length, groupedOrders, back);
    const above = grouped.above.map(blockers => blockers.flatMap(group => groups[group]).sort((a, b) => a - b));
    return {
      ranks: grouped.ranks ? Array.from(groupOf, group => grouped.ranks![group]) : null,
      cyclic: grouped.cyclic,
      above: Array.from(groupOf, group => above[group]),
    };
  }
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
  const cyclic = queue.length !== faceCount;
  return { ranks: cyclic ? null : ranks, cyclic, above: above.map((s) => [...s].sort((a, b) => a - b)) };
}

/** Exact same winner rule as the depth-band / local-mask GPU pass. */
export function winner<T extends Pick<SpreadPick, 'face' | 'triangle' | 'depth'>>(
  candidates: readonly T[],
  order: Visibility,
): T | null {
  return createWinner(order)(candidates);
}

type Candidate = Pick<SpreadPick, 'face' | 'triangle' | 'depth'>;
export type WinnerQuery = <T extends Candidate>(candidates: readonly T[]) => T | null;

/** Reuse membership scratch space for the many visibility samples in one
 * immutable mesh. Stamps avoid clearing face-sized arrays per sample. */
export function createWinner(order: Visibility): WinnerQuery {
  const present = new Uint32Array(order.ranks ? 0 : order.above.length);
  const checked = new Uint32Array(present.length);
  const blocked = new Uint8Array(present.length);
  let stamp = 0;
  const ahead = <T extends Candidate>(a: T | null, b: T): T =>
    !a || b.depth > a.depth + 1e-10 || (Math.abs(a.depth - b.depth) <= 1e-10 && b.triangle > a.triangle) ? b : a;
  return <T extends Candidate>(candidates: readonly T[]): T | null => {
    let best: T | null = null;
    if (order.ranks) {
      let rank = -1;
      for (const c of candidates) rank = Math.max(rank, order.ranks[c.face]);
      for (const c of candidates) if (order.ranks[c.face] === rank) best = ahead(best, c);
      return best;
    }
    if (++stamp === 0xffffffff) { present.fill(0); checked.fill(0); stamp = 1; }
    for (const c of candidates) present[c.face] = stamp;
    let physical: T | null = null;
    for (const c of candidates) {
      physical = ahead(physical, c);
      if (checked[c.face] !== stamp) {
        checked[c.face] = stamp;
        blocked[c.face] = order.above[c.face].some((f) => present[f] === stamp) ? 1 : 0;
      }
      if (!blocked[c.face]) best = ahead(best, c);
    }
    return best ?? physical; // All excluded: preserve the physical baseline.
  };
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
