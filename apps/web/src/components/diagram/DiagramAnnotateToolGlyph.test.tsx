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
