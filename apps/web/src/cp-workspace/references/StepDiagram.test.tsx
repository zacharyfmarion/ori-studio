import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_STYLE, type PaperStyleOverrides } from '../../lib/paper/paperStyle';
import { useSettingsStore } from '../../store/settingsStore';
import { cardChromeRects, StepDiagram } from './StepDiagram';
import {
  createDiagramRenderContext,
  diagramPrimitiveShape,
  labelOnPaper,
} from './diagram/DiagramPrimitives';
import { diagramInlineInk, type DiagramInlineTokens } from './diagram/diagramColors';
import {
  DIAGRAM_LABEL_INK,
  DIAGRAM_LINE_INK,
  DIAGRAM_MARK_INK,
  labelWidth,
} from './diagram/diagramInk';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import { createDiagramProjector, foldArrowArc } from './stepDiagramGeometry';

/** Every element of one tag in the markup, as its attributes plus its `text`. */
function elements(markup: string, tag: string): Record<string, string>[] {
  return [...markup.matchAll(new RegExp(`<${tag}[^>]*>(?:([^<]*)</${tag}>)?`, 'g'))].map(
    (match) => ({
      ...Object.fromEntries(
        [...match[0].matchAll(/([a-zA-Z0-9-]+)="([^"]*)"/g)].map((attr) => [attr[1], attr[2]])
      ),
      text: match[1] ?? '',
    })
  );
}

