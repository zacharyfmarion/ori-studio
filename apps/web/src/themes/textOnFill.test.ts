import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRESET_THEMES, themeCssVariables } from './index';
import { wcagContrast } from './paperBack';
import { TEXT_ON_FILL_MIN_CONTRAST, textOnFill } from './textOnFill';

/**
 * The rule over the whole registry: whatever a menu highlights with, its text
 * reads. Run through `themeCssVariables`, so it checks what `applyTheme` really
 * sets rather than a second copy of the derivation.
 */

/** The last value `applyTheme` sets for `name`, as repeated `setProperty` calls leave it. */
function variable(theme: (typeof PRESET_THEMES)[number], name: string): string {
  const value = themeCssVariables(theme)
    .filter(([key]) => key === name)
    .at(-1)?.[1];
  if (value === undefined) throw new Error(`${theme.name} sets no ${name}`);
  return value;
}

describe('textOnFill', () => {
  it('keeps the ground where it reads', () => {
    // One Dark's accent is light, and its own dark ground reads on it.
    expect(textOnFill('#61afef', '#282c34')).toBe('#282c34');
  });

  it('falls back to black or white, whichever reads better', () => {
    // Solarized Light's accent against its own cream ground is 3.41:1.
    expect(textOnFill('#268bd2', '#fdf6e3')).toBe('#000000');
    // A dark fill with a dark ground: only white reads.
    expect(textOnFill('#1d4ed8', '#101417')).toBe('#ffffff');
  });

  it.each([
    ['--accent-primary', '--text-on-accent'],
    ['--status-danger', '--text-on-danger'],
  ])('reads at AA on %s in every preset', (fill, text) => {
    for (const theme of PRESET_THEMES) {
      const on = variable(theme, text);
      expect(
        wcagContrast(variable(theme, fill), on),
        `${theme.name}: ${on} on ${variable(theme, fill)}`
      ).toBeGreaterThanOrEqual(TEXT_ON_FILL_MIN_CONTRAST);
    }
  });
});

describe('the defaults in theme.css', () => {
  // The first paint, before any theme is applied, follows the same rule.
  const css = readFileSync(resolve(process.cwd(), 'src/styles/theme.css'), 'utf8');
  const declared = (name: string) => {
    const match = new RegExp(`\\n\\s*${name}:\\s*([^;]+);`).exec(css);
    if (!match) throw new Error(`theme.css declares no ${name}`);
    return match[1].trim();
  };

  it.each([
    ['--accent-primary', '--text-on-accent'],
    ['--status-danger', '--text-on-danger'],
  ])('derive %s’s text the way applyTheme does', (fill, text) => {
    expect(declared(text)).toBe(textOnFill(declared(fill), declared('--bg-primary')));
  });

  it('highlight menu rows with the accent and the text that reads on it', () => {
    expect(declared('--menu-highlight')).toBe('var(--accent-primary)');
    expect(declared('--menu-highlight-text')).toBe('var(--text-on-accent)');
  });
});
