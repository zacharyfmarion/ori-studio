import { NEWER, hasNewerKey, isRecord } from '../../lib/documentFile';
import type { SpatialSpread } from './foldedFigureSpread';

/** Stored amounts multiply the unit displacement field, independently of the
 * slider's 0–100% range. Raising the maximum leaves saved geometry unchanged. */
export const MAX_SPATIAL_SPREAD_AMOUNT = 4;

export const clampSpatialSpreadAmount = (amount: number): number =>
  Math.max(0, Math.min(MAX_SPATIAL_SPREAD_AMOUNT, amount));

export const spatialSpreadPercent = (amount: number): number =>
  (amount / MAX_SPATIAL_SPREAD_AMOUNT) * 100;

export const spatialSpreadFromPercent = (percent: number): number =>
  (percent / 100) * MAX_SPATIAL_SPREAD_AMOUNT;

export function readSpatialSpread(
  value: unknown
): SpatialSpread | undefined | null | typeof NEWER {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  if (
    hasNewerKey(value, new Set(['kind', 'version', 'amount'])) ||
    value.kind !== 'spatial' ||
    value.version !== 1
  )
    return NEWER;
  if (
    typeof value.amount !== 'number' ||
    !Number.isFinite(value.amount) ||
    value.amount < 0
  )
    return null;
  if (value.amount > MAX_SPATIAL_SPREAD_AMOUNT) return NEWER;
  return { kind: 'spatial', version: 1, amount: value.amount };
}
