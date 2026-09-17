/**
 * A FOLD segment as the shared sheet card takes it.
 *
 * The Simulate rail's reading of the document: `resolveCpSegments` has already
 * split the fold into its patterns, and each one's lines are the edges of its
 * faces (`segmentEdges`), read back into model space through the fold's own
 * `flatPlaneReader` — the base fold is y-down like the canvas, so nothing here
 * flips. The References rail reads the same card out of a precrease component
 * (`references/referencesSheets`); both end in `fitSheetThumbnail`.
 */
import type { FoldDocument } from '../../engine/types';
import {
  flatPlaneReader,
  segmentEdges,
  type CpSegment,
} from '../../lib/creasePatternSegmentation';
import {
  fitSheetThumbnail,
  type SheetStroke,
  type SheetStrokeKind,
  type SheetThumbnail,
} from './sheetThumbnail';

/**
 * Which class an edge's assignment draws in. Border is the paper's edge;
 * anything that is neither mountain nor valley — flat, unassigned, a
 * reference line — is "other", the same grey the References cards give a
 * crease with no direction.
 */
function strokeKind(assignment: string): SheetStrokeKind {
  switch (assignment) {
    case 'B':
      return 'border';
    case 'M':
      return 'mountain';
    case 'V':
      return 'valley';
    default:
      return 'other';
  }
}

/** One segment's card thumbnail: its edges, border included, fitted. */
export function segmentSheetThumbnail(
  fold: FoldDocument,
  segment: CpSegment
): SheetThumbnail | null {
  const coords = fold.vertices_coords ?? [];
  const readPoint = flatPlaneReader(fold);
  const strokes: SheetStroke[] = segmentEdges(fold, [segment]).map(({ a, b, assignment }) => {
    const from = readPoint(coords[a]);
    const to = readPoint(coords[b]);
    return { x1: from.x, y1: from.y, x2: to.x, y2: to.y, kind: strokeKind(assignment) };
  });
  return fitSheetThumbnail(strokes);
}
