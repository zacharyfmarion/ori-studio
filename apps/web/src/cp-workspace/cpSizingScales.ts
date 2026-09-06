/**
 * Screen-size scaling for creases, diagnostic markers and vertex dots.
 *
 * All three are ~constant *screen* size, modulated by how far the camera sits
 * from the "whole document fits" zoom. Pulled out of the canvas so the law is
 * unit-testable: it is the one place a bad document coordinate can reach every
 * drawn primitive at once, which is exactly what happened (see
 * {@link CP_MAX_WIDTH_BOOST}).
 */
import { VERTEX_RADIUS_FACTOR } from './adapters/cpPointsToScene';

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

// ---------------------------------------------------------------------------
// Vertex crowding
// ---------------------------------------------------------------------------
//
// Shared by both CP surfaces on purpose. The References view is where picking a
// vertex *is* the interaction, so a pattern that reads as a field of dots there
// is worse than in Edit — and the ramp is only trustworthy if the two surfaces
// cannot drift apart on its constants.

/**
 * Crease point/vertex visibility, in units of *crowding*: a dot's diameter as a
 * fraction of the on-screen distance between neighbouring vertices. 0.1 means
 * dots take up a tenth of the gap between them; 1.0 means they touch and the
 * pattern reads as a field of dots rather than as creases.
 *
 * Vertices are an up-close editing affordance (snap and hit targets). Surveying
 * a dense pattern, they are noise over the creases they annotate, so they fade
 * out entirely rather than shrinking forever.
 *
 * Crowding is a ratio of two CSS-px lengths, which is what makes it behave the
 * same everywhere: on any display density, at any `Point size`, at any document
 * coordinate scale. An earlier version keyed this to `cam.zoom / fitZoom`, which
 * measures zoom against the bounding box of the *whole document* — on a sheet
 * holding several patterns spread over thousands of units that reads as "zoomed
 * way in" while you look at one small pattern, and every fade stayed off.
 */
export const VERTEX_CROWD_FULL_AT = 0.15;
export const VERTEX_CROWD_GONE_AT = 0.45;
/**
 * Where the outline ring collapses into the fill, same units. It goes first: a
 * ring reads as a target, and a plain dot is quieter at the same size.
 */
export const VERTEX_RING_FULL_AT = 0.12;
export const VERTEX_RING_GONE_AT = 0.3;

/** Creases sampled when estimating vertex spacing. See {@link cpVertexSpacingModel}. */
export const VERTEX_SPACING_SAMPLE_CAP = 2048;

/** Hermite ramp between two edges, clamped — the GLSL `smoothstep`. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Median crease length in model units — the stand-in for "how far apart are
 * neighbouring vertices".
 *
 * Exhaustive on a 10k-crease pattern this is a sort per edit, so it is a strided
 * sample bounded to a fixed ~0.1 ms. Not an approximation worth worrying about:
 * on a real 7.4k-edge pattern even a 512-sample stride reproduces the exhaustive
 * median exactly. `fallback` is what an all-degenerate pattern gets (the editor
 * passes its grid width).
 */
export function cpVertexSpacingModel(
  lengthAt: (index: number) => number,
  count: number,
  fallback = 0
): number {
  if (count <= 0) return fallback;
  const stride = Math.max(1, Math.ceil(count / VERTEX_SPACING_SAMPLE_CAP));
  const lengths: number[] = [];
  for (let i = 0; i < count; i += stride) {
    const length = lengthAt(i);
    if (length > 1e-9) lengths.push(length);
  }
  if (lengths.length === 0) return fallback;
  lengths.sort((a, b) => a - b);
  return lengths[lengths.length >> 1];
}

export interface CpVertexCrowdingInput {
  /** Median crease length, model units ({@link cpVertexSpacingModel}). */
  vertexSpacingModel: number;
  /** The `--cp-point-size` setting. */
  pointSize: number;
  /** Length of the model→device basis vector, i.e. device px per model unit. */
  modelPxPerUnit: number;
  /** Device pixel ratio, i.e. device px per CSS px. */
  ratio: number;
}

export interface CpVertexCrowding {
  /** Dot diameter over vertex spacing, both CSS px. */
  crowding: number;
  /** Whole-layer opacity for the crease-point/vertex channel. */
  pointOpacity: number;
  /** Multiplier on the vertex dot's outline width. */
  pointRingScale: number;
}

/**
 * The vertex fade for one frame. Both terms are CSS px, so `crowding` is a pure
 * ratio: independent of display density, of the document's coordinate scale, and
 * of how far apart several patterns happen to sit on one sheet.
 */
export function cpVertexCrowding({
  vertexSpacingModel,
  pointSize,
  modelPxPerUnit,
  ratio,
}: CpVertexCrowdingInput): CpVertexCrowding {
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const vertexDiameterCss = 2 * VERTEX_RADIUS_FACTOR * pointSize;
  const spacingCss = (vertexSpacingModel * modelPxPerUnit) / safeRatio;
  const crowding = Number.isFinite(spacingCss) && spacingCss > 1e-6 ? vertexDiameterCss / spacingCss : 0;
  return {
    crowding,
    pointOpacity: 1 - smoothstep(VERTEX_CROWD_FULL_AT, VERTEX_CROWD_GONE_AT, crowding),
    pointRingScale: 1 - smoothstep(VERTEX_RING_FULL_AT, VERTEX_RING_GONE_AT, crowding),
  };
}
