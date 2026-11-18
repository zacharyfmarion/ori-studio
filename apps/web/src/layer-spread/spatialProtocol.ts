import type {
  SpatialSpreadInput,
  SpatialSpreadSolution,
} from '../cp-workspace/folded/folded3dMaterial';

export function validSpatialSolution(
  s: SpatialSpreadSolution,
  input: SpatialSpreadInput
): boolean {
  return (
    !!s &&
    s.version === 'spatial-vector-v1' &&
    Array.isArray(s.displacements) &&
    s.displacements.length === input.positions.length &&
    s.displacements.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 3 &&
        p.every((v) => Number.isFinite(v) && Math.abs(v) <= 0.220003)
    ) &&
    Number.isFinite(s.mean_gap) &&
    Number.isFinite(s.max_order_violation) &&
    Number.isFinite(s.constraint_residual) &&
    s.constraint_residual >= 0 &&
    s.constraint_residual <= 2e-6 &&
    ['Solved', 'AlmostSolved', 'no-stacks'].includes(s.status)
  );
}
