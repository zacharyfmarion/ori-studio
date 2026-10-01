/**
 * The moving paper at a pose, as the folded channel draws it: a top-down
 * projection of the paper in space, with height as depth.
 *
 * The renderer's `setFolded` channel takes depth-ordered fills and strokes in
 * user space, and a generated folded figure already reaches it as exactly
 * this — a 3D model projected straight down. So a moving flap is the same
 * stream: the flap's paper is meshed on the surface `foldSurface.ts`
 * describes, each point dropped back onto the plane for its position and
 * given a depth from its height. A sheet turning over is the same again, on
 * the turn-over's own surface.
 *
 * Which face shows is the sign of the surface normal's component toward the
 * reader, per point: the face the reader is on until the paper turns past
 * edge-on, the other face after. Paper colour follows it, and so do the inks
 * and dashes that name a direction — a mountain seen from the back is a
 * valley (`diagram/diagramModel.flipDirection`), so a crease riding the flap
 * over swaps to the other face's naming where that face shows. A face is
 * shaded by how far it tilts from the reader, which is what makes the bend
 * read as a rounded ridge rather than a stripe.
 *
 * No shadow. There was a cast one, and a contact one after it; Zach had
 * both taken out (2026-09-16): from straight above they read as grey slabs
 * beside the paper, not as height.
 */
import { convexHull, type Point } from '../../../lib/geometry';
import type { FoldedGeometry, Rgba, StrokeGeometry } from '../../renderer/types';
import { clipPolygonToSide } from '../diagram/plannerDiagram';
import type { FoldPose } from './foldPlayback';
import { chordFrame, fromChordFrame, inChordFrame, type FoldScene } from './foldScene';
import type { FlapStrokes } from './foldSplit';
import {
  BEND_RADIUS_SHARE,
  COLUMN_SHARE,
  CREASE_RAMP_SHARE,
  ROLL_RADIUS_SHARE,
  createFoldSurface,
  createRollOverSurface,
  strokeCuts,
  tessellateFlap,
  type FlatPoint,
  type PlacedPoint,
} from './foldSurface';

/**
 * A mountain and a valley of one kind of line: the ink and the dash slot each
 * is drawn with. On the other face each becomes the other of its own pair.
 */
export interface FoldDirectionPens {
  mountain: Rgba;
  valley: Rgba;
  mountainSlot: number;
  valleySlot: number;
}

export interface FoldPaint {
  /** The paper colour of the face the reader is on, and of the other face. */
  up: Rgba;
  other: Rgba;
  /**
   * The pairs that name a direction. The flap carries two kinds of mountain
   * and valley at once — the step's own fold from the diagram, in the
   * diagram-crease pens, and the pattern's creases under it, in the fold
   * pens — and each swaps within its pair, never into the other kind. A
   * stroke's dash slot says which pair it is drawn in, since no two pairs
   * share a slot; a stroke in no pair's slot — a solid pinch, but also an
   * edge, a dotted line or an earlier crease — is looked up by its ink, so
   * one whose ink happens to equal a pair's is swapped as that pair's.
   */
  directions: readonly FoldDirectionPens[];
  /**
   * What a tilted face is shaded toward, its alpha the strength at edge-on.
   * Exactly nothing when the paper is flat, so the flap at rest is the sheet.
   */
  shade: Rgba;
  /** Model space to the folded channel's user space: the view's own map, mirror included. */
  modelToUser: (p: Point) => Point;
}

/**
 * How a tilted face is shaded on screen: its own colour darkened toward black,
 * by up to a quarter where the paper is edge-on — less light reaches paper
 * turned away from the reader, so a bend reads as rounded in whatever colour
 * the paper is: a grey curl in white paper, a darker yellow in yellow.
 *
 * Black rather than a theme ink. The flap was once the theme's dark ground,
 * shaded toward its light text; the paper is the style's now, and the dark
 * theme's near-white text over light paper shaded nothing at all.
 */
export const PAPER_TILT_SHADE: Rgba = [0, 0, 0, 0.25];

/** The surface's sizes, as shares of the sheet's short side. */
export interface FoldSurfaceShares {
  radius: number;
  ramp: number;
  column: number;
  /** The roll a sheet turns over in. */
  roll: number;
  /**
   * How far past the hinge onto the base the flap's mesh reaches, flat, in
   * **model units** — a hairline, sized on screen by the caller. The base's
   * fill and the flap's mesh meet on the hinge line in two draws, and
   * anti-aliasing lets the ground bleed through a shared edge; a flat
   * overlap in the paper's own colour closes it.
   */
  hingeOverlap: number;
}

export const DEFAULT_SURFACE_SHARES: FoldSurfaceShares = {
  radius: BEND_RADIUS_SHARE,
  ramp: CREASE_RAMP_SHARE,
  column: COLUMN_SHARE,
  roll: ROLL_RADIUS_SHARE,
  hingeOverlap: 0,
};

/** Depths the paper is drawn at. */
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

