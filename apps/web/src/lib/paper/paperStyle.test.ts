import { describe, expect, it } from 'vitest';
import { ORIEDITA_DASH_ONE_DOT, ORIEDITA_DASH_VALLEY } from '../oristudioCpLineStyle';
import {
  DEFAULT_MOUNTAIN_COLOR,
  DEFAULT_PAPER_STYLE,
  DEFAULT_VALLEY_COLOR,
  ORIEDITA_MOUNTAIN_DASH_MULTIPLES,
  ORIEDITA_VALLEY_DASH_MULTIPLES,
  PAPER_CREASE_STYLES,
  PAPER_STYLE_FIELDS,
  PEN_WIDTH_RANGE,
  applyCreaseStyle,
  creaseStyleOf,
  cssPxToPt,
  effectivePaperStyle,
  getPaperStyleField,
  hasPaperStyleOverrides,
  normalizePaperStyle,
  normalizePaperStyleOverrides,
  parseDash,
  parsePen,
  ptToDevicePx,
  setPaperStyleField,
  type PaperStyle,
  type PaperStyleOverrides,
  type Pen,
  paperStyleEquals,
  paperStyleValueEquals,
  withPaperStyleOverride,
} from './paperStyle';

const RED_PEN: Pen = {
  width: 1.5,
  color: '#ff0000',
  dash: [4, 2],
  cap: 'round',
};

describe('units', () => {
  it('draws a pt at 4/3 CSS px times the device pixel ratio', () => {
    expect(ptToDevicePx(0.75, 1)).toBeCloseTo(1, 12);
    expect(ptToDevicePx(0.9, 2)).toBeCloseTo(2.4, 12);
    expect(cssPxToPt(1.1)).toBeCloseTo(0.825, 12);
  });

  it('states the legacy px widths as the default pens', () => {
    // The folded figure's 1.2 px edge and the simulator's 1.1 px crease.
    expect(ptToDevicePx(DEFAULT_PAPER_STYLE.edges.width, 1)).toBeCloseTo(1.2, 12);
    expect(ptToDevicePx(DEFAULT_PAPER_STYLE.mountainFolds.width, 1)).toBeCloseTo(1.1, 12);
    expect(ptToDevicePx(DEFAULT_PAPER_STYLE.valleyFolds.width, 1)).toBeCloseTo(1.1, 12);
  });
});

