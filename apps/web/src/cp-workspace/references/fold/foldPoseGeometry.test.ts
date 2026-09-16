import { describe, expect, it } from 'vitest';
import type { Rgba } from '../../renderer/types';
import {
  DEFAULT_SURFACE_SHARES,
  SHADOW_OFFSET_PER_HEIGHT,
  foldPoseGeometry,
  type FoldPaint,
  type FoldSurfaceShares,
} from './foldPoseGeometry';
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
  shade: [0, 0, 0, 0.5],
  modelToUser: (p) => ({ x: p.x * 2, y: -p.y * 2 }),
};

/** No bend: the rigid hinge, for the expectations a curl would blur. */
const RIGID: FoldSurfaceShares = { ...DEFAULT_SURFACE_SHARES, radius: 0 };

/** A unit square folded along x = 0.5, the right half swinging over the left. */
function square(creased: readonly (readonly [number, number])[] = [[0, 1]]): FoldScene {
  return {
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
        creased,
      },
    ],
    sheetShortSide: 1,
    reach: 0.5,
  };
}
const scene = square();

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

type Fills = { position: Float32Array; color: Float32Array; depth?: Float32Array; count: number };
/** The fills at the shadow's depth, or the rest: the shadow is drawn first, under the paper. */
function only(fills: Fills, which: 'paper' | 'shadow'): Fills {
  const keep: number[] = [];
  for (let i = 0; i < fills.count; i += 1) {
    const shadow = fills.depth![i]! < 0.03;
    if ((which === 'shadow') === shadow) keep.push(i);
  }
  return {
    position: Float32Array.from(keep.flatMap((i) => [fills.position[i * 2]!, fills.position[i * 2 + 1]!])),
    color: Float32Array.from(keep.flatMap((i) => Array.from(fills.color.slice(i * 4, i * 4 + 4)))),
    depth: Float32Array.from(keep.map((i) => fills.depth![i]!)),
    count: keep.length,
  };
}
/** Four channels of a float buffer, rounded past the float32 narrowing. */
const rgba = (buffer: Float32Array, at = 0) =>
  Array.from(buffer.slice(at, at + 4)).map((v) => Number(v.toFixed(4)));
/** The area the fills cover, in user space. */
function fillArea(position: Float32Array): number {
  let area = 0;
  for (let i = 0; i + 5 < position.length; i += 6) {
    const [ax, ay, bx, by, cx, cy] = [
      position[i]!,
      position[i + 1]!,
      position[i + 2]!,
      position[i + 3]!,
      position[i + 4]!,
      position[i + 5]!,
    ];
    area += Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
  }
  return area;
}

describe('foldPoseGeometry, rigid', () => {
  it('leaves the flap where it is at angle 0, face up and unshaded', () => {
    const { fills: all, strokes } = foldPoseGeometry(scene, { angle: 0, press: 0 }, [creases()], paint, RIGID);
    const fills = only(all, 'paper');
    expect(fills.count).toBeGreaterThan(0);
    expect(fillArea(fills.position)).toBeCloseTo(0.5 * 4);
    expect(Math.min(...xs(fills.position))).toBeCloseTo(1);
    expect(Math.max(...xs(fills.position))).toBeCloseTo(2);
    for (let i = 0; i < fills.count; i += 1) expect(rgba(fills.color, i * 4)).toEqual(UP);
    expect(fills.depth![0]).toBeCloseTo(0.05);
    expect(strokes.count).toBe(1);
    expect(rgba(strokes.color)).toEqual(MOUNTAIN);
    expect(strokes.dashSlot![0]).toBe(2);
  });

  it('lifts the flap halfway through the swing and lays it edge-on', () => {
    const fills = only(foldPoseGeometry(scene, { angle: Math.PI / 2, press: 0 }, [], paint, RIGID).fills, 'paper');
    // Every point projects onto the line: the flap is seen edge-on.
    for (const x of xs(fills.position)) expect(x).toBeCloseTo(1);
    // The far corners are as high as the flap reaches.
    expect(Math.max(...Array.from(fills.depth!))).toBeCloseTo(0.95);
  });

  it('lands the flap on the other half showing its other face, creases renamed', () => {
    const { fills: all, strokes } = foldPoseGeometry(scene, { angle: Math.PI, press: 0 }, [creases()], paint, RIGID);
    const fills = only(all, 'paper');
    expect(Math.min(...xs(fills.position))).toBeCloseTo(0);
    expect(Math.max(...xs(fills.position))).toBeCloseTo(1);
    expect(rgba(fills.color)).toEqual(OTHER);
    // The crease at x = 0.75 lands at x = 0.25, in valley ink with the valley dash.
    expect(strokes.count).toBe(1);
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
    const flat = foldPoseGeometry(scene, { angle: 0, press: 0 }, [creases()], paint, RIGID);
    expect(flat.strokes.dashPhase![0]).toBeCloseTo(0.2);
    // A crease across the fold's direction foreshortens with the swing.
    const across: FlapStrokes = {
      ...creases(),
      a: Float32Array.from([0.6, 0.5]),
      b: Float32Array.from([0.9, 0.5]),
    };
    const tilted = foldPoseGeometry(scene, { angle: Math.PI / 3, press: 0 }, [across], paint, RIGID);
    expect(tilted.strokes.dashPhase![0]).toBeCloseTo(0.2 * Math.cos(Math.PI / 3));
  });
});

