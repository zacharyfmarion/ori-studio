/**
 * Cells for the stack hit index's tests, and the brute force they are held
 * to. Imported only by `stackHitIndex*.test.ts`.
 *
 * - {@link convexPartition}: a square cut by random lines, every piece
 *   convex and sharing its edges with its neighbours, as Fold's overlay is.
 * - {@link trominoPartition}: a square tiled by L-trominoes and the unit
 *   squares that complete them, half the cells non-convex, with shared edges.
 * - {@link scatteredStars}: random star-shaped rings, non-convex and
 *   overlapping, so the first in the scene's order decides.
 * - {@link scatteredHulls}: random convex rings, overlapping.
 *
 * The brute force reads every cell in order with a winding-number test,
 * written apart from the index's own: what the index is checked against.
 */
import { convexHull, type Point } from '../../lib/geometry';
import type { StackCell, StackHitIndex } from './stackHitIndex';

/** A seeded generator (mulberry32): the same cells on every run. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stackOf(next: () => number, faces: number): number[] {
  const depth = 1 + Math.floor(next() * 4);
  return Array.from({ length: depth }, () => Math.floor(next() * faces));
}

/** The part of a convex ring on the side of the line through `a` and `b` where `keep` says. */
function clip(ring: readonly Point[], a: Point, b: Point, keep: 1 | -1): Point[] {
  const side = (p: Point) => keep * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
  const out: Point[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) out.push(p);
    if (sp >= 0 !== sq >= 0) {
      const t = sp / (sp - sq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  return out;
}

function area(ring: readonly Point[]): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/** The unit square cut by `lines` random lines: convex cells that tile it. */
export function convexPartition(seed: number, lines: number): StackCell[] {
  const next = random(seed);
  let rings: Point[][] = [
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
  ];
  for (let k = 0; k < lines; k += 1) {
    const a = { x: next(), y: next() };
    const b = { x: next(), y: next() };
    rings = rings.flatMap((ring) => [clip(ring, a, b, 1), clip(ring, a, b, -1)].filter((piece) => area(piece) > 1e-9));
  }
  return rings.map((polygon) => ({ polygon, faces_top_to_bottom: stackOf(next, 32) }));
}

/**
 * An `n` × `n` grid of 2 × 2 blocks, each an L-tromino and the unit square
 * that completes it, turned a random quarter: cells that tile the square,
 * every other one non-convex.
 */
export function trominoPartition(seed: number, n: number): StackCell[] {
  const next = random(seed);
  const cells: StackCell[] = [];
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      const x = column * 2;
      const y = row * 2;
      // The L's corners and the square it leaves, with the square at (1, 1) of the block.
      let ell: [number, number][] = [
        [0, 0],
        [2, 0],
        [2, 1],
        [1, 1],
        [1, 2],
        [0, 2],
      ];
      let square: [number, number][] = [
        [1, 1],
        [2, 1],
        [2, 2],
        [1, 2],
      ];
      // A quarter turn about the block's middle, 0 to 3 times.
      const turns = Math.floor(next() * 4);
      for (let k = 0; k < turns; k += 1) {
        const turn = ([u, v]: [number, number]): [number, number] => [2 - v, u];
        ell = ell.map(turn);
        square = square.map(turn);
      }
      const place = ([u, v]: [number, number]): Point => ({ x: x + u, y: y + v });
      cells.push({ polygon: ell.map(place), faces_top_to_bottom: stackOf(next, 64) });
      cells.push({ polygon: square.map(place), faces_top_to_bottom: stackOf(next, 64) });
    }
  }
  return cells;
}

/** `count` star-shaped rings of 5 to 12 points, scattered over the unit square and overlapping. */
export function scatteredStars(seed: number, count: number): StackCell[] {
  const next = random(seed);
  return Array.from({ length: count }, () => {
    const center = { x: next(), y: next() };
    const radius = 0.02 + next() * 0.15;
    const points = 5 + Math.floor(next() * 8);
    const angles = Array.from({ length: points }, () => next() * 2 * Math.PI).sort((a, b) => a - b);
    const polygon = angles.map((angle) => {
      const r = radius * (0.3 + 0.7 * next());
      return { x: center.x + r * Math.cos(angle), y: center.y + r * Math.sin(angle) };
    });
    return { polygon, faces_top_to_bottom: stackOf(next, 16) };
  });
}

/** `count` convex rings (hulls of random points), scattered over the unit square and overlapping. */
export function scatteredHulls(seed: number, count: number): StackCell[] {
  const next = random(seed);
  return Array.from({ length: count }, () => {
    const center = { x: next(), y: next() };
    const radius = 0.02 + next() * 0.15;
    const polygon = convexHull(
      Array.from({ length: 4 + Math.floor(next() * 8) }, () => ({
        x: center.x + (next() * 2 - 1) * radius,
        y: center.y + (next() * 2 - 1) * radius,
      }))
    );
    return { polygon, faces_top_to_bottom: stackOf(next, 16) };
  });
}

/** How many times a ring winds round `p` (Sunday's crossing rule). */
function winding(polygon: readonly Point[], p: Point): number {
  let wound = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const left = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
    if (a.y <= p.y) {
      if (b.y > p.y && left > 0) wound += 1;
    } else if (b.y <= p.y && left < 0) {
      wound -= 1;
    }
  }
  return wound;
}

/** The first cell in the scene's order that holds `p`, by brute force; -1 for none. */
export function bruteForceCell(cells: readonly StackCell[], p: Point): number {
  return cells.findIndex(({ polygon }) => winding(polygon, p) !== 0);
}

/** Every cell that holds `p`, by brute force, in order. */
export function bruteForceCells(cells: readonly StackCell[], p: Point): number[] {
  return cells.flatMap(({ polygon }, cell) => (winding(polygon, p) !== 0 ? [cell] : []));
}

function distanceToRing(polygon: readonly Point[], p: Point): number {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t = length2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
    best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t));
  }
  return best;
}

/**
 * Whether two answers for `p` may differ: `p` lies on, or within `tolerance`
 * of, the outline of a cell either answer names, where inside and outside
 * are a matter of rounding.
 */
export function onAnOutline(cells: readonly StackCell[], answers: readonly number[], p: Point, tolerance: number): boolean {
  return answers.some((cell) => cell >= 0 && distanceToRing(cells[cell]!.polygon, p) <= tolerance);
}

/** Random points over the cells' box, a margin round it included so some miss the paper. */
export function samplePoints(cells: readonly StackCell[], count: number, seed: number): Point[] {
  const next = random(seed);
  const points = cells.flatMap(({ polygon }) => polygon);
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const marginX = (maxX - minX) * 0.05;
  const marginY = (maxY - minY) * 0.05;
  return Array.from({ length: count }, () => ({
    x: minX - marginX + next() * (maxX - minX + 2 * marginX),
    y: minY - marginY + next() * (maxY - minY + 2 * marginY),
  }));
}

/** The p50, p99 and largest of a query's time over `points`, in microseconds. */
export function queryTimes(index: StackHitIndex, points: readonly Point[]): { p50: number; p99: number; max: number } {
  // A warm-up pass, so the first queries do not pay for the JIT.
  for (const p of points) index.stackAt(p);
  const times = points.map((p) => {
    const start = performance.now();
    index.stackAt(p);
    return (performance.now() - start) * 1000;
  });
  times.sort((a, b) => a - b);
  const at = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))]!;
  return { p50: at(0.5), p99: at(0.99), max: times[times.length - 1]! };
}
