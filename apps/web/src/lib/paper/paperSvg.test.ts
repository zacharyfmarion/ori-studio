import { shadeColor } from '@treemaker/origami-simulator';
import { describe, expect, it } from 'vitest';
import type { PaperPage } from './paperPage';
import type { PaperLineWhole, ScenePoint } from './paperScene';
import {
  FIXTURE_PAGE,
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
import { builtInPaperPreset } from './paperPresets';
import { hexToUnitRgb, PAPER_STYLE_POLICIES, surfacePaperStyle } from './paperStyleResolve';
import {
  PT_PER_CSS_PX,
  PT_PER_MM,
  SEAM_STROKE_WIDTH_PT,
  centredDashOffset,
  erodeLine,
  erodeSegment,
  faceOutlineLines,
  markupTransform,
  mmToCssPx,
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
const TIGHT: PaperPage = { ...FIXTURE_PAGE, paddingMm: 0 };

/** Half the default edge pen (0.45 pt): the margin `TIGHT` actually gets. */
const ROOM = pageMarginPt(DEFAULT_PAPER_STYLE, TIGHT);

const paint = (scene = sheetWithCrease(), style = DEFAULT_PAPER_STYLE, page = TIGHT) =>
  paperSceneToSvg(scene, style, page);

/** Every `<tag …/>` element in the page, as its attribute map. */
function elements(
  svg: string,
  tag: 'line' | 'path' | 'rect' | 'circle'
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
/** The faces: every one is a `<path>` (none of these scenes carries markup). */
const faces = (svg: string) => elements(svg, 'path');
/** A one-ring face path's corners, as `x,y` text. */
const corners = (d: string) => d.replace(/^M/, '').replace(/Z$/, '').split('L');

function withPen(field: 'edges' | 'mountainFolds' | 'valleyFolds', pen: Partial<Pen>): PaperStyle {
  return { ...DEFAULT_PAPER_STYLE, [field]: { ...DEFAULT_PAPER_STYLE[field], ...pen } };
}

describe('the page', () => {
  it('is in points: the size asked for plus the margin on every side', () => {
    const { svg, widthPt, heightPt } = paint(sheetWithCrease(), DEFAULT_PAPER_STYLE, FIXTURE_PAGE);
    const padding = 5 * PT_PER_MM;
    expect(widthPt).toBeCloseTo(FIXTURE_SHEET_PX * PT_PER_CSS_PX + padding * 2, 6);
    expect(heightPt).toBeCloseTo(widthPt, 6);
    expect(svg).toContain(`width="${widthPt.toFixed(2)}pt" height="${heightPt.toFixed(2)}pt"`);
    expect(svg).toContain(`viewBox="0 0 ${widthPt.toFixed(2)} ${heightPt.toFixed(2)}"`);
    // The artwork sits inside the margin.
    const [sheet] = faces(svg);
    expect(corners(sheet!.d!)[0]).toBe(`${padding.toFixed(2)},${padding.toFixed(2)}`);
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

  // A folded figure's or a simulation's sheet is not in its picture: its size
  // is the drawing's own longer side, whatever sheet it was folded from.
  it('scales a figure by its own longer side when the size measures the figure', () => {
    const page: PaperPage = { ...TIGHT, sheet: { mm: 50 } };
    const scene = { ...sceneOf([], 400), bounds: { minX: 10, minY: 20, maxX: 130, maxY: 80 } };
    expect(pagePtPerPx(scene, page, 'figure')).toBeCloseTo((50 * PT_PER_MM) / 120, 9);
    expect(pagePtPerPx(scene, page, 'sheet')).toBeCloseTo((50 * PT_PER_MM) / 400, 9);
    const { widthPt, heightPt } = paperSceneToSvg(scene, DEFAULT_PAPER_STYLE, page, 'figure');
    expect(widthPt - 2 * pageMarginPt(DEFAULT_PAPER_STYLE, page)).toBeCloseTo(50 * PT_PER_MM, 6);
    expect(heightPt - 2 * pageMarginPt(DEFAULT_PAPER_STYLE, page)).toBeCloseTo(25 * PT_PER_MM, 6);
  });

  it('falls back to the screen ratio when the scene has no sheet to scale by', () => {
    expect(pagePtPerPx(sceneOf([], 0), { ...TIGHT, sheet: { mm: 200 } })).toBe(PT_PER_CSS_PX);
  });

  it('measures a length in mm as the scene px that span it at the screen’s ratio', () => {
    // An inch is 96 CSS px.
    expect(mmToCssPx(25.4)).toBeCloseTo(96, 9);
    // A scene whose sheet is that long is painted at the screen's ratio at
    // that sheet size, so what it sizes in CSS px keeps its size on the page.
    const page: PaperPage = { ...TIGHT, sheet: { mm: 41 } };
    expect(pagePtPerPx(sceneOf([], mmToCssPx(41)), page)).toBeCloseTo(PT_PER_CSS_PX, 12);
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
    expect(faces(kept.svg)).toHaveLength(2);
    expect(faces(dropped.svg)).toHaveLength(1);
  });

  it('paints a background only when the page has one', () => {
    expect(elements(paint().svg, 'rect')).toHaveLength(0);
    const { svg, widthPt } = paint(sheetWithCrease(), DEFAULT_PAPER_STYLE, {
      ...TIGHT,
      background: '#ffffff',
    });
    const [ground] = elements(svg, 'rect');
    expect(ground).toMatchObject({ x: '0', y: '0', width: widthPt.toFixed(2), fill: '#ffffff' });
    expect(svg.indexOf('<rect')).toBeLessThan(svg.indexOf('<path'));
  });

  it('writes an empty scene as a margin-sized page', () => {
    const { svg, widthPt } = paint(sceneOf([]), DEFAULT_PAPER_STYLE, FIXTURE_PAGE);
    expect(widthPt).toBeCloseTo(10 * PT_PER_MM, 6);
    expect(faces(svg)).toHaveLength(0);
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
    expect(pageMarginPt(wide, FIXTURE_PAGE)).toBeCloseTo(5 * PT_PER_MM, 9);
    expect(ROOM).toBeCloseTo(DEFAULT_PAPER_STYLE.edges.width / 2, 9);
    // The aux pen counts only when aux creases show.
    const aux = { ...DEFAULT_PAPER_STYLE, auxCreases: { visible: true, pen: { ...DEFAULT_PAPER_STYLE.auxCreases.pen, width: 4 } } };
    expect(widestPenPt(aux)).toBe(4);
    expect(widestPenPt({ ...aux, auxCreases: { ...aux.auxCreases, visible: false } })).toBeLessThan(4);
    // And the diagram-crease pens, which a step's page draws its fold in.
    const diagram = withPen('edges', { width: 0.1 });
    expect(widestPenPt({ ...diagram, mountainDiagramCreases: { ...diagram.mountainDiagramCreases, width: 5 } })).toBe(5);
    expect(widestPenPt({ ...diagram, valleyDiagramCreases: { ...diagram.valleyDiagramCreases, width: 6 } })).toBe(6);
    const { svg, widthPt } = paint(sheetWithCrease(), wide, TIGHT);
    expect(widthPt).toBeCloseTo(FIXTURE_SHEET_PX * PT_PER_CSS_PX + 3, 6);
    const [sheet] = faces(svg);
    expect(corners(sheet!.d!)[0]).toBe('1.50,1.50');
  });

  it('measures a surface by the pens it draws with, not by the diagram creases it never draws', () => {
    // The Diagram preset: 0.5 pt edges, 0.25 pt folds, 0.75 pt diagram
    // creases. Neither surface draws a diagram crease, so its edges are the
    // widest pen either has.
    const diagram = builtInPaperPreset('diagram').style;
    expect(widestPenPt(surfacePaperStyle(diagram, PAPER_STYLE_POLICIES['folded-3d']))).toBe(0.5);
    expect(widestPenPt(surfacePaperStyle(diagram, PAPER_STYLE_POLICIES.simulator))).toBe(0.5);
    // A folded figure draws every fold as an edge; a simulation draws its
    // folds, so a heavy fold pen counts there alone.
    const heavy = { ...diagram, mountainFolds: { ...diagram.mountainFolds, width: 2 } };
    expect(widestPenPt(surfacePaperStyle(heavy, PAPER_STYLE_POLICIES['folded-3d']))).toBe(0.5);
    expect(widestPenPt(surfacePaperStyle(heavy, PAPER_STYLE_POLICIES.simulator))).toBe(2);
    // A diagram crease widened past everything counts only where it is drawn.
    const wide = { ...diagram, mountainDiagramCreases: { ...diagram.mountainDiagramCreases, width: 4 } };
    expect(widestPenPt(surfacePaperStyle(wide, PAPER_STYLE_POLICIES['folded-3d']))).toBe(0.5);
    expect(widestPenPt(surfacePaperStyle(wide, PAPER_STYLE_POLICIES.references))).toBe(4);
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
    const [sheet] = faces(paint(scene).svg);
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
    expect(faces(svg)).toHaveLength(1);
    const [path] = faces(svg);
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
    expect(faces(kept)).toHaveLength(2);
    expect(lines(kept).map((item) => item.stroke)).toEqual([
      DEFAULT_PAPER_STYLE.valleyFolds.color,
      DEFAULT_PAPER_STYLE.mountainFolds.color,
    ]);
    // In place: the buried face precedes the one that covers it.
    expect(kept.indexOf('<path')).toBeLessThan(kept.indexOf('<line'));
    const dropped = paint(scene, DEFAULT_PAPER_STYLE, { ...TIGHT, keepHiddenFaces: false }).svg;
    expect(faces(dropped)).toHaveLength(1);
    expect(lines(dropped).map((item) => item.stroke)).toEqual([
      DEFAULT_PAPER_STYLE.mountainFolds.color,
    ]);
  });

  it('writes every face as a path, the one shape a drawing editor’s node tool reshapes', () => {
    const { svg } = paint(sceneOf([face([SQUARE])]));
    expect(svg).not.toContain('<polygon');
    const [sheet] = faces(svg);
    const at = (px: number) => (px * PT_PER_CSS_PX + ROOM).toFixed(2);
    expect(sheet!.d).toBe(`M${at(0)},${at(0)}L${at(100)},${at(0)}L${at(100)},${at(100)}L${at(0)},${at(100)}Z`);
    expect(sheet!['fill-rule']).toBeUndefined();
  });

  describe('that draws its own outline', () => {
    const hole: ScenePoint[] = [
      [25, 25],
      [25, 75],
      [75, 75],
      [75, 25],
    ];

    it('is one path, filled with its paper and stroked with its role’s pen', () => {
      const { svg } = paint(sceneOf([face([SQUARE], { outline: 'edge' })]));
      expect(faces(svg)).toHaveLength(1);
      expect(faces(svg)[0]).toMatchObject({
        fill: DEFAULT_PAPER_STYLE.paper.front,
        stroke: DEFAULT_PAPER_STYLE.edges.color,
        'stroke-width': DEFAULT_PAPER_STYLE.edges.width.toFixed(2),
      });
      // Nothing else draws the outline.
      expect(lines(svg)).toHaveLength(0);
    });

    it('strokes every ring of a region with holes', () => {
      const { svg } = paint(sceneOf([face([SQUARE, hole], { outline: 'edge' })]));
      const [path] = faces(svg);
      expect(path).toMatchObject({ 'fill-rule': 'evenodd', stroke: DEFAULT_PAPER_STYLE.edges.color });
      expect(path!.d!.match(/M/g)).toHaveLength(2);
    });

    it('draws a dashed pen as a line per edge after the seamed fill, each dash centred on its edge', () => {
      const style = withPen('edges', { dash: [4, 2] });
      const { svg } = paint(sceneOf([face([SQUARE], { outline: 'edge' })]), style);
      const [sheet] = faces(svg);
      expect(sheet).toMatchObject({ stroke: sheet!.fill, 'stroke-width': SEAM_STROKE_WIDTH_PT.toFixed(2) });
      const edges = lines(svg);
      expect(edges).toHaveLength(4);
      const runs = [4, 2].map((run) => run * style.edges.width);
      const offset = centredDashOffset(runs, FIXTURE_SHEET_PX * PT_PER_CSS_PX).toFixed(2);
      for (const edge of edges) {
        expect(edge).toMatchObject({ stroke: style.edges.color, 'stroke-dashoffset': offset });
      }
      expect(svg.indexOf('<path')).toBeLessThan(svg.indexOf('<line'));
    });

    it('draws only the fill and its seam when the style leaves the role out', () => {
      const style: PaperStyle = {
        ...DEFAULT_PAPER_STYLE,
        auxCreases: { ...DEFAULT_PAPER_STYLE.auxCreases, visible: false },
      };
      const { svg } = paint(sceneOf([face([SQUARE], { outline: 'aux' })]), style);
      expect(faces(svg)[0]).toMatchObject({
        stroke: style.paper.front,
        'stroke-width': SEAM_STROKE_WIDTH_PT.toFixed(2),
      });
      expect(lines(svg)).toHaveLength(0);
    });
  });
});

describe('faceOutlineLines', () => {
  it('is a line per edge of every ring, in the outline’s role, on the face and hidden with it', () => {
    const triangle: ScenePoint[] = [
      [0, 0],
      [10, 0],
      [0, 10],
    ];
    const outlined = face([SQUARE, triangle], { face: 7, outline: 'edge', hidden: true });
    const found = faceOutlineLines(outlined);
    expect(found).toHaveLength(7);
    expect(found[3]).toEqual(line('edge', [0, 100], [0, 0], { face: 7, hidden: true }));
    expect(found[6]).toEqual(line('edge', [0, 10], [0, 0], { face: 7, hidden: true }));
  });

  it('is nothing for a face with no outline, and nothing for a ring too short to fill', () => {
    expect(faceOutlineLines(face([SQUARE]))).toEqual([]);
    const degenerate: ScenePoint[] = [
      [0, 0],
      [1, 1],
    ];
    expect(faceOutlineLines(face([SQUARE, degenerate], { outline: 'aux' }))).toHaveLength(4);
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

  it('draws a step’s instruction in the diagram-crease pens and a pattern’s line in the fold pens', () => {
    const style: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      mountainFolds: { width: 0.75, color: '#aa0000', dash: null, cap: 'butt' },
      valleyFolds: { width: 1.5, color: '#0000aa', dash: null, cap: 'butt' },
      mountainDiagramCreases: { width: 0.5, color: '#bb0000', dash: [8, 2, 1, 2], cap: 'butt' },
      valleyDiagramCreases: { width: 1.25, color: '#0000bb', dash: [4, 2], cap: 'round' },
    };
    const scene = sceneOf([
      line('mountain', [0, 10], [100, 10]),
      line('valley', [0, 20], [100, 20]),
      line('diagram-mountain', [0, 30], [100, 30]),
      line('diagram-valley', [0, 40], [100, 40]),
    ]);
    expect(lines(paint(scene, style).svg)).toMatchObject([
      { stroke: '#aa0000', 'stroke-width': '0.75' },
      { stroke: '#0000aa', 'stroke-width': '1.50' },
      { stroke: '#bb0000', 'stroke-width': '0.50', 'stroke-dasharray': '4.00 1.00 0.50 1.00' },
      { stroke: '#0000bb', 'stroke-width': '1.25', 'stroke-linecap': 'round' },
    ]);
  });

  it('keeps a simulation’s valley in the fold pen while a step’s takes the diagram-crease pen', () => {
    const style: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      foldsAsEdges: false,
      valleyDiagramCreases: { ...DEFAULT_PAPER_STYLE.valleyDiagramCreases, color: '#00bb00' },
    };
    const simulation = surfacePaperStyle(style, PAPER_STYLE_POLICIES.simulator);
    const [fold] = lines(paint(sheetWithCrease('valley'), simulation).svg);
    expect(fold!.stroke).toBe(DEFAULT_PAPER_STYLE.valleyFolds.color);
    const step = surfacePaperStyle(style, PAPER_STYLE_POLICIES.references);
    const [instruction] = lines(paint(sheetWithCrease('diagram-valley'), step).svg);
    expect(instruction!.stroke).toBe('#00bb00');
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
    const solid: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      mountainFolds: { ...DEFAULT_PAPER_STYLE.mountainFolds, dash: null },
      valleyFolds: { ...DEFAULT_PAPER_STYLE.valleyFolds, dash: null },
    };
    const [crease] = lines(paint(undefined, solid).svg);
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

  // A mesh draws a crease as a chain of pieces, and a butt cap at every link
  // left a wedge out of the outside of each bend: the painter joins a piece to
  // what carries on from it, and keeps the pen's cap for the line's own ends.
  describe('where a line joins another', () => {
    const BUTT = withPen('mountainFolds', { width: 1, color: '#aa0000', dash: null, cap: 'butt' });
    const drawn = (joined: [boolean, boolean] | undefined, style = BUTT, erode = 0) =>
      paint(
        sceneOf([line('mountain', [0, 10], [100, 10], { ...(joined ? { joined } : {}), onBoundary: [true, false] })]),
        { ...style, erode }
      ).svg;

    it('draws a solid butt pen round at both joints, and the pen’s cap at an end of its own', () => {
      expect(lines(drawn([true, true]))).toMatchObject([{ 'stroke-linecap': 'round' }]);
      expect(elements(drawn([true, true]), 'circle')).toHaveLength(0);
      expect(lines(drawn(undefined))).toMatchObject([{ 'stroke-linecap': 'butt' }]);
      expect(elements(drawn(undefined), 'circle')).toHaveLength(0);

      // Joined at one end only: the other keeps its butt cap, and the joint is
      // a dot the line's width, in its ink, where the line ends.
      const one = drawn([false, true]);
      const [piece] = lines(one);
      expect(piece).toMatchObject({ 'stroke-linecap': 'butt' });
      const [dot] = elements(one, 'circle');
      expect(dot).toMatchObject({ cx: piece!.x2, cy: piece!.y2, r: '0.50', fill: '#aa0000' });
    });

    it('leaves a dashed pen, a round one and an end erode pulled back as they are', () => {
      const dashed = drawn([true, true], withPen('mountainFolds', { ...BUTT.mountainFolds, dash: [4, 2] }));
      expect(lines(dashed)).toMatchObject([{ 'stroke-linecap': 'butt' }]);
      expect(elements(dashed, 'circle')).toHaveLength(0);
      const round = drawn([false, true], withPen('mountainFolds', { ...BUTT.mountainFolds, cap: 'round' }));
      expect(lines(round)).toMatchObject([{ 'stroke-linecap': 'round' }]);
      expect(elements(round, 'circle')).toHaveLength(0);
      // Erode pulls the flagged end back to leave a gap on purpose: that end
      // is no joint any more, and only the other is joined.
      const eroded = drawn([true, true], BUTT, 0.1);
      const [piece] = lines(eroded);
      expect(Number(piece!.x1)).toBeGreaterThan(ROOM + 0.5);
      expect(piece).toMatchObject({ 'stroke-linecap': 'butt' });
      expect(elements(eroded, 'circle')).toMatchObject([{ cx: piece!.x2 }]);
    });

    it('draws nothing for a piece joined at both ends and shorter than its own width', () => {
      // Round, it is a blob where a crease peeks out from under a face; the
      // pieces either side reach half a width into the span it covers.
      const wide = withPen('mountainFolds', { ...BUTT.mountainFolds, width: 2 });
      const stub = (joined: [boolean, boolean]) =>
        paint(sceneOf([line('mountain', [0, 10], [2, 10], { joined })]), wide).svg;
      expect(lines(stub([true, true]))).toHaveLength(0);
      expect(lines(stub([false, true]))).toHaveLength(1);
    });
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
    const [sheet] = faces(svg);
    expect(corners(sheet!.d!)[0]).toBe('300.00,0.00');
    expect(corners(sheet!.d!)[2]).toBe('500.00,200.00');
    const [crease] = lines(svg);
    expect(crease).toMatchObject({ x1: '300.00', y1: '100.00', x2: '500.00', y2: '100.00' });
  });

  it('draws each pen and the seam at the page’s units per pt, dashes included', () => {
    const style = withPen('mountainFolds', { width: 0.75, dash: [8, 2, 1, 2] });
    const svg = body(sheetWithCrease(), style);
    expect(faces(svg)[0]!['stroke-width']).toBe(((SEAM_STROKE_WIDTH_PT * 4) / 3).toFixed(2));
    const [crease] = lines(svg);
    expect(crease!['stroke-width']).toBe('1.00');
    expect(crease!['stroke-dasharray']).toBe('8.00 2.00 1.00 2.00');
    // The page painter is the same elements at one unit per pt.
    const page = paperSceneToSvg(sheetWithCrease(), style, TIGHT).svg;
    expect(lines(page)[0]!['stroke-width']).toBe('0.75');
  });

  it('strokes a face’s own outline at the page’s units per pt', () => {
    const [sheet] = faces(body(sceneOf([face([SQUARE], { outline: 'edge' })])));
    expect(sheet!['stroke-width']).toBe(((DEFAULT_PAPER_STYLE.edges.width * 4) / 3).toFixed(2));
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
    expect(faces(body(scene, style))).toHaveLength(2);
    expect(faces(body(scene, style, false))).toHaveLength(1);
  });
});
