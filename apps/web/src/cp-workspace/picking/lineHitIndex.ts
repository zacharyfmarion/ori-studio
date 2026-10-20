import type { ModelPoint } from '../renderer/types';

/** A line segment in model coordinates, with the id reported on a hit. */
export interface IndexedSegment {
  id: number;
  a: ModelPoint;
  b: ModelPoint;
}

/**
 * Points as zero-length segments, packed for {@link LineHitIndex} — so the same
 * distance query finds the nearest point (id = index + 1).
 */
export function pointsAsSegmentEndpoints(points: readonly ModelPoint[]): Float64Array {
  const endpoints = new Float64Array(points.length * 4);
  for (let i = 0; i < points.length; i += 1) {
    const { x, y } = points[i]!;
    endpoints[i * 4] = x;
    endpoints[i * 4 + 1] = y;
    endpoints[i * 4 + 2] = x;
    endpoints[i * 4 + 3] = y;
  }
  return endpoints;
}

/**
 * Uniform-grid spatial index over line segments for pointer hit-testing.
 * Segments are binned into every grid cell their bounding box overlaps, so long
 * segments are found regardless of where along them the pointer lands.
 *
 * Query returns the nearest segment within `tolerance` (model units), or -1.
 *
 * Built from segment objects, or from packed endpoints — `[ax, ay, bx, by]` per
 * segment, id = index + 1, the shape the crease-pattern geometry transport
 * holds its lines in. Either way the index keeps coordinates in one typed array
 * and its cells hold entry numbers, so indexing half a million creases makes no
 * object per crease. The answers are the same for both: entries are inserted,
 * scanned and compared in the same order with the same arithmetic.
 */
export class LineHitIndex {
  private readonly cellSize: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly cells = new Map<number, number[]>();
  /** `[ax, ay, bx, by]` per entry. */
  private readonly coords: Float64Array;
  private readonly count: number;
  /** The objects this was built from, which `segmentsNear` hands back; null when packed. */
  private readonly segments: readonly IndexedSegment[] | null;

  constructor(segments: readonly IndexedSegment[] | Float64Array, cellSize?: number) {
    if (segments instanceof Float64Array) {
      this.coords = segments;
      this.segments = null;
    } else {
      this.coords = new Float64Array(segments.length * 4);
      segments.forEach((s, i) => {
        this.coords[i * 4] = s.a.x;
        this.coords[i * 4 + 1] = s.a.y;
        this.coords[i * 4 + 2] = s.b.x;
        this.coords[i * 4 + 3] = s.b.y;
      });
      this.segments = segments;
    }
    const coords = this.coords;
    this.count = coords.length / 4;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let lenSum = 0;
    for (let i = 0; i < this.count; i += 1) {
      const ax = coords[i * 4]!;
      const ay = coords[i * 4 + 1]!;
      const bx = coords[i * 4 + 2]!;
      const by = coords[i * 4 + 3]!;
      minX = Math.min(minX, ax, bx);
      minY = Math.min(minY, ay, by);
      maxX = Math.max(maxX, ax, bx);
      maxY = Math.max(maxY, ay, by);
      lenSum += Math.hypot(bx - ax, by - ay);
    }
    // Cell ~ the mean segment length keeps buckets small without over-binning.
    // For a point cloud (zero-length segments, e.g. the vertex/point index)
    // meanLen is 0, so fall back to the mean spacing across the bounding box —
    // otherwise cellSize collapses toward 1e-6 and `query`'s reach explodes.
    const meanLen = this.count > 0 ? lenSum / this.count : 0;
    const span = Math.max(maxX - minX, maxY - minY);
    const spacing = span > 0 ? span / Math.max(1, Math.sqrt(this.count)) : 1;
    this.cellSize = Math.max(1e-6, cellSize ?? (meanLen > 1e-9 ? meanLen : spacing));
    this.minX = Number.isFinite(minX) ? minX : 0;
    this.minY = Number.isFinite(minY) ? minY : 0;

    for (let i = 0; i < this.count; i += 1) this.insert(i);
  }

  private key(cx: number, cy: number): number {
    // Cantor-ish pairing over signed cell indices.
    return cx * 73856093 + cy * 19349663;
  }

  private cellX(x: number): number {
    return Math.floor((x - this.minX) / this.cellSize);
  }

  private cellY(y: number): number {
    return Math.floor((y - this.minY) / this.cellSize);
  }

