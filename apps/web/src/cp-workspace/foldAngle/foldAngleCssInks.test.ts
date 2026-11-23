/**
 * `foldAngleCssInks` — the fold-angle encoding for a painter that holds its
 * inks as CSS colours (the export, the pattern thumbnails, the rail cards).
 *
 * It must be `foldAngleInk` and nothing else: the same alpha in `opacity`, the
 * same hue in `color`, and a classic crease untouched — so a 3D crease is
 * shaded alike on Edit's canvas and in every list of patterns.
 */
import { describe, expect, it } from 'vitest';
import { FOLD_MAGNITUDE_CLASSIC, FOLD_MAGNITUDE_UNITS_PER_DEGREE } from '../../lib/foldAngle';
import { hexToRgbColor } from '../../lib/rgbColor';
import type { Rgba } from '../renderer/types';
import { FOLD_ANGLE_ANCHOR_FALLBACK, foldAngleCssInks, foldAngleInk } from './foldAngleRamp';

const MOUNTAIN = '#ff4d5d';
const MOUNTAIN_RGBA: Rgba = [1, 0x4d / 255, 0x5d / 255, 1];
const deg = (value: number) => value * FOLD_MAGNITUDE_UNITS_PER_DEGREE;

function rgbaOf(hex: string): Rgba {
  const { red, green, blue } = hexToRgbColor(hex);
  return [red / 255, green / 255, blue / 255, 1];
}

describe('foldAngleCssInks', () => {
  it('leaves a classic crease as it came: absent, a full fold, or the transport’s sentinel', () => {
    const inkFor = foldAngleCssInks({ display: 'opacity', anchor: FOLD_ANGLE_ANCHOR_FALLBACK });
    for (const magnitude of [undefined, deg(180), FOLD_MAGNITUDE_CLASSIC]) {
      expect(inkFor(' #ff4d5d', magnitude)).toEqual({ stroke: ' #ff4d5d', opacity: 1 });
    }
  });

  it('spends alpha in `opacity`, exactly as Edit’s canvas does, and keeps the colour', () => {
    const inkFor = foldAngleCssInks({ display: 'opacity', anchor: FOLD_ANGLE_ANCHOR_FALLBACK });
    for (const angle of [0, 20, 90, 179]) {
      const canvas = foldAngleInk(MOUNTAIN_RGBA, deg(angle), { display: 'opacity', anchor: FOLD_ANGLE_ANCHOR_FALLBACK });
      const css = inkFor(MOUNTAIN, deg(angle));
      expect(css.stroke).toBe(MOUNTAIN);
      expect(css.opacity).toBeCloseTo(canvas[3], 10);
      expect(css.opacity).toBeLessThan(1);
    }
  });

  it('spends hue in `color`, exactly as Edit’s canvas does, at full opacity', () => {
    const inkFor = foldAngleCssInks({ display: 'color', anchor: FOLD_ANGLE_ANCHOR_FALLBACK });
    const canvas = foldAngleInk(MOUNTAIN_RGBA, deg(45), { display: 'color', anchor: FOLD_ANGLE_ANCHOR_FALLBACK });
    const css = inkFor(MOUNTAIN, deg(45));
    expect(css.opacity).toBe(1);
    expect(css.stroke).not.toBe(MOUNTAIN);
    rgbaOf(css.stroke)
      .slice(0, 3)
      .forEach((channel, k) => expect(Math.abs(channel - canvas[k]!)).toBeLessThanOrEqual(0.5 / 255 + 1e-9));
  });

  it('still fades an ink it cannot read, rather than draw the crease as a full fold', () => {
    for (const display of ['opacity', 'color'] as const) {
      const inkFor = foldAngleCssInks({ display, anchor: FOLD_ANGLE_ANCHOR_FALLBACK });
      const css = inkFor('oklch(60% 0.2 20)', deg(90));
      expect(css.stroke).toBe('oklch(60% 0.2 20)');
      expect(css.opacity).toBeCloseTo(
        foldAngleInk([0, 0, 0, 1], deg(90), { display: 'opacity', anchor: FOLD_ANGLE_ANCHOR_FALLBACK })[3],
        10
      );
    }
  });
});