describe('normalizePaperStyle', () => {
  it('round-trips a complete style through JSON', () => {
    const style: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      paper: { front: '#123456', back: '#abcdef' },
      mountainFolds: RED_PEN,
      auxCreases: { visible: true, pen: { ...RED_PEN, dash: null } },
      erode: 0.02,
      light: { enabled: false, azimuth: 90, elevation: 30 },
    };
    expect(normalizePaperStyle(JSON.parse(JSON.stringify(style)))).toEqual(style);
  });

  it('is the default for anything that is not an object', () => {
    expect(normalizePaperStyle(undefined)).toBe(DEFAULT_PAPER_STYLE);
    expect(normalizePaperStyle(null)).toBe(DEFAULT_PAPER_STYLE);
    expect(normalizePaperStyle('style')).toBe(DEFAULT_PAPER_STYLE);
    expect(normalizePaperStyle({})).toEqual(DEFAULT_PAPER_STYLE);
  });

  it('rejects a colour that is not six-digit hex, per field', () => {
    const style = normalizePaperStyle({
      paper: { front: '#fff', back: '#ABCDEF' },
      edges: { ...RED_PEN, color: 'red' },
    });
    expect(style.paper.front).toBe(DEFAULT_PAPER_STYLE.paper.front);
    // Case is folded, not rejected: the picker and a hand-edited file agree.
    expect(style.paper.back).toBe('#abcdef');
    // A pen with a bad colour is rejected whole, not patched.
    expect(style.edges).toEqual(DEFAULT_PAPER_STYLE.edges);
  });

  it('rejects a width that is not a positive finite number and clamps the range', () => {
    expect(normalizePaperStyle({ edges: { ...RED_PEN, width: 0 } }).edges).toEqual(
      DEFAULT_PAPER_STYLE.edges
    );
    expect(normalizePaperStyle({ edges: { ...RED_PEN, width: '1' } }).edges).toEqual(
      DEFAULT_PAPER_STYLE.edges
    );
    expect(normalizePaperStyle({ edges: { ...RED_PEN, width: Number.NaN } }).edges).toEqual(
      DEFAULT_PAPER_STYLE.edges
    );
    expect(normalizePaperStyle({ edges: { ...RED_PEN, width: 100 } }).edges.width).toBe(
      PEN_WIDTH_RANGE.max
    );
  });

  it('lets a hand-written pen omit dash and cap, but not carry bad ones', () => {
    expect(parsePen({ width: 0.75, color: '#000000' })).toEqual({
      width: 0.75,
      color: '#000000',
      dash: null,
      cap: 'butt',
    });
    expect(parsePen({ width: 0.75, color: '#000000', cap: 'square' })).toBeUndefined();
    expect(parsePen({ width: 0.75, color: '#000000', dash: '4 2' })).toBeUndefined();
    expect(parsePen({ width: 0.75, color: '#000000', dash: [4, -2] })).toBeUndefined();
    expect(parsePen({ width: 0.75, color: '#000000', dash: [0, 0] })).toBeUndefined();
  });

  it('reads an empty dash as solid', () => {
    expect(parseDash([])).toBeNull();
    expect(parseDash(null)).toBeNull();
    expect(parseDash([1, 2])).toEqual([1, 2]);
  });

  it('clamps erode and elevation, wraps azimuth, and rejects a partial light', () => {
    const style = normalizePaperStyle({
      erode: 5,
      light: { enabled: true, azimuth: -30, elevation: 120 },
    });
    expect(style.erode).toBe(0.25);
    expect(style.light).toEqual({ enabled: true, azimuth: 330, elevation: 90 });
    expect(normalizePaperStyle({ erode: -1 }).erode).toBe(0);
    expect(normalizePaperStyle({ light: { enabled: true } }).light).toEqual(
      DEFAULT_PAPER_STYLE.light
    );
    expect(
      normalizePaperStyle({
        light: { enabled: 'yes', azimuth: 0, elevation: 0 },
      }).light
    ).toEqual(DEFAULT_PAPER_STYLE.light);
  });

  it('takes a valid pen inside an otherwise broken aux record', () => {
    const style = normalizePaperStyle({
      auxCreases: { visible: 'no', pen: RED_PEN },
    });
    // A non-boolean falls back to the default, which shows aux creases.
    expect(style.auxCreases.visible).toBe(true);
    expect(style.auxCreases.pen).toEqual(RED_PEN);
  });
});

describe('field access', () => {
  it('reads and writes every field without mutating the input', () => {
    for (const field of PAPER_STYLE_FIELDS) {
      const value = getPaperStyleField(DEFAULT_PAPER_STYLE, field);
      expect(value).toBeDefined();
      const next = setPaperStyleField(DEFAULT_PAPER_STYLE, field, value);
      expect(next).toEqual(DEFAULT_PAPER_STYLE);
      expect(next).not.toBe(DEFAULT_PAPER_STYLE);
    }
  });

  it('addresses a nested field on its own', () => {
    const next = setPaperStyleField(DEFAULT_PAPER_STYLE, 'paper.front', '#ffffff');
    expect(next.paper).toEqual({
      front: '#ffffff',
      back: DEFAULT_PAPER_STYLE.paper.back,
    });
    expect(getPaperStyleField(next, 'paper.front')).toBe('#ffffff');
    const aux = setPaperStyleField(DEFAULT_PAPER_STYLE, 'auxCreases.visible', true);
    expect(aux.auxCreases).toEqual({
      visible: true,
      pen: DEFAULT_PAPER_STYLE.auxCreases.pen,
    });
  });
});

describe('overrides', () => {
  it('apply on top of the base and leave the rest following', () => {
    const overrides: PaperStyleOverrides = {
      'paper.front': '#ffffff',
      edges: RED_PEN,
    };
    const effective = effectivePaperStyle(DEFAULT_PAPER_STYLE, overrides);
    expect(effective.paper.front).toBe('#ffffff');
    expect(effective.paper.back).toBe(DEFAULT_PAPER_STYLE.paper.back);
    expect(effective.edges).toBe(RED_PEN);
    expect(effective.mountainFolds).toBe(DEFAULT_PAPER_STYLE.mountainFolds);
  });

  it('is the base itself with nothing to apply', () => {
    expect(effectivePaperStyle(DEFAULT_PAPER_STYLE)).toBe(DEFAULT_PAPER_STYLE);
    expect(effectivePaperStyle(DEFAULT_PAPER_STYLE, {})).toBe(DEFAULT_PAPER_STYLE);
    expect(hasPaperStyleOverrides({})).toBe(false);
    expect(hasPaperStyleOverrides(undefined)).toBe(false);
    expect(hasPaperStyleOverrides({ erode: 0 })).toBe(true);
  });

  it('normalises by dropping unknown keys and malformed values, never defaulting', () => {
    const overrides = normalizePaperStyleOverrides({
      'paper.front': '#ffffff',
      'paper.back': 'white',
      edges: { width: -1, color: '#000000' },
      erode: 0.01,
      shadow: true,
      light: null,
    });
    expect(overrides).toEqual({ 'paper.front': '#ffffff', erode: 0.01 });
    expect(normalizePaperStyleOverrides(null)).toEqual({});
    expect(normalizePaperStyleOverrides([1, 2])).toEqual({});
  });
});

