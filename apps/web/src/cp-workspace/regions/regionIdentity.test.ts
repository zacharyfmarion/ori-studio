import { describe, expect, it } from 'vitest';
import type { OristudioCpLineSegment } from '../../engine/oristudioCpTypes';
import type { CpSegment } from '../../lib/creasePatternSegmentation';
import type { Point } from '../../lib/geometry';
import { foldedSourceFingerprint } from '../folded/foldedFigureStaleness';
import {
  boundariesMatchMoved,
  isRelativeFingerprint,
  relativeCreaseFingerprint,
  resolveMovedRegion,
  type RegionIdentity,
} from './regionIdentity';

function line(ax: number, ay: number, bx: number, by: number, color = 'Red1', foldMagnitude?: number): OristudioCpLineSegment {
  return {
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    active: '',
    color,
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
    ...(foldMagnitude === undefined ? {} : { fold_magnitude: foldMagnitude }),
  };
}

/** A square sheet with an off-centre crease, so a turn of it is not itself. */
const SHEET = [
  line(0, 0, 400, 0, 'Black0'),
  line(400, 0, 400, 400, 'Black0'),
  line(400, 400, 0, 400, 'Black0'),
  line(0, 400, 0, 0, 'Black0'),
  line(0, 0, 400, 400, 'Red1'),
  line(100, 0, 100, 400, 'Blue2'),
];

const moved = (lines: readonly OristudioCpLineSegment[], dx: number, dy: number) =>
  lines.map((entry) => ({ ...entry, a: { x: entry.a.x + dx, y: entry.a.y + dy }, b: { x: entry.b.x + dx, y: entry.b.y + dy } }));

describe('the relative crease fingerprint', () => {
  it('names its algorithm, apart from the absolute one', () => {
    const value = relativeCreaseFingerprint(SHEET);
    expect(value.startsWith('rc1:')).toBe(true);
    expect(isRelativeFingerprint(value)).toBe(true);
    expect(isRelativeFingerprint(foldedSourceFingerprint(SHEET))).toBe(false);
    expect(isRelativeFingerprint(null)).toBe(false);
  });

  it('is unchanged by a move, the last-bit noise of a drag included, though the absolute one is not', () => {
    const before = relativeCreaseFingerprint(SHEET);
    // Deltas that do not add exactly: (x + 0.1) - 0.1 is not always x.
    for (const [dx, dy] of [
      [0.1, 0.7],
      [3000.3, -1234.567],
      [-0.30000000000000004, 1e-9],
      [4321.123456789, 9876.987654321],
    ] as const) {
      const shifted = moved(SHEET, dx, dy);
      expect(relativeCreaseFingerprint(shifted)).toBe(before);
      expect(foldedSourceFingerprint(shifted)).not.toBe(foldedSourceFingerprint(SHEET));
      // And back again by hand, which does not return the exact coordinates.
      expect(relativeCreaseFingerprint(moved(shifted, -dx, -dy))).toBe(before);
    }
  });

  // A sheet off the origin, as Oriedita's default is (-200..200), with creases
  // at odd multiples of 1/128 of its size: with a decimal rounding step those
  // sat exactly on a rounding boundary, and a drag's noise moved them across.
  it('is unchanged by a move of a dyadic grid, whose coordinates sit where a decimal step would round either way', () => {
    const grid: OristudioCpLineSegment[] = [
      line(-200, -200, 200, -200, 'Black0'),
      line(200, -200, 200, 200, 'Black0'),
      line(200, 200, -200, 200, 'Black0'),
      line(-200, 200, -200, -200, 'Black0'),
    ];
    for (let k = 1; k < 128; k += 2) {
      const at = -200 + (400 * k) / 128;
      grid.push(line(at, -200, at, 200, k % 4 === 1 ? 'Red1' : 'Blue2'), line(-200, at, 200, at, 'Blue2'));
    }
    const before = relativeCreaseFingerprint(grid);
    let perturbed = 0;
    for (const [dx, dy] of [
      [69.3, 0],
      [70.372, -12.9],
      [0.1, 0.7],
      [137.3, -42.1],
      [-503.7, 0.30000000000000004],
      [1234.1, 4321.123456789],
    ] as const) {
      const shifted = moved(grid, dx, dy);
      // The move really is noisy: some relative coordinate is no longer exact.
      if (shifted.some((entry, i) => entry.a.x - shifted[0]!.a.x !== grid[i]!.a.x - grid[0]!.a.x)) perturbed += 1;
      expect(relativeCreaseFingerprint(shifted)).toBe(before);
    }
    expect(perturbed).toBeGreaterThan(0);
  });

  it('does not care about the order of the lines, or which end of one is first', () => {
    const reordered = [...SHEET].reverse().map((entry, index) => (index % 2 ? { ...entry, a: entry.b, b: entry.a } : entry));
    expect(relativeCreaseFingerprint(reordered)).toBe(relativeCreaseFingerprint(SHEET));
  });

  it('changes when a crease moves against the others, is recoloured, or folds to another angle', () => {
    const before = relativeCreaseFingerprint(SHEET);
    const nudged = SHEET.map((entry, index) => (index === 5 ? line(101, 0, 101, 400, 'Blue2') : entry));
    expect(relativeCreaseFingerprint(nudged)).not.toBe(before);
    const recoloured = SHEET.map((entry, index) => (index === 4 ? { ...entry, color: 'Blue2' } : entry));
    expect(relativeCreaseFingerprint(recoloured)).not.toBe(before);
    const angled = SHEET.map((entry, index) => (index === 4 ? { ...entry, fold_magnitude: 90 } : entry));
    expect(relativeCreaseFingerprint(angled)).not.toBe(before);
    expect(relativeCreaseFingerprint([...SHEET, line(0, 200, 400, 200, 'Red1')])).not.toBe(before);
  });

  it('changes when the sheet turns or flips: only a move is not a change', () => {
    const turned = SHEET.map((entry) => ({ ...entry, a: { x: entry.a.y, y: 400 - entry.a.x }, b: { x: entry.b.y, y: 400 - entry.b.x } }));
    const flipped = SHEET.map((entry) => ({ ...entry, a: { x: 400 - entry.a.x, y: entry.a.y }, b: { x: 400 - entry.b.x, y: entry.b.y } }));
    expect(relativeCreaseFingerprint(turned)).not.toBe(relativeCreaseFingerprint(SHEET));
    expect(relativeCreaseFingerprint(flipped)).not.toBe(relativeCreaseFingerprint(SHEET));
  });
});

