import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StepDiagram } from './StepDiagram';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';

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
  // A valley is `stroke-dasharray: 12.8 6.4` in theme.css.
  const period = 12.8 + 6.4;

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
