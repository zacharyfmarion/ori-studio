import { shadeColor } from '@treemaker/origami-simulator';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_PAGE, type PaperPage } from './paperPage';
import {
  FIXTURE_SHEET_PX,
  SQUARE,
  face,
  line,
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
  erodeSegment,
  pageMarginPt,
  pagePtPerPx,
  paperFaceFill,
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
    expect(lines(paint(scene).svg)).toHaveLength(0);
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
