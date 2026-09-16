import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { referencesCreaseAlpha, referencesDimAlpha } from './referencesInk';

/** Every built-in theme's ground, ink type and name. */
function presets(): { name: string; type: 'light' | 'dark'; ground: string }[] {
  const dir = resolve(__dirname, 'presets');
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const theme = JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as {
        name: string;
        type: 'light' | 'dark';
        colors: Record<string, string>;
      };
      return { name: theme.name, type: theme.type, ground: theme.colors['bg.primary']! };
    });
}

const DARK = { mountain: '#ff4d5d', valley: '#60a5fa' };
const LIGHT = { mountain: '#d91f3a', valley: '#2563eb' };

describe('the References workspace’s context inks', () => {
  it('reproduce the tuning on the white ground it was made on', () => {
    expect(referencesCreaseAlpha('#ffffff')).toBeCloseTo(0.75, 2);
    expect(referencesDimAlpha('#ffffff', LIGHT.mountain, LIGHT.valley, 'light')).toBeCloseTo(0.26, 2);
  });

  it('bring the grey down to about half on a dark ground, and lift the dimmed creases', () => {
    // github-dark: the grey stood at twice the light theme's lightness step.
    const crease = referencesCreaseAlpha('#0d1117');
    expect(crease).toBeGreaterThan(0.3);
    expect(crease).toBeLessThan(0.45);
    const dim = referencesDimAlpha('#0d1117', DARK.mountain, DARK.valley, 'dark');
    expect(dim).toBeGreaterThan(0.26);
    expect(dim).toBeLessThan(0.4);
  });

  it('stay within reach on every built-in theme', () => {
    for (const theme of presets()) {
      const crease = referencesCreaseAlpha(theme.ground);
      const inks = theme.type === 'dark' ? DARK : LIGHT;
      const dim = referencesDimAlpha(theme.ground, inks.mountain, inks.valley, theme.type);
      for (const alpha of [crease, dim]) {
        expect(alpha, theme.name).toBeGreaterThanOrEqual(0.1);
        expect(alpha, theme.name).toBeLessThanOrEqual(1);
      }
      // The grey never shouts over the dimmed creases the way it did: on every
      // theme it sits within the band the light reference sets.
      if (theme.type === 'dark') expect(crease, theme.name).toBeLessThan(0.6);
    }
  });
});
