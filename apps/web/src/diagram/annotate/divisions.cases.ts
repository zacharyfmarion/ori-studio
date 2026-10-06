import type { DiagramTicks, KnownDiagramAnnotation } from '../document/diagramDocument';
import type { PicturePoint } from './annotationModel';

/** Equal divisions of the line from `from` to `to`, as the model writes them: what is unsaid left out. */
function divisions(
  id: string,
  from: PicturePoint,
  to: PicturePoint,
  parts: number,
  offset: number,
  more: { mirrored?: true; ticks?: DiagramTicks; numbered?: true } = {}
): KnownDiagramAnnotation {
  return { id, kind: 'divisions', from, to, parts, offset, ...more };
}

/**
 * The equal divisions (Revision 2) a card, a page and the canvas are checked
 * against, on a 4 × 3 frame: the sketch's — a top edge in four, its line
 * 2.5 mm above it, off the paper; a left edge, its line to its left, which
 * runs the other way (`mirrored`); a diagonal in three with two ticks a part;
 * a line at offsets of none — the template's |\|\| symbol, the dividers
 * straddling it — and of 1 mm; seven parts with the count printed; and 32
 * parts on a short edge, the ticks crowded to their floor.
 */
export const DIVISIONS_CASES: readonly KnownDiagramAnnotation[] = [
  divisions('sketch', [0, 0], [1, 0], 4, 2.5, { mirrored: true }),
  divisions('left-edge', [0, 0.75], [0, 0], 4, 2.5, { mirrored: true }),
  divisions('diagonal', [0.1, 0.65], [0.7, 0.1], 3, 2.5, { ticks: 2 }),
  divisions('offset-0', [0.2, 0.45], [0.8, 0.45], 4, 0),
  divisions('offset-1', [0.2, 0.3], [0.8, 0.3], 4, 1),
  divisions('seven-numbered', [0.15, 0.6], [0.85, 0.6], 7, 2.5, { numbered: true }),
  divisions('crowded', [0.4, 0.75], [0.6, 0.75], 32, 2.5, { ticks: 3 }),
];
