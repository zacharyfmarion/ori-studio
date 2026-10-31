import { expect, it } from 'vitest';
import { createContourClipper, visibleContours } from '../src/contours.js';
import { SpreadComplexityError, visibleFragments } from '../src/fragments.js';
import { visibility } from '../src/visibility.js';
import type { Point, Point3, ProjectedSpread } from '../src/types.js';

function hiddenMask(back = false) {
  // A is physically nearest. B masks its right half, but C masks B. A and C
  // have no known relation: the final A/C contour lies on invisible B's edge.
  const ranges: Point[] = [[0, 2], [1, 2], [0, 2]];
  const mesh: ProjectedSpread = {
    positions: ranges.flatMap(([lo, hi], f) => [[lo, 0, 3-f], [hi, 0, 3-f], [hi, 1, 3-f], [lo, 1, 3-f]] as Point3[]),
    triangles: ranges.flatMap((_, f) => [[4*f,4*f+1,4*f+2], [4*f,4*f+2,4*f+3]]),
    triangleFaces: [0,0,1,1,2,2],
    visibility: visibility(3, back ? [[1,0], [2,1]] : [[0,1], [1,2]], back),
  };
  return { mesh, rings: ranges.map((_, f) => [4*f,4*f+1,4*f+2,4*f+3]) };
}

it.each([false, true])('outlines the visible boundary created by a hidden blocker (back=%s)', back => {
  const { mesh, rings } = hiddenMask(back);
  const fragments = visibleFragments(mesh);
  const contours = visibleContours(mesh, rings, fragments);
  expect(contours).toEqual([{ a: [1,0], b: [1,1] }]);
  // Duplicate/shared original edges do not create duplicate strokes.
  expect(visibleContours(mesh, [...rings, rings[1]], fragments)).toEqual(contours);
});

it('does not outline triangulation seams or an edge already owned by a visible face', () => {
  const { mesh, rings } = hiddenMask();
  const fragments = visibleFragments(mesh);
  const clip = createContourClipper(fragments);
  expect(clip([0], [0,0,3], [2,1,3])).toEqual([]);
  expect(clip([0], [1,0,3], [1,1,3])).toEqual([]);
  expect(visibleContours(mesh, rings, fragments, [0,1,0])).toEqual([]);
  mesh.visibility = visibility(3, [[0,1],[1,2],[0,2]]);
  expect(visibleContours(mesh, rings, visibleFragments(mesh))).toEqual([]);
});

it('clips the contour where a fourth visible face covers it', () => {
  const { mesh, rings } = hiddenMask();
  mesh.positions.push([.5,.3,4], [1.5,.3,4], [1.5,.7,4], [.5,.7,4]);
  mesh.triangles.push([12,13,14], [12,14,15]);
  mesh.triangleFaces.push(3,3);
  mesh.visibility = visibility(4, [[0,1],[1,2]]);
  const contour = visibleContours(mesh, [...rings,[12,13,14,15]], visibleFragments(mesh));
  expect(contour).toEqual([{a:[1,0], b:[1,.3]}, {a:[1,.7], b:[1,1]}]);
});

it.each([1, 1e-5])('preserves a narrow visible boundary under scaling and translation (%s)', scale => {
  const { mesh, rings } = hiddenMask();
  mesh.positions = mesh.positions.map(([x,y,z]) => [x*scale+1000, y*scale-1000, z]);
  const contour = visibleContours(mesh, rings, visibleFragments(mesh));
  expect(contour).toHaveLength(1);
  expect(contour[0].a).toEqual([1000+scale,-1000]);
  expect(contour[0].b).toEqual([1000+scale,-1000+scale]);
});

it('also finds the boundary after perspective division', () => {
  const { mesh, rings } = hiddenMask();
  mesh.positions = mesh.positions.map(([x,y,z]) => [x/(8-z), y/(8-z), 1/(8-z)]);
  const contours = visibleContours(mesh, rings, visibleFragments(mesh));
  expect(contours.some(({a,b}) => Math.abs(a[0]-1/6)<1e-10 && Math.abs(b[0]-1/6)<1e-10)).toBe(true);
});

it('bounds contour extraction work', () => {
  const { mesh } = hiddenMask();
  expect(() => createContourClipper(visibleFragments(mesh), 0)([1], [1,0,2], [1,1,2]))
    .toThrow(SpreadComplexityError);
});
