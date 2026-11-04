import { expect, it } from 'vitest';
import {
  intersectInkIntervals,
  spatialInkOwnership,
} from './spatialInkOwnership';
import type { SpatialMeshOrder } from './folded3dMaterial';
import { prepareSpatialDrawPlan } from '../../simulator/spatialDrawPlan';
import { prepareSpatialInkPlan } from '../../simulator/spatialInkPlan';

const order: SpatialMeshOrder = {
  planes: [[0, 1], [2]].map((faces) => ({
    faces,
    groups: faces,
    orders: faces.length > 1 ? [[0, 1]] : [],
    normal: [0, 0, 1],
    origin: [0, 0, 0],
    witnesses: [],
  })),
  ranges: [0, 1, 2].map((f) => ({
    faceIndexStart: 3 * f,
    faceIndexCount: 3,
    edgeStart: 0,
    edgeCount: 0,
  })),
  triangleFaces: [0, 1, 2],
  edgeFaces: [0, 1, 0, 2, 2],
};
const edges = Uint32Array.from([0, 1, 1, 0, 2, 3, 3, 2, 4, 5]);

it('shares cross-plane hinge ownership, preserving coplanar outlines and independent ink', () => {
  expect(spatialInkOwnership(order, edges)).toEqual([
    [0],
    [1],
    [0, 2],
    undefined,
    [2],
  ]);
  const planes = prepareSpatialDrawPlan(order);
  const plan = prepareSpatialInkPlan(order, planes, edges);
  expect(plan.map((g) => g.edges)).toEqual([
    { start: 0, count: 1 },
    { start: 1, count: 1 },
    { start: 2, count: 1 },
    { start: 4, count: 1 },
  ]);
  expect(plan[2]!.owners).toEqual([
    { plane: planes[0], front: [{ start: 3, count: 3 }], back: [] },
    { plane: planes[1], front: [], back: [] },
  ]);
});

it('keeps only crease intervals visible to both incident owners', () => {
  expect(
    intersectInkIntervals(
      [
        [0, 0.4],
        [0.6, 1],
      ],
      [[0.2, 0.8]]
    )
  ).toEqual([
    [0.2, 0.4],
    [0.6, 0.8],
  ]);
  expect(intersectInkIntervals([[0, 1]], [])).toEqual([]);
  expect(intersectInkIntervals([[0, 0.5]], [[0.5, 1]])).toEqual([]);
});