const model = (width: number, height: number): StepDiagramModel => ({
  sheet: { width, height },
  primitives: [
    { kind: 'sheet', width, height },
    {
      kind: 'line',
      from: [0, 0],
      to: [width, height],
      style: 'valley',
    },
  ],
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A card rendered on the client. A card reads its pens off the settings store,
 * and a server render reads a store's *initial* state.
 */
function renderClient(element: ReactElement): string {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(element));
  const markup = container.innerHTML;
  act(() => root.unmount());
  return markup;
}

/**
 * Fold pens that draw a card's folds exactly as the diagram table does: at the
 * table's 1.6 ink against its 1.2 edge (so 4/3 of the edge pen), dashed 8:4
 * and 4:2:1:2 in multiples of the width. The style's folds are solid by
 * default, and these tests are about dashes.
 */
function useTableFolds() {
  const set = (fields: PaperStyleOverrides) =>
    useSettingsStore.getState().setPaperStyleFields('display', fields);
  beforeEach(() => {
    const width = (DEFAULT_PAPER_STYLE.edges.width * 1.6) / 1.2;
    set({
      edges: DEFAULT_PAPER_STYLE.edges,
      mountainFolds: { ...DEFAULT_PAPER_STYLE.mountainFolds, width, dash: [4, 2, 1, 2], cap: 'butt' },
      valleyFolds: { ...DEFAULT_PAPER_STYLE.valleyFolds, width, dash: [8, 4], cap: 'butt' },
    });
  });
  afterEach(() => {
    set({
      mountainFolds: DEFAULT_PAPER_STYLE.mountainFolds,
      valleyFolds: DEFAULT_PAPER_STYLE.valleyFolds,
    });
  });
}

const rectOf = (markup: string) => {
  const tag = markup.match(/<rect[^>]*>/)?.[0] ?? '';
  const attr = (name: string) => Number(tag.match(new RegExp(`${name}="([^"]*)"`))?.[1]);
  return { x: attr('x'), y: attr('y'), width: attr('width'), height: attr('height') };
};

describe('the sheet a card is drawn on', () => {
  // A rect with a negative width is invalid SVG: the browser paints nothing, so
  // the paper's fill and outline both vanish and the creases float. The mirror
  // swaps which projected corner is on the left, which is exactly how that
  // happens.
  it('is a real rectangle on the back as well as the front', () => {
    for (const sheet of [model(1, 1), model(2, 1), model(1, 3)]) {
      for (const mirrored of [false, true]) {
        const rect = rectOf(
          renderToStaticMarkup(<StepDiagram primitives={sheet} size={100} mirrored={mirrored} />)
        );
        expect(rect.width, `${sheet.sheet.width}x${sheet.sheet.height} mirrored=${mirrored}`)
          .toBeGreaterThan(0);
        expect(rect.height).toBeGreaterThan(0);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(100);
      }
    }
  });

  it('covers the same square whichever way the paper is facing', () => {
    const front = rectOf(renderToStaticMarkup(<StepDiagram primitives={model(2, 1)} size={100} />));
    const back = rectOf(
      renderToStaticMarkup(<StepDiagram primitives={model(2, 1)} size={100} mirrored />)
    );
    expect(back).toEqual(front);
  });
});

/**
 * Where each drawn piece of a line starts in the dash pattern, and how long it
 * is — read back off the rendered attributes.
 *
 * A crease is drawn as one `<line>` per creased span, and SVG restarts
 * `stroke-dasharray` at each one. Most spans are shorter than a single ink run,
 * so if the pattern restarts they each paint solid: a near-solid crease with a
 * few stray gaps, which is not a valley fold.
 *
 * Asserting the *phase numbers* is what let that ship twice — they were right
 * both times and the sign consuming them was not. This reads the attribute the
 * browser actually obeys.
 */
function pieces(markup: string): { offset: number; length: number }[] {
  return (markup.match(/<line[^>]*>/g) ?? []).map((tag) => {
    const num = (name: string) => Number(tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? 0);
    return {
      offset: num('stroke-dashoffset'),
      length: Math.hypot(num('x2') - num('x1'), num('y2') - num('y1')),
    };
  });
}

describe('a crease split into spans still dashes as one line', () => {
  useTableFolds();

  /** The valley's dash period, as the card actually draws it. */
  const periodOf = (markup: string) =>
    elements(markup, 'line')[0]!['stroke-dasharray']!.split(' ')
      .map(Number)
      .reduce((a, b) => a + b, 0);

  // Six pieces tiling one line, all shorter than a single ink run — the shape
  // markhor's step 1 actually has.
  const spans: [number, number][] = [
    [0, 10],
    [10, 11.7],
    [11.7, 23.4],
    [23.4, 31.7],
    [31.7, 51.7],
    [51.7, 80],
  ];
  const model = (withPhase: boolean): StepDiagramModel => ({
    sheet: { width: 1, height: 1 },
    primitives: spans.map(([from, to]) => ({
      kind: 'line' as const,
      // The projector fits a unit sheet into 80 user units inside a 100 box.
      from: [0.5, from / 80] as const,
      to: [0.5, to / 80] as const,
      style: 'valley' as const,
      ...(withPhase ? { dashPhase: from / 80 } : {}),
    })),
  });

  /** How far the pattern jumps at each seam. Zero is one continuous line. */
  const seamJumps = (markup: string) => {
    const period = periodOf(markup);
    const drawn = pieces(markup).sort((a, b) => a.offset - b.offset);
    const jumps: number[] = [];
    for (let i = 0; i + 1 < drawn.length; i += 1) {
      const expected = (drawn[i].offset + drawn[i].length) % period;
      const actual = drawn[i + 1].offset % period;
      const raw = Math.abs(expected - actual);
      jumps.push(Math.min(raw, period - raw));
    }
    return jumps;
  };

  it('carries the pattern across every seam', () => {
    const jumps = seamJumps(
      renderClient(<StepDiagram primitives={model(true)} size={100} />)
    );
    expect(jumps).toHaveLength(spans.length - 1);
    for (const jump of jumps) expect(jump).toBeLessThan(0.01);
  });

  // The state the reader actually saw: every piece restarting at ink.
  it('would restart at every seam without the phase', () => {
    const jumps = seamJumps(
      renderClient(<StepDiagram primitives={model(false)} size={100} />)
    );
    expect(Math.max(...jumps)).toBeGreaterThan(1);
  });

  // Negating the offset is the bug this replaced: the phases were right and
  // every seam still landed somewhere else in the pattern.
  it('lands in the wrong place if the offset is negated', () => {
    const markup = renderClient(<StepDiagram primitives={model(true)} size={100} />);
    const period = periodOf(markup);
    const drawn = pieces(markup).sort((a, b) => a.offset - b.offset);
    const negated = drawn.map((d) => ({ ...d, offset: -d.offset }));
    const jumps: number[] = [];
    for (let i = 0; i + 1 < negated.length; i += 1) {
      const expected = (((negated[i].offset + negated[i].length) % period) + period) % period;
      const actual = ((negated[i + 1].offset % period) + period) % period;
      const raw = Math.abs(expected - actual);
      jumps.push(Math.min(raw, period - raw));
    }
    expect(Math.max(...jumps)).toBeGreaterThan(1);
  });
});

/**
 * The definition of "drawable at any size", and the thing that was not true
 * before the pen moved out of the stylesheet.
 *
 * Every stroke carried `vector-effect: non-scaling-stroke` and every dash array
 * was a screen-pixel literal, so the same model at eight times the size came
 * out with the same hairline strokes and the same short dashes — a picture of a
 * card, blown up, rather than the same drawing larger.
 */
describe('one model at two sizes', () => {
  const everything: StepDiagramModel = {
    sheet: { width: 1, height: 1 },
    primitives: [
      { kind: 'sheet', width: 1, height: 1 },
      { kind: 'line', from: [0, 0.2], to: [1, 0.2], style: 'valley', dashPhase: 0.13 },
      { kind: 'line', from: [0, 0.4], to: [1, 0.4], style: 'mountain' },
      { kind: 'line', from: [0, 0.6], to: [1, 0.6], style: 'crease' },
      { kind: 'point', at: [0.5, 0.5], style: 'highlight' },
      { kind: 'label', at: [0.5, 0.5], text: 'P', style: 'highlight' },
    ],
  };

  /**
   * The turn-over is drawn from its own transcribed box through a `scale()`, so
   * its attributes are in that box's units and deliberately do *not* grow with
   * the picture — the group they sit in does it for them. Kept out of the sweep
   * below and checked on its rendered size instead.
   */
  const turnOver: StepDiagramModel = {
    sheet: { width: 1, height: 1 },
    primitives: [
      { kind: 'sheet', width: 1, height: 1 },
      { kind: 'turn-over', at: [0.5, 0.8] },
    ],
  };

  /** Every numeric attribute in the markup, tagged by element and name. */
  const numbers = (markup: string) => {
    const found = new Map<string, number[]>();
    for (const [i, tag] of [...markup.matchAll(/<[a-z]+[^>]*>/g)].entries()) {
      for (const attr of tag[0].matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
        const values = attr[2].trim().split(/[\s,]+/).map(Number);
        // A ratio is not a length and must not grow with the box.
        if (attr[1] === 'viewBox' || /opacity$/.test(attr[1])) continue;
        if (values.some((v) => !Number.isFinite(v))) continue;
        found.set(`${i}:${attr[1]}`, values);
      }
    }
    return found;
  };

  it('scales every number by exactly the size ratio', () => {
    const small = numbers(renderToStaticMarkup(<StepDiagram primitives={everything} size={100} />));
    const large = numbers(renderToStaticMarkup(<StepDiagram primitives={everything} size={800} />));
    expect([...large.keys()]).toEqual([...small.keys()]);
    for (const [key, values] of small) {
      const grown = large.get(key)!;
      expect(grown.length, key).toBe(values.length);
      for (const [i, value] of values.entries()) {
        // `transform` carries a scale factor as well as a translation, and a
        // scale does not grow with the box — the glyph it scales is already in
        // user units. Everything else is a length.
        if (key.endsWith(':transform') && i >= 2) continue;
        expect(grown[i], `${key}[${i}]`).toBeCloseTo(value * 8, 6);
      }
    }
  });

  it('grows the turn-over glyph and the pen it is drawn with', () => {
    const drawn = (size: number) => {
      const whole = renderToStaticMarkup(<StepDiagram primitives={turnOver} size={size} />);
      // The glyph's own group — the sheet's outline is a stroke too, and comes
      // first.
      const markup = whole.slice(whole.indexOf('step-diagram__turn-over'));
      const scale = Number(markup.match(/scale\(([\d.]+)\)/)?.[1]);
      const width = Number(markup.match(/stroke-width="([\d.]+)"/)?.[1]);
      // What the glyph actually measures on screen: its own box through the
      // group's scale.
      return { glyph: scale, stroke: width * scale };
    };
    const [small, large] = [drawn(100), drawn(800)];
    // Three decimals: the transform is emitted rounded, so eight times a
    // rounded number is not the rounding of eight times it.
    expect(large.glyph).toBeCloseTo(small.glyph * 8, 3);
    expect(large.stroke).toBeCloseTo(small.stroke * 8, 3);
  });
});

/**
 * A card's dash runs are half the pen's — see `DiagramProjector.dashScale`.
 * The pen's runs suit the canvas, where a dash is read against creases; on a
 * 128 px card a valley's `12.8` ink is an eighth of the paper, and five repeats
 * across a thumbnail read as a few strokes rather than a dashed line.
 */
describe('the dashes on a card', () => {
  useTableFolds();

  const dashed: StepDiagramModel = {
    sheet: { width: 1, height: 1 },
    primitives: [
      { kind: 'sheet', width: 1, height: 1 },
      { kind: 'line', from: [0, 0.2], to: [1, 0.2], style: 'valley' },
      { kind: 'line', from: [0, 0.4], to: [1, 0.4], style: 'mountain' },
    ],
  };
  const ink = createDiagramProjector(dashed.sheet, 100).ink;

  it('are half the pen’s runs, at the pen’s full width', () => {
    const [valley, mountain] = elements(
      renderClient(<StepDiagram primitives={dashed} size={100} />),
      'line'
    );
    const runs = (line: Record<string, string>) => line['stroke-dasharray']!.split(' ').map(Number);
    expect(runs(valley!)).toEqual(DIAGRAM_LINE_INK.valley.dash!.map((run) => run * ink * 0.5));
    expect(runs(mountain!)).toEqual(
      DIAGRAM_LINE_INK.mountain.dash!.map((run) => run * ink * 0.5)
    );
    expect(Number(valley!['stroke-width'])).toBeCloseTo(DIAGRAM_LINE_INK.valley.width * ink, 9);
  });

  // A dash phase is a distance along the line, in the same units as the runs.
  // Halving the runs must not halve it: every span of one line measures from
  // the same zero on the same ruler, whatever pattern is laid along it.
  it('keep the phase on the line’s own ruler', () => {
    const phased: StepDiagramModel = {
      sheet: { width: 1, height: 1 },
      primitives: [
        { kind: 'line', from: [0, 0.2], to: [1, 0.2], style: 'valley', dashPhase: 0.25 },
      ],
    };
    const markup = renderClient(<StepDiagram primitives={phased} size={100} />);
    const [line] = elements(markup, 'line');
    expect(Number(line!['stroke-dashoffset'])).toBeCloseTo(0.25 * 80, 9);
  });
});

/**
 * The letters, read back off the rendered attributes and measured with the
 * same estimate of a glyph's box the layout uses. A letter used to stand off
 * its point by less than the ring's radius plus half a glyph, so it sat on
 * the ring; at the top-left corner it sat under the step number, which is a
 * DOM element over the picture the SVG cannot see.
 */
describe('the letters on a card', () => {
  const at = (x: number, y: number, text: string): StepDiagramModel['primitives'] => [
    { kind: 'point', at: [x, y], style: 'highlight' },
    { kind: 'label', at: [x, y], text, style: 'highlight' },
  ];
  const marked: StepDiagramModel = {
    sheet: { width: 1, height: 1 },
    primitives: [
      { kind: 'sheet', width: 1, height: 1 },
      ...at(0, 1, 'P'),
      ...at(1, 1, 'Q'),
      ...at(0, 0, 'R'),
      ...at(1, 0, 'S'),
      ...at(0.5, 0.5, 'T'),
      { kind: 'label', at: [0.5, 0.5], text: 'A', style: 'highlight' },
    ],
  };

  /** The box a rendered letter fills, by the layout's own estimate. */
  const boxOf = (text: Record<string, string>) => {
    const size = Number(text['font-size']);
    const width = labelWidth(text.text!, size);
    const height = DIAGRAM_LABEL_INK.glyph.height * size;
    const x = Number(text.x);
    const anchor = text['text-anchor'];
    const left = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
    const top = Number(text.y) - DIAGRAM_LABEL_INK.glyph.baseline * height;
    return { x: left, y: top, width, height };
  };
  type Box = ReturnType<typeof boxOf>;
  const overlap = (a: Box, b: Box) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  /** The cards a strip prints: a numbered fold, one with a badge beside the number, one with only a badge. */
  const chromes = [
    { number: 7, badge: '' },
    { number: 107, badge: 'Approximate' },
    { number: 12, badge: 'Приблизительно' },
    { number: null, badge: 'Turn over' },
  ];

  it('cover neither a ring, nor each other, nor the number and badge, and stay on the card', () => {
    for (const mirrored of [false, true]) {
      for (const chrome of chromes) {
        const markup = renderToStaticMarkup(
          <StepDiagram primitives={marked} size={100} mirrored={mirrored} chrome={chrome} />
        );
        const texts = elements(markup, 'text');
        const rings = elements(markup, 'circle');
        expect(texts).toHaveLength(6);
        expect(rings).toHaveLength(5);
        const boxes = texts.map(boxOf);
        const reserved = cardChromeRects(100, chrome);
        boxes.forEach((box, i) => {
          const label = `${texts[i]!.x},${texts[i]!.y} mirrored=${mirrored} ${JSON.stringify(chrome)}`;
          expect(box.x, label).toBeGreaterThanOrEqual(0);
          expect(box.y, label).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width, label).toBeLessThanOrEqual(100);
          expect(box.y + box.height, label).toBeLessThanOrEqual(100);
          for (const corner of reserved) expect(overlap(box, corner), label).toBe(false);
          for (const ring of rings) {
            const cx = Number(ring.cx);
            const cy = Number(ring.cy);
            const outer = Number(ring.r) + Number(ring['stroke-width']) / 2;
            const nx = Math.min(Math.max(cx, box.x), box.x + box.width);
            const ny = Math.min(Math.max(cy, box.y), box.y + box.height);
            expect(Math.hypot(nx - cx, ny - cy), label).toBeGreaterThanOrEqual(outer - 1e-9);
          }
          boxes.forEach((other, j) => {
            if (j !== i) expect(overlap(box, other), label).toBe(false);
          });
        });
      }
    }
  });

  it('are kept off the corners the card prints over, sized by what it prints there', () => {
    const [seven] = cardChromeRects(100, { number: 7, badge: '' });
    const [hundred] = cardChromeRects(100, { number: 107, badge: '' });
    expect(seven!.x).toBe(0);
    expect(seven!.y).toBe(0);
    expect(hundred!.width).toBeGreaterThan(seven!.width);
    // A badge sits beside the number on a fold, against the right edge, and
    // takes the number's corner on a card with no number.
    const [, beside] = cardChromeRects(100, { number: 3, badge: 'Approximate' });
    expect(beside!.x + beside!.width).toBe(100);
    const [alone] = cardChromeRects(100, { number: null, badge: 'Turn over' });
    expect(alone!.x).toBe(0);
    // Wider by the letter, and an ideograph is wider than a letter.
    const widthOf = (badge: string) => cardChromeRects(100, { number: null, badge })[0]!.width;
    expect(widthOf('Приблизительно')).toBeGreaterThan(widthOf('Approximate'));
    expect(widthOf('Approximate')).toBeGreaterThan(widthOf('Grid'));
    expect(widthOf('近似')).toBeGreaterThan(widthOf('ab'));
    expect(widthOf('Приблизительно')).toBeLessThanOrEqual(100);
    expect(cardChromeRects(100, { number: null, badge: '' })).toEqual([]);
  });
});

