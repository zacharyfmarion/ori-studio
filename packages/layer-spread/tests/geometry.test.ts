import { describe, expect, it } from 'vitest';
import {
  faceLineSegments,
  interpolate,
  SpreadComplexityError,
  barycentric,
  diagramPositions,
  orderSide,
  pickSpread,
  visibility,
  visibleFragments,
  visibleLine,
  createWinner,
  type ProjectedSpread,
  type SpreadInput,
  type SpreadSolution,
} from '../src/index.js';

it('reuses cyclic visibility scratch without retaining faces from previous samples', () => {
  const order = visibility(3, [[0, 1], [1, 2], [2, 0]]);
  const query = createWinner(order);
  const a = { face: 0, triangle: 0, depth: 5 };
  const b = { face: 1, triangle: 1, depth: 1 };
  const c = { face: 2, triangle: 2, depth: 3 };
  for (let repeat = 0; repeat < 10; repeat++) {
    expect(query([a, b])).toBe(b);
    expect(query([a, b, c])).toBe(a); // All masked: physical depth.
    expect(query([b, c])).toBe(c);
    expect(query([a, c])).toBe(a);
    expect(query([])).toBeNull();
  }
});

it('matches the declarative visibility policy across repeated ranks, cycles and depth ties', () => {
  let seed = 1283;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (const orders of [[[0, 1], [1, 2]], [[0, 1], [1, 2], [2, 0]]] as [number, number][][]) {
    const order = visibility(6, orders), query = createWinner(order);
    for (let i = 0; i < 500; i++) {
      const candidates = Array.from({ length: Math.floor(random() * 15) }, (_, triangle) => ({
        face: Math.floor(random() * 6), triangle, depth: Math.floor(random() * 4) + random() * 2e-10,
      }));
      const present = new Set(candidates.map(c => c.face));
      const rank = order.ranks ? Math.max(...candidates.map(c => order.ranks![c.face])) : 0;
      const survivors = candidates.filter(c => order.ranks ? order.ranks[c.face] === rank
        : !order.above[c.face].some(f => present.has(f)));
      const eligible = survivors.length ? survivors : candidates;
      const expected = eligible.reduce<typeof candidates[number] | null>((a, b) =>
        !a || b.depth > a.depth + 1e-10 || (Math.abs(a.depth - b.depth) <= 1e-10 && b.triangle > a.triangle) ? b : a, null);
      expect(query(candidates)).toBe(expected);
    }
  }
});

