/**
 * Whether a floating toolbar's anchor is still inside the region the toolbar is
 * confined to.
 *
 * `@floating-ui`'s `shift` keeps the pill inside its boundary, but with
 * `limitShift()` it deliberately stops doing so once the anchor itself leaves —
 * a toolbar that slid along the pane edge would stop saying *which* object it
 * belongs to, which on a canvas holding several is the only thing it is saying.
 * The right answer once the object is gone is not to slide, it is to go away
 * too, and that is the decision this makes.
 *
 * Pure and DOM-free on purpose: jsdom gives `@floating-ui` nothing but zero
 * rects, so its own `hide()` middleware could not be covered by a unit test at
 * all. Same reasoning as `toolHintPlacement.ts` and `toolOptionPlacement.ts`.
 */
import type { FloatingAnchorRect } from './FloatingToolbar';

/** The subset of `DOMRect` this needs, so tests can pass plain objects. */
export interface BoundaryRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Shrinks one axis of the boundary by `padding` on each side, without ever
 * inverting it.
 *
 * A pane narrower than twice the padding is not a reason to declare everything
 * out of bounds — that happens transiently while a splitter is dragged shut,
 * and a toolbar that blinked out at that moment would look like a bug. Collapse
 * to the centre line instead, so the test degrades to "does the anchor cross
 * the middle of the pane".
 */
function inset(start: number, end: number, padding: number): [number, number] {
  const room = Math.max(0, (end - start) / 2);
  const applied = Math.min(padding, room);
  return [start + applied, end - applied];
}

/**
 * True while any part of `anchor` is inside `boundary`, inset by `padding`.
 *
 * Touching counts as inside: a wrongly hidden toolbar costs the user an action,
 * a wrongly shown one costs a pixel of overlap, so the tie goes to showing it.
 */
export function anchorIntersectsBoundary(
  anchor: FloatingAnchorRect,
  boundary: BoundaryRect,
  padding: number,
): boolean {
  const [left, right] = inset(boundary.left, boundary.right, padding);
  const [top, bottom] = inset(boundary.top, boundary.bottom, padding);
  return (
    anchor.left <= right &&
    anchor.left + anchor.width >= left &&
    anchor.top <= bottom &&
    anchor.top + anchor.height >= top
  );
}

/**
 * Widest the pill may be inside `boundary`, in whole px.
 *
 * Deliberately a function of the boundary **alone** — not of the pill, and not
 * of where the pill ended up. `@floating-ui`'s `size` middleware would compute
 * the tighter "space left on the chosen side", but that depends on the resolved
 * placement, which depends on the pill's width, which is the thing being set:
 * writing it from inside the position pipeline resizes an element that the
 * position pipeline observes, and the browser reports the resulting undelivered
 * notifications as an error. "No wider than the pane" is both the rule actually
 * wanted and a fixed point, so it can be applied as a plain style instead.
 *
 * Rounded because a fractional width jitters between frames during a pane drag,
 * and each distinct value is another layout write.
 *
 * `min` keeps the controls hittable on a pane too narrow to hold them; below it
 * the pill is allowed to overflow, respecting the boundary having by then cost
 * more than it bought.
 */
export function toolbarMaxWidth(boundary: BoundaryRect, padding: number, min: number): number {
  return Math.round(Math.max(boundary.right - boundary.left - padding * 2, min));
}
