import { describe, expect, it } from 'vitest';
import type { Rgba } from '../../renderer/types';
import { foldPoseGeometry, rigidHinge, type FoldPaint } from './foldPoseGeometry';
import type { FoldScene } from './foldScene';
import type { FlapStrokes } from './foldSplit';

const UP: Rgba = [1, 1, 1, 1];
const OTHER: Rgba = [0.2, 0.2, 0.2, 1];
const MOUNTAIN: Rgba = [1, 0, 0, 1];
const VALLEY: Rgba = [0, 0, 1, 1];

const paint: FoldPaint = {
  up: UP,
  other: OTHER,
  mountain: MOUNTAIN,
  valley: VALLEY,
  mountainSlot: 2,
  valleySlot: 1,
  modelToUser: (p) => ({ x: p.x * 2, y: -p.y * 2 }),
};

/** A unit square folded along x = 0.5, the right half swinging over the left. */
const scene: FoldScene = {
  kind: 'cp',
  flaps: [
    {
      chord: [
        { x: 0.5, y: 0 },
        { x: 0.5, y: 1 },
      ],
      // The right half: the cross product's sign for a point at x > 0.5.
      side: -1,
      polygon: [
        { x: 0.5, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0.5, y: 1 },
      ],
      creased: [[0, 1]],
    },
  ],
  sheetShortSide: 1,
  reach: 0.5,
};

/** One mountain crease on the flap from (0.75, 0.2) to (0.75, 0.8). */
function creases(): FlapStrokes {
  return {
    a: Float32Array.from([0.75, 0.2]),
    b: Float32Array.from([0.75, 0.8]),
    color: Float32Array.from(MOUNTAIN),
    widthMul: Float32Array.from([1.5]),
    dashSlot: Float32Array.from([2]),
    dashPhase: Float32Array.from([0.1]),
    flap: Uint8Array.from([0]),
    count: 1,
    dashPatterns: [[4, 2]],
  };
}

const xs = (position: Float32Array) => Array.from(position).filter((_, i) => i % 2 === 0);
/** Four channels of a float buffer, rounded past the float32 narrowing. */
const rgba = (buffer: Float32Array, at = 0) =>
  Array.from(buffer.slice(at, at + 4)).map((v) => Number(v.toFixed(4)));

describe('foldPoseGeometry', () => {
  it('leaves the flap where it is at angle 0, face up', () => {
    const { fills, strokes } = foldPoseGeometry(scene, { angle: 0, press: 0 }, [creases()], paint);
    expect(fills.count).toBe(6);
    expect(Math.min(...xs(fills.position))).toBeCloseTo(1);
    expect(Math.max(...xs(fills.position))).toBeCloseTo(2);
    expect(rgba(fills.color)).toEqual(UP);
    expect(fills.depth![0]).toBeCloseTo(0.05);
    expect(strokes.count).toBe(1);
    expect(rgba(strokes.color)).toEqual(MOUNTAIN);
    expect(strokes.dashSlot![0]).toBe(2);
  });

  it('lifts the flap halfway through the swing and lays it edge-on', () => {
    const { fills } = foldPoseGeometry(scene, { angle: Math.PI / 2, press: 0 }, [], paint);
    // Every corner projects onto the line: the flap is seen edge-on.
    for (const x of xs(fills.position)) expect(x).toBeCloseTo(1);
    // The far corners are as high as the flap reaches.
    expect(Math.max(...Array.from(fills.depth!))).toBeCloseTo(0.95);
  });

  it('lands the flap on the other half showing its other face, creases renamed', () => {
    const { fills, strokes } = foldPoseGeometry(scene, { angle: Math.PI, press: 0 }, [creases()], paint);
    expect(Math.min(...xs(fills.position))).toBeCloseTo(0);
    expect(Math.max(...xs(fills.position))).toBeCloseTo(1);
    expect(rgba(fills.color)).toEqual(OTHER);
    // The crease at x = 0.75 lands at x = 0.25, in valley ink with the valley dash.
    expect(strokes.a[0]).toBeCloseTo(0.5);
    expect(rgba(strokes.color)).toEqual(VALLEY);
    expect(strokes.dashSlot![0]).toBe(1);
    // Flat on the paper, just above it.
    expect(strokes.depth![0]).toBeCloseTo(0.07);
    expect(strokes.widthMul[0]).toBe(1.5);
    expect(strokes.dashPatterns).toEqual([[4, 2]]);
  });

  it('scales a dash phase with the drawn length of its segment', () => {
    // Through the user map alone the segment doubles, so the phase does.
    const flat = foldPoseGeometry(scene, { angle: 0, press: 0 }, [creases()], paint);
    expect(flat.strokes.dashPhase![0]).toBeCloseTo(0.2);
    // A crease across the fold's direction foreshortens with the swing.
    const across: FlapStrokes = {
      ...creases(),
      a: Float32Array.from([0.6, 0.5]),
      b: Float32Array.from([0.9, 0.5]),
    };
    const tilted = foldPoseGeometry(scene, { angle: Math.PI / 3, press: 0 }, [across], paint);
    expect(tilted.strokes.dashPhase![0]).toBeCloseTo(0.2 * Math.cos(Math.PI / 3));
  });

  it('takes another placement when given one', () => {
    const { fills } = foldPoseGeometry(scene, { angle: Math.PI, press: 0 }, [], paint, () =>
      rigidHinge(0)
    );
    expect(Math.min(...xs(fills.position))).toBeCloseTo(1);
  });
});
