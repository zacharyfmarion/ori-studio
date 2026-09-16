/**
 * The flap at a pose, as the folded channel draws it: a top-down projection
 * of the paper in space, with height as depth.
 *
 * The renderer's `setFolded` channel takes depth-ordered fills and strokes in
 * user space, and a generated folded figure already reaches it as exactly
 * this — a 3D model projected straight down. So a moving flap is the same
 * stream: the flap's paper is meshed on the surface `foldSurface.ts`
 * describes, each point dropped back onto the plane for its position and
 * given a depth from its height.
 *
 * Which face shows is the sign of the surface normal's component toward the
 * reader, per point: the face the reader is on until the paper turns past
 * edge-on, the other face after. Paper colour follows it, and so do the inks
 * and dashes that name a direction — a mountain seen from the back is a
 * valley (`diagram/diagramModel.flipDirection`), so a crease riding the flap
 * over swaps to the other face's naming where that face shows. A face is
 * shaded by how far it tilts from the reader, which is what makes the curl
 * read as a rounded ridge rather than a stripe.
 *
 * Seen from straight above, a flat flap hovering over the paper looks like a
 * flat flap on the paper. The height is read from a **contact shadow**: the
 * flat part of the flap, offset a little along a light tilted off the
 * vertical, drawn under the flap in the shadow ink. Under the flap it is
 * hidden; along the flap's edges it shows as a thin rim. The offset is
 * capped at the hover height — a true cast shadow of a flap standing up
 * mid-swing lands far from it and reads as a second sheet, not as height —
 * so the rim says "lifted" and never where the light is. Only the flat part
 * casts one: it is planar, so its shadow cannot overlap itself and double
 * up through the translucency, and the curl at the hinge casts none.
 */
import type { Point } from '../../../lib/geometry';
import type { FoldedGeometry, Rgba, StrokeGeometry } from '../../renderer/types';
import type { FoldPose } from './foldPlayback';
import { chordFrame, fromChordFrame, inChordFrame, type FoldScene } from './foldScene';
import type { FlapStrokes } from './foldSplit';
import {
  BEND_RADIUS_SHARE,
  COLUMN_SHARE,
  CREASE_RAMP_SHARE,
  createFoldSurface,
  strokeCuts,
  tessellateFlap,
  type FlatPoint,
  type PlacedPoint,
} from './foldSurface';

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
  /**
   * What a tilted face is shaded toward, its alpha the strength at edge-on.
   * Exactly nothing when the paper is flat, so the flap at rest is the sheet.
   */
  shade: Rgba;
  /** Model space to the folded channel's user space: the view's own map, mirror included. */
  modelToUser: (p: Point) => Point;
}

/** The surface's sizes, as shares of the sheet's short side. */
export interface FoldSurfaceShares {
  radius: number;
  ramp: number;
  column: number;
}

export const DEFAULT_SURFACE_SHARES: FoldSurfaceShares = {
  radius: BEND_RADIUS_SHARE,
  ramp: CREASE_RAMP_SHARE,
  column: COLUMN_SHARE,
};

/** Depths the flap is drawn at, leaving room under it for a shadow. */
const DEPTH_FLOOR = 0.05;
const DEPTH_SPAN = 0.9;
/** A crease sits a hair above the paper it is on. */
const STROKE_LIFT = 0.02;
/** The shadow lies on the paper, under everything the flap draws. */
const SHADOW_DEPTH = 0.02;
/**
 * Where the light is, as the shadow's offset per unit of height in user
 * space — a little down and to the right on screen, so a raised edge shows
 * a rim of shadow along its lower and right sides.
 */
export const SHADOW_OFFSET_PER_HEIGHT: readonly [number, number] = [0.55, 0.55];
/** The height the shadow's offset is capped at, as a multiple of the hover height. */
const SHADOW_HEIGHT_CAP_HOVERS = 1;

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

const sameInk = (a: Rgba, color: ArrayLike<number>, at: number): boolean =>
  Math.abs(a[0] - color[at]!) < 1e-3 &&
  Math.abs(a[1] - color[at + 1]!) < 1e-3 &&
  Math.abs(a[2] - color[at + 2]!) < 1e-3;

