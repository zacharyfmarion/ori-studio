import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { wcagContrast } from './paperBack';
import {
  GROUND_INK_CONTRAST,
  referencesCreaseAlpha,
  referencesDimAlpha,
  referencesGroundInk,
} from './referencesInk';

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
    expect(referencesDimAlpha('#ffffff', LIGHT.mountain, LIGHT.valley)).toBeCloseTo(0.26, 2);
  });

  it('bring the grey down to about half on a dark ground, and lift the dimmed creases', () => {
    // github-dark: the grey stood at twice the light theme's lightness step.
    const crease = referencesCreaseAlpha('#0d1117');
    expect(crease).toBeGreaterThan(0.3);
    expect(crease).toBeLessThan(0.45);
    const dim = referencesDimAlpha('#0d1117', DARK.mountain, DARK.valley);
    expect(dim).toBeGreaterThan(0.26);
    expect(dim).toBeLessThan(0.4);
  });

  it('stay within reach on every built-in theme', () => {
    for (const theme of presets()) {
      const crease = referencesCreaseAlpha(theme.ground);
      const inks = theme.type === 'dark' ? DARK : LIGHT;
      const dim = referencesDimAlpha(theme.ground, inks.mountain, inks.valley);
      for (const alpha of [crease, dim]) {
        expect(alpha, theme.name).toBeGreaterThanOrEqual(0.1);
        expect(alpha, theme.name).toBeLessThanOrEqual(1);
      }
      // The grey never shouts over the dimmed creases the way it did: on every
      // theme it sits within the band the light reference sets.
      if (theme.type === 'dark') expect(crease, theme.name).toBeLessThan(0.6);
    }
  });

  // D13: inside References the surface is the style's paper, not the theme's
  // ground, and the lift follows the paper's own lightness.
  it('derive against the paper they are handed, in the ink they are handed', () => {
    // A light paper on a dark theme reads as the light tuning, lift and all.
    expect(referencesDimAlpha('#ffff32', LIGHT.mountain, LIGHT.valley)).toBeCloseTo(
      referencesDimAlpha('#ffffff', LIGHT.mountain, LIGHT.valley),
      1
    );
    expect(referencesDimAlpha('#ffff32', LIGHT.mountain, LIGHT.valley)).toBeLessThan(
      referencesDimAlpha('#0d1117', DARK.mountain, DARK.valley)
    );
    // The aux pen's own colour sets the grey's alpha: a near-black pen on
    // white paper needs less of itself than the theme's mid grey does.
    expect(referencesCreaseAlpha('#ffffff', '#111111')).toBeLessThan(referencesCreaseAlpha('#ffffff'));
    expect(referencesCreaseAlpha('#ffffff', '#111111')).toBeGreaterThanOrEqual(0.1);
  });
});

describe('a mark off the paper, against the page', () => {
  it('keeps its own ink wherever that reads on the ground', () => {
    // Black on a white page — a transparent page reads as one — changes nothing.
    expect(referencesGroundInk('#000000', '#ffffff')).toBe('#000000');
    // A hue that holds 3:1 is kept, not traded for black.
    expect(wcagContrast('#1c5cd9', '#ffffff')).toBeGreaterThanOrEqual(GROUND_INK_CONTRAST);
    expect(referencesGroundInk('#1c5cd9', '#ffffff')).toBe('#1c5cd9');
    expect(referencesGroundInk('#f0f0f0', '#15181c')).toBe('#f0f0f0');
  });

  it('takes black or white, whichever reads, where its own ink does not', () => {
    expect(referencesGroundInk('#000000', '#15181c')).toBe('#ffffff');
    expect(referencesGroundInk('#f0f0f0', '#ffffff')).toBe('#000000');
    // Mid grounds pick the better of the two.
    expect(referencesGroundInk('#777777', '#808080')).toBe('#000000');
    expect(referencesGroundInk('#777777', '#404040')).toBe('#ffffff');
  });

  it('is always at least 3:1 against its ground', () => {
    for (const ground of ['#000000', '#15181c', '#404040', '#767676', '#808080', '#c0c0c0', '#ffffff']) {
      for (const ink of ['#000000', '#405060', '#db1f24', '#777777', '#ffff32', '#ffffff']) {
        const drawn = referencesGroundInk(ink, ground);
        expect(wcagContrast(drawn, ground), `${ink} on ${ground}`).toBeGreaterThanOrEqual(
          GROUND_INK_CONTRAST
        );
      }
    }
  });
});
