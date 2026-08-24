import { describe, expect, it } from 'vitest';
import { ORISTUDIO_CP_LINE_STYLES, type OristudioCpLineStyle } from './creasePatternViewport';
import {
  alternateDashSvg,
  cpLineStyleDashPattern,
  cpLineStyleDashPatterns,
  cpLineStyleDashSlot,
  cpLineStyleInk,
  HINT_DASH_SLOT,
  MOUNTAIN_DASH_SLOT,
  ORIEDITA_DASH_ONE_DOT,
  ORIEDITA_DASH_TWO_DOT,
  ORIEDITA_DASH_VALLEY,
  ORISTUDIO_DASH_HINT,
  ORISTUDIO_DASH_UNASSIGNED,
  SOLID_DASH_SLOT,
  UNASSIGNED_DASH_SLOT,
  VALLEY_DASH_SLOT,
  type CpLineInk,
} from './oristudioCpLineStyle';

const MOUNTAIN = 'Red1';
const VALLEY = 'Blue2';
const EDGE = 'Black0';
const AUX = 'Cyan3';
const OTHER = 'Purple8';
/** `LineColor.NONE` — a crease with no fold angle yet. Not in the port; see below. */
const UNASSIGNED = 'None';

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
      for (const color of [MOUNTAIN, VALLEY, EDGE, AUX, OTHER, UNASSIGNED]) {
        const slot = cpLineStyleDashSlot(style, color);
        expect(slot === SOLID_DASH_SLOT ? null : patterns[slot - 1]).toEqual(
          cpLineStyleDashPattern(style, color)
        );
      }
    }
  });

  it('gives each dashable kind the same slot under every style', () => {
    for (const style of ORISTUDIO_CP_LINE_STYLES) {
      for (const [color, slot] of [
        [MOUNTAIN, MOUNTAIN_DASH_SLOT],
        [VALLEY, VALLEY_DASH_SLOT],
        [UNASSIGNED, UNASSIGNED_DASH_SLOT],
      ] as const) {
        const actual = cpLineStyleDashSlot(style, color);
        // A style that draws this kind solid says so with slot 0; what it must
        // never do is hand the kind a slot belonging to a different kind.
        expect(actual === SOLID_DASH_SLOT || actual === slot).toBe(true);
      }
    }
  });

  it('leaves the solid styles solid apart from the undecided crease', () => {
    for (const style of ['color', 'black-white'] as const) {
      expect(cpLineStyleDashPatterns(style)).toEqual([
        [],
        [],
        ORISTUDIO_DASH_UNASSIGNED,
        ORISTUDIO_DASH_HINT,
      ]);
      for (const color of [MOUNTAIN, VALLEY, EDGE, AUX, OTHER]) {
        expect(cpLineStyleDashSlot(style, color)).toBe(SOLID_DASH_SLOT);
      }
    }
  });

  it('gives the hint slot the same pattern under every style, and no colour', () => {
    // It belongs to a second stroke over an undecided crease, not to a crease of
    // its own, so no line colour may resolve to it.
    for (const style of ORISTUDIO_CP_LINE_STYLES) {
      expect(cpLineStyleDashPatterns(style)[HINT_DASH_SLOT - 1]).toBe(ORISTUDIO_DASH_HINT);
      for (const color of [MOUNTAIN, VALLEY, EDGE, AUX, OTHER, UNASSIGNED]) {
        expect(cpLineStyleDashSlot(style, color)).not.toBe(HINT_DASH_SLOT);
      }
    }
  });
});

/**
 * The alternate dash exists to be drawn *over* the pattern it comes from, so the
 * property that matters is where its marks land — not what the run list looks
 * like. Both encodings are checked against the same measurement, because the two
 * consumers spell the phase shift differently (the shader has no phase; SVG has
 * nothing that draws a zero-length mark without a dot on it).
 */
describe('the alternate dash a hint paints on', () => {
  const BASE = ORISTUDIO_DASH_UNASSIGNED;
  const SPAN = 100;

  it('inks exactly the marks the original skips', () => {
    const base = shaderMarks(BASE, SPAN);
    const alternate = shaderMarks(ORISTUDIO_DASH_HINT, SPAN);
    // Every alternate mark is one of the base's, and they alternate: taking
    // every second base mark from the first skipped one reproduces it exactly.
    expect(alternate).toEqual(base.filter((_, index) => index % 2 === 1));
    expect(alternate.length).toBeGreaterThan(2);
  });

  it('reaches the same marks through the SVG phase', () => {
    const { array, offset } = alternateDashSvg(BASE);
    expect(svgMarks(array, offset, SPAN)).toEqual(shaderMarks(ORISTUDIO_DASH_HINT, SPAN));
  });

  it('leaves the two strokes covering the original between them', () => {
    // Nothing gained, nothing lost: a hinted crease is the same ink as an
    // unhinted one, in two colours instead of one.
    const grey = shaderMarks(BASE, SPAN).filter((_, index) => index % 2 === 0);
    const colored = shaderMarks(ORISTUDIO_DASH_HINT, SPAN);
    expect([...grey, ...colored].sort(byStart)).toEqual(shaderMarks(BASE, SPAN));
  });
});