/**
 * Where the fold arrow turns round. A point folded onto a point ends its
 * journey at the other mark, and a mark is a ring: the stroke used to run to
 * the ring's centre and turn round inside it. A point folded onto a line lands
 * on nothing marked, and the two strokes meet on the line as before.
 */
describe('a fold arrow on a card', () => {
  const sheet = { width: 1, height: 1 };
  const project = createDiagramProjector(sheet, 100);
  const rim = DIAGRAM_MARK_INK.radius * project.ink;

  /** Where the outgoing stroke ends, from the first path of the arrow group. */
  const outgoingEnd = (model: StepDiagramModel) => {
    const markup = renderToStaticMarkup(<StepDiagram primitives={model} size={100} />);
    const arrow = markup.slice(markup.indexOf('step-diagram__arrow'));
    const d = elements(arrow, 'path')[0]!.d!;
    const [x, y] = d.split(' ').slice(-2).map(Number);
    return { x: x!, y: y! };
  };

  it('turns round at the rim of the mark it lands on', () => {
    const p: [number, number] = [0.2, 0.2];
    const q: [number, number] = [0.8, 0.6];
    const out = foldArrowArc(p, q, [0.5, 0.5]);
    if (!out) throw new Error('no arc');
    const model: StepDiagramModel = {
      sheet,
      primitives: [
        { kind: 'sheet', width: 1, height: 1 },
        { kind: 'point', at: p, style: 'highlight' },
        { kind: 'point', at: q, style: 'highlight' },
        { kind: 'fold-arrow', out },
      ],
    };
    const end = outgoingEnd(model);
    const mark = project(q);
    expect(Math.hypot(end.x - mark.x, end.y - mark.y)).toBeCloseTo(rim, 2);
  });

  it('runs all the way to a line it lands on', () => {
    const p: [number, number] = [0.25, 0.8];
    const onLine: [number, number] = [0.8, 0.2];
    const out = foldArrowArc(p, onLine, [0.5, 0.5]);
    if (!out) throw new Error('no arc');
    const model: StepDiagramModel = {
      sheet,
      primitives: [
        { kind: 'sheet', width: 1, height: 1 },
        { kind: 'line', from: [0, 0.2], to: [1, 0.2], style: 'highlight' },
        { kind: 'point', at: p, style: 'highlight' },
        { kind: 'fold-arrow', out },
      ],
    };
    const end = outgoingEnd(model);
    const landing = project(onLine);
    expect(Math.hypot(end.x - landing.x, end.y - landing.y)).toBeLessThan(1e-3);
  });
});

