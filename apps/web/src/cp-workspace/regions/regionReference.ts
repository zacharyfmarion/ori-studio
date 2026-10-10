/**
 * A region of a crease pattern, remembered by its shape: the reference an
 * inline simulation window and a Diagram step keep to the pattern they show
 * (implementation-plans/diagram-workspace.md, D3).
 *
 * Segment ids are positional and renumber after any edit, so a region's
 * identity is its boundary — the rings of its rim — and the id is only a hint
 * tried first. `bounds` is the box its creases are re-chosen from and the
 * fingerprint taken over.
 *
 * Carved out of `InlineSimulation`'s `sourceBoundary`, `sourceBounds` and
 * `segmentIdHint`, so both owners match regions by one rule.
 */
import type { CpSegment } from '../../lib/creasePatternSegmentation';
import type { Point } from '../../lib/geometry';
import type { FoldedSourceBounds } from '../folded/foldedFigureStaleness';

export interface RegionReference {
  /** The region's rim, as rings: its identity. */
  boundary: Point[][];
  /** The box its creases are re-chosen from. */
  bounds: FoldedSourceBounds;
  /** The segment's id when it was taken: a shortcut, never trusted alone. */
  segmentIdHint: number | null;
}

/** The reference to a segment as it is now. */
export function regionReferenceFor(segment: CpSegment): RegionReference {
  return {
    boundary: segment.boundary.map((ring) => ring.map((point) => ({ x: point.x, y: point.y }))),
    bounds: { ...segment.bounds },
    segmentIdHint: segment.id,
  };
}

/** Squared distance between two points, for the boundary comparison below. */
function distanceSq(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Tolerance for calling two boundary rings the same, in model units. Regions are
 * re-derived from the same coordinates, so a match is normally exact; this only
 * absorbs float noise from the fold round trip.
 */
const BOUNDARY_EPSILON = 1e-6;

/**
 * The ring with consecutive points in the same place collapsed to one, wrap
 * included.
 *
 * A repeat makes its neighbour's collinearity test meaningless — a point is
 * always exactly on a line that starts at its own position — so a pair of
 * repeats takes a genuine corner down with it. Uncontrived rings have no
 * repeats, and every shape checked here is unaffected by this pass; it is here so
 * that one does not silently cost the reduction, which is what a degenerate ring
 * falling back to its input amounts to.
 */
function withoutRepeatedPoints(ring: readonly Point[]): Point[] {
  const epsilon = BOUNDARY_EPSILON * BOUNDARY_EPSILON;
  const points: Point[] = [];
  for (const point of ring) {
    const last = points[points.length - 1];
    if (last && distanceSq(last, point) <= epsilon) continue;
    points.push(point);
  }
  // The ring closes, so the last point neighbours the first.
  while (points.length > 1 && distanceSq(points[0]!, points[points.length - 1]!) <= epsilon) {
    points.pop();
  }
  return points;
}

/**
 * The ring's corners: the same closed loop with vertices that merely subdivide a
 * straight edge removed.
 *
 * A region's rim vertices are wherever something *met* the border — so a crease
 * ending on the rim puts a vertex there, and editing that crease takes it away
 * again, leaving the region an identical polygon described by a different list of
 * points. Comparing the lists directly made that read as a different region:
 * a window over a 400x400 region whose ring lost 6 of its 52 points reported its
 * region as gone, which is to say it stopped resolving on exactly the edits
 * `Rebuild from the current creases` exists to absorb. It could then never be
 * rebuilt, and reloading the file left it a permanently empty frame.
 *
 * Dropping collinear vertices is not a loosening of the test — the polygon is
 * unchanged, so the guarantee that matters (a window never silently re-points at
 * a *different* region) is untouched. An L is still not the region in its notch,
 * and a frame is still not the square inside it.
 *
 * Each vertex is judged against its **original** neighbours, so any number of
 * points strung along one straight edge all drop in a single pass — they are all
 * on the line their neighbours span.
 */
export function ringCorners(ring: readonly Point[]): Point[] {
  const points = withoutRepeatedPoints(ring);
  if (points.length < 3) return [...ring];
  const corners: Point[] = [];
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const previous = points[(i - 1 + n) % n]!;
    const current = points[i]!;
    const next = points[(i + 1) % n]!;
    const spanX = next.x - previous.x;
    const spanY = next.y - previous.y;
    const span = Math.hypot(spanX, spanY);
    // Neighbours in the same place say nothing about `current`; keep it rather
    // than divide by zero.
    if (span === 0) {
      corners.push(current);
      continue;
    }
    // Perpendicular distance from the line the neighbours span.
    const cross = (current.x - previous.x) * spanY - (current.y - previous.y) * spanX;
    if (Math.abs(cross) / span > BOUNDARY_EPSILON) corners.push(current);
  }
  // A ring of no corners is degenerate — every point on one line, so it encloses
  // nothing. Hand back what we were given rather than an empty loop; the caller's
  // comparison then fails on the shape rather than on this.
  return corners.length >= 3 ? corners : [...ring];
}

