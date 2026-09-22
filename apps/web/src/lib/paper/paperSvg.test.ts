import { shadeColor } from '@treemaker/origami-simulator';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_PAGE, type PaperPage } from './paperPage';
import type { PaperLineWhole } from './paperScene';
import {
  FIXTURE_SHEET_PX,
  SQUARE,
  face,
  line,
  markup,
  sceneBoundsOf,
  sceneOf,
  sheetWithCrease,
} from './paperScene.fixtures';
import { DEFAULT_PAPER_STYLE, type PaperStyle, type Pen } from './paperStyle';
import { hexToUnitRgb } from './paperStyleResolve';
import {
  PT_PER_CSS_PX,
  PT_PER_MM,
  SEAM_STROKE_WIDTH_PT,
  centredDashOffset,
  erodeLine,
  erodeSegment,
  markupTransform,
  pageMarginPt,
  pagePtPerPx,
  paperFaceFill,
  paperSceneSvgBody,
  paperSceneToSvg,
  widestPenPt,
} from './paperSvg';

/**
 * A page with no margin asked for, so a scene px lands where the arithmetic
 * says, offset by {@link ROOM} — the stroke room a zero margin still keeps.
 */
const TIGHT: PaperPage = { ...DEFAULT_PAPER_PAGE, paddingMm: 0 };

/** Half the default edge pen (0.45 pt): the margin `TIGHT` actually gets. */
const ROOM = pageMarginPt(DEFAULT_PAPER_STYLE, TIGHT);

const paint = (scene = sheetWithCrease(), style = DEFAULT_PAPER_STYLE, page = TIGHT) =>
  paperSceneToSvg(scene, style, page);

