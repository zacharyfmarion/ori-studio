import type { CpOverlayView } from '../CreasePatternWebglCanvas';
import type { CpImage } from './cpImage';

/**
 * Pure geometry for placing and hit-testing reference images against the
 * crease-pattern camera. The renderer draws images in model coordinates; the DOM
 * overlay and drop handler need to map between the camera's CSS-pixel space
 * ({@link CpOverlayView}: `css = origin + model.x*ex + model.y*ey`) and model
 * space, and to test whether a CSS point lands inside an image's rotated,
 * cropped quad.
 *
 * Kept DOM-free so it is unit-testable.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** Project a model-space point to CSS pixels (canvas-relative). */
export function overlayModelToCss(view: CpOverlayView, model: Vec2): Vec2 {
  return {
    x: view.origin[0] + model.x * view.ex[0] + model.y * view.ey[0],
    y: view.origin[1] + model.x * view.ex[1] + model.y * view.ey[1],
  };
}

/** Invert the affine: CSS pixels → model space. Null if the basis is degenerate. */
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
 * Convert a CSS-pixel *delta* to a model-space delta (the linear part of the
 * inverse affine, without the origin translation). Used to translate an image by
 * a pointer drag. Null if the basis is degenerate.
 */
export function overlayCssDeltaToModel(view: CpOverlayView, dCss: Vec2): Vec2 | null {
  const det = view.ex[0] * view.ey[1] - view.ex[1] * view.ey[0];
  if (Math.abs(det) < 1e-12) return null;
  return {
    x: (dCss.x * view.ey[1] - dCss.y * view.ey[0]) / det,
    y: (-dCss.x * view.ex[1] + dCss.y * view.ex[0]) / det,
  };
}

/** Linear CSS-pixels-per-model-unit scale (sqrt of the affine's area factor). */
export function overlayCssPerModel(view: CpOverlayView): number {
  const det = view.ex[0] * view.ey[1] - view.ex[1] * view.ey[0];
  return Math.sqrt(Math.abs(det));
}

/**
 * Model-space size for a freshly dropped image: preserve the source aspect ratio
 * and scale so the larger side spans `targetModelExtent` model units.
 */
export function fitImageModelSize(
  naturalWidth: number,
  naturalHeight: number,
  targetModelExtent: number
): { width: number; height: number } {
  const aspect = naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : 1;
  if (aspect >= 1) {
    return { width: targetModelExtent, height: targetModelExtent / aspect };
  }
  return { width: targetModelExtent * aspect, height: targetModelExtent };
}

/**
 * The four corners of an image's quad in model space, in order
 * TL, TR, BR, BL (before crop — crop only affects texturing, not the quad).
 * Accounts for center, size, and rotation.
 */
export function imageCornersModel(image: CpImage): [Vec2, Vec2, Vec2, Vec2] {
  const hw = image.width / 2;
  const hh = image.height / 2;
  const cos = Math.cos(image.rotation);
  const sin = Math.sin(image.rotation);
  const corner = (dx: number, dy: number): Vec2 => ({
    x: image.center.x + dx * cos - dy * sin,
    y: image.center.y + dx * sin + dy * cos,
  });
  return [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)];
}

/** True if `model` lies inside the image's rotated quad. */
export function imageContainsModelPoint(image: CpImage, model: Vec2): boolean {
  // Transform the point into the image's local (unrotated, centered) frame.
  const dx = model.x - image.center.x;
  const dy = model.y - image.center.y;
  const cos = Math.cos(image.rotation);
  const sin = Math.sin(image.rotation);
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  return Math.abs(localX) <= image.width / 2 && Math.abs(localY) <= image.height / 2;
}

/**
 * Topmost image (highest z, then latest in array) whose quad contains the given
 * model point, skipping hidden and locked images. Returns null when none match.
 */
export function imageAtModelPoint(
  images: readonly CpImage[],
  model: Vec2
): CpImage | null {
  let best: CpImage | null = null;
  for (const image of images) {
    if (image.hidden || image.locked) continue;
    if (!imageContainsModelPoint(image, model)) continue;
    // Higher z wins; on ties the later array entry (painted on top) wins.
    if (!best || image.z >= best.z) best = image;
  }
  return best;
}
