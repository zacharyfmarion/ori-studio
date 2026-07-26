import { describe, expect, it } from 'vitest';
import type { FoldDocument } from '../engine/types';
import {
  buildSegmentFold,
  pointInSegment,
  segmentFoldDocument,
  segmentThumbnailSvg,
} from './creasePatternSegmentation';

function unitSquare(offsetX: number, baseVertex: number): {
  coords: number[][];
  edges: [number, number][];
  face: number[];
} {
  const v = baseVertex;
  return {
    coords: [
      [offsetX, 0],
      [offsetX + 1, 0],
      [offsetX + 1, 1],
      [offsetX, 1],
    ],
    edges: [
      [v, v + 1],
      [v + 1, v + 2],
      [v + 2, v + 3],
      [v + 3, v],
    ],
    face: [v, v + 1, v + 2, v + 3],
  };
}

describe('segmentFoldDocument', () => {
  it('separates two fully disjoint squares', () => {
    const a = unitSquare(0, 0);
    const b = unitSquare(2, 4);
    const fold: FoldDocument = {
      vertices_coords: [...a.coords, ...b.coords],
      edges_vertices: [...a.edges, ...b.edges],
      edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'B', 'B'],
      faces_vertices: [a.face, b.face],
    };
    const segments = segmentFoldDocument(fold);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.faceIndices).toHaveLength(1);
    // Deterministic reading order: left square (minX 0) is first.
    expect(segments[0]!.bounds.minX).toBe(0);
    expect(segments[1]!.bounds.minX).toBe(2);
  });

  it('separates two squares that share a border edge', () => {
    // Square A: 0,1,2,3. Square B reuses edge 1-2 and adds vertices 4,5.
    const fold: FoldDocument = {
      vertices_coords: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [2, 0],
        [2, 1],
      ],
      edges_vertices: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [1, 4],
        [4, 5],
        [5, 2],
      ],
      edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'B'],
      faces_vertices: [
        [0, 1, 2, 3],
        [1, 4, 5, 2],
      ],
    };
    const segments = segmentFoldDocument(fold);
    expect(segments).toHaveLength(2);
  });

  it('keeps a square split by an interior valley crease as one segment', () => {
    const fold: FoldDocument = {
      vertices_coords: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      edges_vertices: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [0, 2],
      ],
      edges_assignment: ['B', 'B', 'B', 'B', 'V'],
      faces_vertices: [
        [0, 1, 2],
        [0, 2, 3],
      ],
    };
    const segments = segmentFoldDocument(fold);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.faceIndices).toHaveLength(2);
    // Boundary ring excludes the interior crease: the square perimeter.
    expect(pointInSegment(segments[0]!, { x: 0.5, y: 0.5 })).toBe(true);
    expect(pointInSegment(segments[0]!, { x: 5, y: 5 })).toBe(false);
  });

  it('reads the paper plane when the fold lies in X-Z (simulator coords)', () => {
    // Simulator folds use [x, 0, z]: paper in X-Z, Y is the flat normal.
    const fold: FoldDocument = {
      vertices_coords: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 1],
        [0, 0, 1],
      ],
      edges_vertices: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
      ],
      edges_assignment: ['B', 'B', 'B', 'B'],
      faces_vertices: [[0, 1, 2, 3]],
    };
    const [segment] = segmentFoldDocument(fold);
    // Bounds must be non-degenerate in both display axes (X and Z, not Y).
    expect(segment!.bounds.maxX - segment!.bounds.minX).toBeCloseTo(1);
    expect(segment!.bounds.maxY - segment!.bounds.minY).toBeCloseTo(1);
    expect(segment!.boundary[0]?.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps a border wall when another crease is drawn over it', () => {
    // Authors lay down reference lines and draw the real crease on top, so the
    // same span can carry two assignments. The border must still divide the two
    // squares regardless of which one is stored last.
    const a = unitSquare(0, 0);
    const b = unitSquare(1, 0);
    const fold: FoldDocument = {
      vertices_coords: [...a.coords, ...b.coords],
      edges_vertices: [...a.edges, ...b.edges, a.edges[1]!],
      // The duplicate of the shared wall is stored last, as a valley.
      edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'B', 'B', 'V'],
      faces_vertices: [a.face, b.face],
    };
    expect(segmentFoldDocument(fold)).toHaveLength(2);
  });

  it('returns no segments for an empty fold', () => {
    expect(segmentFoldDocument({ vertices_coords: [], edges_vertices: [], faces_vertices: [] })).toEqual(
      []
    );
  });
});

