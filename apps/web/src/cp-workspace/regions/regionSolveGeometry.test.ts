import { describe, expect, it } from 'vitest';
import type { CpExactSolveMovedVertex } from '../../engine/cpExactSolveTypes';
import type { OristudioCpLineSegment } from '../../engine/oristudioCpTypes';
import { createCpSuppressionRegion } from '../annotations/suppressionRegion';
import type { CpSolveFrameTransform } from '../../engine/cpExactSolveTypes';
import {
  cpRegionPatternLines,
  foldEdgesVertices,
  partialVertexPositions,
  solvedRegionSegments,
  solvedVertexPositions,
} from './regionSolveGeometry';

/**
 * The two things standing between a solved answer and the document: which
 * creases the region owns, and where the answer's coordinates land.
 */

/** A crease carrying enough non-geometric state to prove placement preserves it. */
function segment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  extra: Partial<OristudioCpLineSegment> = {}
): OristudioCpLineSegment {
  return {
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    active: 'Mountain',
    color: 'Mountain',
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
    ...extra,
  } as OristudioCpLineSegment;
}

/** A region over the paper square [100,500]² with a little margin. */
function region(over = { center: { x: 300, y: 300 }, size: 420 }) {
  return createCpSuppressionRegion({
    id: 'region-1',
    center: over.center,
    width: over.size,
    height: over.size,
  });
}

/** A vertex the solver moved, in unit-square coordinates. */
function moved(
  before: [number, number],
  after: [number, number],
  vertexId = 0
): CpExactSolveMovedVertex {
  return {
    vertex_id: vertexId,
    before: { x: before[0], y: before[1] },
    after: { x: after[0], y: after[1] },
    movement: Math.hypot(after[0] - before[0], after[1] - before[1]),
  };
}

/**
 * The frame for the [100,500]² paper: no rotation, 400 units across.
 * What `exact_solve_input_from_fold` returns for a document at these coordinates.
 */
const FRAME: CpSolveFrameTransform = {
  origin: { x: 100, y: 100 },
  ux: [1, 0],
  uy: [0, 1],
  side: 400,
  flip: 1,
};

/**
 * The FOLD edges for `paperSquare()` plus one middle crease: four boundary edges
 * round vertices 0-3, then the middle crease between 4 and 5.
 */
const SQUARE_EDGES = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
] as const satisfies readonly (readonly [number, number])[];

/** The paper square as four boundary creases, in document coordinates. */
function paperSquare(): OristudioCpLineSegment[] {
  return [
    segment(100, 100, 500, 100),
    segment(500, 100, 500, 500),
    segment(500, 500, 100, 500),
    segment(100, 500, 100, 100),
  ];
}

describe('cpRegionPatternLines', () => {
  it('owns the creases wholly inside the region, by 1-based id', () => {
    const lines = cpRegionPatternLines(
      [
        segment(100, 100, 500, 100),
        // Outside entirely — the user's own work, which detection adds beside.
        segment(900, 900, 950, 950),
        segment(100, 100, 500, 500),
      ],
      region()
    );
    expect(lines.lineIds).toEqual([1, 3]);
    expect(lines.segments).toHaveLength(2);
    expect(lines.segments[1].b).toEqual({ x: 500, y: 500 });
  });

  it('leaves out a crease with one end outside, rather than half-owning it', () => {
    // A crease straddling the boundary belongs to whatever it reaches into, and a
    // solve that moved one of its ends would be editing geometry it does not own.
    const lines = cpRegionPatternLines([segment(300, 300, 900, 300)], region());
    expect(lines.lineIds).toEqual([]);
  });

  it('answers for a document with no creases at all', () => {
    expect(cpRegionPatternLines(undefined, region()).lineIds).toEqual([]);
    expect(cpRegionPatternLines([], region()).lineIds).toEqual([]);
  });
});

