import { describe, expect, it } from 'vitest';
import {
  CORNER_RESIZE_HANDLES,
  TRANSFORM_HANDLE_SIZE_PX,
  TRANSFORM_ROTATE_HANDLE_RADIUS_PX,
  TRANSFORM_ROTATE_OFFSET_PX,
  TRANSFORM_ROTATION_SNAP_RADIANS,
  TRANSFORM_HANDLE_SIZES,
  boxCornersModel,
  boxContainsModelPoint,
  boxDistanceModel,
  resizeAnnotationBox,
  resizeAspectLock,
  snapAngle,
  transformHandleAt,
  transformHandleSizes,
  transformHandles,
  type TransformBox,
} from './transformBox';
import { TOUCH_TARGET_PX } from '../platform/pointerSurface';

function box(overrides: Partial<TransformBox> = {}): TransformBox {
  return { center: { x: 0, y: 0 }, width: 4, height: 2, rotation: 0, ...overrides };
}

describe('boxCornersModel', () => {
  it('returns TL, TR, BR, BL of an axis-aligned box', () => {
    expect(boxCornersModel(box({ center: { x: 1, y: 1 } }))).toEqual([
      { x: -1, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 2 },
      { x: -1, y: 2 },
    ]);
  });

  it('rotates the corners about the centre', () => {
    const [tl] = boxCornersModel(box({ rotation: Math.PI / 2 }));
    // Local (-2,-1) turned a quarter turn CCW in a y-down frame -> (1,-2).
    expect(tl.x).toBeCloseTo(1);
    expect(tl.y).toBeCloseTo(-2);
  });
});

describe('boxContainsModelPoint', () => {
  it('contains points inside an axis-aligned box', () => {
    const b = box({ center: { x: 5, y: 5 } });
    expect(boxContainsModelPoint(b, { x: 5, y: 5 })).toBe(true);
    expect(boxContainsModelPoint(b, { x: 6.9, y: 5.9 })).toBe(true);
    expect(boxContainsModelPoint(b, { x: 7.1, y: 5 })).toBe(false); // beyond half-width 2
  });

  it('respects rotation', () => {
    const b = box({ width: 4, height: 1, rotation: Math.PI / 2 });
    // Turned 90°: now tall (extent 2 along y, 0.5 along x).
    expect(boxContainsModelPoint(b, { x: 0, y: 1.9 })).toBe(true);
    expect(boxContainsModelPoint(b, { x: 0, y: 2.1 })).toBe(false);
    expect(boxContainsModelPoint(b, { x: 0.6, y: 0 })).toBe(false);
  });
});

describe('boxDistanceModel', () => {
  it('is 0 on and inside the box, and the straight distance to its nearest edge or corner outside it', () => {
    const b = box({ center: { x: 5, y: 5 } });
    expect(boxDistanceModel(b, { x: 5, y: 5 })).toBe(0);
    expect(boxDistanceModel(b, { x: 7, y: 6 })).toBe(0);
    // Past an edge: how far past it.
    expect(boxDistanceModel(b, { x: 7.5, y: 5.5 })).toBeCloseTo(0.5, 12);
    expect(boxDistanceModel(b, { x: 5, y: 3 })).toBeCloseTo(1, 12);
    // Past a corner: to the corner, not to either edge's line.
    expect(boxDistanceModel(b, { x: 10, y: 10 })).toBeCloseTo(Math.hypot(3, 4), 12);
  });

  it('respects rotation, and is what boxContainsModelPoint asks', () => {
    // Turned 30°, 4 along its turn by 1 across.
    const b = box({ width: 4, height: 1, rotation: Math.PI / 6 });
    const at = (along: number, across: number) => ({
      x: along * Math.cos(Math.PI / 6) - across * Math.sin(Math.PI / 6),
      y: along * Math.sin(Math.PI / 6) + across * Math.cos(Math.PI / 6),
    });
    expect(boxDistanceModel(b, at(1.9, 0.4))).toBe(0);
    expect(boxDistanceModel(b, at(2.75, 0))).toBeCloseTo(0.75, 12);
    expect(boxDistanceModel(b, at(0, -1.5))).toBeCloseTo(1, 12);
    expect(boxDistanceModel(b, at(3, 1.5))).toBeCloseTo(Math.hypot(1, 1), 12);
    for (const [along, across] of [[1.9, 0.4], [2.1, 0], [0, 0.6], [-1.99, -0.49]]) {
      expect(boxContainsModelPoint(b, at(along!, across!)), `${along} ${across}`).toBe(boxDistanceModel(b, at(along!, across!)) === 0);
    }
  });
});