describe('buildSegmentFold', () => {
  it('re-indexes a segment into a compact, self-contained fold', () => {
    const a = unitSquare(0, 0);
    const b = unitSquare(2, 4);
    const fold: FoldDocument = {
      vertices_coords: [...a.coords, ...b.coords],
      edges_vertices: [...a.edges, ...b.edges],
      edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'B', 'B'],
      faces_vertices: [a.face, b.face],
    };
    const segments = segmentFoldDocument(fold);
    const sub = buildSegmentFold(fold, segments[1]!); // right square
    expect(sub.vertices_coords).toHaveLength(4);
    expect(sub.edges_vertices).toHaveLength(4);
    expect(sub.faces_vertices).toHaveLength(1);
    expect(sub.faces_vertices[0]).toEqual([0, 1, 2, 3]);
    expect(sub.edges_assignment).toEqual(['B', 'B', 'B', 'B']);
    // Coordinates preserved (right square starts at x=2).
    expect(sub.vertices_coords[0]).toEqual([2, 0]);
    // Whole-sheet derived arrays are dropped so prepareFoldModel rebuilds them.
    expect(sub.faces_edges).toBeUndefined();
    expect(sub.edges_faces).toBeUndefined();
  });

  it('re-indexes edge-aligned extension arrays alongside the edges', () => {
    // The kernel's FOLD export carries per-edge extensions (line colors, custom
    // colors) positionally. Carrying them into a sub-fold unchanged pairs each
    // kept edge with a *different* edge's colour — and on re-import the line
    // colour extension outranks edges_assignment, so the crease types come back
    // scrambled.
    const a = unitSquare(0, 0);
    const b = unitSquare(2, 4);
    const fold: FoldDocument = {
      vertices_coords: [...a.coords, ...b.coords],
      edges_vertices: [...a.edges, ...b.edges],
      edges_assignment: ['M', 'M', 'M', 'M', 'B', 'B', 'B', 'B'],
      faces_vertices: [a.face, b.face],
      // Left square = mountains (1), right square = borders (0).
      'oristudio:edges_line_colors': [1, 1, 1, 1, 0, 0, 0, 0],
      'oriedita:edges_colors': ['', '', '', '', '#ff0000', '#ff0000', '#ff0000', '#ff0000'],
    };
    const segments = segmentFoldDocument(fold);
    const sub = buildSegmentFold(fold, segments[1]!); // right square: edges 4..7

    expect(sub.edges_assignment).toEqual(['B', 'B', 'B', 'B']);
    expect(sub['oristudio:edges_line_colors']).toEqual([0, 0, 0, 0]);
    expect(sub['oriedita:edges_colors']).toEqual(['#ff0000', '#ff0000', '#ff0000', '#ff0000']);
  });
});
describe('cpThumbnailSvg', () => {
  it('draws thumbnails the same way up as the export and the editor', () => {
    // Shares the y-down convention with foldProjector; flipping here left the
    // export dialog's thumbnails upside down next to their own preview.
    const fold: FoldDocument = {
      vertices_coords: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      edges_vertices: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
      ],
      edges_assignment: ['B', 'M', 'B', 'B'],
      faces_vertices: [[0, 1, 2, 3]],
    };
    const [segment] = segmentFoldDocument(fold);
    const svg = segmentThumbnailSvg(fold, segment!, { size: 100 });

    // The mountain crease is the y=0..10 edge at x=10; find every drawn y.
    const ys = [...svg.matchAll(/y1="([\d.]+)" x2="[\d.]+" y2="([\d.]+)"/g)]
      .flatMap((m) => [Number(m[1]), Number(m[2])]);
    expect(ys.length).toBeGreaterThan(0);

    // Project the corners directly and confirm low fold y ⇒ low SVG y.
    const topEdge = svg.match(/x1="([\d.]+)" y1="([\d.]+)"/);
    expect(topEdge).not.toBeNull();
    expect(Math.min(...ys)).toBeLessThan(Math.max(...ys));
    // The first drawn edge starts at fold (0,0), which must be the topmost point.
    expect(Number(topEdge![2])).toBeCloseTo(Math.min(...ys), 5);
  });
});
