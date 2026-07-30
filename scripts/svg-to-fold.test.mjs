/**
 * Tests for the Origami Simulator SVG -> FOLD converter.
 *
 * Run with: node --test scripts/svg-to-fold.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { svgToFold } from './svg-to-fold.mjs';

const wrap = (body) => `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

test('opacity becomes the fold angle, signed by assignment', () => {
  const { fold } = svgToFold(
    wrap(`
      <line stroke="#FF0000" opacity="0.5" x1="0" y1="0" x2="10" y2="0"/>
      <line stroke="#0000FF" opacity="0.25" x1="0" y1="0" x2="0" y2="10"/>
      <line stroke="#FF0000" x1="10" y1="0" x2="10" y2="10"/>
    `)
  );
  // FOLD signs a mountain negative and a valley positive; 0.5 opacity is 90 deg.
  assert.deepEqual(fold.edges_assignment, ['M', 'V', 'M']);
  assert.deepEqual(fold.edges_foldAngle, [-90, 45, -180]);
});

test('scientific notation is a small angle, not a large one', () => {
  // Illustrator writes `5.5645e-02`, which is 0.056 -> about 10 degrees. Parsed
  // as `5.5645` it would clamp to a full fold and quietly flatten the model.
  const { fold } = svgToFold(
    wrap('<line stroke="#0000FF" stroke-opacity="5.5645e-02" x1="0" y1="0" x2="10" y2="0"/>')
  );
  assert.ok(fold.edges_foldAngle[0] > 9 && fold.edges_foldAngle[0] < 11);
});

test('reads stroke and opacity from a stylesheet class', () => {
  // One real file uses classes rather than inline attributes, and reading only
  // the inline form dropped it entirely.
  const { fold } = svgToFold(
    wrap(`
      <style type="text/css">.st0{fill:none;stroke:#0000FF;stroke-opacity:0.5;}</style>
      <path class="st0" d="M0,0h10"/>
    `)
  );
  assert.deepEqual(fold.edges_assignment, ['V']);
  assert.deepEqual(fold.edges_foldAngle, [90]);
});

test('every stroke colour maps to its FOLD assignment', () => {
  const { fold } = svgToFold(
    wrap(`
      <line stroke="#FF0000" x1="0" y1="0" x2="1" y2="0"/>
      <line stroke="#0000FF" x1="0" y1="1" x2="1" y2="1"/>
      <line stroke="#000000" x1="0" y1="2" x2="1" y2="2"/>
      <line stroke="#FFFF00" x1="0" y1="3" x2="1" y2="3"/>
      <line stroke="#FF00FF" x1="0" y1="4" x2="1" y2="4"/>
      <line stroke="#00FF00" x1="0" y1="5" x2="1" y2="5"/>
    `)
  );
  assert.deepEqual(fold.edges_assignment, ['M', 'V', 'B', 'F', 'U', 'B']);
  // Only a driven crease carries an angle; a facet or boundary is flat.
  assert.deepEqual(fold.edges_foldAngle.slice(2), [0, 0, 0, 0]);
});

test('straight path commands, absolute and relative', () => {
  const { fold } = svgToFold(
    wrap('<path stroke="#000000" d="M0,0 H10 V10 h-10 Z"/>')
  );
  assert.equal(fold.vertices_coords.length, 4);
  assert.equal(fold.edges_vertices.length, 4);
});

test('a curved path is skipped, never flattened into a straight line', () => {
  // Silently turning a curve into a chord would change the model. Better to
  // report it missing than to invent geometry.
  const { fold, stats } = svgToFold(
    wrap(`
      <path stroke="#FF0000" d="M0,0 C5,5 10,5 15,0"/>
      <line stroke="#0000FF" x1="0" y1="0" x2="10" y2="0"/>
    `)
  );
  assert.equal(stats.skippedCurves, 1);
  assert.equal(fold.edges_vertices.length, 1);
});

test('coincident endpoints weld into one vertex', () => {
  const { fold } = svgToFold(
    wrap(`
      <line stroke="#FF0000" x1="0" y1="0" x2="10" y2="0"/>
      <line stroke="#0000FF" x1="10" y1="0" x2="10" y2="10"/>
    `)
  );
  assert.equal(fold.vertices_coords.length, 3);
});

test('a repeated segment is not emitted twice', () => {
  const { fold, stats } = svgToFold(
    wrap(`
      <line stroke="#FF0000" x1="0" y1="0" x2="10" y2="0"/>
      <line stroke="#FF0000" x1="10" y1="0" x2="0" y2="0"/>
    `)
  );
  assert.equal(stats.duplicates, 1);
  assert.equal(fold.edges_vertices.length, 1);
});

test('flipping y mirrors the pattern and nothing else', () => {
  const body = '<line stroke="#FF0000" opacity="0.5" x1="0" y1="0" x2="10" y2="4"/>';
  const plain = svgToFold(wrap(body));
  const flipped = svgToFold(wrap(body), { flipY: true });
  assert.deepEqual(plain.fold.edges_foldAngle, flipped.fold.edges_foldAngle);
  assert.deepEqual(flipped.fold.vertices_coords, [
    [0, 4],
    [10, 0],
  ]);
});

test('a file with no recognised crease is an error, not an empty model', () => {
  assert.throws(() => svgToFold(wrap('<line stroke="#123456" x1="0" y1="0" x2="1" y2="1"/>')));
});

test('a crease crossing another is split into a shared vertex', () => {
  // An SVG is a drawing: two lines that cross merely look connected. A crease
  // pattern is a graph, where meeting means sharing a vertex.
  const { fold } = svgToFold(
    wrap(`
      <line stroke="#FF0000" x1="-10" y1="0" x2="10" y2="0"/>
      <line stroke="#0000FF" x1="0" y1="-10" x2="0" y2="10"/>
    `)
  );
  assert.equal(fold.edges_vertices.length, 4, 'both segments split at the crossing');
  const centre = fold.vertices_coords.findIndex(([x, y]) => Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9);
  assert.ok(centre >= 0, 'the crossing became a vertex');
  const touching = fold.edges_vertices.filter(([a, b]) => a === centre || b === centre);
  assert.equal(touching.length, 4, 'all four arms meet at it');
});

test('split pieces keep their parent assignment and fold angle', () => {
  const { fold } = svgToFold(
    wrap(`
      <line stroke="#FF0000" opacity="0.5" x1="-10" y1="0" x2="10" y2="0"/>
      <line stroke="#0000FF" opacity="0.25" x1="0" y1="-10" x2="0" y2="10"/>
    `)
  );
  const mountains = fold.edges_foldAngle.filter((_, i) => fold.edges_assignment[i] === 'M');
  const valleys = fold.edges_foldAngle.filter((_, i) => fold.edges_assignment[i] === 'V');
  assert.deepEqual(mountains, [-90, -90]);
  assert.deepEqual(valleys, [45, 45]);
});

test('a crease ending part-way along the boundary splits it', () => {
  // The case that produced the bug report: without this the boundary stays one
  // edge, so the crease's endpoint is an interior vertex of degree one and the
  // flat checker reports an odd fold count on the visible edge of the paper.
  const { fold } = svgToFold(
    wrap(`
      <line stroke="#000000" x1="0" y1="0" x2="100" y2="0"/>
      <line stroke="#FF0000" x1="50" y1="0" x2="50" y2="50"/>
    `)
  );
  const boundary = fold.edges_assignment.filter((a) => a === 'B').length;
  assert.equal(boundary, 2, 'the boundary is split at the crease endpoint');
});

test('a crease drawn short of the boundary is pulled onto it', () => {
  // Illustrator routinely stops a crease a fraction short. Left alone there is
  // no intersection to split at, and the endpoint stays dangling.
  const { fold, stats } = svgToFold(
    wrap(`
      <line stroke="#000000" x1="0" y1="0" x2="100" y2="0"/>
      <line stroke="#FF0000" x1="50" y1="0.05" x2="50" y2="50"/>
    `)
  );
  assert.equal(stats.snapped, 1);
  assert.equal(fold.edges_assignment.filter((a) => a === 'B').length, 2);
});

test('an endpoint far from everything is left where it is', () => {
  // Beyond the snap radius is a genuine dangling end, not a rounding error, and
  // moving it would invent geometry.
  const { fold, stats } = svgToFold(
    wrap(`
      <line stroke="#000000" x1="0" y1="0" x2="100" y2="0"/>
      <line stroke="#FF0000" x1="50" y1="20" x2="50" y2="50"/>
    `)
  );
  assert.equal(stats.snapped, 0);
  assert.equal(fold.edges_assignment.filter((a) => a === 'B').length, 1);
});

test('splitting can be turned off', () => {
  const body = `
    <line stroke="#FF0000" x1="-10" y1="0" x2="10" y2="0"/>
    <line stroke="#0000FF" x1="0" y1="-10" x2="0" y2="10"/>
  `;
  assert.equal(svgToFold(wrap(body), { planar: false }).fold.edges_vertices.length, 2);
});