/** Every `<tag …/>` element in the page, as its attribute map. */
function elements(
  svg: string,
  tag: 'line' | 'polygon' | 'path' | 'rect'
): Record<string, string>[] {
  const found: Record<string, string>[] = [];
  for (const match of svg.matchAll(new RegExp(`<${tag}\\s([^>]*)/>`, 'g'))) {
    const attrs: Record<string, string> = {};
    for (const attr of match[1]!.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[attr[1]!] = attr[2]!;
    found.push(attrs);
  }
  return found;
}

const lines = (svg: string) => elements(svg, 'line');
const polygons = (svg: string) => elements(svg, 'polygon');

function withPen(field: 'edges' | 'mountainFolds' | 'valleyFolds', pen: Partial<Pen>): PaperStyle {
  return { ...DEFAULT_PAPER_STYLE, [field]: { ...DEFAULT_PAPER_STYLE[field], ...pen } };
}

describe('the page', () => {
  it('is in points, as shown: 0.75 pt per scene px plus the margin on every side', () => {
    const { svg, widthPt, heightPt } = paint(
      sheetWithCrease(),
      DEFAULT_PAPER_STYLE,
      DEFAULT_PAPER_PAGE
    );
    const padding = 5 * PT_PER_MM;
    expect(widthPt).toBeCloseTo(FIXTURE_SHEET_PX * PT_PER_CSS_PX + padding * 2, 6);
    expect(heightPt).toBeCloseTo(widthPt, 6);
    expect(svg).toContain(`width="${widthPt.toFixed(2)}pt" height="${heightPt.toFixed(2)}pt"`);
    expect(svg).toContain(`viewBox="0 0 ${widthPt.toFixed(2)} ${heightPt.toFixed(2)}"`);
    // The artwork sits inside the margin.
    const [sheet] = polygons(svg);
    expect(sheet!.points.split(' ')[0]).toBe(`${padding.toFixed(2)},${padding.toFixed(2)}`);
  });

  it('scales the artwork to a sheet size in mm and leaves the pens alone', () => {
    const page: PaperPage = { ...TIGHT, sheet: { mm: 200 } };
    const scene = sheetWithCrease();
    expect(pagePtPerPx(scene, page)).toBeCloseTo((200 * PT_PER_MM) / FIXTURE_SHEET_PX, 9);
    const { svg, widthPt } = paint(scene, DEFAULT_PAPER_STYLE, page);
    expect(widthPt).toBeCloseTo(200 * PT_PER_MM + ROOM * 2, 6);
    const [crease] = lines(svg);
    expect(Number(crease!.x2)).toBeCloseTo(200 * PT_PER_MM + ROOM, 2);
    expect(crease!['stroke-width']).toBe(DEFAULT_PAPER_STYLE.mountainFolds.width.toFixed(2));
  });

  it('falls back to the screen ratio when the scene has no sheet to scale by', () => {
    expect(pagePtPerPx(sceneOf([], 0), { ...TIGHT, sheet: { mm: 200 } })).toBe(PT_PER_CSS_PX);
  });

  it('crops to the scene bounds, hidden included, so dropping them does not move the page', () => {
    const scene = sceneOf([
      face([SQUARE], { hidden: true }),
      face([
        [
          [10, 10],
          [20, 10],
          [20, 20],
          [10, 20],
        ],
      ]),
    ]);
    const kept = paint(scene, DEFAULT_PAPER_STYLE, TIGHT);
    const dropped = paint(scene, DEFAULT_PAPER_STYLE, { ...TIGHT, keepHiddenFaces: false });
    expect(dropped.widthPt).toBe(kept.widthPt);
    expect(polygons(kept.svg)).toHaveLength(2);
    expect(polygons(dropped.svg)).toHaveLength(1);
  });

  it('paints a background only when the page has one', () => {
    expect(elements(paint().svg, 'rect')).toHaveLength(0);
    const { svg, widthPt } = paint(sheetWithCrease(), DEFAULT_PAPER_STYLE, {
      ...TIGHT,
      background: '#ffffff',
    });
    const [ground] = elements(svg, 'rect');
    expect(ground).toMatchObject({ x: '0', y: '0', width: widthPt.toFixed(2), fill: '#ffffff' });
    expect(svg.indexOf('<rect')).toBeLessThan(svg.indexOf('<polygon'));
  });

  it('writes an empty scene as a margin-sized page', () => {
    const { svg, widthPt } = paint(sceneOf([]), DEFAULT_PAPER_STYLE, DEFAULT_PAPER_PAGE);
    expect(widthPt).toBeCloseTo(10 * PT_PER_MM, 6);
    expect(polygons(svg)).toHaveLength(0);
    expect(lines(svg)).toHaveLength(0);
  });

  it('leaves room for the stroke that straddles the artwork edge, whatever the margin', () => {
    // Re-pinned from the serializer's test of the same name: the crop is the
    // geometry's extent and a pen is centred on it, so a margin narrower than
    // half the widest pen would clip the outline's outer half.
    const wide = withPen('edges', { width: 3 });
    expect(widestPenPt(wide)).toBe(3);
    expect(pageMarginPt(wide, TIGHT)).toBe(1.5);
    expect(pageMarginPt(wide, { ...TIGHT, paddingMm: 0.2 })).toBe(1.5);
    expect(pageMarginPt(wide, DEFAULT_PAPER_PAGE)).toBeCloseTo(5 * PT_PER_MM, 9);
    expect(ROOM).toBeCloseTo(DEFAULT_PAPER_STYLE.edges.width / 2, 9);
    // The aux pen counts only when aux creases show.
    const aux = { ...DEFAULT_PAPER_STYLE, auxCreases: { visible: true, pen: { ...DEFAULT_PAPER_STYLE.auxCreases.pen, width: 4 } } };
    expect(widestPenPt(aux)).toBe(4);
    expect(widestPenPt({ ...aux, auxCreases: { ...aux.auxCreases, visible: false } })).toBeLessThan(4);
    const { svg, widthPt } = paint(sheetWithCrease(), wide, TIGHT);
    expect(widthPt).toBeCloseTo(FIXTURE_SHEET_PX * PT_PER_CSS_PX + 3, 6);
    const [sheet] = polygons(svg);
    expect(sheet!.points.split(' ')[0]).toBe('1.50,1.50');
  });

  it('writes every number with two decimals', () => {
    const { svg } = paint(sceneOf([line('edge', [1 / 3, 2 / 3], [10.005, 20])]));
    // Every numeric attribute of the artwork; the XML declaration's version is not one.
    const numbers = [...svg.matchAll(/ (?!version)[\w-]+="(-?\d+(?:\.\d+)?)(?:pt)?"/g)].map(
      (match) => match[1]!
    );
    expect(numbers.length).toBeGreaterThan(4);
    for (const text of numbers) expect(text).toMatch(/^-?\d+(\.\d{2})?$/);
  });

  // Moved from the simulator package's serializer tests, which went with it.
  it('is a well-formed standalone document', () => {
    const { svg } = paint();
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });
});

describe('faces', () => {
  it('fills a face with its side of the paper under its shade, seamed in the same ink', () => {
    const shade = 0.8;
    const scene = sceneOf([face([SQUARE], { side: 'back', shade })]);
    const [sheet] = polygons(paint(scene).svg);
    const want = paperFaceFill(DEFAULT_PAPER_STYLE, 'back', shade);
    const [r, g, b] = shadeColor(hexToUnitRgb(DEFAULT_PAPER_STYLE.paper.back), shade);
    const channel = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
    expect(want).toBe(`#${channel(r)}${channel(g)}${channel(b)}`);
    expect(sheet).toMatchObject({
      fill: want,
      stroke: want,
      'stroke-width': SEAM_STROKE_WIDTH_PT.toFixed(2),
    });
  });

  it('is the paper colour itself when unlit', () => {
    expect(paperFaceFill(DEFAULT_PAPER_STYLE, 'front', 1)).toBe(DEFAULT_PAPER_STYLE.paper.front);
    expect(paperFaceFill(DEFAULT_PAPER_STYLE, 'back', 1)).toBe(DEFAULT_PAPER_STYLE.paper.back);
  });

  it('writes a region with a hole as one even-odd path', () => {
    const hole: [number, number][] = [
      [25, 25],
      [25, 75],
      [75, 75],
      [75, 25],
    ];
    const { svg } = paint(sceneOf([face([SQUARE, hole])]));
    expect(polygons(svg)).toHaveLength(0);
    const [path] = elements(svg, 'path');
    expect(path!['fill-rule']).toBe('evenodd');
    const at = (px: number) => (px * PT_PER_CSS_PX + ROOM).toFixed(2);
    expect(path!.d).toBe(
      `M${at(0)},${at(0)}L${at(100)},${at(0)}L${at(100)},${at(100)}L${at(0)},${at(100)}Z` +
        `M${at(25)},${at(25)}L${at(25)},${at(75)}L${at(75)},${at(75)}L${at(75)},${at(25)}Z`
    );
    expect(path!.fill).toBe(DEFAULT_PAPER_STYLE.paper.front);
  });

  it('drops buried faces and the lines on them only when the page says so', () => {
    const scene = sceneOf([
      face([SQUARE], { hidden: true }),
      line('valley', [0, 10], [100, 10], { hidden: true }),
      face([SQUARE]),
      line('mountain', [0, 50], [100, 50]),
    ]);
    const kept = paint(scene).svg;
    expect(polygons(kept)).toHaveLength(2);
    expect(lines(kept).map((item) => item.stroke)).toEqual([
      DEFAULT_PAPER_STYLE.valleyFolds.color,
      DEFAULT_PAPER_STYLE.mountainFolds.color,
    ]);
    // In place: the buried face precedes the one that covers it.
    expect(kept.indexOf('<polygon')).toBeLessThan(kept.indexOf('<line'));
    const dropped = paint(scene, DEFAULT_PAPER_STYLE, { ...TIGHT, keepHiddenFaces: false }).svg;
    expect(polygons(dropped)).toHaveLength(1);
    expect(lines(dropped).map((item) => item.stroke)).toEqual([
      DEFAULT_PAPER_STYLE.mountainFolds.color,
    ]);
  });
});

describe('lines', () => {
  it('takes each role its pen: colour, width in pt and cap', () => {
    const style: PaperStyle = {
      ...withPen('edges', { width: 0.5, color: '#231f20', cap: 'round' }),
      mountainFolds: { width: 0.75, color: '#aa0000', dash: null, cap: 'butt' },
      valleyFolds: { width: 1.5, color: '#0000aa', dash: null, cap: 'round' },
    };
    const scene = sceneOf([
      line('edge', [0, 0], [100, 0]),
      line('mountain', [0, 10], [100, 10]),
      line('valley', [0, 20], [100, 20]),
    ]);
    expect(lines(paint(scene, style).svg)).toMatchObject([
      { stroke: '#231f20', 'stroke-width': '0.50', 'stroke-linecap': 'round' },
      { stroke: '#aa0000', 'stroke-width': '0.75', 'stroke-linecap': 'butt' },
      { stroke: '#0000aa', 'stroke-width': '1.50', 'stroke-linecap': 'round' },
    ]);
  });

  it('draws aux creases only when the style shows them', () => {
    const scene = sceneOf([face([SQUARE]), line('aux', [0, 30], [100, 30], { face: 0 })]);
    const hidden: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      auxCreases: { ...DEFAULT_PAPER_STYLE.auxCreases, visible: false },
    };
    expect(lines(paint(scene, hidden).svg)).toHaveLength(0);
    const shown: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      auxCreases: { ...DEFAULT_PAPER_STYLE.auxCreases, visible: true },
    };
    const [aux] = lines(paint(scene, shown).svg);
    expect(aux).toMatchObject({
      stroke: DEFAULT_PAPER_STYLE.auxCreases.pen.color,
      'stroke-width': DEFAULT_PAPER_STYLE.auxCreases.pen.width.toFixed(2),
    });
  });

  it('writes a solid pen with no dash attributes', () => {
    const [crease] = lines(paint().svg);
    expect(crease!['stroke-dasharray']).toBeUndefined();
    expect(crease!['stroke-dashoffset']).toBeUndefined();
  });

  it('writes a dash as multiples of the pen width, in pt', () => {
    const style = withPen('mountainFolds', { width: 0.75, dash: [8, 2, 1, 2] });
    const [crease] = lines(paint(sheetWithCrease(), style).svg);
    expect(crease!['stroke-dasharray']).toBe('6.00 1.50 0.75 1.50');
  });

  it('leaves a zero-length line out', () => {
    expect(lines(paint(sceneOf([line('edge', [5, 5], [5, 5])])).svg)).toHaveLength(0);
  });
});

