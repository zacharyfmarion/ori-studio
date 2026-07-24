import type { FoldArtifacts, FoldDocument } from '../engine/types';
import type { OristudioCpDocumentSnapshot } from '../engine/oristudioCpTypes';
import {
  type CpSegment,
  flatPlaneAxes,
  resolveCpSegments,
  simulationFoldOf,
} from './creasePatternSegmentation';
import type { OristudioCpSelection } from './creasePatternViewport';

/**
 * Bridges the CP editor's crease selection to the fold-derived segmentation used
 * by the simulator and export paths. The editor tracks selection as 1-based
 * `line_segments` ids; the segmentation (see `creasePatternSegmentation`)
 * partitions the fold's faces into border-enclosed regions referenced by face
 * index. This module answers: "does the current selection correspond to exactly
 * one complete, self-contained, border-enclosed sub-pattern?".
 *
 * Coordinate note: the CP-model space (line-segment `a`/`b`), the exported fold,
 * and the simulation-fold plane are the *same* 2D coordinate space. The fold
 * export writes plain `[x, y]`; `prepareFoldModel` remaps each point via
 * `normalizePoint([x, y]) = [x, 0, y]`; and `flatPlaneAxes` reads the plane back
 * as `(x, z) = (x, y)`. The round trip is the identity, so a crease's endpoints
 * match a fold vertex's planar coordinates exactly (modulo quantization below).
 */
export interface SelectedSegmentMatch {
  /** The matched segment (from `resolveCpSegments`, so `id` is the shared key). */
  segment: CpSegment;
  /** Stable segment id — the scoping key for export and simulate. */
  segmentId: number;
  /**
   * The 1-based `line_segments` ids that make up this segment: every crease
   * (interior *and* its enclosing border creases) whose edge bounds one of the
   * segment's faces. Used for the flat-fold action and as the trigger predicate.
   */
  cpLineIds: number[];
}

/**
 * Coordinate quantization for matching crease endpoints to fold vertices. The
 * paper is normalized to roughly [-200, 200], and the two spaces are
 * bit-identical in practice, so micrometre-scale rounding only guards against
 * incidental float noise without ever merging distinct vertices.
 */
const COORD_QUANTIZE = 1e6;

function coordKey(x: number, y: number): string {
  return `${Math.round(x * COORD_QUANTIZE)}:${Math.round(y * COORD_QUANTIZE)}`;
}

function undirectedEdgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Per-segment sets of undirected edge keys, memoized by fold identity. */
const segmentEdgeSetsCache = new WeakMap<FoldDocument, Array<Set<string>>>();

function segmentEdgeSets(fold: FoldDocument, segments: CpSegment[]): Array<Set<string>> {
  const cached = segmentEdgeSetsCache.get(fold);
  if (cached && cached.length === segments.length) return cached;

  const [axisX, axisY] = flatPlaneAxes(fold);
  const coords = fold.vertices_coords ?? [];
  const faces = fold.faces_vertices ?? [];
  const vertexKey = (vertex: number): string => {
    const coord = coords[vertex];
    return coordKey(coord?.[axisX] ?? 0, coord?.[axisY] ?? 0);
  };

  const sets = segments.map((segment) => {
    const edges = new Set<string>();
    for (const faceIndex of segment.faceIndices) {
      const face = faces[faceIndex] ?? [];
      for (let i = 0; i < face.length; i += 1) {
        const a = face[i] ?? 0;
        const b = face[(i + 1) % face.length] ?? 0;
        if (a === b) continue;
        edges.add(undirectedEdgeKey(vertexKey(a), vertexKey(b)));
      }
    }
    return edges;
  });

  segmentEdgeSetsCache.set(fold, sets);
  return sets;
}

interface SegmentLineIds {
  document: OristudioCpDocumentSnapshot;
  /** `lineIds[i]` = sorted 1-based line ids belonging to `segments[i]`. */
  lineIds: number[][];
}

/**
 * Line-id assignment depends on both the fold (segment face edges) and the
 * document (crease coordinates), which move together on edit but the fold lags
 * asynchronously. Key by fold identity, then re-validate the document so a stale
 * pairing recomputes rather than returning a mismatched assignment.
 */
const segmentLineIdsCache = new WeakMap<FoldArtifacts, SegmentLineIds>();

function segmentLineIds(
  artifacts: FoldArtifacts,
  document: OristudioCpDocumentSnapshot,
  segments: CpSegment[]
): number[][] {
  const cached = segmentLineIdsCache.get(artifacts);
  if (cached && cached.document === document && cached.lineIds.length === segments.length) {
    return cached.lineIds;
  }

  const fold = simulationFoldOf(artifacts);
  const edgeSets = segmentEdgeSets(fold, segments);
  const lineIds: number[][] = segments.map(() => []);

  document.crease_pattern.line_segments.forEach((line, index) => {
    const key = undirectedEdgeKey(coordKey(line.a.x, line.a.y), coordKey(line.b.x, line.b.y));
    for (let s = 0; s < edgeSets.length; s += 1) {
      if (edgeSets[s]!.has(key)) lineIds[s]!.push(index + 1);
    }
  });

  for (const ids of lineIds) ids.sort((a, b) => a - b);
  segmentLineIdsCache.set(artifacts, { document, lineIds });
  return lineIds;
}

function sameIdSet(selection: readonly number[], segmentIds: readonly number[]): boolean {
  if (selection.length !== segmentIds.length) return false;
  const seen = new Set(selection);
  if (seen.size !== segmentIds.length) return false;
  return segmentIds.every((id) => seen.has(id));
}

/**
 * Resolve the current crease selection to the single border-enclosed segment it
 * exactly constitutes, or `null` when the selection is empty, spans more than one
 * region, or is only part of one. The selection must equal a segment's complete
 * crease set — which inherently includes that segment's enclosing border creases,
 * guaranteeing a complete foldable region.
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

  const lineIds = segmentLineIds(artifacts, document, segments);
  for (let s = 0; s < segments.length; s += 1) {
    const ids = lineIds[s]!;
    if (ids.length > 0 && sameIdSet(selection.lines, ids)) {
      const segment = segments[s]!;
      return { segment, segmentId: segment.id, cpLineIds: ids };
    }
  }
  return null;
}
