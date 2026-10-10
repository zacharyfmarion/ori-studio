import type { KnownDiagramAnnotation } from '../document/diagramDocument';
import type { PicturePoint } from './annotationModel';
import type { AnnotationPaper } from './annotationPrimitives';

/** A star at `at`, as the model writes it: what is unsaid left out. */
function star(id: string, at: PicturePoint, more: Pick<KnownDiagramAnnotation, 'fill' | 'angle' | 'scale'> = {}): KnownDiagramAnnotation {
  return { id, kind: 'star', from: at, to: [at[0], at[1]], ...more };
}

/**
 * The stars (Revision 3) a card, a page and the canvas are checked against,
 * on a 4 × 3 frame: filled, as Zach's sample's is, and outlined, the page's
 * white inside, each upright at its print size; each turned (a tenth of a
 * turn, then 20°) and scaled (twice, then half); a filled and an outlined one
 * off the paper, past the frame's top edge; and an outlined one on a
 * References step's grey back face (`STAR_PAPER`), still white inside, as a
 * white arrow is (R3-5 A).
 */
export const STAR_CASES: readonly KnownDiagramAnnotation[] = [
  star('filled', [0.5, 0.4], { fill: 'black' }),
  star('outline', [0.5, 0.4]),
  star('filled-turned', [0.3, 0.3], { fill: 'black', angle: 36 }),
  star('outline-turned-scaled', [0.7, 0.5], { angle: 20, scale: 2 }),
  star('filled-half', [0.2, 0.6], { fill: 'black', scale: 0.5 }),
  star('off-paper-filled', [0.5, -0.05], { fill: 'black' }),
  star('off-paper-outline', [0.6, -0.05], { scale: 1.5 }),
  star('references-face', [0.4, 0.4]),
];

/** The sheet a References step's back shows, over the whole frame: what `references-face` stands on. */
export const STAR_PAPER: Readonly<Record<string, AnnotationPaper>> = {
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