describe('markup', () => {
  const symbols = '<path d="M0 0L10 10" stroke="#000000" stroke-width="1.4"/>';

  /** The `transform` of every group in the page, in order. */
  const groups = (svg: string) =>
    [...svg.matchAll(/<g transform="([^"]*)">([\s\S]*?)<\/g>/g)].map((match) => ({
      transform: match[1]!,
      inner: match[2]!,
    }));

  it('is placed after the faces and lines before it, scaled from scene px to the page', () => {
    const scene = sceneOf([face([SQUARE]), line('mountain', [0, 50], [100, 50]), markup(symbols)]);
    const { svg } = paint(scene);
    const [group] = groups(svg);
    // The lines' own projection: 0.75 pt per px, shifted by the margin.
    expect(group!.transform).toBe(`translate(${ROOM.toFixed(2)} ${ROOM.toFixed(2)}) scale(0.75)`);
    expect(group!.inner).toBe(symbols);
    expect(svg.indexOf('<g transform')).toBeGreaterThan(svg.indexOf('<line'));
  });

  it('keeps its place in the item order', () => {
    const scene = sceneOf([face([SQUARE]), markup(symbols), line('mountain', [0, 50], [100, 50])]);
    const { svg } = paint(scene);
    expect(svg.indexOf('<g transform')).toBeLessThan(svg.indexOf('<line'));
  });

  it('scales whole with a sheet size, and counts toward the page', () => {
    const page: PaperPage = { ...TIGHT, sheet: { mm: 200 } };
    const wide = markup(symbols, { minX: -20, minY: 0, maxX: 120, maxY: 100 });
    const scene = sceneOf([face([SQUARE]), line('mountain', [0, 50], [100, 50]), wide]);
    const ptPerPx = pagePtPerPx(scene, page);
    const { svg, widthPt } = paint(scene, DEFAULT_PAPER_STYLE, page);
    expect(sceneBoundsOf(scene.items).minX).toBe(-20);
    expect(widthPt).toBeCloseTo(140 * ptPerPx + ROOM * 2, 6);
    const [group] = groups(svg);
    const placed = /^translate\((\S+) (\S+)\) scale\((\S+)\)$/.exec(group!.transform)!;
    expect(Number(placed[1])).toBeCloseTo(20 * ptPerPx + ROOM, 2);
    expect(Number(placed[2])).toBeCloseTo(ROOM, 2);
    // Re-pinned against the lines rather than against the two-decimal string
    // the painter used to write: `ptPerPx` here is an arbitrary ratio, and a
    // scale rounded to a hundredth carries the far side of the sheet about
    // two points off the crease that ends there. The residue left is the
    // hundredth of a pt every coordinate on the page is written at.
    expect(Number(placed[3])).toBeCloseTo(ptPerPx, 9);
    const end = Number(lines(svg)[0]!.x2);
    expect(Math.abs(Number(placed[1]) + Number(placed[3]) * 100 - end)).toBeLessThan(0.02);
  });

  it('is never dropped as hidden, and is left out when empty', () => {
    const scene = sceneOf([face([SQUARE]), markup(symbols), markup('   ')]);
    const { svg } = paint(scene, DEFAULT_PAPER_STYLE, { ...TIGHT, keepHiddenFaces: false });
    expect(groups(svg)).toHaveLength(1);
  });

  it('goes through a body caller’s projection when it is a uniform scale and a shift', () => {
    const body = paperSceneSvgBody(sceneOf([markup(symbols)]), DEFAULT_PAPER_STYLE, {
      project: ([x, y]) => [x * 2 + 300, y * 2],
      unitsPerPt: 4 / 3,
      keepHiddenFaces: true,
    });
    expect(body).toBe(`  <g transform="translate(300.00 0.00) scale(2)">${symbols}</g>`);
  });

  it('refuses a projection that is not one, rather than misplacing the symbols', () => {
    expect(() => markupTransform(([x, y]) => [-x, y])).toThrow(/uniform scale/);
    expect(() => markupTransform(([x, y]) => [x * 2, y * 3])).toThrow(/uniform scale/);
    expect(() => markupTransform(([x, y]) => [y, x])).toThrow(/uniform scale/);
    expect(markupTransform(([x, y]) => [x * 0.75 + 5, y * 0.75 + 5])).toBe(
      'translate(5.00 5.00) scale(0.75)'
    );
  });
});

