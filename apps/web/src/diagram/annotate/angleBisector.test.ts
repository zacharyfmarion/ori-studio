import { describe, expect, it } from 'vitest';
import {
  angleIncentre,
  bisectBetween,
  bisectFromLines,
  bisectFromPoints,
  bisectorPick,
  bisectorPreview,
  bisectorStep,
  bisectorUnpick,
  NO_PICKS,
  parallelMidline,
  type Bisected,
  type BisectorPicks,
  type PickedLine,
} from './angleBisector';
import type { PicturePoint } from './annotationModel';

/** The kernel's `center` (`crates/oristudio-cp/src/geometry/orita_calc.rs`), as written there. */
function kernelCenter(ta: PicturePoint, tb: PicturePoint, tc: PicturePoint): PicturePoint {
  const [xa, ya] = ta;
  const [xb, yb] = tb;
  const [xc, yc] = tc;
  const a = Math.sqrt((xc - xb) * (xc - xb) + (yc - yb) * (yc - yb));
  const b = Math.sqrt((xa - xc) * (xa - xc) + (ya - yc) * (ya - yc));
  const c = Math.sqrt((xb - xa) * (xb - xa) + (yb - ya) * (yb - ya));
  const xd = (c * xc + b * xb) / (b + c);
  const yd = (c * yc + b * yb) / (b + c);
  const xe = (c * xc + a * xa) / (a + c);
  const ye = (c * yc + a * ya) / (a + c);
  const g = xd - xa;
  const h = yd - ya;
  const k = xe - xb;
  const l = ye - yb;
  const p = g * ya - h * xa;
  const q = k * yb - l * xb;
  return [(g * q - k * p) / (h * k - g * l), (l * p - h * q) / (g * l - h * k)];
}

const angleAt = (vertex: PicturePoint, p: PicturePoint, q: PicturePoint) => {
  const u = [p[0] - vertex[0], p[1] - vertex[1]];
  const v = [q[0] - vertex[0], q[1] - vertex[1]];
  return Math.acos((u[0]! * v[0]! + u[1]! * v[1]!) / (Math.hypot(u[0]!, u[1]!) * Math.hypot(v[0]!, v[1]!)));
};

/** Whether `p` is on the line through `a` and `b`. */
const onLine = (p: PicturePoint, { a, b }: PickedLine) =>
  Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) < 1e-12;

function drawnOf(result: unknown): Bisected {
  if (!result || typeof result === 'string') throw new Error(`refused: ${String(result)}`);
  return result as Bisected;
}

describe('the incentre', () => {
  it('is the kernel’s `center` for any triangle', () => {
    const triangles: [PicturePoint, PicturePoint, PicturePoint][] = [
      [[0, 0.49], [0.5, 0.98], [0.5, 0]],
      [[0.1, 0.2], [0.7, 0.35], [0.3, 0.9]],
      [[-1, 2], [3, -0.5], [0.25, 0.125]],
    ];
    for (const [a, b, c] of triangles) {
      const ours = angleIncentre(a, b, c);
      const kernel = kernelCenter(a, b, c);
      expect(ours[0]).toBeCloseTo(kernel[0], 12);
      expect(ours[1]).toBeCloseTo(kernel[1], 12);
    }
  });
});

