import { expect, it } from 'vitest';
import {
  spatialPlaneSide,
  spatialVisibility,
  winner,
  visibleFragments,
  pickSpread,
  visibleLine,
  barycentric,
  type SpatialPlane,
  type ProjectedSpread,
  type Point3,
} from '../src/index.js';

function plane(
  faces: number[],
  orders: [number, number][],
  groups = faces
): SpatialPlane {
  return {
    faces,
    orders,
    groups,
    normal: [0, 0, 1],
    origin: [0, 0, 0],
    witnesses: [],
  };
}
const candidate = (face: number, depth: number) => ({
  face,
  depth,
  triangle: face,
});

it('uses the eye relative to each plane, with a deterministic edge-on capture', () => {
  const p = { normal: [0, 0, 1] as Point3, origin: [0, 0, 5] as Point3 };
  expect(spatialPlaneSide(p, [0, 0, 3])).toBe('back');
  expect(spatialPlaneSide(p, [10, 0, 5])).toBe('front');
  expect(spatialPlaneSide(p, [10, 0, 5], 'back')).toBe('back');
});
it('reverses only local relations and keeps physical cross-plane occlusion', () => {
  const planes = [plane([0, 1], [[0, 1]]), plane([2], [])];
  expect(
    winner(
      [candidate(0, 5), candidate(1, 1), candidate(2, 2)],
      spatialVisibility(3, planes, [0, 0, 10])
    )?.face
  ).toBe(2);
  expect(
    winner(
      [candidate(0, 5), candidate(1, 1), candidate(2, 2)],
      spatialVisibility(3, planes, [0, 0, -10])
    )?.face
  ).toBe(0);
});
it('never invents a relation through an absent intermediate face', () => {
  const order = spatialVisibility(
    3,
    [
      plane(
        [0, 1, 2],
        [
          [0, 1],
          [1, 2],
        ]
      ),
    ],
    [0, 0, 10]
  );
  expect(winner([candidate(0, 5), candidate(2, 2)], order)?.face).toBe(0);
});
it('expands zero-angle subdivisions only inside their source plane', () => {
  const order = spatialVisibility(
    4,
    [plane([0, 1, 2], [[0, 2]], [0, 0, 2]), plane([3], [], [0])],
    [0, 0, 10]
  );
  expect(order.above).toEqual([[2], [2], [], []]);
});
it('resolves an all-masked cycle locally even when another plane survives', () => {
  const order = spatialVisibility(
    3,
    [
      plane(
        [0, 1],
        [
          [0, 1],
          [1, 0],
        ]
      ),
      plane([2], []),
    ],
    [0, 0, 10]
  );
  expect(
    winner([candidate(0, 5), candidate(1, 1), candidate(2, 2)], order)?.face
  ).toBe(0);
});

it.each([
  { orders: [[0, 1]], depths: [5, 1, 2], expected: 2 },
  {
    orders: [
      [0, 1],
      [1, 0],
    ],
    depths: [5, 1, 2],
    expected: 0,
  },
  {
    orders: [
      [0, 1],
      [1, 0],
    ],
    depths: [5, 1, 6],
    expected: 2,
  },
])(
  'vector, picking and ink match independent-plane masks: %j',
  ({ orders, depths, expected }) => {
    const positions: Point3[] = depths.flatMap(
      (z) =>
        [
          [0, 0, z],
          [2, 0, z],
          [0, 2, z],
        ] as Point3[]
    );
    const mesh: ProjectedSpread = {
      positions,
      triangles: [
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
      ],
      triangleFaces: [0, 1, 2],
      visibility: spatialVisibility(
        3,
        [plane([0, 1], orders as [number, number][]), plane([2], [])],
        [0, 0, 10]
      ),
    };
    const point: [number, number] = [0.37, 0.42];
    expect(pickSpread(mesh, point)?.face).toBe(expected);
    const covering = visibleFragments(mesh).filter((f) =>
      f.polygon.slice(2).some((p, i) => {
        const w = barycentric(f.polygon[0], f.polygon[i + 1], p, point);
        return w && Math.min(...w) > -1e-10;
      })
    );
    expect([...new Set(covering.map((f) => f.face))]).toEqual([expected]);
    depths.forEach((z, f) =>
      expect(
        visibleLine(mesh, f, [0.36, 0.42, z], [0.38, 0.42, z]).length > 0
      ).toBe(f === expected)
    );
  }
);
it('refuses cross-plane and missing identities instead of guessing', () => {
  expect(() =>
    spatialVisibility(2, [plane([0], [[0, 1]]), plane([1], [])], [0, 0, 1])
  ).toThrow();
  expect(() => spatialVisibility(2, [plane([0], [])], [0, 0, 1])).toThrow();
});
