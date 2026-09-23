import { describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_PAGE } from '../../lib/paper/paperPage';
import type {
  PaperFaceItem,
  PaperLineItem,
  PaperMarkupItem,
  PaperScene,
} from '../../lib/paper/paperScene';
import { DEFAULT_PAPER_STYLE, PT_TO_CSS_PX, type PaperStyle } from '../../lib/paper/paperStyle';
import { PT_PER_CSS_PX, pageMarginPt, paperSceneToSvg } from '../../lib/paper/paperSvg';
import { REFERENCE_COLORS } from '../../themes/applyTheme';
import { plannerSequenceWithGridFixture } from './__fixtures__/plannerSequence';
import { DIAGRAM_INK_PER_SHEET, DIAGRAM_LINE_INK } from './diagram/diagramInk';
import { createDiagramRenderContext } from './diagram/DiagramPrimitives';
import { unitFrame } from './diagram/diagramFrames';
import { plannerStepDiagram } from './diagram/plannerDiagram';
import { diagramToPaperScene } from './diagramToPaperScene';
import type {
  DiagramLineStyleName,
  StepDiagramModel,
  StepDiagramPrimitive,
} from './referenceFinderDiagramToPrimitives';
import {
  DIAGRAM_PADDING,
  arcPolyline,
  createDiagramProjector,
  createOverlayProjector,
  foldArrowArc,
  type DiagramArc,
} from './stepDiagramGeometry';

/** The card's box: the unit sheet at 80 px with the 10 px band round it. */
const SIZE = 100;
const SHEET_PX = SIZE * (1 - 2 * DIAGRAM_PADDING);

const UNIT = { width: 1, height: 1 };

function model(...primitives: StepDiagramPrimitive[]): StepDiagramModel {
  return { sheet: UNIT, primitives: [{ kind: 'sheet', width: 1, height: 1 }, ...primitives] };
}

function line(
  style: DiagramLineStyleName,
  from: readonly [number, number],
  to: readonly [number, number]
): StepDiagramPrimitive {
  return { kind: 'line', from, to, style };
}

function scene(
  diagram: StepDiagramModel,
  options: { style?: PaperStyle; mirrored?: boolean; ground?: string } = {}
): PaperScene {
  return diagramToPaperScene(diagram, {
    style: options.style ?? DEFAULT_PAPER_STYLE,
    project: createDiagramProjector(diagram.sheet, SIZE, options.mirrored ?? false),
    ...(options.ground ? { ground: options.ground } : {}),
  });
}

const faces = (result: PaperScene) =>
  result.items.filter((item): item is PaperFaceItem => item.kind === 'face');
const lines = (result: PaperScene) =>
  result.items.filter((item): item is PaperLineItem => item.kind === 'line');
/** The paper's border: the four edge lines the producer draws round the face itself. */
const border = (result: PaperScene) => lines(result).slice(0, 4);
/** The lines the model drew, which follow the border. */
const creases = (result: PaperScene) => lines(result).slice(4);
const markups = (result: PaperScene) =>
  result.items.filter((item): item is PaperMarkupItem => item.kind === 'markup');

/** Every element of one tag in some markup, as its attribute map. */
function elements(svg: string, tag: string): Record<string, string>[] {
  return [...svg.matchAll(new RegExp(`<${tag}\\s([^>]*?)/?>`, 'g'))].map((match) =>
    Object.fromEntries([...match[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]))
  );
}

/** Two points of the card's projection, to two decimals. */
const near = (point: readonly number[], want: readonly number[]) => {
  expect(point[0]).toBeCloseTo(want[0]!, 2);
  expect(point[1]).toBeCloseTo(want[1]!, 2);
};

