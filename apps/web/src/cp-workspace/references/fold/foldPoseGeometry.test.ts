import { describe, expect, it } from 'vitest';
import type { Rgba } from '../../renderer/types';
import {
  DEFAULT_SURFACE_SHARES,
  foldPoseGeometry,
  foldPoseOutline,
  foldPosePaper,
  PAPER_TILT_SHADE,
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

  it('overlaps its base by the hairline asked for, flat and unshaded', () => {
    const shares: FoldSurfaceShares = { ...RIGID, hingeOverlap: 0.05 };
    const { fills } = foldPoseGeometry(scene, pose(Math.PI), [], paint, shares);
    // The right half lands on the left, showing its other face; the overlap
    // is the strip of base from the hinge at 0.5 back to 0.45 — in user units
    // twice that — face up and on the paper, under the landed flap. The strip
    // is one face, hinge row included: no triangle blends the two.
    const up = [...Array(fills.count).keys()].filter(
      (i) => Math.abs(rgba(fills.color, i * 4)[0]! - UP[0]) < 1e-3
    );
    expect(up.length).toBeGreaterThan(0);
    for (const i of up) {
      expect(fills.position[i * 2]).toBeGreaterThanOrEqual(2 * 0.45 - 1e-6);
      expect(fills.position[i * 2]).toBeLessThanOrEqual(2 * 0.5 + 1e-6);
      expect(fills.depth![i]).toBeCloseTo(0.05);
    }
    // Without it, nothing face up is drawn at all.
    const bare = foldPoseGeometry(scene, pose(Math.PI), [], paint, RIGID);
    const bareUp = [...Array(bare.fills.count).keys()].filter(
      (i) => Math.abs(rgba(bare.fills.color, i * 4)[0]! - UP[0]) < 1e-3
    );
    expect(bareUp).toHaveLength(0);
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

  // The bend reads as rounded in the paper's own colour: darker where the
  // paper tilts from the reader, the same hue all the way round, and never
  // darker than the shade's strength allows.
  it('shades a tilted face in its own colour, whatever the paper', () => {
    for (const up of [
      [1, 1, 1, 1],
      [1, 1, 0.196, 1],
    ] as Rgba[]) {
      const own = { ...paint, up, other: up, shade: PAPER_TILT_SHADE };
      const { fills } = foldPoseGeometry(scene, pose(Math.PI / 2), [], own);
      // Raw, not through `rgba`, whose rounding is coarser than the check.
      const shaded = [...Array(fills.count).keys()]
        .map((i) => Array.from(fills.color.slice(i * 4, i * 4 + 4)))
        .filter((color) => color[0]! < up[0] - 1e-6);
      expect(shaded.length).toBeGreaterThan(0);
      for (const color of shaded) {
        const k = 1 - color[0]! / up[0];
        expect(k).toBeLessThanOrEqual(PAPER_TILT_SHADE[3] + 1e-6);
        // The same share off every channel: a darker version of the paper
        // (to what a float32 colour carries).
        expect(color[1]).toBeCloseTo(up[1] * (1 - k), 5);
        expect(color[2]).toBeCloseTo(up[2] * (1 - k), 5);
        expect(color[3]).toBe(1);
      }
    }
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
    // Everything has come over and lies flat: every face shows the other
    // side plain, with nothing left curled face up at the far edge.
    const faces = [...Array(over.fills.count).keys()].map((i) => rgba(over.fills.color, i * 4)[0]);
    expect(faces.every((red) => Math.abs(red - OTHER[0]) < 1e-3)).toBe(true);
    // The valley at x = 0.25 is now at x = 0.75, named a mountain from this side.
    expect(over.strokes.a[0]).toBeCloseTo(1.5, 3);
    expect(rgba(over.strokes.color)).toEqual(MOUNTAIN);
    expect(over.strokes.dashSlot![0]).toBe(2);
  });

  it('halfway, has the taken edge most of the way over and the rest sliding under it', () => {
    const { fills } = foldPoseGeometry(turning, pose(Math.PI / 2), [], paint);
    // Two layers in the middle of the footprint: the far edge has come in
    // from the right, the taken edge is on its way down toward it.
    expect(Math.min(...xs(fills.position))).toBeGreaterThan(0.3);
    expect(Math.max(...xs(fills.position))).toBeLessThan(1.7);
    const faces = [...Array(fills.count).keys()].map((i) => rgba(fills.color, i * 4)[0]);
    expect(faces.some((red) => Math.abs(red - UP[0]) < 1e-3)).toBe(true);
    expect(faces.some((red) => Math.abs(red - OTHER[0]) < 1e-3)).toBe(true);
    expect(Math.min(...Array.from(fills.depth!))).toBeCloseTo(0.05);
  });

  it('brings the taken edge down on the far one just as the bend gets there', () => {
    // In the sheet's own units: 1 wide, the roll's radius a share of that.
    const landing = 1 / (1 + Math.PI * roll);
    const { fills } = foldPoseGeometry(turning, pose(Math.PI * landing), [], paint);
    // The whole footprint again: the taken edge on the right, and the far
    // edge on the left, about to go round the bend.
    expect(Math.min(...xs(fills.position))).toBeCloseTo(0, 3);
    expect(Math.max(...xs(fills.position))).toBeCloseTo(2, 3);
    // All of it the other face: what is left of the reader's face is under
    // the roll, as it is under a real one. A sheared roll does not overhang
    // itself, and coloured by its own normal it showed the reader's face as
    // a band along its leading edge.
    const faces = [...Array(fills.count).keys()].map((i) => rgba(fills.color, i * 4)[0]);
    expect(faces.every((red) => Math.abs(red - UP[0]) >= 1e-3)).toBe(true);
    expect(faces.some((red) => Math.abs(red - OTHER[0]) < 1e-3)).toBe(true);
  });
});

describe('the paper at a pose', () => {
  // X11: a mark over the canvas takes the style's ink on the paper and the
  // theme's off it, and while a fold plays the moving flap is paper wherever
  // it has swung — so the marks need its outline as the canvas draws it.
  const flat: FoldPaint = { ...paint, modelToUser: (p) => p };
  const box = (points: readonly { x: number; y: number }[]) => ({
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  });
  // Five places: the mesh arrives as float32.
  const near = (value: ReturnType<typeof box>) =>
    Object.fromEntries(Object.entries(value).map(([key, v]) => [key, Number(v.toFixed(5))]));
  /** Every fill vertex, as points. */
  const vertices = (position: Float32Array) =>
    Array.from({ length: position.length / 2 }, (_, i) => ({ x: position[i * 2]!, y: position[i * 2 + 1]! }));
  /** Inside a counter-clockwise convex ring, within a hair. */
  const inside = (ring: readonly { x: number; y: number }[], p: { x: number; y: number }) =>
    ring.every((a, i) => {
      const b = ring[(i + 1) % ring.length]!;
      return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -1e-6;
    });

  it('is the flap where it lies at the start of the swing, and its mirror once over', () => {
    expect(near(box(foldPoseOutline(scene, pose(0), RIGID)))).toEqual({
      minX: 0.5,
      maxX: 1,
      minY: 0,
      maxY: 1,
    });
    expect(near(box(foldPoseOutline(scene, pose(Math.PI, 1), RIGID)))).toEqual({
      minX: 0,
      maxX: 0.5,
      minY: 0,
      maxY: 1,
    });
    // Edge-on, a rigid flap covers nothing but its hinge.
    const edgeOn = box(foldPoseOutline(scene, pose(Math.PI / 2), RIGID));
    expect(edgeOn.maxX - edgeOn.minX).toBeCloseTo(0, 9);
  });

  it('holds the mesh the canvas draws, curl and all, through the whole swing', () => {
    for (const angle of [0.3, Math.PI / 2, 2, 2.9, Math.PI]) {
      const outline = foldPoseOutline(scene, pose(angle, angle === Math.PI ? 0.5 : 0));
      const { fills } = foldPoseGeometry(
        scene,
        pose(angle, angle === Math.PI ? 0.5 : 0),
        [],
        flat
      );
      const mesh = vertices(fills.position);
      for (const vertex of mesh) expect(inside(outline, vertex), `${angle}`).toBe(true);
      // And no more than it: the outline's extent is the mesh's.
      expect(near(box(outline)), `${angle}`).toEqual(near(box(mesh)));
    }
  });

  it('is the sheet on the resting side of the line and the flap as it stands, while a fold plays', () => {
    const sheet = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    // At rest, the outline alone, with an empty second ring.
    expect(foldPosePaper(sheet, scene, null)).toEqual([sheet, []]);
    expect(foldPosePaper(sheet, null, pose(1))).toEqual([sheet, []]);
    const [resting, flap] = foldPosePaper(sheet, scene, pose(Math.PI, 1));
    // The paper the flap left is ground now.
    expect(near(box(resting))).toEqual({ minX: 0, maxX: 0.5, minY: 0, maxY: 1 });
    expect(near(box(flap))).toEqual(near(box(foldPoseOutline(scene, pose(Math.PI, 1)))));
    // A pose on a flap the card does not have is no pose.
    expect(foldPosePaper(sheet, scene, pose(1, 0, 3))).toEqual([sheet, []]);
  });

  it('is only the rolling sheet while the whole sheet turns over', () => {
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
    const sheet = turning.flaps[0]!.polygon;
    const [resting, rolling] = foldPosePaper(sheet, turning, pose(Math.PI / 2));
    expect(resting).toEqual([]);
    const { fills } = foldPoseGeometry(turning, pose(Math.PI / 2), [], flat);
    expect(near(box(rolling))).toEqual(near(box(vertices(fills.position))));
    // Once over, the sheet's own footprint again.
    expect(near(box(foldPoseOutline(turning, pose(Math.PI))))).toEqual({
      minX: 0,
      maxX: 1,
      minY: 0,
      maxY: 1,
    });
  });
});
