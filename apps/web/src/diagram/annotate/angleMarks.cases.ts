import type { KnownDiagramAnnotation } from '../document/diagramDocument';
import { angleMarkAt, type PicturePoint } from './annotationModel';

/** An equal-angle mark at `vertex` between the arms toward `first` and `second`, as the model writes one. */
function mark(id: string, vertex: PicturePoint, first: PicturePoint, second: PicturePoint, ticks?: 1 | 2 | 3): KnownDiagramAnnotation {
  return { id, kind: 'angle-mark', ...angleMarkAt(vertex, first, second)!, ...(ticks ? { ticks } : {}) };
}

/**
 * The equal-angle marks (Phase 15b) a card, a page and the canvas are
 * checked against: the kite fold's angle on Zach's crane, as acute as a
 * diagram's usually are; a right angle; an obtuse one; two and three ticks
 * a half; and one with its vertex off the picture.
 */
export const ANGLE_MARK_CASES: readonly KnownDiagramAnnotation[] = [
  mark('kite', [0.5, 0.72], [0.14, 0.36], [0.5, 0]),
  mark('square', [0.3, 0.6], [0.8, 0.6], [0.3, 0.1]),
  mark('obtuse', [0.6, 0.4], [0.1, 0.45], [0.9, 0.1]),
  mark('two-ticks', [0.2, 0.7], [0.7, 0.7], [0.5, 0.3], 2),
  mark('three-ticks', [0.8, 0.3], [0.3, 0.3], [0.5, 0.7], 3),
  mark('off-picture', [-0.1, 0.6], [0.3, 0.6], [0.1, 0.3]),
];
