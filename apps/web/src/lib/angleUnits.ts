/**
 * Degrees for the rows, radians for the model. The rows read and write
 * degrees in (−180, 180]; the document stores radians and never wraps.
 */
export const RADIANS_PER_DEGREE = Math.PI / 180;

/** Degrees into (−180, 180], the way a rotation field is read. */
export function wrapDegrees(degrees: number): number {
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/** Radians to wrapped degrees, rounded to two decimals so a field never reads `29.999999`. */
export function radiansToDegrees(radians: number): number {
  return wrapDegrees(Math.round((radians / RADIANS_PER_DEGREE) * 100) / 100);
}

export function degreesToRadians(degrees: number): number {
  return wrapDegrees(degrees) * RADIANS_PER_DEGREE;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