describe('the three-point way', () => {
  // Crane step 5, before its kite fold: the left corner, the bottom point, the top.
  const left: PicturePoint = [0, 0.49];
  const bottom: PicturePoint = [0.5, 0.98];
  const top: PicturePoint = [0.5, 0];
  const upperLeft: PickedLine = { a: left, b: top };

  it('draws the kite fold: from the vertex, halving the angle, to the edge pressed', () => {
    const { line, angle } = drawnOf(bisectFromPoints(left, bottom, top, upperLeft));
    expect(line.from).toEqual(bottom);
    expect(onLine(line.to, upperLeft)).toBe(true);
    expect(angleAt(bottom, left, line.to)).toBeCloseTo(angleAt(bottom, line.to, top), 12);
    // The mark halves the angle between the two arms picked.
    expect(angle).toEqual({ vertex: bottom, arms: [left, top] });
  });

  it('ends where a press on no line is, projected onto the bisector (an upload has no lines)', () => {
    const { line } = drawnOf(bisectFromPoints(left, bottom, top, [0.3, 0.4]));
    const along = [line.to[0] - bottom[0], line.to[1] - bottom[1]];
    // On the bisector, at the foot of the press.
    expect(angleAt(bottom, left, line.to)).toBeCloseTo(angleAt(bottom, line.to, top), 12);
    expect((0.3 - line.to[0]) * along[0]! + (0.4 - line.to[1]) * along[1]!).toBeCloseTo(0, 12);
  });

  it('refuses points that make no angle, and an end parallel to the bisector, as upstream does', () => {
    expect(bisectFromPoints([0, 0], [0.5, 0.5], [1, 1], upperLeft)).toBe('no-angle');
    expect(bisectFromPoints([0.5, 0.5], [0.5, 0.5], [1, 0], upperLeft)).toBe('no-angle');
    // The bisector of a right angle at the origin opening up-right runs along y = x.
    expect(bisectFromPoints([1, 0], [0, 0], [0, 1], { a: [0.2, 0.3], b: [0.6, 0.7] })).toBe('parallel');
  });
});

describe('the two-line way', () => {
  const across: PickedLine = { a: [0, 0.5], b: [0.6, 0.5] };
  const up: PickedLine = { a: [0.5, 0.5], b: [0.9, 0.1] };

  it('bisects the angle the lines’ far ends span, from where they cross', () => {
    const end: PickedLine = { a: [0, 0], b: [1, 0] };
    const { line, angle } = drawnOf(bisectFromLines(across, up, end));
    expect(line.from[0]).toBeCloseTo(0.5, 12);
    expect(line.from[1]).toBeCloseTo(0.5, 12);
    // The far ends: across's left end (farther from the crossing than its right), up's top.
    expect(angle?.arms).toEqual([[0, 0.5], [0.9, 0.1]]);
    expect(angleAt(line.from, [0, 0.5], line.to)).toBeCloseTo(angleAt(line.from, line.to, [0.9, 0.1]), 12);
    expect(line.to[1]).toBeCloseTo(0, 12);
  });

  it('meets two lines crossing past their ends, as upstream runs them on', () => {
    const short: PickedLine = { a: [0.1, 0.5], b: [0.3, 0.5] };
    const result = drawnOf(bisectFromLines(short, up, [0.2, 0.1]));
    expect(result.line.from[0]).toBeCloseTo(0.5, 12);
  });

  it('is null for parallel lines, which have the midline instead', () => {
    expect(bisectFromLines(across, { a: [0, 0.8], b: [1, 0.8] }, [0.5, 0])).toBeNull();
  });
});

describe('the parallel way', () => {
  const lower: PickedLine = { a: [0, 0.2], b: [1, 0.2] };
  const upper: PickedLine = { a: [0.3, 0.6], b: [0.8, 0.6] };
  const midline = parallelMidline(lower, upper)!;

  it('runs halfway between the two, from one line to the other', () => {
    expect(midline.at[1]).toBeCloseTo(0.4, 12);
    const { line, angle } = drawnOf(bisectBetween(midline, { a: [0.1, 0], b: [0.1, 1] }, { a: [0.8, 0], b: [0.8, 1] }));
    expect(line.from[0]).toBeCloseTo(0.1, 12);
    expect(line.from[1]).toBeCloseTo(0.4, 12);
    expect(line.to[0]).toBeCloseTo(0.8, 12);
    expect(line.to[1]).toBeCloseTo(0.4, 12);
    // Parallels make no angle: no mark.
    expect(angle).toBeNull();
  });

  it('is no midline between lines that meet, or one line twice', () => {
    expect(parallelMidline(lower, { a: [0, 0], b: [1, 1] })).toBeNull();
    expect(parallelMidline(lower, { a: [0.2, 0.2], b: [0.7, 0.2] })).toBeNull();
  });
});

