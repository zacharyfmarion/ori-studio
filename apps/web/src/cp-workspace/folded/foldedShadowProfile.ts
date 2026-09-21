/**
 * The falloff of a folded figure's layer shadow, defined once for every
 * renderer that draws one.
 *
 * The kernel says *what* casts onto *what* (`layer_shadow` paint: a receiving
 * region and its occluders' outline); this says what that looks like. The
 * shadow is a band of half-width {@link SHADOW_BAND_HALF_WIDTH_RATIO} `· width`
 * along the outline, blurred by a Gaussian of {@link SHADOW_BLUR_SIGMA_RATIO}
 * `· width`. It is stated that way, rather than as a curve, because it is
 * something an SVG can draw literally — a round-capped stroke under
 * `feGaussianBlur` — while the canvas evaluates the same curve analytically
 * from the distance to the outline: a box convolved with a Gaussian is a pair
 * of error functions. Along a straight edge the two agree exactly; at a corner
 * a 2D blur is marginally lighter on a convex one and darker on a concave one
 * than the distance field is.
 *
 * `strength` on the paint is the darkness *at* the casting edge, so the curve
 * is normalised to 1 there; the SVG stroke gets the matching opacity from
 * {@link shadowSvgStroke}.
 *
 * The paint's `width` is the reach of a ledge one sheet tall. A taller ledge —
 * the side of a stack, `step` sheets above the paper it casts on — reaches
 * further ({@link shadowStepReach}) and reads a little darker
 * ({@link shadowStepStrength}); that is what makes a flap edge and the edge of
 * an eight-layer stack look different, which is most of the depth cue a real
 * model gives. Both scalings live here and in {@link SHADOW_PROFILE_GLSL} so
 * the canvas and the export agree.
 */

/** Half-width of the unblurred band, as a fraction of the shadow's reach. */
export const SHADOW_BAND_HALF_WIDTH_RATIO = 0.4;
/** Standard deviation of the blur, as a fraction of the shadow's reach. */
export const SHADOW_BLUR_SIGMA_RATIO = 0.3;
/**
 * Distance, as a fraction of the reach, beyond which the shadow is treated as
 * zero. The curve there is under 0.3% of the edge darkness, so a subface that
 * keeps no outline edge within this margin draws no shadow at all.
 */
export const SHADOW_REACH_RATIO = 1.25;
/**
 * The most casting edges one shadow polygon is shaded against — the fragment
 * shader's loop bound. Subfaces are small next to a shadow's reach, so a
 * handful is typical; a polygon that somehow has more keeps the nearest.
 */
export const MAX_SHADOW_EDGES = 24;
/**
 * Ledge heights above this cast like this one. A real stack's shadow does
 * keep widening with height, but past a handful of sheets the paper's own
 * bulk, not the shadow, is what reads as thick — and a shadow reaching a
 * tenth of the way across the model swallows the detail it sits on.
 */
export const SHADOW_STEP_CAP = 4;
/** Exponent of the reach's growth with ledge height; 1 would be physical. */
export const SHADOW_STEP_REACH_POWER = 0.5;
/** Extra darkness per sheet of ledge height beyond the first. */
export const SHADOW_STEP_STRENGTH_GAIN = 0.05;

/**
 * How many times a one-sheet ledge's reach a ledge `step` sheets tall casts.
 *
 * Sub-linear on purpose: the physical contact shadow of a step grows about
 * linearly with its height, but stacks of eight and twelve sheets are ordinary
 * in a folded model and a linear reach on those buries everything nearby.
 */
export function shadowStepReach(step: number): number {
  return Math.min(Math.max(step, 1), SHADOW_STEP_CAP) ** SHADOW_STEP_REACH_POWER;
}

/** How many times the paint's edge darkness a ledge `step` sheets tall reads. */
export function shadowStepStrength(step: number): number {
  return 1 + SHADOW_STEP_STRENGTH_GAIN * (Math.min(Math.max(step, 1), SHADOW_STEP_CAP) - 1);
}

/**
 * Error function, Abramowitz & Stegun 7.1.26 — |error| ≤ 1.5e-7, which is
 * far below what an 8-bit alpha can show, and cheap enough to run per pixel.
 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
    t;
  return sign * (1 - poly * Math.exp(-ax * ax));
}

/** The blurred band's value at `distance` before normalisation; 1 deep inside it. */
function blurredBand(distance: number, width: number): number {
  const half = SHADOW_BAND_HALF_WIDTH_RATIO * width;
  const spread = SHADOW_BLUR_SIGMA_RATIO * width * Math.SQRT2;
  return 0.5 * (erf((half - distance) / spread) + erf((half + distance) / spread));
}

/**
 * Darkness at `distance` from the nearest casting edge as a fraction of the
 * darkness at the edge, for a shadow that reaches `width`.
 */
export function shadowProfile(distance: number, width: number): number {
  if (!(width > 0)) return 0;
  return blurredBand(Math.abs(distance), width) / blurredBand(0, width);
}

/**
 * The same curve and scalings, for the fragment shader. Declares `erf`,
 * `shadowProfile(float distance, float width)`, `shadowStepReach(float step)`
 * and `shadowStepStrength(float step)`.
 */
export const SHADOW_PROFILE_GLSL = `
float shadowStepReach(float ledge) {
  return pow(clamp(ledge, 1.0, ${SHADOW_STEP_CAP}.0), ${SHADOW_STEP_REACH_POWER});
}
float shadowStepStrength(float ledge) {
  return 1.0 + ${SHADOW_STEP_STRENGTH_GAIN} * (clamp(ledge, 1.0, ${SHADOW_STEP_CAP}.0) - 1.0);
}
float erf(float x) {
  float ax = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * ax);
  float poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign(x) * (1.0 - poly * exp(-ax * ax));
}
float blurredBand(float distance, float width) {
  // Not 'half': that is a reserved word in GLSL ES 1.00.
  float halfWidth = ${SHADOW_BAND_HALF_WIDTH_RATIO} * width;
  float spread = ${SHADOW_BLUR_SIGMA_RATIO} * width * 1.4142135623730951;
  return 0.5 * (erf((halfWidth - distance) / spread) + erf((halfWidth + distance) / spread));
}
float shadowProfile(float distance, float width) {
  return blurredBand(abs(distance), width) / blurredBand(0.0, width);
}
`;

/**
 * How to draw the shadow of a `layer_shadow` paint in SVG: stroke the casting
 * outline this wide and this opaque, with round caps and joins, under a
 * Gaussian blur of `stdDeviation`. Units are whatever `width` is in.
 */
export function shadowSvgStroke(
  width: number,
  strength: number
): { strokeWidth: number; stdDeviation: number; opacity: number } {
  return {
    strokeWidth: 2 * SHADOW_BAND_HALF_WIDTH_RATIO * width,
    stdDeviation: SHADOW_BLUR_SIGMA_RATIO * width,
    // The blurred stroke is `blurredBand` before normalisation, so it reaches
    // the paint's darkness at the edge only when scaled by the same factor the
    // curve is.
    opacity: Math.min(1, strength / blurredBand(0, width)),
  };
}