const ring = (points: [number, number][], dx = 0, dy = 0): Point[] => points.map(([x, y]) => ({ x: x + dx, y: y + dy }));
const SQUARE: [number, number][] = [
  [0, 0],
  [400, 0],
  [400, 400],
  [0, 400],
];
const WIDE: [number, number][] = [
  [0, 0],
  [400, 0],
  [400, 200],
  [0, 200],
];

describe('an outline’s shape, wherever it is', () => {
  it('matches a moved outline, whatever vertex it starts from, its winding, or the points along an edge', () => {
    const traced = ring([
      [400, 400],
      [400, 200],
      [400, 0],
      [0, 0],
      [0, 400],
    ], 5000.1, -77.7);
    expect(boundariesMatchMoved([ring(SQUARE)], [traced])).toBe(true);
  });

  it('tells a rectangle from itself turned a quarter, and from a square', () => {
    const tall = ring([
      [0, 0],
      [200, 0],
      [200, 400],
      [0, 400],
    ]);
    expect(boundariesMatchMoved([ring(WIDE)], [tall])).toBe(false);
    expect(boundariesMatchMoved([ring(WIDE)], [ring(SQUARE)])).toBe(false);
  });
});

/** A region of the segmentation, as the resolver sees it. */
function segment(id: number, points: [number, number][], dx: number, dy: number): CpSegment {
  const boundary = [ring(points, dx, dy)];
  const xs = boundary[0]!.map((point) => point.x);
  const ys = boundary[0]!.map((point) => point.y);
  return {
    id,
    faceIndices: [],
    boundary,
    bounds: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) },
  };
}

/** What each region's creases fingerprint to today, by its id. */
function identity(fingerprint: string | null, today: Record<number, string>): RegionIdentity {
  return { fingerprint, fingerprintOf: (candidate) => today[candidate.id] ?? null };
}

