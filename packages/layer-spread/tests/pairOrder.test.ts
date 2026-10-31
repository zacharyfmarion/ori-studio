import { expect, it } from 'vitest';
import { pickSpread, visibility, coveringTriangles, createWinner } from '../src/visibility.js';
import { visibleFragments, visibleLine } from '../src/fragments.js';
import { barycentric } from '../src/projection.js';
import type { Point, Point3, ProjectedSpread, SpreadInput } from '../src/types.js';

function rectangles(ranges: Point[], orders: Point[], planeGroups?: number[]): SpreadInput {
  const xy: Point[] = ranges.flatMap(([lo, hi]) => [[lo, 0], [hi, 0], [hi, 1], [lo, 1]] as Point[]);
  return { xy, faces: ranges.map((_, i) => [4*i, 4*i+1, 4*i+2, 4*i+3]),
    triangles: ranges.flatMap((_, i) => [[4*i, 4*i+1, 4*i+2], [4*i, 4*i+2, 4*i+3]]),
    triangleFaces: ranges.flatMap((_, i) => [i, i]), orders, planeGroups, cells: [] };
}
function posed(input: SpreadInput, depths: number[], shifts: number[], back = false): ProjectedSpread {
  const positions: Point3[] = input.xy.map(([x,y], v) => [x+shifts[Math.floor(v/4)], y, depths[Math.floor(v/4)]]);
  return { positions, triangles: input.triangles, triangleFaces: input.triangleFaces,
    visibility: visibility(input.faces.length, input.orders, back, input.planeGroups) };
}
function assertFace(mesh: ProjectedSpread, point: Point, face: number) {
  expect(pickSpread(mesh, point)?.face).toBe(face);
  const fragments = visibleFragments(mesh);
  const covers = fragments.filter(f => f.polygon.slice(2).some((p, i) => {
    const w = barycentric(f.polygon[0], f.polygon[i + 1], p, point);
    return w && Math.min(...w) > -1e-10;
  }));
  expect([...new Set(covers.map(f => f.face))]).toEqual([face]);
  for (let f = 0; f < mesh.visibility.above.length; f++) {
    const z = mesh.positions[4*f][2];
    const a: Point3 = [point[0]-.001,point[1],z], b: Point3 = [point[0]+.001,point[1],z];
    if (coveringTriangles(mesh, point).some(t => t.face === f))
      expect(visibleLine(mesh,f,a,b).length > 0).toBe(f === face);
  }
}

it.each([false,true])('keeps known pairs ordered across their entire new overlap (back=%s)', back => {
  // An extra unrelated layer forces the pairwise path. Neither shifted edge
  // belongs to the intersection of the two moved original overlap footprints.
  const input = rectangles([[0,2], [1,3], [10,11]], [[0,1]]);
  const mesh = posed(input, back ? [0,2,0] : [2,0,0], [.25,0,0], back);
  expect(mesh.visibility.ranks).toBeNull();
  expect(mesh.visibility.cyclic).toBe(false);
  for (const x of [1.1,1.5,2.1]) assertFace(mesh, [x,.37], back ? 0 : 1);
});

it('does not infer an order between disjoint faces through an absent intermediate layer', () => {
  const input = rectangles([[0,1],[.5,2.5],[2,3]], [[0,1],[1,2]]);
  const mesh = posed(input, [3,0,1], [2,-5,0]);
  expect(mesh.visibility.ranks).toBeNull();
  assertFace(mesh, [2.2,.37], 0);
  // With the intermediary covering the point, both direct relations apply.
  const all = posed(input, [3,0,1], [2,1,0]);
  assertFace(all, [2.2,.37], 2);
});

it('uses bands only when they cannot invent an unrelated pair comparison', () => {
  expect(visibility(3, [[0,1],[1,2]]).ranks).toBeNull();
  expect(visibility(3, [[0,1],[1,2],[0,2]]).ranks).toEqual([0,1,2]);
  expect(visibility(3, [[0,2],[1,2]]).ranks).toEqual([0,0,1]);
  expect(visibility(3, []).ranks).toEqual([0,0,0]);
});

it('inherits the known relation across flat crease pieces but not unrelated layers', () => {
  const input = rectangles([[0,1],[1,2],[0,2],[10,11]], [[0,2]], [0,0,1,2]);
  const mesh = posed(input, [2,2,1,0], [.25,.25,0,0]);
  expect(mesh.visibility.above).toEqual([[2],[2],[],[]]);
  assertFace(mesh, [1.4,.37], 2);
});

it('keeps physical coverage when a projected cyclic conflict masks everyone', () => {
  const mesh = posed(rectangles([[0,2],[0,2],[0,2]], [[0,1],[1,2],[2,0]]), [2,0,1], [0,0,0]);
  expect(mesh.visibility.cyclic).toBe(true);
  assertFace(mesh, [.4,.3], 0);
});

it('uses the same pair rule after perspective division', () => {
  const mesh = posed(rectangles([[0,2],[1,3],[10,11]], [[0,1]]), [2,0,0], [.25,0,0]);
  mesh.positions = mesh.positions.map(([x,y,z]) => [x/(4-z), y/(4-z), 1/(4-z)]);
  assertFace(mesh, [.4,.17], 1);
});


it('matches direct blockers for every visible subset without inventing rank relations', () => {
  let seed = 29;
  for (let sample = 0; sample < 100; sample++) {
    const edges: Point[] = [];
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      if (seed % 3) edges.push(seed % 3 === 1 ? [a,b] : [b,a]);
    }
    for (const back of [false,true]) {
      const direct = back ? edges.map(([a,b]) => [b,a]) : edges;
      const query = createWinner(visibility(4,edges,back));
      for (let subset = 1; subset < 16; subset++) {
        const present = [0,1,2,3].filter(f => subset & (1 << f));
        const survivors = present.filter(f => !direct.some(([a,b]) => a === f && present.includes(b)));
        // Distinct physical depths deliberately oppose face index.
        const expected = Math.min(...(survivors.length ? survivors : present));
        expect(query(present.map(face => ({face,triangle:face,depth:4-face})))?.face).toBe(expected);
      }
    }
  }
});
