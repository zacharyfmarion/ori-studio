import { describe, expect, it } from 'vitest';
import { PRESET_THEMES } from './index';
import type { TreeMakerTheme } from './types';

/**
 * What a selected crease is painted must **never be red and never be blue**.
 *
 * Red is mountain and blue is valley, and a crease's colour is the only thing
 * that says which it is — so a selected mountain painted accent-blue simply reads
 * as a valley. That was the bug.
 *
 * The colour is the theme's own accent by default and `selection.cp` only where
 * that accent collides, so this checks the **effective** value. Both halves need
 * holding: a new theme whose accent is blue and which forgot to override fails
 * here, and so does an override that drifts into a fold hue.
 */

/** The fold colours every theme of that type draws with (`applyTheme`). */
const FOLD = {
  dark: { mountain: '#ff4d5d', valley: '#60a5fa' },
  light: { mountain: '#d91f3a', valley: '#2563eb' },
} as const;

/**
 * Minimum hue separation from both mountain and valley, in degrees.
 *
 * 28 rather than something rounder because the themes fall either side of a real
 * gap: every genuinely confusable accent is within 20 degrees (one-dark's blue at
 * 6, horizon's pink-red at 8), and the next ones up are at 32 — gruvbox's orange
 * against mountain, which nobody mistakes for a mountain. Set it at 45 and you
 * take gruvbox's orange away for nothing.
 */
const MIN_HUE_DISTANCE = 28;
/** Minimum contrast against the theme's own canvas, so the border is visible. */
const MIN_CANVAS_CONTRAST = 4;
/** Below this saturation a colour has no meaningful hue to be safe *by*. */
const MIN_SATURATION = 0.2;

function rgb(hex: string): [number, number, number] {
  const s = hex.trim().replace(/^#/, '');
  expect(s, `${hex} must be a 6-digit hex`).toMatch(/^[0-9a-fA-F]{6}$/);
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
}

function relativeLuminance(hex: string): number {
  const channels = rgb(hex)
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function hueAndSaturation(hex: string): { hue: number; saturation: number } {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    hue =
      max === r
        ? 60 * (((g - b) / delta) % 6)
        : max === g
          ? 60 * ((b - r) / delta + 2)
          : 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return { hue, saturation };
}

/** Shortest angular distance between two hues, in degrees. */
function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

const themes: TreeMakerTheme[] = PRESET_THEMES;

/** What `applyTheme` actually paints a selected crease. */
function effectiveSelection(theme: TreeMakerTheme): string {
  return theme.colors['selection.cp'] ?? theme.colors['accent.primary'];
}

describe('selection.cp', () => {
  it('resolves to a colour for every theme', () => {
    expect(themes.length).toBeGreaterThan(20);
    for (const theme of themes) {
      expect(effectiveSelection(theme), `${theme.name} resolves to nothing`).toBeTruthy();
    }
  });

  it('overrides only the themes that need one', () => {
    // The override exists to rescue a colliding accent, not to restyle themes
    // whose accent is already fine. If this count climbs, check that whatever was
    // added could not simply have kept its accent.
    const overridden = themes.filter((t) => t.colors['selection.cp']).map((t) => t.name);
    expect(overridden.length).toBeLessThan(themes.length);
    for (const theme of themes) {
      if (theme.colors['selection.cp']) continue;
      // A theme without an override must be one whose accent genuinely passes.
      const { hue } = hueAndSaturation(theme.colors['accent.primary']);
      const folds = FOLD[theme.type];
      for (const fold of Object.values(folds)) {
        expect(
          hueDistance(hue, hueAndSaturation(fold).hue),
          `${theme.name} has no selection.cp but its accent is close to a fold colour`
        ).toBeGreaterThanOrEqual(MIN_HUE_DISTANCE);
      }
    }
  });

  it.each(themes.map((t) => [t.name, t] as const))('%s is neither red nor blue', (_name, theme) => {
    const selection = effectiveSelection(theme);
    const folds = FOLD[theme.type];
    const { hue, saturation } = hueAndSaturation(selection);

    // A washed-out colour has no hue to be safely distant *in*, so the distances
    // below would be meaningless rather than reassuring.
    expect(saturation).toBeGreaterThanOrEqual(MIN_SATURATION);

    for (const [assignment, fold] of Object.entries(folds)) {
      expect(
        hueDistance(hue, hueAndSaturation(fold).hue),
        `${theme.name}: selection ${selection} is too close in hue to ${assignment} ${fold}`
      ).toBeGreaterThanOrEqual(MIN_HUE_DISTANCE);
    }
  });

  it.each(themes.map((t) => [t.name, t] as const))('%s is visible on its canvas', (_name, theme) => {
    expect(contrast(effectiveSelection(theme), theme.colors['bg.canvas'])).toBeGreaterThanOrEqual(
      MIN_CANVAS_CONTRAST
    );
  });
});
