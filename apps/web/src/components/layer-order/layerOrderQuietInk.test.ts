import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { themeCssVariables } from '../../themes/applyTheme';
import { PRESET_THEMES } from '../../themes/index';
import { wcagContrast } from '../../themes/paperBack';
import type { TreeMakerTheme } from '../../themes/types';

/**
 * The Layer order inspector's quiet ink (U10's review): the hint line, the
 * placeholders, the section titles, the list's verbs and separators and its
 * empty line. `--text-secondary` alone is under 4.5:1 there in One Dark, so the
 * inspector's modules mix it toward `--text-primary` as the approved boards'
 * `--mock-text-quiet` does, half and half (the boards' 55% leaves Palenight's
 * hovered row at 4.42:1), and this holds every preset at 4.5:1 on each ground
 * that text sits on: the column (`--bg-secondary`), a slot (`--bg-primary`)
 * and a hovered row (`--bg-surface`). Solarized Dark and Light are the two
 * exceptions: their own text inks sit at or under the line, so no mix of them
 * reaches 4.5:1, and the quiet ink is held at the weaker of the two there.
 */

const MIN_CONTRAST = 4.5;
/** The presets whose own text inks don't reach 4.5:1 on the inspector's grounds (see the test). */
const SOLARIZED = new Set(['Solarized Dark', 'Solarized Light']);
/** `color-mix(in srgb, var(--text-secondary) SHARE%, var(--text-primary))`, as each module defines `--quiet`. */
const QUIET = /--quiet:\s*color-mix\(in srgb, var\(--text-secondary\) (\d+)%, var\(--text-primary\)\);/;
const MODULES = ['LayerOrderBuilder.module.css', 'LayerOrderConstraintList.module.css'];

function applied(theme: TreeMakerTheme, name: string): string {
  const value = themeCssVariables(theme)
    .filter(([variable]) => variable === name)
    .at(-1)?.[1];
  if (value === undefined) throw new Error(`${theme.name} sets no ${name}`);
  return value;
}

function channels(hex: string): number[] {
  const s = hex.trim().replace(/^#/, '');
  expect(s, `${hex} must be a 6-digit hex`).toMatch(/^[0-9a-fA-F]{6}$/);
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}

/** `color-mix(in srgb, a share, b)`: each sRGB channel interpolated as written. */
function mix(a: string, b: string, share: number): string {
  const [x, y] = [channels(a), channels(b)];
  return `#${x
    .map((v, i) => Math.round(v * share + y[i]! * (1 - share)))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

const shares = MODULES.map((file) => {
  const css = readFileSync(resolve(__dirname, file), 'utf8');
  const found = QUIET.exec(css);
  if (!found) throw new Error(`${file} defines no --quiet`);
  return [file, Number(found[1]) / 100] as const;
});

describe('the inspector’s quiet ink', () => {
  it('is the same mix in every module that draws it', () => {
    expect(new Set(shares.map(([, share]) => share)).size).toBe(1);
  });

  it.each(PRESET_THEMES.map((theme) => [theme.name, theme] as const))('%s: reads at 4.5:1 on every ground it sits on', (_name, theme) => {
    const share = shares[0]![1];
    const quiet = mix(applied(theme, '--text-secondary'), applied(theme, '--text-primary'), share);
    for (const ground of ['--bg-secondary', '--bg-primary', '--bg-surface']) {
      const back = applied(theme, ground);
      const contrast = wcagContrast(quiet, back);
      const primary = wcagContrast(applied(theme, '--text-primary'), back);
      const secondary = wcagContrast(applied(theme, '--text-secondary'), back);
      // Solarized's own inks sit at the line: its body text is 4.11:1 (dark) and 3.64:1 (light) on its
      // --bg-secondary and 4.75:1 on the dark --bg-primary, so no mix with --text-secondary in it
      // reaches 4.5:1. There the quiet ink is held at least at the weaker of the theme's own two inks.
      const floor = SOLARIZED.has(theme.name) ? Math.min(MIN_CONTRAST, primary, secondary) : MIN_CONTRAST;
      expect(contrast, `${quiet} on ${ground} ${back}`).toBeGreaterThanOrEqual(floor);
    }
  });
});
