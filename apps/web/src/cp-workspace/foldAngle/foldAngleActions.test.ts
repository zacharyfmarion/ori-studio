import { describe, expect, it } from 'vitest';
import {
  FOLD_ANGLE_PRESETS,
  describeAffected,
  presetMagnitude,
  summariseFoldAngles,
} from './foldAngleActions';
import { FOLD_MAGNITUDE_UNITS_PER_DEGREE } from '../../lib/foldAngle';

describe('fold angle presets', () => {
  it('normalises the 180 preset to classic', () => {
    const classic = FOLD_ANGLE_PRESETS.find((preset) => preset.id === 'classic');
    expect(classic).toBeDefined();
    expect(presetMagnitude(classic!)).toBeNull();
  });

  it('converts the other presets to exact storage units', () => {
    for (const preset of FOLD_ANGLE_PRESETS.filter((entry) => entry.id !== 'classic')) {
      expect(presetMagnitude(preset)).toBe(preset.degrees * FOLD_MAGNITUDE_UNITS_PER_DEGREE);
    }
  });

  it('offers the angles that cover transcription work', () => {
    expect(FOLD_ANGLE_PRESETS.map((preset) => preset.degrees)).toEqual([180, 135, 120, 90, 60, 45]);
  });
});

describe('selection summary', () => {
  it('reports a shared angle', () => {
    expect(summariseFoldAngles([90, 90, 90], 0)).toEqual({
      degrees: 90,
      creaseCount: 3,
      nonCreaseCount: 0,
      mixed: false,
    });
  });

  it('reports mixed when the selection disagrees', () => {
    const summary = summariseFoldAngles([90, 45], 0);
    expect(summary.mixed).toBe(true);
    expect(summary.degrees).toBeNull();
  });

  it('treats an empty selection as unmixed and empty', () => {
    expect(summariseFoldAngles([], 2)).toEqual({
      degrees: null,
      creaseCount: 0,
      nonCreaseCount: 2,
      mixed: false,
    });
  });

  it('counts lines that cannot carry an angle separately', () => {
    // Borders and aux lines are skipped rather than silently mutated, so the UI
    // has to be able to say how many of the selection were actually affected.
    expect(describeAffected(summariseFoldAngles([90, 90], 5))).toBe('2 of 7 selected lines');
    expect(describeAffected(summariseFoldAngles([90], 0))).toBe('1 crease');
    expect(describeAffected(summariseFoldAngles([90, 90], 0))).toBe('2 creases');
  });
});