describe('resizeAnnotationBox', () => {
  it('resizes a corner keeping the opposite corner anchored', () => {
    // 4x2 box centred at origin; SE corner at (2,1), NW anchor at (-2,-1).
    // Drag SE to (4, 3): anchor stays → new width 6, height 4, centre (1,1).
    const r = resizeAnnotationBox(box(), 'se', { x: 4, y: 3 });
    expect(r.width).toBeCloseTo(6);
    expect(r.height).toBeCloseTo(4);
    expect(r.center.x).toBeCloseTo(1);
    expect(r.center.y).toBeCloseTo(1);
  });

  it('resizes only one axis for an edge handle when unlocked', () => {
    // East edge anchored at west edge midpoint (-2,0); drag to (5, 9).
    const r = resizeAnnotationBox(box(), 'e', { x: 5, y: 9 });
    expect(r.width).toBeCloseTo(7); // |5 - (-2)|
    expect(r.height).toBeCloseTo(2); // unchanged
    expect(r.center.y).toBeCloseTo(0); // perpendicular position preserved
    expect(r.center.x).toBeCloseTo(1.5); // anchor -2 + width/2
  });

  it('preserves aspect ratio with the lock flag on a corner', () => {
    const b = box(); // aspect 2:1
    const r = resizeAnnotationBox(b, 'se', { x: 6, y: 2 }, true);
    // du=8, dv=3 → scale=max(8/4, 3/2)=2 → 8x4, aspect preserved.
    expect(r.width / r.height).toBeCloseTo(2);
  });

  it('scales both axes from an EDGE handle when locked', () => {
    // Aspect lock used to be ignored on edge handles, which read as the lock
    // silently failing once proportional resize became the default for images.
    const b = box(); // 4x2, aspect 2:1
    const r = resizeAnnotationBox(b, 'e', { x: 6, y: 0 }, true);
    expect(r.width).toBeCloseTo(8); // |6 - (-2)|
    expect(r.height).toBeCloseTo(4); // driven by the same 2x factor
    expect(r.width / r.height).toBeCloseTo(2);
  });

  it('keeps the anchored edge fixed when a locked edge drag grows the passive axis', () => {
    const r = resizeAnnotationBox(box(), 'e', { x: 6, y: 0 }, true);
    // West edge was at x = -2 and must stay there: centre - width/2.
    expect(r.center.x - r.width / 2).toBeCloseTo(-2);
  });

  it('locks aspect on a vertical edge too', () => {
    const r = resizeAnnotationBox(box(), 's', { x: 0, y: 3 }, true);
    expect(r.height).toBeCloseTo(4); // |3 - (-1)|
    expect(r.width).toBeCloseTo(8); // 2x factor applied to the passive axis
  });

  it('clamps to a minimum extent', () => {
    const r = resizeAnnotationBox(box(), 'se', { x: -2, y: -1 }); // dragged onto the anchor
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });
});

describe('resizeAspectLock', () => {
  it('is always locked for objects with no non-uniform scale (folded figures)', () => {
    expect(resizeAspectLock('always', false)).toBe(true);
    expect(resizeAspectLock('always', true)).toBe(true);
  });

  it('locks images by default and lets Shift free them', () => {
    expect(resizeAspectLock('default-on', false)).toBe(true);
    expect(resizeAspectLock('default-on', true)).toBe(false);
  });

  it('leaves text boxes free by default and lets Shift lock them', () => {
    expect(resizeAspectLock('default-off', false)).toBe(false);
    expect(resizeAspectLock('default-off', true)).toBe(true);
  });
});

