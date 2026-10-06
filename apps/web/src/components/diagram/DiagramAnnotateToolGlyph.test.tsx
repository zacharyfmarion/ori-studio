import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DiagramAnnotationGlyph } from './DiagramAnnotateToolGlyph';

/** A glyph's part, by its data attribute: its path's points and its stroke's width (the icon's 1.5 unless said). */
function part(markup: string, name: string): { points: [number, number][]; width: number; runs: number } {
  const element = new RegExp(`<path [^>]*data-glyph-part="${name}"[^>]*>`).exec(markup)![0];
  const d = /\sd="([^"]+)"/.exec(element)![1]!;
  const width = /stroke-width="([\d.]+)"/.exec(element);
  return {
    points: [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(([, x, y]) => [Number(x), Number(y)]),
    width: width ? Number(width[1]) : 1.5,
    runs: d.match(/M/g)!.length,
  };
}

describe('the right angle’s icon (RA7)', () => {
  it('draws the mark set into the corner of two lines, clear of them: the inset is what it shows', () => {
    const markup = renderToStaticMarkup(<DiagramAnnotationGlyph kind="right-angle" />);
    const lines = part(markup, 'lines');
    const mark = part(markup, 'mark');
    // The lines in a hairline: an ∟ whose corner is the vertex.
    expect(lines.width).toBe(1);
    const [, vertex] = lines.points;
    // The mark, its ∟ and its square, a clear gap inside each line, half of both strokes and more.
    expect(mark.runs).toBe(2);
    const clear = (lines.width + mark.width) / 2;
    for (const [x, y] of mark.points) {
      expect(x - vertex![0]).toBeGreaterThan(clear);
      expect(vertex![1] - y).toBeGreaterThan(clear);
    }
  });
});

describe('equal divisions’ icon (Revision 2)', () => {
  it('draws the template’s |\\|\\| symbol: a line in a hairline, three dividers straddling it, a tick leaning across each part', () => {
    const markup = renderToStaticMarkup(<DiagramAnnotationGlyph kind="divisions" />);
    const line = part(markup, 'line');
    const dividers = part(markup, 'dividers');
    const ticks = part(markup, 'ticks');
    expect(line.width).toBe(1);
    const [[x0, y], [x1]] = line.points as [[number, number], [number, number]];
    expect(dividers.runs).toBe(3);
    // Each divider square to the line and straddling it evenly; the end ones at its ends.
    for (let i = 0; i < 3; i += 1) {
      const [[ax, ay], [bx, by]] = [dividers.points[2 * i]!, dividers.points[2 * i + 1]!];
      expect(ax).toBe(bx);
      expect(y - ay).toBeCloseTo(by - y, 9);
    }
    expect([dividers.points[0]![0], dividers.points[4]![0]]).toEqual([x0, x1]);
    // A tick on each part, leaning 20° off square as a backslash does: down to the right.
    expect(ticks.runs).toBe(2);
    for (let i = 0; i < 2; i += 1) {
      const [[ax, ay], [bx, by]] = [ticks.points[2 * i]!, ticks.points[2 * i + 1]!];
      expect(bx - ax).toBeGreaterThan(0);
      expect((Math.atan2(bx - ax, by - ay) * 180) / Math.PI).toBeCloseTo(20, 0);
    }
  });
});
