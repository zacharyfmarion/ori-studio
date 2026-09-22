import { describe, expect, it } from 'vitest';
import { PRESET_THEMES } from './index';
import { relativeLuminance, wcagContrast } from './paperBack';

/**
 * `--settings-well` is `var(--bg-canvas)` and the Settings ▸ Paper card it sits
 * in is `var(--bg-surface)` (see theme.css). That is the whole of the token, so
 * what is worth testing is the claim it rests on: that a theme's canvas is on
 * the recessed side of its surface, whichever way round the theme runs.
 *
 * The design this came from is drawn in one dark palette, where the well is a
 * near-black under a slate card. Hard-coding that would give a light theme a
 * black hole where a field should be; deriving it from `--bg-canvas` only works
 * if every light theme puts its canvas *above* its surface, the way white paper
 * sits above a grey card. All 23 do — this is what says so out loud, so a 24th
 * that does not fails here rather than in the paper tab.
 */

/** Below this the well stops reading as a separate ground and the card swallows it. */
const MIN_STEP = 1.05;

const canvas = (theme: (typeof PRESET_THEMES)[number]) => theme.colors['bg.canvas'];
const surface = (theme: (typeof PRESET_THEMES)[number]) => theme.colors['bg.surface'];

describe('--settings-well', () => {
  it('recedes from the card on a dark theme and comes forward on a light one', () => {
    for (const theme of PRESET_THEMES) {
      const well = canvas(theme);
      const card = surface(theme);
      expect(well, theme.name).toBeDefined();
      expect(card, theme.name).toBeDefined();
      const darker = relativeLuminance(well) < relativeLuminance(card);
      expect(darker, `${theme.name} (${theme.type}): well ${well} against card ${card}`).toBe(
        theme.type === 'dark'
      );
    }
  });

  it('keeps the well far enough from the card to read as a field', () => {
    for (const theme of PRESET_THEMES) {
      expect(
        wcagContrast(canvas(theme), surface(theme)),
        `${theme.name}: ${canvas(theme)} against ${surface(theme)}`
      ).toBeGreaterThanOrEqual(MIN_STEP);
    }
  });
});
