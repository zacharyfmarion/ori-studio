import { describe, expect, it } from 'vitest';
import { createCenteredTreeFrame } from './frame';

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
});
