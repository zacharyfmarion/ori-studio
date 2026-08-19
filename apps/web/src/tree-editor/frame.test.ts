import { describe, expect, it } from 'vitest';
import { centeredTreeFitRect, createCenteredTreeFrame } from './frame';

/**
 * The frame a surface with no paper uses.
 *
 * Its fixedness is the property under test. A world that grew with its content
 * resized the SVG under a camera transform that did not, so every added node
 * nudged the whole drawing on screen — the view moving as a side effect of an
 * edit. Nothing here may depend on what has been drawn.
 */
describe('a centred tree frame', () => {
  const frame = createCenteredTreeFrame({ unitSvg: 56, halfExtent: 8 });

  it('is a fixed square centred on the tree origin', () => {
    expect(frame.worldRect).toEqual({ x: -448, y: -448, width: 896, height: 896 });
    const origin = frame.toSvg({ x: 0, y: 0 });
    expect(origin.x).toBe(0);
    // Negative zero: the y flip is a negation, and `toEqual` distinguishes them.
    expect(Math.abs(origin.y)).toBe(0);
  });

  it('puts +y up, as the paper-backed frame does', () => {
    // Both surfaces have to agree, or the shared drag rule turns them opposite
    // ways.
    expect(frame.toSvg({ x: 0, y: 1 }).y).toBeLessThan(0);
  });

  it('round-trips a point through screen space', () => {
    const point = { x: 2.5, y: -3.25 };
    const back = frame.fromSvg(frame.toSvg(point));
    expect(back.x).toBeCloseTo(point.x, 9);
    expect(back.y).toBeCloseTo(point.y, 9);
  });

  it('holds a point inside the drawing area', () => {
    expect(frame.constrain({ x: 40, y: -40 })).toEqual({ x: 8, y: -8 });
    expect(frame.contains({ x: 8, y: 8 })).toBe(true);
    expect(frame.contains({ x: 8.5, y: 0 })).toBe(false);
  });

  it('offers the drawing area as a rect, so the scene can draw the limit', () => {
    // The same box `contains` enforces, in the space the scene draws in — a
    // second, hand-maintained copy would eventually disagree with the rule and
    // mark the boundary somewhere a drag does not actually stop.
    expect(frame.boundsRect).toEqual(frame.worldRect);
    const corner = frame.toSvg({ x: 8, y: 8 });
    expect(corner.x).toBe(frame.boundsRect.x + frame.boundsRect.width);
    expect(corner.y).toBe(frame.boundsRect.y);
  });
});

/**
 * What the camera opens on inside a centred world.
 *
 * The drawing area is deliberately far larger than any tree drawn in it, so the
 * fit has to come from the drawing. The property that matters is that the rect
 * stays centred on the origin: the viewport centres the *world*, so a rect
 * centred anywhere else would set a zoom for one region and aim the camera at
 * another.
 */
describe('the fit rect for a centred tree', () => {
  const options = { unitSvg: 56, minHalfSpan: 6, padding: 1 };

  const isCentredOnOrigin = (rect: { x: number; y: number; width: number; height: number }) => {
    expect(rect.x).toBeCloseTo(-rect.width / 2, 9);
    expect(rect.y).toBeCloseTo(-rect.height / 2, 9);
    expect(rect.width).toBeCloseTo(rect.height, 9);
  };

  it('opens no closer than the minimum span, however small the tree', () => {
    // A lone root has no extent to fit; without the floor the camera would
    // magnify a stub until nothing on screen said what scale you are drawing at.
    const rect = centeredTreeFitRect([{ x: 0, y: 0 }], options);
    expect(rect).toEqual({ x: -336, y: -336, width: 672, height: 672 });
    isCentredOnOrigin(rect);
  });

  it('grows to hold the drawing, with room around it', () => {
    const rect = centeredTreeFitRect(
      [
        { x: 0, y: 0 },
        { x: 11, y: 2 },
      ],
      options,
    );
    // 11 out plus a unit of padding.
    expect(rect.width / 2 / options.unitSvg).toBeCloseTo(12, 9);
    isCentredOnOrigin(rect);
  });

  it('stays centred on the origin for a tree grown out to one side', () => {
    // The regression this exists for: fitting a lopsided tree's own bounding box
    // would open it half off-screen, because the camera is aimed at the origin
    // regardless.
    const rect = centeredTreeFitRect(
      [
        { x: 9, y: 9 },
        { x: 12, y: 10 },
      ],
      options,
    );
    isCentredOnOrigin(rect);
    // Far enough out to hold the outermost node, not merely the span between them.
    expect(rect.width / 2 / options.unitSvg).toBeCloseTo(13, 9);
  });

  it('reaches equally far for a node on either side', () => {
    const right = centeredTreeFitRect([{ x: 10, y: 0 }], options);
    const left = centeredTreeFitRect([{ x: -10, y: 0 }], options);
    expect(left).toEqual(right);
  });

  it('ignores a non-finite point rather than losing the whole rect to it', () => {
    // One NaN would otherwise poison every Math.max and hand the camera a rect
    // it cannot fit anything into.
    const rect = centeredTreeFitRect(
      [
        { x: Number.NaN, y: 0 },
        { x: 9, y: 0 },
      ],
      options,
    );
    expect(rect.width / 2 / options.unitSvg).toBeCloseTo(10, 9);
  });
});
