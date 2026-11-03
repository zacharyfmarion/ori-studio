import { NEWER, hasNewerKey, isRecord } from '../../lib/documentFile';
import type { SpatialSpread } from './foldedFigureSpread';

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
  if (value.amount > 2) return NEWER;
  return { kind: 'spatial', version: 1, amount: value.amount };
}
