import type { DiagramStep, KnownDiagramAnnotation } from '../document/diagramDocument';
import type { PicturePoint } from '../annotate/annotationModel';
import { pickedAnchor } from '../zoom/zoomAnchor';
import { craneStep } from '../zoom/zoom.fixtures';
import { stackedStep } from './xray.fixtures';

/** An x-ray as the model writes it: its window's centre, its radius and its depth; an anchor where picked. */
export function xrayAt(
  id: string,
  centre: PicturePoint,
  radius: number,
  depth: number,
  anchor?: PicturePoint
): KnownDiagramAnnotation {
  return { id, kind: 'x-ray', from: centre, to: [centre[0], centre[1]], radius, depth, ...(anchor ? { anchor } : {}) };
}

/** A step with `annotations`, its picture's marks in step with it, as an annotated step stores them. */
function marked(step: DiagramStep, annotations: KnownDiagramAnnotation[], id = step.id): DiagramStep {
  return { ...step, id, annotations, annotatedPictureKey: step.picture?.key ?? null };
}

const stacked = stackedStep();
const crane = craneStep('S.none');
const spread = craneStep('S.affine');

/**
 * The x-rays (Revision 3, 18f) the canvas, a card, a page and Pose's ghost
 * are checked against (`xrayGolden.test.ts`, `xraySurfaces.test.ts`):
 *
 * - `stacked-1`, `-2`, `-past`: a hand-built fold of three layers
 *   (`stackedStep`), its window on all three — one deep shows the buried
 *   face the stored picture dropped, in its side's colour; two deep the
 *   back alone; a depth past the stack draws at the deepest.
 * - `stacked-edge`: a window reaching past the frame's right edge, which a
 *   card and a page grow to hold by its rim.
 * - `crane-flap`: Zach's crane, step 22 (`zoom.fixtures.ts`), its window on
 *   the body two deep, with no spread: a face the stored scene dropped drawn
 *   among the stored ones.
 * - `crane-spread`: the same with the default affine spread, every face
 *   drawn from the stored scene, spread places and all.
 * - `crane-anchor`: a window one deep, its peel started at a point picked
 *   off its centre (18g).
 * - `crane-marks`: two windows, and over them a valley line, a circle and a
 *   close-up whose area takes one in: the marks over every window, the
 *   close-up's inside the picture plain (R3-20 B).
 * - `crane-enlarged`: an enlarged step, its window crossing its frame's
 *   edge: its own picture's faces in the window's units, held to the frame.
 * - `crane-off-paper`: a window whose middle is on no paper, two deep: it
 *   peels the paper inside it (18g), and paints nothing off it.
 * - `crane-edge`: a window on the edge of a flap, a third of it off the
 *   paper, one deep: the white over the faces it takes away and nothing
 *   off the paper (review of 18f).
 */
export const XRAY_CASES: readonly { id: string; step: DiagramStep }[] = [
  { id: 'stacked-1', step: marked(stacked, [xrayAt('x', [0.4, 0.4], 0.15, 1)]) },
  { id: 'stacked-2', step: marked(stacked, [xrayAt('x', [0.4, 0.4], 0.15, 2)]) },
  { id: 'stacked-past', step: marked(stacked, [xrayAt('x', [0.4, 0.4], 0.15, 6)]) },
  { id: 'stacked-edge', step: marked(stacked, [xrayAt('x', [0.95, 0.5], 0.1, 1)]) },
  { id: 'crane-flap', step: marked(crane, [xrayAt('x', [0.45, 0.6], 0.08, 2)]) },
  { id: 'crane-spread', step: marked(spread, [xrayAt('x', [0.45, 0.6], 0.08, 2)]) },
  { id: 'crane-anchor', step: marked(spread, [xrayAt('x', [0.45, 0.6], 0.08, 1, pickedAnchor(spread, [0.47, 0.64])!)]) },
  {
    id: 'crane-marks',
    step: marked(spread, [
      xrayAt('x-1', [0.45, 0.6], 0.08, 2),
      xrayAt('x-2', [0.35, 0.3], 0.06, 1),
      { id: 'valley', kind: 'valley-line', from: [0.3, 0.6], to: [0.6, 0.6] },
      { id: 'point', kind: 'circle', from: [0.45, 0.6], to: [0.45, 0.6] },
      { id: 'close-up', kind: 'close-up', from: [0.35, 0.3], to: [-0.25, 0.3], radius: 0.1, scale: 2 },
    ]),
  },
  {
    id: 'crane-enlarged',
    step: {
      ...marked(crane, [xrayAt('x', [0.5, 0.2], 0.25, 2)], 'step-enlarged'),
      zoom: { from: 'area', shape: 'circle', frame: { centre: [0.45, 0.6], radius: 0.2 } },
    },
  },
  { id: 'crane-off-paper', step: marked(spread, [xrayAt('x', [0.05, 0.45], 0.08, 2)]) },
  { id: 'crane-edge', step: marked(spread, [xrayAt('x', [0.5, 0.6], 0.06, 1)]) },
];

/** A case's step. */
export function xrayCase(id: string): DiagramStep {
  const found = XRAY_CASES.find((entry) => entry.id === id);
  if (!found) throw new Error(`no x-ray case ${id}`);
  return found.step;
}
