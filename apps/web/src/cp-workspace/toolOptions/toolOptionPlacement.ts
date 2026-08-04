/**
 * Where the tool option window sits, given where it points.
 *
 * # It does not scale with zoom
 *
 * The obvious model is `InlineSimulationLayer`, and this deliberately takes only
 * its anchoring, not its sizing. An inline simulation scales with the camera
 * because its content *is* model geometry — a folded figure two grid squares
 * wide should look two grid squares wide. A tool window is **chrome**: its text
 * has to stay legible at 10% zoom and must not swell to fill the viewport at
 * 800%. So the box is a fixed number of CSS pixels and only its *position*
 * follows the camera.
 *
 * That also removes the reason `inlineSimulationPlacement` is complicated. It
 * exists to keep a canvas's layout box stable across camera frames, because a
 * layout write wakes the canvas's `ResizeObserver` and re-renders the
 * simulation. Nothing here holds a bitmap, so placing a fixed-size box is the
 * whole story.
 *
 * Pure, so the flip and clamp rules are testable without a DOM.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
}

/** Gap between the anchor point and the window's near corner, in CSS px. */
export const ANCHOR_GAP_CSS = 14;

/** How close the window may come to the viewport edge, in CSS px. */
const VIEWPORT_MARGIN_CSS = 8;

/**
 * Place `size` near `anchor` without leaving `viewport`.
 *
 * Preferred corner is below-right of the anchor, which keeps the window clear of
 * the cursor on the way to it. Each axis flips to the other side of the anchor
 * when the preferred side would overflow, and only then clamps — flipping first
 * matters because a clamped window slides *over* the thing it points at, while a
 * flipped one stays beside it.
 *
 * The clamp is last and unconditional, so a window larger than the viewport is
 * pinned to the top-left rather than escaping it. That is a degenerate case with
 * no good answer; being visible beats being correctly offset.
 */
export function toolOptionPlacement(
  anchor: { x: number; y: number },
  size: Size,
  viewport: Size,
  gap: number = ANCHOR_GAP_CSS
): Placement {
  const place = (
    at: number,
    extent: number,
    available: number
  ): number => {
    const after = at + gap;
    const before = at - gap - extent;
    const overflowsAfter = after + extent > available - VIEWPORT_MARGIN_CSS;
    const fitsBefore = before >= VIEWPORT_MARGIN_CSS;
    const chosen = overflowsAfter && fitsBefore ? before : after;
    const highest = Math.max(VIEWPORT_MARGIN_CSS, available - extent - VIEWPORT_MARGIN_CSS);
    return Math.min(Math.max(chosen, VIEWPORT_MARGIN_CSS), highest);
  };

  return {
    left: place(anchor.x, size.width, viewport.width),
    top: place(anchor.y, size.height, viewport.height),
  };
}
