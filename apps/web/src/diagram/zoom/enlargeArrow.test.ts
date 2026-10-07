import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { DEFAULT_DIAGRAM_STYLE } from '../document/diagramDocument';
import golden from './__fixtures__/enlargeArrowGolden.json';
import { ENLARGE_ARROW_CHORD_MM, enlargeArrowMm, paintEnlargeArrow } from './enlargeArrow';

const style = DEFAULT_DIAGRAM_STYLE;

/**
 * The outline a painted arrow draws, in its target's units: its path's points
 * as the group round it places them, and the pen it is stroked in.
 */
function outline(markup: string): { points: [number, number][]; pen: number } {
  const unmirrored = markup.replace(/^<g transform="matrix\(-1 0 0 1 ([-\d.]+) 0\)">/, '');
  const across = unmirrored === markup ? null : Number(/matrix\(-1 0 0 1 ([-\d.]+) 0\)/.exec(markup)![1]);
  const [, tx, ty, k] = /<g transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)">/.exec(unmirrored)!.map(Number);
  const path = /<path d="(M[^"]*Z)"[^>]*stroke-width="([\d.]+)"/.exec(unmirrored)!;
  const numbers = path[1]!.match(/-?[\d.]+/g)!.map(Number);
  const points: [number, number][] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    const x = tx! + numbers[index]! * k!;
    points.push([across === null ? x : across - x, ty! + numbers[index + 1]! * k!]);
  }
  return { points, pen: Number(path[2]) * k! };
}

const box = (points: readonly [number, number][]) => {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

if (process.env.ENLARGE_ARROW_GOLDEN_WRITE) {
  const at = { x: 50, y: 30 };
  const recorded = {
    leftToRight: paintEnlargeArrow(at, 1, style)!.markup,
    rightToLeft: paintEnlargeArrow(at, 1, style, { rightToLeft: true })!.markup,
  };
  writeFileSync(join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'enlargeArrowGolden.json'), `${JSON.stringify(recorded, null, 1)}\n`);
}

describe('the enlarge arrow (Revision 2)', () => {
  it('prints in a box measured from its painted outline: its chord, its head, its pen', () => {
    const { w, h } = enlargeArrowMm(style);
    const drawn = outline(paintEnlargeArrow({ x: 0, y: 0 }, 1, style)!.markup);
    const { minX, maxX, minY, maxY } = box(drawn.points);
    // The outline's box with its pen round it, in mm, as the marks' own reach measures a white arrow's
    // stroked outline (`markReach`): within a tenth of a millimetre.
    expect(Math.abs(w - (maxX - minX + drawn.pen))).toBeLessThan(0.1);
    expect(Math.abs(h - (maxY - minY + drawn.pen))).toBeLessThan(0.1);
    // Longer than its chord, with its tapered tail and its head; taller than its 7.94 mm head is wide once turned down to its tip.
    expect(w).toBeGreaterThan(ENLARGE_ARROW_CHORD_MM);
    expect(w).toBeLessThan(13);
    expect(h).toBeGreaterThan(7);
    expect(h).toBeLessThan(10);
  });

  it('measures its box in the style it prints in: a heavier arrows pen, a larger box', () => {
    const heavy = { style: { ...DEFAULT_PAPER_STYLE, arrows: { ...DEFAULT_PAPER_STYLE.arrows, width: 3 } } };
    const light = enlargeArrowMm(style);
    const { w, h } = enlargeArrowMm(heavy);
    const drawn = outline(paintEnlargeArrow({ x: 40, y: 25 }, 1, heavy)!.markup);
    const { minX, maxX, minY, maxY } = box(drawn.points);
    // A 3 pt pen against the Diagram preset's 0.75 pt: the box grows on every side.
    expect(drawn.pen).toBeGreaterThan(1);
    expect(w).toBeGreaterThan(light.w + drawn.pen / 2);
    expect(h).toBeGreaterThan(light.h + drawn.pen / 3);
    // Round the outline, its corners mitred as its stroke mitres them: at most 1.5 half-pens past each.
    expect(w).toBeGreaterThan(maxX - minX);
    expect(w).toBeLessThanOrEqual(maxX - minX + 1.5 * drawn.pen + 1e-6);
    expect(h).toBeGreaterThan(maxY - minY);
    expect(h).toBeLessThanOrEqual(maxY - minY + 1.5 * drawn.pen + 1e-6);
  });

  it('is centred on its place, bowed up, and mirrored on a row read right to left, its bow kept up', () => {
    for (const rightToLeft of [false, true]) {
      const at = { x: 40, y: 25 };
      const { points } = outline(paintEnlargeArrow(at, 1, style, { rightToLeft })!.markup);
      const { minX, maxX, minY, maxY } = box(points);
      expect((minX + maxX) / 2, String(rightToLeft)).toBeCloseTo(at.x, 1);
      expect((minY + maxY) / 2, String(rightToLeft)).toBeCloseTo(at.y, 1);
      // Its highest point is the bow's, in its middle third, not an end.
      const top = points.find(([, y]) => y === minY)!;
      expect(Math.abs(top[0] - at.x), String(rightToLeft)).toBeLessThan((maxX - minX) / 3);
    }
    // Mirrored: the one's points are the other's, reflected about its place.
    const ltr = outline(paintEnlargeArrow({ x: 40, y: 25 }, 1, style)!.markup).points;
    const rtl = outline(paintEnlargeArrow({ x: 40, y: 25 }, 1, style, { rightToLeft: true })!.markup).points;
    rtl.forEach(([x, y], index) => {
      expect(x).toBeCloseTo(80 - ltr[index]![0], 2);
      expect(y).toBeCloseTo(ltr[index]![1], 6);
    });
  });

  it('paints as recorded, both ways', () => {
    const at = { x: 50, y: 30 };
    expect({
      leftToRight: paintEnlargeArrow(at, 1, style)!.markup,
      rightToLeft: paintEnlargeArrow(at, 1, style, { rightToLeft: true })!.markup,
    }).toEqual(golden);
  });
});