describe('crease-style switch', () => {
  it('reads the defaults as colour', () => {
    expect(creaseStyleOf(DEFAULT_PAPER_STYLE)).toBe('color');
  });

  it('round-trips every mode', () => {
    for (const mode of PAPER_CREASE_STYLES) {
      const style = applyCreaseStyle(DEFAULT_PAPER_STYLE, mode);
      expect(creaseStyleOf(style)).toBe(mode);
      // Width and cap belong to the pen, not the switch.
      expect(style.mountainFolds.width).toBe(DEFAULT_PAPER_STYLE.mountainFolds.width);
      expect(style.valleyFolds.cap).toBe(DEFAULT_PAPER_STYLE.valleyFolds.cap);
    }
  });

  it('writes the convention inks for colour and the edge ink for mono', () => {
    const edges: Pen = { ...DEFAULT_PAPER_STYLE.edges, color: '#336699' };
    const base = { ...DEFAULT_PAPER_STYLE, edges };
    const mono = applyCreaseStyle(base, 'mono');
    expect(mono.mountainFolds.color).toBe('#336699');
    expect(mono.valleyFolds.color).toBe('#336699');
    expect(mono.mountainFolds.dash).toBeNull();
    const color = applyCreaseStyle(mono, 'color');
    expect(color.mountainFolds.color).toBe(DEFAULT_MOUNTAIN_COLOR);
    expect(color.valleyFolds.color).toBe(DEFAULT_VALLEY_COLOR);
  });

  it('writes Oriedita’s dashes as multiples of the pen width', () => {
    const dashed = applyCreaseStyle(DEFAULT_PAPER_STYLE, 'mono-dashed');
    expect(dashed.mountainFolds.dash).toEqual(ORIEDITA_MOUNTAIN_DASH_MULTIPLES);
    expect(dashed.valleyFolds.dash).toEqual(ORIEDITA_VALLEY_DASH_MULTIPLES);
    // At the default 0.825 pt (1.1 px) pen the multiples times the CSS-px width
    // are exactly Oriedita's device-px runs.
    const px = ptToDevicePx(DEFAULT_PAPER_STYLE.mountainFolds.width, 1);
    expect(dashed.mountainFolds.dash!.map((run) => run * px)).toEqual(
      ORIEDITA_DASH_ONE_DOT.map((run) => expect.closeTo(run, 9))
    );
    expect(dashed.valleyFolds.dash!.map((run) => run * px)).toEqual(
      ORIEDITA_DASH_VALLEY.map((run) => expect.closeTo(run, 9))
    );
  });

  // Re-pinned: the switch used to store Oriedita's runs over the pen's width
  // at the time and read them back over its current width, so a weight change
  // turned mono-dashed into custom. The multiples are now fixed constants.
  it('round-trips mono-dashed at any pen weight, and the weight leaves the dash alone', () => {
    const dashed = applyCreaseStyle(DEFAULT_PAPER_STYLE, 'mono-dashed');
    for (const width of [0.5, DEFAULT_PAPER_STYLE.mountainFolds.width, 2]) {
      const weighted = {
        ...DEFAULT_PAPER_STYLE,
        mountainFolds: { ...DEFAULT_PAPER_STYLE.mountainFolds, width },
        valleyFolds: { ...DEFAULT_PAPER_STYLE.valleyFolds, width },
      };
      // Switched at this weight: the same multiples as at the default.
      const switched = applyCreaseStyle(weighted, 'mono-dashed');
      expect(switched.mountainFolds.dash).toEqual(dashed.mountainFolds.dash);
      expect(switched.valleyFolds.dash).toEqual(dashed.valleyFolds.dash);
      expect(creaseStyleOf(switched)).toBe('mono-dashed');
      // Switched at the default and moved to this weight afterwards: still the switch.
      const moved = {
        ...dashed,
        mountainFolds: { ...dashed.mountainFolds, width },
        valleyFolds: { ...dashed.valleyFolds, width },
      };
      expect(creaseStyleOf(moved)).toBe('mono-dashed');
      // A wider pen dashes proportionally longer: the multiples are of its width.
      const px = ptToDevicePx(width, 1);
      expect(moved.mountainFolds.dash!.map((run) => run * px)).toEqual(
        ORIEDITA_DASH_ONE_DOT.map((run) =>
          expect.closeTo((run * width) / DEFAULT_PAPER_STYLE.mountainFolds.width, 9)
        )
      );
    }
  });

  it('reads a dash written to six decimals as the switch', () => {
    const dashed = applyCreaseStyle(DEFAULT_PAPER_STYLE, 'mono-dashed');
    const rounded = (dash: number[] | null) => dash!.map((run) => Number(run.toFixed(6)));
    expect(
      creaseStyleOf({
        ...dashed,
        mountainFolds: {
          ...dashed.mountainFolds,
          dash: rounded(dashed.mountainFolds.dash),
        },
        valleyFolds: {
          ...dashed.valleyFolds,
          dash: rounded(dashed.valleyFolds.dash),
        },
      })
    ).toBe('mono-dashed');
  });

  it('reports anything else as custom', () => {
    expect(creaseStyleOf({ ...DEFAULT_PAPER_STYLE, mountainFolds: RED_PEN })).toBe('custom');
    const mono = applyCreaseStyle(DEFAULT_PAPER_STYLE, 'mono');
    expect(
      creaseStyleOf({
        ...mono,
        valleyFolds: { ...mono.valleyFolds, dash: [1, 2] },
      })
    ).toBe('custom');
  });
});

