/**
 * Where a 3D folded figure is seen from, and the frame it is seen inside.
 *
 * A figure's viewpoint is document state — it is stored, restored, orbited and
 * exported — while every drawing of it is derived. So the camera type, the
 * views a figure starts and flips to, the frame its window is sized from and
 * the kernel tolerance a drawing treats as "in the same plane" live here,
 * apart from any one drawing: the window's mesh (`folded3dMesh.ts`), the
 * scene the canvas and the export share (`folded3dScene.ts`) and the stored
 * picture (`folded3dStoredScene.ts`) all read the same numbers.
 *
 * They used to be exported from the CPU projector, which was also the file
 * that drew the vector picture. When the projector retired (D5), its camera
 * vocabulary had a dozen importers and none of them wanted a projection — so
 * it moved here rather than into whichever drawing happened to survive.
 *
 * DOM-free, store-free, React-free, and pure.
 */

import {
  viewDepthAxis,
  viewRotationFor,
  type Mat3,
  type Vec3,
} from '@treemaker/origami-simulator';
import type {
  OristudioCpFold3dTolerances,
  OristudioCpFolded3dRenderModel,
  OristudioCpFoldedFigureState,
} from '../../engine/oristudioCpTypes';
import { modelRadius } from './folded3dModelReader';

/**
 * Where the camera is, in the figure's own terms.
 *
 * At `(0, 0)` the figure is seen **face-on**, oriented exactly as the crease
 * pattern is drawn: a point of the unmoved root face lands on its own crease-
 * pattern coordinates. `yaw` then spins the figure about the paper's normal and
 * `pitch` tilts it away from face-on — the same two verbs, and the same signs,
 * as the simulator's orbit, whose paper also starts flat and facing the eye.
 */
export interface FoldedFigureCamera {
  /** Radians, about the paper's normal. */
  yaw: number;
  /**
   * Radians away from face-on; `±π/2` looks along the paper edge-on.
   *
   * **Negative** tilts the near edge down, so folds coming out of the paper rise
   * up the page — the same sign and the same reason as the simulator's
   * `DEFAULT_SIMULATOR_VIEW`. A positive pitch of the same size is a perfectly
   * good view of the same figure from underneath, which reads as the raised
   * parts drooping.
   */
  pitch: number;
  /**
   * How far the eye is zoomed **in**, inside a frame that does not change size.
   *
   * A viewport setting, not a scale of the figure. The frame a 3D figure is
   * drawn in is the model's bounding sphere ({@link folded3dFrameRadius}) and
   * the canvas handles are what resize it; zooming makes the model bigger inside
   * that frame, and the window clips whatever leaves it — the same split an
   * inline simulation has between its wheel and its resize handles.
   */
  zoom: number;
  /**
   * The model's own up, applied before the camera, so `yaw` spins about it
   * rather than about the paper's normal.
   *
   * Absent means identity — the turntable about the normal that every figure had
   * before "set upright" existed, and that a flat sheet still wants. Set by the
   * user from a view they positioned; see `setUprightView`.
   */
  orient?: Mat3;
}

/**
 * The camera a figure is folded at: the simulator's own initial view, angle for
 * angle — 45° of spin and 54.7° of tilt is the eye on the `(1,1,1)` diagonal,
 * the "lying on a table" isometric a user of this app has already seen.
 *
 * `zoom` is 1 rather than the simulator's 1.4: there the number fits a model
 * into a viewport, here it is a scale in crease-pattern units, and 1 draws the
 * folded figure the same size as the paper it came from.
 */
export const DEFAULT_FOLDED_3D_CAMERA: FoldedFigureCamera = {
  yaw: Math.PI / 4,
  pitch: -0.955,
  zoom: 1,
};

/**
 * How far a point may be from a plane and still count as lying in it.
 *
 * The kernel's own bar, translated into the distance `bsp.ts` compares against:
 * the offset two coplanar faces are allowed to differ by, plus the deviation a
 * tilt of `angle_radians` induces across a patch of this radius. On a span-400
 * model with the shipped defaults that is about 4.3e-4 — four thousand times
 * `bsp.ts`'s own `EPS`, and still 1e-6 of span.
 *
 * Deliberately **not** `angle_radians` itself, which the plan's first sketch
 * proposed: that quantity is an angle and the comparison it would feed is a
 * distance.
 */
export function folded3dCoplanarEpsilon(
  model: OristudioCpFolded3dRenderModel,
  tolerances: OristudioCpFold3dTolerances
): number {
  const radius = modelRadius(model);
  return tolerances.distance_relative * model.span + tolerances.angle_radians * radius;
}

