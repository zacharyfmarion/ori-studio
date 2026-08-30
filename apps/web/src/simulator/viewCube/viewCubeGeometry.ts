import { multiplyMat3, viewDepthAxis, viewRotation, type Mat3 } from '@treemaker/origami-simulator';
import type { SimulatorOrbitView, SimulatorViewDirection } from '../../lib/simulatorOrbit';

/**
 * The view cube's geometry: where its faces are, and how the whole cube is
 * turned to match the camera.
 *
 * Pure — no React, no DOM. The component below it only reads strings out of
 * here, which is what lets the one thing that can be silently wrong (see
 * "handedness" below) be settled by a unit test rather than by looking at it.
 */

export type ViewCubeFaceId = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export interface ViewCubeFace {
  id: ViewCubeFaceId;
  /**
   * The eye direction this face snaps to, in the renderer's world — where Y is
   * the flat paper's normal and the axis yaw spins about.
   */
  direction: SimulatorViewDirection;
  /**
   * Places the face on the cube, before the cube itself is turned. Ordinary CSS
   * 3D cube transforms; `--view-cube-half` is half the cube's edge, so the size
   * lives in one place in the stylesheet rather than being baked in here.
   */
  transform: string;
}

const HALF = 'translateZ(var(--view-cube-half))';

/**
 * The six faces, in the order they are painted.
 *
 * The labels are derived rather than chosen. At `(yaw 0, pitch 0)` the view
 * transform reduces to `screen_x = FOLD x`, `screen_y = −FOLD y`, so **Top
 * shows the fold oriented exactly as the crease-pattern canvas draws it** —
 * which fixes `+Y` as Top and every other face with it. `−Z` is FOLD `+y`, the
 * pattern's bottom edge, and it is the edge nearest the eye at the simulator's
 * opening view; hence Front.
 *
 * Note this is *not* OpenSCAD Studio's mapping, which relabels three.js's
 * `[+X, −X, +Y, −Y, +Z, −Z]` as Front/Back/Top/Bottom/Left/Right for OpenSCAD's
 * coordinate convention. Ours is the paper's.
 */
export const VIEW_CUBE_FACES: readonly ViewCubeFace[] = [
  { id: 'front', direction: [0, 0, -1], transform: HALF },
  { id: 'back', direction: [0, 0, 1], transform: `rotateY(180deg) ${HALF}` },
  { id: 'right', direction: [1, 0, 0], transform: `rotateY(90deg) ${HALF}` },
  { id: 'left', direction: [-1, 0, 0], transform: `rotateY(-90deg) ${HALF}` },
  { id: 'top', direction: [0, 1, 0], transform: `rotateX(90deg) ${HALF}` },
  { id: 'bottom', direction: [0, -1, 0], transform: `rotateX(-90deg) ${HALF}` },
];

/**
 * The cube's own space, as columns in the renderer's world: right is `+X`, up is
 * `+Y`, out of the front face is `−Z`.
 *
 * ## Why this matrix exists at all
 *
 * `viewRotation` has determinant **−1** at every angle — the renderer draws a
 * mirror of the true view, and the FOLD lift cancels it for the model
 * (`normalizePoint` sends `(x, y)` to `(x, 0, −y)`). Feeding a cube through that
 * transform unaccompanied would paint every label mirror-reversed.
 *
 * So the cube is built in a *left-handed* frame — `right × up = −out`, hence the
 * determinant of −1 here — and the two cancel: `viewRotation · CUBE_BASIS` has
 * determinant +1. The cube is then an ordinary CSS 3D cube, and the browser's
 * own backface culling, hit testing and text rendering are all correct with
 * nothing hand-rolled. {@link viewCubeRotation} is pinned to that.
 */
const CUBE_BASIS: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, -1];

/** CSS puts +y down; maths puts it up. Applied on both sides of the rotation. */
const CSS_Y_FLIP: Mat3 = [1, 0, 0, 0, -1, 0, 0, 0, 1];

/**
 * The cube's rotation, in CSS's coordinate space (x right, y **down**, z toward
 * the viewer).
 *
 * A proper rotation at every angle and under any `orient` — that is the
 * invariant the tests assert, and the reason the cube can be plain CSS.
 */
export function viewCubeRotation(view: SimulatorOrbitView): Mat3 {
  const camera = viewRotation(view.yaw, view.pitch, view.orient);
  return multiplyMat3(CSS_Y_FLIP, multiplyMat3(multiplyMat3(camera, CUBE_BASIS), CSS_Y_FLIP));
}

/** Decimal places kept in the CSS string: 4e-5 px of error on a 76px cube. */
const MATRIX_PRECISION = 6;

/**
 * The cube's `transform`, ready to assign.
 *
 * `matrix3d` is column-major, so a row-major 3×3 uploads transposed. Built as a
 * string on every orbit frame, which is the whole per-frame cost of the cube —
 * one style write, no layout read.
 */
export function viewCubeTransform(view: SimulatorOrbitView): string {
  const m = viewCubeRotation(view);
  const at = (index: number) => m[index]!.toFixed(MATRIX_PRECISION);
  return (
    `matrix3d(${at(0)},${at(3)},${at(6)},0,` +
    `${at(1)},${at(4)},${at(7)},0,` +
    `${at(2)},${at(5)},${at(8)},0,0,0,0,1)`
  );
}

/**
 * Which faces are turned toward the eye, as one bit per {@link VIEW_CUBE_FACES}
 * entry.
 *
 * `backface-visibility: hidden` already stops a turned-away face being painted,
 * and browsers do not hit-test what they do not paint — but "the click went to
 * the face behind" would snap the camera to the *opposite* view, which is bad
 * enough to be worth stating outright rather than inheriting. It also gives the
 * component something to assert in jsdom, which has no layout and so no
 * backfaces at all.
 */
export function visibleViewCubeFaces(view: SimulatorOrbitView): number {
  const eye = viewDepthAxis(viewRotation(view.yaw, view.pitch, view.orient));
  let mask = 0;
  VIEW_CUBE_FACES.forEach((face, index) => {
    const facing =
      face.direction[0] * eye[0] + face.direction[1] * eye[1] + face.direction[2] * eye[2];
    if (facing > 0) mask |= 1 << index;
  });
  return mask;
}
