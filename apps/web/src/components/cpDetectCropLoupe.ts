/**
 * Geometry for the crop editor's magnifier.
 *
 * A crop handle is dragged over an image that is drawn at a fraction of its
 * size — a 3000 px scan in a 500 px pane — so the pixel the handle is on is
 * invisible under the pointer. The loupe shows a fixed window of *source*
 * pixels around the handle, at native size or larger, with the crop's edges and
 * a crosshair drawn through it. Pure functions here; the component draws.
 */

import type { CpDetectPoint, CpDetectQuad } from '../engine/cpDetectTypes';

/** Rendered size of the loupe, in CSS pixels. */
export const LOUPE_SIZE_PX = 148;
/** Gap between the handle and the loupe's near edge, in CSS pixels. */
export const LOUPE_GAP_PX = 22;

/** The window of source pixels the loupe shows, centred on `center`. */
export interface LoupeWindow {
  /** Top-left corner of the window in source pixels; may lie outside the image. */
  x: number;
  y: number;
  /** Side of the square window in source pixels. */
  span: number;
  /** Loupe pixels per source pixel. */
  scale: number;
}

/**
 * How many source pixels the loupe spans: a 24th of the image's longer side,
 * between 32 and 96. A 1000 px image shows 42 px at 3.5×; a 4000 px scan shows
 * 96 px at 1.5×, which is still the detail the pane hides.
 */
export function loupeSpan(imageWidth: number, imageHeight: number): number {
  const longest = Math.max(imageWidth, imageHeight, 1);
  return Math.min(96, Math.max(32, longest / 24));
}

export function loupeWindow(center: CpDetectPoint, imageWidth: number, imageHeight: number): LoupeWindow {
  const span = loupeSpan(imageWidth, imageHeight);
  return {
    x: center.x - span / 2,
    y: center.y - span / 2,
    span,
    scale: LOUPE_SIZE_PX / span,
  };
}

/** A source-pixel point in loupe pixels. */
export function projectToLoupe(point: CpDetectPoint, window: LoupeWindow): CpDetectPoint {
  return { x: (point.x - window.x) * window.scale, y: (point.y - window.y) * window.scale };
}

/**
 * The part of the image the window covers, as a source rectangle and the loupe
 * rectangle it lands on, or null when the window lies entirely outside. Drawn
 * this way rather than with one `drawImage` over the whole window: the canvas
 * clips a source rectangle that leaves the image *and rescales the rest*, which
 * would slide the picture out from under the crosshair at the image's edges.
 */
export function loupeImageRect(
  window: LoupeWindow,
  imageWidth: number,
  imageHeight: number
): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } | null {
  const sx = Math.max(window.x, 0);
  const sy = Math.max(window.y, 0);
  const ex = Math.min(window.x + window.span, imageWidth);
  const ey = Math.min(window.y + window.span, imageHeight);
  if (ex <= sx || ey <= sy) return null;
  return {
    sx,
    sy,
    sw: ex - sx,
    sh: ey - sy,
    dx: (sx - window.x) * window.scale,
    dy: (sy - window.y) * window.scale,
    dw: (ex - sx) * window.scale,
    dh: (ey - sy) * window.scale,
  };
}

/**
 * Where the loupe sits, as the offset of its top-left corner from the handle
 * in CSS pixels. Above and to the right by default, so the hand holding the
 * handle covers neither; each axis flips when that side would leave the pane,
 * and when neither side fits — a pane narrower than the loupe and its gap —
 * it is clamped inside the pane, which clips anything outside it.
 */
export function loupeOffset(
  handle: CpDetectPoint,
  pane: { width: number; height: number },
  size = LOUPE_SIZE_PX,
  gap = LOUPE_GAP_PX
): { x: number; y: number } {
  return {
    x: placeAlong(handle.x, pane.width, size, gap, gap),
    y: placeAlong(handle.y, pane.height, size, -gap - size, gap),
  };
}

/**
 * One axis of [`loupeOffset`]: `preferred` (an offset from the handle), else
 * the other side of the handle, else the nearest offset that keeps the loupe
 * inside `[0, extent]`.
 */
function placeAlong(at: number, extent: number, size: number, preferred: number, gap: number): number {
  const other = preferred > 0 ? -gap - size : gap;
  for (const offset of [preferred, other]) {
    if (at + offset >= 0 && at + offset + size <= extent) return offset;
  }
  const lowest = -at;
  const highest = extent - size - at;
  if (highest < lowest) return lowest;
  return Math.min(Math.max(preferred, lowest), highest);
}

/** The crop's four edges, for drawing through the loupe. */
export function quadEdges(quad: CpDetectQuad): [CpDetectPoint, CpDetectPoint][] {
  const corners = [quad.top_left, quad.top_right, quad.bottom_right, quad.bottom_left];
  return corners.map((corner, index) => [corner, corners[(index + 1) % corners.length]]);
}

/**
 * The longest side, in pixels, of the copy the rectifier works from. The
 * rectified frame is 1024 px, and a source twice that is more than it can
 * tell apart; a phone photo or a scan comes in at 4000–8000 px, and every
 * crop update used to copy all of it to the worker and warp from all of it —
 * a 64 MB copy and a 0.4 s rectify at 4096 px, against 0.14 s from 2048.
 * The full-resolution image still backs the picture on screen and the loupe.
 */
export const RECTIFY_SOURCE_MAX_PX = 2048;

/** The size to decode a `width` × `height` image to for rectification. */
export function sourceSizeForRectification(
  width: number,
  height: number,
  maxSide = RECTIFY_SOURCE_MAX_PX
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!(longest > maxSide)) return { width, height };
  const scale = maxSide / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
