/**
 * Where a region's chip sits and how wide it is.
 *
 * The chip is a **title bar**, not a floating pill: it spans the region's
 * on-screen width and shares its top edge, so it reads as part of the box rather
 * than as a toolbar that happens to be nearby. That matters more here than for
 * any other canvas object, because the region's body is inert — the bar is the
 * only thing that selects or moves it, and a bar that had drifted off its box
 * would be a handle with nothing visibly attached to it.
 *
 * # Why this is not `FloatingToolbar`
 *
 * `FloatingToolbar` sizes to its own content and, on a collision, `shift`s along
 * the boundary to stay inside. Both are right for a pill and wrong for a title
 * bar: the width has to come from the *region*, and sliding the bar sideways
 * relative to its box is precisely the detachment the shape exists to avoid. The
 * `size` middleware would be worse still — deriving a width from the pill's own
 * width is a cycle (`toolbarMaxWidth` records what that costs). Everything here
 * is a function of the **anchor** and the **boundary**, neither of which depends
 * on the bar, so there is no loop to have.
 *
 * `barHeight` is the one measured input, and it only ever moves the bar
 * vertically. It cannot feed back: the bar does not wrap, so its height is a
 * function of its content and not of where it is put.
 *
 * Pure and DOM-free, for the same reason as `toolOptionPlacement` and
 * `floatingToolbarBounds`: jsdom lays nothing out, so placement is only testable
 * as arithmetic.
 */
import {
  anchorIntersectsBoundary,
  type BoundaryRect,
} from '../../components/ui/floatingToolbarBounds';
import type { FloatingAnchorRect } from '../../components/ui/FloatingToolbar';

/** Breathing room between the bar and the edge of its pane, in CSS px. */
export const REGION_CHIP_BOUNDARY_PADDING = 8;

/**
 * Gap between the bar's lower edge and the region's top edge, in CSS px.
 *
 * Small on purpose. The two are meant to read as one object, and a gap wide
 * enough to see is a gap wide enough to look like two.
 */
export const REGION_CHIP_GAP = 2;

/**
 * Narrowest the bar may be, in CSS px.
 *
 * A region drawn small — or a large one at 10% zoom — projects to a few pixels,
 * and a bar that honoured that width would be an unclickable smear. Below this
 * the bar stops matching the region and stays usable instead, which is the same
 * trade `toolbarMaxWidth`'s `min` makes at the other end.
 */
export const REGION_CHIP_MIN_WIDTH = 180;

export interface RegionChipPlacement {
  /** Viewport CSS px. */
  left: number;
  top: number;
  width: number;
}

/**
 * Place the bar for a region whose screen box is `anchor`, or null once the
 * region has left the pane.
 *
 * Three rules, in the order they matter:
 *
 * - **Width is the region's**, clamped up to {@link REGION_CHIP_MIN_WIDTH} and
 *   down to what the pane holds.
 * - **Above the top edge when there is room**, just inside it when there is not.
 *   Never below: below covers whatever is outside the region, while inside
 *   overlaps only the box the user is already looking at. Same rule, and the
 *   same reasoning, as `toolOptionHeaderOffset`.
 * - **Kept inside the pane.** Unlike the tool-option header this *is* clamped,
 *   because zooming into a region puts its top edge off screen while the user is
 *   working inside it — and that is exactly when the bar's controls (Solve, most
 *   of all) must still be reachable. The region leaving the pane altogether is
 *   the case that returns null instead.
 */
export function regionChipPlacement(
  anchor: FloatingAnchorRect,
  boundary: BoundaryRect,
  barHeight: number
): RegionChipPlacement | null {
  if (!anchorIntersectsBoundary(anchor, boundary, REGION_CHIP_BOUNDARY_PADDING)) return null;

  const minLeft = boundary.left + REGION_CHIP_BOUNDARY_PADDING;
  const maxRight = boundary.right - REGION_CHIP_BOUNDARY_PADDING;
  const room = Math.max(maxRight - minLeft, 0);
  const width = Math.max(Math.min(anchor.width, room), REGION_CHIP_MIN_WIDTH);
  const left = Math.min(Math.max(anchor.left, minLeft), Math.max(minLeft, maxRight - width));

  const minTop = boundary.top + REGION_CHIP_BOUNDARY_PADDING;
  const maxTop = Math.max(minTop, boundary.bottom - REGION_CHIP_BOUNDARY_PADDING - barHeight);
  const above = anchor.top - REGION_CHIP_GAP - barHeight;
  const top =
    above >= minTop
      ? above
      : Math.min(Math.max(anchor.top + REGION_CHIP_GAP, minTop), maxTop);

  return { left, top, width };
}