describe('the folds on a card', () => {
  // The style's fold pens, not the table's: a style with solid folds draws a
  // card's folds solid — the finished card's included — and a dashed style
  // its own runs.
  const folds: StepDiagramModel = {
    sheet: { width: 1, height: 1 },
    primitives: [
      { kind: 'sheet', width: 1, height: 1 },
      { kind: 'line', from: [0, 0.2], to: [1, 0.2], style: 'valley' },
      { kind: 'line', from: [0, 0.4], to: [1, 0.4], style: 'mountain' },
    ],
  };

  it('draws them solid when the style’s folds are solid', () => {
    useSettingsStore.getState().setPaperStyleFields('display', {
      mountainFolds: { ...DEFAULT_PAPER_STYLE.mountainFolds, dash: null },
      valleyFolds: { ...DEFAULT_PAPER_STYLE.valleyFolds, dash: null },
    });
    const [valley, mountain] = elements(renderClient(<StepDiagram primitives={folds} size={100} />), 'line');
    expect(valley!['stroke-dasharray']).toBeUndefined();
    expect(mountain!['stroke-dasharray']).toBeUndefined();
  });
});

describe('the aux-pen lines on a card', () => {
  // The `crease` ink — a crease an earlier step made — and the pattern's own
  // `aux` lines are the paper style's aux pen (Phase 5): its width as a ratio
  // to the edge pen at the card's scale, its dash and cap, pulled back from
  // the paper's edge by erode. The made creases are always drawn; the aux
  // lines as the References option says, the style's switch until it is set.
  // Every other line is the step's own and untouched.
  //
  // Rendered on the client, not to static markup: a card reads the style off
  // the settings store, and a server render reads a store's *initial* state.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const renderCard = (element: ReactElement): string => {
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => root.render(element));
    const markup = container.innerHTML;
    act(() => root.unmount());
    return markup;
  };
  const creased = (): StepDiagramModel => ({
    sheet: { width: 1, height: 1 },
    primitives: [
      { kind: 'sheet', width: 1, height: 1 },
      // Edge to edge: both ends on the boundary.
      { kind: 'line', from: [0, 0.5], to: [1, 0.5], style: 'crease' },
      // A valley, for contrast.
      { kind: 'line', from: [0, 0], to: [1, 1], style: 'valley' },
    ],
  });
  const lines = (markup: string) => elements(markup, 'line');
  const crease = (markup: string) => lines(markup).find((line) => line.class?.includes('crease'));
  const setDisplay = (fields: PaperStyleOverrides) =>
    useSettingsStore.getState().setPaperStyleFields('display', fields);

  beforeEach(() => {
    setDisplay({
      'auxCreases.visible': true,
      'auxCreases.pen': DEFAULT_PAPER_STYLE.auxCreases.pen,
      edges: DEFAULT_PAPER_STYLE.edges,
      erode: 0,
    });
    useSettingsStore.getState().setReferencesShowAuxCreases(null);
  });

  it('draws them at the aux pen: width as a ratio to the edge pen, dash in multiples, cap', () => {
    setDisplay({
      'auxCreases.pen': { width: 0.45, color: '#9aa4ad', dash: [4, 2], cap: 'round' },
      edges: { ...DEFAULT_PAPER_STYLE.edges, width: 0.9 },
    });
    const markup = renderCard(<StepDiagram primitives={creased()} size={100} />);
    const line = crease(markup)!;
    const project = createDiagramProjector({ width: 1, height: 1 }, 100);
    // Half the edge pen, so half the table's edge weight.
    const width = DIAGRAM_LINE_INK.edge.width * 0.5 * project.ink;
    expect(Number(line['stroke-width'])).toBeCloseTo(width, 6);
    expect(line['stroke-linecap']).toBe('round');
    // Dash runs are multiples of the width, at the card's dash scale.
    const runs = line['stroke-dasharray']!.split(' ').map(Number);
    expect(runs[0]! / width).toBeCloseTo(4 * project.dashScale, 6);
    expect(runs[1]! / width).toBeCloseTo(2 * project.dashScale, 6);
    // The valley is the style's valley pen, at its own ratio to the edge pen.
    const valley = lines(markup).find((l) => l.class?.includes('valley'))!;
    const valleyPen = useSettingsStore.getState().paperStyle.display.valleyFolds;
    expect(Number(valley['stroke-width'])).toBeCloseTo(
      DIAGRAM_LINE_INK.edge.width * (valleyPen.width / 0.9) * project.ink,
      6
    );
  });

  it('draws the creases an earlier step made whatever the aux switch says', () => {
    setDisplay({ 'auxCreases.visible': false });
    const markup = renderCard(<StepDiagram primitives={creased()} size={100} />);
    expect(crease(markup)).toBeDefined();
    expect(lines(markup)).toHaveLength(2);
  });

  it('shows the pattern’s aux lines as the References option says, the style’s switch until set', () => {
    const withAux = (): StepDiagramModel => ({
      ...creased(),
      primitives: [
        ...creased().primitives,
        { kind: 'line', from: [0.5, 0], to: [0.5, 1], style: 'aux' },
      ],
    });
    const aux = () =>
      lines(renderCard(<StepDiagram primitives={withAux()} size={100} />)).filter((line) =>
        line.class?.includes('--aux')
      );
    expect(aux()).toHaveLength(1);
    setDisplay({ 'auxCreases.visible': false });
    expect(aux()).toHaveLength(0);
    act(() => useSettingsStore.getState().setReferencesShowAuxCreases(true));
    expect(aux()).toHaveLength(1);
    setDisplay({ 'auxCreases.visible': true });
    act(() => useSettingsStore.getState().setReferencesShowAuxCreases(false));
    expect(aux()).toHaveLength(0);
  });

  it('stops short of the paper’s edge by erode, and the valley does not', () => {
    setDisplay({ erode: 0.1 });
    const markup = renderCard(<StepDiagram primitives={creased()} size={100} />);
    const project = createDiagramProjector({ width: 1, height: 1 }, 100);
    const line = crease(markup)!;
    const left = project([0.1, 0.5]);
    const right = project([0.9, 0.5]);
    expect(Number(line.x1)).toBeCloseTo(left.x, 6);
    expect(Number(line.x2)).toBeCloseTo(right.x, 6);
    const valley = lines(markup).find((l) => l.class?.includes('valley'))!;
    expect(Number(valley.x1)).toBeCloseTo(project([0, 0]).x, 6);
  });
});

