// The one flat-lighting formula every renderer shades paper with.
//
// It used to live three times — in the face fragment shader, in the SVG
// exporter and in the app's canvas-2D fallback — and three copies of five
// constants is three chances for the export to stop matching the screen. The
// GLSL builder injects the numbers from here and the two CPU paths call
// `shadeFor`, so a change to the band is a change everywhere at once.

/** Base brightness of a face lit edge-on: what is left with no diffuse term. */
export const SHADE_AMBIENT = 0.74;
/** How much a face facing the light gains on top of the ambient. */
export const SHADE_DIFFUSE = 0.3;
/**
 * A small lift for faces turned toward the eye, independent of the light, so a
 * sheet seen flat-on reads a shade lighter than one seen obliquely.
 */
export const SHADE_FACING = 0.04;
/** The darkest a face can be shaded, so the back of a fold never goes black. */
export const SHADE_MIN = 0.68;
/** The lightest, a touch over 1 so a face square to the light lifts, not just holds. */
export const SHADE_MAX = 1.08;

export type Vec3Like = readonly [number, number, number];

/**
 * Shade factor for a face with this geometric normal, lit from `lightDir`, both
 * in view space (x right, y up, z toward the eye).
 *
 * The normal is oriented toward the viewer first, so a face is shaded the same
 * whichever side of it is showing — the two-tone paper colour is what tells the
 * sides apart, not the light. Neither vector need be unit length; a degenerate
 * normal (a sliver triangle) shades 1, which is "unlit", the same answer the
 * SVG path has always given it.
 */
export function shadeFor(normal: Vec3Like, lightDir: Vec3Like): number {
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  if (length < 0.0001) return 1;
  let nx = normal[0] / length;
  let ny = normal[1] / length;
  let nz = normal[2] / length;
  if (nz < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const [lx, ly, lz] = lightDir;
  const lightLength = Math.hypot(lx, ly, lz) || 1;
  const diffuse = Math.max(0, (nx * lx + ny * ly + nz * lz) / lightLength);
  return Math.min(
    SHADE_MAX,
    Math.max(SHADE_MIN, SHADE_AMBIENT + diffuse * SHADE_DIFFUSE + nz * SHADE_FACING)
  );
}

/**
 * Apply a shade factor to a 0..1 colour — the shader's `base * shade`, clamped
 * per channel the way the framebuffer clamps it.
 */
export function shadeColor(color: Vec3Like, shade: number): [number, number, number] {
  return [clampUnit(color[0] * shade), clampUnit(color[1] * shade), clampUnit(color[2] * shade)];
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** A number as a GLSL float literal: `1` must read `1.0` or the compiler sees an int. */
function glslFloat(value: number): string {
  const text = String(value);
  return /[.eE]/.test(text) ? text : `${text}.0`;
}

/**
 * `shadeFor` as GLSL, for the face fragment shader to paste in. The constants
 * are the ones above, printed at build time, so the shader and {@link shadeFor}
 * cannot disagree about the band.
 */
export const SHADE_GLSL = `
float shadeFor(vec3 normal, vec3 lightDir){
  vec3 n = normal.z < 0.0 ? -normal : normal;
  float diffuse = max(0.0, dot(n, normalize(lightDir)));
  return clamp(${glslFloat(SHADE_AMBIENT)} + diffuse*${glslFloat(SHADE_DIFFUSE)} + n.z*${glslFloat(SHADE_FACING)}, ${glslFloat(SHADE_MIN)}, ${glslFloat(SHADE_MAX)});
}
`;
