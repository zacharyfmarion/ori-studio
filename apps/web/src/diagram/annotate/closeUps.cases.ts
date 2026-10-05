import type { KnownDiagramAnnotation } from '../document/diagramDocument';

/**
 * The close-ups (Phase 15f) a card, a page and the canvas are checked
 * against, each on a square of paper with a mountain fold across its middle
 * (`cpStep`'s scene): one beside the picture at twice, its area on the fold;
 * one whose ring touches its area's, so no line; one at four times above the
 * picture; and one whose area holds other marks — a valley line, a circle and
 * a fold arrow — drawn larger inside it.
 */
export const CLOSE_UP_CASES: readonly { id: string; annotations: readonly KnownDiagramAnnotation[] }[] = [
  {
    id: 'beside',
    annotations: [{ id: 'zoom', kind: 'close-up', from: [0.5, 0.5], to: [1.35, 0.5], radius: 0.1, scale: 2 }],
  },
  {
    id: 'touching',
    annotations: [{ id: 'zoom', kind: 'close-up', from: [0.3, 0.5], to: [0.55, 0.5], radius: 0.1, scale: 1.5 }],
  },
  {
    id: 'four-times',
    annotations: [{ id: 'zoom', kind: 'close-up', from: [0.85, 0.5], to: [0.85, -0.3], radius: 0.05, scale: 4 }],
  },
  {
    id: 'with-marks',
    annotations: [
      { id: 'crease', kind: 'valley-line', from: [0.4, 0.44], to: [0.6, 0.44] },
      { id: 'point', kind: 'circle', from: [0.5, 0.5], to: [0.5, 0.5] },
      { id: 'fold', kind: 'valley-arrow', from: [0.43, 0.57], to: [0.57, 0.57], bend: 0.2 },
      { id: 'zoom', kind: 'close-up', from: [0.5, 0.5], to: [1.45, 0.5], radius: 0.12, scale: 2.5 },
    ],
  },
];
