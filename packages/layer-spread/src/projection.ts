import type { ConnectedSpread, Point, Point3, SpreadInput, SpreadSolution, Triangle } from './types.js';

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
  return input.xy.map(([x, y], v) => {
    const z = solution.heights[v];
    const h = spread.amount * (z - a * x - b * y - c);
    return [x + dx * h, y - sign * dy * h, spread.amount * z];
  });
}

export function spatialPositions(input: SpreadInput, solution: SpreadSolution, amount: number): Point3[] {
  return input.xy.map(([x, y], v) => [x, y, amount * solution.heights[v]]);
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
