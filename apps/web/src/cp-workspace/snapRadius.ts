/**
 * The crease-pattern snap radius: one law, in model units, for every surface
 * that asks "is the cursor close enough".
 *
 * Before this module there were five answers — a screen-constant canvas radius,
 * a separate kernel-payload radius that was numerically the *hit* tolerance, a
 * dead default on the snapper itself, a hardcoded 1 on the Delete path, and the
 * kernel's own fallback. See `implementation-plans/configurable-snap-radius.md`.
 */
import { CP_PAPER_RECT, ORIEDITA_PAPER_SIZE } from '../lib/creasePatternViewport';
import { CP_DEFAULT_SNAP_RADIUS } from '../lib/cpSnapRadiusSetting';

/**
 * CSS pixels per model unit at 100% zoom. The canvas defines 100% as "1 SVG user
 * unit == 1 CSS px", and `cpModelToSvg` maps the 400-unit Oriedita paper onto
 * `CP_PAPER_RECT.width`, so this is the whole of the model-to-screen scale.
 *
 * It is also why our radius is not numerically Oriedita's *in pixels*: upstream
 * draws the same paper 400 px wide, so the same model radius covers the same
 * fraction of the drawing but 1.47× the pixels.
 */
export const CP_MODEL_TO_CSS = CP_PAPER_RECT.width / ORIEDITA_PAPER_SIZE;

/**
 * Ratios of the base radius, preserving the 10 / 8 / 6 spread the CP surface
 * shipped as constants.
 *
 * The spread is load-bearing, in both directions. A crease's nearest point is
 * its perpendicular foot, which sits essentially on top of its own endpoint, so
 * a point radius as wide as the line radius lets a crease shadow its own vertex
 * — and a point radius that reaches as far as the line one makes a mid-crease
 * click read as a vertex. Scale them together; never collapse them.
 */
export const CP_SNAP_RATIO = 1;
export const CP_LINE_HIT_RATIO = 0.8;
export const CP_POINT_HIT_RATIO = 0.6;

/**
 * Ceiling on the zoomed-out floor, in CSS px, before ratios. Today's
 * `SNAP_TOLERANCE_CSS`.
 *
 * The floor itself is the smaller of this and what the user's own radius gives at
 * 100% zoom, which matters at the tight end of the slider: a flat 10 px floor
 * would quietly ignore every setting below ~7, so a user asking for *less*
 * grabby snapping would get today's behaviour and no explanation.
 *
 * A floor is needed at all only because our editable canvas is about ten paper
 * widths where upstream's world *is* the 400-unit paper, so `fitUserCamera`
 * opens large documents far enough out that upstream's law alone decays the
 * radius to a pixel or two.
 */
export const CP_MIN_SNAP_RADIUS_CSS = 10;

/**
 * Resolve the snap radius in model units at a given zoom.
 *
 * The body is Oriedita's `CreasePattern_Worker_Impl.calculateDecisionWidth()` —
 * `mouseRadius / max(1, zoom)` — which holds the radius constant *on screen*
 * while zoomed in and constant *in model units* while zoomed out, so it can
 * swallow neither the pixels nor the geometry. The floor is ours, and only ever
 * widens the result.
 *
 * @param radius base radius in model units (the user's setting)
 * @param zoom   `zoomPercent / 100`, i.e. CSS px per SVG user unit
 * @param ratio  one of the `CP_*_RATIO` constants
 */
export function cpSnapRadiusModel(radius: number, zoom: number, ratio: number = CP_SNAP_RATIO): number {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : CP_DEFAULT_SNAP_RADIUS;
  const upstream = (safeRadius * ratio) / Math.max(1, safeZoom);
  // Never decay below what this setting already gives at 100% zoom, and never
  // demand more than `CP_MIN_SNAP_RADIUS_CSS`. The floor carries the ratio too:
  // flattening the spread at low zoom would break the vertex-vs-crease priority
  // the ratios exist to express.
  const floorCss = Math.min(safeRadius * CP_MODEL_TO_CSS, CP_MIN_SNAP_RADIUS_CSS) * ratio;
  const floor = floorCss / (CP_MODEL_TO_CSS * safeZoom);
  return Math.max(upstream, floor);
}
