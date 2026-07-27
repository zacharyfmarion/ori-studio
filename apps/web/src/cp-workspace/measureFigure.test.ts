import { describe, expect, it } from 'vitest';
import { arcPath, arrowheadPoints, labelAnchor } from './measureFigure';

function parsePoints(points: string): { x: number; y: number }[] {
  return points.split(' ').map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return { x, y };
  });
}

describe('arrowheadPoints', () => {
  it('puts the apex on the tip and the barbs behind it, square to the line', () => {
    // Tip at (100, 0), line running back to the origin: barbs sit at x = 100 - 9.
    const barbs = parsePoints(arrowheadPoints({ x: 100, y: 0 }, { x: 0, y: 0 })!);
    expect(barbs).toHaveLength(3);
    expect(barbs[1]).toEqual({ x: 100, y: 0 });
    expect(barbs[0].x).toBeCloseTo(91, 6);
    expect(barbs[2].x).toBeCloseTo(91, 6);
    expect(barbs[0].y).toBeCloseTo(3.5, 6);
    expect(barbs[2].y).toBeCloseTo(-3.5, 6);
  });

  it('is sized in screen pixels, so it never scales with the camera', () => {
    const near = parsePoints(arrowheadPoints({ x: 10, y: 0 }, { x: 0, y: 0 })!);
    const far = parsePoints(arrowheadPoints({ x: 1000, y: 0 }, { x: 0, y: 0 })!);
    expect(near[1].x - near[0].x).toBeCloseTo(far[1].x - far[0].x, 6);
  });

  it('gives nothing for a degenerate (zero-length) line', () => {
    expect(arrowheadPoints({ x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull();
  });
});

describe('arcPath', () => {
  it('sweeps the short way round, at the fixed screen radius', () => {
    // +x to +y about the origin: a quarter turn, so start (34,0) and end (0,34).
    const path = arcPath({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 })!;
    const [, startX, startY, , rx, ry, , , sweep, endX, endY] = path.split(' ');
    expect(Number(startX)).toBeCloseTo(34, 6);
    expect(Number(startY)).toBeCloseTo(0, 6);
    expect([Number(rx), Number(ry)]).toEqual([34, 34]);
    expect(sweep).toBe('1');
    expect(Number(endX)).toBeCloseTo(0, 6);
    expect(Number(endY)).toBeCloseTo(34, 6);
  });

  it('flips the sweep flag for the opposite turn', () => {
    const ccw = arcPath({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 })!;
    const cw = arcPath({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: -10 })!;
    expect(ccw).toContain('0 1 ');
    expect(cw).toContain('0 0 ');
  });

  it('takes the minor arc for a reflex pick, never the long way round', () => {
    // 190 degrees apart: the drawn arc must be the 170-degree one.
    const rad = (deg: number) => (deg * Math.PI) / 180;
    const path = arcPath(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: Math.cos(rad(190)) * 10, y: Math.sin(rad(190)) * 10 }
    )!;
    expect(path).toContain('0 0 ');
  });
});

describe('labelAnchor', () => {
  it('sits at the midpoint of a distance', () => {
    expect(
      labelAnchor('distance', [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ])
    ).toEqual({ x: 50, y: 25 });
  });

  it('sits outside the arc, on the bisector of an angle', () => {
    const anchor = labelAnchor('angle', [
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 10 },
    ])!;
    // Bisector of the quarter turn is 45 degrees, at radius 34 + 18.
    expect(anchor.x).toBeCloseTo(Math.SQRT1_2 * 52, 6);
    expect(anchor.y).toBeCloseTo(Math.SQRT1_2 * 52, 6);
  });

  it('gives nothing before the points it needs are placed', () => {
    expect(labelAnchor('distance', [{ x: 0, y: 0 }])).toBeNull();
    expect(
      labelAnchor('angle', [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ])
    ).toBeNull();
  });
});
