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

describe('what the renderer can and cannot read', () => {
  // A WebGL canvas reads theme tokens through this parser, so a token written
  // as a `color-mix()` silently becomes whatever fallback the caller passed —
  // which is how `--paper-back` looked implemented and did nothing.
  it('does not understand color-mix, so tokens the canvas reads must be flat', () => {
    expect(parseCssColor('color-mix(in srgb, #101417 70%, #e8edf0)')).toBeNull();
    expect(parseCssColor('color(srgb 0.1 0.2 0.3)')).toBeNull();
  });

  it('understands the forms a theme token is allowed to take', () => {
    expect(parseCssColor('#515558')).not.toBeNull();
    expect(parseCssColor('rgb(81, 85, 88)')).not.toBeNull();
  });
});
