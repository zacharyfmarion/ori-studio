import type { KnownDiagramAnnotation } from '../document/diagramDocument';
import type { PicturePoint } from './annotationModel';
import type { AnnotationPaper } from './annotationPrimitives';

/** An eye at `at`, as the model writes it: what is unsaid left out. */
function eye(id: string, at: PicturePoint, more: Pick<KnownDiagramAnnotation, 'angle' | 'scale'> = {}): KnownDiagramAnnotation {
  return { id, kind: 'eye', from: at, to: [at[0], at[1]], ...more };
}

/**
 * The eyes (Revision 3) a card, a page and the canvas are checked against,
 * on a 4 × 3 frame: looking right, as an eye with no angle does, and left,
 * as the eye in Zach's note does, each at its print size; turned to 217° and
 * to a quarter turn down at twice its size, and at half its size at 300°;
 * one off the paper, past the frame's top edge, looking down onto it; and
 * one on a References step's grey back face (`EYE_PAPER`), outline only,
 * nothing filled.
 */
export const EYE_CASES: readonly KnownDiagramAnnotation[] = [
  eye('right', [0.5, 0.4]),
  eye('left', [0.5, 0.4], { angle: 180 }),
  eye('turned-217', [0.3, 0.3], { angle: 217 }),
  eye('down-scaled', [0.7, 0.45], { angle: 90, scale: 2 }),
  eye('half', [0.2, 0.6], { angle: 300, scale: 0.5 }),
  eye('off-paper', [0.5, -0.05], { angle: 90 }),
  eye('references-face', [0.4, 0.4], { angle: 180 }),
];

/** The sheet a References step's back shows, over the whole frame: what `references-face` stands on. */
export const EYE_PAPER: Readonly<Record<string, AnnotationPaper>> = {
  'references-face': {
    outline: [
      [0, 0],
      [1, 0],
      [1, 0.75],
      [0, 0.75],
    ],
    back: true,
  },
};
