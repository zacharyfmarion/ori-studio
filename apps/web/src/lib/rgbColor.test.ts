import { describe, expect, it } from 'vitest';
import { hexToRgbColor, rgbColorToHex } from './rgbColor';

describe('rgbColorToHex', () => {
  it('formats channels as zero-padded #rrggbb', () => {
    expect(rgbColorToHex({ red: 255, green: 0, blue: 50 })).toBe('#ff0032');
    expect(rgbColorToHex({ red: 0, green: 0, blue: 0 })).toBe('#000000');
  });

  it('clamps and rounds out-of-range channels', () => {
    expect(rgbColorToHex({ red: 300, green: -10, blue: 127.6 })).toBe('#ff0080');
  });
});

describe('hexToRgbColor', () => {
  it('parses #rrggbb', () => {
    expect(hexToRgbColor('#ff0032')).toEqual({ red: 255, green: 0, blue: 50 });
  });

  it('expands #rgb shorthand', () => {
    expect(hexToRgbColor('#0f0')).toEqual({ red: 0, green: 255, blue: 0 });
  });

  it('round-trips with rgbColorToHex', () => {
    const color = { red: 233, green: 233, blue: 233 };
    expect(hexToRgbColor(rgbColorToHex(color))).toEqual(color);
  });

  it('falls back to black on malformed input', () => {
    expect(hexToRgbColor('nope')).toEqual({ red: 0, green: 0, blue: 0 });
  });
});
