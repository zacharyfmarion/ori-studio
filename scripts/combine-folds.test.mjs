/**
 * Tests for the FOLD grid combiner.
 *
 * Run with: node --test scripts/combine-folds.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineFolds } from './combine-folds.mjs';

const pattern = (name, scale = 1) => ({
  name,
  fold: {
    vertices_coords: [
      [0, 0],
      [scale, 0],
      [scale, scale],
      [0, scale],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ],
    edges_assignment: ['B', 'M', 'V', 'B'],
    edges_foldAngle: [0, -90, 45, 0],
  },
});

test('every edge survives, with its assignment and angle', () => {
  const { fold } = combineFolds([pattern('a'), pattern('b', 1000)]);
  assert.equal(fold.edges_vertices.length, 8);
  assert.deepEqual(fold.edges_assignment, ['B', 'M', 'V', 'B', 'B', 'M', 'V', 'B']);
  // The angles are the point of the whole exercise: a scale must not touch them.
  assert.deepEqual(fold.edges_foldAngle, [0, -90, 45, 0, 0, -90, 45, 0]);
});

test('wildly different sizes end up the same size on screen', () => {
  const { fold } = combineFolds([pattern('small', 1), pattern('huge', 5000)]);
  const spanOf = (from, to) => {
    const xs = fold.vertices_coords.slice(from, to).map(([x]) => x);
    return Math.max(...xs) - Math.min(...xs);
  };
  assert.ok(Math.abs(spanOf(0, 4) - spanOf(4, 8)) < 1e-9);
});

test('edge indices are rebased, never left pointing at the wrong pattern', () => {
  const { fold } = combineFolds([pattern('a'), pattern('b')]);
  for (const [a, b] of fold.edges_vertices.slice(4)) {
    assert.ok(a >= 4 && b >= 4, 'the second pattern must not reference the first');
  }
});

test('patterns never touch, so two designs cannot fuse into one vertex', () => {
  // A shared vertex would merge two unrelated fans and invent violations.
  const { fold } = combineFolds([pattern('a'), pattern('b')], { cell: 400 });
  const first = fold.vertices_coords.slice(0, 4);
  const second = fold.vertices_coords.slice(4);
  let closest = Infinity;
  for (const [ax, ay] of first) {
    for (const [bx, by] of second) closest = Math.min(closest, Math.hypot(ax - bx, ay - by));
  }
  assert.ok(closest > 1, `patterns came within ${closest}`);
});

test('the layout is recorded so a cell can be identified', () => {
  const { layout } = combineFolds([pattern('a'), pattern('b'), pattern('c'), pattern('d')]);
  assert.deepEqual(
    layout.map(({ name, row, column }) => `${name}@${row},${column}`),
    ['a@0,0', 'b@0,1', 'c@1,0', 'd@1,1'],
  );
});

test('an empty pattern is skipped rather than shifting the grid', () => {
  const empty = { name: 'empty', fold: { vertices_coords: [], edges_vertices: [] } };
  const { layout } = combineFolds([empty, pattern('a')]);
  assert.deepEqual(
    layout.map((entry) => entry.name),
    ['a'],
  );
});

test('nothing to combine is an error, not an empty document', () => {
  assert.throws(() => combineFolds([]));
});
