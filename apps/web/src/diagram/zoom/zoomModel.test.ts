import { describe, expect, it } from 'vitest';
import {
  CLOSE_UP_SCALE,
  carryAnnotation,
  cleanAnnotation,
  createAnnotation,
  mirrorMove,
  type PictureMove,
  type PicturePoint,
} from '../annotate/annotationModel';
import type { KnownDiagramAnnotation } from '../document/diagramDocument';
import {
  ZOOM_CLICK,
  ZOOM_CORNER,
  ZOOM_SCALE,
  distanceOutside,
  distanceToRim,
  frameWindow,
  outlineAsShape,
  withZoomAnchor,
  withZoomEdge,
  withZoomScale,
  withZoomShape,
  zoomAreaFromCorners,
  zoomCornerRadius,
  zoomEdgeOf,
  zoomOutlineOf,
  zoomOutlinePoints,
  zoomShapeOf,
} from './zoomModel';

const circle = (more: Partial<KnownDiagramAnnotation> = {}): KnownDiagramAnnotation => ({
  id: 'z',
  kind: 'zoom',
  from: [0.4, 0.5],
  to: [0.4, 0.5],
  radius: 0.2,
  ...more,
});
const rounded = (more: Partial<KnownDiagramAnnotation> = {}): KnownDiagramAnnotation => {
  const { radius: _radius, ...rest } = circle({ size: [0.4, 0.2], ...more });
  return rest;
};
const ids = () => 'annotation-1';

