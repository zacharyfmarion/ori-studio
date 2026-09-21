/**
 * The falloff of a folded figure's layer shadow, defined once for every
 * renderer that draws one.
 *
 * The kernel says *what* casts onto *what* (`layer_shadow` paint: a receiving
 * region and its occluders' outline, each segment with the height of its
 * ledge in sheets); this says what that looks like: the contact shadow a
 * step of paper casts on the paper beside it under diffuse light.
 *
 * For a long straight ledge of height `h` under a uniform sky, the fraction
 * of the light a point on the lower sheet loses at distance `d` from the
 * contact line is
 *
 *     f(d) = (1 / 2π) ∫ cos²φ / (cos²φ + (d/h)²) dφ,   φ over a half turn
 *
 * — one half at the contact, about half of that by `d ≈ 0.55 h`, and a
 * `h² / 4d²` tail. Dark, narrow and sharp-edged, and as wide as the ledge is
 * tall: the thin dark line at the foot of every layer in a photograph. That
 * curve is drawn here as the sum of three Gaussian-blurred bands
 * ({@link SHADOW_BANDS}, fitted to within a few percent out to `2 h`),
 * because a blurred band is something both renderers can produce exactly: the
 * canvas evaluates it analytically from the distance to the outline (a box
 * convolved with a Gaussian is a pair of error functions), and the SVG export
 * strokes, dilates and blurs the outline literally. Along a straight edge the
 * two agree; at a corner the 2D blur is marginally lighter on a convex one
 * and darker on a concave one than the distance field is.
 *
 * Two departures from the physics, both deliberate. Real kami is a tenth of a
 * millimetre a sheet, which on a hand-sized model makes a one-sheet shadow
 * invisible; the kernel's sheet thickness is a few times that
 * (`SHADOW_SHEET_THICKNESS`). And a ledge whose core would be thinner than a
 * pixel or two is widened to that and lightened by the same factor
 * ({@link shadowLedgeBoost}), so a flap edge draws as a crisp faint line at
 * any zoom instead of flickering in and out between pixel centres.
 */

/**
 * The blurred bands whose weighted sum is the occlusion curve, in units of the
 * ledge height: each band's half-width, blur σ and weight. Weights are scaled
 * so the sum is 1 at the contact line.
 */
export const SHADOW_BANDS: readonly { halfWidth: number; sigma: number; weight: number }[] = [
  { halfWidth: 0.2, sigma: 0.15, weight: 0.3428 },
  { halfWidth: 0.6, sigma: 0.4, weight: 0.5134 },
  { halfWidth: 1.5, sigma: 1.2, weight: 0.3486 },
];

/**
 * Distance, in ledge heights, beyond which the shadow is treated as zero. The
 * widest band's edge plus three sigma: under 0.3% of the contact darkness.
 */
export const SHADOW_REACH_RATIO = 5;
/**
 * The most casting edges one shadow polygon is shaded against — the fragment
 * shader's loop bound. Subfaces are small next to a shadow's reach, so a
 * handful is typical; a polygon that somehow has more keeps the nearest.
 */
export const MAX_SHADOW_EDGES = 24;
/**
 * Ledges taller than this cast like this one. Stacks of twenty sheets happen
 * at the centre of a complex model; past a dozen the shadow would reach a
 * tenth of the way across the paper and bury the detail it sits beside.
 */
export const SHADOW_STEP_CAP = 12;
/**
 * The narrowest the innermost band's half-width is allowed to draw, in
 * pixels. Below it the ledge is widened to this and lightened by the same
 * factor, which keeps the shadow's total darkness while making it resolvable.
 */
export const SHADOW_MIN_CORE_PX = 1.5;
/** The most a ledge is widened for the pixel floor; past this it is faint anyway. */
export const SHADOW_MAX_BOOST = 8;

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

/** A band of `halfWidth` blurred by `sigma`, sampled at `distance` from its centre line. */
export function blurredBand(distance: number, halfWidth: number, sigma: number): number {
  const spread = sigma * Math.SQRT2;
  return 0.5 * (erf((halfWidth - distance) / spread) + erf((halfWidth + distance) / spread));
}

/** What the weighted bands sum to at the contact line, before normalisation. */
const CONTACT_SUM = SHADOW_BANDS.reduce(
  (sum, band) => sum + band.weight * blurredBand(0, band.halfWidth, band.sigma),
  0
);

/** The ledge height, in whatever units `sheetThickness` is in, of a ledge `step` sheets tall. */
export function shadowLedgeHeight(step: number, sheetThickness: number): number {
  return sheetThickness * Math.min(Math.max(step, 1), SHADOW_STEP_CAP);
}