describe('solvedRegionSegments', () => {
  it('places a moved vertex by id, through the frame the compiler handed back', () => {
    const owned = [...paperSquare(), segment(300, 100, 300, 500)];
    // Vertex 4 is the middle crease's top end. Nudged right by a hundredth of
    // the paper: 0.51 of 400 units starting at x=100.
    const placed = solvedRegionSegments(
      owned,
      partialVertexPositions([moved([0.5, 0], [0.51, 0], 4)]),
      SQUARE_EDGES,
      FRAME
    );

    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.segments[4].a).toEqual({ x: 304, y: 100 });
    expect(placed.rewrittenEndpoints).toBe(1);
  });

  it('carries every non-geometric field through verbatim', () => {
    const owned = [
      ...paperSquare(),
      segment(300, 100, 300, 500, {
        active: 'Valley',
        color: 'Valley',
        selected: 1,
        fold_magnitude: 90,
      }),
    ];
    const placed = solvedRegionSegments(
      owned,
      partialVertexPositions([moved([0.5, 0], [0.51, 0], 4)]),
      SQUARE_EDGES,
      FRAME
    );

    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    // The solver moves coordinates and nothing else, so mountain/valley, fold
    // angle and selection survive — which is the reason placement rewrites
    // endpoints rather than rebuilding creases from the solved FOLD.
    expect(placed.segments[4]).toMatchObject({
      active: 'Valley',
      color: 'Valley',
      selected: 1,
      fold_magnitude: 90,
      b: { x: 300, y: 500 },
    });
  });

  it('moves both ends of a crease when the solver moved both vertices', () => {
    const owned = [...paperSquare(), segment(300, 100, 300, 500)];
    const placed = solvedRegionSegments(
      owned,
      partialVertexPositions([moved([0.5, 0], [0.51, 0], 4), moved([0.5, 1], [0.49, 1], 5)]),
      SQUARE_EDGES,
      FRAME
    );

    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.segments[4].a).toEqual({ x: 304, y: 100 });
    expect(placed.segments[4].b).toEqual({ x: 296, y: 500 });
    expect(placed.rewrittenEndpoints).toBe(2);
  });

  it('moves every crease meeting at a shared vertex, and only those', () => {
    // The case proximity matching had to work for and could get wrong. Two
    // creases genuinely meet at vertex 4; a third passes within a fifth of a
    // unit of it and must not move. An id says which is which, exactly.
    const owned = [
      ...paperSquare(),
      segment(300.0, 100, 300.0, 500),
      segment(300.0, 100, 500.0, 300),
      segment(300.2, 100, 300.2, 500),
    ];
    const edges = [...SQUARE_EDGES, [4, 6], [7, 8]] as const;
    const placed = solvedRegionSegments(owned, partialVertexPositions([moved([0.5, 0], [0.6, 0], 4)]), edges, FRAME);

    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.segments[4].a).toEqual({ x: 340, y: 100 });
    expect(placed.segments[5].a).toEqual({ x: 340, y: 100 });
    // Close, but a different vertex. Untouched.
    expect(placed.segments[6].a).toEqual({ x: 300.2, y: 100 });
    expect(placed.rewrittenEndpoints).toBe(2);
  });

  it('places onto a rotated pattern, which the old frame hypothesis refused', () => {
    // The paper turned a quarter turn: the frame says so, and that is the whole
    // of it. Deriving the mapping from a bounding box could not express this and
    // refused with `paper_not_square`, which is why that refusal is gone.
    const rotated: CpSolveFrameTransform = {
      origin: { x: 500, y: 100 },
      ux: [0, 1],
      uy: [-1, 0],
      side: 400,
      flip: 1,
    };
    const owned = [...paperSquare(), segment(300, 100, 300, 500)];
    const placed = solvedRegionSegments(
      owned,
      partialVertexPositions([moved([0.5, 0], [0.51, 0], 4)]),
      SQUARE_EDGES,
      rotated
    );

    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.segments[4].a).toEqual({ x: 500, y: 304 });
  });

  it('succeeds with nothing to do when the solver moved nothing', () => {
    // What a second solve looks like now: the input is rebuilt from creases that
    // are already exact, so the solver has nothing to move. Idempotence falls
    // out of solving the live document rather than needing a rule of its own.
    const owned = paperSquare();
    const placed = solvedRegionSegments(owned, new Map(), SQUARE_EDGES.slice(0, 4), FRAME);
    expect(placed).toMatchObject({ ok: true, rewrittenEndpoints: 0 });
  });

  it('places a solved vertex the movement report never mentions', () => {
    // The bug this channel exists to prevent. A collinear degree-2 vertex is
    // dissolved for the solve and placed back on the straightened crease
    // *after* the solver takes its movement comparison, so it is in
    // `vertices_exact` and absent from `moved_vertices`. Placing from the report
    // left it at its old, off-line coordinate while both neighbours moved — and
    // a degree-2 vertex is Kawasaki-clean only when exactly collinear, so it
    // came back as an angle violation on a pattern just called foldable.
    //
    // Vertex 5 here is that vertex: a mid-crease point the report would omit.
    const owned = [
      ...paperSquare(),
      segment(300, 100, 300, 300),
      segment(300, 300, 300, 500),
    ];
    const edges = [...SQUARE_EDGES, [5, 6]] as const;
    const solved = solvedVertexPositions([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 0.51, y: 0 },
      // Straightened onto the chord between vertices 4 and 6.
      { x: 0.505, y: 0.5 },
      { x: 0.5, y: 1 },
    ]);

    const placed = solvedRegionSegments(owned, solved, edges, FRAME);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.segments[4].a).toEqual({ x: 304, y: 100 });
    expect(placed.segments[4].b).toEqual({ x: 302, y: 300 });
    expect(placed.segments[5].a).toEqual({ x: 302, y: 300 });
    expect(placed.segments[5].b).toEqual({ x: 300, y: 500 });
  });

  it('refuses when the region holds no creases', () => {
    expect(solvedRegionSegments([], partialVertexPositions([moved([0.5, 0], [0.51, 0])]), [], FRAME)).toEqual({
      ok: false,
      refusal: 'no_pattern',
    });
  });

  it('refuses a solved graph that does not describe these creases', () => {
    // Unreachable through the UI — the FOLD was built from these very segments —
    // so this is the assertion saying so, rather than placing coordinates on
    // creases they were not computed for.
    const owned = [...paperSquare(), segment(300, 100, 300, 500)];
    expect(
      solvedRegionSegments(
        owned,
        partialVertexPositions([moved([0.5, 0], [0.51, 0], 4)]),
        SQUARE_EDGES.slice(0, 4),
        FRAME
      )
    ).toEqual({ ok: false, refusal: 'graph_mismatch' });
  });
});

describe('foldEdgesVertices', () => {
  it('reads the edge list a rebuilt input was numbered against', () => {
    expect(foldEdgesVertices('{"edges_vertices":[[0,1],[1,2]]}')).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it('answers null rather than throwing on anything it cannot read', () => {
    // A caller refuses with a sentence; an exception here would surface as a
    // bridge failure and blame the solver for a malformed document.
    expect(foldEdgesVertices('not json')).toBeNull();
    expect(foldEdgesVertices('{}')).toBeNull();
    expect(foldEdgesVertices('{"edges_vertices":[[0]]}')).toBeNull();
    expect(foldEdgesVertices('{"edges_vertices":[[0,"1"]]}')).toBeNull();
  });
});
