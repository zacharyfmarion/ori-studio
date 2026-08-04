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

/** Gap between the frame's top edge and the controls above it, in CSS px. */
const CHROME_GAP_CSS = 6;

/** How close the controls may come to the viewport edge, in CSS px. */
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
 * Where the controls go, given the frame they belong to.
 *
 * Above the frame's top-left by default — a title bar, and out of the way of the
 * geometry the frame is showing. When there is no room above, they drop *inside*
 * the frame's top edge rather than below it: below would put them over whatever
 * is beneath the frame, and inside at least overlaps only the region the user is
 * already looking at.
 */
export function toolOptionChromePlacement(
  frame: Box,
  chrome: Size,
  viewport: Size
): { left: number; top: number } {
  const above = frame.top - CHROME_GAP_CSS - chrome.height;
  const inside = frame.top + CHROME_GAP_CSS;
  const top = above >= VIEWPORT_MARGIN_CSS ? above : inside;
  const highest = Math.max(
    VIEWPORT_MARGIN_CSS,
    viewport.height - chrome.height - VIEWPORT_MARGIN_CSS
  );
  const rightmost = Math.max(
    VIEWPORT_MARGIN_CSS,
    viewport.width - chrome.width - VIEWPORT_MARGIN_CSS
  );
  return {
    left: Math.min(Math.max(frame.left, VIEWPORT_MARGIN_CSS), rightmost),
    top: Math.min(Math.max(top, VIEWPORT_MARGIN_CSS), highest),
  };
}
