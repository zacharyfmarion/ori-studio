import type { FoldArtifacts, FoldDocument } from '../engine/types';
import type { OristudioCpDocumentSnapshot } from '../engine/oristudioCpTypes';
import {
  type CpSegment,
  pointInSegment,
  resolveCpSegments,
  simulationFoldOf,
} from './creasePatternSegmentation';
import type { Point } from './geometry';
import type { OristudioCpSelection } from './creasePatternViewport';

/**
 * Bridges the CP editor's crease selection to the fold-derived segmentation used
 * by the simulator and export paths. The editor tracks selection as 1-based
 * `line_segments` ids; the segmentation (see `creasePatternSegmentation`)
 * partitions the fold's faces into border-enclosed regions. This module answers:
 * "is the selection exactly one complete, border-enclosed crease pattern?".
 *
 * A crease belongs to a region when it lies **geometrically inside** that
 * region's boundary (or on it) — not when it happens to bound one of the
 * region's faces. That distinction matters on real documents: face inference
 * leaves a slice of creases bounding no face at all, and an edge-membership test
 * can never attribute those to any region even though they sit plainly inside
 * one, so selecting a region could never match. Containment is also what the
 * user sees: "the creases inside these edges".
 *
 * Coordinate note: the CP-model space (line-segment `a`/`b`), the exported fold,
 * and the simulation-fold plane are the same 2D space. The fold export writes
 * plain `[x, y]`; `prepareFoldModel` remaps via `normalizePoint([x,y]) = [x,0,y]`;
 * `flatPlaneAxes` reads the plane back as `(x, z) = (x, y)`. Round trip is the
 * identity, so crease coordinates and segment boundaries are directly comparable.
 */
export interface SelectedSegmentMatch {
  /** The matched segment (from `resolveCpSegments`, so `id` is the shared key). */
  segment: CpSegment;
  /** Stable segment id — the scoping key for export and simulate. */
  segmentId: number;
  /**
   * The 1-based `line_segments` ids making up this region: every crease inside or
   * on its boundary. Used for the flat-fold action and as the trigger predicate.
   */
  cpLineIds: number[];
}

/** Tolerance for treating a crease midpoint as lying on a boundary ring. */
const ON_BOUNDARY_EPSILON = 1e-6;

const BORDER_ASSIGNMENT = 'B';

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function onSegmentBoundary(segment: CpSegment, point: Point): boolean {
  for (const ring of segment.boundary) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[i]!;
      const b = ring[j]!;
      // Cheap reject before the distance computation.
      if (
        point.x < Math.min(a.x, b.x) - ON_BOUNDARY_EPSILON ||
        point.x > Math.max(a.x, b.x) + ON_BOUNDARY_EPSILON ||
        point.y < Math.min(a.y, b.y) - ON_BOUNDARY_EPSILON ||
        point.y > Math.max(a.y, b.y) + ON_BOUNDARY_EPSILON
      ) {
        continue;
      }
      if (distanceToSegment(point, a, b) < ON_BOUNDARY_EPSILON) return true;
    }
  }
  return false;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Whether every edge enclosing this region is a border ('B') crease — the
 * "all the exterior creases are edges" half of the rule. A region whose rim is
 * an ordinary mountain/valley crease is not a self-contained crease pattern, so
 * it is not offered for folding, export, or simulation.
 */
function boundaryIsAllBorder(fold: FoldDocument, segment: CpSegment): boolean {
  const faces = fold.faces_vertices ?? [];
  const useCount = new Map<string, number>();
  for (const faceIndex of segment.faceIndices) {
    const face = faces[faceIndex] ?? [];
    for (let i = 0; i < face.length; i += 1) {
      const a = face[i] ?? 0;
      const b = face[(i + 1) % face.length] ?? 0;
      if (a === b) continue;
      const key = edgeKey(a, b);
      useCount.set(key, (useCount.get(key) ?? 0) + 1);
    }
  }

  const assignmentByKey = new Map<string, string>();
  const assignments = fold.edges_assignment ?? [];
  (fold.edges_vertices ?? []).forEach((edge, index) => {
    assignmentByKey.set(edgeKey(edge[0], edge[1]), assignments[index] ?? 'U');
  });

  for (const [key, count] of useCount) {
    // Used once by this region's faces ⇒ it is on the region's rim.
    if (count !== 1) continue;
    if (assignmentByKey.get(key) !== BORDER_ASSIGNMENT) return false;
  }
  return true;
}