/**
 * How much to widen a ledge of `heightPx` pixels so its innermost band is at
 * least {@link SHADOW_MIN_CORE_PX} wide; the shadow is lightened by the same
 * factor. 1 for any ledge already wide enough.
 */
export function shadowLedgeBoost(heightPx: number): number {
  if (!(heightPx > 0)) return SHADOW_MAX_BOOST;
  return Math.min(
    SHADOW_MAX_BOOST,
    Math.max(1, SHADOW_MIN_CORE_PX / (SHADOW_BANDS[0].halfWidth * heightPx))
  );
}

/**
 * Darkness at `distance` from the nearest casting edge as a fraction of the
 * darkness at the contact line, for a ledge `height` tall (same units).
 */
export function shadowProfile(distance: number, height: number): number {
  if (!(height > 0)) return 0;
  const d = Math.abs(distance);
  let sum = 0;
  for (const band of SHADOW_BANDS) {
    sum += band.weight * blurredBand(d, band.halfWidth * height, band.sigma * height);
  }
  return sum / CONTACT_SUM;
}

/** A number as a GLSL float literal: `1` must read `1.0`. */
const glslFloat = (value: number) => {
  const text = String(value);
  return text.includes('.') || text.includes('e') ? text : `${text}.0`;
};

/**
 * The same curve and rules, for the fragment shader. Declares `erf`,
 * `shadowBand`, `shadowProfile(float distance, float height)`,
 * `shadowLedgeHeight(float ledge, float sheetThickness)` and
 * `shadowLedgeBoost(float heightPx)`.
 */
export const SHADOW_PROFILE_GLSL = `
float erf(float x) {
  float ax = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * ax);
  float poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign(x) * (1.0 - poly * exp(-ax * ax));
}
float shadowBand(float distance, float halfWidth, float sigma) {
  float spread = sigma * 1.4142135623730951;
  return 0.5 * (erf((halfWidth - distance) / spread) + erf((halfWidth + distance) / spread));
}
float shadowProfile(float distance, float height) {
  float d = abs(distance);
  return (${SHADOW_BANDS.map(
    (band) =>
      `${glslFloat(band.weight)} * shadowBand(d, ${glslFloat(band.halfWidth)} * height, ${glslFloat(band.sigma)} * height)`
  ).join(' + ')}) * ${glslFloat(1 / CONTACT_SUM)};
}
float shadowLedgeHeight(float ledge, float sheetThickness) {
  return sheetThickness * clamp(ledge, 1.0, ${glslFloat(SHADOW_STEP_CAP)});
}
float shadowLedgeBoost(float heightPx) {
  if (heightPx <= 0.0) return ${glslFloat(SHADOW_MAX_BOOST)};
  return clamp(${glslFloat(SHADOW_MIN_CORE_PX)} / (${glslFloat(SHADOW_BANDS[0].halfWidth)} * heightPx), 1.0, ${glslFloat(SHADOW_MAX_BOOST)});
}
`;

/** One band of the SVG construction — see {@link shadowSvgBands}. */
export interface ShadowSvgBand {
  /** How far to dilate the source stroke to reach this band's half-width; 0 for the innermost. */
  dilateRadius: number;
  /** The Gaussian blur's standard deviation. */
  stdDeviation: number;
  /** This band's share of the sum, already normalised to a contact value of 1. */
  weight: number;
}

/**
 * How to draw the shadow of a ledge `height` tall in SVG: stroke the casting
 * outline `strokeWidth` wide with round caps and joins, then in a filter take
 * that stroke's alpha, dilate and blur it once per band, sum the bands with
 * the given weights (`feComposite operator="arithmetic"`) and fill the result
 * black at `opacity`. Units are whatever `height` is in, which is also taken
 * as pixels for the widening floor — the export raster is drawn at page
 * units, so they are the same.
 */
export function shadowSvgBands(
  height: number,
  strength: number
): { strokeWidth: number; opacity: number; bands: ShadowSvgBand[] } {
  const boost = shadowLedgeBoost(height);
  const h = height * boost;
  const core = SHADOW_BANDS[0];
  return {
    strokeWidth: 2 * core.halfWidth * h,
    opacity: Math.min(1, strength / boost),
    bands: SHADOW_BANDS.map((band) => ({
      dilateRadius: (band.halfWidth - core.halfWidth) * h,
      stdDeviation: band.sigma * h,
      weight: band.weight / CONTACT_SUM,
    })),
  };
}