const sameInk = (a: Rgba, color: ArrayLike<number>, at: number): boolean =>
  Math.abs(a[0] - color[at]!) < 1e-3 &&
  Math.abs(a[1] - color[at + 1]!) < 1e-3 &&
  Math.abs(a[2] - color[at + 2]!) < 1e-3;

/**
 * The pair a stroke is drawn in: the one whose slot it takes, or for a stroke
 * in no pair's slot the one whose ink it is in; null for a line that names no
 * direction.
 */
function directionPair(
  paint: FoldPaint,
  color: ArrayLike<number>,
  at: number,
  slot: number
): FoldDirectionPens | null {
  const bySlot = paint.directions.find(
    (pair) => slot !== 0 && (slot === pair.mountainSlot || slot === pair.valleySlot)
  );
  if (bySlot) return bySlot;
  return (
    paint.directions.find(
      (pair) => sameInk(pair.mountain, color, at) || sameInk(pair.valley, color, at)
    ) ?? null
  );
}

/**
 * The same crease named from the other face, within its pair: mountain ink
 * for valley ink and back, and the same for the dash slot. A stroke in its
 * pair's slot but not its ink — the picked crease, in the accent — keeps the
 * ink.
 */
function otherFace(
  paint: FoldPaint,
  color: ArrayLike<number>,
  at: number,
  slot: number
): { ink: Rgba; slot: number } {
  const own: Rgba = [color[at]!, color[at + 1]!, color[at + 2]!, color[at + 3]!];
  const pair = directionPair(paint, color, at, slot);
  if (!pair) return { ink: own, slot };
  const ink = sameInk(pair.mountain, color, at)
    ? pair.valley
    : sameInk(pair.valley, color, at)
      ? pair.mountain
      : null;
  return {
    ink: ink ? [ink[0], ink[1], ink[2], own[3]] : own,
    slot:
      slot === pair.mountainSlot ? pair.valleySlot : slot === pair.valleySlot ? pair.mountainSlot : slot,
  };
}

/**
 * A face's paper colour at a point, darkened by how far the paper tilts from
 * the reader there. Which face is the surface's to say (`PlacedPoint.face`),
 * not the tilt's.
 */
function shadedFace(paint: FoldPaint, face: 1 | -1, nz: number): Rgba {
  const paper = face > 0 ? paint.up : paint.other;
  const k = paint.shade[3] * (1 - Math.min(1, Math.abs(nz)));
  if (k <= 0) return paper;
  return [
    paper[0] * (1 - k) + paint.shade[0] * k,
    paper[1] * (1 - k) + paint.shade[1] * k,
    paper[2] * (1 - k) + paint.shade[2] * k,
    paper[3],
  ];
}

/**
 * The moving flap in its own frame, on its surface at the pose: what the mesh,
 * the strokes riding it and its outline are all placed through. Null when the
 * pose names no flap of the scene.
 */
function posedFlap(scene: FoldScene, pose: FoldPose, shares: FoldSurfaceShares) {
  const flap = scene.flaps[pose.flap];
  if (!flap) return null;
  const short = scene.sheetShortSide > 0 ? scene.sheetShortSide : 1;
  const frame = chordFrame(flap.chord, flap.side);
  const overlap = flap.whole ? 0 : Math.max(0, shares.hingeOverlap);
  // The flap's corners on the hinge are pushed a hairline onto the base, so
  // the mesh's first row lies flat over the base's own fill.
  const onHinge = 1e-9 * Math.max(1, short);
  const polygon: FlatPoint[] = flap.polygon.map((corner) => {
    const p = inChordFrame(frame, corner);
    return overlap > 0 && Math.abs(p.u) <= onHinge ? { s: p.s, u: -overlap } : p;
  });
  let uMin = 0;
  let uMax = 0;
  for (const p of polygon) {
    uMin = Math.min(uMin, p.u);
    uMax = Math.max(uMax, p.u);
  }
  // A sheet turning over rolls across itself as the swing runs 0 to π; the
  // press has nothing to do there.
  const surface = flap.whole
    ? createRollOverSurface(pose.angle / Math.PI, Math.max(uMax, -uMin), shares.roll * short)
    : createFoldSurface({
        radius: shares.radius * short,
        angle: pose.angle,
        press: pose.press,
        creased: flap.creased,
        ramp: shares.ramp * short,
      });
  return { short, frame, polygon, uMin, uMax, surface };
}

/**
 * The paper the moving flap covers at a pose, as seen from above: the convex
 * outline of its mesh, in model space — the flap is paper wherever it has
 * swung to, and the sheet's own fill has left the place it lifted from
 * (`sheetFillGeometry`). For the marks drawn over the canvas, which take the
 * style's ink on paper and the theme's off it (X11 of the paper export plan).
 *
 * Its edges are placed at every row through the bend and every column the
 * surface breaks at — the only places it is not straight — and the hull taken,
 * which is the mesh's outline wherever the flap is convex and a hair more
 * where a bend bulges it. Empty when the pose names no flap.
 */