describe('finding a region again', () => {
  // The step remembers the square at the origin, and its creases as `rc1:A`.
  const reference = { boundary: [ring(SQUARE)], segmentIdHint: 0 };

  it('finds it in its place first, edited there, though an unchanged copy of it is elsewhere', () => {
    const here = segment(0, SQUARE, 0, 0);
    const copy = segment(1, SQUARE, 900, 0);
    expect(resolveMovedRegion(reference, [copy, here], identity('rc1:A', { 0: 'rc1:C', 1: 'rc1:A' }))).toEqual({
      segment: here,
      found: 'in-place',
    });
  });

  it('finds it in place when nothing moved, looking at no other region', () => {
    const here = segment(0, SQUARE, 0, 0);
    const elsewhere = segment(1, SQUARE, 1000, 0);
    const asked: number[] = [];
    const result = resolveMovedRegion(reference, [here, elsewhere], {
      fingerprint: 'rc1:A',
      fingerprintOf: (candidate) => {
        asked.push(candidate.id);
        return candidate.id === 0 ? 'rc1:A' : 'rc1:B';
      },
    });
    expect(result).toEqual({ segment: here, found: 'unchanged' });
    expect(asked).toEqual([0]);
  });

  it('finds it moved, by its unchanged creases, among regions of the same shape', () => {
    const other = segment(0, SQUARE, 1600, 0);
    const movedHere = segment(1, SQUARE, 800.25, -300.1);
    expect(resolveMovedRegion(reference, [other, movedHere], identity('rc1:A', { 0: 'rc1:B', 1: 'rc1:A' }))).toEqual({
      segment: movedHere,
      found: 'unchanged',
    });
  });

  it('takes the nearest of several identical regions, wherever it is listed: they draw the same picture', () => {
    const far = segment(0, SQUARE, 5000, 0);
    const near = segment(1, SQUARE, 600, 0);
    const farther = segment(2, SQUARE, 9000, 0);
    const all = identity('rc1:A', { 0: 'rc1:A', 1: 'rc1:A', 2: 'rc1:A' });
    expect(resolveMovedRegion(reference, [far, near, farther], all)?.segment).toBe(near);
    expect(resolveMovedRegion(reference, [near, far, farther], all)?.segment).toBe(near);
  });

  it('finds it edited in place', () => {
    expect(resolveMovedRegion(reference, [segment(0, SQUARE, 0, 0)], identity('rc1:A', { 0: 'rc1:C' }))).toMatchObject({
      found: 'in-place',
    });
  });

  it('never guesses: moved and edited, it cannot be told from a sheet deleted beside another of its shape', () => {
    // Deleted, with one other square left whose creases differ: not that square.
    expect(resolveMovedRegion(reference, [segment(5, SQUARE, 900, 0)], identity('rc1:A', { 5: 'rc1:B' }))).toBeNull();
    // Moved and edited, alone of its shape or among others: the same answer.
    const wide = segment(4, WIDE, 0, 2000);
    expect(resolveMovedRegion(reference, [segment(3, SQUARE, 900, 900), wide], identity('rc1:A', { 3: 'rc1:C', 4: 'rc1:A' }))).toBeNull();
    const candidates = [segment(0, SQUARE, 900, 0), segment(1, SQUARE, 1800, 0)];
    expect(resolveMovedRegion(reference, candidates, identity('rc1:A', { 0: 'rc1:C', 1: 'rc1:D' }))).toBeNull();
  });

  it('is gone when no region of its shape is left', () => {
    expect(resolveMovedRegion(reference, [segment(0, WIDE, 0, 0)], identity('rc1:A', { 0: 'rc1:A' }))).toBeNull();
    expect(resolveMovedRegion({ boundary: [], segmentIdHint: null }, [segment(0, SQUARE, 0, 0)], identity('rc1:A', {}))).toBeNull();
  });

  it('recognises a moved region only by a relative fingerprint: an absolute one finds it only in place', () => {
    const absolute = foldedSourceFingerprint(SHEET);
    expect(resolveMovedRegion(reference, [segment(0, SQUARE, 700, 0)], identity(absolute, { 0: absolute }))).toBeNull();
    expect(resolveMovedRegion(reference, [segment(0, SQUARE, 0, 0)], identity(absolute, { 0: absolute }))).toMatchObject({
      found: 'in-place',
    });
    expect(resolveMovedRegion(reference, [segment(0, SQUARE, 0, 0)], identity(null, {}))).toMatchObject({ found: 'in-place' });
  });
});
