import { describe, expect, it } from 'vitest';
import { createCpLineAppearanceResolver } from './cpLineStyle';
import {
  MOUNTAIN_DASH_SLOT,
  UNASSIGNED_DASH_SLOT,
  VALLEY_DASH_SLOT,
} from '../../lib/oristudioCpLineStyle';
import { ORISTUDIO_CP_LINE_STYLES } from '../../lib/creasePatternViewport';

const INK = '#111417';
const GREY = '#a2a2a2';
const MOUNTAIN = '#ff4d5d';
const VALLEY = '#60a5fa';
const AUX = '#64c8c8';
const UNASSIGNED = '#9aa4ad';

/** A themed root carrying the crease tokens the resolver reads. */
function themedRoot(): Element {
  const root = document.createElement('div');
  root.style.setProperty('--fold-border', INK);
  root.style.setProperty('--fold-monochrome-valley', GREY);
  root.style.setProperty('--fold-mountain', MOUNTAIN);
  root.style.setProperty('--fold-valley', VALLEY);
  root.style.setProperty('--fold-flat', AUX);
  root.style.setProperty('--fold-unassigned', UNASSIGNED);
  document.body.append(root);
  return root;
}

const hex = ([r, g, b]: readonly number[]): string =>
  `#${[r, g, b].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;

describe('createCpLineAppearanceResolver', () => {
  it('paints each crease its own themed colour in the color style', () => {
    const resolve = createCpLineAppearanceResolver('color', 'mvf', themedRoot());
    expect(hex(resolve('Red1').color)).toBe(MOUNTAIN);
    expect(hex(resolve('Blue2').color)).toBe(VALLEY);
    expect(resolve('Red1').dashSlot).toBe(0);
  });

  it('swaps in the ink and grey tokens for the black-white style', () => {
    const resolve = createCpLineAppearanceResolver('black-white', 'mvf', themedRoot());
    expect(hex(resolve('Red1').color)).toBe(INK);
    expect(hex(resolve('Black0').color)).toBe(INK);
    expect(hex(resolve('Blue2').color)).toBe(GREY);
  });

  it('inks the dot styles black and tags their dash slots', () => {
    const resolve = createCpLineAppearanceResolver('black-two-dot', 'mvf', themedRoot());
    expect(hex(resolve('Red1').color)).toBe(INK);
    expect(resolve('Red1').dashSlot).toBe(MOUNTAIN_DASH_SLOT);
    expect(resolve('Blue2').dashSlot).toBe(VALLEY_DASH_SLOT);
  });

  it('leaves auxiliary creases alone under every style', () => {
    for (const style of ['black-white', 'black-one-dot', 'black-two-dot'] as const) {
      const resolve = createCpLineAppearanceResolver(style, 'mvf', themedRoot());
      expect(hex(resolve('Cyan3').color)).toBe(AUX);
      expect(resolve('Cyan3').dashSlot).toBe(0);
    }
  });

  it('dots an undecided crease under every style, whatever ink it takes', () => {
    for (const style of ORISTUDIO_CP_LINE_STYLES) {
      const resolve = createCpLineAppearanceResolver(style, 'mvf', themedRoot());
      expect(resolve('None').dashSlot).toBe(UNASSIGNED_DASH_SLOT);
    }
  });

  it('is the only thing telling an undecided crease from a valley in black-white', () => {
    // This style paints a valley in the monochrome grey and an undecided crease
    // in the unassigned grey, and the two are within a few units per channel —
    // at hairline width that is one stroke. Colour cannot carry the difference
    // here, which is why the dash goes into the solid styles too.
    const resolve = createCpLineAppearanceResolver('black-white', 'mvf', themedRoot());
    expect(hex(resolve('None').color)).toBe(UNASSIGNED);
    const valley = resolve('Blue2').color;
    const undecided = resolve('None').color;
    const apart = Math.max(...[0, 1, 2].map((c) => Math.abs(valley[c] - undecided[c]) * 255));
    expect(apart).toBeLessThan(16);

    expect(resolve('Blue2').dashSlot).toBe(0);
    expect(resolve('None').dashSlot).toBe(UNASSIGNED_DASH_SLOT);
  });
});