describe('centredDashOffset', () => {
  /** Where along the pattern the segment's midpoint lands, in [0, period). */
  function patternAtMidpoint(runs: number[], length: number): number {
    const sum = runs.reduce((total, run) => total + run, 0);
    const period = runs.length % 2 === 1 ? sum * 2 : sum;
    return (((length / 2 + centredDashOffset(runs, length)) % period) + period) % period;
  }

  it('lands the midpoint on the middle of the first run for an even number of periods', () => {
    const runs = [6, 1.5, 0.75, 1.5]; // period 9.75
    expect(patternAtMidpoint(runs, 9.75 * 4)).toBeCloseTo(3, 9);
    expect(patternAtMidpoint(runs, 9.75 * 4 + 2)).toBeCloseTo(3, 9);
  });

  it('and for an odd number of periods, where the naive half-remainder would not', () => {
    const runs = [6, 1.5, 0.75, 1.5];
    expect(patternAtMidpoint(runs, 9.75 * 3)).toBeCloseTo(3, 9);
    expect(patternAtMidpoint(runs, 9.75 * 3 + 5)).toBeCloseTo(3, 9);
    // A single-period segment, shorter than one pattern.
    expect(patternAtMidpoint(runs, 4)).toBeCloseTo(3, 9);
  });

  it('doubles the period of an odd-length list, as SVG does', () => {
    expect(patternAtMidpoint([3, 1, 1], 20)).toBeCloseTo(1.5, 9);
  });

  it('is written into the page, non-negative', () => {
    const style = withPen('mountainFolds', { width: 1, dash: [4, 2] });
    // The crease spans 100 px = 75 pt: 12.5 periods of 6 pt.
    const [crease] = lines(paint(sheetWithCrease(), style).svg);
    const offset = Number(crease!['stroke-dashoffset']);
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeCloseTo(centredDashOffset([4, 2], 75), 2);
    expect(((75 / 2 + offset) % 6) + 0).toBeCloseTo(2, 2);
  });

  it('is zero for a pattern with no ink', () => {
    expect(centredDashOffset([0, 0], 10)).toBe(0);
  });
});

