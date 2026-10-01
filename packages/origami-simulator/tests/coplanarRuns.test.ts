import { describe, expect, it } from 'vitest';
import {
  coplanarRuns,
  outlineOf,
  sourceFaceGroups,
  type Point,
  type RunPiece,
} from '../src/coplanarRuns.js';
import { EDGE_CODE } from '../src/edgeCodes.js';

/** A square as two triangles sharing the diagonal 0-2. */
const SQUARE_AS_TRIANGLES = {
  faceIndices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  // The diagonal is the facet edge; the four sides are mountains.
  edgeIndices: new Uint32Array([0, 1, 1, 2, 2, 3, 3, 0, 0, 2]),
  edgeAssignments: new Uint8Array([1, 1, 1, 1, EDGE_CODE.facet]),
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

  it('leaves triangles that share an auxiliary crease apart', () => {
    // An auxiliary crease is drawn between two faces the way a fold is; only a
    // triangulation diagonal, which nobody drew, joins them. Code 3 used to be
    // the facet code, so this is what tells the two flat kinds apart.
    const groups = sourceFaceGroups({
      ...SQUARE_AS_TRIANGLES,
      edgeAssignments: new Uint8Array([1, 1, 1, 1, EDGE_CODE.aux]),
    });
    expect(groups[0]).not.toBe(groups[1]);
  });

  it('joins a fan of more than two', () => {
    // A pentagon fanned from vertex 0 gives three triangles and two diagonals.
    const groups = sourceFaceGroups({
      faceIndices: new Uint32Array([0, 1, 2, 0, 2, 3, 0, 3, 4]),
      edgeIndices: new Uint32Array([0, 2, 0, 3]),
      edgeAssignments: new Uint8Array([EDGE_CODE.facet, EDGE_CODE.facet]),
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
  // Re-pinned: `outlineOf` now returns the rings of the region rather than one
  // loop, so a simple region is a one-element list.
  it('drops the shared edge of two triangles', () => {
    const rings = outlineOf([
      [[0, 0], [10, 0], [10, 10]],
      [[0, 0], [10, 10], [0, 10]],
    ]);
    expect(rings).toHaveLength(1);
    const [outline] = rings!;
    // The square's four corners, and not the diagonal.
    expect(outline).toHaveLength(4);
    expect(new Set(outline!.map(([x, y]) => `${x},${y}`))).toEqual(
      new Set(['0,0', '10,0', '10,10', '0,10'])
    );
  });

  it('drops a vertex left on a straight edge by a cut', () => {
    // A square cut down the middle: the two halves meet along x = 5, and the
    // points at (5,0) and (5,10) are on the outline but not corners of it.
    const rings = outlineOf([
      [[0, 0], [5, 0], [5, 10], [0, 10]],
      [[5, 0], [10, 0], [10, 10], [5, 10]],
    ]);
    expect(rings).toHaveLength(1);
    expect(rings![0]).toHaveLength(4);
  });

  it('still refuses a hole whose pieces meet at T-junctions', () => {
    // Four bands around a gap, the side bands ending on the middle of the top
    // and bottom bands' edges. Nothing cancels along a half-edge, so this is a
    // T-junction and not a hole the cancellation can see.
    const ring: Point[][] = [
      [[0, 0], [30, 0], [30, 10], [0, 10]],
      [[0, 20], [30, 20], [30, 30], [0, 30]],
      [[0, 10], [10, 10], [10, 20], [0, 20]],
      [[20, 10], [30, 10], [30, 20], [20, 20]],
    ];
    expect(outlineOf(ring)).toBeNull();
  });

  it('returns a region with a hole as two rings', () => {
    // Four trapezoids around a gap, meeting along whole diagonals. Two boundary
    // loops: the outer square, and the hole wound against it, which a painter
    // draws as one even-odd path. This used to be null, and the caller kept
    // the pieces.
    const ring: Point[][] = [
      [[0, 0], [30, 0], [20, 10], [10, 10]],
      [[30, 0], [30, 30], [20, 20], [20, 10]],
      [[30, 30], [0, 30], [10, 20], [20, 20]],
      [[0, 30], [0, 0], [10, 10], [10, 20]],
    ];
    const rings = outlineOf(ring)!;
    expect(rings).toHaveLength(2);
    const corners = (loop: readonly Point[]) => new Set(loop.map(([x, y]) => `${x},${y}`));
    const found = rings.map(corners);
    expect(found).toContainEqual(new Set(['0,0', '30,0', '30,30', '0,30']));
    expect(found).toContainEqual(new Set(['10,10', '20,10', '20,20', '10,20']));
    // Wound against each other, so the even-odd and the nonzero rule agree.
    expect(Math.sign(signedArea(rings[0]!))).toBe(-Math.sign(signedArea(rings[1]!)));
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
    expect(area(outlineOf(pieces)![0]!)).toBeCloseTo(before, 6);
  });
});

function signedArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}