describe('the sheet', () => {
  it('is one unlit face of the paper’s front, its corners through the projection', () => {
    const result = scene(model());
    const [sheet] = faces(result);
    expect(faces(result)).toHaveLength(1);
    expect(sheet).toMatchObject({ face: 0, side: 'front', shade: 1, hidden: false });
    // The projector flips y: the sheet's bottom-left lands at the box's bottom-left.
    const [ring] = sheet!.rings;
    expect(ring).toHaveLength(4);
    near(ring![0]!, [10, 90]);
    near(ring![1]!, [90, 90]);
    near(ring![2]!, [90, 10]);
    near(ring![3]!, [10, 10]);
    expect(result.sheet).toBeCloseTo(SHEET_PX, 9);
    // The first item: everything else is drawn on it.
    expect(result.items[0]!.kind).toBe('face');
  });

  it('is the back when the projector is mirrored, with every fold named from that side', () => {
    const result = scene(model(line('mountain', [0, 0.5], [1, 0.5])), { mirrored: true });
    expect(faces(result)[0]!.side).toBe('back');
    expect(creases(result)[0]!.role).toBe('valley');
  });

  it('takes which face the reader is on from the caller over the projector', () => {
    // The big view's projector is onto model space, whose frame is left-handed
    // (`frame.rs`), so its flag reads `true` for the front; the panel says
    // which face the picture is of.
    const canvas = createOverlayProjector({ origin: [0, 0], ex: [80, 0], ey: [0, 80] }, 1);
    expect(canvas.mirrored).toBe(true);
    const diagram = model(line('mountain', [0, 0.5], [1, 0.5]));
    const front = diagramToPaperScene(diagram, {
      style: DEFAULT_PAPER_STYLE,
      project: canvas,
      mirrored: false,
    });
    expect(faces(front)[0]!.side).toBe('front');
    expect(creases(front)[0]!.role).toBe('mountain');
    const back = diagramToPaperScene(diagram, {
      style: DEFAULT_PAPER_STYLE,
      project: canvas,
      mirrored: true,
    });
    expect(faces(back)[0]!.side).toBe('back');
    expect(creases(back)[0]!.role).toBe('valley');
  });

  it('is drawn wherever the frame put it, and the sheet primitive is not a second one', () => {
    const placed: StepDiagramModel = {
      sheet: { width: 2, height: 1, centre: [10, 10] },
      // No sheet primitive at all: the canvas's model has the document's own border.
      primitives: [line('crease', [9, 10], [11, 10])],
    };
    const result = diagramToPaperScene(placed, {
      style: DEFAULT_PAPER_STYLE,
      project: createDiagramProjector(placed.sheet, SIZE),
    });
    expect(faces(result)).toHaveLength(1);
    expect(result.sheet).toBeCloseTo(2 * createDiagramProjector(placed.sheet, SIZE).scale, 9);
    // Both ends of the crease are on the paper's edge, found round its centre.
    expect(creases(result)[0]!.onBoundary).toEqual([true, true]);
  });

  it('bounds the card’s box: the sheet plus the band a letter is pushed into', () => {
    const { bounds } = scene(model());
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: SIZE, maxY: SIZE });
  });

  it('grows its bounds to hold a letter the layout pushed past the band', () => {
    // The big view's ink is a fixed number of CSS px, not a share of the
    // sheet, so a zoomed-out view has letters wider than the band. Nothing
    // holds them inside it — the page is cropped to the bounds, which take
    // them in.
    const corner = model(
      { kind: 'point', at: [0, 1], style: 'highlight' },
      { kind: 'label', at: [0, 1], text: 'A', style: 'highlight' }
    );
    const lettered = diagramToPaperScene(corner, {
      style: DEFAULT_PAPER_STYLE,
      project: createOverlayProjector({ origin: [0, 0], ex: [40, 0], ey: [0, 40] }, 1),
      mirrored: false,
    });
    const [letter] = elements(markups(lettered)[0]!.svg, 'text');
    // The sheet spans 0..40 here, so the card's box alone would start at -pad.
    const pad = (40 * DIAGRAM_PADDING) / (1 - 2 * DIAGRAM_PADDING);
    expect(lettered.bounds.minX).toBeLessThan(-pad);
    expect(lettered.bounds.minX).toBeLessThanOrEqual(Number(letter!.x));
  });

  it('places a letter where the big view does, not where a card’s box would', () => {
    // The card's layout is bounded by its viewBox and charges a letter for
    // leaving it; a page has no such edge, so the two can differ — the
    // export follows the view (`ReferencesDiagramLayer` passes no layout).
    const corner = model(
      { kind: 'point', at: [1, 0], style: 'highlight' },
      { kind: 'label', at: [1, 0], text: 'A', style: 'highlight' }
    );
    const project = createDiagramProjector(UNIT, SIZE);
    const free = createDiagramRenderContext(corner.primitives, UNIT, project);
    const placed = [...free.labels.values()][0]!;
    const [letter] = elements(markups(scene(corner))[0]!.svg, 'text');
    expect(Number(letter!.x)).toBeCloseTo(placed.x, 6);
    expect(Number(letter!.y)).toBeCloseTo(placed.y, 6);
    expect(letter!['text-anchor']).toBe(placed.anchor);
  });

  it('draws the paper’s border with the edge pen, whether or not the model has a sheet', () => {
    // A face is closed with a hairline in its own fill, so without these the
    // paper has no outline on the page at all.
    const card = scene(model());
    expect(border(card).map((item) => item.role)).toEqual(['edge', 'edge', 'edge', 'edge']);
    near(border(card)[0]!.a, [10, 90]);
    near(border(card)[0]!.b, [90, 90]);
    near(border(card)[3]!.a, [10, 10]);
    near(border(card)[3]!.b, [10, 90]);
    // The big view's model carries no sheet primitive; the border is the
    // frame's, all the same.
    const placed: StepDiagramModel = {
      sheet: { width: 2, height: 1, centre: [10, 10] },
      primitives: [line('crease', [9, 10], [11, 10])],
    };
    const view = diagramToPaperScene(placed, {
      style: DEFAULT_PAPER_STYLE,
      project: createDiagramProjector(placed.sheet, SIZE),
    });
    expect(border(view).map((item) => item.role)).toEqual(['edge', 'edge', 'edge', 'edge']);
    const { svg } = paperSceneToSvg(view, DEFAULT_PAPER_STYLE, DEFAULT_PAPER_PAGE);
    const drawn = elements(svg, 'line').filter(
      (item) => item.stroke === DEFAULT_PAPER_STYLE.edges.color
    );
    expect(drawn).toHaveLength(4);
  });
});

