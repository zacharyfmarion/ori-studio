/**
 * Turning a 3D folded figure by dragging it.
 *
 * The decision half of the gesture, with no DOM, no store and no React, so the
 * canvas gets a call rather than logic and the rules are unit-testable.
 *
 * The interaction is the inline simulator's, because the user has already
 * learned it here: press to select, press again to focus, then a drag inside the
 * focused figure orbits instead of moving it. What differs is only where the
 * press lands. A simulation window is a DOM element, so with the overlay body
 * inert its own canvas receives the drag; a folded figure is drawn into the
 * shared WebGL surface and has no element, so the press falls through to the
 * crease-pattern canvas and it has to ask this module whether it was meant.
 *
 * # Two questions, two spaces
 *
 * The press answers two things, and they do not want the same coordinates:
 *
 * - **Was this press on the figure?** — crease-pattern **user** space, because
 *   that is where the figure's box lives.
 * - **How far has the pointer travelled?** — **CSS pixels**, straight off the
 *   event, because that is what the simulator measures and therefore what "the
 *   same drag turns it the same amount" has to mean.
 *
 * Answering the second in user space is what this module was doing, and it is
 * wrong in a way that is invisible at one camera and only there. `clientToUser`
 * scales the delta by `dpr / cam.zoom` and rotates it by `-cam.rotation`, and
 * the zoom readout's 100% is defined as one user unit per CSS pixel — i.e.
 * `cam.zoom == dpr` — so the two factors cancel at 100% and nowhere else. At
 * 200% the figure turned at half rate, at 50% at double, and on a canvas rotated
 * for hex pleating a horizontal drag yawed *and* pitched.
 */

import {
  boxContainsModelPoint,
  type AnnotationBox,
  type Vec2,
} from '../annotations/annotationTransform';
import {
  nextSimulatorOrbitView,
  type SimulatorOrbitDrag,
  type SimulatorOrbitPoint,
} from '../../lib/simulatorOrbit';
import type { FoldedFigureCamera } from './foldedFigure3dProjection';

/**
 * Whether a press at `point` should orbit `figureId` rather than reach the tool
 * under it.
 *
 * `box` is the figure's transformable box — the same one
 * `foldedFigureAsTransformable` hands the overlay — so the region that orbits is
 * exactly the region the overlay made inert. Deriving it independently here is
 * how the two would drift into a band that neither moves nor orbits.
 *
 * Returns false for an unfocused figure by construction: `focusedId` is the only
 * thing consulted before the geometry, so a selected-but-unfocused figure keeps
 * its move gesture.
 */
export function foldedFigureOrbitClaimsPress(
  focusedId: string | null,
  figureId: string,
  box: AnnotationBox | null,
  point: Vec2
): boolean {
  if (focusedId === null || focusedId !== figureId || box === null) return false;
  return boxContainsModelPoint(box, point);
}

/**
 * The drag anchor: where the pointer went down, and the camera it went down on.
 *
 * `point` is in **CSS pixels** — see the note on spaces above. Nothing here can
 * check that, so the guarantee is the caller's; what this module can do is only
 * ever be handed the same space the simulator hands `nextSimulatorOrbitView`.
 *
 * Both halves are needed because orbit is measured from the press rather than
 * integrated frame to frame — integrating would accumulate rounding over a long
 * drag, and would make a dropped move permanently shift the model.
 */
export function beginFoldedFigureOrbit(
  camera: FoldedFigureCamera,
  point: SimulatorOrbitPoint
): SimulatorOrbitDrag {
  return { x: point.x, y: point.y, yaw: camera.yaw, pitch: camera.pitch };
}

/**
 * The camera the figure should be drawn at, for a pointer now at `point`,
 * in the same **CSS pixels** {@link beginFoldedFigureOrbit} anchored on.
 *
 * The turn itself is [`nextSimulatorOrbitView`], imported rather than copied:
 * a figure and a simulation must answer the same drag with the same rotation,
 * or "it behaves like the simulator" is false in the one way a user can feel.
 * Sharing the arithmetic is necessary and was never sufficient — the same
 * function over a differently-scaled delta is a different gesture.
 * `FoldedFigureCamera` and `SimulatorOrbitView` are the same three fields by
 * convergence — see the note on `FoldedFigureCamera` — and this function is the
 * only place that relies on it, so a future divergence has one site to fix.
 *
 * `zoom` is carried through untouched. Scroll deliberately does not zoom a
 * focused figure (it pans the canvas), and the figure's own scale handles are
 * the sizing affordance.
 */
export function advanceFoldedFigureOrbit(
  camera: FoldedFigureCamera,
  drag: SimulatorOrbitDrag,
  point: SimulatorOrbitPoint
): FoldedFigureCamera {
  // A pointer that has not left the press is not a turn, and must return the
  // anchor *exactly*. Without this it does not: `normalizeAngle` round-trips
  // through `((v + PI) % 2PI + 2PI) % 2PI - PI`, which loses a ULP on an angle
  // that was already in range, so a plain click on a focused figure would come
  // back a few 1e-17 away from where it started, re-project the figure, and take
  // an undo entry the user then has to press undo twice to get past.
  //
  // Fixed here rather than by giving `foldedFigureOrbitChanged` a tolerance,
  // because "no movement means no turn" is exact and a tolerance would only be
  // hiding the drift, which still accumulates across a drag that keeps
  // returning to its anchor.
  if (point.x === drag.x && point.y === drag.y) {
    return { yaw: drag.yaw, pitch: drag.pitch, zoom: camera.zoom, orient: camera.orient };
  }
  const next = nextSimulatorOrbitView(
    { yaw: camera.yaw, pitch: camera.pitch, zoom: camera.zoom, orient: camera.orient },
    drag,
    point
  );
  // `orient` rides through every branch. A drag moves the eye; it never changes
  // which way the model is up, and dropping it here would quietly undo a
  // "set upright" the first time the user turned the figure afterwards.
  return { yaw: next.yaw, pitch: next.pitch, zoom: camera.zoom, orient: camera.orient };
}

/**
 * Whether a drag actually turned the figure.
 *
 * A press-and-release inside a focused figure is a click, not an orbit, and
 * recording an undo entry for it would put a no-op on the stack that the user
 * then has to press undo twice to get past. Compared on the camera rather than
 * on pointer distance so a drag that returns exactly to where it started is
 * also nothing.
 */
export function foldedFigureOrbitChanged(
  before: FoldedFigureCamera,
  after: FoldedFigureCamera
): boolean {
  return before.yaw !== after.yaw || before.pitch !== after.pitch || before.zoom !== after.zoom;
}