const input: SpreadInput = {
  xy: [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
  faces: [[0, 1, 2]],
  triangles: [[0, 1, 2]],
  triangleFaces: [0],
  orders: [],
  cells: [],
};
const solution = {
  heights: [1, 3, 2],
  references: [
    { plane: [2, 1, 1], center: [0, 0, 1], samples: 1, rms: 0 },
    { plane: [2, 1, 1], center: [0, 0, 1], samples: 1, rms: 0 },
  ],
} as SpreadSolution;
function stack(orders: [number, number][], depths: number[]): ProjectedSpread {
  return {
    positions: depths.flatMap(
      (z) =>
        [
          [0, 0, z],
          [1, 0, z],
          [0, 1, z],
        ] as [number, number, number][],
    ),
    triangles: depths.map((_, f) => [3 * f, 3 * f + 1, 3 * f + 2]),
    triangleFaces: depths.map((_, f) => f),
    visibility: visibility(depths.length, orders),
  };
}
describe('connected spread projection', () => {
  it('leaves the fitted surface head-on, including when tilted and viewed from the back', () => {
    for (const back of [false, true])
      expect(
        diagramPositions(input, solution, { kind: 'connected', version: 1, amount: 2, reveal: [1.2, -0.7] }, back).map(
          (p) => p.slice(0, 2),
        ),
      ).toEqual(input.xy);
  });
  it('zero amount is the original XY and zero Z', () => {
    expect(
      diagramPositions(input, solution, { kind: 'connected', version: 1, amount: 0, reveal: [1, 1] }, false),
    ).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
  });
  it('interpolates inside the rendered triangle rather than over the whole warped face', () => {
    expect(barycentric([0, 0], [1, 0], [0, 1], [0.25, 0.5])).toEqual([0.25, 0.25, 0.5]);
  });
});
describe('ordering in drawing, picking and vector output', () => {
  it('hides a physically protruding lower face and its ink', () => {
    const mesh = stack([[0, 1]], [1, 0]);
    expect(pickSpread(mesh, [0.2, 0.2])?.face).toBe(1);
    expect(visibleFragments(mesh).map((p) => p.face)).toEqual([1]);
    expect(visibleLine(mesh, 0, [0.1, 0.1, 1], [0.5, 0.1, 1])).toEqual([]);
    expect(visibleLine(mesh, 1, [0.1, 0.1, 0], [0.5, 0.1, 0])).toEqual([[0, 1]]);
  });
  it('reverses bands from the back', () => {
    const mesh = stack([[0, 1]], [1, 0]);
    mesh.visibility = visibility(2, [[0, 1]], true);
    expect(pickSpread(mesh, [0.2, 0.2])?.face).toBe(0);
    expect(visibleFragments(mesh).map((p) => p.face)).toEqual([0]);
  });
  it('keeps a known outline over lower paper when roundoff puts it outside its own triangle', () => {
    const mesh = stack([[0, 1], [1, 2]], [2, 1, 0]);
    mesh.positions[0] = [-1, -1, 2];
    mesh.positions[1] = [2, -1, 2];
    mesh.positions[2] = [-1, 2, 2];
    mesh.positions[3] = [0, 1e-8, 1];
    mesh.positions[4] = [1, 1e-8, 1];
    // A higher-ranked flap covers only the second half of the outline.
    mesh.positions[6] = [0.5, -1, 0];
    mesh.positions[7] = [2, -1, 0];
    mesh.positions[8] = [0.5, 2, 0];
    expect(pickSpread(mesh, [0.25, 0])?.face).toBe(0);
    expect(visibleLine(mesh, 1, [0, 0, 1], [1, 0, 1])).toEqual([[0, 0.5]]);
  });
  it('still clips a known outline using physical depth inside a projected cycle', () => {
    const mesh = stack([[0, 1], [1, 2], [2, 0]], [1, 3, 2]);
    mesh.positions[0][1] = 1e-8;
    mesh.positions[1][1] = 1e-8;
    expect(visibleLine(mesh, 0, [0, 0, 1], [1, 0, 1])).toEqual([]);
    expect(visibleLine(mesh, 0, [0, 0, 4], [1, 0, 4])).toEqual([[0, 1]]);
  });
  it('preserves physical depth where a projected cycle masks every face', () => {
    const mesh = stack(
      [
        [0, 1],
        [1, 2],
        [2, 0],
      ],
      [1, 3, 2],
    );
    expect(mesh.visibility.ranks).toBeNull();
    expect(pickSpread(mesh, [0.2, 0.2])?.face).toBe(1);
    expect(visibleFragments(mesh).map((p) => p.face)).toEqual([1]);
  });
  it('clips a crossing of unrelated faces at the physical intersection', () => {
    const mesh = stack([], [0, 0]);
    mesh.positions[3][2] = -1;
    mesh.positions[4][2] = 1;
    mesh.positions[5][2] = -1;
    const fragments = visibleFragments(mesh);
    for (const p of [
      [0.1, 0.1],
      [0.8, 0.1],
    ] as [number, number][]) {
      const expected = pickSpread(mesh, p)!.face;
      const actual = fragments.filter((f) => {
        const pts = f.polygon;
        for (let i = 1; i + 1 < pts.length; i++) {
          const w = barycentric(pts[0], pts[i], pts[i + 1], p);
          if (w && Math.min(...w) >= 0) return true;
        }
        return false;
      });
      expect(actual.map((f) => f.face)).toEqual([expected]);
    }
  });
  it('retains the side at edge-on without disabling correction', () => {
    expect(orderSide(0, 'back')).toBe('back');
    expect(orderSide(0)).toBe('front');
    expect(orderSide(-0.1, 'front')).toBe('back');
  });
});

it('splits a crease across a warped face at the rendered triangle boundary', () => {
  const face: SpreadInput = {
    xy: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    faces: [[0, 1, 2, 3]],
    triangles: [
      [0, 1, 2],
      [0, 2, 3],
    ],
    triangleFaces: [0, 0],
    orders: [],
    cells: [],
  };
  const positions: [number, number, number][] = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 1],
    [0, 1, 0],
  ];
  const segments = faceLineSegments(face, 0, [0, 0.5], [1, 0.5]);
  expect(segments).toHaveLength(2);
  const ends = segments.map((s) => [interpolate(s.ids, s.wa, positions), interpolate(s.ids, s.wb, positions)]);
  expect(ends[0][1]).toEqual(ends[1][0]);
  expect(ends[0][1][2]).toBeCloseTo(0.5);
  expect(ends[0][0][2]).toBeCloseTo(0);
});
it('reports bounded vector complexity instead of returning missing faces', () => {
  expect(() => visibleFragments(stack([[0, 1]], [1, 0]), 0)).toThrow(SpreadComplexityError);
});
it('does not duplicate slivers when clipping touching and repeated edges', () => {
  const mesh = stack([], [0, 1, 2]);
  mesh.positions[4] = [1, 1e-11, 1];
  mesh.positions[7] = [1, -1e-11, 2];
  const fragments = visibleFragments(mesh, 500);
  expect(fragments.length).toBeLessThan(12);
  expect(pickSpread(mesh, [0.2, 0.2])?.face).toBe(2);
});

it('drops numerically zero-width fragments without discarding real thin layers far from the origin', () => {
  const mesh = stack([[0, 1]], [0, 1]);
  mesh.positions = [
    [4000, 3000, 0], [4100, 3000, 0], [4000, 3100, 0],
    [4000, 3000, 1], [4100, 3000 + 1e-11, 1], [4000, 3100, 1],
  ];
  const fragments = visibleFragments(mesh);
  expect(fragments.map((f) => f.face)).toEqual([1]);
  mesh.positions[4][1] = 3000 + 1e-5;
  expect(visibleFragments(mesh).some((f) => f.face === 0)).toBe(true);
});

it('clips physical crossings consistently when a model is translated far across the page', () => {
  for (const offset of [0, 4000, -100000]) {
    const mesh = stack([], [0, 0]);
    mesh.positions[3][2] = -1;
    mesh.positions[4][2] = 1;
    mesh.positions[5][2] = -1;
    for (const p of mesh.positions) { p[0] += offset; p[1] -= offset; }
    const visible = visibleLine(mesh, 0, [offset, 0.1 - offset, 0], [offset + 0.8, 0.1 - offset, 0]);
    expect(visible).toHaveLength(1);
    expect(visible[0][0]).toBe(0);
    expect(visible[0][1]).toBeCloseTo(0.625, 8);
    const area = visibleFragments(mesh).reduce((total, f) => {
      const [o, ...ring] = f.polygon;
      let twice = 0;
      for (let i = 0; i + 1 < ring.length; i++) {
        const a = ring[i], b = ring[i + 1];
        twice += (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      }
      return total + Math.abs(twice) / 2;
    }, 0);
    expect(area).toBeCloseTo(0.5, 8);
  }
});
