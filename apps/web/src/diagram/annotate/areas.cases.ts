import type { KnownDiagramAnnotation } from '../document/diagramDocument';
import { ARROW_BEND, type PicturePoint } from './annotationModel';
import type { AnnotationPaper } from './annotationPrimitives';

/** An oval or a rectangle at `at`, as the model writes it: what is unsaid left out. */
function shape(
  id: string,
  kind: 'oval' | 'rectangle',
  at: PicturePoint,
  size: [number, number],
  more: Pick<KnownDiagramAnnotation, 'angle'> = {}
): KnownDiagramAnnotation {
  return { id, kind, from: at, to: [at[0], at[1]], size, ...more };
}

/**
 * The ovals and rectangles (Revision 3) a card, a page and the canvas are
 * checked against, on a 4 × 3 frame, each case a step's marks: upright, as
 * the turtle's ovals are (about three quarters as wide as high), and a
 * rectangle; each turned; an oval made a circle; a turned rectangle drawn
 * after a Valley Line and an arrow, and painted under both (R3-11d B); one
 * reaching off the paper past the frame's left edge; and one on a References
 * step's grey back face (`AREA_PAPER`), nothing filled.
 */
export const AREA_CASES: Readonly<Record<string, readonly KnownDiagramAnnotation[]>> = {
  oval: [shape('oval', 'oval', [0.5, 0.4], [0.3, 0.4])],
  rectangle: [shape('rectangle', 'rectangle', [0.5, 0.4], [0.4, 0.25])],
  'oval-turned': [shape('oval-turned', 'oval', [0.45, 0.35], [0.5, 0.2], { angle: 30 })],
  'rectangle-turned': [shape('rectangle-turned', 'rectangle', [0.55, 0.4], [0.3, 0.15], { angle: 117.5 })],
  circle: [shape('circle', 'oval', [0.3, 0.3], [0.25, 0.25])],
  'under-lines': [
    { id: 'valley', kind: 'valley-line', from: [0.1, 0.4], to: [0.9, 0.4] },
    { id: 'arrow', kind: 'valley-arrow', from: [0.2, 0.55], to: [0.7, 0.55], bend: ARROW_BEND },
    shape('under-lines', 'rectangle', [0.5, 0.45], [0.5, 0.3], { angle: 15 }),
  ],
  'off-paper': [shape('off-paper', 'oval', [0.05, 0.4], [0.3, 0.2])],
  'references-face': [shape('references-face', 'oval', [0.5, 0.4], [0.3, 0.4], { angle: 60 })],
};

/** The sheet a References step's back shows, over the whole frame: what `references-face` stands on. */
export const AREA_PAPER: Readonly<Record<string, AnnotationPaper>> = {
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
