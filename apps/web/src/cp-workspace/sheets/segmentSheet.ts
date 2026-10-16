/**
 * A FOLD segment as the shared sheet card takes it.
 *
 * The Simulate rail's reading of the document: `resolveCpSegments` has already
 * split the fold into its patterns, and each one's lines are the edges of its
 * faces (`segmentEdges`) — plus any edge that lies on no face but inside the
 * segment, such as an aux line a source laid over the paper — read back into
 * model space through the fold's own `flatPlaneReader`; the base fold is y-down
 * like the canvas, so nothing here flips. The References rail reads the same
 * card out of a precrease component (`references/referencesSheets`); both end
 * in `fitSheetThumbnail`.
 */
import { BoundsIndex } from '../../lib/boundsIndex';
import type { FoldDocument } from '../../engine/types';
import {
  flatPlaneReader,
  buildAssignmentByKey,
  pointInSegment,
  pointOnSegmentBoundary,
  segmentEdges,
  type CpSegment,
  type SegmentEdge,
} from '../../lib/creasePatternSegmentation';
import {
  fitSheetThumbnail,
  type SheetStroke,
  type SheetStrokeRole,
  type SheetThumbnail,
} from './sheetThumbnail';

/**
 * What an edge is on the paper, from its assignment: the boundary, a cut or a
 * join is the paper's edge; `M` and `V` the folds; `F` an aux line, as the
 * kernel exports a cyan crease; anything else a crease with no direction. The
 * same roles the References rail reads off the same crease's colour.
 */
function strokeRole(assignment: string): SheetStrokeRole {
  switch (assignment) {
    case 'B':
    case 'C':
    case 'J':
      return 'edge';
    case 'M':
      return 'mountain';
    case 'V':
      return 'valley';
    case 'F':
      return 'aux';
    default:
      return 'unassigned';
  }
}

/** Derived only from an immutable FOLD snapshot, shared by every sheet consumer. */
function sheetGeometry(fold: FoldDocument) {
  const cached = geometryCache.get(fold);
  if (cached) return cached;
  const onFace = new Set<string>();
  for (const face of fold.faces_vertices ?? []) {
    for (let i = 0; i < face.length; i++) {
      const a = face[i] ?? 0,
        b = face[(i + 1) % face.length] ?? 0;
      onFace.add(a < b ? `${a}_${b}` : `${b}_${a}`);
    }
  }
  const readPoint = flatPlaneReader(fold),
    coords = fold.vertices_coords ?? [];
  const loose: Array<{ edge: SegmentEdge; middle: { x: number; y: number } }> = [];
  (fold.edges_vertices ?? []).forEach(([a, b], index) => {
    if (a === undefined || b === undefined || a === b || onFace.has(a < b ? `${a}_${b}` : `${b}_${a}`))
      return;
    const from = readPoint(coords[a]),
      to = readPoint(coords[b]);
    loose.push({
      edge: { a, b, assignment: fold.edges_assignment?.[index] ?? 'U' },
      middle: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
    });
  });
  const result = {
    readPoint,
    assignmentByKey: buildAssignmentByKey(fold),
    loose,
    index: new BoundsIndex(loose.map(({ middle: p }) => ({ minX: p.x, maxX: p.x, minY: p.y, maxY: p.y }))),
    thumbnails: new WeakMap<CpSegment, SheetThumbnail | null>(),
  };
  geometryCache.set(fold, result);
  return result;
}
const geometryCache = new WeakMap<
  FoldDocument,
  {
    readPoint: ReturnType<typeof flatPlaneReader>;
    assignmentByKey: Map<string, string>;
    loose: Array<{ edge: SegmentEdge; middle: { x: number; y: number } }>;
    index: BoundsIndex;
    thumbnails: WeakMap<CpSegment, SheetThumbnail | null>;
  }
>();

/** One segment's card thumbnail: its edges, border included, fitted. */
export function segmentSheetThumbnail(fold: FoldDocument, segment: CpSegment): SheetThumbnail | null {
  const coords = fold.vertices_coords ?? [];
  const { readPoint, assignmentByKey, loose, index, thumbnails } = sheetGeometry(fold);
  if (thumbnails.has(segment)) return thumbnails.get(segment) ?? null;
  // Match pointOnSegmentBoundary's tolerance and retain original edge order.
  const b = segment.bounds,
    epsilon = 1e-6;
  const looseInRegion = index
    .intersecting({
      minX: b.minX - epsilon,
      minY: b.minY - epsilon,
      maxX: b.maxX + epsilon,
      maxY: b.maxY + epsilon,
    })
    .sort((a, b) => a - b)
    .flatMap((i) => {
      const { edge, middle } = loose[i]!;
      return pointInSegment(segment, middle) || pointOnSegmentBoundary(segment, middle) ? [edge] : [];
    });
  const strokes: SheetStroke[] = [...segmentEdges(fold, [segment], assignmentByKey), ...looseInRegion].map(
    ({ a, b, assignment }) => {
      const from = readPoint(coords[a]);
      const to = readPoint(coords[b]);
      return { x1: from.x, y1: from.y, x2: to.x, y2: to.y, role: strokeRole(assignment) };
    },
  );
  const thumbnail = fitSheetThumbnail(strokes);
  thumbnails.set(segment, thumbnail);
  return thumbnail;
}
