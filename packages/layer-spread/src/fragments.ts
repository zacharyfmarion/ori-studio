import type { Point, Point3, ProjectedSpread, SpreadPick } from './types.js';
import { barycentric } from './projection.js';
import { pickSpread } from './visibility.js';

export class SpreadComplexityError extends Error {
  constructor() {
    super('Layer spread vector complexity limit');
    this.name = 'SpreadComplexityError';
  }
}

export interface VisibleFragment {
  triangle: number;
  face: number;
  polygon: Point[];
}
type Box = [number, number, number, number];
type Plane = [number, number, number];
const EPS = 1e-10;

export function bounds(points: readonly (readonly number[])[]): Box {
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of points) {
    box[0] = Math.min(box[0], p[0]);
    box[1] = Math.min(box[1], p[1]);
    box[2] = Math.max(box[2], p[0]);
    box[3] = Math.max(box[3], p[1]);
  }
  return box;
}
const overlap = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
const value = (line: Plane, p: Point) => line[0] * p[0] + line[1] * p[1] + line[2];
function area(p: readonly Point[]): number {
  return (
    p.reduce((s, a, i) => {
      const b = p[(i + 1) % p.length];
      return s + a[0] * b[1] - a[1] * b[0];
    }, 0) / 2
  );
}
function clean(p: Point[]): Point[] {
  const ring = p.filter((a, i) => {
    const b = p[(i + 1) % p.length];
    return Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-12;
  });
  return ring.length >= 3 && Math.abs(area(ring)) > 1e-16 ? ring : [];
}
function clip(polygon: readonly Point[], line: Plane): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length],
      u = value(line, a),
      v = value(line, b);
    // The two complementary half-planes must not both own an epsilon-wide
    // strip: repeated subtraction would duplicate that strip exponentially.
    if (u >= 0) out.push(a);
    if (u >= 0 !== v >= 0) {
      const t = u / (u - v);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return clean(out);
}
function edges(polygon: readonly Point[]): Plane[] {
  const s = area(polygon) >= 0 ? 1 : -1;
  return polygon
    .map((a, i) => {
      const b = polygon[(i + 1) % polygon.length];
      return [s * (a[1] - b[1]), s * (b[0] - a[0]), s * (a[0] * b[1] - a[1] * b[0])] as Plane;
    })
    .filter((line) => Math.hypot(line[0], line[1]) > 1e-14);
}
function partition(subject: Point[], mask: readonly Point[]): { outside: Point[][]; inside: Point[] } {
  const halfplanes = edges(mask);
  let intersection = subject;
  for (const edge of halfplanes) {
    intersection = clip(intersection, edge);
    if (!intersection.length) return { outside: [subject], inside: [] };
  }
  let inside = subject;
  const outside: Point[][] = [];
  for (const edge of halfplanes) {
    const out = clip(inside, edge.map((x) => -x) as Plane);
    if (out.length) outside.push(out);
    inside = clip(inside, edge);
    if (!inside.length) break;
  }
  return { inside, outside };
}
function depthPlane(points: Point3[]): Plane | null {
  const [a, b, c] = points;
  const u = barycentric(a, b, c, [0, 0]),
    v = barycentric(a, b, c, [1, 0]),
    w = barycentric(a, b, c, [0, 1]);
  if (!u || !v || !w) return null;
  const at = (weights: Point3) => weights.reduce((s, x, i) => s + x * points[i][2], 0);
  const z = at(u);
  return [at(v) - z, at(w) - z, z];
}
function candidates(mesh: ProjectedSpread): number[][] {
  const boxes = mesh.triangles.map((ids) => bounds(ids.map((v) => mesh.positions[v])));
  const sorted = boxes.map((_, i) => i).sort((a, b) => boxes[a][0] - boxes[b][0]);
  const neighbors = boxes.map(() => [] as number[]);
  let active: number[] = [];
  let pairs = 0;
  for (const a of sorted) {
    active = active.filter((b) => boxes[b][2] >= boxes[a][0]);
    for (const b of active)
      if (overlap(boxes[a], boxes[b])) {
        if (++pairs > 2_000_000) throw new SpreadComplexityError();
        neighbors[a].push(b);
        neighbors[b].push(a);
      }
    active.push(a);
  }
  return neighbors;
}

/** Exact vector counterpart of rank bands and local masks, including cycle
 * fallback. Run in the capture worker, never during a pointer move. A bounded
 * arrangement avoids unbounded allocations on pathological projected meshes.
 */
export function visibleFragments(mesh: ProjectedSpread, budget = 2_000_000): VisibleFragment[] {
  const polygons = mesh.triangles.map((ids) => ids.map((v) => mesh.positions[v].slice(0, 2) as Point));
  const planes = mesh.triangles.map((ids) => depthPlane(ids.map((v) => mesh.positions[v])));
  const neighbors = candidates(mesh),
    out: VisibleFragment[] = [];
  let work = 0;
  const charge = () => {
    if (++work > budget) throw new SpreadComplexityError();
  };
  for (let t = 0; t < polygons.length; t++) {
    const own = planes[t];
    if (!own) continue;
    const face = mesh.triangleFaces[t];
    const ranks = mesh.visibility.ranks;
    if (ranks) {
      let pieces = [polygons[t]];
      for (const other of neighbors[t]) {
        const f = mesh.triangleFaces[other],
          plane = planes[other];
        if (!plane || ranks[f] < ranks[face]) continue;
        let mask = polygons[other];
        if (ranks[f] === ranks[face]) {
          const delta = plane.map((v, k) => v - own[k]) as Plane;
          // Exact ties follow triangle draw order, consistently with picking.
          if (Math.max(...delta.map(Math.abs)) < EPS) {
            if (other < t) continue;
          } else mask = clip(mask, delta);
        }
        if (!mask.length) continue;
        pieces = pieces.flatMap((p) => {
          charge();
          return partition(p, mask).outside;
        });
        if (!pieces.length) break;
      }
      for (const polygon of pieces) out.push({ triangle: t, face, polygon });
      continue;
    }
    // Cyclic models are resolved together below, after local masks.
  }
  if (!mesh.visibility.ranks) return cyclicFragments(mesh, polygons, planes, neighbors, charge);

  return out;
}