describe('the lines', () => {
  it('take the role their style names', () => {
    const styles: Array<[DiagramLineStyleName, PaperLineItem['role']]> = [
      ['edge', 'edge'],
      ['mountain', 'mountain'],
      ['pinch-mountain', 'mountain'],
      ['valley', 'valley'],
      ['pinch-valley', 'valley'],
      ['crease', 'aux'],
      ['aux', 'aux'],
      ['dotted', 'aux'],
      ['unfolded', 'aux'],
    ];
    const result = scene(
      model(...styles.map(([style], i) => line(style, [0.1, 0.1 * (i + 1)], [0.9, 0.1 * (i + 1)])))
    );
    expect(creases(result).map((item) => item.role)).toEqual(styles.map(([, role]) => role));
    for (const item of lines(result)) expect(item).toMatchObject({ face: 0, hidden: false });
    // In scene px, through the same projection as the sheet.
    near(creases(result)[0]!.a, [18, 82]);
    near(creases(result)[0]!.b, [82, 82]);
  });

  // The creases an earlier step made are the paper as it stands; the
  // pattern's own aux lines are the References option's, the style's switch
  // until it is set.
  it('keep the made creases, and the pattern’s aux lines only when shown', () => {
    const diagram = model(line('crease', [0, 0.5], [1, 0.5]), line('aux', [0.5, 0], [0.5, 1]));
    const hidden: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      auxCreases: { ...DEFAULT_PAPER_STYLE.auxCreases, visible: false },
    };
    const drawn = (style: PaperStyle, showAux?: boolean | null) =>
      creases(
        diagramToPaperScene(diagram, {
          style,
          project: createDiagramProjector(diagram.sheet, SIZE, false),
          showAux,
        })
      ).length;
    expect(drawn(DEFAULT_PAPER_STYLE)).toBe(2);
    expect(drawn(hidden)).toBe(1);
    expect(drawn(hidden, true)).toBe(2);
    expect(drawn(DEFAULT_PAPER_STYLE, false)).toBe(1);
  });

  it('flag an aux line’s end on the sheet’s edge for erode, and nothing else’s', () => {
    const result = scene(
      model(
        line('crease', [0, 0.5], [0.6, 0.5]),
        line('crease', [0.2, 0.2], [0.7, 0.7]),
        line('valley', [0, 0.25], [1, 0.25]),
        line('edge', [0, 0], [1, 0])
      )
    );
    expect(creases(result).map((item) => item.onBoundary)).toEqual([
      [true, false],
      [false, false],
      [false, false],
      [false, false],
    ]);
  });

  it('erode on the page by the style’s share of the sheet, as the card does', () => {
    const style: PaperStyle = { ...DEFAULT_PAPER_STYLE, erode: 0.1 };
    const result = scene(model(line('crease', [0, 0.5], [1, 0.5])), { style });
    const page = { ...DEFAULT_PAPER_PAGE, paddingMm: 0 };
    const { svg } = paperSceneToSvg(result, style, page);
    // The border's four lines come first; the crease is the fifth.
    const crease = elements(svg, 'line')[4];
    // 0.1 of 80 px is 8 px in from the sheet's edge at 10 px; 0.75 pt per px
    // on an as-shown page, past the stroke room a zero margin keeps.
    const room = pageMarginPt(style, page);
    expect(Number(crease!.x1)).toBeCloseTo(18 * PT_PER_CSS_PX + room, 2);
    expect(Number(crease!.x2)).toBeCloseTo(82 * PT_PER_CSS_PX + room, 2);
    expect(crease!.stroke).toBe(DEFAULT_PAPER_STYLE.auxCreases.pen.color);
  });

  it('flatten an arc with a fold style to the runs between its samples', () => {
    const arc: DiagramArc = { center: [0.5, 0.5], radius: 0.3, from: 0, to: Math.PI / 2, ccw: true };
    const result = scene(model({ kind: 'arc', ...arc, style: 'mountain' }));
    const runs = creases(result);
    const samples = arcPolyline(arc);
    expect(runs).toHaveLength(samples.length - 1);
    const project = createDiagramProjector(UNIT, SIZE);
    runs.forEach((run, i) => {
      expect(run.role).toBe('mountain');
      const from = project(samples[i]!);
      const to = project(samples[i + 1]!);
      near(run.a, [from.x, from.y]);
      near(run.b, [to.x, to.y]);
    });
    // An arc in a style with no pen stays a symbol.
    const kept = scene(model({ kind: 'arc', ...arc, style: 'highlight' }));
    expect(creases(kept)).toHaveLength(0);
    expect(markups(kept)[0]!.svg).toContain('<path');
  });
});