describe('the picks', () => {
  const nothing = (at: PicturePoint) => ({ point: null, line: null, at });
  const point = (at: PicturePoint) => ({ point: at, line: null, at });
  const line = (picked: PickedLine, at: PicturePoint) => ({ point: null, line: picked, at });

  it('takes a point first as three points, the vertex second, then the line it runs to', () => {
    let picks: BisectorPicks = NO_PICKS;
    expect(bisectorStep(picks)).toBe('first');
    picks = bisectorPick(picks, point([0, 0.49])).picks;
    expect(bisectorStep(picks)).toBe('vertex');
    picks = bisectorPick(picks, point([0.5, 0.98])).picks;
    expect(bisectorStep(picks)).toBe('third');
    // A press on nothing is a point where it is.
    picks = bisectorPick(picks, nothing([0.5, 0])).picks;
    expect(bisectorStep(picks)).toBe('end');
    const edge: PickedLine = { a: [0, 0.49], b: [0.5, 0] };
    expect(bisectorPreview(picks, line(edge, [0.25, 0.25]))?.line.from).toEqual([0.5, 0.98]);
    const done = bisectorPick(picks, line(edge, [0.25, 0.25]));
    expect(done.drawn?.line.from).toEqual([0.5, 0.98]);
    expect(done.picks).toBe(NO_PICKS);
  });

  it('takes a line first as two lines, asks for a second line until one is pressed, then the end', () => {
    const across: PickedLine = { a: [0, 0.5], b: [0.6, 0.5] };
    const up: PickedLine = { a: [0.5, 0.5], b: [0.9, 0.1] };
    let picks = bisectorPick(NO_PICKS, line(across, [0.2, 0.5])).picks;
    expect(picks.kind).toBe('lines');
    expect(bisectorStep(picks)).toBe('second-line');
    expect(bisectorPick(picks, nothing([0.3, 0.3])).picks).toBe(picks);
    picks = bisectorPick(picks, line(up, [0.7, 0.3])).picks;
    expect(bisectorStep(picks)).toBe('line-end');
    expect(bisectorPick(picks, nothing([0.7, 0.05])).drawn?.angle?.vertex[0]).toBeCloseTo(0.5, 12);
  });

  it('takes two parallel lines to their midline, refuses an end along it, and draws between two ends', () => {
    const lower: PickedLine = { a: [0, 0.2], b: [1, 0.2] };
    const upper: PickedLine = { a: [0, 0.6], b: [1, 0.6] };
    let picks = bisectorPick(bisectorPick(NO_PICKS, line(lower, [0.5, 0.2])).picks, line(upper, [0.5, 0.6])).picks;
    expect(picks.kind).toBe('parallel');
    expect(bisectorStep(picks)).toBe('parallel-first-end');
    const along = bisectorPick(picks, line({ a: [0, 0.9], b: [1, 0.9] }, [0.5, 0.9]));
    expect(along.refused).toBe('parallel');
    expect(along.picks).toBe(picks);
    picks = bisectorPick(picks, line({ a: [0.1, 0], b: [0.1, 1] }, [0.1, 0.4])).picks;
    expect(bisectorStep(picks)).toBe('parallel-second-end');
    const done = bisectorPick(picks, nothing([0.7, 0.45]));
    expect(done.drawn?.line.to[0]).toBeCloseTo(0.7, 12);
    expect(done.drawn?.line.to[1]).toBeCloseTo(0.4, 12);
  });

  it('starts again after a refusal, and takes back one pick at a time', () => {
    const three: BisectorPicks = { kind: 'points', points: [[0, 0], [0.5, 0.5], [1, 1]] };
    const refused = bisectorPick(three, nothing([0.2, 0.9]));
    expect(refused.refused).toBe('no-angle');
    expect(refused.picks).toBe(NO_PICKS);
    expect(bisectorUnpick(three)).toEqual({ kind: 'points', points: [[0, 0], [0.5, 0.5]] });
    expect(bisectorUnpick(NO_PICKS)).toBeNull();
    const across: PickedLine = { a: [0, 0.5], b: [0.6, 0.5] };
    expect(bisectorUnpick({ kind: 'lines', lines: [across] })).toBe(NO_PICKS);
  });
});
