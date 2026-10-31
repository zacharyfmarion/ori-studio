import type { SpreadInput, SpreadSolution } from '@oristudio/layer-spread';

export type SpreadRequest = { generation: number; input: SpreadInput };
export type SpreadResponse =
  | { generation: number; kind: 'ready'; solution: SpreadSolution }
  | { generation: number; kind: 'unavailable'; message: string };

/** Reject corrupt/stale bridge output before any renderer can consume it. */
export function validSolution(value: SpreadSolution, input: SpreadInput): boolean {
  return (
    value.version === 'normalized-50-v1' &&
    value.heights.length === input.xy.length &&
    value.heights.every((z) => Number.isFinite(z) && Math.abs(z) <= 0.301) &&
    value.references.length === 2 &&
    value.references.every((r) => [...r.plane, ...r.center, r.rms].every(Number.isFinite)) &&
    value.diagnostics.max_relative_warp <= 0.051 &&
    value.diagnostics.max_slope <= 0.351
  );
}