describe('snapAngle', () => {
  const step = Math.PI / 12; // 15°
  it('snaps to the nearest increment', () => {
    expect(snapAngle(0.02, step)).toBeCloseTo(0);
    expect(snapAngle((14 * Math.PI) / 180, step)).toBeCloseTo(step); // ~14° → 15°
    expect(snapAngle((22 * Math.PI) / 180, step)).toBeCloseTo(step); // ~22° → 15°
    expect(snapAngle((24 * Math.PI) / 180, step)).toBeCloseTo(2 * step); // ~24° → 30°
  });
});

describe('resizeAnnotationBox about the centre (Diagram Revision 3, R3-29b A, R3-29c A)', () => {
  it('keeps the centre put, a corner setting both half-extents', () => {
    const turned = box({ center: { x: 3, y: -1 }, rotation: 0.7 });
    // The SE corner dragged to local (3, 2) from the centre: 6 × 4, about the same centre.
    const cos = Math.cos(0.7);
    const sin = Math.sin(0.7);
    const pointer = { x: 3 + 3 * cos - 2 * sin, y: -1 + 3 * sin + 2 * cos };
    const r = resizeAnnotationBox(turned, 'se', pointer, false, { aboutCentre: true });
    expect(r.center).toEqual({ x: 3, y: -1 });
    expect(r.width).toBeCloseTo(6);
    expect(r.height).toBeCloseTo(4);
  });

  it('keeps proportions with the lock, from the larger ratio, and the centre still', () => {
    const r = resizeAnnotationBox(box(), 'nw', { x: -4, y: -1.2 }, true, { aboutCentre: true });
    // du = 8 (ratio 2), dv = 2.4 (ratio 1.2): the larger wins.
    expect(r.width).toBeCloseTo(8);
    expect(r.height).toBeCloseTo(4);
    expect(r.center).toEqual({ x: 0, y: 0 });
  });

  it('moves one axis for an edge, both sides at once', () => {
    const r = resizeAnnotationBox(box(), 'e', { x: 3, y: 5 }, false, { aboutCentre: true });
    expect(r.width).toBeCloseTo(6);
    expect(r.height).toBeCloseTo(2);
    expect(r.center).toEqual({ x: 0, y: 0 });
  });

  it('holds the opposite corner without it, as the Edit canvas always has', () => {
    const r = resizeAnnotationBox(box(), 'se', { x: 4, y: 3 }, false, {});
    expect(r).toEqual(resizeAnnotationBox(box(), 'se', { x: 4, y: 3 }));
    expect(r.center.x).toBeCloseTo(1);
  });

  it('clamps to a minimum extent on the centre', () => {
    const r = resizeAnnotationBox(box(), 'se', { x: 0, y: 0 }, true, { aboutCentre: true });
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });
});

describe('resizeAnnotationBox held to a range of sides (Diagram Revision 3, R3-30b A)', () => {
  const sides = { min: 0.5, max: 6 };

  it('holds each side to it as the drag goes, the opposite corner staying put', () => {
    // The SE corner dragged far out right and up past the NW corner: 10 wide, the height through zero.
    const r = resizeAnnotationBox(box(), 'se', { x: 8, y: -1.1 }, false, { sides });
    expect(r.width).toBe(6);
    expect(r.height).toBe(0.5);
    // Its NW corner (-2, -1) where it was: the box's left edge, and — dragged up past it — its bottom.
    expect(r.center.x - r.width / 2).toBeCloseTo(-2, 12);
    expect(r.center.y + r.height / 2).toBeCloseTo(-1, 12);
  });

  it('holds a box kept in its proportions as a whole while one scale can keep both sides in range', () => {
    const r = resizeAnnotationBox(box(), 'se', { x: 20, y: 20 }, true, { sides });
    // 4 × 2 can grow to 6 × 3, no further, in proportion.
    expect(r.width).toBeCloseTo(6, 12);
    expect(r.height).toBeCloseTo(3, 12);
  });

  it('changes nothing without it: the Edit canvas never passes it', () => {
    expect(resizeAnnotationBox(box(), 'se', { x: 8, y: -1.1 }, false)).toEqual(resizeAnnotationBox(box(), 'se', { x: 8, y: -1.1 }, false, {}));
    expect(resizeAnnotationBox(box(), 'se', { x: 8, y: 3 }, false).width).toBe(10);
  });
});

