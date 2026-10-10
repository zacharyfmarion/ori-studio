import type { KnownDiagramAnnotation } from '../document/diagramDocument';
import type { PicturePoint } from './annotationModel';
import type { PictureCover, PictureLayers } from './pictureGeometry';

/** A face, painted `order`th: its ring and its box. */
function face(ring: PicturePoint[], order: number): PictureCover {
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  return { ring, order, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}

/**
 * A flat fold's layers, back to front, on a frame 1 by 0.75: the base, a flap
 * folded over it, and a small face over the flap that reaches past it.
 */
export const BEHIND_LAYERS: PictureLayers = {
  orders: [],
  covers: [
    face(
      [
        [0.05, 0.05],
        [0.95, 0.05],
        [0.95, 0.7],
        [0.05, 0.7],
      ],
      0
    ),
    face(
      [
        [0.3, 0.15],
        [0.6, 0.15],
        [0.6, 0.55],
        [0.3, 0.55],
      ],
      1
    ),
    face(
      [
        [0.5, 0.25],
        [0.7, 0.25],
        [0.7, 0.4],
        [0.5, 0.4],
      ],
      2
    ),
  ],
};

/**
 * The marks behind a flap (Phase 15e) a card, a page and the canvas are
 * checked against, on {@link BEHIND_LAYERS}: a fold arrow from under the
 * flap, dotted until it comes out from under it and the face over it; a
 * fold-and-unfold arrow whose return comes back under the flap; a shaped
 * arrow; a pleat arrow; a line behind at its end; a circle on the flap's
 * corner; and an arrow two layers down, under the base too.
 */
export const BEHIND_CASES: readonly KnownDiagramAnnotation[] = [
  { id: 'arc-tail', kind: 'valley-arrow', from: [0.4, 0.35], to: [0.85, 0.47], bend: 0.15, behind: { from: 1 } },
  { id: 'fold-unfold', kind: 'fold-unfold-arrow', from: [0.35, 0.22], to: [0.9, 0.18], bend: 0.12, behind: { from: 1 } },
  {
    id: 'shaped',
    kind: 'mountain-arrow',
    from: [0.45, 0.5],
    to: [0.85, 0.62],
    path: [
      { at: [0.45, 0.5], out: [0.6, 0.66] },
      { at: [0.85, 0.62], in: [0.7, 0.45] },
    ],
    behind: { from: 1 },
  },
  { id: 'pleat', kind: 'pleat-arrow', from: [0.42, 0.42], to: [0.9, 0.58], behind: { from: 1 } },
  { id: 'line', kind: 'valley-line', from: [0.1, 0.32], to: [0.5, 0.32], behind: { to: 1 } },
  { id: 'circle', kind: 'circle', from: [0.6, 0.55], to: [0.6, 0.55], behind: { from: 1 } },
  { id: 'deep', kind: 'valley-arrow', from: [0.45, 0.2], to: [1.05, 0.1], bend: 0.1, behind: { from: 2 } },
];
