/**
 * The screen and the page draw a line in the same pen.
 *
 * A References line reaches the reader three ways — a card on the strip, the
 * big view over the crease pattern, and the step's exported page — and each
 * finds its pen by its own route: the card through a class in `theme.css` and
 * `cardDiagramPens`, the big view through `diagramColors.ts` and
 * `referencesCanvasPens`, the page through `diagramToPaperScene`'s roles and
 * the painter. Which pen a line takes is decided by what it means: a step's
 * own fold is an instruction, in the diagram-crease pens; a line of the
 * finished pattern is a crease pattern's, in the fold pens. So the style here
 * gives the two pairs different colours, widths, dashes and caps, and every
 * route has to land on the same pen for the same line — a route that took the
 * other pair's pen would draw it in another colour, weight or dash.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_PAGE } from '../../lib/paper/paperPage';
import {
  DEFAULT_PAPER_STYLE,
  PT_TO_CSS_PX,
  type PaperStyle,
  type Pen,
} from '../../lib/paper/paperStyle';
import { paperSceneToSvg } from '../../lib/paper/paperSvg';
import { useSettingsStore } from '../../store/settingsStore';
import { plannerSequenceWithGridFixture } from './__fixtures__/plannerSequence';
import { diagramInkColors } from './diagram/diagramColors';
import { unitFrame } from './diagram/diagramFrames';
import { canvasDiagramInk } from './diagram/diagramInk';
import { plannerFinishedDiagram } from './diagram/plannerDiagram';
import type {
  DiagramLineStyleName,
  StepDiagramModel,
} from './referenceFinderDiagramToPrimitives';
import {
  referencesStepPaintStyle,
  referencesStepScene,
  referencesStepSheetCssPx,
} from './referencesStepExport';
import { StepDiagram } from './StepDiagram';
import { DIAGRAM_CARD_DASH_SCALE } from './stepDiagramGeometry';
import { referencesCanvasPens, referencesPaperTokens } from './usePaperStyleTokens';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The two pairs apart in everything a pen has. The edge pen is 1 pt, so a width is its own ratio. */
const APART: PaperStyle = {
  ...DEFAULT_PAPER_STYLE,
  edges: { ...DEFAULT_PAPER_STYLE.edges, width: 1, color: '#000000' },
  mountainFolds: { width: 0.5, color: '#b00001', dash: null, cap: 'round' },
  valleyFolds: { width: 0.6, color: '#0000b1', dash: [2, 1], cap: 'round' },
  mountainDiagramCreases: { width: 1.2, color: '#b00002', dash: [5, 1, 1, 1], cap: 'butt' },
  valleyDiagramCreases: { width: 1.5, color: '#0000b2', dash: [6, 3], cap: 'butt' },
};

/** Every element of one tag in the markup, as its attributes. */
function elements(markup: string, tag: string): Record<string, string>[] {
  return [...markup.matchAll(new RegExp(`<${tag}[^>]*>`, 'g'))].map((match) =>
    Object.fromEntries(
      [...match[0].matchAll(/([a-zA-Z0-9-]+)="([^"]*)"/g)].map((attr) => [attr[1], attr[2]])
    )
  );
}

const numbers = (list: string | undefined) => (list ? list.split(/[ ,]+/).map(Number) : []);

/** A ratio, rounded past the page's two decimals. */
const ratio = (value: number, of: number) => Number((value / of).toFixed(2));

/** A dash in multiples of the stroke's width. */
const multiples = (dash: readonly number[], width: number) => dash.map((run) => ratio(run, width));

