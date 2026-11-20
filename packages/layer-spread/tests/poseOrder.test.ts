import { describe, expect, it } from 'vitest';
import { createWinner, pickSpread, visibility } from '../src/visibility.js';
import { visibleFragments } from '../src/fragments.js';
import { layerChains, poseVisibility } from '../src/poseOrder.js';
import { barycentric } from '../src/projection.js';
import type { Point, Point3, ProjectedSpread, SpreadInput, Visibility } from '../src/types.js';

/** Unit-high rectangles over x ranges, two triangles each. */
function rectangles(ranges: Point[], orders: Point[], planeGroups?: number[]): SpreadInput {
  const xy: Point[] = ranges.flatMap(([lo, hi]) => [[lo, 0], [hi, 0], [hi, 1], [lo, 1]] as Point[]);
  return {
    xy,
    faces: ranges.map((_, i) => [4 * i, 4 * i + 1, 4 * i + 2, 4 * i + 3]),
    triangles: ranges.flatMap((_, i) => [[4 * i, 4 * i + 1, 4 * i + 2], [4 * i, 4 * i + 2, 4 * i + 3]]),
    triangleFaces: ranges.flatMap((_, i) => [i, i]),
    orders,
    planeGroups,
    cells: [],
  };
}

/** Each face slid by `shifts` at its own depth; `tilts` slope a face's depth along x. */
function pose(input: SpreadInput, depths: number[], shifts: number[], back = false, tilts: number[] = []): ProjectedSpread {
  const face = (v: number) => Math.floor(v / 4);
  const positions: Point3[] = input.xy.map(([x, y], v) => [x + shifts[face(v)], y, depths[face(v)] + (tilts[face(v)] ?? 0) * x]);
  const shape = { positions, triangles: input.triangles, triangleFaces: input.triangleFaces };
  const base = visibility(input.faces.length, input.orders, back, input.planeGroups);
  return { ...shape, visibility: poseVisibility(base, layerChains(input.faces.length, input.orders, input.planeGroups), shape, back) };
}

/** The rule the picture keeps: hidden by any face above it through a chain; else the nearest shows. */
function ruleFace(input: SpreadInput, mesh: ProjectedSpread, point: Point, back: boolean): number | null {
  const n = input.faces.length;
  const above = Array.from({ length: n }, () => new Set<number>());
  for (const [lo, hi] of input.orders) above[back ? hi : lo].add(back ? lo : hi);
  // Close transitively: tiny graphs only.
  for (let changed = true; changed; ) {
    changed = false;
    for (const set of above)
      for (const h of [...set])
        for (const k of above[h])
          if (!set.has(k)) {
            set.add(k);
            changed = true;
          }
  }
  const covering: { face: number; depth: number; triangle: number }[] = [];
  mesh.triangles.forEach((ids, t) => {
    const corners = ids.map((v) => mesh.positions[v]);
    const w = barycentric(corners[0], corners[1], corners[2], point);
    if (w && Math.min(...w) >= -1e-9) covering.push({ face: mesh.triangleFaces[t], triangle: t, depth: w.reduce((s, x, k) => s + x * corners[k][2], 0) });
  });
  const shown = covering.filter((c) => !covering.some((o) => above[c.face].has(o.face)));
  shown.sort((a, b) => b.depth - a.depth || b.triangle - a.triangle);
  return shown[0]?.face ?? null;
}

/** Picking, the vector fragments and the rule agree at `point`. */
function expectFace(input: SpreadInput, mesh: ProjectedSpread, point: Point, face: number, back = false) {
  expect(ruleFace(input, mesh, point, back)).toBe(face);
  expect(pickSpread(mesh, point)?.face).toBe(face);
  const covers = visibleFragments(mesh).filter((f) =>
    f.polygon.slice(2).some((p, i) => {
      const w = barycentric(f.polygon[0], f.polygon[i + 1], p, point);
      return w && Math.min(...w) > -1e-10;
    }),
  );
  expect([...new Set(covers.map((f) => f.face))]).toEqual([face]);
}