describe('withPaperStyleOverride', () => {
  it('pins a field, clears it with undefined, and never mutates its input', () => {
    const one = withPaperStyleOverride(undefined, 'paper.front', '#ff0000');
    expect(one).toEqual({ 'paper.front': '#ff0000' });
    const two = withPaperStyleOverride(one, 'edges', RED_PEN);
    expect(two).toEqual({ 'paper.front': '#ff0000', edges: RED_PEN });
    expect(one).toEqual({ 'paper.front': '#ff0000' });
    expect(withPaperStyleOverride(two, 'edges', undefined)).toEqual({
      'paper.front': '#ff0000',
    });
  });

  it('hands back the same record when nothing would change', () => {
    const overrides = { edges: RED_PEN };
    expect(withPaperStyleOverride(overrides, 'edges', { ...RED_PEN, dash: [4, 2] })).toBe(
      overrides
    );
    expect(withPaperStyleOverride(overrides, 'erode', undefined)).toBe(overrides);
    expect(withPaperStyleOverride(undefined, 'erode', undefined)).toBeUndefined();
  });

  it('is undefined once the last override goes, so a file can leave it off', () => {
    expect(withPaperStyleOverride({ erode: 0.1 }, 'erode', undefined)).toBeUndefined();
  });

  it('compares values structurally', () => {
    expect(paperStyleValueEquals(RED_PEN, { ...RED_PEN })).toBe(true);
    expect(paperStyleValueEquals(RED_PEN, { ...RED_PEN, dash: null })).toBe(false);
    expect(paperStyleValueEquals(RED_PEN, { ...RED_PEN, cap: 'butt' })).toBe(false);
    expect(
      paperStyleValueEquals(DEFAULT_PAPER_STYLE.light, {
        ...DEFAULT_PAPER_STYLE.light,
      })
    ).toBe(true);
    expect(paperStyleValueEquals(0.1, 0.1)).toBe(true);
    expect(paperStyleValueEquals(0.1, undefined)).toBe(false);
  });

  it('compares whole styles field by field', () => {
    expect(paperStyleEquals(DEFAULT_PAPER_STYLE, { ...DEFAULT_PAPER_STYLE })).toBe(true);
    expect(
      paperStyleEquals(DEFAULT_PAPER_STYLE, {
        ...DEFAULT_PAPER_STYLE,
        arrows: { ...DEFAULT_PAPER_STYLE.arrows, dash: [1, 2] },
      })
    ).toBe(false);
  });
});
