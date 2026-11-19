// Convex clipping shared by the vector capture and the pose's order check.
import type { Point, Point3 } from './types.js';

export type Box = [number, number, number, number];
// Evaluate relative to a point on the primitive. Global ax + by + c loses
// precision when a small fold sits far from the page origin.
export interface Plane {
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
export const overlap = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
export const value = (line: Plane, p: Point) => line.x * (p[0] - line.origin[0]) + line.y * (p[1] - line.origin[1]) + line.z;
export const difference = (a: Plane, b: Plane): Plane => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: value(a, b.origin) - b.z,
  origin: b.origin,
});
export const coincident = (plane: Plane) => Math.max(Math.abs(plane.x), Math.abs(plane.y), Math.abs(plane.z)) < EPS;
export function area(p: readonly Point[]): number {
  if (!p.length) return 0;
  const [x, y] = p[0];
  return (
    p.reduce((s, a, i) => {
      const b = p[(i + 1) % p.length];
      return s + (a[0] - x) * (b[1] - y) - (a[1] - y) * (b[0] - x);
    }, 0) / 2
  );
}
export function clean(p: Point[]): Point[] {
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
export function clip(polygon: readonly Point[], line: Plane): Point[] {
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
export function edges(polygon: readonly Point[]): Plane[] {
  const s = area(polygon) >= 0 ? 1 : -1;
  return polygon
    .map((a, i) => {
      const b = polygon[(i + 1) % polygon.length];
      return { x: s * (a[1] - b[1]), y: s * (b[0] - a[0]), z: 0, origin: a };
    })
    .filter((line) => Math.hypot(line.x, line.y) > 1e-14);
}
export function partition(subject: Point[], mask: readonly Point[]): { outside: Point[][]; inside: Point[] } {
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
export function depthPlane(points: Point3[]): Plane | null {
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
