import { describe, expect, it } from 'vitest';
import {
  ORISTUDIO_CP_LINE_COLOR_PALETTE,
  cpPaletteEntryForColor,
  toggledCpLineColor,
} from './oristudioCpPalette';

describe('toggledCpLineColor', () => {
  it('swaps mountain and valley', () => {
    expect(toggledCpLineColor('Red1')).toBe('Blue2');
    expect(toggledCpLineColor('Blue2')).toBe('Red1');
  });

  it('is an involution on the pair', () => {
    expect(toggledCpLineColor(toggledCpLineColor('Red1'))).toBe('Red1');
    expect(toggledCpLineColor(toggledCpLineColor('Blue2'))).toBe('Blue2');
  });

  // Upstream `LineColor.changeMV()` returns `this` for everything that is not
  // RED_1 / BLUE_2. Holding Control with Edge or Auxiliary selected must
  // therefore do nothing at all.
  it('leaves every other palette colour unchanged', () => {
    const untouched = ORISTUDIO_CP_LINE_COLOR_PALETTE.filter(
      (entry) => entry.lineColor !== 'Red1' && entry.lineColor !== 'Blue2',
    );

    expect(untouched.length).toBeGreaterThan(0);
    for (const entry of untouched) {
      expect(toggledCpLineColor(entry.lineColor)).toBe(entry.lineColor);
    }
  });

  it('leaves the unassigned colour unchanged', () => {
    expect(toggledCpLineColor('None')).toBe('None');
  });

  it('swaps between two colours the palette actually offers', () => {
    expect(cpPaletteEntryForColor(toggledCpLineColor('Red1'))?.id).toBe('valley');
    expect(cpPaletteEntryForColor(toggledCpLineColor('Blue2'))?.id).toBe('mountain');
  });
});
