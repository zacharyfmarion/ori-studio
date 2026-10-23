import { describe, expect, it } from 'vitest';
import { projectPaperAnchor } from './paperProjection';
import type { DiagramPaperProjection } from '../document/diagramDocument';

const projection: DiagramPaperProjection = {
  points: [
    [0, 0, 0, 0, 1],
    [1, 0, 2, 0, 0.5],
    [0, 1, 0, 1, 1],
  ],
  triangles: [[4, 0, 1, 2]],
};
describe('piecewise paper anchors', () => {
  it('uses perspective-correct weights in both directions', () => {
    const drawn = projectPaperAnchor(projection, 4, [0.5, 0.25])!;
    expect(drawn[0]).toBeCloseTo(2 / 3, 12);
    expect(drawn[1]).toBeCloseTo(1 / 3, 12);
    const source = projectPaperAnchor(projection, 4, drawn, true)!;
    expect(source[0]).toBeCloseTo(0.5, 12);
    expect(source[1]).toBeCloseTo(0.25, 12);
  });
  it('never substitutes a different face when the requested face has no mapping', () => {
    expect(projectPaperAnchor(projection, 3, [0.5, 0.25])).toBeNull();
  });
  it('keeps a hidden face anchor using the unoccluded source mesh', () => {
    const changed: DiagramPaperProjection = {
      ...projection,
      points: projection.points.map(([u, v, x, y, w]) => [u, v, x + 7, y - 3, w]),
    };
    const start = projectPaperAnchor(projection, 4, [0.5, 0.25])!;
    const moved = projectPaperAnchor(changed, 4, projectPaperAnchor(projection, 4, start, true)!)!;
    expect(moved[0] - start[0]).toBeCloseTo(7, 12);
    expect(moved[1] - start[1]).toBeCloseTo(-3, 12);
  });
});
