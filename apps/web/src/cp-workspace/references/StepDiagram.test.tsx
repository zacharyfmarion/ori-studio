import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { cardChromeRects, StepDiagram } from './StepDiagram';
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
        [...match[0].matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map((attr) => [attr[1], attr[2]])
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
      renderToStaticMarkup(<StepDiagram primitives={model(true)} size={100} />)
    );
    expect(jumps).toHaveLength(spans.length - 1);
    for (const jump of jumps) expect(jump).toBeLessThan(0.01);
  });

  // The state the reader actually saw: every piece restarting at ink.
  it('would restart at every seam without the phase', () => {
    const jumps = seamJumps(
      renderToStaticMarkup(<StepDiagram primitives={model(false)} size={100} />)
    );
    expect(Math.max(...jumps)).toBeGreaterThan(1);
  });

  // Negating the offset is the bug this replaced: the phases were right and
  // every seam still landed somewhere else in the pattern.
  it('lands in the wrong place if the offset is negated', () => {
    const markup = renderToStaticMarkup(<StepDiagram primitives={model(true)} size={100} />);
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
      renderToStaticMarkup(<StepDiagram primitives={dashed} size={100} />),
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
    const markup = renderToStaticMarkup(<StepDiagram primitives={phased} size={100} />);
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
