/**
 * Tests for the 22.5-degree angle snapper.
 *
 * Run with: node --test scripts/snap-to-angles.test.mjs
 *
 * Most of these are about *refusing*. The snapper moves every vertex in the
 * file, so the interesting failures are all cases where it should decline and
 * might not — and a test suite that only checked the happy path would pass
 * while the thing quietly mangled a free-form pattern.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapToAngles, classify } from './snap-to-angles.mjs';

/**
 * A square of side 100 with both diagonals and both midlines.
 *
 * `jitter` displaces the centre vertex, which is over-determined: the diagonals
 * fix it to y = x and y = 100 - x, the midlines to x = 50 and y = 50. Every one
 * of those says (50, 50), so the constraints are consistent and there is exactly
 * one answer for the solve to find.
 *
 * Kept under 0.1 degrees of deviation on purpose. A larger nudge would land in
 * the band between rounding and design, where the snapper is supposed to refuse
 * — correct behaviour, but not what most of these tests are about.
 */
function squareWithDiagonals(jitter = 0) {
  return {
    vertices_coords: [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [50, 50 + jitter],
      [50, 0],
      [100, 50],
      [50, 100],
      [0, 50],
    ],
    edges_vertices: [
      [0, 5],
      [5, 1],
      [1, 6],
      [6, 2],
      [2, 7],
      [7, 3],
      [3, 8],
      [8, 0],
      [0, 4],
      [4, 2],
      [1, 4],
      [4, 3],
      [5, 4],
      [6, 4],
      [7, 4],
      [8, 4],
    ],
    edges_assignment: [
      'B', 'B', 'B', 'B', 'B', 'B', 'B', 'B',
      'M', 'M', 'V', 'V', 'M', 'V', 'M', 'V',
    ],
  };
}

/** Deviation of an edge from the nearest multiple of `base`, in degrees. */
const deviationOf = (fold, index, base = 22.5) => {
  const direction = directionOf(fold, index);
  const m = ((direction % base) + base) % base;
  return Math.min(m, base - m);
};

const directionOf = (fold, index) => {
  const [a, b] = fold.edges_vertices[index];
  const [ax, ay] = fold.vertices_coords[a];
  const [bx, by] = fold.vertices_coords[b];
  const angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
  return ((angle % 180) + 180) % 180;
};

test('a nudged vertex is pulled back until every direction is exact', () => {
  const { fold, report } = snapToAngles(squareWithDiagonals(0.03));
  assert.ok(fold, `expected a snap, got: ${report.skipped}`);
  assert.equal(report.base, 22.5);
  for (let i = 0; i < fold.edges_vertices.length; i += 1) {
    assert.ok(deviationOf(fold, i) < 1e-9, `edge ${i} is ${deviationOf(fold, i)} degrees off`);
  }
  // The centre lands where the four corners say it should. Note it does *not*
  // land on (50, 50): minimising the total squared movement spreads the 0.03
  // correction over all nine vertices rather than spending it all on one, so the
  // whole square shifts by 0.0033 and the centre comes to rest at its centre.
  // That is the right answer, and asserting the naive one would be asserting a
  // worse solver.
  const corners = [0, 1, 2, 3].map((i) => fold.vertices_coords[i]);
  const mean = (axis) => corners.reduce((sum, c) => sum + c[axis], 0) / 4;
  assert.ok(Math.abs(fold.vertices_coords[4][0] - mean(0)) < 1e-9);
  assert.ok(Math.abs(fold.vertices_coords[4][1] - mean(1)) < 1e-9);
  // Nothing moved further than the error being corrected.
  assert.ok(report.worstMove <= 0.03, `moved ${report.worstMove}`);
});

test('an exact pattern is left exactly where it is', () => {
  const { fold, report } = snapToAngles(squareWithDiagonals(0));
  assert.ok(fold);
  assert.equal(report.worstMove, 0);
  assert.deepEqual(fold.vertices_coords, squareWithDiagonals(0).vertices_coords);
});

test('fold angles and assignments survive untouched', () => {
  const input = squareWithDiagonals(0.03);
  input.edges_foldAngle = [0, 0, 0, 0, 0, 0, 0, 0, -180, -180, 90, 90, -180, 90, -180, 90];
  const { fold } = snapToAngles(input);
  assert.deepEqual(fold.edges_assignment, input.edges_assignment);
  assert.deepEqual(fold.edges_foldAngle, input.edges_foldAngle);
  assert.equal(fold.edges_vertices.length, input.edges_vertices.length);
  assert.equal(fold.vertices_coords.length, input.vertices_coords.length);
});