describe('the markup', () => {
  const arrow = foldArrowArc([0.2, 0.5], [0.8, 0.5], [0.5, 0.5])!;
  const symbols = model(
    line('crease', [0, 0.5], [1, 0.5]),
    { kind: 'region', corners: [[0.2, 0], [0.4, 0], [0.4, 1], [0.2, 1]] },
    line('highlight', [0.3, 0], [0.3, 1]),
    { kind: 'point', at: [0.2, 0.5], style: 'highlight' },
    { kind: 'label', at: [0.2, 0.5], text: 'A', style: 'highlight' },
    { kind: 'fold-arrow', out: arrow },
    { kind: 'turn-over', at: [0.5, 0.5] },
    line('pinch', [0.4, 0.4], [0.6, 0.6])
  );

  it('carries every symbol the painter has no word for, after the lines, with the wash under them', () => {
    const result = scene(symbols);
    const kinds = result.items.map((item) => item.kind);
    // The face, its border, the wash, the model's one crease, the symbols.
    expect(kinds).toEqual(['face', 'line', 'line', 'line', 'line', 'markup', 'line', 'markup']);
    const [wash, over] = markups(result);
    expect(elements(wash!.svg, 'polygon')).toHaveLength(1);
    expect(wash!.svg).not.toContain('<path');
    expect(over!.svg).toContain('<circle');
    expect(over!.svg).toContain('>A</text>');
    // The highlight line, the arrow's two strokes, the glyph's, and the pinch.
    expect(elements(over!.svg, 'line')).toHaveLength(2);
    expect(elements(over!.svg, 'path').length).toBeGreaterThanOrEqual(3);
    expect(over!.bounds).toEqual(result.bounds);
    for (const item of markups(result)) expect(item.hidden).toBe(false);
  });

  it('has no class in it: every colour is an attribute, resolved from the style', () => {
    const style: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      paper: { front: '#fff8e1', back: '#d0d0d0' },
      edges: { ...DEFAULT_PAPER_STYLE.edges, color: '#102030' },
      auxCreases: { visible: true, pen: { ...DEFAULT_PAPER_STYLE.auxCreases.pen, color: '#8090a0' } },
      arrows: { width: 1.5, color: '#405060', dash: null, cap: 'round' },
    };
    const result = scene(symbols, { style, ground: '#fafafa' });
    for (const item of markups(result)) {
      expect(item.svg).not.toContain('class=');
      expect(item.svg).not.toContain('var(');
    }
    const [wash, over] = markups(result);
    expect(elements(wash!.svg, 'polygon')[0]).toMatchObject({
      fill: REFERENCE_COLORS.light.input,
      'fill-opacity': '0.12',
      stroke: 'none',
    });
    // The arrowhead is the arrow pen's; the mark's ring takes the edge pen's
    // ink; the letter the accent, with the page's ground for its halo, in a
    // named font.
    expect(elements(over!.svg, 'polygon').map((p) => p.fill)).toEqual(['#405060', '#405060']);
    expect(elements(over!.svg, 'circle')[0]).toMatchObject({ fill: 'none', stroke: '#102030' });
    expect(elements(over!.svg, 'text')[0]).toMatchObject({
      fill: REFERENCE_COLORS.light.input,
      stroke: '#fafafa',
      'paint-order': 'stroke',
      'font-weight': '700',
    });
    expect(elements(over!.svg, 'text')[0]!['font-family']).toContain('Inter');
    // A pinch of no known direction keeps its grey — the aux pen's colour.
    const [highlight, pinch] = elements(over!.svg, 'line');
    expect(highlight!.stroke).toBe(REFERENCE_COLORS.light.input);
    expect(pinch!.stroke).toBe('#8090a0');
  });

  it('draws the fold arrow with the arrow pen: its width in scene px, its colour and cap', () => {
    const style: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      arrows: { width: 1.5, color: '#405060', dash: null, cap: 'round' },
    };
    const result = scene(symbols, { style });
    const [, over] = markups(result);
    const strokes = elements(over!.svg, 'path').filter((p) => p.stroke === '#405060');
    // The arrow's two strokes and the turn-over glyph's.
    expect(strokes.length).toBe(3);
    const widthPx = 1.5 * PT_TO_CSS_PX;
    for (const stroke of strokes.slice(0, 2)) {
      expect(Number(stroke['stroke-width'])).toBeCloseTo(widthPx, 6);
      expect(stroke['stroke-linecap']).toBe('round');
    }
    // On an as-shown page the group scales by 0.75 pt/px, so the pen is its pt.
    const { svg } = paperSceneToSvg(result, style, DEFAULT_PAPER_PAGE);
    const group = svg.match(/<g transform="translate\([^)]*\) scale\(([\d.]+)\)">/);
    expect(Number(group![1]) * widthPx).toBeCloseTo(1.5, 2);
    // A card's own arrow, for comparison, is the table's weight in ink.
    const ink = SHEET_PX * DIAGRAM_INK_PER_SHEET;
    expect(widthPx).not.toBeCloseTo(DIAGRAM_LINE_INK.arrow.width * ink, 3);
  });

  it('is absent when the step has no symbols', () => {
    const result = scene(model(line('valley', [0, 0.5], [1, 0.5])));
    expect(markups(result)).toHaveLength(0);
    expect(result.items.map((item) => item.kind)).toEqual([
      'face',
      ...Array<'line'>(5).fill('line'),
    ]);
  });
});