describe('foldPoseGeometry, curled', () => {
  const r = DEFAULT_SURFACE_SHARES.radius;

  it('is the sheet at rest: nothing moves, nothing is shaded', () => {
    const fills = only(foldPoseGeometry(scene, { angle: 0, press: 0 }, [], paint).fills, 'paper');
    expect(fillArea(fills.position)).toBeCloseTo(2);
    for (let i = 0; i < fills.count; i += 1) expect(rgba(fills.color, i * 4)).toEqual(UP);
  });

  it('lands exactly on the other half, hovering, with the bend shaded', () => {
    const { fills: all, strokes } = foldPoseGeometry(scene, { angle: Math.PI, press: 0 }, [creases()], paint);
    const fills = only(all, 'paper');
    // The far edge lands on x = 0 as a sharp fold would; nothing crosses the line.
    expect(Math.min(...xs(fills.position))).toBeCloseTo(0, 3);
    expect(Math.max(...xs(fills.position))).toBeCloseTo(2 * 0.5, 3);
    // The flat part hovers at 2r above the paper.
    const depths = Array.from(fills.depth!);
    expect(Math.max(...depths)).toBeCloseTo(0.05 + 0.9 * ((2 * r) / 0.5), 3);
    // Somewhere on the curl the paper is edge-on and shaded toward black.
    const shaded = [...Array(fills.count).keys()].filter((i) => fills.color[i * 4]! < 0.95);
    expect(shaded.length).toBeGreaterThan(0);
    // A crease along the fold never enters the bend: one piece, carried whole.
    expect(strokes.count).toBe(1);
    // One across it rounds the bend, and is cut at every row through it.
    const across: FlapStrokes = {
      ...creases(),
      a: Float32Array.from([0.5, 0.5]),
      b: Float32Array.from([1, 0.5]),
    };
    const bent = foldPoseGeometry(scene, { angle: Math.PI, press: 0 }, [across], paint);
    expect(bent.strokes.count).toBeGreaterThan(10);
    // Its pieces run from the hinge up round the bend and over to the far edge,
    // which lands exactly where the crease's mirror is.
    const ends = [...Array.from(bent.strokes.a), ...Array.from(bent.strokes.b)].filter(
      (_, i) => i % 2 === 0
    );
    expect(Math.max(...ends)).toBeCloseTo(2 * 0.5, 3);
    expect(Math.min(...ends)).toBeCloseTo(0, 3);
  });

  it('presses the creased stretch flat and leaves the rest hovering', () => {
    // Creased only along the middle fifth of the line.
    const partial = square([[0.4, 0.6]]);
    const fills = only(foldPoseGeometry(partial, { angle: Math.PI, press: 1 }, [], paint).fills, 'paper');
    const ys = (i: number) => fills.position[i * 2 + 1]!;
    // At y = 0.5 (user y = −1) the far edge is on the paper; at y = 0 it hovers.
    const middle = [...Array(fills.count).keys()].filter(
      (i) => Math.abs(ys(i) + 1) < 0.02 && fills.position[i * 2]! < 0.05
    );
    const corner = [...Array(fills.count).keys()].filter(
      (i) => Math.abs(ys(i)) < 0.02 && fills.position[i * 2]! < 0.05
    );
    expect(middle.length).toBeGreaterThan(0);
    expect(corner.length).toBeGreaterThan(0);
    for (const i of middle) expect(fills.depth![i]).toBeCloseTo(0.05, 3);
    for (const i of corner) expect(fills.depth![i]).toBeGreaterThan(0.05 + 0.9 * (r / 0.5));
  });
});

describe('foldPoseGeometry, shadow', () => {
  const r = DEFAULT_SURFACE_SHARES.radius;

  it('casts the flat part along the light, under the flap, in the shadow ink', () => {
    const { fills } = foldPoseGeometry(scene, { angle: Math.PI, press: 0 }, [], paint);
    const shadow = only(fills, 'shadow');
    const paper = only(fills, 'paper');
    expect(shadow.count).toBeGreaterThan(0);
    expect(paper.count).toBeGreaterThan(shadow.count);
    expect(rgba(shadow.color)).toEqual([0, 0, 0, 0.5]);
    expect(shadow.depth![0]).toBeCloseTo(0.02);
    // The flat part hovers at 2r; its far edge is the paper's leftmost point,
    // and its shadow's far edge lies the height along the light from it, in
    // user units — where a model unit is two.
    expect(Math.min(...xs(shadow.position)) - Math.min(...xs(paper.position))).toBeCloseTo(
      2 * r * 2 * SHADOW_OFFSET_PER_HEIGHT[0],
      3
    );
  });

  it('caps the rim at the hover height, so a flap standing up casts no far shadow', () => {
    const { fills } = foldPoseGeometry(scene, { angle: Math.PI / 2, press: 0 }, [], paint);
    const shadow = only(fills, 'shadow');
    const paper = only(fills, 'paper');
    // Edge-on, the paper projects onto the line; its shadow sits a hover's
    // offset beside it, not a flap's reach away.
    const hover = 2 * r * 2;
    expect(Math.max(...xs(shadow.position)) - Math.max(...xs(paper.position))).toBeCloseTo(
      hover * SHADOW_OFFSET_PER_HEIGHT[0],
      3
    );
  });

  it('casts nothing that shows when the flap is flat, and none at all without ink', () => {
    const { fills } = foldPoseGeometry(scene, { angle: 0, press: 0 }, [], paint);
    // On the paper the shadow is exactly under the flap: present, at no offset.
    for (const x of xs(only(fills, 'shadow').position)) expect(x).toBeGreaterThanOrEqual(1 - 1e-6);
    const inkless = foldPoseGeometry(scene, { angle: 1, press: 0 }, [], {
      ...paint,
      shade: [0, 0, 0, 0],
    });
    expect(only(inkless.fills, 'shadow').count).toBe(0);
  });
});
