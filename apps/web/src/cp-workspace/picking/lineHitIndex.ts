import type { ModelPoint } from '../renderer/types';

/** A line segment in model coordinates, with the id reported on a hit. */
export interface IndexedSegment {
  id: number;
  a: ModelPoint;
  b: ModelPoint;
}

/**
 * Uniform-grid spatial index over line segments for pointer hit-testing.
 * Segments are binned into every grid cell their bounding box overlaps, so long
 * segments are found regardless of where along them the pointer lands.
 *
 * Query returns the nearest segment within `tolerance` (model units), or -1.
 */
export class LineHitIndex {
  private readonly cellSize: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly cells = new Map<number, IndexedSegment[]>();
  private readonly all: readonly IndexedSegment[];

  constructor(segments: readonly IndexedSegment[], cellSize?: number) {
    this.all = segments;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let lenSum = 0;
    for (const s of segments) {
      minX = Math.min(minX, s.a.x, s.b.x);
      minY = Math.min(minY, s.a.y, s.b.y);
      maxX = Math.max(maxX, s.a.x, s.b.x);
      maxY = Math.max(maxY, s.a.y, s.b.y);
      lenSum += Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    }
    // Cell ~ the mean segment length keeps buckets small without over-binning.
    // For a point cloud (zero-length segments, e.g. the vertex/point index)
    // meanLen is 0, so fall back to the mean spacing across the bounding box —
    // otherwise cellSize collapses toward 1e-6 and `query`'s reach explodes.
    const meanLen = segments.length > 0 ? lenSum / segments.length : 0;
    const span = Math.max(maxX - minX, maxY - minY);
    const spacing = span > 0 ? span / Math.max(1, Math.sqrt(segments.length)) : 1;
    this.cellSize = Math.max(1e-6, cellSize ?? (meanLen > 1e-9 ? meanLen : spacing));
    this.minX = Number.isFinite(minX) ? minX : 0;
    this.minY = Number.isFinite(minY) ? minY : 0;

    for (const s of segments) this.insert(s);
  }

  private key(cx: number, cy: number): number {
    // Cantor-ish pairing over signed cell indices.
    return cx * 73856093 + cy * 19349663;
  }

  private cellOf(x: number, y: number): { cx: number; cy: number } {
    return {
      cx: Math.floor((x - this.minX) / this.cellSize),
      cy: Math.floor((y - this.minY) / this.cellSize),
    };
  }

  private insert(s: IndexedSegment): void {
    const lo = this.cellOf(Math.min(s.a.x, s.b.x), Math.min(s.a.y, s.b.y));
    const hi = this.cellOf(Math.max(s.a.x, s.b.x), Math.max(s.a.y, s.b.y));
    for (let cx = lo.cx; cx <= hi.cx; cx++) {
      for (let cy = lo.cy; cy <= hi.cy; cy++) {
        const k = this.key(cx, cy);
        let bucket = this.cells.get(k);
        if (!bucket) {
          bucket = [];
          this.cells.set(k, bucket);
        }
        bucket.push(s);
      }
    }
  }

  /** Nearest segment id within `tolerance` model units of (x, y), or -1. */
  query(x: number, y: number, tolerance: number): number {
    const { cx, cy } = this.cellOf(x, y);
    // Widen the search by the tolerance so near-cell-boundary hits are found.
    const reach = Math.max(1, Math.ceil(tolerance / this.cellSize));
    // When the tolerance dwarfs the cell size, the neighbourhood scan would
    // touch more cells than there are segments; a flat scan is both cheaper and
    // immune to the reach blowing up (a huge tolerance must never freeze).
    const cellsToScan = (2 * reach + 1) ** 2;
    if (cellsToScan > this.all.length) return this.linearQuery(x, y, tolerance);
    let best = -1;
    let bestDist = tolerance;
    const seen = new Set<number>();
    for (let ox = -reach; ox <= reach; ox++) {
      for (let oy = -reach; oy <= reach; oy++) {
        const bucket = this.cells.get(this.key(cx + ox, cy + oy));
        if (!bucket) continue;
        for (const s of bucket) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          const d = distanceToSegment(x, y, s.a, s.b);
          if (d < bestDist) {
            bestDist = d;
            best = s.id;
          }
        }
      }
    }
    return best;
  }

  /** Fallback nearest-segment scan over every segment (grid-free). */
  private linearQuery(x: number, y: number, tolerance: number): number {
    let best = -1;
    let bestDist = tolerance;
    for (const s of this.all) {
      const d = distanceToSegment(x, y, s.a, s.b);
      if (d < bestDist) {
        bestDist = d;
        best = s.id;
      }
    }
    return best;
  }
}

/** Axis-aligned bounding box in model coordinates. */
export interface Aabb {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Whether segment a–b intersects (touches or crosses) the box — the crossing /
 * "touch" marquee semantic. Liang–Barsky clip: the segment hits the box iff its
 * clipped parameter range is non-empty.
 */
export function segmentIntersectsAabb(a: ModelPoint, b: ModelPoint, box: Aabb): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - box.minX, box.maxX - a.x, a.y - box.minY, box.maxY - a.y];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false; // parallel to this edge and outside it
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return t0 <= t1;
}

/**
 * Whether a circle *ring* (outline at radius `r`, the way packing circles are
 * drawn) intersects the box — the crossing / "touch" marquee semantic. True when
 * the ring crosses an edge or the box encloses the ring, but not when the box
 * sits wholly inside the ring without touching it. Holds iff the box's nearest
 * point to the centre is within `r` and its farthest point is at least `r`.
 */
export function circleRingIntersectsAabb(
  cx: number,
  cy: number,
  r: number,
  box: Aabb
): boolean {
  const nearX = Math.max(box.minX - cx, 0, cx - box.maxX);
  const nearY = Math.max(box.minY - cy, 0, cy - box.maxY);
  const minDist = Math.hypot(nearX, nearY);
  const farX = Math.max(cx - box.minX, box.maxX - cx);
  const farY = Math.max(cy - box.minY, box.maxY - cy);
  const maxDist = Math.hypot(farX, farY);
  return minDist <= r && r <= maxDist;
}

/** Shortest distance from point (px, py) to segment a–b. */
export function distanceToSegment(px: number, py: number, a: ModelPoint, b: ModelPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}