test('a free-form pattern is refused, not forced onto a system', () => {
  // Directions chosen to sit nowhere near a multiple of 22.5 or its
  // subdivisions. Snapping these would invent a design nobody drew.
  const fold = {
    vertices_coords: [
      [0, 0],
      [100, 17],
      [63, 100],
      [20, 44],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [0, 2],
    ],
  };
  const result = snapToAngles(fold);
  assert.equal(result.fold, null);
  assert.match(result.report.skipped, /on any angle system/);
});

test('an edge between rounding and design is refused as ambiguous', () => {
  // 0.25 degrees off is too big to be coordinate rounding and too small to be a
  // deliberate direction. That is the one case this cannot call, so it must not
  // guess -- picking either reading silently rewrites somebody's pattern.
  const fold = squareWithDiagonals(0);
  const radians = (45.25 * Math.PI) / 180;
  fold.vertices_coords.push([100 + 50 * Math.cos(radians), 50 * Math.sin(radians)]);
  fold.edges_vertices.push([1, 9]);
  const result = snapToAngles(fold);
  assert.equal(result.fold, null);
  assert.match(result.report.skipped, /between rounding and design/);
});

test('a genuinely off-system crease is left free, and the rest still snap', () => {
  // The `flat_crane` shape: a 22.5-degree design with a few shaping folds at
  // angles the folder picked by eye. Refusing the whole file over those would
  // throw away the 94% that is exact.
  const fold = squareWithDiagonals(0.03);
  const radians = (37 * Math.PI) / 180;
  fold.vertices_coords.push([100 * Math.cos(radians), 100 * Math.sin(radians)]);
  fold.edges_vertices.push([0, 9]);
  const result = snapToAngles(fold);
  assert.ok(result.fold, `expected a snap, got: ${result.report.skipped}`);
  assert.equal(result.report.free, 1);
  assert.equal(result.report.constrained, 16);
  // The free edge keeps its direction; it was never the thing being corrected.
  assert.ok(Math.abs(directionOf(result.fold, 16) - 37) < 0.5);
  // ...and everything else still came out exact.
  for (let i = 0; i < 16; i += 1) {
    assert.ok(deviationOf(result.fold, i) < 1e-9, `edge ${i} is ${deviationOf(result.fold, i)} off`);
  }
});

test('a file with a sub-quantum sliver is refused', () => {
  // A sliver has no direction worth constraining, but both its endpoints are
  // vertices whose fans the checks read -- so letting the solve swing it
  // invents violations. Measured on `huffmanExtrudedBoxes`: flat 73 -> 76.
  const fold = squareWithDiagonals(0.03);
  fold.vertices_coords.push([50, 50.032]);
  fold.edges_vertices.push([4, 9]);
  const result = snapToAngles(fold);
  assert.equal(result.fold, null);
  assert.match(result.report.skipped, /below the coordinate quantum/);
});

test('the coarsest angle system that fits is the one chosen', () => {
  // A 22.5-degree design must not be reported as a 3.75-degree one: every
  // multiple of 22.5 is also a multiple of 3.75, so the finer base is the weaker
  // claim and accepts six times as much by chance.
  assert.equal(classify(squareWithDiagonals(0).vertices_coords, squareWithDiagonals(0).edges_vertices).base, 22.5);

  const eighth = { vertices_coords: [[0, 0]], edges_vertices: [] };
  for (let k = 1; k <= 8; k += 1) {
    const radians = (k * 7.5 * Math.PI) / 180;
    eighth.vertices_coords.push([100 * Math.cos(radians), 100 * Math.sin(radians)]);
    eighth.edges_vertices.push([0, k]);
  }
  assert.equal(classify(eighth.vertices_coords, eighth.edges_vertices).base, 7.5);
});

test('an empty document is refused rather than crashing', () => {
  assert.equal(snapToAngles({}).fold, null);
  assert.equal(snapToAngles({ vertices_coords: [[0, 0]], edges_vertices: [] }).fold, null);
});

test('the exactness gate is what catches an inconsistent system', () => {
  // Revert check: with the gate's bar relaxed to something meaningless, a
  // deliberately contradictory pattern would sail through. It is the only thing
  // standing between a contradiction and a silently mangled file, because a
  // solver handed one returns a compromise rather than an error.
  //
  // Four points where three edges claim 0 degrees and the fourth claims 90 for
  // a pair already 100 apart horizontally -- no placement satisfies all four.
  const fold = {
    vertices_coords: [
      [0, 0],
      [100, 0.02],
      [200, 0],
      [300, 0.02],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [0, 3],
    ],
  };
  const result = snapToAngles(fold);
  // Whatever it does here, it must not claim success while leaving an edge off
  // its target -- that is the failure this whole gate exists to prevent.
  if (result.fold) {
    for (let i = 0; i < result.fold.edges_vertices.length; i += 1) {
      const off = deviationOf(result.fold, i);
      assert.ok(off < 1e-9, `claimed success with edge ${i} ${off} degrees off target`);
    }
  }
});