describe('erode', () => {
  const erode = 0.05;
  const style: PaperStyle = { ...DEFAULT_PAPER_STYLE, erode };
  const distancePx = erode * FIXTURE_SHEET_PX;

  it('leaves an interior endpoint where it is and pulls a boundary one in by erode × sheet', () => {
    const scene = sceneOf([
      face([SQUARE]),
      line('mountain', [0, 50], [80, 50], { onBoundary: [true, false], face: 0 }),
    ]);
    const [crease] = lines(paint(scene, style).svg);
    expect(Number(crease!.x1)).toBeCloseTo(distancePx * PT_PER_CSS_PX + ROOM, 2);
    expect(Number(crease!.x2)).toBeCloseTo(80 * PT_PER_CSS_PX + ROOM, 2);
    expect(Number(crease!.y1)).toBeCloseTo(50 * PT_PER_CSS_PX + ROOM, 2);
  });

  it('pulls both ends when both lie on the boundary, along the segment', () => {
    const [a, b] = erodeSegment([0, 0], [30, 40], [true, true], 5)!;
    expect(a).toEqual([3, 4]);
    expect(b).toEqual([27, 36]);
  });

  it('is measured in scene px before the page scale, so a sheet size does not change it', () => {
    const page: PaperPage = { ...TIGHT, sheet: { mm: 400 } };
    const ptPerPx = pagePtPerPx(sheetWithCrease(), page);
    const [crease] = lines(paint(sheetWithCrease(), style, page).svg);
    expect(Number(crease!.x1)).toBeCloseTo(distancePx * ptPerPx + ROOM, 2);
  });

  it('drops a segment the pull would invert', () => {
    // Shorter than twice the pull: the ends would cross the midpoint.
    const short = sceneOf([line('valley', [0, 0], [9, 0], { onBoundary: [true, true] })]);
    expect(lines(paint(short, style).svg)).toHaveLength(0);
    // Even one pulled end inverts a segment shorter than twice the pull.
    const oneEnd = sceneOf([line('valley', [0, 0], [9, 0], { onBoundary: [true, false] })]);
    expect(lines(paint(oneEnd, style).svg)).toHaveLength(0);
    expect(erodeSegment([0, 0], [10, 0], [true, true], 5)).toBeNull();
    expect(erodeSegment([0, 0], [11, 0], [true, true], 5)).not.toBeNull();
  });

  it('erodes a cut piece on its whole crease, as the edge shader and the canvas do', () => {
    // A 40 px crease flagged at both ends, cut 10 px from its start by another
    // face's plane. On its own length the first piece (10 px, 8 px pull) would
    // collapse; on the crease it keeps the 2 px past the pull, as the shader's
    // ribbon does. The second piece does not own the far end but still gives
    // it up. `erodePx` is the 8 px here.
    const whole: PaperLineWhole = { a: [0, 0], b: [40, 0], onBoundary: [true, true] };
    const first = line('mountain', [0, 0], [10, 0], { onBoundary: [true, false], whole });
    const second = line('mountain', [10, 0], [40, 0], { onBoundary: [false, true], whole });
    expect(erodeLine(first, 8)).toEqual([
      [8, 0],
      [10, 0],
    ]);
    expect(erodeLine(second, 8)).toEqual([
      [10, 0],
      [32, 0],
    ]);
    // A cut inside the pulled-off end: the first piece goes, and the second
    // loses the rest of the pull though it owns neither end of the crease.
    const inside = line('mountain', [0, 0], [5, 0], { onBoundary: [true, false], whole });
    const rest = line('mountain', [5, 0], [40, 0], { onBoundary: [false, true], whole });
    expect(erodeLine(inside, 8)).toBeNull();
    expect(erodeLine(rest, 8)).toEqual([
      [8, 0],
      [32, 0],
    ]);
    // A piece whose crease collapses goes with it.
    expect(erodeLine(first, 20)).toBeNull();
    // Reversed pieces keep their direction.
    const backwards = line('mountain', [40, 0], [10, 0], { onBoundary: [true, false], whole });
    expect(erodeLine(backwards, 8)).toEqual([
      [32, 0],
      [10, 0],
    ]);
    // And at zero, or with no crease to measure on, the piece is its own.
    expect(erodeLine(first, 0)).toEqual([
      [0, 0],
      [10, 0],
    ]);
    expect(erodeLine(line('mountain', [0, 0], [10, 0], { onBoundary: [true, false] }), 8)).toBeNull();
  });

  it('draws a cut piece by its crease’s erosion on the page', () => {
    const whole: PaperLineWhole = { a: [0, 50], b: [80, 50], onBoundary: [true, false] };
    const scene = sceneOf([
      face([SQUARE]),
      line('mountain', [0, 50], [10, 50], { onBoundary: [true, false], whole, face: 0 }),
      line('mountain', [10, 50], [80, 50], { onBoundary: [false, false], whole, face: 0 }),
    ]);
    // The pull is 5 px on the fixture sheet: on its own 10 px the first piece
    // would collapse exactly; on the crease it keeps 5 px past the pull.
    expect(distancePx).toBe(5);
    const [stub, rest] = lines(paint(scene, style).svg);
    expect(Number(stub!.x1)).toBeCloseTo(distancePx * PT_PER_CSS_PX + ROOM, 2);
    expect(Number(stub!.x2)).toBeCloseTo(10 * PT_PER_CSS_PX + ROOM, 2);
    expect(Number(rest!.x1)).toBeCloseTo(10 * PT_PER_CSS_PX + ROOM, 2);
    expect(Number(rest!.x2)).toBeCloseTo(80 * PT_PER_CSS_PX + ROOM, 2);
  });

  it('does nothing at zero, and never touches an edge line', () => {
    const scene = sceneOf([
      line('edge', [0, 0], [100, 0], { onBoundary: [false, false] }),
      line('mountain', [0, 50], [100, 50], { onBoundary: [true, true] }),
    ]);
    const span = { x1: ROOM.toFixed(2), x2: (75 + ROOM).toFixed(2) };
    const [edge, crease] = lines(paint(scene).svg);
    expect(edge).toMatchObject(span);
    expect(crease).toMatchObject(span);
    const [erodedEdge] = lines(paint(scene, style).svg);
    expect(erodedEdge).toMatchObject(span);
  });
});