const css = readFileSync(resolve(process.cwd(), 'src/styles/theme.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
);

/**
 * A card line's colour inside the workspace: the token its class strokes in,
 * as the workspace root sets it from the style.
 */
function cardInk(style: DiagramLineStyleName, tokens: Readonly<Record<string, string>>): string {
  const rule = new RegExp(`^\\.step-diagram__line--${style} \\{([^}]*)\\}`, 'm').exec(css);
  expect(rule, style).not.toBeNull();
  const token = /stroke:\s*var\((--[\w-]+)/.exec(rule![1]!)?.[1];
  expect(token, style).toBeDefined();
  const value = tokens[token!];
  expect(value, `${style} reads ${token}`).toBeDefined();
  return value!;
}

function renderCard(element: ReactElement): string {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(element));
  const markup = container.innerHTML;
  act(() => root.unmount());
  return markup;
}

/** The step's page, as the export dialog's References target paints it. */
function page(diagram: StepDiagramModel, style: PaperStyle): Record<string, string>[] {
  const scene = referencesStepScene(diagram, {
    style,
    mirrored: false,
    sheetCssPx: referencesStepSheetCssPx(DEFAULT_PAPER_PAGE.sheet),
    lineWidth: 1,
    showAux: null,
    background: DEFAULT_PAPER_PAGE.background,
  });
  return elements(paperSceneToSvg(scene, referencesStepPaintStyle(style), DEFAULT_PAPER_PAGE).svg, 'line');
}

/** A line as drawn: colour, width against the edge's, dash in multiples of the width, cap. */
interface Drawn {
  color: string;
  width: number;
  dash: number[];
  cap: string | undefined;
}

/** The card's line of `style`, measured against the card's edge line. */
function cardLine(markup: string, style: DiagramLineStyleName, tokens: Readonly<Record<string, string>>): Drawn {
  const lines = elements(markup, 'line');
  const of = (name: DiagramLineStyleName) =>
    lines.find((line) => line.class?.split(' ').includes(`step-diagram__line--${name}`));
  const line = of(style);
  const edge = of('edge');
  expect(line, style).toBeDefined();
  expect(edge).toBeDefined();
  const width = Number(line!['stroke-width']);
  return {
    color: cardInk(style, tokens),
    width: ratio(width, Number(edge!['stroke-width'])),
    // The card draws its runs at half the pen's (`DIAGRAM_CARD_DASH_SCALE`).
    dash: multiples(numbers(line!['stroke-dasharray']), width * DIAGRAM_CARD_DASH_SCALE),
    cap: line!['stroke-linecap'],
  };
}

/** The page's line in `color`, measured against the edge pen's. */
function pageLine(lines: readonly Record<string, string>[], color: string, edge: Pen): Drawn {
  const line = lines.find((l) => l.stroke === color);
  expect(line, color).toBeDefined();
  const width = Number(line!['stroke-width']);
  return {
    color: line!.stroke!,
    width: ratio(width, edge.width),
    dash: multiples(numbers(line!['stroke-dasharray']), width),
    cap: line!['stroke-linecap'],
  };
}

/** What the pen itself says the line is. */
const penLine = (pen: Pen, edge: Pen): Drawn => ({
  color: pen.color,
  width: ratio(pen.width, edge.width),
  dash: [...(pen.dash ?? [])],
  cap: pen.cap,
});

beforeEach(() => {
  useSettingsStore.getState().setPaperStyleFields('display', {
    edges: APART.edges,
    mountainFolds: APART.mountainFolds,
    valleyFolds: APART.valleyFolds,
    mountainDiagramCreases: APART.mountainDiagramCreases,
    valleyDiagramCreases: APART.valleyDiagramCreases,
  });
});

afterEach(() => {
  useSettingsStore.getState().setPaperStyleFields('display', {
    edges: DEFAULT_PAPER_STYLE.edges,
    mountainFolds: DEFAULT_PAPER_STYLE.mountainFolds,
    valleyFolds: DEFAULT_PAPER_STYLE.valleyFolds,
    mountainDiagramCreases: DEFAULT_PAPER_STYLE.mountainDiagramCreases,
    valleyDiagramCreases: DEFAULT_PAPER_STYLE.valleyDiagramCreases,
  });
});

const tokens = referencesPaperTokens(APART);

describe('a step’s fold, on the card and on the page', () => {
  const step: StepDiagramModel = {
    sheet: { width: 1, height: 1 },
    primitives: [
      { kind: 'sheet', width: 1, height: 1 },
      { kind: 'line', from: [0, 0.2], to: [1, 0.2], style: 'edge' },
      { kind: 'line', from: [0, 0.4], to: [1, 0.4], style: 'valley' },
      { kind: 'line', from: [0, 0.6], to: [1, 0.6], style: 'mountain' },
    ],
  };

  it.each([
    ['valley', APART.valleyDiagramCreases],
    ['mountain', APART.mountainDiagramCreases],
  ] as const)('draws a %s in its diagram-crease pen, the same on both', (style, pen) => {
    const card = cardLine(renderCard(<StepDiagram primitives={step} size={100} />), style, tokens);
    const onPage = pageLine(page(step, APART), card.color, APART.edges);
    expect(card).toEqual(penLine(pen, APART.edges));
    expect(onPage).toEqual(card);
  });

  it.each([
    ['pinch-mountain', APART.mountainDiagramCreases],
    ['pinch-valley', APART.valleyDiagramCreases],
  ] as const)('inks a %s on the card in its diagram-crease colour', (style, pen) => {
    // A pinch keeps the table's weight on screen; only its colour is the pen's.
    expect(cardInk(style, tokens)).toBe(pen.color);
  });

  it('never draws a step’s fold in the fold pens, on either', () => {
    const markup = renderCard(<StepDiagram primitives={step} size={100} />);
    expect(markup).not.toContain('--fold-valley');
    expect(markup).not.toContain('--fold-mountain');
    const colors = page(step, APART).map((line) => line.stroke);
    expect(colors).not.toContain(APART.valleyFolds.color);
    expect(colors).not.toContain(APART.mountainFolds.color);
  });

  // The big view draws the same line again, in CSS px at the pen's own width.
  it.each([
    ['valley', APART.valleyDiagramCreases],
    ['mountain', APART.mountainDiagramCreases],
  ] as const)('draws a %s on the big view in the same pen', (style, pen) => {
    const { lineWidth, pens } = referencesCanvasPens(APART);
    const ink = canvasDiagramInk(lineWidth);
    expect(pens[style].width * ink).toBeCloseTo(pen.width * PT_TO_CSS_PX, 9);
    expect(multiples(pens[style].dash ?? [], pens[style].width)).toEqual(pen.dash ?? []);
    expect(pens[style].cap).toBe(pen.cap);
    const [r, g, b] = diagramInkColors(document.documentElement, tokens)[style];
    const hex = `#${[r, g, b].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;
    expect(hex).toBe(pen.color);
  });
});

describe('the finished card, on the card and on the page', () => {
  const sequence = plannerSequenceWithGridFixture();
  const finished = plannerFinishedDiagram(sequence, unitFrame(sequence));
  // An edge line to measure the card's widths against.
  const measured: StepDiagramModel = {
    ...finished,
    primitives: [...finished.primitives, { kind: 'line', from: [0, 0], to: [0, 1], style: 'edge' }],
  };

  it('is drawn in the fold pens, the same on both', () => {
    const markup = renderCard(<StepDiagram primitives={measured} size={100} />);
    const lines = page(measured, APART);
    for (const [style, pen] of [
      ['fold-valley', APART.valleyFolds],
      ['fold-mountain', APART.mountainFolds],
    ] as const) {
      const card = cardLine(markup, style, tokens);
      expect(card).toEqual(penLine(pen, APART.edges));
      expect(pageLine(lines, card.color, APART.edges)).toEqual(card);
    }
  });

  it('draws nothing in the diagram-crease pens, on either', () => {
    const markup = renderCard(<StepDiagram primitives={measured} size={100} />);
    for (const style of ['valley', 'mountain', 'pinch-valley', 'pinch-mountain']) {
      expect(markup).not.toContain(`step-diagram__line--${style}"`);
    }
    const colors = page(measured, APART).map((line) => line.stroke);
    expect(colors).not.toContain(APART.valleyDiagramCreases.color);
    expect(colors).not.toContain(APART.mountainDiagramCreases.color);
  });
});
