import { describe, expect, it } from 'vitest';
import type { FoldDocument } from '../../engine/types';
import { segmentFoldDocument } from '../../lib/creasePatternSegmentation';
import { segmentSheetThumbnail } from './segmentSheet';

/**
 * Two disjoint squares: the left one split by a mountain diagonal, the right
 * one by four spokes from its centre — two valleys and two flat lines.
 */
function twoSquares(): FoldDocument {
  return {
    vertices_coords: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [20, 0],
      [30, 0],
      [30, 10],
      [20, 10],
      [25, 5],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [0, 2],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [4, 8],
      [5, 8],
      [6, 8],
      [7, 8],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'M', 'B', 'B', 'B', 'B', 'V', 'F', 'V', 'F'],
    faces_vertices: [
      [0, 1, 2],
      [0, 2, 3],
      [4, 5, 8],
      [5, 6, 8],
      [6, 7, 8],
      [7, 4, 8],
    ],
  };
}

describe('segmentSheetThumbnail', () => {
  it('draws a segment as its edges, each once, classed by assignment', () => {
    const fold = twoSquares();
    const [left, right] = segmentFoldDocument(fold);
    const kinds = segmentSheetThumbnail(fold, left!)?.strokes.map((stroke) => stroke.kind) ?? [];
    // Four border edges and the diagonal, each edge once though two faces share it.
    expect(kinds).toHaveLength(5);
    expect(kinds.filter((kind) => kind === 'border')).toHaveLength(4);
    expect(kinds).toContain('mountain');
    // The border draws last, over the creases that end on it.
    expect(kinds[kinds.length - 1]).toBe('border');

    const rightKinds =
      segmentSheetThumbnail(fold, right!)?.strokes.map((stroke) => stroke.kind) ?? [];
    expect(rightKinds).toHaveLength(8);
    expect(rightKinds.filter((kind) => kind === 'valley')).toHaveLength(2);
    // A flat line has no direction to colour: the same "other" the References cards use.
    expect(rightKinds.filter((kind) => kind === 'other')).toHaveLength(2);
  });

  it('fits each segment into its own box, the same way up as the editor', () => {
    const fold = twoSquares();
    const [left] = segmentFoldDocument(fold);
    const thumbnail = segmentSheetThumbnail(fold, left!);
    expect(thumbnail?.viewBox).toBe('0 0 100 100');
    for (const stroke of thumbnail?.strokes ?? []) {
      for (const value of [stroke.x1, stroke.y1, stroke.x2, stroke.y2]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
    // FOLD is y-down like SVG, so the top edge of the paper is the top of the card.
    const top = thumbnail?.strokes.find(
      (stroke) => stroke.kind === 'border' && stroke.y1 === 0 && stroke.y2 === 0
    );
    expect(top).toBeDefined();
  });
});