interface SegmentContainment {
  document: OristudioCpDocumentSnapshot;
  /** `lineIds[i]` = sorted 1-based line ids contained by `segments[i]`. */
  lineIds: number[][];
  /** `eligible[i]` = whether `segments[i]` is fully rimmed by border creases. */
  eligible: boolean[];
}

/**
 * Containment depends on both the fold (region boundaries) and the document
 * (crease coordinates). Key by artifacts identity, then re-validate the document
 * so a stale pairing recomputes rather than returning a mismatched assignment.
 */
const containmentCache = new WeakMap<FoldArtifacts, SegmentContainment>();

function segmentContainment(
  artifacts: FoldArtifacts,
  document: OristudioCpDocumentSnapshot,
  segments: CpSegment[]
): SegmentContainment {
  const cached = containmentCache.get(artifacts);
  if (cached && cached.document === document && cached.lineIds.length === segments.length) {
    return cached;
  }

  const fold = simulationFoldOf(artifacts);
  const lineIds: number[][] = segments.map(() => []);
  const eligible = segments.map((segment) => boundaryIsAllBorder(fold, segment));

  document.crease_pattern.line_segments.forEach((line, index) => {
    const midpoint = { x: (line.a.x + line.b.x) / 2, y: (line.a.y + line.b.y) / 2 };
    segments.forEach((segment, s) => {
      const bounds = segment.bounds;
      if (
        midpoint.x < bounds.minX - ON_BOUNDARY_EPSILON ||
        midpoint.x > bounds.maxX + ON_BOUNDARY_EPSILON ||
        midpoint.y < bounds.minY - ON_BOUNDARY_EPSILON ||
        midpoint.y > bounds.maxY + ON_BOUNDARY_EPSILON
      ) {
        return;
      }
      if (pointInSegment(segment, midpoint) || onSegmentBoundary(segment, midpoint)) {
        lineIds[s]!.push(index + 1);
      }
    });
  });

  for (const ids of lineIds) ids.sort((a, b) => a - b);
  const result: SegmentContainment = { document, lineIds, eligible };
  containmentCache.set(artifacts, result);
  return result;
}

function sameIdSet(selection: readonly number[], segmentIds: readonly number[]): boolean {
  if (selection.length !== segmentIds.length) return false;
  const seen = new Set(selection);
  if (seen.size !== segmentIds.length) return false;
  return segmentIds.every((id) => seen.has(id));
}

/**
 * Resolve the current crease selection to the single border-enclosed crease
 * pattern it exactly constitutes, or `null` when the selection is empty, spans
 * more than one region, or leaves part of one unselected. The selection must be
 * exactly the creases inside (or on) one region's rim, and that rim must be all
 * border creases — so the result is always a complete, self-contained pattern.
 *
 * Only `selection.lines` participates; selected points/circles/texts are ignored.
 */
export function resolveSelectedSegment(
  document: OristudioCpDocumentSnapshot | null | undefined,
  selection: OristudioCpSelection,
  artifacts: FoldArtifacts | null | undefined
): SelectedSegmentMatch | null {
  if (!document || !artifacts || selection.lines.length === 0) return null;

  const segments = resolveCpSegments(artifacts);
  if (segments.length === 0) return null;

  const { lineIds, eligible } = segmentContainment(artifacts, document, segments);
  for (let s = 0; s < segments.length; s += 1) {
    if (!eligible[s]) continue;
    const ids = lineIds[s]!;
    if (ids.length > 0 && sameIdSet(selection.lines, ids)) {
      const segment = segments[s]!;
      return { segment, segmentId: segment.id, cpLineIds: ids };
    }
  }
  return null;
}
