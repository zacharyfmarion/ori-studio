/**
 * Where the tool hint window sits.
 *
 * The window is pinned to the bottom-right of the Edit workspace and deliberately
 * **overhangs the seam** between the crease-pattern viewport and the View pane by
 * a fixed amount. That overhang is the whole point of the placement: a surface
 * that breaks the panel boundary reads as a window that appeared for the current
 * tool, where the same surface flush inside the pane read as one more section of
 * it.
 *
 * The rule is anchored to the seam rather than to the app's right edge, so the
 * overhang stays exactly {@link CP_TOOL_HINT_OVERHANG} however wide the user
 * drags the View pane. Anchoring to the right edge instead would make the
 * overhang a function of the pane's width — 50px at the default 260px, and gone
 * entirely once the pane is wider than the window.
 *
 * The viewport's **right edge is the seam**: the View pane's left edge is the
 * same line. So the whole geometry derives from one rect the panel already
 * tracks, with no cross-panel element lookup.
 */

/** Fixed window width. Wide enough for the six-field angle-system grid. */
export const CP_TOOL_HINT_WIDTH = 288;

/** How far the window's left edge crosses the seam onto the canvas. */
export const CP_TOOL_HINT_OVERHANG = 50;

/**
 * Gap between the window's bottom edge and the viewport's, matching `--space-3`
 * so it shares a baseline with the viewport toolbar.
 */
export const CP_TOOL_HINT_INSET = 12;

/** Minimum gap to the browser window's edges once the clamps below take over. */
const EDGE_GUARD = 8;

/** The part of a `DOMRect` the placement reads. */
export interface CpToolHintAnchorRect {
  /** The seam — the viewport's right edge, in CSS px from the window's left. */
  right: number;
  /** The viewport's bottom edge, in CSS px from the window's top. */
  bottom: number;
}

export interface CpToolHintWindowSize {
  width: number;
  height: number;
}

/** Fixed-position offsets, ready to spread onto a style object. */
export interface CpToolHintPlacement {
  left: number;
  bottom: number;
  width: number;
}

export function cpToolHintPlacement(
  anchor: CpToolHintAnchorRect,
  windowSize: CpToolHintWindowSize
): CpToolHintPlacement {
  // Only shrinks on a browser window too narrow to hold the window at all; the
  // normal case is the constant.
  const width = Math.min(CP_TOOL_HINT_WIDTH, Math.max(0, windowSize.width - EDGE_GUARD * 2));

  // Clamped rather than allowed to run off-screen: with the View pane closed the
  // seam *is* the app's right edge, which would put most of the window past it.
  const maxLeft = windowSize.width - EDGE_GUARD - width;
  const left = Math.min(Math.max(anchor.right - CP_TOOL_HINT_OVERHANG, EDGE_GUARD), maxLeft);

  // `bottom` in a fixed layout is measured up from the browser window's bottom,
  // so the viewport's own bottom has to be converted out of top-down coordinates.
  const bottom = Math.max(windowSize.height - anchor.bottom + CP_TOOL_HINT_INSET, EDGE_GUARD);

  return { left, bottom, width };
}
