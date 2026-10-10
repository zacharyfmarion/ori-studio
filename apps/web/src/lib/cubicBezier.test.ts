import { describe, expect, it } from 'vitest';
import {
  chordSide,
  cubicBounds,
  cubicPoint,
  cubicTangent,
  fitCubic,
  flattenCubic,
  flattenPath,
  measurePath,
  nearestOnPath,
  pathChordArea,
  pathLocationAt,
  pathPointAt,
  pathTangentAt,
  splitCubic,
  subCubic,
  trimPath,
  type Cubic,
  type Vec2,
} from './cubicBezier';

/** A quarter circle of radius 1 about the origin, from (1, 0) to (0, 1), as the usual cubic. */
const K = (4 / 3) * Math.tan(Math.PI / 8);
const QUARTER: Cubic = [
  [1, 0],
  [1, K],
  [K, 1],
  [0, 1],
];
const S: Cubic[] = [
  [
    [0, 0],
    [1, 0],
    [1, 1],
    [2, 1],
  ],
  [
    [2, 1],
    [3, 1],
    [3, 0],
    [4, 0],
  ],
];

const close = (a: Vec2, b: Vec2, digits = 9) => {
  expect(a[0]).toBeCloseTo(b[0], digits);
  expect(a[1]).toBeCloseTo(b[1], digits);
};

describe('a cubic', () => {
  it('lies in the box of its ends and where it turns back, not its handles’', () => {
    // An arch whose handles stand twice as high as it does, and an S whose handles cross over.
    for (const cubic of [
      [[0, 0], [0, 2], [3, 2], [3, 0]],
      [[0, 0], [4, 1], [-1, 2], [3, 3]],
      [[1, 1], [1, 1], [1, 1], [1, 1]],
    ] as Cubic[]) {
      const box = cubicBounds(cubic);
      const samples = Array.from({ length: 2001 }, (_, i) => cubicPoint(cubic, i / 2000));
      expect(box.minX).toBeCloseTo(Math.min(...samples.map(([x]) => x)), 5);
      expect(box.maxX).toBeCloseTo(Math.max(...samples.map(([x]) => x)), 5);
      expect(box.minY).toBeCloseTo(Math.min(...samples.map(([, y]) => y)), 5);
      expect(box.maxY).toBeCloseTo(Math.max(...samples.map(([, y]) => y)), 5);
    }
    expect(cubicBounds([[0, 0], [0, 2], [3, 2], [3, 0]]).maxY).toBeCloseTo(1.5, 12);
  });

  it('runs from its start to its end through points near the circle it stands for', () => {
    close(cubicPoint(QUARTER, 0), [1, 0]);
    close(cubicPoint(QUARTER, 1), [0, 1]);
    for (let t = 0; t <= 1; t += 0.1) expect(Math.hypot(...cubicPoint(QUARTER, t))).toBeCloseTo(1, 3);
  });

  it('splits into two halves that draw the same curve (de Casteljau)', () => {
    const [before, after] = splitCubic(QUARTER, 0.3);
    close(before[3], cubicPoint(QUARTER, 0.3));
    close(after[0], before[3]);
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      close(cubicPoint(before, u), cubicPoint(QUARTER, 0.3 * u));
      close(cubicPoint(after, u), cubicPoint(QUARTER, 0.3 + 0.7 * u));
    }
    for (const u of [0, 0.5, 1]) close(cubicPoint(subCubic(QUARTER, 0.2, 0.6), u), cubicPoint(QUARTER, 0.2 + 0.4 * u));
  });

  it('knows which way it runs where a handle lies on its node', () => {
    close(cubicTangent(QUARTER, 0)!, [0, 1]);
    // The tail's handle drawn back onto it: the direction is toward the next control point.
    const retracted: Cubic = [
      [0, 0],
      [0, 0],
      [1, 1],
      [2, 0],
    ];
    close(cubicTangent(retracted, 0)!, [Math.SQRT1_2, Math.SQRT1_2]);
    const tipRetracted: Cubic = [
      [0, 0],
      [1, 1],
      [2, 0],
      [2, 0],
    ];
    close(cubicTangent(tipRetracted, 1)!, [Math.SQRT1_2, -Math.SQRT1_2]);
    expect(cubicTangent([[1, 1], [1, 1], [1, 1], [1, 1]], 0.5)).toBeNull();
  });

  it('flattens within its tolerance, and no run longer than asked', () => {
    const runs = flattenCubic(QUARTER, 1e-4);
    close(runs[0]!, [1, 0]);
    close(runs[runs.length - 1]!, [0, 1]);
    for (let i = 1; i < runs.length; i += 1) {
      const middle: Vec2 = [(runs[i - 1]![0] + runs[i]![0]) / 2, (runs[i - 1]![1] + runs[i]![1]) / 2];
      // A run's middle is inside the circle by at most the tolerance (and the cubic's own error).
      expect(1 - Math.hypot(...middle)).toBeLessThan(1e-4 + 3e-4);
    }
    const short = flattenCubic(QUARTER, 1, 0.1);
    for (let i = 1; i < short.length; i += 1) {
      expect(Math.hypot(short[i]![0] - short[i - 1]![0], short[i]![1] - short[i - 1]![1])).toBeLessThanOrEqual(0.1);
    }
  });
});