interface Piece extends VisibleFragment {
  box: Box;
}
function cyclicFragments(
  mesh: ProjectedSpread,
  polygons: Point[][],
  planes: (Plane | null)[],
  neighbors: number[][],
  charge: () => void,
): VisibleFragment[] {
  const original: Piece[] = polygons.flatMap((polygon, triangle) =>
    planes[triangle] ? [{ triangle, face: mesh.triangleFaces[triangle], polygon, box: bounds(polygon) }] : [],
  );
  const boxes = polygons.map(bounds);
  const subtract = (pieces: Point[][], mask: Point[], box: Box): Point[][] =>
    pieces.flatMap((p) => {
      if (!overlap(bounds(p), box)) return [p];
      charge();
      return partition(p, mask).outside;
    });
  const survivors: Piece[] = [];
  for (const own of original) {
    const blockers = new Set(mesh.visibility.above[own.face]);
    let pieces = [own.polygon];
    for (const other of neighbors[own.triangle]) {
      if (!blockers.has(mesh.triangleFaces[other])) continue;
      pieces = subtract(pieces, polygons[other], boxes[other]);
      if (!pieces.length) break;
    }
    for (const polygon of pieces) survivors.push({ ...own, polygon, box: bounds(polygon) });
  }
  // Subtract the union of surviving coverage from the physical baseline.
  // Only all-masked projected cycles need this fallback.
  const fallback: Piece[] = [];
  for (const own of original) {
    let pieces = [own.polygon];
    for (const other of survivors) {
      if (!overlap(own.box, other.box)) continue;
      pieces = subtract(pieces, other.polygon, other.box);
      if (!pieces.length) break;
    }
    for (const polygon of pieces) fallback.push({ ...own, polygon, box: bounds(polygon) });
  }
  const physical = (input: Piece[]): VisibleFragment[] => {
    const out: VisibleFragment[] = [];
    // Sorting gives an X broad phase without allocating an all-pairs matrix.
    const sorted = [...input].sort((a, b) => a.box[0] - b.box[0]);
    for (const own of input) {
      let pieces = [own.polygon];
      for (const other of sorted) {
        if (other.box[0] > own.box[2]) break;
        if (other.triangle === own.triangle || !overlap(own.box, other.box)) continue;
        const delta = planes[other.triangle]!.map((v, k) => v - planes[own.triangle]![k]) as Plane;
        let mask = other.polygon;
        if (Math.max(...delta.map(Math.abs)) < EPS) {
          if (other.triangle < own.triangle) continue;
        } else mask = clip(mask, delta);
        if (!mask.length) continue;
        pieces = subtract(pieces, mask, bounds(mask));
        if (!pieces.length) break;
      }
      for (const polygon of pieces) out.push({ triangle: own.triangle, face: own.face, polygon });
    }
    return out;
  };
  return [...physical(fallback), ...physical(survivors)];
}

/** Visibility intervals of an original edge. Clipping boundaries are never ink. */
export function visibleLine(mesh: ProjectedSpread, face: number, a: Point3, b: Point3): [number, number][] {
  const box = bounds([a, b]);
  const cuts = [0, 1],
    near: number[] = [];
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  for (let t = 0; t < mesh.triangles.length; t++) {
    const p = mesh.triangles[t].map((v) => mesh.positions[v]);
    if (!overlap(box, bounds(p))) continue;
    near.push(t);
    for (const edge of edges(p.map((v) => [v[0], v[1]]))) {
      const va = value(edge, [a[0], a[1]]),
        vb = value(edge, [b[0], b[1]]),
        denom = va - vb;
      if (Math.abs(denom) > 1e-14) {
        const u = va / denom;
        if (u > 0 && u < 1) cuts.push(u);
      }
    }
    const plane = depthPlane(p);
    if (plane) {
      const va = a[2] - value(plane, [a[0], a[1]]),
        vb = b[2] - value(plane, [b[0], b[1]]);
      if (Math.abs(va - vb) > 1e-14) {
        const u = va / (va - vb);
        if (u > 0 && u < 1) cuts.push(u);
      }
    }
  }
  cuts.sort((u, v) => u - v);
  const out: [number, number][] = [];
  for (let i = 1; i < cuts.length; i++) {
    const lo = cuts[i - 1],
      hi = cuts[i];
    if (hi - lo < 1e-9) continue;
    const u = (lo + hi) / 2;
    const pick: SpreadPick | null = pickSpread(mesh, [a[0] + u * dx, a[1] + u * dy], near);
    if (pick?.face !== face) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - lo) < 1e-9) last[1] = hi;
    else out.push([lo, hi]);
  }
  return out;
}