describe('transformHandles', () => {
  const corners = boxCornersModel(box({ width: 40, height: 20 }));

  it('gives eight squares, nw round to w, at the corners and the edges\' middles', () => {
    const { scale } = transformHandles(corners, { cornersOnly: false, rotateOffset: TRANSFORM_ROTATE_OFFSET_PX });
    expect(scale.map((point) => point.handle)).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
    expect(scale.map((point) => [point.at.x, point.at.y])).toEqual([
      [-20, -10],
      [0, -10],
      [20, -10],
      [20, 0],
      [20, 10],
      [0, 10],
      [-20, 10],
      [-20, 0],
    ]);
  });

  it('gives the four corners only for a box that always keeps its proportions', () => {
    const { scale } = transformHandles(corners, { cornersOnly: true, rotateOffset: TRANSFORM_ROTATE_OFFSET_PX });
    expect(scale.map((point) => point.handle)).toEqual([...CORNER_RESIZE_HANDLES]);
    expect(scale.map((point) => point.handle)).toEqual(['nw', 'ne', 'se', 'sw']);
  });

  it('puts a turn handle 18 px out from each corner, along the line from the middle', () => {
    for (const rotation of [0, 0.3, -2]) {
      const turned = boxCornersModel(box({ center: { x: 5, y: 7 }, width: 40, height: 20, rotation }));
      const { rotate } = transformHandles(turned, { cornersOnly: false, rotateOffset: TRANSFORM_ROTATE_OFFSET_PX });
      expect(rotate.map((point) => point.corner)).toEqual(['nw', 'ne', 'se', 'sw']);
      rotate.forEach(({ at }, i) => {
        const corner = turned[i]!;
        expect(Math.hypot(at.x - corner.x, at.y - corner.y)).toBeCloseTo(18);
        // On the diagonal through the middle, beyond the corner.
        const out = { x: corner.x - 5, y: corner.y - 7 };
        const handle = { x: at.x - 5, y: at.y - 7 };
        expect(out.x * handle.y - out.y * handle.x).toBeCloseTo(0);
        expect(Math.hypot(handle.x, handle.y)).toBeCloseTo(Math.hypot(out.x, out.y) + 18);
      });
    }
  });

  it('keeps the Edit canvas\'s sizes: 8 px squares, 5 px turn handles, 18 px out, 15° steps', () => {
    expect(TRANSFORM_HANDLE_SIZE_PX).toBe(8);
    expect(TRANSFORM_ROTATE_HANDLE_RADIUS_PX).toBe(5);
    expect(TRANSFORM_ROTATE_OFFSET_PX).toBe(18);
    expect(TRANSFORM_ROTATION_SNAP_RADIANS).toBeCloseTo((15 * Math.PI) / 180, 12);
  });

  it('follows corners drawn through a flipped camera, so the handles stay on the drawn box', () => {
    // A y-flipped projection: the corners arrive TL, TR, BR, BL as drawn upside down.
    const flipped = corners.map((corner) => ({ x: corner.x, y: -corner.y }));
    const { scale, rotate } = transformHandles(flipped, { cornersOnly: false, rotateOffset: 10 });
    expect(scale[1]!.at).toEqual({ x: 0, y: 10 });
    expect(rotate[0]!.at.y).toBeGreaterThan(10);
  });
});

