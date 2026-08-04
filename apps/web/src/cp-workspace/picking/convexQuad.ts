/**
 * Marquee hit tests against a convex quadrilateral — the ambient selection's
 * predicates, generalised from the axis-aligned box they used to assume.
 *
 * A drag box is axis-aligned on *screen*, so in model space it is a rotated
 * rectangle whenever the view is turned. These keep the crossing ("touch")
 * semantics the AABB versions had: a crease counts when the box touches it at
 * all, not only when it encloses it.
 */
import { distanceToSegment } from './lineHitIndex';
import type { ModelPoint } from '../renderer/types';

/** A convex quad in model space, corners in perimeter order. */
export type ConvexQuad = readonly [ModelPoint, ModelPoint, ModelPoint, ModelPoint];

/** Twice the signed area — positive for one winding, negative for the other. */
function signedArea2(quad: ConvexQuad): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const p = quad[i];
    const q = quad[(i + 1) % 4];
    sum += p.x * q.y - q.x * p.y;
  }
  return sum;
}

/**
 * Inward half-plane for each edge, as `(nx, ny, c)` with `nx*x + ny*y + c >= 0`
 * inside. Derived from the quad's own winding, so both windings work — the
 * corners come from a drag that can go in any direction.
 */
function inwardHalfPlanes(quad: ConvexQuad): [number, number, number][] {
  const orientation = signedArea2(quad) >= 0 ? 1 : -1;
  const planes: [number, number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const p = quad[i];
    const q = quad[(i + 1) % 4];
    // Left normal of p->q, flipped to point inward for this winding.
    const nx = -(q.y - p.y) * orientation;
    const ny = (q.x - p.x) * orientation;
    planes.push([nx, ny, -(nx * p.x + ny * p.y)]);
  }
  return planes;
}

/**
 * A straight drag produces a quad with no area — its two "cap" edges are
 * zero-length. Those edges contribute no half-plane, so a half-plane test alone
 * would treat the quad as an infinite line and select the whole document along
 * it. Collinear quads are therefore handled as the segment they actually are.
 *
 * Returns that segment, or null when the quad has area.
 */
function degenerateSegment(quad: ConvexQuad): [ModelPoint, ModelPoint] | null {
  if (Math.abs(signedArea2(quad)) > 1e-12) return null;
  let best: [ModelPoint, ModelPoint] = [quad[0], quad[0]];
  let bestDist = -1;
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const dist = Math.hypot(quad[j].x - quad[i].x, quad[j].y - quad[i].y);
      if (dist > bestDist) {
        bestDist = dist;
        best = [quad[i], quad[j]];
      }
    }
  }
  return best;
}

/** Whether segments p1–p2 and p3–p4 touch or cross, collinear overlap included. */
function segmentsIntersect(
  p1: ModelPoint,
  p2: ModelPoint,
  p3: ModelPoint,
  p4: ModelPoint
): boolean {
  const cross = (a: ModelPoint, b: ModelPoint, c: ModelPoint) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const onSpan = (a: ModelPoint, b: ModelPoint, c: ModelPoint) =>
    Math.min(a.x, b.x) - 1e-9 <= c.x &&
    c.x <= Math.max(a.x, b.x) + 1e-9 &&
    Math.min(a.y, b.y) - 1e-9 <= c.y &&
    c.y <= Math.max(a.y, b.y) + 1e-9;
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  if (((d1 > 0) !== (d2 > 0) || d1 === 0 || d2 === 0) && ((d3 > 0) !== (d4 > 0) || d3 === 0 || d4 === 0)) {
    // Straddling, or an endpoint lies on the other segment's line — confirm the
    // touching endpoints are within the spans rather than beyond them.
    if (d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0) return true;
    if (d1 === 0 && onSpan(p3, p4, p1)) return true;
    if (d2 === 0 && onSpan(p3, p4, p2)) return true;
    if (d3 === 0 && onSpan(p1, p2, p3)) return true;
    if (d4 === 0 && onSpan(p1, p2, p4)) return true;
    return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0);
  }
  return false;
}

/** Whether the point is inside the quad or on its boundary. */
export function pointInConvexQuad(p: ModelPoint, quad: ConvexQuad): boolean {
  const flat = degenerateSegment(quad);
  if (flat) return distanceToSegment(p.x, p.y, flat[0], flat[1]) <= 1e-9;
  return inwardHalfPlanes(quad).every(([nx, ny, c]) => nx * p.x + ny * p.y + c >= -1e-9);
}

/**
 * Whether segment a–b touches or crosses the quad — the crossing marquee
 * semantic. The same Liang–Barsky clip the axis-aligned version used, run
 * against the quad's four inward half-planes instead of four axis half-planes:
 * the segment hits iff its clipped parameter range is non-empty.
 */
export function segmentIntersectsConvexQuad(
  a: ModelPoint,
  b: ModelPoint,
  quad: ConvexQuad
): boolean {
  const flat = degenerateSegment(quad);
  if (flat) return segmentsIntersect(a, b, flat[0], flat[1]);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  for (const [nx, ny, c] of inwardHalfPlanes(quad)) {
    // Distance to the edge at t: dist(a) + t * rate.
    const dist = nx * a.x + ny * a.y + c;
    const rate = nx * dx + ny * dy;
    if (Math.abs(rate) < 1e-12) {
      if (dist < 0) return false; // parallel to this edge and outside it
      continue;
    }
    const t = -dist / rate;
    if (rate > 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t0 <= t1;
}

/**
 * Whether a circle *ring* (outline at radius `r`) touches the quad. True when
 * the ring crosses an edge or the quad encloses the ring, but not when the quad
 * sits wholly inside the ring without touching it — matching the axis-aligned
 * version. Holds iff the quad's nearest point to the centre is within `r` and
 * its farthest is at least `r`; for a convex polygon the farthest point is
 * always a corner.
 */
export function circleRingIntersectsConvexQuad(
  cx: number,
  cy: number,
  r: number,
  quad: ConvexQuad
): boolean {
  const centre = { x: cx, y: cy };
  const inside = pointInConvexQuad(centre, quad);
  let minDist = Infinity;
  let maxDist = 0;
  for (let i = 0; i < 4; i++) {
    const p = quad[i];
    const q = quad[(i + 1) % 4];
    minDist = Math.min(minDist, distanceToSegment(cx, cy, p, q));
    maxDist = Math.max(maxDist, Math.hypot(p.x - cx, p.y - cy));
  }
  return (inside ? 0 : minDist) <= r && r <= maxDist;
}