type Mark = [number, number];
const byStart = (a: Mark, b: Mark) => a[0] - b[0];

/** The intervals a run list inks over `span`, read the way `strokeProgram` does. */
function shaderMarks(runs: readonly number[], span: number): Mark[] {
  const period = runs.reduce((sum, run) => sum + run, 0);
  const marks: Mark[] = [];
  for (let base = 0; base < span; base += period) {
    let at = base;
    for (let i = 0; i < runs.length; i += 2) {
      const mark = runs[i];
      if (mark > 0 && at + mark <= span) marks.push([at, at + mark]);
      at += mark + (runs[i + 1] ?? 0);
    }
  }
  return marks;
}

/** The same, read the way SVG reads `stroke-dasharray` + `stroke-dashoffset`. */
function svgMarks(array: readonly number[], offset: number, span: number): Mark[] {
  const period = array.reduce((sum, run) => sum + run, 0);
  // A positive dashoffset winds the pattern forward, so the path starts that far
  // into it — which is the same as starting the pattern `-offset` back.
  return shaderMarks(array, span + period)
    .map(([from, to]) => [from - offset, to - offset] as Mark)
    .filter(([from, to]) => from >= 0 && to <= span);
}

/**
 * `LineColor.NONE` is declared in Oriedita's enum and drawn by nothing in its
 * source, so there is no upstream row to match here — a crease that has not been
 * given a fold angle is an Ori Studio state. These are our rules for it, and the
 * reason they apply under every style is that the two monochrome ones give the
 * undecided crease a colour something else already owns.
 */
describe('the undecided crease, which Oriedita never draws', () => {
  it('dots under every line style', () => {
    for (const style of ORISTUDIO_CP_LINE_STYLES) {
      expect(cpLineStyleDashPattern(style, UNASSIGNED)).toEqual(ORISTUDIO_DASH_UNASSIGNED);
    }
  });

  it('keeps the ink each style already gave it', () => {
    // Unchanged by the dash: `color` and `color-and-shape` keep the unassigned
    // grey, `black-white` keeps it too (which is why it needs the dash — that is
    // the valley's grey as well), and the black-dot styles paint it as ink.
    expect(cpLineStyleInk('color', UNASSIGNED)).toBe('own');
    expect(cpLineStyleInk('color-and-shape', UNASSIGNED)).toBe('own');
    expect(cpLineStyleInk('black-white', UNASSIGNED)).toBe('own');
    expect(cpLineStyleInk('black-white', VALLEY)).toBe('grey');
    expect(cpLineStyleInk('black-one-dot', UNASSIGNED)).toBe('black');
    expect(cpLineStyleInk('black-two-dot', UNASSIGNED)).toBe('black');
  });

  it('is the only extra palette colour that dashes', () => {
    // `other` covers Oriedita's spare colours, which stay solid; only NONE is
    // split out of it.
    for (const style of ORISTUDIO_CP_LINE_STYLES) {
      for (const color of ['Orange4', 'Magenta5', 'Green6', 'Yellow7', OTHER, 'Other9', 'Grey10']) {
        expect(cpLineStyleDashSlot(style, color)).toBe(SOLID_DASH_SLOT);
      }
    }
  });

  it('reads apart from every pattern Oriedita puts on screen', () => {
    const period = (pattern: readonly number[]) => pattern.reduce((sum, run) => sum + run, 0);
    for (const pattern of [ORIEDITA_DASH_ONE_DOT, ORIEDITA_DASH_TWO_DOT, ORIEDITA_DASH_VALLEY]) {
      expect(period(ORISTUDIO_DASH_UNASSIGNED)).toBeLessThan(period(pattern));
      // Ink fraction: an undecided crease is the sparsest thing on the canvas.
      const inked = (p: readonly number[]) =>
        p.filter((_, i) => i % 2 === 0).reduce((sum, run) => sum + run, 0) / period(p);
      expect(inked(ORISTUDIO_DASH_UNASSIGNED)).toBeLessThan(inked(pattern));
    }
  });
});