  private insert(entry: number): void {
    const c = this.coords;
    const ax = c[entry * 4]!;
    const ay = c[entry * 4 + 1]!;
    const bx = c[entry * 4 + 2]!;
    const by = c[entry * 4 + 3]!;
    const loX = this.cellX(Math.min(ax, bx));
    const loY = this.cellY(Math.min(ay, by));
    const hiX = this.cellX(Math.max(ax, bx));
    const hiY = this.cellY(Math.max(ay, by));
    for (let cx = loX; cx <= hiX; cx++) {
      for (let cy = loY; cy <= hiY; cy++) {
        const k = this.key(cx, cy);
        let bucket = this.cells.get(k);
        if (!bucket) {
          bucket = [];
          this.cells.set(k, bucket);
        }
        bucket.push(entry);
      }
    }
  }

  private idOf(entry: number): number {
    return this.segments ? this.segments[entry]!.id : entry + 1;
  }

  private distanceTo(entry: number, x: number, y: number): number {
    const c = this.coords;
    return distanceToSegmentCoords(x, y, c[entry * 4]!, c[entry * 4 + 1]!, c[entry * 4 + 2]!, c[entry * 4 + 3]!);
  }

  private segmentOf(entry: number): IndexedSegment {
    if (this.segments) return this.segments[entry]!;
    const c = this.coords;
    return {
      id: entry + 1,
      a: { x: c[entry * 4]!, y: c[entry * 4 + 1]! },
      b: { x: c[entry * 4 + 2]!, y: c[entry * 4 + 3]! },
    };
  }

  /** Nearest segment id within `tolerance` model units of (x, y), or -1. */
  query(x: number, y: number, tolerance: number): number {
    const cx = this.cellX(x);
    const cy = this.cellY(y);
    // Widen the search by the tolerance so near-cell-boundary hits are found.
    const reach = Math.max(1, Math.ceil(tolerance / this.cellSize));
    // When the tolerance dwarfs the cell size, the neighbourhood scan would
    // touch more cells than there are segments; a flat scan is both cheaper and
    // immune to the reach blowing up (a huge tolerance must never freeze).
    const cellsToScan = (2 * reach + 1) ** 2;
    if (cellsToScan > this.count) return this.linearQuery(x, y, tolerance);
    let best = -1;
    let bestDist = tolerance;
    const seen = new Set<number>();
    for (let ox = -reach; ox <= reach; ox++) {
      for (let oy = -reach; oy <= reach; oy++) {
        const bucket = this.cells.get(this.key(cx + ox, cy + oy));
        if (!bucket) continue;
        for (const entry of bucket) {
          const id = this.idOf(entry);
          if (seen.has(id)) continue;
          seen.add(id);
          const d = this.distanceTo(entry, x, y);
          if (d < bestDist) {
            bestDist = d;
            best = id;
          }
        }
      }
    }
    return best;
  }

  /**
   * Every segment within `tolerance` model units of (x, y), in no order — for
   * a caller that needs the pairs near a point rather than the one nearest,
   * such as the crossings of segments the index holds unsplit.
   */
  segmentsNear(x: number, y: number, tolerance: number): IndexedSegment[] {
    const cx = this.cellX(x);
    const cy = this.cellY(y);
    const reach = Math.max(1, Math.ceil(tolerance / this.cellSize));
    // As in `query`: past this many cells a flat scan is the cheaper one.
    if ((2 * reach + 1) ** 2 > this.count) {
      const near: IndexedSegment[] = [];
      for (let entry = 0; entry < this.count; entry += 1) {
        if (this.distanceTo(entry, x, y) <= tolerance) near.push(this.segmentOf(entry));
      }
      return near;
    }
    const near: IndexedSegment[] = [];
    const seen = new Set<number>();
    for (let ox = -reach; ox <= reach; ox++) {
      for (let oy = -reach; oy <= reach; oy++) {
        const bucket = this.cells.get(this.key(cx + ox, cy + oy));
        if (!bucket) continue;
        for (const entry of bucket) {
          const id = this.idOf(entry);
          if (seen.has(id)) continue;
          seen.add(id);
          if (this.distanceTo(entry, x, y) <= tolerance) near.push(this.segmentOf(entry));
        }
      }
    }
    return near;
  }

  /** Fallback nearest-segment scan over every segment (grid-free). */
  private linearQuery(x: number, y: number, tolerance: number): number {
    let best = -1;
    let bestDist = tolerance;
    for (let entry = 0; entry < this.count; entry += 1) {
      const d = this.distanceTo(entry, x, y);
      if (d < bestDist) {
        bestDist = d;
        best = this.idOf(entry);
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

/** Shortest distance from point (px, py) to segment a–b. */
export function distanceToSegment(px: number, py: number, a: ModelPoint, b: ModelPoint): number {
  return distanceToSegmentCoords(px, py, a.x, a.y, b.x, b.y);
}

/** {@link distanceToSegment} over bare coordinates. */
export function distanceToSegmentCoords(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