/** The same crease named from the other face: mountain ink for valley ink, and back. */
function otherFaceInk(paint: FoldPaint, color: ArrayLike<number>, at: number): Rgba {
  const other = sameInk(paint.mountain, color, at)
    ? paint.valley
    : sameInk(paint.valley, color, at)
      ? paint.mountain
      : null;
  return other
    ? [other[0], other[1], other[2], color[at + 3]!]
    : [color[at]!, color[at + 1]!, color[at + 2]!, color[at + 3]!];
}

function swapSlot(paint: FoldPaint, slot: number): number {
  if (slot === paint.mountainSlot) return paint.valleySlot;
  if (slot === paint.valleySlot) return paint.mountainSlot;
  return slot;
}

/** The face's paper colour at a point, darkened by how far it tilts from the reader. */
function shadedFace(paint: FoldPaint, nz: number): Rgba {
  const face = nz >= 0 ? paint.up : paint.other;
  const k = paint.shade[3] * (1 - Math.min(1, Math.abs(nz)));
  if (k <= 0) return face;
  return [
    face[0] * (1 - k) + paint.shade[0] * k,
    face[1] * (1 - k) + paint.shade[1] * k,
    face[2] * (1 - k) + paint.shade[2] * k,
    face[3],
  ];
}

/** The scene at a pose. Every stroke list rides the flap its `flap` index names. */
export function foldPoseGeometry(
  scene: FoldScene,
  pose: FoldPose,
  strokes: readonly (FlapStrokes | null | undefined)[],
  paint: FoldPaint,
  shares: FoldSurfaceShares = DEFAULT_SURFACE_SHARES
): FoldedGeometry {
  const reach = scene.reach > 0 ? scene.reach : 1;
  const depthOf = (z: number): number =>
    DEPTH_FLOOR + DEPTH_SPAN * Math.max(0, Math.min(1, z / reach));
  const short = scene.sheetShortSide > 0 ? scene.sheetShortSide : 1;
  const frames = scene.flaps.map((flap) => chordFrame(flap.chord, flap.side));
  const surfaces = scene.flaps.map((flap) =>
    createFoldSurface({
      radius: shares.radius * short,
      angle: pose.angle,
      press: pose.press,
      creased: flap.creased,
      ramp: shares.ramp * short,
    })
  );
  const reaches = scene.flaps.map((flap, index) => {
    const frame = frames[index]!;
    let max = 0;
    for (const corner of flap.polygon) max = Math.max(max, inChordFrame(frame, corner).u);
    return max;
  });
  const breakpoints = surfaces.map((surface) => surface.breakpoints());

  // The user map is a similarity, so one scale carries a height into it.
  const origin = paint.modelToUser({ x: 0, y: 0 });
  const unit = paint.modelToUser({ x: 1, y: 0 });
  const userPerModel = Math.hypot(unit.x - origin.x, unit.y - origin.y) || 1;
  const [shadowX, shadowY] = SHADOW_OFFSET_PER_HEIGHT;

  // Fills: the shadow of each flap's flat part, then the flap meshed on its
  // surface. The depth test keeps the shadow under the flap whatever the
  // order; drawing it first only spares the blend.
  const position: number[] = [];
  const color: number[] = [];
  const depth: number[] = [];
  const meshes = scene.flaps.map((flap, index) => {
    const frame = frames[index]!;
    const polygon: FlatPoint[] = flap.polygon.map((corner) => inChordFrame(frame, corner));
    const mesh = tessellateFlap(polygon, surfaces[index]!, shares.column * short);
    const placed = mesh.vertices.map((vertex) => ({
      at: paint.modelToUser(fromChordFrame(frame, vertex.s, vertex.v)),
      z: vertex.z,
      nz: vertex.nz,
    }));
    return { placed, flat: mesh.flat };
  });
  const shadow: Rgba = paint.shade;
  const heightCap = SHADOW_HEIGHT_CAP_HOVERS * 2 * shares.radius * short;
  if (shadow[3] > 0 && heightCap > 0) {
    for (const mesh of meshes) {
      mesh.flat.forEach((flat, triangle) => {
        if (!flat) return;
        for (let k = 0; k < 3; k += 1) {
          const vertex = mesh.placed[triangle * 3 + k]!;
          const height = Math.min(vertex.z, heightCap) * userPerModel;
          position.push(vertex.at.x + height * shadowX, vertex.at.y + height * shadowY);
          color.push(...shadow);
          depth.push(SHADOW_DEPTH);
        }
      });
    }
  }
  for (const mesh of meshes) {
    for (const vertex of mesh.placed) {
      position.push(vertex.at.x, vertex.at.y);
      color.push(...shadedFace(paint, vertex.nz));
      depth.push(depthOf(vertex.z));
    }
  }

  // Strokes: each cut where the surface bends under it, every piece placed.
  // Most of a dense pattern's creases lie past the bend and cross no ramp,
  // and those are one piece each, decided without building a cut list.
  const a: number[] = [];
  const b: number[] = [];
  const strokeColor: number[] = [];
  const widthMul: number[] = [];
  const dashSlot: number[] = [];
  const dashPhase: number[] = [];
  const strokeDepth: number[] = [];
  let dashPatterns: readonly (readonly number[])[] | undefined;
  const WHOLE = [0, 1];
  for (const list of strokes) {
    if (!list || list.count === 0) continue;
    dashPatterns ??= list.dashPatterns;
    for (let i = 0; i < list.count; i += 1) {
      const flapIndex = list.flap[i]!;
      const frame = frames[flapIndex];
      const surface = surfaces[flapIndex];
      if (!frame || !surface) continue;
      const from = { x: list.a[i * 2]!, y: list.a[i * 2 + 1]! };
      const to = { x: list.b[i * 2]!, y: list.b[i * 2 + 1]! };
      const fa = inChordFrame(frame, from);
      const fb = inChordFrame(frame, to);
      const flat = Math.hypot(to.x - from.x, to.y - from.y);
      const sLo = Math.min(fa.s, fb.s);
      const sHi = Math.max(fa.s, fb.s);
      const straight =
        Math.min(fa.u, fb.u) >= surface.bendReach &&
        !breakpoints[flapIndex]!.some((s) => s > sLo && s < sHi);
      const cuts = straight ? WHOLE : strokeCuts(fa, fb, surface, reaches[flapIndex]!);
      const at = (t: number): PlacedPoint =>
        surface.place(fa.s + (fb.s - fa.s) * t, fa.u + (fb.u - fa.u) * t);
      let start = at(cuts[0]!);
      for (let k = 1; k < cuts.length; k += 1) {
        const end = at(cuts[k]!);
        const ua = paint.modelToUser(fromChordFrame(frame, start.s, start.v));
        const ub = paint.modelToUser(fromChordFrame(frame, end.s, end.v));
        a.push(ua.x, ua.y);
        b.push(ub.x, ub.y);
        const otherFace = start.nz + end.nz < 0;
        strokeColor.push(
          ...(otherFace
            ? otherFaceInk(paint, list.color, i * 4)
            : [list.color[i * 4]!, list.color[i * 4 + 1]!, list.color[i * 4 + 2]!, list.color[i * 4 + 3]!])
        );
        widthMul.push(list.widthMul[i]!);
        dashSlot.push(otherFace ? swapSlot(paint, list.dashSlot[i]!) : list.dashSlot[i]!);
        // The phase is in the drawn piece's own units, so it scales with the
        // piece: a foreshortened one dashes continuously with its neighbours.
        const flatPiece = flat * (cuts[k]! - cuts[k - 1]!);
        const drawn = Math.hypot(ub.x - ua.x, ub.y - ua.y);
        const before = list.dashPhase[i]! + flat * cuts[k - 1]!;
        dashPhase.push(flatPiece > 0 ? (before * drawn) / flatPiece : 0);
        strokeDepth.push(Math.max(depthOf(start.z), depthOf(end.z)) + STROKE_LIFT);
        start = end;
      }
    }
  }
  const packed: StrokeGeometry = {
    a: Float32Array.from(a),
    b: Float32Array.from(b),
    color: Float32Array.from(strokeColor),
    widthMul: Float32Array.from(widthMul),
    dashSlot: Float32Array.from(dashSlot),
    dashPhase: Float32Array.from(dashPhase),
    depth: Float32Array.from(strokeDepth),
    count: widthMul.length,
    ...(dashPatterns ? { dashPatterns } : {}),
  };
  return {
    fills: {
      position: Float32Array.from(position),
      color: Float32Array.from(color),
      depth: Float32Array.from(depth),
      count: depth.length,
    },
    strokes: packed,
  };
}
