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

/** The eight resize handles, by compass position on the (unrotated) image. */
export type CpImageResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Local-axis signs of a handle's dragged point: 0 = that axis is fixed (edge). */
const HANDLE_SIGNS: Record<CpImageResizeHandle, { sx: -1 | 0 | 1; sy: -1 | 0 | 1 }> = {
  nw: { sx: -1, sy: -1 },
  n: { sx: 0, sy: -1 },
  ne: { sx: 1, sy: -1 },
  e: { sx: 1, sy: 0 },
  se: { sx: 1, sy: 1 },
  s: { sx: 0, sy: 1 },
  sw: { sx: -1, sy: 1 },
  w: { sx: -1, sy: 0 },
};

/** Minimum image extent (model units) so a resize can't collapse the quad. */
const MIN_IMAGE_EXTENT = 1e-4;

export interface CpImageResizeResult {
  center: Vec2;
  width: number;
  height: number;
}

/**
 * Resize an image by dragging one of its eight handles to `pointerModel`,
 * keeping the opposite corner/edge anchored. Corner handles scale both axes;
 * edge handles scale one. `aspectLock` (Shift on a corner) preserves the source
 * aspect ratio. Pure — returns the new center + extent.
 */
export function resizeImage(
  image: CpImage,
  handle: CpImageResizeHandle,
  pointerModel: Vec2,
  aspectLock = false
): CpImageResizeResult {
  const { sx, sy } = HANDLE_SIGNS[handle];
  const cos = Math.cos(image.rotation);
  const sin = Math.sin(image.rotation);
  const u: Vec2 = { x: cos, y: sin }; // local +x (right) in model space
  const v: Vec2 = { x: -sin, y: cos }; // local +y (down) in model space
  const hw = image.width / 2;
  const hh = image.height / 2;

  // Anchor = the opposite corner/edge, fixed during the drag.
  const anchorLocalX = -sx * hw;
  const anchorLocalY = -sy * hh;
  const anchor: Vec2 = {
    x: image.center.x + u.x * anchorLocalX + v.x * anchorLocalY,
    y: image.center.y + u.y * anchorLocalX + v.y * anchorLocalY,
  };
  const dx = pointerModel.x - anchor.x;
  const dy = pointerModel.y - anchor.y;
  const du = dx * u.x + dy * u.y; // extent along local x
  const dv = dx * v.x + dy * v.y; // extent along local y

  let width = sx !== 0 ? Math.abs(du) : image.width;
  let height = sy !== 0 ? Math.abs(dv) : image.height;

  if (aspectLock && sx !== 0 && sy !== 0) {
    const scale = Math.max(Math.abs(du) / image.width, Math.abs(dv) / image.height);
    width = image.width * scale;
    height = image.height * scale;
  }

  width = Math.max(width, MIN_IMAGE_EXTENT);
  height = Math.max(height, MIN_IMAGE_EXTENT);

  // Center sits half the new extent from the anchor, along the drag direction on
  // active axes; on a fixed axis the anchor already carries the center's position.
  const signU = du >= 0 ? 1 : -1;
  const signV = dv >= 0 ? 1 : -1;
  const offX = sx !== 0 ? (signU * width) / 2 : 0;
  const offY = sy !== 0 ? (signV * height) / 2 : 0;
  return {
    center: {
      x: anchor.x + u.x * offX + v.x * offY,
      y: anchor.y + u.y * offX + v.y * offY,
    },
    width,
    height,
  };
}

/** Snap an angle (radians) to the nearest multiple of `step` radians. */
export function snapAngle(angle: number, step: number): number {
  return Math.round(angle / step) * step;
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
