import { describe, expect, it } from 'vitest';
import { parseCssColor } from './cssColor';

describe('parseCssColor', () => {
  it('parses 6-digit hex', () => {
    expect(parseCssColor('#0c0f12')).toEqual([12 / 255, 15 / 255, 18 / 255, 1]);
  });

  it('parses shorthand 3-digit hex', () => {
    expect(parseCssColor('#fff')).toEqual([1, 1, 1, 1]);
  });

  it('trims surrounding whitespace (CSS var values are often padded)', () => {
    expect(parseCssColor('  #000000 ')).toEqual([0, 0, 0, 1]);
  });

  it('parses rgb() and rgba()', () => {
    expect(parseCssColor('rgb(255, 128, 0)')).toEqual([1, 128 / 255, 0, 1]);
    expect(parseCssColor('rgba(0, 0, 0, 0.5)')).toEqual([0, 0, 0, 0.5]);
  });

  it('returns null for empty or unparseable input', () => {
    expect(parseCssColor('')).toBeNull();
    expect(parseCssColor('   ')).toBeNull();
    expect(parseCssColor('not-a-color')).toBeNull();
    expect(parseCssColor('#12')).toBeNull();
    expect(parseCssColor('#gggggg')).toBeNull();
  });
});
