import { describe, expect, it } from 'vitest';
import type { Point } from '../../lib/geometry';
import type { FoldedPicture } from '../../lib/creaseExportFold';
import { foldedMirrorAxes, mirrorAxes, uprightTurn } from './mirrorAxes';

/** `half` and its mirror image in the line through `centre` at `axis` degrees: a shape symmetric about that line. */
function symmetric(half: readonly Point[], axis: number, centre: Point = { x: 3, y: -2 }): Point[] {
  const radians = (axis * Math.PI) / 180;
  const ux = Math.cos(radians);
  const uy = Math.sin(radians);
  const mirrored = half.map(({ x, y }) => {
    const dx = x - centre.x;
    const dy = y - centre.y;
    const along = dx * ux + dy * uy;
    return { x: centre.x + 2 * along * ux - dx, y: centre.y + 2 * along * uy - dy };
  });
  return [...half, ...mirrored];
}

/** A lopsided half of a crane-like outline, off any line of the page. */
const HALF: Point[] = [
  { x: 4.1, y: 0.3 },
  { x: 6.7, y: -1.2 },
  { x: 5.2, y: -4.9 },
  { x: 3.9, y: -3.1 },
  { x: 7.4, y: -6.6 },
];

describe('mirrorAxes', () => {
  it('finds the one line a shape is symmetric about, at any angle, wherever it lies', () => {
    for (const axis of [0, 22.5, 67.5, 112.5, 157.5, 31.7]) {
      const found = mirrorAxes(symmetric(HALF, axis));
      expect(found).toHaveLength(1);
      expect(found[0]).toBeCloseTo(axis, 6);
    }
  });

  it('finds each of several: a rectangle’s two, a square’s four', () => {
    const rectangle = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 0, y: 2 },
    ];
    expect(mirrorAxes(rectangle).map((axis) => Number(axis.toFixed(6)))).toEqual([0, 90]);
    const square = rectangle.map(({ x, y }) => ({ x: x / 2, y }));
    expect(mirrorAxes(square).map((axis) => Number(axis.toFixed(6)))).toEqual([0, 45, 90, 135]);
  });

  it('finds none for a shape with no symmetry, or one off by more than a hair', () => {
    expect(mirrorAxes(HALF)).toEqual([]);
    const nearly = symmetric(HALF, 112.5);
    nearly[7] = { x: nearly[7]!.x + 1e-3, y: nearly[7]!.y };
    expect(mirrorAxes(nearly)).toEqual([]);
    // A kernel's float noise is no asymmetry.
    const noisy = symmetric(HALF, 112.5).map(({ x, y }, index) => ({ x: x + (index % 2 ? 1e-9 : -1e-9), y }));
    expect(mirrorAxes(noisy)[0]).toBeCloseTo(112.5, 6);
  });

  it('takes a point given twice as one, and has nothing to say of fewer than two', () => {
    const doubled = symmetric(HALF, 67.5);
    expect(mirrorAxes([...doubled, ...doubled])[0]).toBeCloseTo(67.5, 6);
    expect(mirrorAxes([{ x: 1, y: 1 }])).toEqual([]);
    expect(mirrorAxes([{ x: 1, y: 1 }, { x: 1, y: 1 }])).toEqual([]);
  });
});

describe('uprightTurn', () => {
  it('stands the crane’s axis upright the nearer way from 150°, then the other way up, and back', () => {
    // Its axis, unturned: at 150° it shows at 82.5° on the page.
    const axes = [112.5];
    expect(uprightTurn(axes, 150)).toBe(157.5);
    expect(uprightTurn(axes, 157.5)).toBe(337.5);
    expect(uprightTurn(axes, 337.5)).toBe(157.5);
    expect(uprightTurn(axes, 300)).toBe(337.5);
  });

  it('takes the nearest of several axes, and a fold with none has no upright', () => {
    // A rectangle: upright either way on either axis, a quarter turn apart.
    expect(uprightTurn([0, 90], 40)).toBe(0);
    expect(uprightTurn([0, 90], 50)).toBe(90);
    expect(uprightTurn([], 150)).toBeNull();
  });
});

describe('foldedMirrorAxes', () => {
  const read = (faces: Point[][]): FoldedPicture =>
    ({ snapshot: {}, scene: { faces: faces.map((outline) => ({ outline })) } }) as unknown as FoldedPicture;

  it('measures the faces’ corners and points along their edges, once per figure read', () => {
    // Two triangles mirror images of each other in x = 0.
    const figure = read([
      [
        { x: 0, y: 0 },
        { x: 2, y: 1 },
        { x: 0, y: 3 },
      ],
      [
        { x: 0, y: 0 },
        { x: -2, y: 1 },
        { x: 0, y: 3 },
      ],
    ]);
    expect(foldedMirrorAxes(figure)).toEqual([90]);
    expect(foldedMirrorAxes(figure)).toBe(foldedMirrorAxes(figure));
  });

  it('finds none where only the corners match: a rectangle with one diagonal crease', () => {
    // Its corners and edges' middles are symmetric both ways; the crease is not —
    // its mirror image either way is the other diagonal.
    const creased = read([
      [
        { x: -2, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
      ],
      [
        { x: -2, y: 0 },
        { x: 2, y: 2 },
        { x: -2, y: 2 },
      ],
    ]);
    expect(foldedMirrorAxes(creased)).toEqual([]);
    const plain = read([
      [
        { x: -2, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: -2, y: 2 },
      ],
    ]);
    expect(foldedMirrorAxes(plain).map((axis) => Number(axis.toFixed(6)))).toEqual([0, 90]);
  });

  it('has none for a figure drawn only as its development', () => {
    expect(foldedMirrorAxes({ snapshot: {}, scene: null } as unknown as FoldedPicture)).toEqual([]);
  });
});
