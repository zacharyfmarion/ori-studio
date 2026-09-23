/**
 * A FOLD segment as the shared sheet card takes it.
 *
 * The Simulate rail's reading of the document: `resolveCpSegments` has already
 * split the fold into its patterns, and each one's lines are the edges of its
 * faces (`segmentEdges`) — plus any edge that lies on no face but inside the
 * segment, such as an aux line a source laid over the paper — read back into
 * model space through the fold's own `flatPlaneReader`; the base fold is y-down
 * like the canvas, so nothing here flips. The paper is the segment's own
 * boundary. The References rail reads the same card out of a precrease
 * component (`references/referencesSheets`); both end in `fitSheetThumbnail`.
 */
import type { FoldDocument } from '../../engine/types';
import {
  flatPlaneReader,
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

/**
 * The fold's edges on no face whose middle lies in `segment`: lines laid over
 * the paper rather than into it, which the face walk never meets.
 */
function looseEdges(fold: FoldDocument, segment: CpSegment): SegmentEdge[] {
  const edges = fold.edges_vertices ?? [];
  if (edges.length === 0) return [];
  const onFace = new Set<string>();
  for (const face of fold.faces_vertices ?? []) {
    for (let i = 0; i < face.length; i += 1) {
      const a = face[i] ?? 0;
      const b = face[(i + 1) % face.length] ?? 0;
      onFace.add(a < b ? `${a}_${b}` : `${b}_${a}`);
    }
  }
  const coords = fold.vertices_coords ?? [];
  const readPoint = flatPlaneReader(fold);
  const loose: SegmentEdge[] = [];
  edges.forEach(([a, b], index) => {
    if (a === undefined || b === undefined || a === b) return;
    if (onFace.has(a < b ? `${a}_${b}` : `${b}_${a}`)) return;
    const from = readPoint(coords[a]);
    const to = readPoint(coords[b]);
    const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    if (!pointInSegment(segment, middle) && !pointOnSegmentBoundary(segment, middle)) return;
    loose.push({ a, b, assignment: fold.edges_assignment?.[index] ?? 'U' });
  });
  return loose;
}

/** One segment's card thumbnail: its edges, border included, on its paper, fitted. */
export function segmentSheetThumbnail(
  fold: FoldDocument,
  segment: CpSegment
): SheetThumbnail | null {
  const coords = fold.vertices_coords ?? [];
  const readPoint = flatPlaneReader(fold);
  const strokes: SheetStroke[] = [
    ...segmentEdges(fold, [segment]),
    ...looseEdges(fold, segment),
  ].map(({ a, b, assignment }) => {
    const from = readPoint(coords[a]);
    const to = readPoint(coords[b]);
    return { x1: from.x, y1: from.y, x2: to.x, y2: to.y, role: strokeRole(assignment) };
  });
  const rings = segment.boundary.map((ring) => ring.map(({ x, y }) => [x, y] as const));
  return fitSheetThumbnail(strokes, 100, rings);
}