describe('a path', () => {
  it('measures its length, and finds a point a distance along it', () => {
    const measure = measurePath([QUARTER]);
    expect(measure.length).toBeCloseTo(Math.PI / 2, 3);
    close(pathPointAt(measure, measure.length / 2), [Math.SQRT1_2, Math.SQRT1_2], 3);
    close(pathPointAt(measure, -1), [1, 0]);
    close(pathPointAt(measure, 99), [0, 1]);
    close(pathTangentAt(measure, measure.length)!, [-1, 0], 6);
  });

  it('finds the segment a distance falls in, and trims to a stretch that is the same curve', () => {
    const measure = measurePath(S);
    expect(pathLocationAt(measure, measure.length * 0.75).segment).toBe(1);
    const middle = trimPath(measure, measure.length * 0.25, measure.length * 0.75);
    expect(middle).toHaveLength(2);
    close(middle[0]![0], pathPointAt(measure, measure.length * 0.25), 6);
    close(middle[1]![3], pathPointAt(measure, measure.length * 0.75), 6);
    expect(measurePath(middle).length).toBeCloseTo(measure.length / 2, 3);
    expect(trimPath(measure, 1, 1)).toEqual([]);
  });

  it('flattens its segments into one run, each node once', () => {
    const runs = flattenPath(S, 1e-3);
    close(runs[0]!, [0, 0]);
    close(runs[runs.length - 1]!, [4, 0]);
    expect(runs.filter((p) => p[0] === 2 && p[1] === 1)).toHaveLength(1);
  });

  it('finds the point nearest a press, its segment and where along it', () => {
    const nearest = nearestOnPath(S, [3, 1.5])!;
    expect(nearest.segment).toBe(1);
    close(nearest.at, cubicPoint(S[1]!, nearest.t), 12);
    // The best: no sample of the curve is nearer.
    for (let t = 0; t <= 1; t += 0.01) {
      expect(Math.hypot(3 - cubicPoint(S[1]!, t)[0], 1.5 - cubicPoint(S[1]!, t)[1])).toBeGreaterThanOrEqual(nearest.distance - 1e-12);
    }
  });

  it('says which side of its chord it bulges to, in either handedness', () => {
    const over = flattenPath([QUARTER], 1e-3);
    // From (1, 0) to (0, 1), its chord's `(−y, x)` points at the origin, and it bulges the other way.
    expect(pathChordArea(over)).toBeGreaterThan(0);
    // Its mirror image bulges the way the mirrored `(−y, x)` points.
    expect(pathChordArea(over.map(([x, y]): Vec2 => [x, -y]))).toBeLessThan(0);
    // An S lies on both sides as much, and says neither.
    const symmetric: Cubic = [
      [0, 0],
      [1, 1],
      [3, -1],
      [4, 0],
    ];
    expect(Math.abs(pathChordArea(flattenPath([symmetric], 1e-3)))).toBeLessThan(1e-9);
  });

  it('says a straight path lies on neither side, wherever it is and at whatever scale', () => {
    for (let k = 0; k < 40; k += 1) {
      for (const scale of [1, 189, 283.46]) {
        const a: Vec2 = [(0.1 + 0.013 * k) * scale, (0.2 + 0.0071 * k) * scale];
        const d: Vec2 = [(0.37 + 0.013 * k) * scale, (0.31 + 0.0071 * k) * scale];
        const points = flattenPath([[a, a, d, d]], 1e-4 * scale, scale / 100);
        expect(points.length).toBeGreaterThan(3);
        expect(chordSide(points, Math.hypot(d[0] - a[0], d[1] - a[1]))).toBe(0);
      }
    }
    // A path that bulges says so, as the area's sign does.
    const over = flattenPath([QUARTER], 1e-3);
    expect(chordSide(over, Math.SQRT2)).toBe(1);
    expect(chordSide(over.map(([x, y]): Vec2 => [x, -y]), Math.SQRT2)).toBe(-1);
  });

  it('takes the direction of travel past a segment of no length, a node stacked on its neighbour', () => {
    const at: Vec2 = [0.2, 0.5];
    const stacked: Cubic[] = [
      [at, at, at, at],
      [at, at, [0.2, 0.502], [0.2, 0.502]],
    ];
    const measure = measurePath(stacked);
    const [x, y] = pathTangentAt(measure, 0)!;
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(1, 9);
    // At the end of a path whose last segment has no length, where it came from.
    const [bx, by] = pathTangentAt(measurePath([...stacked].reverse().map((c) => [...c].reverse() as unknown as Cubic)), Infinity)!;
    expect(bx).toBeCloseTo(0, 9);
    expect(by).toBeCloseTo(-1, 9);
  });
});