describe('paperSceneSvgBody', () => {
  /** A page in px at twice the scene, shifted right: the crease-pattern export's shape. */
  const project = ([x, y]: [number, number]): [number, number] => [x * 2 + 300, y * 2];
  const body = (scene = sheetWithCrease(), style = DEFAULT_PAPER_STYLE, keepHiddenFaces = true) =>
    paperSceneSvgBody(scene, style, { project, unitsPerPt: 4 / 3, keepHiddenFaces });

  it('writes the elements alone, at the caller’s projection, with no wrapper', () => {
    const svg = body();
    expect(svg).not.toContain('<svg');
    expect(svg).not.toContain('<g');
    expect(svg).not.toContain('<rect');
    const [sheet] = polygons(svg);
    expect(sheet!.points.split(' ')[0]).toBe('300.00,0.00');
    expect(sheet!.points.split(' ')[2]).toBe('500.00,200.00');
    const [crease] = lines(svg);
    expect(crease).toMatchObject({ x1: '300.00', y1: '100.00', x2: '500.00', y2: '100.00' });
  });

  it('draws each pen and the seam at the page’s units per pt, dashes included', () => {
    const style = withPen('mountainFolds', { width: 0.75, dash: [8, 2, 1, 2] });
    const svg = body(sheetWithCrease(), style);
    expect(polygons(svg)[0]!['stroke-width']).toBe(((SEAM_STROKE_WIDTH_PT * 4) / 3).toFixed(2));
    const [crease] = lines(svg);
    expect(crease!['stroke-width']).toBe('1.00');
    expect(crease!['stroke-dasharray']).toBe('8.00 2.00 1.00 2.00');
    // The page painter is the same elements at one unit per pt.
    const page = paperSceneToSvg(sheetWithCrease(), style, TIGHT).svg;
    expect(lines(page)[0]!['stroke-width']).toBe('0.75');
  });

  it('erodes in scene px before the projection, and keeps or drops hidden pieces as asked', () => {
    const style: PaperStyle = { ...DEFAULT_PAPER_STYLE, erode: 0.05 };
    const scene = sceneOf([
      face([SQUARE], { hidden: true }),
      face([SQUARE]),
      line('mountain', [0, 50], [100, 50], { onBoundary: [true, true], face: 0 }),
    ]);
    const [crease] = lines(body(scene, style));
    // 5 scene px in, then doubled and shifted by the projection.
    expect(crease).toMatchObject({ x1: '310.00', x2: '490.00' });
    expect(polygons(body(scene, style))).toHaveLength(2);
    expect(polygons(body(scene, style, false))).toHaveLength(1);
  });
});
