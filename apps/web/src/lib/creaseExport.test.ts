import { describe, expect, it } from 'vitest';
import type { FoldDocument } from '../engine/types';
import { segmentFoldDocument } from './creasePatternSegmentation';
import { serializeCreasePatternSvg, DEFAULT_CREASE_EXPORT_OPTIONS } from './creaseExport';

// A square (border) split by a mountain and a valley diagonal, plus a second
// disjoint square, so segmentation yields two crease patterns.
function twoPatternFold(): FoldDocument {
  return {
    vertices_coords: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0.5, 0.5],
      [3, 0],
      [4, 0],
      [4, 1],
      [3, 1],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [0, 4],
      [4, 2],
      [1, 4],
      [4, 3],
      [5, 6],
      [6, 7],
      [7, 8],
      [8, 5],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'M', 'M', 'V', 'V', 'B', 'B', 'B', 'B'],
    faces_vertices: [
      [0, 1, 4],
      [1, 2, 4],
      [2, 3, 4],
      [3, 0, 4],
      [5, 6, 7, 8],
    ],
  };
}

describe('crease pattern export', () => {
  it('serializes a fold to SVG with lines and background facets', () => {
    const fold = twoPatternFold();
    const segments = segmentFoldDocument(fold);
    const svg = serializeCreasePatternSvg(fold, segments, DEFAULT_CREASE_EXPORT_OPTIONS);

    expect(svg).toContain('<svg');
    expect(svg).toContain('<line');
    expect(svg).toContain('<polygon'); // background facets
  });

  it('colors creases by assignment in the color line style', () => {
    const fold = twoPatternFold();
    const segments = segmentFoldDocument(fold);
    const svg = serializeCreasePatternSvg(fold, segments, {
      ...DEFAULT_CREASE_EXPORT_OPTIONS,
      lineStyle: 'color',
    });

    expect(svg).toContain('stroke="#ff4d5d"'); // mountain
    expect(svg).toContain('stroke="#60a5fa"'); // valley
    expect(svg).toContain('stroke="#111417"'); // border
  });

  it('draws every crease black in the black-white style', () => {
    const fold = twoPatternFold();
    const segments = segmentFoldDocument(fold);
    const svg = serializeCreasePatternSvg(fold, segments, {
      ...DEFAULT_CREASE_EXPORT_OPTIONS,
      lineStyle: 'black-white',
    });

    expect(svg).toContain('stroke="#000000"');
    expect(svg).not.toContain('stroke="#ff4d5d"');
  });

  it('exports a single segment when a segmentId is given', () => {
    const fold = twoPatternFold();
    const segments = segmentFoldDocument(fold);
    const all = serializeCreasePatternSvg(fold, segments, DEFAULT_CREASE_EXPORT_OPTIONS);
    const one = serializeCreasePatternSvg(fold, segments, {
      ...DEFAULT_CREASE_EXPORT_OPTIONS,
      segmentId: segments[0]!.id,
    });

    // The whole document has more lines than a single pattern.
    const countLines = (svg: string) => svg.match(/<line /g)?.length ?? 0;
    expect(segments).toHaveLength(2);
    expect(countLines(one)).toBeLessThan(countLines(all));
  });

  it('hides vertex points when point size is zero', () => {
    const fold = twoPatternFold();
    const segments = segmentFoldDocument(fold);
    const withPoints = serializeCreasePatternSvg(fold, segments, {
      ...DEFAULT_CREASE_EXPORT_OPTIONS,
      pointSize: 2,
    });
    const noPoints = serializeCreasePatternSvg(fold, segments, {
      ...DEFAULT_CREASE_EXPORT_OPTIONS,
      pointSize: 0,
    });

    expect(withPoints).toContain('<circle');
    expect(noPoints).not.toContain('<circle');
  });
});
