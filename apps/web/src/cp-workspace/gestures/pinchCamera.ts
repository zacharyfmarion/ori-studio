/**
 * Turning a recognised {@link PinchTransform} into camera motion.
 *
 * Its own module, tiny as it is, because the *order* of the two operations is
 * the whole of "the paper stays under your fingers" and is the one part of this
 * feature that can be checked exactly: `pinchCamera.test.ts` projects the user
 * point that was under the fingers and asserts where it lands. Left inline in
 * the canvas' pointer effect it would have been checkable only by eye, on
 * hardware.
 */
import { panUserCamera, zoomUserCameraAt, type UserCamera } from '../renderer/camera';
import type { Viewport } from '../renderer/types';
import type { GesturePoint, PinchTransform } from './pinchTransform';

/**
 * Apply one gesture sample to `cam`, in place.
 *
 * **Anchor, then translate.** `zoomUserCameraAt` holds the user point under
 * `anchorInCanvas` fixed on screen, so scaling about the contact set's
 * *previous* centroid and then panning by the centroid delta lands that point
 * back under the fingers' new centroid. Scaling about the current centroid
 * instead would anchor on a point the fingers have already left, and the
 * pattern would creep out from under them over a long pinch.
 *
 * Rotation is deliberately not part of the gesture — see {@link pinchTransform}
 * — so the camera's own `rotation` is untouched here. It still governs the
 * result: `panUserCamera` and `zoomUserCameraAt` both route through the
 * camera's single device→user inverse, which is what makes a two-finger drag
 * follow the fingers rather than the model axes on a turned view.
 *
 * `anchorInCanvas` and the transform's `dx`/`dy` are client (CSS) pixels
 * relative to the canvas' top-left corner; `deviceRatio` carries them into the
 * device pixels the camera works in.
 */
export function applyPinchToCamera(
  cam: UserCamera,
  viewport: Viewport,
  transform: PinchTransform,
  anchorInCanvas: GesturePoint,
  deviceRatio: number
): void {
  if (transform.scale !== 1) {
    zoomUserCameraAt(
      cam,
      viewport,
      anchorInCanvas.x * deviceRatio,
      anchorInCanvas.y * deviceRatio,
      transform.scale
    );
  }
  if (transform.dx !== 0 || transform.dy !== 0) {
    // The raw drag delta, unnegated: `panUserCamera` takes a *drag*, and a
    // two-finger pan is one — unlike the wheel handler, which negates because a
    // scroll is not a drag.
    panUserCamera(cam, transform.dx * deviceRatio, transform.dy * deviceRatio);
  }
}
