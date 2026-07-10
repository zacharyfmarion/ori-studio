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

  constructor(segments: readonly IndexedSegment[], cellSize?: number) {
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
    const meanLen = segments.length > 0 ? lenSum / segments.length : 1;
    this.cellSize = Math.max(1e-6, cellSize ?? meanLen);
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
