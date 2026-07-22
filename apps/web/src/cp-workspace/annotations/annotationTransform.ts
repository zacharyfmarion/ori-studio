import type { CpOverlayView } from '../CreasePatternWebglCanvas';

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
 * Kept DOM-free so it is unit-testable.
 */

export interface Vec2 {
  x: number;
  y: number;
}

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

/** A rotated, centred box — the transform shared by every manipulable object. */
export interface AnnotationBox {
  center: Vec2;
  width: number;
  height: number;
  rotation: number;
}

/** The eight resize handles, by compass position on the (unrotated) box. */
export type AnnotationResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** The four corner handles — the only ones offered for aspect-locked objects. */
export const CORNER_RESIZE_HANDLES: readonly AnnotationResizeHandle[] = [
  'nw',
  'ne',
  'se',
  'sw',
];

/** Local-axis signs of a handle's dragged point: 0 = that axis is fixed (edge). */
export const HANDLE_SIGNS: Record<AnnotationResizeHandle, { sx: -1 | 0 | 1; sy: -1 | 0 | 1 }> = {
  nw: { sx: -1, sy: -1 },
  n: { sx: 0, sy: -1 },
  ne: { sx: 1, sy: -1 },
  e: { sx: 1, sy: 0 },
  se: { sx: 1, sy: 1 },
  s: { sx: 0, sy: 1 },
  sw: { sx: -1, sy: 1 },
  w: { sx: -1, sy: 0 },
};

/** Minimum extent (object units) so a resize can't collapse the box. */
export const MIN_BOX_EXTENT = 1e-4;

export interface AnnotationResizeResult {
  center: Vec2;
  width: number;
  height: number;
}

/**
 * The four corners of a rotated, centred box in object space, in order
 * TL, TR, BR, BL (in the box's local frame, before rotation).
 */
export function boxCornersModel(box: AnnotationBox): [Vec2, Vec2, Vec2, Vec2] {
  const hw = box.width / 2;
  const hh = box.height / 2;
  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);
  const corner = (dx: number, dy: number): Vec2 => ({
    x: box.center.x + dx * cos - dy * sin,
    y: box.center.y + dx * sin + dy * cos,
  });
  return [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)];
}

/**
 * Resize a box by dragging one of its eight handles to `pointerModel`, keeping
 * the opposite corner/edge anchored. Pure — returns the new centre + extent.
 *
 * With `aspectLock` the box keeps its proportions: a corner drag takes the
 * larger of the two axis ratios, and an *edge* drag scales both axes from the
 * one axis it controls. (Before aspect lock became the default for images, edge
 * handles ignored the flag entirely, which read as the lock silently failing.)
 */
export function resizeAnnotationBox(
  box: AnnotationBox,
  handle: AnnotationResizeHandle,
  pointerModel: Vec2,
  aspectLock = false
): AnnotationResizeResult {
  const { sx, sy } = HANDLE_SIGNS[handle];
  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);
  const u: Vec2 = { x: cos, y: sin }; // local +x (right) in object space
  const v: Vec2 = { x: -sin, y: cos }; // local +y (down) in object space
  const hw = box.width / 2;
  const hh = box.height / 2;

  // Anchor = the opposite corner/edge, fixed during the drag.
  const anchorLocalX = -sx * hw;
  const anchorLocalY = -sy * hh;
  const anchor: Vec2 = {
    x: box.center.x + u.x * anchorLocalX + v.x * anchorLocalY,
    y: box.center.y + u.y * anchorLocalX + v.y * anchorLocalY,
  };
  const dx = pointerModel.x - anchor.x;
  const dy = pointerModel.y - anchor.y;
  const du = dx * u.x + dy * u.y; // extent along local x
  const dv = dx * v.x + dy * v.y; // extent along local y

  let width = sx !== 0 ? Math.abs(du) : box.width;
  let height = sy !== 0 ? Math.abs(dv) : box.height;

  if (aspectLock) {
    // The scale factor comes from whichever axes the handle actually drives:
    // both for a corner, the single controlled axis for an edge.
    const ratios: number[] = [];
    if (sx !== 0 && box.width > 0) ratios.push(Math.abs(du) / box.width);
    if (sy !== 0 && box.height > 0) ratios.push(Math.abs(dv) / box.height);
    if (ratios.length > 0) {
      const scale = Math.max(...ratios);
      width = box.width * scale;
      height = box.height * scale;
    }
  }

  width = Math.max(width, MIN_BOX_EXTENT);
  height = Math.max(height, MIN_BOX_EXTENT);

  // The centre sits half the new extent from the anchor along the drag direction
  // on active axes. Under aspect lock an edge handle also changes the *passive*
  // axis, and that growth is shared either side of the anchor — the anchored
  // edge stays put, so the centre shifts by half the passive delta.
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

/**
 * How an object's resize treats its aspect ratio, and whether Shift escapes it.
 *
 * - `always` — proportional, no escape. A folded figure has no meaningful
 *   non-uniform scale (its placement carries a single scalar), so stretching it
 *   is not a thing the model can express.
 * - `default-on` — proportional, Shift frees it. Reference images: distorting a
 *   photo is the rare intent, so it costs a modifier.
 * - `default-off` — free, Shift locks it. Text boxes: the content reflows to the
 *   width, so dragging width and height independently is the normal intent.
 */
export type AspectLockPolicy = 'always' | 'default-on' | 'default-off';

/** Resolve whether a resize should keep proportions, given the live modifier. */
export function resizeAspectLock(policy: AspectLockPolicy, shiftKey: boolean): boolean {
  switch (policy) {
    case 'always':
      return true;
    case 'default-on':
      return !shiftKey;
    case 'default-off':
      return shiftKey;
  }
}

/** Snap an angle (radians) to the nearest multiple of `step` radians. */
export function snapAngle(angle: number, step: number): number {
  return Math.round(angle / step) * step;
}

/** True if `model` lies inside the box's rotated rectangle. */
export function boxContainsModelPoint(box: AnnotationBox, model: Vec2): boolean {
  // Transform the point into the box's local (unrotated, centred) frame.
  const dx = model.x - box.center.x;
  const dy = model.y - box.center.y;
  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  return Math.abs(localX) <= box.width / 2 && Math.abs(localY) <= box.height / 2;
}
