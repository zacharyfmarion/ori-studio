import { expect, it } from 'vitest';
import {
  spatialPlaneSide,
  spatialVisibility,
  type Point3,
  type SpatialPlane,
} from '@oristudio/layer-spread';
import { prepareSpatialDrawPlan } from './spatialDrawPlan';
import type { SpatialMeshOrder } from '../cp-workspace/folded/folded3dMaterial';

const plane = (faces: number[], orders: [number, number][]): SpatialPlane => ({
  faces,
  groups: faces,
  orders,
  normal: [0, 0, 1],
  origin: [0, 0, 0],
  witnesses: [],
});
const order = (planes: SpatialPlane[]): SpatialMeshOrder => ({
  planes,
  ranges: Array.from(
    { length: planes.reduce((n, p) => n + p.faces.length, 0) },
    (_, f) => ({
      faceIndexStart: f * 3,
      faceIndexCount: 3,
      edgeStart: 0,
      edgeCount: 0,
    })
  ),
  triangleFaces: [],
  edgeFaces: [],
});

it('matches CPU direct blockers on either side of independently oriented planes', () => {
  const model = order([
    {
      ...plane(
        [0, 1, 2, 3],
        [
          [0, 2],
          [2, 3],
        ]
      ),
      groups: [0, 0, 2, 3],
    },
    {
      ...plane(
        [4, 5, 6],
        [
          [4, 5],
          [5, 6],
          [6, 4],
        ]
      ),
      normal: [1, 0, 0],
      origin: [3, 0, 0],
    },
  ]);
  const plan = prepareSpatialDrawPlan(model);
  for (const eye of [
    [5, 2, 3],
    [-5, 3, -2],
    [5, 0, -2],
    [-1, 0, 3],
    [3, 0, 0],
  ] as Point3[]) {
    const expected = spatialVisibility(model.ranges.length, model.planes, eye);
    const actual = Array.from(
      { length: model.ranges.length },
      () => [] as readonly number[]
    );
    for (const p of plan) {
      const groups = p[spatialPlaneSide(p.plane, eye)];
      expect(groups.flatMap((g) => g.faces)).toEqual(p.plane.faces);
      for (const group of groups)
        for (const f of group.faces) actual[f] = group.blockers;
    }
    expect(actual).toEqual(expected.above);
  }
  expect(plan.map((p) => p.cyclic)).toEqual([false, true]);
  // No transitive 0 -> 3 relation through the possibly absent face 2.
  expect(plan[0]!.front.find((g) => g.faces.includes(0))!.blockers).toEqual([
    2,
  ]);
});

it('shares masks only for consecutive identical rows, preserving equal-depth tie order', () => {
  const model = order([
    plane(
      [0, 1, 2, 3, 4],
      [
        [0, 4],
        [1, 4],
        [3, 4],
      ]
    ),
  ]);
  const plan = prepareSpatialDrawPlan(model)[0]!;
  expect(plan.front).toMatchObject([
    { faces: [0, 1], blockers: [4] },
    { faces: [2], blockers: [] },
    { faces: [3], blockers: [4] },
    { faces: [4], blockers: [] },
  ]);
  expect(plan.back).toMatchObject([
    { faces: [0, 1, 2, 3], blockers: [] },
    { faces: [4], blockers: [0, 1, 3] },
  ]);
});

it('combines only contiguous mask ranges, leaving unrelated triangles out', () => {
  const model = order([
    plane(
      [0, 1, 2, 3, 4, 5],
      [
        [0, 1],
        [0, 2],
        [0, 4],
        [0, 5],
      ]
    ),
  ]);
  const plan = prepareSpatialDrawPlan(model)[0]!;
  expect(plan.front[0]!.maskRanges).toEqual([
    { start: 3, count: 6 },
    { start: 12, count: 6 },
  ]);
});

it('detects cycles after display-layer expansion and ignores same-layer witnesses', () => {
  const model = order([
    {
      ...plane(
        [0, 1],
        [
          [0, 1],
          [1, 0],
        ]
      ),
      groups: [0, 0],
    },
    {
      ...plane(
        [2, 3, 4, 5],
        [
          [2, 4],
          [5, 3],
        ]
      ),
      groups: [2, 2, 4, 4],
    },
    plane([6], []),
  ]);
  expect(prepareSpatialDrawPlan(model).map((p) => p.cyclic)).toEqual([
    false,
    true,
    false,
  ]);
});
