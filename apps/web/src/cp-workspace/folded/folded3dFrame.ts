/**
 * The frame a 3D folded figure draws inside, from its stored `frameRadius`.
 *
 * A leaf on purpose: the scene adapter sizes the figure's box from it and the
 * window sizes its camera from it, and the adapter sits under the projector
 * that the window imports, so the number has to live where neither does.
 */

/**
 * How much wider than its bounding sphere a model can image under the mesh
 * renderer's perspective.
 *
 * `cameraUniforms` puts the eye at `camDist = 3.2 · radius`, and a sphere of
 * radius `r` seen from distance `d` has a silhouette of `r · d / √(d² − r²)`
 * — the tangent cone, not the nearest point. At 3.2 that is a 5.3% growth,
 * and it is the same at every orientation, which is what lets a frame sized
 * to the sphere stay fixed under orbit (F11 in
 * `implementation-plans/unified-paper-style-and-export.md`). The window used
 * to remove the perspective instead, on the belief that the growth was the
 * nearest point's 45%; D7 puts the perspective back so a 3D figure renders
 * exactly as the simulator does.
 *
 * Restated from `camera.ts`'s constant rather than imported, because the
 * simulator does not export it; a test pins the two against each other.
 */
export const FOLDED_3D_CAMERA_DISTANCE_FACTOR = 3.2;

export const FOLDED_3D_SILHOUETTE_FACTOR =
  FOLDED_3D_CAMERA_DISTANCE_FACTOR /
  Math.sqrt(FOLDED_3D_CAMERA_DISTANCE_FACTOR * FOLDED_3D_CAMERA_DISTANCE_FACTOR - 1);

/**
 * Half the side of the square frame, from the figure's stored `frameRadius`.
 *
 * `frameRadius` stays the model's bounding-sphere radius — it is persisted,
 * and a rehydrate checks a refold against it to the ninth decimal
 * (`sameFolded3dFrame`), so the number in the file cannot change meaning.
 * What grows is the *frame* derived from it, by the perspective silhouette
 * factor, so the model still cannot escape its own chrome at any angle.
 */
export function folded3dFrameHalfSide(frameRadius: number): number {
  return frameRadius * FOLDED_3D_SILHOUETTE_FACTOR;
}
