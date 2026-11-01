import { describe, expect, it } from 'vitest';
import { FACE_PICK_COLORS, themeCssVariables } from './applyTheme';
import { PRESET_THEMES } from './index';
import { wcagContrast } from './paperBack';
import type { TreeMakerTheme } from './types';

/**
 * The Layer order dialog's face picks, `--face-pick`, read apart from what
 * else is on its panes in every preset (`implementation-plans/layer-order-dialog.md`,
 * D20).
 *
 * A pick tints and rings a face. Before D20 it took the theme's accent, which
 * is the valley blue in One Dark (a picked face read as a valley) and the
 * danger pink in Horizon (a pick read as a clash). So the colour is fixed per
 * dark or light type and held here, on the values `applyTheme` sets:
 *
 * - **apart from the valley blue** a crease is drawn in, by D20's measure of
 *   42° (it sits at 42.0° from the dark valley and 42.2° from the light one);
 * - **apart from every danger colour**, which a clash is tinted in: 83° at
 *   the nearest (Monokai's pink at 83.3°);
 * - **legible on every canvas**: 5.3:1 at the least on `bg.canvas` (Nord's,
 *   5.36:1), and 4.5:1 on the panes' own ground, `bg.primary` (Nord's, 4.59:1).
 *
 * Mountain red sits further off than any danger colour, so the danger
 * measure covers it.
 */

const MIN_VALLEY_HUE_DISTANCE = 42;
const MIN_DANGER_HUE_DISTANCE = 83;
const MIN_CANVAS_CONTRAST = 5.3;
const MIN_GROUND_CONTRAST = 4.5;

/** The value `applyTheme` sets `name` to, the last write winning, as `setProperty` would. */
function applied(theme: TreeMakerTheme, name: string): string {
  const value = themeCssVariables(theme)
    .filter(([variable]) => variable === name)
    .at(-1)?.[1];
  if (value === undefined) throw new Error(`${theme.name} sets no ${name}`);
  return value;
}

function rgb(hex: string): [number, number, number] {
  const s = hex.trim().replace(/^#/, '');
  expect(s, `${hex} must be a 6-digit hex`).toMatch(/^[0-9a-fA-F]{6}$/);
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
}

function hue(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  const h = max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
  return h < 0 ? h + 360 : h;
}

/** The shortest way round the wheel between two hues, degrees. */
function hueDistance(a: string, b: string): number {
  const d = Math.abs(hue(a) - hue(b)) % 360;
  return d > 180 ? 360 - d : d;
}

const themes = PRESET_THEMES.map((theme) => [theme.name, theme] as const);

describe('--face-pick', () => {
  it('is set per dark or light type, never from a theme', () => {
    expect(PRESET_THEMES.length).toBe(23);
    for (const theme of PRESET_THEMES) {
      expect(applied(theme, '--face-pick'), theme.name).toBe(FACE_PICK_COLORS[theme.type]);
    }
    expect(FACE_PICK_COLORS).toEqual({ dark: '#a78bfa', light: '#6d28d9' });
  });

  it.each(themes)('%s: reads apart from the valley blue', (_name, theme) => {
    const pick = applied(theme, '--face-pick');
    const valley = applied(theme, '--fold-valley');
    expect(hueDistance(pick, valley), `${pick} against valley ${valley}`).toBeGreaterThanOrEqual(MIN_VALLEY_HUE_DISTANCE);
  });

  it.each(themes)('%s: reads apart from its danger colour', (_name, theme) => {
    const pick = applied(theme, '--face-pick');
    const danger = applied(theme, '--status-danger');
    expect(hueDistance(pick, danger), `${pick} against danger ${danger}`).toBeGreaterThanOrEqual(MIN_DANGER_HUE_DISTANCE);
    expect(hueDistance(pick, applied(theme, '--fold-mountain'))).toBeGreaterThanOrEqual(MIN_DANGER_HUE_DISTANCE);
  });

  it.each(themes)('%s: is legible on its canvas and the panes’ ground', (_name, theme) => {
    const pick = applied(theme, '--face-pick');
    expect(wcagContrast(pick, theme.colors['bg.canvas'])).toBeGreaterThanOrEqual(MIN_CANVAS_CONTRAST);
    expect(wcagContrast(pick, theme.colors['bg.primary'])).toBeGreaterThanOrEqual(MIN_GROUND_CONTRAST);
  });
});
