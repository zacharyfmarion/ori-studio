import { describe, expect, it } from 'vitest';
import { ORISTUDIO_CP_LINE_STYLES, type OristudioCpLineStyle } from './creasePatternViewport';
import {
  cpLineStyleDashPattern,
  cpLineStyleDashPatterns,
  cpLineStyleDashSlot,
  cpLineStyleInk,
  MOUNTAIN_DASH_SLOT,
  ORIEDITA_DASH_ONE_DOT,
  ORIEDITA_DASH_TWO_DOT,
  ORIEDITA_DASH_VALLEY,
  SOLID_DASH_SLOT,
  VALLEY_DASH_SLOT,
  type CpLineInk,
} from './oristudioCpLineStyle';

const MOUNTAIN = 'Red1';
const VALLEY = 'Blue2';
const EDGE = 'Black0';
const AUX = 'Cyan3';
const OTHER = 'Purple8';

/**
 * The table Oriedita's `DrawingUtil.drawCpLine` implements, transcribed from the
 * upstream source: ink first, then the dash pattern (device px on/off runs), for
 * each style × line colour.
 */
const ORIEDITA_TABLE: Record<
  OristudioCpLineStyle,
  Record<string, { ink: CpLineInk; dash: readonly number[] | null }>
> = {
  color: {
    [MOUNTAIN]: { ink: 'own', dash: null },
    [VALLEY]: { ink: 'own', dash: null },
    [EDGE]: { ink: 'own', dash: null },
    [AUX]: { ink: 'own', dash: null },
    [OTHER]: { ink: 'own', dash: null },
  },
  'black-white': {
    [MOUNTAIN]: { ink: 'black', dash: null },
    [VALLEY]: { ink: 'grey', dash: null },
    [EDGE]: { ink: 'black', dash: null },
    [AUX]: { ink: 'own', dash: null },
    [OTHER]: { ink: 'own', dash: null },
  },
  'color-and-shape': {
    [MOUNTAIN]: { ink: 'own', dash: ORIEDITA_DASH_ONE_DOT },
    [VALLEY]: { ink: 'own', dash: ORIEDITA_DASH_VALLEY },
    [EDGE]: { ink: 'own', dash: null },
    [AUX]: { ink: 'own', dash: null },
    [OTHER]: { ink: 'own', dash: null },
  },
  'black-one-dot': {
    [MOUNTAIN]: { ink: 'black', dash: ORIEDITA_DASH_ONE_DOT },
    [VALLEY]: { ink: 'black', dash: ORIEDITA_DASH_VALLEY },
    [EDGE]: { ink: 'black', dash: null },
    [AUX]: { ink: 'own', dash: null },
    [OTHER]: { ink: 'black', dash: null },
  },
  'black-two-dot': {
    [MOUNTAIN]: { ink: 'black', dash: ORIEDITA_DASH_TWO_DOT },
    [VALLEY]: { ink: 'black', dash: ORIEDITA_DASH_VALLEY },
    [EDGE]: { ink: 'black', dash: null },
    [AUX]: { ink: 'own', dash: null },
    [OTHER]: { ink: 'black', dash: null },
  },
};

describe('Oriedita LineStyle parity', () => {
  for (const style of ORISTUDIO_CP_LINE_STYLES) {
    for (const [color, expected] of Object.entries(ORIEDITA_TABLE[style])) {
      it(`${style} inks and dashes ${color} like drawCpLine`, () => {
        expect(cpLineStyleInk(style, color)).toBe(expected.ink);
        expect(cpLineStyleDashPattern(style, color)).toEqual(expected.dash);
      });
    }
  }

  it('covers every style in the enum', () => {
    expect(Object.keys(ORIEDITA_TABLE).sort()).toEqual([...ORISTUDIO_CP_LINE_STYLES].sort());
  });
});

describe('dash slots', () => {
  it('addresses the style pattern table, with 0 reserved for solid', () => {
    for (const style of ORISTUDIO_CP_LINE_STYLES) {
      const patterns = cpLineStyleDashPatterns(style);
      for (const color of [MOUNTAIN, VALLEY, EDGE, AUX, OTHER]) {
        const slot = cpLineStyleDashSlot(style, color);
        expect(slot === SOLID_DASH_SLOT ? null : patterns[slot - 1]).toEqual(
          cpLineStyleDashPattern(style, color),
        );
      }
    }
  });

  it('gives mountain and valley their own stable slots', () => {
    expect(cpLineStyleDashSlot('black-two-dot', MOUNTAIN)).toBe(MOUNTAIN_DASH_SLOT);
    expect(cpLineStyleDashSlot('black-two-dot', VALLEY)).toBe(VALLEY_DASH_SLOT);
  });

  it('leaves the solid styles with no patterns at all', () => {
    expect(cpLineStyleDashPatterns('color')).toEqual([]);
    expect(cpLineStyleDashPatterns('black-white')).toEqual([]);
  });
});