describe('a whole step', () => {
  it('paints through paperSceneToSvg as a page in the style’s pens', () => {
    const sequence = plannerSequenceWithGridFixture();
    // The fixture's CP step: earlier creases, the references it is made
    // against, its fold arrow, the valley it makes, and the letters.
    const step = plannerStepDiagram(sequence, unitFrame(sequence), 2)!;
    expect(step.primitives.some((p) => p.kind === 'fold-arrow')).toBe(true);
    expect(step.primitives.some((p) => p.kind === 'line' && p.style === 'valley')).toBe(true);
    const style: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      valleyFolds: { width: 0.7, color: '#123456', dash: [4, 2], cap: 'butt' },
      auxCreases: { visible: true, pen: { width: 0.3, color: '#abcdef', dash: null, cap: 'butt' } },
      erode: 0.02,
    };
    const result = scene(step, { style });
    expect(faces(result)).toHaveLength(1);
    expect(creases(result).length).toBeGreaterThan(1);
    expect(markups(result)).toHaveLength(1);

    const page = paperSceneToSvg(result, style, DEFAULT_PAPER_PAGE);
    expect(page.svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(page.svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(page.svg).not.toContain('class=');
    // Every opened tag is closed: the markup is well formed inside the page.
    const opened = page.svg.match(/<(g|text)\b/g)!.length;
    const closed = page.svg.match(/<\/(g|text)>/g)!.length;
    expect(opened).toBe(closed);
    const drawn = elements(page.svg, 'line');
    const valley = drawn.filter((l) => l.stroke === '#123456');
    expect(valley.length).toBeGreaterThan(0);
    expect(valley[0]).toMatchObject({ 'stroke-width': '0.70', 'stroke-dasharray': '2.80 1.40' });
    expect(drawn.some((l) => l.stroke === '#abcdef' && l['stroke-width'] === '0.30')).toBe(true);
    expect(elements(page.svg, 'polygon')[0]!.fill).toBe(style.paper.front);
    // The step's own arrow and letters are in the page, in the page's group.
    expect(page.svg).toContain('<g transform="translate(');
    expect(page.svg).toContain('</text>');
  });
});
