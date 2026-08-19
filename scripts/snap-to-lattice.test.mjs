/**
 * Tests for the lattice snapper.
 *
 * The guards carry most of the weight: this moves every point in a file, so the
 * tests that matter are the ones proving it declines when it should.
 *
 * Run with: node --test scripts/snap-to-lattice.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapToLattice } from './snap-to-lattice.mjs';

/** A square grid with `n` cells a side, each vertex nudged by `jitter`. */
function grid(n, jitter = 0, pitch = 10) {
  const vertices = [];
  const index = new Map();
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= n; j += 1) {
      index.set(`${i},${j}`, vertices.length);
      const wobble = () => (jitter === 0 ? 0 : Math.sin(vertices.length * 12.9898) * jitter);
      vertices.push([i * pitch + wobble(), j * pitch + wobble()]);
    }
  }
  const edges = [];
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= n; j += 1) {
      if (i < n) edges.push([index.get(`${i},${j}`), index.get(`${i + 1},${j}`)]);
      if (j < n) edges.push([index.get(`${i},${j}`), index.get(`${i},${j + 1}`)]);
    }
  }
  return {
    vertices_coords: vertices,
    edges_vertices: edges,
    edges_assignment: edges.map((_, k) => (k % 2 ? 'M' : 'V')),
    edges_foldAngle: edges.map((_, k) => (k % 2 ? -90 : 90)),
  };
}

test('a jittered square grid is pulled back onto its lattice', () => {
  const { fold, report } = snapToLattice(grid(4, 0.02));
  assert.ok(fold, `expected a snap, got: ${JSON.stringify(report)}`);
  assert.equal(report.kind, 'square');
  // Measured from the first vertex, not from zero: the lattice has an origin,
  // so absolute coordinates are not multiples of the pitch, offsets are.
  const [ox, oy] = fold.vertices_coords[0];
  for (const [x, y] of fold.vertices_coords) {
    for (const offset of [(x - ox) / report.pitch, (y - oy) / report.pitch]) {
      assert.ok(
        Math.abs(offset - Math.round(offset)) < 1e-9,
        `offset ${offset} is not a whole number of pitches`,
      );
    }
  }
});

test('fold angles and assignments are never touched', () => {
  const before = grid(3, 0.02);
  const { fold } = snapToLattice(before);
  assert.deepEqual(fold.edges_foldAngle, before.edges_foldAngle);
  assert.deepEqual(fold.edges_assignment, before.edges_assignment);
  assert.deepEqual(fold.edges_vertices, before.edges_vertices);
});

test('a free-form pattern is left alone', () => {
  // Directions all over the place: there is no lattice, and moving points would
  // invent geometry.
  const vertices = [
    [0, 0],
    [10, 3],
    [4, 11],
    [17, 5],
    [9, 19],
  ];
  const { fold, report } = snapToLattice({
    vertices_coords: vertices,
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 0],
    ],
  });
  assert.equal(fold, null);
  assert.equal(report.skipped, 'free-form');
});

test('a grid too far off its lattice is left alone', () => {
  // Jitter approaching half the pitch: "which lattice point did this mean" stops
  // having an answer, so it must refuse rather than guess.
  const { fold, report } = snapToLattice(grid(4, 4));
  assert.equal(fold, null, `expected a refusal, got ${JSON.stringify(report)}`);
});

test('refuses when two vertices would merge', () => {
  // The dangerous failure: a snap that quietly collapses two points changes the
  // pattern instead of cleaning it.
  //
  // The stray vertex sits a tenth of a pitch from an occupied lattice point, and
  // is deliberately joined to a *distant* vertex — joining it to its neighbour
  // would make that hairline the shortest edge, and a valid much finer lattice
  // would then be found instead of a merge.
  const base = grid(3, 0);
  const stray = base.vertices_coords.length;
  base.vertices_coords.push([10.1, 10]);
  base.edges_vertices.push([stray, 0]);
  base.edges_assignment.push('M');
  base.edges_foldAngle.push(-90);
  const result = snapToLattice(base);
  assert.equal(result.fold, null, `expected a refusal, got ${JSON.stringify(result.report)}`);
  assert.match(result.report.skipped, /merge|collapse|turn|pitch/);
});

test('an already-exact pattern is unchanged rather than nudged', () => {
  const before = grid(3, 0);
  const { fold, report } = snapToLattice(before);
  assert.ok(fold);
  assert.equal(report.worst, 0);
  fold.vertices_coords.forEach(([x, y], i) => {
    assert.ok(Math.abs(x - before.vertices_coords[i][0]) < 1e-9);
    assert.ok(Math.abs(y - before.vertices_coords[i][1]) < 1e-9);
  });
});

test('a triangular grid is recognised as triangular', () => {
  const p = 10;
  const vertices = [];
  const index = new Map();
  for (let a = 0; a < 4; a += 1) {
    for (let b = 0; b < 4; b += 1) {
      index.set(`${a},${b}`, vertices.length);
      vertices.push([p * (a + b / 2), p * ((b * Math.sqrt(3)) / 2)]);
    }
  }
  const edges = [];
  for (let a = 0; a < 3; a += 1) {
    for (let b = 0; b < 3; b += 1) {
      edges.push([index.get(`${a},${b}`), index.get(`${a + 1},${b}`)]);
      edges.push([index.get(`${a},${b}`), index.get(`${a},${b + 1}`)]);
    }
  }
  const { fold, report } = snapToLattice({ vertices_coords: vertices, edges_vertices: edges });
  assert.ok(fold, `expected a snap, got ${JSON.stringify(report)}`);
  assert.equal(report.kind, 'triangular');
});

test('an empty document is declined, not crashed on', () => {
  assert.equal(snapToLattice({ vertices_coords: [], edges_vertices: [] }).fold, null);
});
