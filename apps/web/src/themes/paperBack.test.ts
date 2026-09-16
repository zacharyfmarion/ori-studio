import { describe, expect, it } from 'vitest';
import { PRESET_THEMES } from './index';
import { mixHexColors } from '../lib/rgbColor';
import { paperBackFor, relativeLuminance, wcagContrast } from './paperBack';

/**
 * The rule over the whole registry, rather than a table of hand-computed
 * numbers.
 *
 * The defect this replaced was one unbranched line that happened to be right on
 * one side of the theme registry and wrong on the other, and a table would have
 * gone stale the first time a preset was added. These run the derivation.
 */

/** The cap the rule enforces: just above the light themes' measured band. */
const MAX_STEP = 1.9;

const ground = (t: (typeof PRESET_THEMES)[number]) => t.colors['bg.primary'];
const ink = (t: (typeof PRESET_THEMES)[number]) => t.colors['text.primary'];

describe('paperBackFor', () => {
  it('keeps every theme’s back face inside a step a light theme reads at', () => {
    for (const theme of PRESET_THEMES) {
      const back = paperBackFor(ground(theme), ink(theme));
      expect(
        wcagContrast(back, ground(theme)),
        `${theme.name}: ${back} against ${ground(theme)}`
      ).toBeLessThanOrEqual(MAX_STEP);
    }
  });

  // A `color-mix()` here parses to nothing in `renderer/cssColor.ts` and leaves
  // the back face the colour of the ground, which is to say invisible. That has
  // shipped.
  it('emits a flat hex a WebGL canvas can parse', () => {
    for (const theme of PRESET_THEMES) {
      expect(paperBackFor(ground(theme), ink(theme))).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  // The legend is a *30%* grey. The cap may take less; it may never take more,
  // or the back face stops being the same paper.
  //
  // Measured in bytes, which is where the mix happens. Luminance is the wrong
  // ruler for this one: sRGB's curve means 30% of the way in bytes is nowhere
  // near 30% of the way in luminance, which is the whole reason this module
  // exists.
  it('never mixes in more than the legend’s 30% ink', () => {
    for (const theme of PRESET_THEMES) {
      const back = channels(paperBackFor(ground(theme), ink(theme)));
      const bg = channels(ground(theme));
      // A dark theme shades toward black, not toward its (light) ink.
      const full = channels(theme.type === 'dark' ? '#000000' : ink(theme));
      for (const i of [0, 1, 2]) {
        const span = full[i] - bg[i];
        // A channel the ink shares with the ground says nothing about the mix.
        if (Math.abs(span) < 8) continue;
        // Half a byte of rounding slack, and a hair for the division.
        expect((back[i] - bg[i]) / span, `${theme.name} channel ${i}`).toBeLessThanOrEqual(
          0.3 + 0.5 / Math.abs(span) + 1e-9
        );
      }
    }
  });

  // Light reads correctly today and is the thing being matched, so it must come
  // through untouched — and the dark themes already inside the cap with it.
  it('leaves a theme already inside the cap exactly where it was', () => {
    // The legend's own mix, through the shared helper the module uses — not a
    // second copy of that arithmetic, which is a thing to keep in step and was
    // wrong by a byte the first time it was written here.
    const legend = (t: (typeof PRESET_THEMES)[number]) =>
      mixHexColors(ground(t), t.type === 'dark' ? '#000000' : ink(t), 1 - 0.3);
    const untouched = PRESET_THEMES.filter(
      (t) => wcagContrast(legend(t), ground(t)) <= MAX_STEP
    );
    // Every theme now: the light ones were always inside, and a dark ground
    // shaded toward black cannot step further than (ground + 0.05) / 0.05.
    expect(untouched.length).toBe(PRESET_THEMES.length);
    expect(untouched.filter((t) => t.type === 'light')).toHaveLength(
      PRESET_THEMES.filter((t) => t.type === 'light').length
    );
    for (const theme of untouched) {
      expect(paperBackFor(ground(theme), ink(theme)), theme.name).toBe(legend(theme));
    }
  });

  // The other side of paper is the darker side, whichever theme it is drawn
  // in. Before this a dark theme's back face was a lighter slab — 1.57–2.57×
  // its ground's luminance — which is a glow, not a turn-over.
  it('is darker than the front on every theme', () => {
    for (const theme of PRESET_THEMES) {
      const back = paperBackFor(ground(theme), ink(theme));
      expect(relativeLuminance(back), theme.name).toBeLessThan(relativeLuminance(ground(theme)));
    }
  });

  it('is the ground itself when a theme has no ink to mix', () => {
    expect(paperBackFor('#123456', '#123456')).toBe('#123456');
  });
});

function channels(hex: string): [number, number, number] {
  const s = hex.replace(/^#/, '');
  return [0, 2, 4].map((i) => Number.parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
}
