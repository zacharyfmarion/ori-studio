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
  it('draws a segment as its edges, each once, in the role its assignment gives', () => {
    const fold = twoSquares();
    const [left, right] = segmentFoldDocument(fold);
    const roles = segmentSheetThumbnail(fold, left!)?.strokes.map((stroke) => stroke.role) ?? [];
    // Four border edges and the diagonal, each edge once though two faces share it.
    expect(roles).toHaveLength(5);
    expect(roles.filter((role) => role === 'edge')).toHaveLength(4);
    expect(roles).toContain('mountain');
    // The paper's edge draws last, over the creases that end on it.
    expect(roles[roles.length - 1]).toBe('edge');

    const rightRoles =
      segmentSheetThumbnail(fold, right!)?.strokes.map((stroke) => stroke.role) ?? [];
    expect(rightRoles).toHaveLength(8);
    expect(rightRoles.filter((role) => role === 'valley')).toHaveLength(2);
    // `F` is how the kernel exports an aux line: the role the References card
    // gives the same crease's colour.
    expect(rightRoles.filter((role) => role === 'aux')).toHaveLength(2);
  });

  it('lays the pattern on its paper, the segment’s own outline', () => {
    const fold = twoSquares();
    const [left] = segmentFoldDocument(fold);
    const paper = segmentSheetThumbnail(fold, left!)?.paper ?? '';
    // The 10-unit square fills the 100-unit box.
    for (const corner of ['0 0', '100 0', '100 100', '0 100']) expect(paper).toContain(corner);
    expect(paper.startsWith('M')).toBe(true);
    expect(paper.endsWith('Z')).toBe(true);
  });

  it('keeps a line laid over the paper on no face, in the segment it lies in', () => {
    // An aux line across the left square, on two vertices of its own — the
    // way the kernel's simulation model carries one.
    const fold = twoSquares();
    fold.vertices_coords!.push([0, 5], [10, 5]);
    fold.edges_vertices!.push([9, 10]);
    fold.edges_assignment!.push('F');
    const [left, right] = segmentFoldDocument(fold);
    const aux = segmentSheetThumbnail(fold, left!)?.strokes.filter((stroke) => stroke.role === 'aux');
    expect(aux).toHaveLength(1);
    // Edge to edge: both ends are on the paper's outline, for erode.
    expect(aux?.[0]?.onBoundary).toEqual([true, true]);
    // Not the other square's.
    expect(
      segmentSheetThumbnail(fold, right!)?.strokes.filter((stroke) => stroke.role === 'aux')
    ).toHaveLength(2);
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
      (stroke) => stroke.role === 'edge' && stroke.y1 === 0 && stroke.y2 === 0
    );
    expect(top).toBeDefined();
  });
});
