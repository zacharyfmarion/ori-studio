/**
 * The flap at a pose, as the folded channel draws it: a top-down projection
 * of the paper in space, with height as depth.
 *
 * The renderer's `setFolded` channel takes depth-ordered fills and strokes in
 * user space, and a generated folded figure already reaches it as exactly
 * this — a 3D model projected straight down. So a moving flap is the same
 * stream: each point of the paper is placed in the fold's own frame (along
 * the line, into the flap, and up), dropped back onto the plane for its
 * position, and given a depth from its height.
 *
 * Which face shows is the sign of the surface normal's component toward the
 * reader, per point: the face the reader is on until the paper turns past
 * edge-on, the other face after. Paper colour follows it, and so do the inks
 * and dashes that name a direction — a mountain seen from the back is a
 * valley (`diagram/diagramModel.flipDirection`), so a crease riding the flap
 * over swaps to the other face's naming where that face shows.
 */
import type { Point } from '../../../lib/geometry';
import type { FoldedGeometry, Rgba, StrokeGeometry } from '../../renderer/types';
import type { FoldPose } from './foldPlayback';
import { chordFrame, fromChordFrame, inChordFrame, type FoldScene } from './foldScene';
import type { FlapStrokes } from './foldSplit';

/** A point of the flap once posed: its chord-frame coordinates, its height, and which face is up. */
export interface PlacedPoint {
  s: number;
  v: number;
  z: number;
  /** The surface normal's component toward the reader: positive, the reader's face shows. */
  nz: number;
}

/** How a flap's paper is placed at a pose: the map from its flat `(s, u)` to space. */
export interface FoldPlacement {
  place(s: number, u: number): PlacedPoint;
}

/** A hinge with no bend: the flap turns rigidly about the line. */
export function rigidHinge(angle: number): FoldPlacement {
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  return { place: (s, u) => ({ s, v: u * c, z: u * sn, nz: c }) };
}

export interface FoldPaint {
  /** The paper colour of the face the reader is on, and of the other face. */
  up: Rgba;
  other: Rgba;
  /** The inks that name a direction; each becomes the other on the other face. */
  mountain: Rgba;
  valley: Rgba;
  /** The dash slots that name a direction, swapped the same way. */
  mountainSlot: number;
  valleySlot: number;
  /** Model space to the folded channel's user space: the view's own map, mirror included. */
  modelToUser: (p: Point) => Point;
}

/** Depths the flap is drawn at, leaving room under it for a shadow. */
const DEPTH_FLOOR = 0.05;
const DEPTH_SPAN = 0.9;
/** A crease sits a hair above the paper it is on. */
const STROKE_LIFT = 0.02;

export const EMPTY_FOLDED: FoldedGeometry = {
  fills: { position: new Float32Array(0), color: new Float32Array(0), count: 0 },
  strokes: {
    a: new Float32Array(0),
    b: new Float32Array(0),
    color: new Float32Array(0),
    widthMul: new Float32Array(0),
    count: 0,
  },
};

const sameInk = (a: Rgba, color: Float32Array, at: number): boolean =>
  Math.abs(a[0] - color[at]!) < 1e-3 &&
  Math.abs(a[1] - color[at + 1]!) < 1e-3 &&
  Math.abs(a[2] - color[at + 2]!) < 1e-3;

/** The same crease named from the other face: mountain ink for valley ink, and back. */
function swapInk(paint: FoldPaint, color: Float32Array, at: number, into: Float32Array, to: number): void {
  const other = sameInk(paint.mountain, color, at)
    ? paint.valley
    : sameInk(paint.valley, color, at)
      ? paint.mountain
      : null;
  into[to] = other ? other[0] : color[at]!;
  into[to + 1] = other ? other[1] : color[at + 1]!;
  into[to + 2] = other ? other[2] : color[at + 2]!;
  into[to + 3] = color[at + 3]!;
}

function swapSlot(paint: FoldPaint, slot: number): number {
  if (slot === paint.mountainSlot) return paint.valleySlot;
  if (slot === paint.valleySlot) return paint.mountainSlot;
  return slot;
}

/**
 * The scene at a pose. `placementFor` decides how each flap's paper sits in
 * space; the default is a rigid hinge. Every stroke list rides the flap its
 * `flap` index names.
 */