describe('an enlarge area', () => {
  it('is laid as a circle from its middle, or a click’s standard size, unsnapped', () => {
    const frame = { width: 1, height: 0.8 };
    expect(createAnnotation('zoom', [0.4, 0.5], [0.4, 0.8], frame, ids)).toEqual(circle({ id: 'annotation-1', radius: 0.30000000000000004 }));
    expect(createAnnotation('zoom', [0.4, 0.5], [0.4, 0.501], frame, ids)).toEqual(circle({ id: 'annotation-1', radius: ZOOM_CLICK.radius }));
  });

  it('is drawn corner to corner as a rounded rectangle; square with Shift, from its middle with Alt', () => {
    const dragged = zoomAreaFromCorners([0.1, 0.2], [0.5, 0.4], {}, ids);
    expect(dragged).toMatchObject({ id: 'annotation-1', kind: 'zoom' });
    expect(dragged.radius).toBeUndefined();
    expect(dragged.from[0]).toBeCloseTo(0.3, 12);
    expect(dragged.from[1]).toBeCloseTo(0.3, 12);
    expect(dragged.to).toEqual(dragged.from);
    expect(dragged.size![0]).toBeCloseTo(0.4, 12);
    expect(dragged.size![1]).toBeCloseTo(0.2, 12);
    const square = zoomAreaFromCorners([0.1, 0.2], [0.5, 0.4], { square: true }, ids).size!;
    expect(square[0]).toBeCloseTo(0.4, 12);
    expect(square[1]).toBeCloseTo(0.4, 12);
    const middle = zoomAreaFromCorners([0.5, 0.5], [0.6, 0.55], { fromMiddle: true }, ids);
    expect(middle.from).toEqual([0.5, 0.5]);
    expect(middle.size![0]).toBeCloseTo(0.2, 12);
    expect(middle.size![1]).toBeCloseTo(0.1, 12);
    expect(zoomAreaFromCorners([0.5, 0.5], [0.5, 0.5], {}, ids)).toMatchObject({ from: [0.5, 0.5], size: [0.3, 0.3] });
  });

  it('draws its frames by its shape when no edge is chosen: a circle cut, a rounded rectangle whole; a chosen one kept', () => {
    expect(zoomEdgeOf('circle', undefined)).toBe('cut');
    expect(zoomEdgeOf('rounded', undefined)).toBe('whole');
    expect(zoomEdgeOf('rounded', 'cut')).toBe('cut');
    expect(zoomEdgeOf('circle', 'whole')).toBe('whole');
    // Changing Shape never overrides a chosen edge: it is the area's own field.
    expect(withZoomShape(circle({ edge: 'whole' }), 'rounded').edge).toBe('whole');
    expect(withZoomShape(circle(), 'rounded').edge).toBeUndefined();
  });

  it('changes shape about its centre: a circle’s square takes in its diameter, a rectangle’s circle its long side, and back is the circle', () => {
    const square = withZoomShape(circle(), 'rounded');
    expect(square).toMatchObject({ from: [0.4, 0.5], size: [0.4, 0.4] });
    expect(square.radius).toBeUndefined();
    expect(withZoomShape(square, 'circle')).toEqual(circle());
    expect(withZoomShape(rounded({ angle: 30 }), 'circle')).toEqual(circle());
    expect(outlineAsShape({ centre: [1, 2], size: [3, 5], angle: 10 }, 'circle')).toEqual({ centre: [1, 2], radius: 2.5 });
    const already = circle();
    expect(withZoomShape(already, 'circle')).toBe(already);
  });

  it('keeps its Size, edge and anchor alone, each unsaid by default', () => {
    expect(withZoomScale(circle(), 2.5).scale).toBe(2.5);
    expect(withZoomScale(circle(), 10).scale).toBe(ZOOM_SCALE.max);
    expect('scale' in withZoomScale(circle({ scale: 2 }), null)).toBe(false);
    expect(withZoomEdge(circle(), 'whole').edge).toBe('whole');
    expect('edge' in withZoomEdge(circle({ edge: 'cut' }), null)).toBe(false);
    expect(withZoomAnchor(circle(), [3, 4]).anchor).toEqual([3, 4]);
    expect('anchor' in withZoomAnchor(circle({ anchor: [3, 4] }), null)).toBe(false);
    expect(ZOOM_SCALE).toEqual(CLOSE_UP_SCALE);
  });

  it('is cleaned as this build writes it: exactly one of a radius and a size, each in range, a turn only on a rectangle', () => {
    expect(cleanAnnotation(circle())).toEqual(circle());
    const clean = circle();
    expect(cleanAnnotation(clean)).toBe(clean);
    expect(cleanAnnotation(circle({ to: [0.9, 0.9] })).to).toEqual([0.4, 0.5]);
    expect(cleanAnnotation(circle({ radius: 5 })).radius).toBe(1);
    expect(cleanAnnotation(circle({ radius: 0.2, size: [0.3, 0.3] }))).toEqual(circle());
    expect(cleanAnnotation(circle({ radius: undefined }))).toEqual(circle({ radius: ZOOM_CLICK.radius }));
    expect(cleanAnnotation(rounded({ size: [9, 0.001] })).size).toEqual([2, 0.015]);
    expect(cleanAnnotation(circle({ angle: 30 })).angle).toBeUndefined();
    expect(cleanAnnotation(rounded({ angle: 30 })).angle).toBe(30);
    expect(cleanAnnotation(circle({ scale: 9 })).scale).toBe(6);
    expect(cleanAnnotation(circle({ edge: 'feathered' as never })).edge).toBeUndefined();
    expect(cleanAnnotation(circle({ anchor: [Number.NaN, 1] })).anchor).toBeUndefined();
    expect(cleanAnnotation(circle({ from: [9, 0.5] })).from).toEqual([4, 0.5]);
  });

  it('is an outline: its centre, and a circle’s radius or a rounded rectangle’s size and turn', () => {
    expect(zoomOutlineOf(circle())).toEqual({ centre: [0.4, 0.5], radius: 0.2 });
    expect(zoomOutlineOf(rounded({ angle: 15 }))).toEqual({ centre: [0.4, 0.5], size: [0.4, 0.2], angle: 15 });
    expect(zoomShapeOf(zoomOutlineOf(rounded()))).toBe('rounded');
    expect(zoomCornerRadius(zoomOutlineOf(rounded()))).toBeCloseTo(ZOOM_CORNER * 0.2, 12);
  });
});