describe('the handles for a mouse and for a finger (18d follow-up)', () => {
  // A 40 × 40 box about the origin: its se corner at (20, 20), the line from the middle along the diagonal.
  const corners = boxCornersModel(box({ width: 40, height: 40 }));
  const handlesFor = (coarse: boolean) =>
    transformHandles(corners, { cornersOnly: true, rotateOffset: transformHandleSizes(coarse).rotateOffset });
  /** `by` px out from the se corner, along the line from the middle. */
  const outFromSe = (by: number) => ({ x: 20 + by / Math.SQRT2, y: 20 + by / Math.SQRT2 });

  it('keeps a mouse’s exactly as the Edit canvas drew them: 8 px squares, 5 px turn handles 18 px out, no target', () => {
    expect(transformHandleSizes(false)).toBe(TRANSFORM_HANDLE_SIZES.fine);
    expect(TRANSFORM_HANDLE_SIZES.fine).toEqual({
      square: TRANSFORM_HANDLE_SIZE_PX,
      turnRadius: TRANSFORM_ROTATE_HANDLE_RADIUS_PX,
      rotateOffset: TRANSFORM_ROTATE_OFFSET_PX,
      target: 0,
    });
    expect(TRANSFORM_HANDLE_SIZES.fine).toEqual({ square: 8, turnRadius: 5, rotateOffset: 18, target: 0 });
  });

  it('sizes a finger’s by the touch target: each takes a press half a target round it, and a turn handle sits a whole one out', () => {
    expect(transformHandleSizes(true)).toBe(TRANSFORM_HANDLE_SIZES.coarse);
    expect(TRANSFORM_HANDLE_SIZES.coarse).toEqual({ square: 12, turnRadius: 7, rotateOffset: TOUCH_TARGET_PX, target: TOUCH_TARGET_PX / 2 });
    // A corner's target and its turn handle's meet, and never overlap.
    const { rotateOffset, target } = TRANSFORM_HANDLE_SIZES.coarse;
    expect(rotateOffset).toBeGreaterThanOrEqual(2 * target);
  });

  it('gives a press 14 px wide of a corner to the turn handle 18 px out for a mouse, and to the square for a finger', () => {
    const fine = transformHandleSizes(false);
    const coarse = transformHandleSizes(true);
    expect(transformHandleAt(handlesFor(false), outFromSe(14), { sizes: fine, inside: false })).toEqual({ kind: 'rotate', corner: 'se' });
    expect(transformHandleAt(handlesFor(true), outFromSe(14), { sizes: coarse, inside: false })).toEqual({ kind: 'scale', handle: 'se' });
    // Past halfway out, the turn handle; past its target, nothing.
    expect(transformHandleAt(handlesFor(true), outFromSe(30), { sizes: coarse, inside: false })).toEqual({ kind: 'rotate', corner: 'se' });
    expect(transformHandleAt(handlesFor(true), outFromSe(67), { sizes: coarse, inside: false })).toBeNull();
  });

  it('takes only a handle as drawn inside the box, a finger’s target or not: the object is there', () => {
    const coarse = transformHandleSizes(true);
    // 8 px in from the corner: on nothing drawn (a 12 px square reaches 6 px in), though within the target.
    expect(transformHandleAt(handlesFor(true), { x: 12, y: 12 }, { sizes: coarse, inside: true })).toBeNull();
    // 5 px in, on the square as drawn.
    expect(transformHandleAt(handlesFor(true), { x: 15, y: 15 }, { sizes: coarse, inside: true })).toEqual({ kind: 'scale', handle: 'se' });
  });

  it('reaches as far as the pointer does where that is further than the target, a mouse’s 8 px on the Diagram', () => {
    const fine = transformHandleSizes(false);
    const beside = { x: 27, y: 20 };
    expect(transformHandleAt(handlesFor(false), beside, { sizes: fine, inside: false })).toBeNull();
    expect(transformHandleAt(handlesFor(false), beside, { sizes: fine, inside: false, reach: 8 })).toEqual({ kind: 'scale', handle: 'se' });
    // In another space: two units to the screen px, so a 7 px press is 14 units off.
    const doubled = transformHandles(corners.map(({ x, y }) => ({ x: 2 * x, y: 2 * y })), { cornersOnly: true, rotateOffset: 2 * fine.rotateOffset });
    expect(transformHandleAt(doubled, { x: 54, y: 40 }, { sizes: fine, inside: false, px: 2, reach: 16 })).toEqual({ kind: 'scale', handle: 'se' });
  });
});
