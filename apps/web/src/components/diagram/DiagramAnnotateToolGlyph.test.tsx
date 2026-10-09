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

describe('the x-ray’s icon (Revision 3, 18f)', () => {
  it('is a heavy ring with a few short dashes inside it in staggered rows, clear of the rim: not the M of a mountain', () => {
    const markup = renderToStaticMarkup(<DiagramAnnotationGlyph kind="x-ray" />);
    const dashes = part(markup, 'dashes');
    // Each dash drawn as itself, not by a dash pattern: a handful, in two rows.
    expect(markup).not.toMatch(/stroke-dasharray="[^"]+"[^>]*data-glyph-part="dashes"/);
    expect(dashes.runs).toBeGreaterThanOrEqual(4);
    expect(dashes.runs).toBeLessThanOrEqual(6);
    // Every dash level (no zigzag), a dash and not a dot — longer than the Hidden Line's dots, which read as a grille
    // at the rail's size (review of 18f) — and inside the ring's inner edge.
    const hidden = /<path [^>]*stroke-dasharray="([\d.]+)/.exec(renderToStaticMarkup(<DiagramAnnotationGlyph kind="hidden-line" />))![1];
    const rim = /<circle cx="10" cy="10" r="([\d.]+)" stroke-width="([\d.]+)" data-glyph-part="rim"/.exec(markup)!;
    const inner = Number(rim[1]) - Number(rim[2]) / 2;
    const rows = new Map<number, number[]>();
    for (let run = 0; run < dashes.runs; run += 1) {
      const [[ax, ay], [bx, by]] = [dashes.points[2 * run]!, dashes.points[2 * run + 1]!];
      expect(ay).toBe(by);
      expect(Math.abs(bx - ax)).toBeGreaterThan(2 * Number(hidden));
      // Its butt ends' corners, half its pen above and below, clear of the rim.
      for (const x of [ax, bx]) expect(Math.hypot(x - 10, Math.abs(ay - 10) + dashes.width / 2)).toBeLessThan(inner);
      rows.set(ay, [...(rows.get(ay) ?? []), (ax + bx) / 2]);
    }
    // Two rows, staggered: no dash straight under another, so they read as lines and not as a grid.
    expect(rows.size).toBe(2);
    const [upper, lower] = [...rows.values()];
    for (const middle of lower!) for (const above of upper!) expect(Math.abs(middle - above)).toBeGreaterThan(1);
    expect(markup).not.toContain('data-glyph-part="layers"');
  });
});
