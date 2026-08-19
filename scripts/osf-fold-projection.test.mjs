/**
 * Tests for the `.osf` FOLD-projection extractor.
 *
 * `selectComponent` is the one piece of real logic here — it renumbers
 * vertices, edges and faces, and a remapping that is subtly wrong produces a
 * FOLD document that still parses and describes a different model. The end-to-
 * end guard is `committed_fixtures_are_reproducible_from_their_sources` in
 * `crates/oristudio-cp/tests/non_flat_corpus.rs`, but that only runs when the
 * external corpus is present, which is not the normal case.
 *
 * Run with `npm run test:scripts`, which CI's web-client job also runs. Before
 * that script existed nothing ran this file at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectComponent } from './osf-fold-projection.mjs';

/**
 * Two disjoint triangles, deliberately interleaved.
 *
 * Vertices 0/2/4 are one island and 1/3/5 the other, so a remapping that just
 * slices a contiguous range, or that forgets to renumber at all, produces
 * garbage rather than happening to work.
 */
const twoIslands = () => ({
  file_spec: 1.1,
  vertices_coords: [
    [0, 0],
    [10, 0],
    [1, 0],
    [11, 0],
    [0, 1],
    [10, 2],
  ],
  edges_vertices: [
    [0, 2],
    [2, 4],
    [4, 0],
    [1, 3],
    [3, 5],
    [5, 1],
  ],
  edges_assignment: ['B', 'M', 'B', 'B', 'V', 'B'],
  edges_foldAngle: [0, -90, 0, 0, 45, 0],
  faces_vertices: [
    [0, 2, 4],
    [1, 3, 5],
  ],
  faces_edges: [
    [0, 1, 2],
    [3, 4, 5],
  ],
  'oristudio:edges_line_colors': [0, 1, 0, 0, 2, 0],
});

test('component 0 is the larger island, renumbered from zero', () => {
  const fold = twoIslands();
  // Make island B bigger so "largest first" is testable rather than incidental.
  fold.vertices_coords.push([12, 3]);
  fold.edges_vertices.push([5, 6]);
  fold.edges_assignment.push('M');
  fold.edges_foldAngle.push(-30);
  fold['oristudio:edges_line_colors'].push(1);

  const out = selectComponent(fold, 0);
  assert.deepEqual(out.vertices_coords, [
    [10, 0],
    [11, 0],
    [10, 2],
    [12, 3],
  ]);
  assert.deepEqual(out.edges_vertices, [
    [0, 1],
    [1, 2],
    [2, 0],
    [2, 3],
  ]);
  assert.deepEqual(out.edges_assignment, ['B', 'V', 'B', 'M']);
  assert.deepEqual(out.edges_foldAngle, [0, 45, 0, -30]);
  assert.deepEqual(out['oristudio:edges_line_colors'], [0, 2, 0, 1]);
  assert.deepEqual(out.faces_vertices, [[0, 1, 2]]);
  // faces_edges is indexed into the *edge* array, so it renumbers too.
  assert.deepEqual(out.faces_edges, [[0, 1, 2]]);
  // Untouched keys survive.
  assert.equal(out.file_spec, 1.1);
});

test('component 1 is the other island, and the two partition the input', () => {
  const first = selectComponent(twoIslands(), 0);
  const second = selectComponent(twoIslands(), 1);
  assert.equal(
    first.vertices_coords.length + second.vertices_coords.length,
    twoIslands().vertices_coords.length,
  );
  assert.equal(
    first.edges_vertices.length + second.edges_vertices.length,
    twoIslands().edges_vertices.length,
  );
  assert.equal(
    first.faces_vertices.length + second.faces_vertices.length,
    twoIslands().faces_vertices.length,
  );
});

test('every emitted index is in range', () => {
  for (const index of [0, 1]) {
    const out = selectComponent(twoIslands(), index);
    const vertices = out.vertices_coords.length;
    const edges = out.edges_vertices.length;
    for (const edge of out.edges_vertices) {
      for (const v of edge) assert.ok(v >= 0 && v < vertices, `vertex ${v}`);
    }
    for (const face of out.faces_vertices) {
      for (const v of face) assert.ok(v >= 0 && v < vertices, `face vertex ${v}`);
    }
    for (const face of out.faces_edges) {
      for (const e of face) assert.ok(e >= 0 && e < edges, `face edge ${e}`);
    }
    for (const key of ['edges_assignment', 'edges_foldAngle']) {
      assert.equal(out[key].length, edges, `${key} is not per-edge`);
    }
  }
});

test('asking for a component that does not exist is an error, not an empty file', () => {
  assert.throws(() => selectComponent(twoIslands(), 2), /component 2/);
});

test('a connected document has exactly one component', () => {
  const fold = {
    vertices_coords: [
      [0, 0],
      [1, 0],
      [0, 1],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 0],
    ],
    edges_assignment: ['B', 'B', 'B'],
    edges_foldAngle: [0, 0, 0],
    faces_vertices: [[0, 1, 2]],
  };
  const out = selectComponent(fold, 0);
  assert.deepEqual(out.vertices_coords, fold.vertices_coords);
  assert.deepEqual(out.edges_vertices, fold.edges_vertices);
  assert.throws(() => selectComponent(fold, 1), /component 1/);
});
