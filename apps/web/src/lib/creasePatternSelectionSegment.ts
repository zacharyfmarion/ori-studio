import type { FoldArtifacts, FoldDocument } from '../engine/types';
import type { OristudioCpDocumentSnapshot } from '../engine/oristudioCpTypes';
import {
  type CpSegment,
  buildAssignmentByKey,
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
function rimAssignmentCounts(fold: FoldDocument, segment: CpSegment): { rim: number; nonBorder: number } {
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

  // Shared with segmentation so a border overdrawn by another crease still reads
  // as a border here too (see buildAssignmentByKey's precedence).
  const assignmentByKey = buildAssignmentByKey(fold);

  let rim = 0;
  let nonBorder = 0;
  for (const [key, count] of useCount) {
    // Used once by this region's faces ⇒ it is on the region's rim.
    if (count !== 1) continue;
    rim += 1;
    if (assignmentByKey.get(key) !== BORDER_ASSIGNMENT) nonBorder += 1;
  }
  return { rim, nonBorder };
}

interface SegmentContainment {
  document: OristudioCpDocumentSnapshot;
  /** `lineIds[i]` = sorted 1-based line ids contained by `segments[i]`. */
  lineIds: number[][];
  /** `eligible[i]` = whether `segments[i]` is fully rimmed by border creases. */
  eligible: boolean[];
  /** Rim edge totals per segment, retained for `explainSelectedSegment`. */
  rim: Array<{ rim: number; nonBorder: number }>;
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
  const startedAt = performance.now();
  const missReason = !cached
    ? 'no-entry-for-artifacts'
    : cached.document !== document
      ? 'document-snapshot-changed'
      : 'segment-count-changed';

  const fold = simulationFoldOf(artifacts);
  const lineIds: number[][] = segments.map(() => []);
  const rim = segments.map((segment) => rimAssignmentCounts(fold, segment));
  const eligible = rim.map((counts) => counts.nonBorder === 0);

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
  const result: SegmentContainment = { document, lineIds, eligible, rim };
  containmentCache.set(artifacts, result);
  if (import.meta.env.DEV) {
     
    console.debug(
      `[cp-toolbar] containment recomputed in ${Math.round(performance.now() - startedAt)}ms ` +
        `(${missReason}, ${document.crease_pattern.line_segments.length} creases × ${segments.length} regions)`
    );
  }
  return result;
}

function sameIdSet(selection: readonly number[], segmentIds: readonly number[]): boolean {
  if (selection.length !== segmentIds.length) return false;
  const seen = new Set(selection);
  if (seen.size !== segmentIds.length) return false;
  return segmentIds.every((id) => seen.has(id));
}

export interface SelectionSegmentDiagnosis {
  /** Why no match, when there is none — the first failing precondition. */
  reason:
    | 'matched'
    | 'no-document'
    | 'no-artifacts'
    | 'empty-selection'
    | 'no-segments'
    | 'no-region-matches';
  documentLines: number;
  selectedLines: number;
  foldFaces: number;
  segments: number;
  /** Per-region detail, ranked by how close the selection came to matching. */
  regions: Array<{
    id: number;
    rimEdges: number;
    rimNonBorder: number;
    eligible: boolean;
    containedLines: number;
    /** Selected but not in this region. */
    extraInSelection: number;
    /** In this region but not selected. */
    missingFromSelection: number;
    /** Colour tallies for the differing creases, to characterise the mismatch. */
    extraByColor: Record<string, number>;
    missingByColor: Record<string, number>;
    /** A few differing crease ids with their geometry, for inspection on canvas. */
    extraSample: DiagnosisLine[];
    missingSample: DiagnosisLine[];
  }>;
}

export interface DiagnosisLine {
  id: number;
  color: string;
  a: { x: number; y: number };
  b: { x: number; y: number };
}

const DIAGNOSIS_SAMPLE_LIMIT = 8;

function describeLines(
  document: OristudioCpDocumentSnapshot,
  ids: number[]
): { byColor: Record<string, number>; sample: DiagnosisLine[] } {
  const byColor: Record<string, number> = {};
  const sample: DiagnosisLine[] = [];
  for (const id of ids) {
    const line = document.crease_pattern.line_segments[id - 1];
    if (!line) continue;
    byColor[line.color] = (byColor[line.color] ?? 0) + 1;
    if (sample.length < DIAGNOSIS_SAMPLE_LIMIT) {
      sample.push({ id, color: line.color, a: { ...line.a }, b: { ...line.b } });
    }
  }
  return { byColor, sample };
}

/**
 * Explain what the resolver saw. Every rejection path in
 * {@link resolveSelectedSegment} collapses to `null`, which is indistinguishable
 * from "no match" in the UI; this reports which precondition actually failed and
 * how far each region was from matching. Intended for the dev console.
 */
export function explainSelectedSegment(
  document: OristudioCpDocumentSnapshot | null | undefined,
  selection: OristudioCpSelection,
  artifacts: FoldArtifacts | null | undefined
): SelectionSegmentDiagnosis {
  const base: SelectionSegmentDiagnosis = {
    reason: 'matched',
    documentLines: document?.crease_pattern.line_segments.length ?? 0,
    selectedLines: selection.lines.length,
    foldFaces: artifacts ? (simulationFoldOf(artifacts).faces_vertices?.length ?? 0) : 0,
    segments: 0,
    regions: [],
  };
  if (!document) return { ...base, reason: 'no-document' };
  if (!artifacts) return { ...base, reason: 'no-artifacts' };
  if (selection.lines.length === 0) return { ...base, reason: 'empty-selection' };

  const segments = resolveCpSegments(artifacts);
  base.segments = segments.length;
  if (segments.length === 0) return { ...base, reason: 'no-segments' };

  const { lineIds, eligible, rim } = segmentContainment(artifacts, document, segments);
  const selected = new Set(selection.lines);
  const regions = segments.map((segment, s) => {
    const ids = lineIds[s]!;
    const contained = new Set(ids);
    const extraIds = [...selected].filter((id) => !contained.has(id));
    const missingIds = ids.filter((id) => !selected.has(id));
    const extra = describeLines(document, extraIds);
    const missing = describeLines(document, missingIds);
    return {
      id: segment.id,
      rimEdges: rim[s]!.rim,
      rimNonBorder: rim[s]!.nonBorder,
      eligible: eligible[s]!,
      containedLines: ids.length,
      extraInSelection: extraIds.length,
      missingFromSelection: missingIds.length,
      extraByColor: extra.byColor,
      missingByColor: missing.byColor,
      extraSample: extra.sample,
      missingSample: missing.sample,
    };
  });
  regions.sort(
    (a, b) =>
      a.extraInSelection + a.missingFromSelection - (b.extraInSelection + b.missingFromSelection)
  );

  const matched = regions.some(
    (r) => r.eligible && r.containedLines > 0 && r.extraInSelection === 0 && r.missingFromSelection === 0
  );
  return { ...base, reason: matched ? 'matched' : 'no-region-matches', regions };
}

/**
 * The 1-based crease ids inside (or on the rim of) one region.
 *
 * The same containment {@link resolveSelectedSegment} matches a selection
 * against, exposed for callers that already know which region they want — an
 * inline simulation recording the provenance of what it is about to simulate,
 * rather than asking which region a selection happens to be.
 */
export function segmentContainedLineIds(
  document: OristudioCpDocumentSnapshot | null | undefined,
  artifacts: FoldArtifacts | null | undefined,
  segment: CpSegment
): number[] {
  if (!document || !artifacts) return [];
  const segments = resolveCpSegments(artifacts);
  const index = segments.findIndex((candidate) => candidate.id === segment.id);
  if (index < 0) return [];
  return segmentContainment(artifacts, document, segments).lineIds[index] ?? [];
}

/**
 * Resolve the current crease selection to the single border-enclosed crease
 * pattern it exactly constitutes, or `null` when the selection is empty, spans
 * more than one region, or leaves part of one unselected. The selection must be
 * exactly the creases inside (or on) one region's rim, and that rim must be all
 * border creases — so the result is always a complete, self-contained pattern.
 *
 * Only `selection.lines` participates; selected points/circles/texts are ignored.
 * When this returns `null` and you need to know why, see
 * {@link explainSelectedSegment}.
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