describe('the same shapes, inked for a file', () => {
  // On screen a shape carries a class and the stylesheet colours it; in a
  // file there is no stylesheet, so the context carries the colours and the
  // shape writes them as attributes and no class at all. One implementation,
  // two outputs — a colour added to `theme.css` and not to the inline ink
  // shows up as a shape the page draws in the wrong colour.
  const tokens: DiagramInlineTokens = {
    '--references-paper-front': '#fff8e1',
    '--references-paper-back': '#d0d0d0',
    '--fold-mountain': '#112233',
    '--fold-valley': '#445566',
    '--fold-border': '#000000',
    '--fold-unassigned': '#aabbcc',
    '--references-crease-alpha': '0.5',
    '--cp-reference-input': '#ff00ff',
    '--bg-primary': '#fafafa',
  };
  const primitives: StepDiagramModel['primitives'] = [
    { kind: 'sheet', width: 1, height: 1 },
    { kind: 'line', from: [0, 0.5], to: [1, 0.5], style: 'crease' },
    { kind: 'line', from: [0, 0.25], to: [1, 0.25], style: 'unfolded' },
    { kind: 'line', from: [0, 0], to: [1, 1], style: 'valley' },
    { kind: 'region', corners: [[0.2, 0], [0.4, 0], [0.4, 1], [0.2, 1]] },
    { kind: 'point', at: [0.5, 0.5], style: 'highlight' },
    { kind: 'label', at: [0.5, 0.5], text: 'A', style: 'highlight' },
    { kind: 'fold-arrow', out: foldArrowArc([0.2, 0.5], [0.8, 0.5], [0.5, 0.5])! },
    { kind: 'turn-over', at: [0.5, 0.5] },
  ];
  const draw = (mirrored: boolean, inline: boolean) => {
    const project = createDiagramProjector({ width: 1, height: 1 }, 100, mirrored);
    const context = createDiagramRenderContext(
      primitives,
      { width: 1, height: 1 },
      project,
      {},
      { showAux: true, erode: 0 },
      inline ? diagramInlineInk(tokens, '#405060') : null
    );
    return renderToStaticMarkup(
      <svg>{primitives.map((primitive, index) => diagramPrimitiveShape(primitive, index, context))}</svg>
    );
  };

  it('gives a letter on the paper the paper’s face for its halo, on screen too', () => {
    const [front] = elements(draw(false, false), 'text');
    expect(front!.class).toContain('step-diagram__label--on-paper');
    const [back] = elements(draw(true, false), 'text');
    expect(back!.class).toContain('step-diagram__label--on-back');
  });

  it('keeps every class on screen, and writes none into a file', () => {
    const screen = draw(false, false);
    expect(screen.match(/class="/g)!.length).toBeGreaterThanOrEqual(primitives.length);
    expect(screen).not.toContain('stroke="#');
    expect(screen).not.toContain('fill="#');
    const file = draw(false, true);
    expect(file).not.toContain('class=');
  });

  it('gives each shape the colour its class would have', () => {
    const file = draw(false, true);
    expect(elements(file, 'rect')[0]).toMatchObject({ fill: '#fff8e1', stroke: '#000000' });
    expect(elements(draw(true, true), 'rect')[0]!.fill).toBe('#d0d0d0');
    const [crease, unfolded, valley] = elements(file, 'line');
    expect(crease).toMatchObject({ fill: 'none', stroke: '#aabbcc', 'stroke-opacity': '0.5' });
    // The pen's own opacity and the ink's compose; a pen alone keeps its own.
    expect(unfolded).toMatchObject({ stroke: '#aabbcc', 'stroke-opacity': '0.28' });
    expect(valley).toMatchObject({ stroke: '#445566' });
    expect(valley!['stroke-opacity']).toBeUndefined();
    const polygons = elements(file, 'polygon');
    expect(polygons[0]).toMatchObject({ fill: '#ff00ff', 'fill-opacity': '0.12', stroke: 'none' });
    // The arrowhead and the turn-over glyph's head: the arrow pen's.
    expect(polygons.slice(1).map((p) => p.fill)).toEqual(['#405060', '#405060']);
    expect(elements(file, 'circle')[0]).toMatchObject({ fill: 'none', stroke: '#000000' });
    // The letter stands on the paper, so its halo is the paper's face: a
    // knock-out of the lines behind it, not a ring of the ground's colour.
    expect(elements(file, 'text')[0]).toMatchObject({
      fill: '#ff00ff',
      stroke: '#fff8e1',
      'paint-order': 'stroke',
      'stroke-linejoin': 'round',
      'font-weight': '700',
    });
    expect(elements(draw(true, true), 'text')[0]!.stroke).toBe('#d0d0d0');
    for (const path of elements(file, 'path')) {
      expect(path).toMatchObject({ fill: 'none', stroke: '#405060' });
    }
  });
});

describe('labelOnPaper', () => {
  // The paper's outline as a projector hands it over: either winding, since a
  // mirrored projector turns it round.
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const box = (x: number, y: number) => ({ x: x - 5, y: y - 6, width: 10, height: 12 });

  it('stands a letter on the paper by its box’s middle', () => {
    expect(labelOnPaper(box(50, 50), square)).toBe(true);
    expect(labelOnPaper(box(50, 50), [...square].reverse())).toBe(true);
    // Pushed off the sheet into the band round it.
    expect(labelOnPaper(box(108, 50), square)).toBe(false);
    expect(labelOnPaper(box(50, -8), [...square].reverse())).toBe(false);
  });

  it('puts nothing on paper that has no outline', () => {
    expect(labelOnPaper(box(50, 50), [])).toBe(false);
  });
});
