import { describe, expect, it } from 'vitest';
import {
  faceLineSegments,
  interpolate,
  SpreadComplexityError,
  barycentric,
  diagramPositions,
  orderSide,
  pickSpread,
  visibility,
  visibleFragments,
  visibleLine,
  type ProjectedSpread,
  type SpreadInput,
  type SpreadSolution,
} from '../src/index.js';

const input: SpreadInput = {
  xy: [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
  faces: [[0, 1, 2]],
  triangles: [[0, 1, 2]],
  triangleFaces: [0],
  orders: [],
  cells: [],
};
const solution = {
  heights: [1, 3, 2],
  references: [
    { plane: [2, 1, 1], center: [0, 0, 1], samples: 1, rms: 0 },
    { plane: [2, 1, 1], center: [0, 0, 1], samples: 1, rms: 0 },
  ],
} as SpreadSolution;
function stack(orders: [number, number][], depths: number[]): ProjectedSpread {
  return {
    positions: depths.flatMap(
      (z) =>
        [
          [0, 0, z],
          [1, 0, z],
          [0, 1, z],
        ] as [number, number, number][],
    ),
    triangles: depths.map((_, f) => [3 * f, 3 * f + 1, 3 * f + 2]),
    triangleFaces: depths.map((_, f) => f),
    visibility: visibility(depths.length, orders),
  };
}
describe('connected spread projection', () => {
  it('leaves the fitted surface head-on, including when tilted and viewed from the back', () => {
    for (const back of [false, true])
      expect(
        diagramPositions(input, solution, { kind: 'connected', version: 1, amount: 2, reveal: [1.2, -0.7] }, back).map(
          (p) => p.slice(0, 2),
        ),
      ).toEqual(input.xy);
  });
  it('zero amount is the original XY and zero Z', () => {
    expect(
      diagramPositions(input, solution, { kind: 'connected', version: 1, amount: 0, reveal: [1, 1] }, false),
    ).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
  });
  it('interpolates inside the rendered triangle rather than over the whole warped face', () => {
    expect(barycentric([0, 0], [1, 0], [0, 1], [0.25, 0.5])).toEqual([0.25, 0.25, 0.5]);
  });
});
describe('ordering in drawing, picking and vector output', () => {
  it('hides a physically protruding lower face and its ink', () => {
    const mesh = stack([[0, 1]], [1, 0]);
    expect(pickSpread(mesh, [0.2, 0.2])?.face).toBe(1);
    expect(visibleFragments(mesh).map((p) => p.face)).toEqual([1]);
    expect(visibleLine(mesh, 0, [0.1, 0.1, 1], [0.5, 0.1, 1])).toEqual([]);
    expect(visibleLine(mesh, 1, [0.1, 0.1, 0], [0.5, 0.1, 0])).toEqual([[0, 1]]);
  });
  it('reverses bands from the back', () => {
    const mesh = stack([[0, 1]], [1, 0]);
    mesh.visibility = visibility(2, [[0, 1]], true);
    expect(pickSpread(mesh, [0.2, 0.2])?.face).toBe(0);
    expect(visibleFragments(mesh).map((p) => p.face)).toEqual([0]);
  });
  it('preserves physical depth where a projected cycle masks every face', () => {
    const mesh = stack(
      [
        [0, 1],
        [1, 2],
        [2, 0],
      ],
      [1, 3, 2],
    );
    expect(mesh.visibility.ranks).toBeNull();
    expect(pickSpread(mesh, [0.2, 0.2])?.face).toBe(1);
    expect(visibleFragments(mesh).map((p) => p.face)).toEqual([1]);
  });
  it('clips a crossing of unrelated faces at the physical intersection', () => {
    const mesh = stack([], [0, 0]);
    mesh.positions[3][2] = -1;
    mesh.positions[4][2] = 1;
    mesh.positions[5][2] = -1;
    const fragments = visibleFragments(mesh);
    for (const p of [
      [0.1, 0.1],
      [0.8, 0.1],
    ] as [number, number][]) {
      const expected = pickSpread(mesh, p)!.face;
      const actual = fragments.filter((f) => {
        const pts = f.polygon;
        for (let i = 1; i + 1 < pts.length; i++) {
          const w = barycentric(pts[0], pts[i], pts[i + 1], p);
          if (w && Math.min(...w) >= 0) return true;
        }
        return false;
      });
      expect(actual.map((f) => f.face)).toEqual([expected]);
    }
  });
  it('retains the side at edge-on without disabling correction', () => {
    expect(orderSide(0, 'back')).toBe('back');
    expect(orderSide(0)).toBe('front');
    expect(orderSide(-0.1, 'front')).toBe('back');
  });
});

it('splits a crease across a warped face at the rendered triangle boundary', () => {
  const face: SpreadInput = {
    xy: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    faces: [[0, 1, 2, 3]],
    triangles: [
      [0, 1, 2],
      [0, 2, 3],
    ],
    triangleFaces: [0, 0],
    orders: [],
    cells: [],
  };
  const positions: [number, number, number][] = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 1],
    [0, 1, 0],
  ];
  const segments = faceLineSegments(face, 0, [0, 0.5], [1, 0.5]);
  expect(segments).toHaveLength(2);
  const ends = segments.map((s) => [interpolate(s.ids, s.wa, positions), interpolate(s.ids, s.wb, positions)]);
  expect(ends[0][1]).toEqual(ends[1][0]);
  expect(ends[0][1][2]).toBeCloseTo(0.5);
  expect(ends[0][0][2]).toBeCloseTo(0);
});
it('reports bounded vector complexity instead of returning missing faces', () => {
  expect(() => visibleFragments(stack([[0, 1]], [1, 0]), 0)).toThrow(SpreadComplexityError);
});
it('does not duplicate slivers when clipping touching and repeated edges', () => {
  const mesh = stack([], [0, 1, 2]);
  mesh.positions[4] = [1, 1e-11, 1];
  mesh.positions[7] = [1, -1e-11, 2];
  const fragments = visibleFragments(mesh, 500);
  expect(fragments.length).toBeLessThan(12);
  expect(pickSpread(mesh, [0.2, 0.2])?.face).toBe(2);
});
