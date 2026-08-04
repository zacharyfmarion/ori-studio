/**
 * Where the tool option window's frame and its controls sit.
 *
 * # The frame scales, the chrome does not
 *
 * These are two different kinds of thing and they follow the camera differently,
 * which is the one subtlety here.
 *
 * The **frame** encloses model-space geometry, so it has to move and resize with
 * the camera exactly as that geometry does — otherwise it stops surrounding the
 * creases it is about, which is its entire job.
 *
 * The **controls** are chrome. Scaling them with the camera would make them
 * unreadable at 10% zoom and fill the viewport at 800%, which is the mistake
 * `InlineSimulationLayer` avoids by counter-scaling its badge. Here they are
 * simply a fixed-size block *positioned against* the frame's top edge.
 *
 * Pure, so both rules are testable without a DOM.
 */
import type { CpOverlayView } from '../CreasePatternWebglCanvas';
import { overlayModelToCss } from '../annotations/annotationTransform';
import type { CpToolOptionBounds } from './toolOptionWindow';

export interface Size {
  width: number;
  height: number;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Breathing room between the geometry and the frame, in CSS px. */
export const FRAME_PADDING_CSS = 16;

/**
 * Smallest frame, in CSS px. Three short creases at low zoom project to almost
 * nothing, and a frame that collapsed onto them would read as a smudge rather
 * than as a window.
 */
const MIN_FRAME_CSS = 48;

/** How close the header may come to the top of the viewport, in CSS px. */
const VIEWPORT_MARGIN_CSS = 8;

/**
 * The frame around `bounds`, in CSS pixels.
 *
 * Takes the screen-space bounding box of the four projected corners rather than
 * projecting two of them: the view can be **rotated**, and a box built from
 * min/max alone would then be the wrong rectangle — narrower than the geometry
 * on one diagonal and cutting it on the other.
 */
export function toolOptionFrame(view: CpOverlayView, bounds: CpToolOptionBounds): Box {
  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ].map((corner) => overlayModelToCss(view, corner));

  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const left = Math.min(...xs) - FRAME_PADDING_CSS;
  const top = Math.min(...ys) - FRAME_PADDING_CSS;
  const width = Math.max(...xs) - Math.min(...xs) + FRAME_PADDING_CSS * 2;
  const height = Math.max(...ys) - Math.min(...ys) + FRAME_PADDING_CSS * 2;

  // Grow about the centre, so a frame held to the minimum still surrounds its
  // geometry rather than sitting off to one corner of it.
  const grow = (extent: number) => Math.max(extent, MIN_FRAME_CSS);
  const grownWidth = grow(width);
  const grownHeight = grow(height);
  return {
    left: left - (grownWidth - width) / 2,
    top: top - (grownHeight - height) / 2,
    width: grownWidth,
    height: grownHeight,
  };
}

/**
 * Where the header sits relative to the frame's top edge, in CSS px.
 *
 * `-height` puts it above the frame — a title bar, attached along the frame's
 * top edge and out of the way of the geometry inside. `0` puts it just inside
 * that edge, for when the frame is against the top of the viewport and there is
 * no room above.
 *
 * Never *below* the frame: below would cover whatever is outside it, while
 * inside overlaps only the region the user is already looking at. And never
 * detached — the header shares the frame's edge either way, so the two read as
 * one window rather than as a floating toolbar that happens to be nearby.
 *
 * # The header is not clamped horizontally
 *
 * It is pinned to the frame's right edge, so panning the framed geometry off
 * screen takes the controls with it. That is the price of attachment and it is
 * the right one: a toolbar that detached and slid along the viewport edge would
 * stop saying *which* region it belongs to, which on a pattern with several
 * vertices is the only thing it is saying. Escape, the arrows and Enter all
 * dispatch focus-independently, so the tool stays operable either way.
 */
export function toolOptionHeaderOffset(
  frame: Box,
  headerHeight: number,
  viewport: Size
): number {
  const above = frame.top - headerHeight;
  const fitsAbove = above >= VIEWPORT_MARGIN_CSS && above + headerHeight <= viewport.height;
  return fitsAbove ? -headerHeight : 0;
}
