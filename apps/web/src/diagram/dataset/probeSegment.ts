/**
 * Where the aux edit probe draws its line: strictly inside one face of a
 * sheet, clear of every crease, so it adds an aux line and changes nothing
 * else. Test-only.
 *
 * The face is the sheet's largest (ties to the one whose centroid is least).
 * In a convex face the line is centred on its centroid, a quarter of the
 * centroid's distance to the nearest edge long; that pick does not depend on
 * where the kernel starts a face's ring, so two commits whose exports order a
 * face differently still draw the same line. A face that is not convex takes
 * the incentre of the largest triangle of its triangulation instead.
 */
import earcut from 'earcut';
import type { FoldDocument } from '../../engine/types';

export type ProbePoint = { x: number; y: number };

function area(ring: readonly (readonly number[])[]): number {
  let twice = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index]!;
    const [x2, y2] = ring[(index + 1) % ring.length]!;
    twice += x1! * y2! - x2! * y1!;
  }
  return Math.abs(twice) / 2;
}

type Ring = number[][];

function centroid(ring: Ring): ProbePoint {
  let twice = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index]!;
    const [x2, y2] = ring[(index + 1) % ring.length]!;
    const cross = x1! * y2! - x2! * y1!;
    twice += cross;
    x += (x1! + x2!) * cross;
    y += (y1! + y2!) * cross;
  }
  return { x: x / (3 * twice), y: y / (3 * twice) };
}

function convex(ring: Ring): boolean {
  let sign = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [ax, ay] = ring[index]!;
    const [bx, by] = ring[(index + 1) % ring.length]!;
    const [cx, cy] = ring[(index + 2) % ring.length]!;
    const turn = (bx! - ax!) * (cy! - by!) - (by! - ay!) * (cx! - bx!);
    if (Math.abs(turn) < 1e-12) continue;
    if (sign === 0) sign = Math.sign(turn);
    else if (Math.sign(turn) !== sign) return false;
  }
  return true;
}

function distanceToEdges(point: ProbePoint, ring: Ring): number {
  let nearest = Infinity;
  for (let index = 0; index < ring.length; index += 1) {
    const [ax, ay] = ring[index]!;
    const [bx, by] = ring[(index + 1) % ring.length]!;
    const dx = bx! - ax!;
    const dy = by! - ay!;
    const length = dx * dx + dy * dy;
    const t = length > 0 ? Math.max(0, Math.min(1, ((point.x - ax!) * dx + (point.y - ay!) * dy) / length)) : 0;
    nearest = Math.min(nearest, Math.hypot(point.x - (ax! + t * dx), point.y - (ay! + t * dy)));
  }
  return nearest;
}

/** The incentre and inradius of the largest triangle of the ring's triangulation. */
function largestIncircle(ring: Ring): { centre: ProbePoint; radius: number } | null {
  const triangles = earcut(ring.flat());
  let chosen: { centre: ProbePoint; radius: number } | null = null;
  for (let index = 0; index + 2 < triangles.length; index += 3) {
    const [p, q, r] = [triangles[index]!, triangles[index + 1]!, triangles[index + 2]!].map((at) => ring[at]!);
    const side = (u: number[], v: number[]) => Math.hypot(u[0]! - v[0]!, u[1]! - v[1]!);
    const a = side(q!, r!);
    const b = side(p!, r!);
    const c = side(p!, q!);
    const perimeter = a + b + c;
    const size = area([p!, q!, r!]);
    if (perimeter <= 0 || size <= 0) continue;
    const radius = (2 * size) / perimeter;
    if (chosen && radius <= chosen.radius) continue;
    chosen = {
      centre: { x: (a * p![0]! + b * q![0]! + c * r![0]!) / perimeter, y: (a * p![1]! + b * q![1]! + c * r![1]!) / perimeter },
      radius,
    };
  }
  return chosen;
}

/** A short horizontal segment strictly inside the fold's largest face, or null for a fold with no face. */
export function probeSegment(fold: FoldDocument): { a: ProbePoint; b: ProbePoint } | null {
  const coords = fold.vertices_coords ?? [];
  const faces = fold.faces_vertices ?? [];
  let best: { ring: Ring; area: number; centroid: ProbePoint } | null = null;
  for (const face of faces) {
    const ring = face.map((vertex) => coords[vertex]!.slice(0, 2));
    const size = area(ring);
    if (!(size > 0)) continue;
    const middle = centroid(ring);
    const larger = !best || size > best.area * (1 + 1e-9);
    const tied = best && !larger && size >= best.area * (1 - 1e-9);
    if (larger || (tied && (middle.x < best!.centroid.x || (middle.x === best!.centroid.x && middle.y < best!.centroid.y)))) {
      best = { ring, area: size, centroid: middle };
    }
  }
  if (!best) return null;
  let centre: ProbePoint;
  let clearance: number;
  if (convex(best.ring)) {
    centre = best.centroid;
    clearance = distanceToEdges(centre, best.ring);
  } else {
    const incircle = largestIncircle(best.ring);
    if (!incircle) return null;
    centre = incircle.centre;
    clearance = incircle.radius;
  }
  if (!(clearance > 0)) return null;
  const half = clearance / 8;
  return { a: { x: centre.x - half, y: centre.y }, b: { x: centre.x + half, y: centre.y } };
}
