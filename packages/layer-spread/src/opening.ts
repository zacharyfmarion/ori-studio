import type { SpreadInput } from './types.js';

/**
 * How far a solved spread opens its layers, read once from a solution at
 * amount 1 (`implementation-plans/spread-equal-opening.md`). Both are slopes,
 * height over normalized XY, so a scale of the heights scales them alike.
 */
export interface SpreadOpening {
  /**
   * How fast neighbouring layers part: `|∇h_upper − ∇h_lower|` at each
   * overlap cell's centroid, for every pair next to each other in its stack,
   * averaged by the cell's area. Tilt a whole stack shares does not count.
   */
  opening: number;
  /** How steep the steepest paper is: the 99th percentile of `|∇h|` over triangles, by area. */
  steep: number;
}

/** The triangle of `face` holding `point`, or the nearest to holding it. */
function triangleAt(input: SpreadInput, triangles: readonly number[], point: readonly [number, number]): number {
  let best = triangles[0]!;
  let bestOutside = Infinity;
  for (const t of triangles) {
    const [i, j, k] = input.triangles[t]!;
    const a = input.xy[i]!, b = input.xy[j]!, c = input.xy[k]!;
    const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (det === 0) continue;
    const u = ((point[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (point[1] - a[1])) / det;
    const v = ((b[0] - a[0]) * (point[1] - a[1]) - (point[0] - a[0]) * (b[1] - a[1])) / det;
    const outside = Math.max(0, u + v - 1, -u, -v);
    if (outside < bestOutside) {
      bestOutside = outside;
      best = t;
      if (outside === 0) break;
    }
  }
  return best;
}

export function spreadOpening(input: SpreadInput, heights: readonly number[]): SpreadOpening {
  const gradients: [number, number][] = [];
  const slopes: [number, number][] = [];
  let paper = 0;
  for (const [i, j, k] of input.triangles) {
    const a = input.xy[i]!, b = input.xy[j]!, c = input.xy[k]!;
    const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    const hb = heights[j]! - heights[i]!, hc = heights[k]! - heights[i]!;
    const gradient: [number, number] =
      det === 0 ? [0, 0] : [(hb * (c[1] - a[1]) - hc * (b[1] - a[1])) / det, (hc * (b[0] - a[0]) - hb * (c[0] - a[0])) / det];
    gradients.push(gradient);
    const area = Math.abs(det) / 2;
    paper += area;
    slopes.push([Math.hypot(gradient[0], gradient[1]), area]);
  }
  const byFace: number[][] = input.faces.map(() => []);
  input.triangleFaces.forEach((face, t) => byFace[face]?.push(t));
  let parting = 0, weight = 0;
  for (const cell of input.cells) {
    if (cell.faces.length < 2 || !(cell.area > 0)) continue;
    const at = cell.faces.map((face) => (byFace[face]?.length ? gradients[triangleAt(input, byFace[face]!, cell.point)]! : null));
    for (let k = 0; k + 1 < at.length; k++) {
      const upper = at[k], lower = at[k + 1];
      if (!upper || !lower) continue;
      parting += cell.area * Math.hypot(upper[0] - lower[0], upper[1] - lower[1]);
      weight += cell.area;
    }
  }
  slopes.sort((p, q) => p[0] - q[0]);
  let steep = 0, covered = 0;
  for (const [slope, area] of slopes) {
    covered += area;
    steep = slope;
    if (covered >= 0.99 * paper) break;
  }
  return { opening: weight > 0 ? parting / weight : 0, steep };
}
