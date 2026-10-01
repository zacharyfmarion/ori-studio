import { describe, expect, it } from 'vitest';
import { ORIEDITA_MOUNTAIN_DASH_MULTIPLES } from './paperStyle';
import { formatDashText, parseDashText } from './paperDashText';

describe('paperDashText', () => {
  it('writes a solid pen as an empty field and runs separated by spaces', () => {
    expect(formatDashText(null)).toBe('');
    expect(formatDashText([8, 2, 1, 2])).toBe('8 2 1 2');
    expect(formatDashText([2.5, 1])).toBe('2.5 1');
  });

  it('reads an empty or blank field as solid', () => {
    expect(parseDashText('')).toBeNull();
    expect(parseDashText('   ')).toBeNull();
  });

  it('reads runs separated by spaces or commas', () => {
    expect(parseDashText('8 2 1 2')).toEqual([8, 2, 1, 2]);
    expect(parseDashText(' 4,2 ')).toEqual([4, 2]);
    expect(parseDashText('8, 2, 1, 2')).toEqual([8, 2, 1, 2]);
  });

  it('refuses anything that is not a dash', () => {
    expect(parseDashText('8 x')).toBeUndefined();
    expect(parseDashText('-1 2')).toBeUndefined();
    expect(parseDashText('0 0')).toBeUndefined();
  });

  it('rounds a derived run rather than printing its tail', () => {
    // The mono-dashed crease style derives Oriedita's runs as multiples of the
    // pen width, which is 9.090909090909092 — unreadable in a 200px field.
    expect(formatDashText([...ORIEDITA_MOUNTAIN_DASH_MULTIPLES])).toBe('9.091 2.727 2.727 2.727');
    expect(formatDashText([2.5, 1])).toBe('2.5 1');
  });

  it('round-trips through the formatter', () => {
    for (const dash of [null, [8, 2, 1, 2], [4, 2], [1, 2], [0.5, 3]]) {
      expect(parseDashText(formatDashText(dash))).toEqual(dash);
    }
  });
});