export function foldPoseGeometry(
  scene: FoldScene,
  pose: FoldPose,
  strokes: readonly (FlapStrokes | null | undefined)[],
  paint: FoldPaint,
  placementFor: (flapIndex: number) => FoldPlacement = () => rigidHinge(pose.angle)
): FoldedGeometry {
  const reach = scene.reach > 0 ? scene.reach : 1;
  const depthOf = (z: number): number =>
    DEPTH_FLOOR + DEPTH_SPAN * Math.max(0, Math.min(1, z / reach));
  const frames = scene.flaps.map((flap) => chordFrame(flap.chord, flap.side));
  const placements = scene.flaps.map((_, index) => placementFor(index));

  // Fills: each flap's polygon, placed corner by corner and fanned. A rigid
  // placement keeps it planar, so the fan is exact.
  const triangles = scene.flaps.reduce((sum, flap) => sum + Math.max(0, flap.polygon.length - 2), 0);
  const position = new Float32Array(triangles * 6);
  const color = new Float32Array(triangles * 12);
  const depth = new Float32Array(triangles * 3);
  let vertex = 0;
  const emit = (p: Point, face: Rgba, z: number): void => {
    position[vertex * 2] = p.x;
    position[vertex * 2 + 1] = p.y;
    color.set(face, vertex * 4);
    depth[vertex] = depthOf(z);
    vertex += 1;
  };
  scene.flaps.forEach((flap, index) => {
    const frame = frames[index]!;
    const placement = placements[index]!;
    const placed = flap.polygon.map((corner) => {
      const { s, u } = inChordFrame(frame, corner);
      const at = placement.place(s, u);
      return { point: paint.modelToUser(fromChordFrame(frame, at.s, at.v)), z: at.z, nz: at.nz };
    });
    for (let i = 1; i + 1 < placed.length; i += 1) {
      for (const p of [placed[0]!, placed[i]!, placed[i + 1]!]) {
        emit(p.point, p.nz >= 0 ? paint.up : paint.other, p.z);
      }
    }
  });

  // Strokes: each end placed, the segment's depth just above the higher end.
  const lists = strokes.filter((list): list is FlapStrokes => !!list && list.count > 0);
  const count = lists.reduce((sum, list) => sum + list.count, 0);
  const a = new Float32Array(count * 2);
  const b = new Float32Array(count * 2);
  const strokeColor = new Float32Array(count * 4);
  const widthMul = new Float32Array(count);
  const dashSlot = new Float32Array(count);
  const dashPhase = new Float32Array(count);
  const strokeDepth = new Float32Array(count);
  let dashPatterns: readonly (readonly number[])[] | undefined;
  let out = 0;
  for (const list of lists) {
    dashPatterns ??= list.dashPatterns;
    for (let i = 0; i < list.count; i += 1) {
      const flapIndex = list.flap[i]!;
      const frame = frames[flapIndex];
      const placement = placements[flapIndex];
      if (!frame || !placement) continue;
      const from = { x: list.a[i * 2]!, y: list.a[i * 2 + 1]! };
      const to = { x: list.b[i * 2]!, y: list.b[i * 2 + 1]! };
      const fa = inChordFrame(frame, from);
      const fb = inChordFrame(frame, to);
      const pa = placement.place(fa.s, fa.u);
      const pb = placement.place(fb.s, fb.u);
      const ua = paint.modelToUser(fromChordFrame(frame, pa.s, pa.v));
      const ub = paint.modelToUser(fromChordFrame(frame, pb.s, pb.v));
      a[out * 2] = ua.x;
      a[out * 2 + 1] = ua.y;
      b[out * 2] = ub.x;
      b[out * 2 + 1] = ub.y;
      const otherFace = pa.nz + pb.nz < 0;
      if (otherFace) swapInk(paint, list.color, i * 4, strokeColor, out * 4);
      else strokeColor.set(list.color.subarray(i * 4, i * 4 + 4), out * 4);
      widthMul[out] = list.widthMul[i]!;
      dashSlot[out] = otherFace ? swapSlot(paint, list.dashSlot[i]!) : list.dashSlot[i]!;
      // The phase is in the drawn segment's own units, so it scales with the
      // segment: a foreshortened piece dashes continuously with its neighbours.
      const flat = Math.hypot(to.x - from.x, to.y - from.y);
      const drawn = Math.hypot(ub.x - ua.x, ub.y - ua.y);
      dashPhase[out] = flat > 0 ? (list.dashPhase[i]! * drawn) / flat : 0;
      strokeDepth[out] = Math.max(depthOf(pa.z), depthOf(pb.z)) + STROKE_LIFT;
      out += 1;
    }
  }
  const packed: StrokeGeometry = {
    a: a.subarray(0, out * 2),
    b: b.subarray(0, out * 2),
    color: strokeColor.subarray(0, out * 4),
    widthMul: widthMul.subarray(0, out),
    dashSlot: dashSlot.subarray(0, out),
    dashPhase: dashPhase.subarray(0, out),
    depth: strokeDepth.subarray(0, out),
    count: out,
    ...(dashPatterns ? { dashPatterns } : {}),
  };
  return { fills: { position, color, depth, count: triangles * 3 }, strokes: packed };
}
