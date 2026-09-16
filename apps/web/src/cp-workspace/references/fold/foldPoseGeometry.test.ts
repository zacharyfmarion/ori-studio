import { describe, expect, it } from 'vitest';
import type { Rgba } from '../../renderer/types';
import {
  DEFAULT_SURFACE_SHARES,
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

const CHORD = [
  { x: 0.5, y: 0 },
  { x: 0.5, y: 1 },
] as const;

/** A unit square folded along x = 0.5, the right half swinging over the left. */
function square(creased: readonly (readonly [number, number])[] = [[0, 1]]): FoldScene {
  return {
    kind: 'cp',
    flaps: [
      {
        chord: CHORD,
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
const pose = (angle: number, press = 0, flap = 0) => ({ flap, angle, press });

describe('foldPoseGeometry, rigid', () => {
  it('leaves the flap where it is at angle 0, face up and unshaded', () => {
    const { fills, strokes } = foldPoseGeometry(scene, pose(0), [creases()], paint, RIGID);
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
    const { fills } = foldPoseGeometry(scene, pose(Math.PI / 2), [], paint, RIGID);
    // Every point projects onto the line: the flap is seen edge-on.
    for (const x of xs(fills.position)) expect(x).toBeCloseTo(1);
    // The far corners are as high as the flap reaches.
    expect(Math.max(...Array.from(fills.depth!))).toBeCloseTo(0.95);
  });

  it('lands the flap on the other half showing its other face, creases renamed', () => {
    const { fills, strokes } = foldPoseGeometry(scene, pose(Math.PI), [creases()], paint, RIGID);
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
    const flat = foldPoseGeometry(scene, pose(0), [creases()], paint, RIGID);
    expect(flat.strokes.dashPhase![0]).toBeCloseTo(0.2);
    // A crease across the fold's direction foreshortens with the swing.
    const across: FlapStrokes = {
      ...creases(),
      a: Float32Array.from([0.6, 0.5]),
      b: Float32Array.from([0.9, 0.5]),
    };
    const tilted = foldPoseGeometry(scene, pose(Math.PI / 3), [across], paint, RIGID);
    expect(tilted.strokes.dashPhase![0]).toBeCloseTo(0.2 * Math.cos(Math.PI / 3));
  });

  it('draws nothing for a flap the card does not have', () => {
    expect(foldPoseGeometry(scene, pose(1, 0, 3), [creases()], paint).fills.count).toBe(0);
  });
});

describe('foldPoseGeometry, curled', () => {
  const r = DEFAULT_SURFACE_SHARES.radius;

  it('is the sheet at rest: nothing moves, nothing is shaded', () => {
    const { fills } = foldPoseGeometry(scene, pose(0), [], paint);
    expect(fillArea(fills.position)).toBeCloseTo(2);
    for (let i = 0; i < fills.count; i += 1) expect(rgba(fills.color, i * 4)).toEqual(UP);
  });

  it('lands exactly on the other half, hovering, with the bend shaded', () => {
    const { fills, strokes } = foldPoseGeometry(scene, pose(Math.PI), [creases()], paint);
    // The far edge lands on x = 0 as a sharp fold would; nothing crosses the line.
    expect(Math.min(...xs(fills.position))).toBeCloseTo(0, 3);
    expect(Math.max(...xs(fills.position))).toBeCloseTo(2 * 0.5, 3);
    // The flat part hovers at 2r above the paper.
    const depths = Array.from(fills.depth!);
    expect(Math.max(...depths)).toBeCloseTo(0.05 + 0.9 * ((2 * r) / 0.5), 3);
    // Somewhere on the bend the paper is edge-on and shaded toward black.
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
    const bent = foldPoseGeometry(scene, pose(Math.PI), [across], paint);
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
    const { fills } = foldPoseGeometry(partial, pose(Math.PI, 1), [], paint);
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

describe('foldPoseGeometry, turning the sheet over', () => {
  /** The unit square turning over about x = 0.5, left to right. */
  const turning: FoldScene = {
    kind: 'turn-over',
    flaps: [
      {
        chord: CHORD,
        side: 1,
        polygon: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
        creased: [],
        whole: true,
      },
    ],
    sheetShortSide: 1,
    reach: 0.5,
  };
  /** A valley on the left half. */
  const left: FlapStrokes = {
    ...creases(),
    a: Float32Array.from([0.25, 0.2]),
    b: Float32Array.from([0.25, 0.8]),
    color: Float32Array.from(VALLEY),
    dashSlot: Float32Array.from([1]),
  };

  const roll = DEFAULT_SURFACE_SHARES.roll;

  it('is the whole sheet at rest, and the whole sheet mirrored in place once over', () => {
    const rest = foldPoseGeometry(turning, pose(0), [left], paint);
    expect(fillArea(rest.fills.position)).toBeCloseTo(4);
    expect(rgba(rest.fills.color)).toEqual(UP);
    expect(rest.strokes.a[0]).toBeCloseTo(0.5);
    const over = foldPoseGeometry(turning, pose(Math.PI), [left], paint);
    expect(Math.min(...xs(over.fills.position))).toBeCloseTo(0, 3);
    expect(Math.max(...xs(over.fills.position))).toBeCloseTo(2, 3);
    // Hovering a roll's height over the table, showing its other face.
    expect(Math.max(...Array.from(over.fills.depth!))).toBeCloseTo(0.05 + 0.9 * ((2 * roll) / 0.5), 3);
    // Every face has turned: none is the reader's face unshaded, and the flat
    // part shows the other face plain. (The bend is sampled densely, so most
    // vertices are on it, shaded between the two.)
    const faces = [...Array(over.fills.count).keys()].map((i) => rgba(over.fills.color, i * 4)[0]);
    expect(faces.filter((red) => Math.abs(red - UP[0]) < 1e-3)).toHaveLength(0);
    expect(faces.some((red) => Math.abs(red - OTHER[0]) < 1e-3)).toBe(true);
    // The valley at x = 0.25 is now at x = 0.75, named a mountain from this side.
    expect(over.strokes.a[0]).toBeCloseTo(1.5, 3);
    expect(rgba(over.strokes.color)).toEqual(MOUNTAIN);
    expect(over.strokes.dashSlot![0]).toBe(2);
  });

  it('halfway, has carried the left half over onto the right, the rest still on the table', () => {
    const { fills } = foldPoseGeometry(turning, pose(Math.PI / 2), [], paint);
    // Nothing left of the centre line; the right half is two layers deep.
    expect(Math.min(...xs(fills.position))).toBeGreaterThanOrEqual(1 - 1e-6);
    expect(Math.max(...xs(fills.position))).toBeCloseTo(2, 3);
    const faces = [...Array(fills.count).keys()].map((i) => rgba(fills.color, i * 4)[0]);
    expect(faces.some((red) => Math.abs(red - UP[0]) < 1e-3)).toBe(true);
    expect(faces.some((red) => Math.abs(red - OTHER[0]) < 1e-3)).toBe(true);
    expect(Math.min(...Array.from(fills.depth!))).toBeCloseTo(0.05);
  });
});