/**
 * Whether two rings describe the same closed loop, allowing for a different
 * starting vertex, winding, or subdivision of its edges — all three are
 * artifacts of how the ring was traced, not of the region.
 */
export function ringsMatch(a: readonly Point[], b: readonly Point[]): boolean {
  const left = ringCorners(a);
  const right = ringCorners(b);
  if (left.length !== right.length || left.length === 0) return left.length === right.length;
  const n = left.length;
  const epsilon = BOUNDARY_EPSILON * BOUNDARY_EPSILON;
  for (const reversed of [false, true]) {
    const candidate = reversed ? [...right].reverse() : right;
    for (let offset = 0; offset < n; offset += 1) {
      let matched = true;
      for (let i = 0; i < n; i += 1) {
        if (distanceSq(left[i]!, candidate[(i + offset) % n]!) > epsilon) {
          matched = false;
          break;
        }
      }
      if (matched) return true;
    }
  }
  return false;
}

/** Twice the signed area of a ring; sign is winding, magnitude is size. */
function ringArea2(ring: readonly Point[]): number {
  let total = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    total += (ring[j]!.x - ring[i]!.x) * (ring[j]!.y + ring[i]!.y);
  }
  return total;
}

/**
 * The ring that encloses the region: the largest by absolute area.
 *
 * Chosen by area rather than by position, because the tracing order of rings is
 * an implementation detail of how the region's rim was walked.
 */
export function outerRing(rings: readonly Point[][]): Point[] | null {
  let best: Point[] | null = null;
  let bestArea = -1;
  for (const ring of rings) {
    const area = Math.abs(ringArea2(ring));
    if (area > bestArea) {
      bestArea = area;
      best = ring as Point[];
    }
  }
  return best;
}

/**
 * Whether two boundaries describe the same region.
 *
 * Compares **outer rings only**. A region's holes are not part of its identity:
 * drawing any interior crease re-infers the faces and can open new untriangulated
 * pockets, so a region that had one ring before an edit routinely has several
 * after. Requiring every ring to match would make a region unrecognisable after
 * exactly the edit that refreshing exists to absorb.
 *
 * The outer ring still separates the cases a bounding box cannot: an L from the
 * region in its notch, a frame from the square inside it, and one tessellation
 * unit from the next.
 */
export function boundariesMatch(a: readonly Point[][], b: readonly Point[][]): boolean {
  const outerA = outerRing(a);
  const outerB = outerRing(b);
  if (!outerA || !outerB) return false;
  return ringsMatch(outerA, outerB);
}

/**
 * Find the segment a reference names, in a freshly computed segmentation.
 *
 * Boundary match, not nearest-box: returning the closest region when the real
 * one is gone is how a window ends up silently simulating something else, or a
 * step silently showing another pattern. Null means the region genuinely
 * stopped existing — merged, split, or its rim stopped being all-border.
 *
 * `segmentIdHint` is tried first only as a shortcut, and only when its boundary
 * still matches; it is never trusted on its own.
 */
export function resolveRegion(
  reference: Pick<RegionReference, 'boundary' | 'segmentIdHint'>,
  segments: readonly CpSegment[]
): CpSegment | null {
  const { boundary, segmentIdHint } = reference;
  if (boundary.length === 0) return null;
  const hinted =
    segmentIdHint === null ? undefined : segments.find((segment) => segment.id === segmentIdHint);
  if (hinted && boundariesMatch(boundary, hinted.boundary)) return hinted;
  return segments.find((segment) => boundariesMatch(boundary, segment.boundary)) ?? null;
}

// ---------------------------------------------------------------------------
// Reading a reference back from a file

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readPoint(value: unknown): Point | null {
  if (!isRecord(value)) return null;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  return x === null || y === null ? null : { x, y };
}

/** Rings of a region's rim. Any malformed ring invalidates the whole boundary. */
export function readRegionBoundary(value: unknown): Point[][] | null {
  if (!Array.isArray(value)) return null;
  const rings: Point[][] = [];
  for (const ring of value) {
    if (!Array.isArray(ring)) return null;
    const points: Point[] = [];
    for (const entry of ring) {
      const point = readPoint(entry);
      if (!point) return null;
      points.push(point);
    }
    rings.push(points);
  }
  return rings;
}

export function readFoldedSourceBounds(value: unknown): FoldedSourceBounds | null {
  if (!isRecord(value)) return null;
  const minX = finiteNumber(value.minX);
  const minY = finiteNumber(value.minY);
  const maxX = finiteNumber(value.maxX);
  const maxY = finiteNumber(value.maxY);
  if (minX === null || minY === null || maxX === null || maxY === null) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * A reference as a file holds it, or null: a region needs a non-empty rim and
 * a box, or it can never be found again.
 */
export function readRegionReference(value: unknown): RegionReference | null {
  if (!isRecord(value)) return null;
  const boundary = readRegionBoundary(value.boundary);
  const bounds = readFoldedSourceBounds(value.bounds);
  if (!boundary || boundary.length === 0 || !bounds) return null;
  return { boundary, bounds, segmentIdHint: finiteNumber(value.segmentIdHint) };
}
