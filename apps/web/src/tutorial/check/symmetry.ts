/**
 * The square's eight symmetries, for lessons where orientation is not the point.
 *
 * "Draw the diagonal" has two correct answers; "fold the paper in half" has
 * four. Rather than author every variant as its own target, a check can opt into
 * symmetry and the comparison accepts whichever orientation the user drew.
 *
 * The paper is centred on the origin, so each symmetry is a plain linear map —
 * no translation is involved.
 */
import type { CanonicalCrease } from './canonicalize';

/** The dihedral group of order 8, as [xx, xy, yx, yy] matrices. */
const SQUARE_SYMMETRIES: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 0, 0, 1], // identity
  [0, -1, 1, 0], // rotate 90°
  [-1, 0, 0, -1], // rotate 180°
  [0, 1, -1, 0], // rotate 270°
  [-1, 0, 0, 1], // reflect in the vertical axis
  [1, 0, 0, -1], // reflect in the horizontal axis
  [0, 1, 1, 0], // reflect in the leading diagonal
  [0, -1, -1, 0], // reflect in the anti-diagonal
];

function transform(
  crease: CanonicalCrease,
  [xx, xy, yx, yy]: readonly [number, number, number, number]
): CanonicalCrease {
  // -0 would key differently from 0 despite being the same point.
  const ax = xx * crease.ax + xy * crease.ay + 0;
  const ay = yx * crease.ax + yy * crease.ay + 0;
  const bx = xx * crease.bx + xy * crease.by + 0;
  const by = yx * crease.bx + yy * crease.by + 0;

  // Re-apply the canonical endpoint order: a rotation can swap which endpoint
  // sorts first, and identity must not depend on that.
  const forwardFirst = ax < bx || (ax === bx && ay <= by);
  const [lowX, lowY, highX, highY] = forwardFirst ? [ax, ay, bx, by] : [bx, by, ax, ay];

  const geometryKey = `${lowX},${lowY}|${highX},${highY}`;
  return {
    assignment: crease.assignment,
    ax: lowX,
    ay: lowY,
    bx: highX,
    by: highY,
    key: `${crease.assignment}|${geometryKey}`,
    geometryKey,
  };
}

/**
 * All eight orientations of a canonical pattern. The identity comes first, so a
 * caller that stops at the first exact match reports the un-transformed target
 * whenever the user drew it as shown.
 */
export function squareSymmetries(creases: CanonicalCrease[]): CanonicalCrease[][] {
  return SQUARE_SYMMETRIES.map((matrix) => creases.map((crease) => transform(crease, matrix)));
}
