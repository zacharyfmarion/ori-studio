import type { Point, Point3, ProjectedSpread } from './types.js';
import { createWinner, type WinnerQuery } from './visibility.js';

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
// Evaluate relative to a point on the primitive. Global ax + by + c loses
// precision when a small fold sits far from the page origin.
interface Plane {
  x: number;
  y: number;
  z: number;
  origin: Point;
}
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
const value = (line: Plane, p: Point) => line.x * (p[0] - line.origin[0]) + line.y * (p[1] - line.origin[1]) + line.z;
const difference = (a: Plane, b: Plane): Plane => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: value(a, b.origin) - b.z,
  origin: b.origin,
});
const coincident = (plane: Plane) => Math.max(Math.abs(plane.x), Math.abs(plane.y), Math.abs(plane.z)) < EPS;
function area(p: readonly Point[]): number {
  if (!p.length) return 0;
  const [x, y] = p[0];
  return (
    p.reduce((s, a, i) => {
      const b = p[(i + 1) % p.length];
      return s + (a[0] - x) * (b[1] - y) - (a[1] - y) * (b[0] - x);
    }, 0) / 2
  );
}
function clean(p: Point[]): Point[] {
  // Repeated clipping can leave rings only a few coordinate ULPs wide. They
  // have no reliable area, but the SVG seam-closing stroke makes them visible.
  // Scale by coordinate precision and perimeter, not a visual/pixel threshold:
  // real narrow layers must survive at every zoom and translation.
  let magnitude = 1;
  for (const point of p) magnitude = Math.max(magnitude, Math.abs(point[0]), Math.abs(point[1]));
  const tolerance = 32 * Number.EPSILON * magnitude;
  let perimeter = 0;
  const ring = p.filter((a, i) => {
    const b = p[(i + 1) % p.length];
    const length = Math.hypot(a[0] - b[0], a[1] - b[1]);
    perimeter += length;
    return length > tolerance;
  });
  return ring.length >= 3 && Math.abs(area(ring)) > tolerance * perimeter ? ring : [];
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
      return { x: s * (a[1] - b[1]), y: s * (b[0] - a[0]), z: 0, origin: a };
    })
    .filter((line) => Math.hypot(line.x, line.y) > 1e-14);
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
    const out = clip(inside, { ...edge, x: -edge.x, y: -edge.y, z: -edge.z });
    if (out.length) outside.push(out);
    inside = clip(inside, edge);
    if (!inside.length) break;
  }
  return { inside, outside };
}
function depthPlane(points: Point3[]): Plane | null {
  const [a, b, c] = points;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const determinant = ux * vy - uy * vx;
  if (Math.abs(determinant) < 1e-16) return null;
  return {
    x: (uz * vy - uy * vz) / determinant,
    y: (ux * vz - uz * vx) / determinant,
    z: a[2],
    origin: [a[0], a[1]],
  };
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
  const polygons = mesh.triangles.map((ids) => clean(ids.map((v) => mesh.positions[v].slice(0, 2) as Point)));
  const planes = mesh.triangles.map((ids) => depthPlane(ids.map((v) => mesh.positions[v])));
  const neighbors = candidates(mesh),
    out: VisibleFragment[] = [];
  let work = 0;
  const charge = () => {
    if (++work > budget) throw new SpreadComplexityError();
  };
  for (let t = 0; t < polygons.length; t++) {
    const own = planes[t];
    if (!own || !polygons[t].length) continue;
    const face = mesh.triangleFaces[t];
    const ranks = mesh.visibility.ranks;
    if (ranks) {
      let pieces = [polygons[t]];
      for (const other of neighbors[t]) {
        const f = mesh.triangleFaces[other],
          plane = planes[other];
        if (!plane || !polygons[other].length || ranks[f] < ranks[face]) continue;
        let mask = polygons[other];
        if (ranks[f] === ranks[face]) {
          const delta = difference(plane, own);
          // Exact ties follow triangle draw order, consistently with picking.
          if (coincident(delta)) {
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
    planes[triangle] && polygon.length ? [{ triangle, face: mesh.triangleFaces[triangle], polygon, box: bounds(polygon) }] : [],
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
      if (!polygons[other].length || !blockers.has(mesh.triangleFaces[other])) continue;
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
        const delta = difference(planes[other.triangle]!, planes[own.triangle]!);
        let mask = other.polygon;
        if (coincident(delta)) {
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

/** Prepare once for all the ink in one immutable posed mesh. This is scoped to
 * the capture, not a persistent cache: camera/pose changes get fresh planes. */
export function createLineClipper(mesh: ProjectedSpread): (face: number, a: Point3, b: Point3) => [number, number][] {
  const winner = createWinner(mesh.visibility);
  const owners = new Map<number, number>();
  const geometry = mesh.triangles.map((ids, triangle) => {
    owners.set(mesh.triangleFaces[triangle], triangle);
    const points = ids.map((v) => mesh.positions[v]);
    const [a, b, c] = points;
    const x = b[0] - a[0], y = b[1] - a[1], u = c[0] - a[0], v = c[1] - a[1];
    return {
      box: bounds(points), edges: edges(points.map((p) => [p[0], p[1]])), plane: depthPlane(points),
      triangle, face: mesh.triangleFaces[triangle], points, x, y, u, v, determinant: x * v - y * u,
    };
  });
  return (face, a, b) => lineIntervals(mesh, face, a, b, geometry, owners.get(face) ?? -1, winner);
}

interface LineTriangle {
  box: Box;
  edges: Plane[];
  plane: Plane | null;
  triangle: number;
  face: number;
  points: Point3[];
  x: number;
  y: number;
  u: number;
  v: number;
  determinant: number;
}

/** The same barycentric arithmetic/coverage tolerance as picking, without
 * rebuilding corners and allocating weights for every interval/triangle pair. */
function coveredDepth(t: LineTriangle, px: number, py: number, depth = true): number | null {
  if (Math.abs(t.determinant) < 1e-16) return null;
  const qx = px - t.points[0][0], qy = py - t.points[0][1];
  const wb = (qx * t.v - qy * t.u) / t.determinant;
  const wc = (t.x * qy - t.y * qx) / t.determinant;
  const wa = 1 - wb - wc;
  if (Math.min(wa, wb, wc) < -1e-9) return null;
  return depth ? 0 + wa * t.points[0][2] + wb * t.points[1][2] + wc * t.points[2][2] : 0;
}

/** Visibility intervals of an original edge. Clipping boundaries are never ink. */
export function visibleLine(mesh: ProjectedSpread, face: number, a: Point3, b: Point3): [number, number][] {
  return createLineClipper(mesh)(face, a, b);
}

function lineIntervals(
  mesh: ProjectedSpread,
  face: number,
  a: Point3,
  b: Point3,
  geometry: LineTriangle[],
  owner: number,
  winner: WinnerQuery,
): [number, number][] {
  const box = bounds([a, b]);
  const cuts = [0, 1];
  const higher: LineTriangle[] = [], peers: LineTriangle[] = [];
  const ranks = mesh.visibility.ranks;
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  for (let t = 0; t < geometry.length; t++) {
    const triangle = geometry[t];
    if (!overlap(box, triangle.box)) continue;
    if (!ranks || ranks[triangle.face] === ranks[face]) peers.push(triangle);
    else if (ranks[triangle.face] > ranks[face]) higher.push(triangle);
    for (const edge of triangle.edges) {
      const va = value(edge, [a[0], a[1]]),
        vb = value(edge, [b[0], b[1]]),
        denom = va - vb;
      if (Math.abs(denom) > 1e-14) {
        const u = va / denom;
        if (u > 0 && u < 1) cuts.push(u);
      }
    }
    const plane = triangle.plane;
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
    const px = a[0] + u * dx, py = a[1] + u * dy;
    // For acyclic order, any covering higher rank settles the question: this
    // edge is hidden. Lower ranks cannot beat its known owner. Keep ALL cuts
    // above, including lower faces, so interval endpoints stay byte-identical.
    if (higher.some((triangle) => coveredDepth(triangle, px, py, false) !== null)) continue;
    const covering: { face: number; triangle: number; depth: number }[] = [];
    for (const triangle of peers) {
      const depth = coveredDepth(triangle, px, py);
      if (depth !== null) covering.push({ face: triangle.face, triangle: triangle.triangle, depth });
    }
    // Ink already carries its material owner and interpolated depth. At an
    // outline, roundoff can place its midpoint just outside the owner's fill;
    // do not rediscover that ownership with a point-in-triangle test. Other
    // covering faces still occlude it through the same rank/cycle/depth rule.
    const pick = winner(
      [
        ...covering,
        { face, triangle: owner, depth: a[2] + u * (b[2] - a[2]) },
      ],
    );
    if (pick?.face !== face) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - lo) < 1e-9) last[1] = hi;
    else out.push([lo, hi]);
  }
  return out;
}
