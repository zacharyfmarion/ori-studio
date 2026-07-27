import { STORAGE_KEYS, readJson, storageKey, writeJson } from '../lib/storage';
import {
  CP_MEASURE_UNITS,
  DEFAULT_CP_MEASURE_PAPER_EDGE_MM,
  type CpMeasureUnit,
} from './measure';

/**
 * The measure tool's persisted display preferences — which unit measurements read
 * in, and (for the physical units) how big the paper actually is. Persisted rather
 * than per-document: a designer works in the units they think in, not the units the
 * file was authored in.
 *
 * Measurements themselves are never persisted; see
 * implementation-plans/measure-system-redesign.md.
 */
export interface CpMeasurePreferences {
  unit: CpMeasureUnit;
  paperEdgeMm: number;
}

export const DEFAULT_CP_MEASURE_PREFERENCES: CpMeasurePreferences = {
  unit: 'paper',
  paperEdgeMm: DEFAULT_CP_MEASURE_PAPER_EDGE_MM,
};

const KEY = storageKey(STORAGE_KEYS.cpMeasure);

/** Clamp a stored blob onto the current shape, so a hand-edited or stale value can't break the tool. */
function normalize(value: Partial<CpMeasurePreferences> | null): CpMeasurePreferences {
  const unit = value?.unit;
  const paperEdgeMm = value?.paperEdgeMm;
  return {
    unit: unit && CP_MEASURE_UNITS.includes(unit) ? unit : DEFAULT_CP_MEASURE_PREFERENCES.unit,
    paperEdgeMm:
      typeof paperEdgeMm === 'number' && Number.isFinite(paperEdgeMm) && paperEdgeMm > 0
        ? paperEdgeMm
        : DEFAULT_CP_MEASURE_PREFERENCES.paperEdgeMm,
  };
}

export function readCpMeasurePreferences(): CpMeasurePreferences {
  return normalize(readJson<Partial<CpMeasurePreferences> | null>(KEY, null));
}

export function writeCpMeasurePreferences(preferences: CpMeasurePreferences): void {
  writeJson(KEY, normalize(preferences));
}
