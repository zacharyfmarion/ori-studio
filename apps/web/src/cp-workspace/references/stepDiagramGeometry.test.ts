import { describe, expect, it } from 'vitest';
import {
  arcEndDirection,
  arcExtent,
  arcPathData,
  arrowheadPoints,
  createDiagramProjector,
  labelPlacement,
} from './stepDiagramGeometry';

const UNIT = { width: 1, height: 1 };

/** Pull the numbers back out of a path string. */
function numbers(path: string): number[] {
  return path
    .split(/[\sA-Za-z]+/)
    .filter((token) => token !== '')
    .map(Number);
}

describe('createDiagramProjector', () => {
  it('flips y so the sheet bottom lands at the bottom of the picture', () => {
    const project = createDiagramProjector(UNIT, 100);
    expect(project([0, 0])).toEqual({ x: 10, y: 90 });
    expect(project([1, 1])).toEqual({ x: 90, y: 10 });
    expect(project([0.5, 0])).toEqual({ x: 50, y: 90 });
    expect(project.scale).toBe(80);
    expect(project.viewBox).toBe('0 0 100 100');
  });

  it('centres a rectangle along its shorter side', () => {
    const project = createDiagramProjector({ width: 1, height: 0.5 }, 100);
    // Longer side spans the 80 units; the short side is centred in them.
    expect(project([0, 0])).toEqual({ x: 10, y: 70 });
    expect(project([1, 0.5])).toEqual({ x: 90, y: 30 });
  });
});

describe('arcExtent', () => {
  it('measures along the direction of travel', () => {
    const quarter = { center: [0, 0] as const, radius: 1, from: 0, to: Math.PI / 2 };
    expect(arcExtent({ ...quarter, ccw: true })).toBeCloseTo(Math.PI / 2);
    expect(arcExtent({ ...quarter, ccw: false })).toBeCloseTo((3 * Math.PI) / 2);
  });

  it('wraps a negative sweep', () => {
    expect(arcExtent({ center: [0, 0], radius: 1, from: 2.6, to: -2.6, ccw: false })).toBeCloseTo(
      5.2
    );
  });
});

describe('arcPathData', () => {
  const project = createDiagramProjector(UNIT, 100);

  it('takes sweep 0 for a counter-clockwise arc, because the projection flips y', () => {
    const path = arcPathData(
      { center: [0.5, 0.5], radius: 0.5, from: 0, to: Math.PI / 2, ccw: true },
      project
    );
    const [x0, y0, rx, ry, rotation, large, sweep, x1, y1] = numbers(path);
    expect([x0, y0]).toEqual([90, 50]);
    expect([x1, y1]).toEqual([50, 10]);
    expect([rx, ry, rotation]).toEqual([40, 40, 0]);
    expect(large).toBe(0);
    expect(sweep).toBe(0);
  });

  it('marks the long way round with the large-arc flag', () => {
    const path = arcPathData(
      { center: [0.5, 0.5], radius: 0.5, from: 0, to: Math.PI / 2, ccw: false },
      project
    );
    const [, , , , , large, sweep] = numbers(path);
    expect(large).toBe(1);
    expect(sweep).toBe(1);
  });
});

describe('arcEndDirection', () => {
  it('points along the travel direction at the end, in screen space', () => {
    // Counter-clockwise from 0 to π/2 ends at the top of the circle travelling
    // toward −x; the screen tangent is leftward with no vertical component.
    const ccw = arcEndDirection({ center: [0, 0], radius: 1, from: 0, to: Math.PI / 2, ccw: true });
    expect(ccw.x).toBeCloseTo(-1);
    expect(ccw.y).toBeCloseTo(0);
    // Clockwise from π/2 down to 0 ends at the right, travelling toward −y in
    // sheet space, which is +y (down) on screen.
    const cw = arcEndDirection({ center: [0, 0], radius: 1, from: Math.PI / 2, to: 0, ccw: false });
    expect(cw.x).toBeCloseTo(0);
    expect(cw.y).toBeCloseTo(1);
  });
});

describe('arrowheadPoints', () => {
  it('puts the tip first and the base behind it, symmetric about the direction', () => {
    const points = arrowheadPoints({ x: 10, y: 10 }, { x: 1, y: 0 }, 6);
    expect(points).toBe('10,10 4,12 4,8');
  });

  it('normalises the direction', () => {
    expect(arrowheadPoints({ x: 0, y: 0 }, { x: 0, y: 3 }, 6)).toBe('0,0 -2,-6 2,-6');
  });
});

describe('labelPlacement', () => {
  const project = createDiagramProjector(UNIT, 100);

  it('pushes a label away from the sheet centre and anchors toward it', () => {
    const bottomLeft = labelPlacement([0, 0], UNIT, project);
    expect(bottomLeft.anchor).toBe('end');
    expect(bottomLeft.dx).toBeCloseTo(-3.5);
    expect(bottomLeft.dy).toBeCloseTo(5.6);
    const topRight = labelPlacement([1, 1], UNIT, project);
    expect(topRight.anchor).toBe('start');
    expect(topRight.dx).toBeCloseTo(3.5);
    expect(topRight.dy).toBeCloseTo(-2.8);
  });

  it('centres a label on the vertical midline', () => {
    const placement = labelPlacement([0.5, 0.2], UNIT, project);
    expect(placement.anchor).toBe('middle');
    expect(placement.dx).toBe(0);
  });
});
