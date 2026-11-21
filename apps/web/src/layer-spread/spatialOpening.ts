import type { Point3 } from '@oristudio/layer-spread';
import type { SpatialSpreadInput, SpatialSpreadSolution } from '../cp-workspace/folded/folded3dMaterial';
import { MAX_SPATIAL_SPREAD_AMOUNT } from '../cp-workspace/folded/spatialSpreadSettings';

// Spatial recipe v2. Distances are fractions of a paper length (sqrt of material area).
// The five calibration models have a median full-slider gap of 0.01638.
const FULL_GAP = 0.016;
const gains = new WeakMap<SpatialSpreadSolution, number>();

function difference(a: Point3, b: Point3): Point3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function measuredGain({ positions, triangles }: SpatialSpreadInput, solution: SpatialSpreadSolution): number {
  if (!(solution.mean_gap > 0)) return 1;
  let area = 0;
  const strains: { area: number; strain: number }[] = [];
  for (const triangle of triangles) {
    const [a, b, c] = triangle;
    const [x, y, z] = difference(positions[b]!, positions[a]!);
    const [u, v, w] = difference(positions[c]!, positions[a]!);
    const weight = Math.hypot(y * w - z * v, z * u - x * w, x * v - y * u) / 2;
    if (weight <= 0) continue;
    let strain = 0;
    for (let k = 0; k < 3; k++) {
      const i = triangle[k]!;
      const j = triangle[(k + 1) % 3]!;
      const length = Math.hypot(...difference(positions[i]!, positions[j]!));
      const shift = Math.hypot(...difference(solution.displacements[i]!, solution.displacements[j]!));
      strain = Math.max(strain, shift / length);
    }
    strains.push({ area: weight, strain });
    area += weight;
  }
  const length = Math.sqrt(area);
  if (!(length > 0) || !(solution.mean_gap / length > 1e-9)) return 1;
  let maxTravel = 0;
  for (const delta of solution.displacements) maxTravel = Math.max(maxTravel, Math.hypot(...delta));
  let covered = 0;
  let steep = 0;
  for (const face of strains.sort((a, b) => a.strain - b.strain)) {
    steep = face.strain;
    covered += face.area;
    if (covered >= area * 0.99) break;
  }
  const full = MAX_SPATIAL_SPREAD_AMOUNT;
  // A field already at a limit can be reduced but never amplified by it.
  const limit = (ceiling: number, measured: number) =>
    measured > 0 ? Math.max(1, ceiling / (full * measured)) : Infinity;
  return Math.min(
    FULL_GAP * length / (full * solution.mean_gap),
    8,
    limit(0.5, maxTravel / length),
    limit(1, steep),
    limit(0.005, solution.max_order_violation / length),
  );
}

/** Measure the admitted unit displacement field once, independently of camera and slider. */
export function spatialOpeningGain(input: SpatialSpreadInput, solution: SpatialSpreadSolution): number {
  const cached = gains.get(solution);
  if (cached !== undefined) return cached;
  const gain = measuredGain(input, solution);
  gains.set(solution, gain);
  return gain;
}
