import { describe, expect, it } from 'vitest';
import { DASH_PRESETS, dashPresetOf, dashPresetRuns } from './paperDashPresets';
import {
  DEFAULT_PAPER_STYLE,
  ORIEDITA_MOUNTAIN_DASH_MULTIPLES,
  type Pen,
} from './paperStyle';

const pen = (dash: number[] | null): Pen => ({ ...DEFAULT_PAPER_STYLE.edges, dash });

describe('paperDashPresets', () => {
  it('names every dash the menu offers, once', () => {
    expect(DASH_PRESETS.map((preset) => preset.id)).toEqual([
      'solid',
      'dashed',
      'dashDot',
      'dotted',
      'longDash',
      'fineDash',
    ]);
  });

  it('round-trips every named dash through a pen', () => {
    for (const preset of DASH_PRESETS) {
      expect(dashPresetOf(pen(dashPresetRuns(preset.id)))).toBe(preset.id);
    }
  });

  it('hands back a copy, so a pen cannot write back into the vocabulary', () => {
    const runs = dashPresetRuns('dashDot')!;
    runs[0] = 99;
    expect(dashPresetRuns('dashDot')).toEqual([8, 2, 1, 2]);
  });

  it('matches within the schema’s dash tolerance', () => {
    expect(dashPresetOf(pen([4.0000001, 2]))).toBe('dashed');
    expect(dashPresetOf(pen([4.01, 2]))).toBe('custom');
  });

  it('calls a pattern it does not hold custom, Oriedita’s crease runs included', () => {
    expect(dashPresetOf(pen([3, 1, 5]))).toBe('custom');
    expect(dashPresetOf(pen([...ORIEDITA_MOUNTAIN_DASH_MULTIPLES]))).toBe('custom');
  });
});
