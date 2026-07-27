import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CP_MEASURE_PREFERENCES,
  readCpMeasurePreferences,
  writeCpMeasurePreferences,
} from './measurePreferences';
import { STORAGE_KEYS, storageKey, writeJson } from '../lib/storage';

const KEY = storageKey(STORAGE_KEYS.cpMeasure);

describe('cp measure preferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to the paper edge as 1', () => {
    expect(readCpMeasurePreferences()).toEqual(DEFAULT_CP_MEASURE_PREFERENCES);
    expect(DEFAULT_CP_MEASURE_PREFERENCES.unit).toBe('paper');
  });

  it('round-trips a chosen unit and paper size', () => {
    writeCpMeasurePreferences({ unit: 'mm', paperEdgeMm: 210 });
    expect(readCpMeasurePreferences()).toEqual({ unit: 'mm', paperEdgeMm: 210 });
  });

  it('falls back on a stale or hand-edited value rather than breaking the tool', () => {
    writeJson(KEY, { unit: 'furlongs', paperEdgeMm: -3 });
    expect(readCpMeasurePreferences()).toEqual(DEFAULT_CP_MEASURE_PREFERENCES);

    writeJson(KEY, { unit: 'grid' });
    expect(readCpMeasurePreferences()).toEqual({
      unit: 'grid',
      paperEdgeMm: DEFAULT_CP_MEASURE_PREFERENCES.paperEdgeMm,
    });
  });
});
