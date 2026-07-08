import { describe, expect, it } from 'vitest';
import type { FoldDocument } from '../engine/types';
import {
  buildSegmentFold,
  pointInSegment,
  segmentFoldDocument,
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
});
