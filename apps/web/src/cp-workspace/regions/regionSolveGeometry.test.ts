import { describe, expect, it } from 'vitest';
import type { CpExactSolveMovedVertex } from '../../engine/cpExactSolveTypes';
import type { OristudioCpLineSegment } from '../../engine/oristudioCpTypes';
import { createCpSuppressionRegion } from '../annotations/suppressionRegion';
import { cpRegionPatternLines, solvedRegionSegments } from './regionSolveGeometry';

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
  it('maps unit-square coordinates onto the paper the creases actually span', () => {
    const owned = [...paperSquare(), segment(300, 100, 300, 500)];
    // The middle crease's top end, nudged right by a hundredth of the paper.
    const placed = solvedRegionSegments(owned, [moved([0.5, 0], [0.51, 0])]);

    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    // 0.51 of a 400-unit paper starting at x=100.
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
    const placed = solvedRegionSegments(owned, [moved([0.5, 0], [0.51, 0])]);

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
    const placed = solvedRegionSegments(owned, [
      moved([0.5, 0], [0.51, 0], 1),
      moved([0.5, 1], [0.49, 1], 2),
    ]);

    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.segments[4].a).toEqual({ x: 304, y: 100 });
    expect(placed.segments[4].b).toEqual({ x: 296, y: 500 });
    expect(placed.rewrittenEndpoints).toBe(2);
  });

  it('takes the nearest vertex, so one of a close pair cannot claim the other', () => {
    // Detected patterns carry genuinely close vertex pairs; "first within
    // tolerance" would hand one of them the other's displacement.
    const owned = [
      ...paperSquare(),
      segment(300.0, 100, 300.0, 500),
      segment(300.2, 100, 300.2, 500),
    ];
    const placed = solvedRegionSegments(owned, [
      moved([0.5005, 0], [0.6, 0], 1),
      moved([0.5, 0], [0.4, 0], 2),
    ]);

    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.segments[4].a.x).toBeCloseTo(260, 6);
    expect(placed.segments[5].a.x).toBeCloseTo(340, 6);
  });

  it('succeeds with nothing to do when the solver moved nothing', () => {
    const owned = paperSquare();
    const placed = solvedRegionSegments(owned, []);
    expect(placed).toMatchObject({ ok: true, rewrittenEndpoints: 0 });
  });

  it('refuses when the region holds no creases', () => {
    expect(solvedRegionSegments([], [moved([0.5, 0], [0.51, 0])])).toEqual({
      ok: false,
      refusal: 'no_pattern',
    });
  });

  it('refuses when the creases no longer span a square sheet', () => {
    // Rotating the pattern or deleting a paper edge does this, and the
    // unit-square hypothesis cannot survive either.
    const owned = [segment(100, 100, 500, 100), segment(500, 100, 500, 300)];
    expect(solvedRegionSegments(owned, [moved([0.5, 0], [0.51, 0])])).toEqual({
      ok: false,
      refusal: 'paper_not_square',
    });
  });

  it('refuses when the answer does not line up with the creases', () => {
    // The frame is a hypothesis, and this is the check that it holds: none of
    // these vertices is sitting where the mapping says it should be, so the
    // attachment belongs to a different pattern and nothing is written.
    const owned = paperSquare();
    const placed = solvedRegionSegments(owned, [
      moved([0.31, 0.42], [0.32, 0.42], 1),
      moved([0.77, 0.18], [0.78, 0.18], 2),
    ]);
    expect(placed).toEqual({ ok: false, refusal: 'frame_unrecognized' });
  });

  it('still places when repairs have removed some of the solver’s vertices', () => {
    // Repair is edits between the attachment being made and the solve running, so
    // a missing vertex is expected rather than disqualifying. A clear majority
    // found is the bar.
    const owned = [...paperSquare(), segment(300, 100, 300, 500)];
    const placed = solvedRegionSegments(owned, [
      moved([0.5, 0], [0.51, 0], 1),
      moved([0.5, 1], [0.49, 1], 2),
      // Two vertices the user deleted while repairing.
      moved([0.31, 0.42], [0.32, 0.42], 3),
    ]);
    expect(placed.ok).toBe(true);
  });
});
