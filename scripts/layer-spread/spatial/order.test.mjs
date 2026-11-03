import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareOrder,
  orientOrder,
  orderedWinner,
  planeSide,
} from './order.mjs';

const source = (orders, extra = {}) => ({
  id: 0,
  normal: [0, 0, 1],
  origin: [0, 0, 0],
  faces: [0, 1, 2],
  groups: [0, 1, 2],
  orders,
  ...extra,
});
const candidate = (face, depth, plane = 0) => ({
  face,
  depth,
  plane,
  triangle: face,
});

test('camera side uses the eye relative to the plane, with edge-on hysteresis', () => {
  assert.equal(planeSide([0, 0, 1], [0, 0, 3], [0, 0, 2]), -1);
  assert.equal(planeSide([0, 0, 1], [0, 0, 3], [0, 0, 4]), 1);
  assert.equal(planeSide([0, 0, 1], [0, 0, 3], [4, 0, 3], -1), -1);
  assert.equal(planeSide([0, 0, 1], [0, 0, 3], [4, 0, 3]), 1);
});
test('known order overrides inverted depth and reverses on the opposite side', () => {
  const prepared = prepareOrder([source([[0, 1]])]);
  const c = [candidate(0, 3), candidate(1, 1)];
  assert.equal(orderedWinner(c, orientOrder(prepared, [0, 0, 4])).face, 1);
  assert.equal(orderedWinner(c, orientOrder(prepared, [0, 0, -4])).face, 0);
});
test('unrelated planes retain geometric occlusion ahead of and behind a stack', () => {
  const prepared = prepareOrder([
    source([[0, 1]]),
    source([], { id: 1, faces: [3], groups: [3] }),
  ]);
  const planes = orientOrder(prepared, [0, 0, 4]);
  assert.equal(
    orderedWinner(
      [candidate(0, 3), candidate(1, 1), candidate(3, 2, 1)],
      planes
    ).face,
    3
  );
  assert.equal(
    orderedWinner(
      [candidate(0, 3), candidate(1, 1), candidate(3, 0, 1)],
      planes
    ).face,
    1
  );
});
test('absent blockers and unrelated faces never acquire an invented rank', () => {
  const planes = orientOrder(
    prepareOrder([
      source([
        [0, 1],
        [1, 2],
      ]),
    ]),
    [0, 0, 4]
  );
  assert.equal(
    orderedWinner([candidate(0, 3), candidate(2, 1)], planes).face,
    0
  );
  assert.equal(orderedWinner([candidate(0, 3)], planes).face, 0);
});
test('zero-angle subdivisions inherit every piece of the blocking display layer', () => {
  const planes = orientOrder(
    prepareOrder([source([[0, 1]], { groups: [0, 1, 1] })]),
    [0, 0, 4]
  );
  assert.equal(
    orderedWinner([candidate(0, 3), candidate(2, 1)], planes).face,
    2
  );
});
test('a projected cycle uses physical fallback only when all local participants are blocked', () => {
  const planes = orientOrder(
    prepareOrder([
      source([
        [0, 1],
        [1, 2],
        [2, 0],
      ]),
    ]),
    [0, 0, 4]
  );
  assert.equal(planes[0].cyclic, true);
  assert.equal(
    orderedWinner([candidate(0, 3), candidate(1, 2), candidate(2, 1)], planes)
      .face,
    0
  );
  assert.equal(
    orderedWinner([candidate(0, 3), candidate(1, 1)], planes).face,
    1
  );
  assert.equal(orderedWinner([], planes), null);
});
