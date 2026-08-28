/**
 * Screen-size scaling for creases, diagnostic markers and vertex dots.
 *
 * All three are ~constant *screen* size, modulated by how far the camera sits
 * from the "whole document fits" zoom. Pulled out of the canvas so the law is
 * unit-testable: it is the one place a bad document coordinate can reach every
 * drawn primitive at once, which is exactly what happened (see
 * {@link CP_MAX_WIDTH_BOOST}).
 */

/**
 * Crease width + markers are essentially constant screen size, but grow *very*
 * gently as you zoom in past the fit view so they don't read as thinning against
 * the expanding content. 0 = fully constant (thins relative to content), 1 =
 * full world-scaling (the old fattening). ~0.15 is a mild, crisp middle. The
 * growth is anchored at the fit zoom so it behaves the same for any CP scale.
 */
export const WIDTH_ZOOM_EXPONENT = 0.15;

/**
 * Ceiling on {@link WIDTH_ZOOM_EXPONENT}'s growth term.
 *
 * The shrink terms below are naturally bounded — they only apply while
 * `zoomRatio < 1`, so they cannot exceed 1. The growth term has no such bound,
 * and it divides by a zoom derived from the drawing's extent, so geometry far
 * from the rest of the document inflates it without limit.
 *
 * This is the *backstop*, not the fix. `cpSizingBounds` is what keeps a stray
 * coordinate out of the reference scale in the first place, and it does so
 * exactly — a document renders identically with and without one. But it works by
 * discarding a small percentile of crease endpoints, so it needs enough of them
 * to discard: on a sparse document (under ~25 creases) it trims nothing, and
 * this ceiling is the only thing standing between a bad coordinate and a buried
 * canvas. The two are complementary and both are load-bearing.
 *
 * 4 is deliberately far above anything reachable by legitimate use: it saturates
 * only past ~10,000x the fit zoom, where you are inspecting detail finer than
 * the pattern's own numerical precision. So it is inert on healthy documents,
 * and with `cpSizingBounds` in front of it, inert on most damaged ones too.
 */
export const CP_MAX_WIDTH_BOOST = 4;

/**
 * How fast diagnostic markers and cursor decorations shrink when zoomed *out*
 * past the fit view. 0 = constant screen size, 1 = lockstep with the content.
 * These are affordances rather than content — a snap ring that shrank with the
 * paper would stop reading as a target — so they keep a partial shrink.
 */
export const MARKER_SHRINK_EXPONENT = 0.7;

/**
 * How fast crease points and vertices shrink when zoomed *out* past the fit view.
 * 1 = lockstep with the content, so a vertex stays the same fraction of the
 * pattern at every zoom and the picture reads identically at any scale. Anything
 * below 1 makes vertices grow relative to the creases as you zoom out, which on a
 * dense CP turns the pattern into a field of dots. Sub-pixel dots then fade
 * rather than clamp (see the point program), which is what "shrink with the
 * pattern" means once a dot is asking for less than a pixel of ink.
 *
 * Note this rides `zoomRatio`, which is normalised against the whole document's
 * bounding box and so is meaningless on a sheet holding several patterns — there
 * it pins at 1 and dots keep their full size. Visibility is handled separately
 * by the canvas's crowding ramp, which does not have that flaw.
 */
export const VERTEX_SHRINK_EXPONENT = 1;

export interface CpSizingScalesInput {
  /** The live camera zoom, in device px per SVG user unit. */
  camZoom: number;
  /** Zoom at which the whole document would fit the viewport, same units. */
  fitZoom: number;
  /** Device pixel ratio, i.e. device px per CSS px. */
  ratio: number;
}

export interface CpSizingScales {
  /** Growth multiplier shared by strokes, markers and dots. Always >= 1. */
  widthBoost: number;
  /** Device px per CSS px for diagnostic markers and cursor decorations. */
  markerScalePx: number;
  /** Device px per CSS px for crease points and vertices. */
  pointScalePx: number;
}

/**
 * Resolve the shared screen-size scales for one frame.
 *
 * `fitZoom` is derived from the document's bounding box, which is *not* a
 * trustworthy input: it is whatever the furthest-flung primitive says it is. So
 * every path out of here is bounded, and a non-finite or non-positive `fitZoom`
 * falls back to "at fit" rather than propagating NaN into the vertex buffers.
 */
export function cpSizingScales({ camZoom, fitZoom, ratio }: CpSizingScalesInput): CpSizingScales {
  const safeCamZoom = Number.isFinite(camZoom) && camZoom > 0 ? camZoom : 1;
  const safeFitZoom = Number.isFinite(fitZoom) && fitZoom > 0 ? fitZoom : safeCamZoom;
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;

  const zoomRatio = safeCamZoom / safeFitZoom;
  const widthBoost = Math.min(
    CP_MAX_WIDTH_BOOST,
    Math.pow(Math.max(zoomRatio, 1), WIDTH_ZOOM_EXPONENT)
  );
  const markerShrink = zoomRatio < 1 ? Math.pow(zoomRatio, MARKER_SHRINK_EXPONENT) : 1;
  const vertexShrink = zoomRatio < 1 ? Math.pow(zoomRatio, VERTEX_SHRINK_EXPONENT) : 1;

  return {
    widthBoost,
    markerScalePx: safeRatio * widthBoost * markerShrink,
    pointScalePx: safeRatio * widthBoost * vertexShrink,
  };
}