describe('carrying an area with its picture', () => {
  const turn = (degrees: number, scale = 1, about: PicturePoint = [0.5, 0.5]): PictureMove => {
    const r = (degrees * Math.PI) / 180;
    return {
      point: ([x, y]) => [
        about[0] + scale * ((x - about[0]) * Math.cos(r) - (y - about[1]) * Math.sin(r)),
        about[1] + scale * ((x - about[0]) * Math.sin(r) + (y - about[1]) * Math.cos(r)),
      ],
      mirrors: false,
      turnDeg: degrees,
    };
  };

  it('moves its centre with the paper and scales it with the picture, a circle staying a circle', () => {
    const carried = carryAnnotation(circle(), turn(90, 0.5));
    expect(carried.from[0]).toBeCloseTo(0.5, 12);
    expect(carried.from[1]).toBeCloseTo(0.45, 12);
    expect(carried.to).toEqual(carried.from);
    expect(carried.radius).toBeCloseTo(0.1, 12);
    expect(carried.angle).toBeUndefined();
  });

  it('turns a rounded rectangle with the picture at any angle, a half turn none', () => {
    expect(carryAnnotation(rounded(), turn(37)).angle).toBeCloseTo(37, 9);
    expect(carryAnnotation(rounded({ angle: 170 }), turn(37)).angle).toBeCloseTo(27, 9);
    expect(carryAnnotation(rounded({ angle: 20 }), turn(180)).angle).toBeCloseTo(20, 9);
    expect(carryAnnotation(rounded(), turn(90)).angle).toBe(90);
    expect('angle' in carryAnnotation(rounded({ angle: 90 }), turn(90))).toBe(false);
    const carried = carryAnnotation(rounded(), turn(37, 2));
    expect(carried.size![0]).toBeCloseTo(0.8, 12);
    expect(carried.size![1]).toBeCloseTo(0.4, 12);
  });

  it('mirrors a rounded rectangle’s turn with the side, and its anchor stays on the paper', () => {
    const mirrored = carryAnnotation(rounded({ angle: 30, anchor: [12, 34] }), mirrorMove({ width: 1, height: 1 }));
    expect(mirrored.from).toEqual([0.6, 0.5]);
    expect(mirrored.angle).toBeCloseTo(150, 9);
    expect(mirrored.anchor).toEqual([12, 34]);
    // Turned back over, as it was.
    expect(carryAnnotation(mirrored, mirrorMove({ width: 1, height: 1 })).angle).toBeCloseTo(30, 9);
  });
});

describe('an outline’s geometry', () => {
  it('measures a press against its rim, and against its inside', () => {
    const outline = zoomOutlineOf(rounded());
    expect(distanceToRim(outline, [0.6, 0.5])).toBeCloseTo(0, 12);
    expect(distanceToRim(outline, [0.4, 0.5])).toBeCloseTo(0.1, 12);
    expect(distanceOutside(outline, [0.4, 0.5])).toBe(0);
    expect(distanceOutside(outline, [0.8, 0.5])).toBeCloseTo(0.2, 12);
    // A rounded corner is round: the corner of its box is outside it.
    expect(distanceOutside(outline, [0.6, 0.6])).toBeGreaterThan(0);
    expect(distanceToRim(zoomOutlineOf(circle()), [0.4, 0.9])).toBeCloseTo(0.2, 12);
  });

  it('traces its outline: a circle round, a rectangle along its sides and round its corners, turned with it', () => {
    const points = zoomOutlinePoints(zoomOutlineOf(rounded({ angle: 30 })));
    const outline = zoomOutlineOf(rounded({ angle: 30 }));
    expect(points).toHaveLength(4 * 33);
    for (const point of points) expect(distanceToRim(outline, point)).toBeLessThan(1e-12);
    for (const point of zoomOutlinePoints(zoomOutlineOf(circle()))) expect(distanceToRim(zoomOutlineOf(circle()), point)).toBeLessThan(1e-12);
  });

  it('has a window, its upright box: a circle’s square, a turned rectangle’s bounds', () => {
    expect(frameWindow(zoomOutlineOf(circle()))).toEqual({ x: 0.2, y: 0.3, width: 0.4, height: 0.4 });
    const upright = frameWindow(zoomOutlineOf(rounded()));
    expect(upright.x).toBeCloseTo(0.2, 12);
    expect(upright.width).toBeCloseTo(0.4, 12);
    expect(upright.height).toBeCloseTo(0.2, 12);
    const quarter = frameWindow(zoomOutlineOf(rounded({ angle: 90 })));
    expect(quarter.width).toBeCloseTo(0.2, 12);
    expect(quarter.height).toBeCloseTo(0.4, 12);
    // Turned 45°, the box holds the outline's points and no more.
    const outline = zoomOutlineOf(rounded({ angle: 45 }));
    const box = frameWindow(outline);
    const points = zoomOutlinePoints(outline, 96, 256);
    expect(Math.min(...points.map(([x]) => x))).toBeCloseTo(box.x, 5);
    expect(Math.max(...points.map(([x]) => x))).toBeCloseTo(box.x + box.width, 5);
  });
});
