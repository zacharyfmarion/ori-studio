import type { CpOverlayView } from '../CreasePatternWebglCanvas';
import type { TransformBox, TransformResizeHandle, TransformResizeResult, Vec2 } from '../../lib/transformBox';

/**
 * Pure box-transform math shared by every object the CP canvas lets you
 * directly manipulate — reference images, text boxes, and folded figures.
 *
 * Two spaces are involved. A {@link CpOverlayView} is an affine mapping some
 * object space to CSS pixels (`css = origin + p.x*ex + p.y*ey`); the helpers
 * here move points and deltas across it. Everything else operates on an
 * {@link AnnotationBox} — a rotated, centred rectangle — and is camera-agnostic,
 * so a gesture computes in object space and only the projection cares which
 * space the object lives in.
 *
 * The box math itself is `lib/transformBox.ts` (Diagram Revision 3), which the
 * Diagram's stars, eyes and shapes use too; it is re-exported here, under the
 * names this canvas has always used, so none of its importers changed.
 *
 * Kept DOM-free so it is unit-testable.
 */

export type { Vec2 };
export {
  CORNER_RESIZE_HANDLES,
  HANDLE_SIGNS,
  MIN_BOX_EXTENT,
  boxContainsModelPoint,
  boxCornersModel,
  resizeAnnotationBox,
  resizeAspectLock,
  snapAngle,
  type AspectLockPolicy,
} from '../../lib/transformBox';

/** Project an object-space point to CSS pixels (canvas-relative). */
export function overlayModelToCss(view: CpOverlayView, model: Vec2): Vec2 {
  return {
    x: view.origin[0] + model.x * view.ex[0] + model.y * view.ey[0],
    y: view.origin[1] + model.x * view.ex[1] + model.y * view.ey[1],
  };
}

/** Invert the affine: CSS pixels → object space. Null if the basis is degenerate. */
export function overlayCssToModel(view: CpOverlayView, css: Vec2): Vec2 | null {
  const det = view.ex[0] * view.ey[1] - view.ex[1] * view.ey[0];
  if (Math.abs(det) < 1e-12) return null;
  const px = css.x - view.origin[0];
  const py = css.y - view.origin[1];
  return {
    x: (px * view.ey[1] - py * view.ey[0]) / det,
    y: (-px * view.ex[1] + py * view.ex[0]) / det,
  };
}

/**
 * Convert a CSS-pixel *delta* to an object-space delta (the linear part of the
 * inverse affine, without the origin translation). Used to translate an object
 * by a pointer drag. Null if the basis is degenerate.
 */
export function overlayCssDeltaToModel(view: CpOverlayView, dCss: Vec2): Vec2 | null {
  const det = view.ex[0] * view.ey[1] - view.ex[1] * view.ey[0];
  if (Math.abs(det) < 1e-12) return null;
  return {
    x: (dCss.x * view.ey[1] - dCss.y * view.ey[0]) / det,
    y: (-dCss.x * view.ex[1] + dCss.y * view.ex[0]) / det,
  };
}

/** Linear CSS-pixels-per-object-unit scale (sqrt of the affine's area factor). */
export function overlayCssPerModel(view: CpOverlayView): number {
  const det = view.ex[0] * view.ey[1] - view.ex[1] * view.ey[0];
  return Math.sqrt(Math.abs(det));
}

/**
 * The object-space rotation whose local +x axis points along screen +x — what to
 * store on a box so it renders upright under this view.
 *
 * Objects are anchored to the paper, so an object created on a canvas turned by
 * θ has to carry −θ to look square to the person creating it. Derived by mapping
 * a CSS +x step back through the inverse affine rather than by negating a camera
 * angle, so it stays exact under a flipped or non-conformal basis instead of
 * assuming the view is a pure rotation.
 *
 * Returns 0 for a degenerate view — an unrotated box beats no box.
 */
export function uprightRotationForView(view: CpOverlayView | null | undefined): number {
  if (!view) return 0;
  const alongScreenX = overlayCssDeltaToModel(view, { x: 1, y: 0 });
  if (!alongScreenX) return 0;
  return Math.atan2(alongScreenX.y, alongScreenX.x);
}

/** A rotated, centred box — the transform shared by every manipulable object. */
export type AnnotationBox = TransformBox;

/** The eight resize handles, by compass position on the (unrotated) box. */
export type AnnotationResizeHandle = TransformResizeHandle;

export type AnnotationResizeResult = TransformResizeResult;