describe('fitCubic', () => {
  const unit = (v: readonly [number, number]): [number, number] => {
    const length = Math.hypot(v[0], v[1]);
    return [v[0] / length, v[1] / length];
  };
  /** How far the fit strays from the points it was fitted to, at most. */
  const strays = (cubic: Cubic, points: readonly (readonly [number, number])[]) =>
    Math.max(...points.map((point) => nearestOnPath([cubic], point)!.distance));

  it('gives back a cubic sampled along itself, its handles where they were', () => {
    const cubic: Cubic = [[0, 0], [2, 3], [6, 3], [8, 0]];
    const points = Array.from({ length: 41 }, (_, i) => cubicPoint(cubic, i / 40));
    const fitted = fitCubic(points, unit([2, 3]), unit([-2, 3]));
    for (let i = 0; i < 4; i += 1) {
      expect(fitted[i]![0]).toBeCloseTo(cubic[i]![0], 3);
      expect(fitted[i]![1]).toBeCloseTo(cubic[i]![1], 3);
    }
  });

  it('follows a quarter circle within a few thousandths of its radius', () => {
    const points = Array.from({ length: 33 }, (_, i) => {
      const angle = ((Math.PI / 2) * i) / 32;
      return [Math.cos(angle), Math.sin(angle)] as const;
    });
    const fitted = fitCubic(points, [0, 1], [1, 0]);
    expect(strays(fitted, points)).toBeLessThan(0.003);
  });

  it('takes a third of the chord for each handle with too little to fit', () => {
    expect(fitCubic([[0, 0], [3, 0]], [1, 0], [-1, 0])).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
  });
});
