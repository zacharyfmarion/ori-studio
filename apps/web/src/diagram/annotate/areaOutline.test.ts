import { describe, expect, it } from 'vitest';
import { areaBox, areaOutlineOf, areaOutlinePoints, areaRimDistance, insideArea, type AreaOutline } from './areaOutline';
import type { PicturePoint } from './annotationModel';

/** The rim densely sampled, turned: what a measured distance is checked against. */
function sampled(outline: AreaOutline, count = 40000): PicturePoint[] {
  const radians = (outline.angle * Math.PI) / 180;
  const [c, s] = [Math.cos(radians), Math.sin(radians)];
  const [a, b] = [outline.size[0] / 2, outline.size[1] / 2];
  const at = ([x, y]: PicturePoint): PicturePoint => [outline.centre[0] + x * c - y * s, outline.centre[1] + x * s + y * c];
  if (outline.kind === 'oval') {
    return Array.from({ length: count }, (_, index) => {
      const t = (2 * Math.PI * index) / count;
      return at([a * Math.cos(t), b * Math.sin(t)]);
    });
  }
  const corners: PicturePoint[] = [
    [-a, -b],
    [a, -b],
    [a, b],
    [-a, b],
  ];
  const per = count / 4;
  return corners.flatMap((corner, index) => {
    const next = corners[(index + 1) % 4]!;
    return Array.from({ length: per }, (_, step): PicturePoint =>
      at([corner[0] + ((next[0] - corner[0]) * step) / per, corner[1] + ((next[1] - corner[1]) * step) / per])
    );
  });
}
const nearestSampled = (outline: AreaOutline, point: PicturePoint) =>
  Math.min(...sampled(outline).map(([x, y]) => Math.hypot(point[0] - x, point[1] - y)));

/** Points in, on and out of an outline 0.6 × 0.25 about (0.5, 0.4): its middle, near its rim either side, past its ends. */
const PRESSES: PicturePoint[] = [
  [0.5, 0.4],
  [0.52, 0.41],
  [0.75, 0.4],
  [0.81, 0.4],
  [0.5, 0.25],
  [0.5, 0.53],
  [0.2, 0.2],
  [0.95, 0.7],
  [0.1, 0.45],
  [0.66, 0.31],
];

describe('an oval’s and a rectangle’s outline (Revision 3)', () => {
  for (const kind of ['oval', 'rectangle'] as const) {
    for (const angle of [0, 30, 117.5]) {
      it(`measures a ${kind}’s rim distance, turned ${angle}°, as its sampled rim does`, () => {
        const outline: AreaOutline = { kind, centre: [0.5, 0.4], size: [0.6, 0.25], angle };
        for (const press of PRESSES) {
          expect(areaRimDistance(outline, press), `${press}`).toBeCloseTo(nearestSampled(outline, press), 4);
        }
      });
    }
  }

  it('takes a circle’s rim distance as a circle’s, its middle a radius from its rim', () => {
    const circle: AreaOutline = { kind: 'oval', centre: [0, 0], size: [0.4, 0.4], angle: 0 };
    expect(areaRimDistance(circle, [0, 0])).toBeCloseTo(0.2, 12);
    expect(areaRimDistance(circle, [0.5, 0])).toBeCloseTo(0.3, 12);
    expect(areaRimDistance(circle, [0.1, 0.1])).toBeCloseTo(0.2 - Math.hypot(0.1, 0.1), 9);
  });

  it('says what is inside, turned: an oval is not its box', () => {
    const oval: AreaOutline = { kind: 'oval', centre: [0.5, 0.4], size: [0.6, 0.2], angle: 90 };
    expect(insideArea(oval, [0.5, 0.65])).toBe(true);
    expect(insideArea(oval, [0.65, 0.4])).toBe(false);
    // Its box's corner, but not the oval.
    expect(insideArea(oval, [0.59, 0.69])).toBe(false);
    expect(insideArea({ ...oval, kind: 'rectangle' }, [0.59, 0.69])).toBe(true);
  });

  it('traces a rectangle by its four corners, and an ellipse at its points, turned', () => {
    const rectangle: AreaOutline = { kind: 'rectangle', centre: [0.5, 0.5], size: [0.4, 0.2], angle: 90 };
    const corners = areaOutlinePoints(rectangle);
    expect(corners).toHaveLength(4);
    // Turned a quarter, its top left is the page's top right.
    expect(corners[0]![0]).toBeCloseTo(0.6, 12);
    expect(corners[0]![1]).toBeCloseTo(0.3, 12);
    const ring = areaOutlinePoints({ ...rectangle, kind: 'oval' }, 8);
    expect(ring).toHaveLength(8);
    for (const point of ring) expect(areaRimDistance({ ...rectangle, kind: 'oval' }, point)).toBeCloseTo(0, 9);
  });

  it('boxes a turned outline exactly, and its stroke half a pen out', () => {
    const oval: AreaOutline = { kind: 'oval', centre: [0.5, 0.4], size: [0.6, 0.25], angle: 30 };
    for (const outline of [oval, { ...oval, kind: 'rectangle' as const }]) {
      const box = areaBox(outline);
      const points = sampled(outline, 4000);
      expect(box.x).toBeCloseTo(Math.min(...points.map(([x]) => x)), 5);
      expect(box.y + box.height).toBeCloseTo(Math.max(...points.map(([, y]) => y)), 5);
    }
    // Upright, half a pen out each way.
    const upright = areaBox({ ...oval, angle: 0 }, 0.01);
    expect(upright).toEqual({ x: expect.closeTo(0.19, 12), y: expect.closeTo(0.265, 12), width: expect.closeTo(0.62, 12), height: expect.closeTo(0.27, 12) });
    // A mitred rectangle's corner, turned, reaches its pen's half further along each side.
    const mitred = areaBox({ kind: 'rectangle', centre: [0, 0], size: [0.2, 0.2], angle: 45 }, 0.01);
    expect(mitred.width).toBeCloseTo(Math.SQRT2 * 0.22, 12);
  });

  it('reads an annotation’s outline: its centre, size and turn; a click’s square with no size', () => {
    expect(areaOutlineOf({ kind: 'rectangle', from: [0.2, 0.3], size: [0.4, 0.1], angle: 15 })).toEqual({
      kind: 'rectangle',
      centre: [0.2, 0.3],
      size: [0.4, 0.1],
      angle: 15,
    });
    expect(areaOutlineOf({ kind: 'oval', from: [0.2, 0.3] })).toMatchObject({ kind: 'oval', size: [0.3, 0.3], angle: 0 });
  });
});
