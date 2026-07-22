import type { Point } from './geometry';

/**
 * How far the pointer must travel before a press counts as a drag rather than a
 * click. Below it, a press-and-release is a click even if the hand wobbled.
 */
export const DRAG_START_THRESHOLD_PX = 4;

/**
 * Whether a pointer gesture has travelled far enough to be a drag.
 *
 * Both BP panes classify press gestures this way — the tree to tell "add a leaf
 * here" from "rotate this subtree", the packing pane to tell a click-select from
 * a flap or device drag. Sharing the predicate keeps a click meaning the same
 * thing in both, and keeps the threshold a single number.
 *
 * Points are in client (screen) pixels, so the threshold is a real distance on
 * screen and does not change with zoom.
 */
export function hasPassedDragThreshold(
  from: Point,
  to: Point,
  threshold = DRAG_START_THRESHOLD_PX
): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= threshold;
}
