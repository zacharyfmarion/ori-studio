import { describe, expect, it } from 'vitest';
import {
  coplanarRuns,
  outlineOf,
  sourceFaceGroups,
  type Point,
  type RunPiece,
} from '../src/coplanarRuns.js';

/** A square as two triangles sharing the diagonal 0-2. */
const SQUARE_AS_TRIANGLES = {
  faceIndices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  // The diagonal is the facet edge; the four sides are mountains.
  edgeIndices: new Uint32Array([0, 1, 1, 2, 2, 3, 3, 0, 0, 2]),
  edgeAssignments: new Uint8Array([1, 1, 1, 1, 3]),
};

function piece(group: number, points: Point[], fill = '#aabbcc'): RunPiece {
  return { group, fill, points };
}

describe('recovering the source face', () => {
  it('joins triangles across a triangulation diagonal', () => {
    const groups = sourceFaceGroups(SQUARE_AS_TRIANGLES);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toBe(groups[1]);
  });

  it('leaves triangles that share a fold apart', () => {
    // Same two triangles, but the shared edge is a mountain: this is a real
    // crease between two faces, and they are not one face.
    const groups = sourceFaceGroups({
      ...SQUARE_AS_TRIANGLES,
      edgeAssignments: new Uint8Array([1, 1, 1, 1, 1]),
    });
    expect(groups[0]).not.toBe(groups[1]);
  });

  it('joins a fan of more than two', () => {
    // A pentagon fanned from vertex 0 gives three triangles and two diagonals.
    const groups = sourceFaceGroups({
      faceIndices: new Uint32Array([0, 1, 2, 0, 2, 3, 0, 3, 4]),
      edgeIndices: new Uint32Array([0, 2, 0, 3]),
      edgeAssignments: new Uint8Array([3, 3]),
    });
    expect(new Set([groups[0], groups[1], groups[2]]).size).toBe(1);
  });

  it('leaves every triangle alone when nothing was triangulated', () => {
    const groups = sourceFaceGroups({
      faceIndices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      edgeIndices: new Uint32Array([0, 1]),
      edgeAssignments: new Uint8Array([1]),
    });
    expect(groups[0]).not.toBe(groups[1]);
  });
});

describe('choosing runs to merge', () => {
  const left: Point[] = [[0, 0], [10, 0], [10, 10]];
  const right: Point[] = [[0, 0], [10, 10], [0, 10]];

  it('takes consecutive pieces of one face that share an edge', () => {
    expect(coplanarRuns([piece(1, left), piece(1, right)])).toEqual([[0, 2]]);
  });

  it('stops at a piece of another face', () => {
    expect(coplanarRuns([piece(1, left), piece(2, right)])).toEqual([]);
  });

  it('stops at a crease, which never merges', () => {
    // A crease drawn between two pieces of one face is drawn *over* the first;
    // merging across it would lift the paper above its own fold line.
    const runs = coplanarRuns([piece(1, left), piece(-1, [[0, 0], [1, 1]]), piece(1, right)]);
    expect(runs).toEqual([]);
  });

  it('stops where the fill differs, as strain colouring makes it', () => {
    expect(coplanarRuns([piece(1, left), piece(1, right, '#ffffff')])).toEqual([]);
  });

  it('stops at a piece that only touches at a corner', () => {
    const corner: Point[] = [[10, 10], [20, 10], [20, 20]];
    expect(coplanarRuns([piece(1, left), piece(1, corner)])).toEqual([]);
  });

  it('reports several runs, and skips the pieces between them', () => {
    const runs = coplanarRuns([
      piece(1, left),
      piece(1, right),
      piece(-1, [[0, 0], [1, 1]]),
      piece(2, left),
      piece(2, right),
    ]);
    expect(runs).toEqual([
      [0, 2],
      [3, 5],
    ]);
  });
});

describe('outlining a merged run', () => {
  it('drops the shared edge of two triangles', () => {
    const outline = outlineOf([
      [[0, 0], [10, 0], [10, 10]],
      [[0, 0], [10, 10], [0, 10]],
    ]);
    expect(outline).not.toBeNull();
    // The square's four corners, and not the diagonal.
    expect(outline).toHaveLength(4);
    expect(new Set(outline!.map(([x, y]) => `${x},${y}`))).toEqual(
      new Set(['0,0', '10,0', '10,10', '0,10'])
    );
  });

  it('drops a vertex left on a straight edge by a cut', () => {
    // A square cut down the middle: the two halves meet along x = 5, and the
    // points at (5,0) and (5,10) are on the outline but not corners of it.
    const outline = outlineOf([
      [[0, 0], [5, 0], [5, 10], [0, 10]],
      [[5, 0], [10, 0], [10, 10], [5, 10]],
    ]);
    expect(outline).toHaveLength(4);
  });

  it('refuses a region with a hole', () => {
    // Four pieces around a gap. There are two boundary loops and no way to write
    // that as one polygon, so the caller keeps the pieces.
    const ring: Point[][] = [
      [[0, 0], [30, 0], [30, 10], [0, 10]],
      [[0, 20], [30, 20], [30, 30], [0, 30]],
      [[0, 10], [10, 10], [10, 20], [0, 20]],
      [[20, 10], [30, 10], [30, 20], [20, 20]],
    ];
    expect(outlineOf(ring)).toBeNull();
  });

  it('refuses pieces that meet at a T-junction', () => {
    // The left piece spans the full height; the right is two stacked halves, so
    // the shared boundary has no matching partner to cancel against.
    const outline = outlineOf([
      [[0, 0], [5, 0], [5, 10], [0, 10]],
      [[5, 0], [10, 0], [10, 5], [5, 5]],
      [[5, 5], [10, 5], [10, 10], [5, 10]],
    ]);
    expect(outline).toBeNull();
  });

  it('refuses a region that pinches to a point', () => {
    // Two squares meeting at one corner: the walk would have to choose which way
    // to leave that vertex.
    const bowtie: Point[][] = [
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      [[10, 10], [20, 10], [20, 20], [10, 20]],
    ];
    expect(outlineOf(bowtie)).toBeNull();
  });

  it('keeps the area it was given', () => {
    const pieces: Point[][] = [
      [[0, 0], [10, 0], [10, 10]],
      [[0, 0], [10, 10], [0, 10]],
    ];
    const area = (points: readonly Point[]): number => {
      let sum = 0;
      for (let i = 0; i < points.length; i += 1) {
        const [x1, y1] = points[i]!;
        const [x2, y2] = points[(i + 1) % points.length]!;
        sum += x1 * y2 - x2 * y1;
      }
      return Math.abs(sum) / 2;
    };
    const before = pieces.reduce((sum, p) => sum + area(p), 0);
    expect(area(outlineOf(pieces)!)).toBeCloseTo(before, 6);
  });
});
