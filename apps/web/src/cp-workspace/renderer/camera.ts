import type { ModelPoint, ViewTransform } from './types';

/**
 * Build a {@link ViewTransform} from three sampled reference points: the device
 * positions of model coordinates (0,0), (1,0), and (0,1). Because a model→device
 * mapping composed of translate/scale/flip/rotation is affine, three points fully
 * determine it.
 */
export function viewTransformFromSamples(
  originSample: ModelPoint,
  unitXSample: ModelPoint,
  unitYSample: ModelPoint
): ViewTransform {
  return {
    origin: [originSample.x, originSample.y],
    ex: [unitXSample.x - originSample.x, unitXSample.y - originSample.y],
    ey: [unitYSample.x - originSample.x, unitYSample.y - originSample.y],
  };
}

/** Apply a {@link ViewTransform} to a model point, yielding device pixels. */
export function projectModelPoint(view: ViewTransform, x: number, y: number): ModelPoint {
  return {
    x: view.origin[0] + x * view.ex[0] + y * view.ey[0],
    y: view.origin[1] + x * view.ex[1] + y * view.ey[1],
  };
}

/**
 * Uniform scale magnitude (device px per model unit) implied by the transform.
 * For a rotation/flip-free transform this is just |ex|; the geometric mean of the
 * two basis lengths keeps it sensible under mild anisotropy.
 */
export function viewTransformScale(view: ViewTransform): number {
  const sx = Math.hypot(view.ex[0], view.ex[1]);
  const sy = Math.hypot(view.ey[0], view.ey[1]);
  return Math.sqrt(sx * sy);
}

/** Whether two transforms are equal within a small epsilon (skip redundant redraws). */
export function viewTransformsEqual(a: ViewTransform, b: ViewTransform, epsilon = 1e-4): boolean {
  return (
    Math.abs(a.origin[0] - b.origin[0]) < epsilon &&
    Math.abs(a.origin[1] - b.origin[1]) < epsilon &&
    Math.abs(a.ex[0] - b.ex[0]) < epsilon &&
    Math.abs(a.ex[1] - b.ex[1]) < epsilon &&
    Math.abs(a.ey[0] - b.ey[0]) < epsilon &&
    Math.abs(a.ey[1] - b.ey[1]) < epsilon
  );
}
