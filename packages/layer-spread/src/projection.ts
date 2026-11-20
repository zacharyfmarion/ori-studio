import type { ConnectedSpread, Point, Point3, SpreadInput, SpreadSolution, Triangle } from './types.js';

/** The amount past which the no-stretch shift stops growing. Its second-order
 * form overshoots once faces are steep, so it holds at the nominal opening. */
export const SHIFT_HOLD_AMOUNT = 1;

/** How much of the solved shift an amount shows. Heights scale with the
 * amount, so the shortening they cause scales with its square. */
export function shiftScale(amount: number): number {
  const held = Math.min(Math.max(amount, 0), SHIFT_HOLD_AMOUNT);
  return held * held;
}

/** Canonical XY with the paper kept its true size: lifted faces draw
 * shortened along their slope instead of stretched. No solve per amount. */
export function shiftedXY(input: SpreadInput, solution: SpreadSolution, amount: number, back: boolean): Point[] {
  const shift = solution.shifts?.[back ? 1 : 0];
  const scale = shiftScale(amount);
  if (!shift || shift.length !== 2 * input.xy.length || scale === 0) return input.xy;
  return input.xy.map(([x, y], v) => [x + scale * shift[2 * v], y + scale * shift[2 * v + 1]]);
}

/** The accepted visible-surface shear. The reference is fixed for the entire gesture. */
export function diagramPositions(
  input: SpreadInput,
  solution: SpreadSolution,
  spread: ConnectedSpread,
  back: boolean,
): Point3[] {
  const [a, b, c] = solution.references[back ? 1 : 0].plane;
  const sign = back ? -1 : 1;
  const [dx, dy] = spread.reveal;
  const xy = shiftedXY(input, solution, spread.amount, back);
  return input.xy.map(([x, y], v) => {
    const z = solution.heights[v];
    // Height is measured where the vertex lay flat; only its drawn place shifts.
    const h = spread.amount * (z - a * x - b * y - c);
    return [xy[v][0] + dx * h, xy[v][1] - sign * dy * h, spread.amount * z];
  });
}

export function spatialPositions(input: SpreadInput, solution: SpreadSolution, amount: number, back = false): Point3[] {
  const xy = shiftedXY(input, solution, amount, back);
  return xy.map(([x, y], v) => [x, y, amount * solution.heights[v]]);
}

/** Barycentric interpolation is shared by rendering, annotations and first-pick mapping. */
export function barycentric(
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
  p: readonly number[],
): Point3 | null {
  const x = b[0] - a[0],
    y = b[1] - a[1],
    u = c[0] - a[0],
    v = c[1] - a[1];
  const determinant = x * v - y * u;
  if (Math.abs(determinant) < 1e-16) return null;
  const qx = p[0] - a[0],
    qy = p[1] - a[1];
  const wb = (qx * v - qy * u) / determinant,
    wc = (x * qy - y * qx) / determinant;
  return [1 - wb - wc, wb, wc];
}

export function interpolate(ids: Triangle, weights: Point3, positions: readonly Point3[]): Point3 {
  return [0, 1, 2].map((axis) => weights.reduce((s, w, k) => s + w * positions[ids[k]][axis], 0)) as Point3;
}

export function faceWeights(input: SpreadInput, face: number, point: Point): { ids: Triangle; weights: Point3 } | null {
  let best: { ids: Triangle; weights: Point3; minimum: number } | null = null;
  for (let t = 0; t < input.triangles.length; t++) {
    if (input.triangleFaces[t] !== face) continue;
    const ids = input.triangles[t];
    const weights = barycentric(...(ids.map((v) => input.xy[v]) as [Point, Point, Point]), point);
    if (!weights) continue;
    const minimum = Math.min(...weights);
    if (minimum >= -1e-8) return { ids, weights };
    if (!best || minimum > best.minimum) best = { ids, weights, minimum };
  }
  return best && best.minimum >= -2e-5 ? best : null;
}

/** Split material ink at render-triangle boundaries before deforming it. A
 * warped polygon has piecewise affine, not whole-polygon, interpolation. */
export function faceLineSegments(
  input: SpreadInput,
  face: number,
  a: Point,
  b: Point,
): Array<{ lo: number; hi: number; ids: Triangle; wa: Point3; wb: Point3 }> {
  const cuts = [0, 1],
    dx = b[0] - a[0],
    dy = b[1] - a[1];
  for (let t = 0; t < input.triangles.length; t++) {
    if (input.triangleFaces[t] !== face) continue;
    const ids = input.triangles[t];
    for (let i = 0; i < 3; i++) {
      const p = input.xy[ids[i]],
        q = input.xy[ids[(i + 1) % 3]],
        ex = q[0] - p[0],
        ey = q[1] - p[1];
      const det = dx * ey - dy * ex;
      if (Math.abs(det) < 1e-14) continue;
      const x = p[0] - a[0],
        y = p[1] - a[1],
        u = (x * ey - y * ex) / det,
        v = (x * dy - y * dx) / det;
      if (u > 1e-9 && u < 1 - 1e-9 && v >= -1e-9 && v <= 1 + 1e-9) cuts.push(u);
    }
  }
  cuts.sort((x, y) => x - y);
  const unique = cuts.filter((v, i) => i === 0 || v - cuts[i - 1] > 1e-9);
  const at = (t: number): Point => [a[0] + t * dx, a[1] + t * dy];
  return unique.slice(1).flatMap((hi, i) => {
    const lo = unique[i],
      sample = faceWeights(input, face, at((lo + hi) / 2));
    if (!sample) return [];
    const corners = sample.ids.map((v) => input.xy[v]) as [Point, Point, Point];
    const wa = barycentric(...corners, at(lo)),
      wb = barycentric(...corners, at(hi));
    return wa && wb ? [{ lo, hi, ids: sample.ids, wa, wb }] : [];
  });
}
