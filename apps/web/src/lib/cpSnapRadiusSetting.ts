/**
 * The crease-pattern snap radius *setting*: its unit, its bounds, its default,
 * and the clamp every entry point runs. The snapping law that consumes it lives
 * in `cp-workspace/snapRadius.ts`; this module is deliberately free of any
 * CP-workspace import so the storage layer, the settings store and the settings
 * modal can read the bounds without pulling the canvas in behind them.
 *
 * The unit is **Oriedita model units** — the paper is 400 across — so the number
 * means exactly what the same number means in Oriedita's own preference
 * (`mouseRadius`: default 10, slider 2-100, integer step). Matching pixels
 * instead would have made the same number reach less of the drawing here, since
 * we draw that 400-unit paper 588 CSS px wide.
 */

/** Oriedita's `mouseRadius` default. */
export const CP_DEFAULT_SNAP_RADIUS = 10;
/** Oriedita's slider bounds, carried over unchanged because the unit is shared. */
export const CP_MIN_SNAP_RADIUS = 2;
export const CP_MAX_SNAP_RADIUS = 100;

/**
 * Clamp a radius to the slider's bounds, rounding to its integer step.
 *
 * Non-finite input degrades to the default rather than to the minimum (the shape
 * `clampOristudioCpLineWidth` uses): the callers here are a hand-editable
 * storage key and a free-text field, where an unreadable value means "no
 * answer", not "the tightest possible answer" — and the tightest answer is the
 * one that makes vertices hard to hit.
 */
export function clampCpSnapRadius(value: number): number {
  if (!Number.isFinite(value)) return CP_DEFAULT_SNAP_RADIUS;
  return Math.min(CP_MAX_SNAP_RADIUS, Math.max(CP_MIN_SNAP_RADIUS, Math.round(value)));
}
