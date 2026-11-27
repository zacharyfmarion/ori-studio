import { NEWER, hasNewerKey, isRecord } from '../../lib/documentFile';
import type { SpatialSpread } from './foldedFigureSpread';

/** Stored amounts multiply the unit displacement field, independently of the
 * slider's 0–100% range. Raising the maximum leaves saved geometry unchanged. */
export const MAX_SPATIAL_SPREAD_AMOUNT = 4;

/** The amount Spread layers turns a 3D figure's spread on at, and its Amount's reset: 25%. */
export const DEFAULT_SPATIAL_SPREAD_AMOUNT = 1;
export const DEFAULT_SPATIAL_SPREAD: SpatialSpread = { kind: 'spatial', version: 2, amount: DEFAULT_SPATIAL_SPREAD_AMOUNT };

/** The stored amount is always in slider units. Only a v2 picture applies the mesh gain. */
export function spatialDrawAmount(spread: SpatialSpread | null | undefined, gain = 1): number {
  return spread ? spread.amount * (spread.version === 2 ? gain : 1) : 0;
}

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
    (value.version !== 1 && value.version !== 2)
  )
    return NEWER;
  if (
    typeof value.amount !== 'number' ||
    !Number.isFinite(value.amount) ||
    value.amount < 0
  )
    return null;
  if (value.amount > MAX_SPATIAL_SPREAD_AMOUNT) return NEWER;
  return { kind: 'spatial', version: value.version, amount: value.amount };
}