describe('poseVisibility', () => {
  it.each([false, true])('shows a stack top over a buried layer of a stack it never touched (back=%s)', (back) => {
    // Faces 0 < 1 < 2 < 3 stack over x 0..1; face 4 lies alone beside them,
    // physically nearer than the buried face 1. The spread slides face 1 under it.
    const input = rectangles([[0, 1], [0, 1], [0, 1], [0, 1], [1, 2]], [[0, 1], [1, 2], [2, 3]]);
    // Seen from the back, face 0 is the near end of the stack.
    const depths = back ? [3, 2, 1, 0, 2.5] : [0, 1, 2, 3, 1.5];
    const mesh = pose(input, depths, [0, 0.5, 0, 0, 0], back);
    const base = visibility(5, input.orders, back);
    // The stack's ranks put face 1 (rank 1, or 2 from the back) over face 4 (rank 0).
    expect(createWinner(base)([{ face: 1, triangle: 2, depth: depths[1] }, { face: 4, triangle: 8, depth: depths[4] }])?.face).toBe(1);
    expect(mesh.visibility.ranks).not.toBeNull();
    expectFace(input, mesh, [1.3, 0.4], 4, back);
  });

  it('keeps the stack ranks, object and all, when no unrelated layers meet', () => {
    const input = rectangles([[0, 1], [0, 1], [3, 4]], [[0, 1]]);
    const base = visibility(3, input.orders);
    const shape = pose(input, [0, 1, 0], [0, 0.2, 0]);
    expect(poseVisibility(base, layerChains(3, input.orders), shape, false)).toBe(base);
  });

  it('keeps a chain through an absent layer, even against physical depth', () => {
    const input = rectangles([[0, 1], [0.5, 2.5], [2, 3]], [[0, 1], [1, 2]]);
    const mesh = pose(input, [3, 0, 1], [2, -5, 0]);
    expect(mesh.visibility.ranks).toEqual([0, 1, 2]);
    expectFace(input, mesh, [2.2, 0.37], 2);
  });

  it('lets crossing unrelated layers share a rank, so each pixel shows the nearer', () => {
    // Face 1 sits on top of face 0; face 2, unrelated, crosses face 1's height along x.
    const input = rectangles([[0, 4], [0, 4], [0, 4]], [[0, 1]]);
    const mesh = pose(input, [0, 1, 0], [0, 0, 0], false, [0, 0, 0.5]);
    const ranks = mesh.visibility.ranks!;
    expect(ranks[1]).toBe(ranks[2]);
    expectFace(input, mesh, [1, 0.5], 1);
    expectFace(input, mesh, [3, 0.5], 2);
  });

  it('masks when a chain contradicts the depths around an unrelated layer', () => {
    // 0 < 1 < 2 is a chain, and face 2 overlaps face 0 with face 1 absent.
    // Unrelated face 3 lies physically between them: nearer than 2, behind 0.
    // Where 0 and 3 meet, 0 shows; where 2 hides 0, 3 shows over 2. No ranks do both.
    const input = rectangles([[0, 3], [20, 21], [2, 5], [1, 2.5]], [[0, 1], [1, 2]]);
    const mesh = pose(input, [3, 0, 1, 2], [0, 0, 0, 0]);
    expect(mesh.visibility.ranks).toBeNull();
    expect(mesh.visibility.cyclic).toBe(false);
    expectFace(input, mesh, [1.5, 0.5], 0);
    expectFace(input, mesh, [2.2, 0.5], 3);
    expectFace(input, mesh, [2.7, 0.5], 2);
    expectFace(input, mesh, [4, 0.5], 2);
  });

  it('leaves a cyclic stack to its direct masks', () => {
    const input = rectangles([[0, 2], [0, 2], [0, 2]], [[0, 1], [1, 2], [2, 0]]);
    const base = visibility(3, input.orders);
    expect(layerChains(3, input.orders)).toBeNull();
    expect(poseVisibility(base, null, pose(input, [2, 0, 1], [0, 0, 0]), false)).toBe(base);
  });

  it('moves flat crease pieces together', () => {
    // Faces 0, 1 are one flat layer under face 2; face 3 is unrelated and nearer than both.
    const input = rectangles([[0, 1], [1, 2], [0, 2], [2, 3]], [[0, 2], [1, 2]], [0, 0, 1, 2]);
    const mesh = pose(input, [0, 0, 1, 0.5], [0.8, 0.8, 0, 0]);
    const ranks = mesh.visibility.ranks!;
    expect(ranks[0]).toBe(ranks[1]);
    expect(ranks[3]).toBeGreaterThanOrEqual(ranks[0]);
    expectFace(input, mesh, [2.4, 0.5], 3);
  });

  it('matches the rule at random poses of random stacks', () => {
    let seed = 7;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    let masked = 0, reranked = 0;
    for (let sample = 0; sample < 150; sample++) {
      const n = 3 + Math.floor(random() * 4);
      const ranges: Point[] = Array.from({ length: n }, () => {
        const lo = random() * 4;
        return [lo, lo + 0.5 + random() * 3];
      });
      // Edges only go up in index: always acyclic, often partial.
      const orders: Point[] = [];
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (random() < 0.35) orders.push([a, b]);
      const input = rectangles(ranges, orders);
      const back = random() < 0.3;
      const depths = Array.from({ length: n }, () => random() * 4);
      const tilts = Array.from({ length: n }, () => (random() < 0.3 ? random() - 0.5 : 0));
      const mesh = pose(input, depths, Array(n).fill(0), back, tilts);
      const order: Visibility = mesh.visibility;
      if (!order.ranks) masked++;
      else if (order !== visibility(n, orders, back)) reranked++;
      const pick = createWinner(order);
      for (let k = 0; k < 40; k++) {
        const point: Point = [random() * 8, 0.05 + random() * 0.9];
        const covering = mesh.triangles.flatMap((ids, t) => {
          const corners = ids.map((v) => mesh.positions[v]);
          const w = barycentric(corners[0], corners[1], corners[2], point);
          return w && Math.min(...w) >= -1e-9 ? [{ face: mesh.triangleFaces[t], triangle: t, depth: w.reduce((s, x, i) => s + x * corners[i][2], 0) }] : [];
        });
        if (!covering.length) continue;
        expect(pick(covering)?.face).toBe(ruleFace(input, mesh, point, back));
      }
    }
    // Both ways out of the stack's ranks are exercised.
    expect(masked).toBeGreaterThan(0);
    expect(reranked).toBeGreaterThan(0);
  });
});