export function foldPoseOutline(
  scene: FoldScene,
  pose: FoldPose,
  shares: FoldSurfaceShares = DEFAULT_SURFACE_SHARES
): Point[] {
  const posed = posedFlap(scene, pose, shares);
  if (!posed || posed.polygon.length < 3) return [];
  const { frame, polygon, uMin, uMax, surface } = posed;
  const rows = surface.rows(uMin, uMax);
  const columns = surface.breakpoints();
  const placed: Point[] = [];
  polygon.forEach((from, index) => {
    const to = polygon[(index + 1) % polygon.length]!;
    const cuts = new Set<number>([0]);
    const du = to.u - from.u;
    const ds = to.s - from.s;
    if (du !== 0) for (const u of rows) cuts.add((u - from.u) / du);
    if (ds !== 0) for (const s of columns) cuts.add((s - from.s) / ds);
    for (const t of cuts) {
      if (t < 0 || t >= 1) continue;
      const at = surface.place(from.s + ds * t, from.u + du * t);
      placed.push(fromChordFrame(frame, at.s, at.v));
    }
  });
  return convexHull(placed);
}

/**
 * The paper at a pose, as the canvas fills it: the sheet's `outline` on the
 * resting side of the moving flap's line (none of it while the whole sheet
 * turns over), and the flap wherever it has swung to ({@link foldPoseOutline}).
 * At rest, the outline alone. Always two rings, the second empty at rest, so a
 * clip drawn from them keeps its shape from one frame to the next.
 */
export function foldPosePaper(
  outline: readonly Point[],
  scene: FoldScene | null,
  pose: FoldPose | null
): [Point[], Point[]] {
  const moving = pose && scene ? scene.flaps[pose.flap] : undefined;
  if (!pose || !scene || !moving) return [[...outline], []];
  const resting = moving.whole ? [] : clipPolygonToSide(outline, moving.chord, -moving.side);
  return [resting, foldPoseOutline(scene, pose)];
}

/**
 * The flap the pose names, at that pose. Every stroke list rides it; the
 * card's other flaps lie flat and are not drawn here at all.
 */
export function foldPoseGeometry(
  scene: FoldScene,
  pose: FoldPose,
  strokes: readonly (FlapStrokes | null | undefined)[],
  paint: FoldPaint,
  shares: FoldSurfaceShares = DEFAULT_SURFACE_SHARES
): FoldedGeometry {
  const posed = posedFlap(scene, pose, shares);
  if (!posed) return EMPTY_FOLDED;
  const { short, frame, polygon, surface } = posed;
  const reach = scene.reach > 0 ? scene.reach : 1;
  const depthOf = (z: number): number =>
    DEPTH_FLOOR + DEPTH_SPAN * Math.max(0, Math.min(1, z / reach));
  const breakpoints = surface.breakpoints();

  // Fills: the paper meshed on its surface.
  const position: number[] = [];
  const color: number[] = [];
  const depth: number[] = [];
  const mesh = tessellateFlap(polygon, surface, shares.column * short);
  mesh.vertices.forEach((placed, index) => {
    const at = paint.modelToUser(fromChordFrame(frame, placed.s, placed.v));
    position.push(at.x, at.y);
    // The triangle's face, so no triangle blends the two across the line
    // where the shown face changes.
    color.push(...shadedFace(paint, mesh.faces[Math.floor(index / 3)] ?? placed.face, placed.nz));
    depth.push(depthOf(placed.z));
  });

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
      const from = { x: list.a[i * 2]!, y: list.a[i * 2 + 1]! };
      const to = { x: list.b[i * 2]!, y: list.b[i * 2 + 1]! };
      const fa = inChordFrame(frame, from);
      const fb = inChordFrame(frame, to);
      const flat = Math.hypot(to.x - from.x, to.y - from.y);
      const sLo = Math.min(fa.s, fb.s);
      const sHi = Math.max(fa.s, fb.s);
      const straight =
        !surface.bent(Math.min(fa.u, fb.u), Math.max(fa.u, fb.u)) &&
        !breakpoints.some((s) => s > sLo && s < sHi);
      const cuts = straight ? WHOLE : strokeCuts(fa, fb, surface);
      const at = (t: number): PlacedPoint =>
        surface.place(fa.s + (fb.s - fa.s) * t, fa.u + (fb.u - fa.u) * t);
      let start = at(cuts[0]!);
      for (let k = 1; k < cuts.length; k += 1) {
        const end = at(cuts[k]!);
        const ua = paint.modelToUser(fromChordFrame(frame, start.s, start.v));
        const ub = paint.modelToUser(fromChordFrame(frame, end.s, end.v));
        a.push(ua.x, ua.y);
        b.push(ub.x, ub.y);
        // Named by the face its middle shows, as the paper under it is.
        const seen =
          at((cuts[k - 1]! + cuts[k]!) / 2).face < 0
            ? otherFace(paint, list.color, i * 4, list.dashSlot[i]!)
            : { ink: list.color.subarray(i * 4, i * 4 + 4), slot: list.dashSlot[i]! };
        strokeColor.push(...seen.ink);
        widthMul.push(list.widthMul[i]!);
        dashSlot.push(seen.slot);
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