/**
 * The camera a newly folded figure is shown at.
 *
 * A pure function of the payload and the requested side, so two byte-identical
 * refolds are shown identically — which is what makes a golden picture a stable
 * test rather than a snapshot of one run.
 *
 * `Back1` is the antipodal eye, not a colour choice: in 3D "the other side" is
 * somewhere to stand. `Both2` has no 3D reading at all — the flat figure's
 * side-by-side pair — and falls back to the front.
 */
export function defaultFolded3dCamera(
  model: OristudioCpFolded3dRenderModel,
  side: OristudioCpFoldedFigureState = 'Front0'
): FoldedFigureCamera {
  void model;
  const base = DEFAULT_FOLDED_3D_CAMERA;
  return side === 'Back1' ? antipodalCamera(base) : { ...base };
}

/**
 * The same figure seen from exactly the other side.
 *
 * `(yaw + π, π − pitch)` and not `(yaw + π, −pitch)`: only the first negates the
 * eye direction. The second leaves the eye exactly where it was — the two
 * changes cancel — which reads as "the back view is identical to the front
 * view", a bug that looks like the camera being ignored.
 */
export function antipodalCamera(camera: FoldedFigureCamera): FoldedFigureCamera {
  return {
    yaw: camera.yaw + Math.PI,
    pitch: Math.PI - camera.pitch,
    zoom: camera.zoom,
    // Carried unchanged, and that is exactly right rather than an oversight:
    // the eye direction is row 2 of `Pitch · Yaw · orient`, so negating row 2 of
    // `Pitch · Yaw` negates the whole product's. Standing somewhere else does
    // not change which way the model is up.
    orient: camera.orient,
  };
}

/**
 * Where the "other side" verb moves a figure's eye to.
 *
 * The 3D reading of the flat figure's Flip. Turning the paper over is a *colour*
 * operation on a flat figure and a *viewpoint* operation here, so this is the
 * one place the two verbs differ, and it is an involution: pressing twice
 * returns the original camera, because `antipodalCamera` applied twice is
 * `(yaw + 2π, pitch)`, the same eye.
 *
 * Defaults rather than refusing when a figure carries no camera: every figure
 * this reaches was folded at {@link DEFAULT_FOLDED_3D_CAMERA} anyway.
 */
export function foldedFigureOtherSideCamera(
  camera: FoldedFigureCamera | null | undefined
): FoldedFigureCamera {
  return antipodalCamera(camera ?? DEFAULT_FOLDED_3D_CAMERA);
}

/**
 * Half the side of the square frame a 3D figure is drawn inside.
 *
 * A folded figure's box used to be the bounding box of whatever the drawing
 * happened to produce, which changes with every orbit — so turning the model
 * resized and shifted its frame, and the chrome jumped around under the cursor.
 * A figure should be a *window* onto the model, the way an inline simulation
 * is, and a window does not change shape because you turned what is inside it.
 *
 * The bounding **sphere** is what makes that exact rather than approximate: a
 * sphere of 3D radius `R` images to a circle of the same radius at *every*
 * orientation, so a frame sized to it never changes under orbit and always
 * contains the model — which is why nothing has to be clipped, and why the
 * model can never escape its own chrome at an awkward angle. Under the
 * window's perspective camera the circle grows by a fixed silhouette factor,
 * which `folded3dFrameHalfSide` applies to this radius rather than changing
 * what the radius means (F11).
 *
 * It takes no camera, and that is the point rather than an omission: a frame
 * that moved with the eye is exactly the resizing chrome this exists to stop.
 * Zooming makes the model bigger *inside* the frame and the canvas handles make
 * the frame bigger, and neither is allowed to become the other — see
 * {@link FoldedFigureCamera.zoom}.
 *
 * The cost is honest padding: a long thin model sits inside a frame as wide as
 * it is long. That is what a viewport looks like, and it is the price of the
 * frame being stable.
 */
export function folded3dFrameRadius(model: OristudioCpFolded3dRenderModel): number {
  return modelRadius(model);
}

/**
 * World direction the eye lies in. Unit length.
 *
 * Literally the third row of the view rotation, carried back through the mesh
 * basis (`toSimBasis`, `(x, y, z) → (x, z, −y)`), so a simulator-space
 * `(a, b, c)` comes back as `(a, −c, b)`. Read from the same matrix the
 * drawings project with, so the two cannot disagree and the old sign trap —
 * re-deriving it in trigonometry, where a wrong sign "draws the figure
 * near-to-far, which is a picture, just the wrong one" — is gone.
 *
 * Exported because "which side of a plane is the viewer on" is the question
 * every stacked cell is resolved by, and a caller has to be able to ask it
 * independently — a test asserting the drawn layer is the near one has no other
 * way to say which one that is.
 */
export function folded3dEyeDirection(camera: FoldedFigureCamera): Vec3 {
  const [a, b, c] = viewDepthAxis(viewRotationFor(camera));
  return [a, -c, b];
}
