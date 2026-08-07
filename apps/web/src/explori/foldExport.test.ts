import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/queryResponse.json';
import {
  EDIT_PAPER_SIZE,
  exploriCpHasDistinctVertices,
  exploriCpToFoldObject,
  exploriCpVertices,
  exploriVertexToPlane,
  foldAssignmentFor,
} from './foldExport';
import type { ExploriCp } from './types';

/**
 * The fixture is a real response from `225.designorigami.net`, captured with one
 * query (tiling `4b.61865`). Everything here is asserted against what the
 * archive actually sends rather than against a shape we invented for it.
 */
const cp = fixture.results[0].cp as unknown as ExploriCp;

describe('crease assignments', () => {
  it('maps upstream line types the way upstream itself exports them', () => {
    expect(foldAssignmentFor('b')).toBe('B');
    expect(foldAssignmentFor('m')).toBe('M');
    expect(foldAssignmentFor('v')).toBe('V');
    // Both of upstream's undetermined types land on the Edit canvas's auxiliary
    // colour: `Assignment::Flat → LineColor::Cyan3`.
    expect(foldAssignmentFor('h')).toBe('F');
    expect(foldAssignmentFor('aux')).toBe('F');
  });

  it('falls back rather than dropping an edge it does not recognise', () => {
    expect(foldAssignmentFor('')).toBe('F');
    // Upstream's own last resort: an unfamiliar type containing an `m` or a `v`
    // is read as that crease rather than discarded.
    expect(foldAssignmentFor('unexpected-m')).toBe('M');
    expect(foldAssignmentFor('curved')).toBe('V');
    expect(foldAssignmentFor('?')).toBe('F');
  });

  it('carries every crease type the fixture contains', () => {
    const assignments = new Set(cp.edges.map(([, , type]) => foldAssignmentFor(type)));
    expect(assignments).toEqual(new Set(['B', 'M', 'V', 'F']));
  });
});

describe('exact coordinates', () => {
  it('reads the rational components as a point in the plane', () => {
    // The origin, as eight integers.
    expect(exploriVertexToPlane([0, 1, 0, 1, 0, 1, 0, 1])).toEqual([0, 0]);
    // A pure √2/2 component in y, which lands on both axes.
    const [x, y] = exploriVertexToPlane([0, 1, 1, 1, 0, 1, 0, 1]);
    expect(x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(y).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('lands the archive s patterns in the unit square', () => {
    const points = exploriCpVertices(cp);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(-1e-12);
      expect(x).toBeLessThanOrEqual(1 + 1e-12);
      expect(y).toBeGreaterThanOrEqual(-1e-12);
      expect(y).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it('gives coincident vertices bit-identical coordinates', () => {
    // The property the exact representation is supposed to buy: each vertex is
    // computed once from its own tuple, so "the same point" is the same double
    // rather than two doubles a tolerance has to reconcile. A failure here means
    // the export needs to weld before handing over.
    expect(exploriCpHasDistinctVertices(cp)).toBe(true);
  });
});

describe('FOLD export', () => {
  it('lands the unit square on the Edit paper, which is centred on the origin', () => {
    // Not [0, 400]²: an empty Edit crease pattern's border runs from (-200, 200)
    // to (200, 200), so a cornered export lands *beside* the paper.
    const fold = exploriCpToFoldObject(cp) as { vertices_coords: number[][] };
    const xs = fold.vertices_coords.map(([x]) => x);
    const ys = fold.vertices_coords.map(([, y]) => y);
    expect(Math.min(...xs)).toBeCloseTo(-EDIT_PAPER_SIZE / 2, 9);
    expect(Math.max(...xs)).toBeCloseTo(EDIT_PAPER_SIZE / 2, 9);
    expect(Math.min(...ys)).toBeCloseTo(-EDIT_PAPER_SIZE / 2, 9);
    expect(Math.max(...ys)).toBeCloseTo(EDIT_PAPER_SIZE / 2, 9);
  });

  it('keeps every edge, with an assignment each', () => {
    const fold = exploriCpToFoldObject(cp) as {
      edges_vertices: number[][];
      edges_assignment: string[];
    };
    expect(fold.edges_vertices).toHaveLength(cp.edges.length);
    expect(fold.edges_assignment).toHaveLength(cp.edges.length);
  });

  it('drops an edge naming a vertex that does not exist rather than emitting NaN', () => {
    const broken: ExploriCp = {
      vertices: [[0, 1, 0, 1, 0, 1, 0, 1]],
      edges: [
        [0, 9, 'm'],
        [0, 0, 'v'],
      ],
    };
    const fold = exploriCpToFoldObject(broken) as { edges_vertices: number[][] };
    expect(fold.edges_vertices).toEqual([[0, 0]]);
  });
});
