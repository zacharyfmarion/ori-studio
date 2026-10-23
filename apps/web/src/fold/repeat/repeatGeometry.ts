/** Material correspondence for Repeat. All coordinates are sheet/model units. */
import type { Point } from '../../lib/geometry';
import {
  applyIsometry,
  clipConvex,
  insideConvex,
  invertIsometry,
  lineThrough,
  polygonArea,
  polygonCentroid,
  toPair,
  toPoint,
} from '../canvas/foldCanvasGeometry';
import type { FoldModelLine, SheetPoint } from '../document/foldSequenceDocument';
import type { FoldIsometry, FoldRefusalBody, FoldScene } from '../engine/foldEngineWire';

export const REPEAT_TOL = 1e-6;
/**
 * Why a repeat stopped: Repeat's own code, or the engine's refusal of a
 * mirrored step — its code, and the refusal itself, which Repeat's window
 * words as the folding tool's window would (`repeatWords`).
 */
export class RepeatFailure extends Error {
  constructor(
    readonly code: string,
    readonly refusal?: FoldRefusalBody,
  ) {
    super(code);
  }

  /** The engine refused a mirrored step. */
  static refused(refusal: FoldRefusalBody): RepeatFailure {
    return new RepeatFailure(refusal.code, refusal);
  }
}
/**
 * Which side a sheet reflection repeats on, as the folded state at the
 * range's start says: `same` where the mirror keeps every layer pair's order
 * (the model is mirrored across a line in its plane), `behind` where it
 * reverses every one (the model is mirrored through its plane, so the front
 * flap's mirror is the back one). Either way each crease keeps its mountain
 * or valley on the paper; only what the viewer sees of it turns behind.
 */
export type RepeatSide = 'same' | 'behind';

/** +1 on the same side, −1 behind: how a mirrored pair of layers is ordered against the source's. */
export const sideSign = (side: RepeatSide): 1 | -1 => (side === 'same' ? 1 : -1);

export interface RepeatSymmetry {
  /** The axis: a line on the sheet, as the crease pattern shows it. */
  sheet: FoldModelLine;
  side: RepeatSide;
}
export function compose(a: FoldIsometry, b: FoldIsometry): FoldIsometry {
  return [
    a[0] * b[0] + a[1] * b[3],
    a[0] * b[1] + a[1] * b[4],
    a[0] * b[2] + a[1] * b[5] + a[2],
    a[3] * b[0] + a[4] * b[3],
    a[3] * b[1] + a[4] * b[4],
    a[3] * b[2] + a[4] * b[5] + a[5],
  ];
}
export function reflection(line: FoldModelLine): FoldIsometry {
  const l = Math.hypot(...line.n);
  if (!Number.isFinite(l) || l < REPEAT_TOL || !Number.isFinite(line.d))
    throw new RepeatFailure('repeat_axis');
  const [x, y] = line.n.map((v) => v / l) as [number, number];
  const d = line.d / l;
  return [1 - 2 * x * x, -2 * x * y, 2 * d * x, -2 * x * y, 1 - 2 * y * y, 2 * d * y];
}
export const mappedPoint = (map: FoldIsometry, p: SheetPoint): SheetPoint =>
  toPair(applyIsometry(map, toPoint(p)));
export function sheetRing(scene: FoldScene, face: number): Point[] {
  return scene.faces[face]!.points.map((p) => scene.sheet_points[p]!);
}
export function modelMap(scene: FoldScene, face: number): FoldIsometry {
  return compose(invertIsometry(scene.view_transform), scene.face_transforms[face]!);
}
export function overlap(a: readonly Point[], b: readonly Point[]): Point[] {
  let result = [...a];
  const twice = b.reduce((sum, p, i) => {
    const q = b[(i + 1) % b.length]!;
    return sum + p.x * q.y - q.x * p.y;
  }, 0);
  const sign = twice >= 0 ? 1 : -1;
  for (let k = 0; k < b.length && result.length; k++) {
    const line = lineThrough(b[k]!, b[(k + 1) % b.length]!);
    if (line) result = clipConvex(result, line, sign);
  }
  return result;
}
export function faceAt(scene: FoldScene, p: SheetPoint): number {
  const f = scene.faces.findIndex((_, i) => insideConvex(sheetRing(scene, i), toPoint(p), REPEAT_TOL));
  if (f < 0) throw new RepeatFailure('repeat_reference');
  return f;
}
/**
 * The isometry taking the source state's model frame to the target's for the
 * paper at sheet point `at`: read through a source face holding `at`, and the
 * target face that holds the mirror of that face's paper there.
 *
 * A point on a crease or at a vertex is held by several faces, each placed
 * differently. Reading each state through whichever face it lists first can
 * pair a face with the mirror of its neighbour, and the frame then comes out
 * turned by the fold between them.
 */
export function correspondingFrame(
  source: FoldScene,
  target: FoldScene,
  map: FoldIsometry,
  at: SheetPoint,
): FoldIsometry {
  const face = faceAt(source, at);
  return compose(
    modelMap(target, mirroredFaceAt(source, face, target, map, mappedPoint(map, at))),
    compose(map, invertIsometry(modelMap(source, face))),
  );
}
/** Less shared area than this is a touch along a boundary, not shared paper. */
const SHARED_AREA = 1e-12;
/** The face of `target` holding `at` that shares the most paper with source face `face` mirrored by `map`. */
function mirroredFaceAt(
  source: FoldScene,
  face: number,
  target: FoldScene,
  map: FoldIsometry,
  at: SheetPoint,
): number {
  const holding = target.faces.flatMap((_, i) =>
    insideConvex(sheetRing(target, i), toPoint(at), REPEAT_TOL) ? [i] : [],
  );
  if (!holding.length) throw new RepeatFailure('repeat_reference');
  if (holding.length === 1) return holding[0]!;
  const mirrored = sheetRing(source, face).map((p) => applyIsometry(map, p));
  let best = holding[0]!,
    most = SHARED_AREA;
  for (const i of holding) {
    const shared = Math.abs(polygonArea(overlap(mirrored, sheetRing(target, i))));
    if (shared > most) {
      best = i;
      most = shared;
    }
  }
  return best;
}
export function sameImages(a: FoldIsometry, b: FoldIsometry, points: readonly Point[]): boolean {
  return points.every((p) => {
    const x = applyIsometry(a, p),
      y = applyIsometry(b, p);
    return Math.hypot(x.x - y.x, x.y - y.y) < REPEAT_TOL;
  });
}
const UNIT: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
];
const IDENTITY: FoldIsometry = [1, 0, 0, 0, 1, 0];

/**
 * The side a model map repeats on, or null when it is no mirror of a sheet
 * reflection: it must undo itself (`m∘m` the identity — a reflection, a
 * half-turn or the identity). A reflection keeps the paper's front up where
 * its mirror's was, with the layers in their order: the same side. The
 * identity or a half-turn turns the front to face the other way, so the
 * layers must reverse for each crease to keep its letter on the paper:
 * behind. (A reflection with the layers reversed — a half-turn about a line
 * in the plane — would turn every crease's letter on the paper; it is no
 * repeat, and the layer check refuses it.)
 */
function mirrorSide(m: FoldIsometry): RepeatSide | null {
  if (!sameImages(compose(m, m), IDENTITY, UNIT)) return null;
  return m[0] * m[4] - m[1] * m[3] < 0 ? 'same' : 'behind';
}
export function orderPairs(scene: FoldScene): Map<string, number> {
  const pairs = new Map<string, number>();
  for (const cell of scene.subfaces)
    for (let i = 0; i < cell.faces_top_to_bottom.length; i++)
      for (let j = i + 1; j < cell.faces_top_to_bottom.length; j++) {
        const a = cell.faces_top_to_bottom[i]!,
          b = cell.faces_top_to_bottom[j]!;
        pairs.set(`${Math.min(a, b)}:${Math.max(a, b)}`, a < b ? 1 : -1);
      }
  return pairs;
}
/**
 * Whether the sheet reflection across `sheet` is a symmetry of the folded
 * state, and on which side it repeats: one model map takes every face's pose
 * to its mirror's — whole-region coverage, allowing extra flat subdivisions —
 * and every overlapping pair of layers keeps its order (the same side) or
 * every one reverses (behind), as that map says it must (`mirrorSide`).
 */
export function verifiedSymmetry(scene: FoldScene, sheet: FoldModelLine): RepeatSymmetry | null {
  if (scene.faces.length > 512) throw new RepeatFailure('repeat_limit');
  const map = reflection(sheet),
    first = toPair(polygonCentroid(sheetRing(scene, 0)));
  let h: FoldIsometry;
  try {
    h = correspondingFrame(scene, scene, map, first);
  } catch {
    return null;
  }
  const side = mirrorSide(h);
  if (!side) return null;
  const order = sideSign(side);
  const owners: number[][] = [];
  for (let i = 0; i < scene.faces.length; i++) {
    const polygon = sheetRing(scene, i).map((p) => applyIsometry(map, p));
    const expected = compose(h, compose(modelMap(scene, i), map));
    let area = 0;
    const matches: number[] = [];
    for (let j = 0; j < scene.faces.length; j++) {
      const part = overlap(polygon, sheetRing(scene, j)),
        a = Math.abs(polygonArea(part));
      if (a < 1e-12) continue;
      if (!sameImages(expected, modelMap(scene, j), part)) return null;
      area += a;
      matches.push(j);
    }
    if (Math.abs(area - Math.abs(polygonArea(polygon))) > 1e-9) return null;
    owners.push(matches);
  }
  const pairs = orderPairs(scene);
  for (const [key, sign] of pairs) {
    const [a, b] = key.split(':').map(Number) as [number, number];
    for (const x of owners[a]!)
      for (const y of owners[b]!) {
        const actual = pairs.get(`${Math.min(x, y)}:${Math.max(x, y)}`);
        if (actual !== undefined && actual !== order * sign * (x < y ? 1 : -1)) return null;
      }
  }
  return { sheet, side };
}
/** Every reflection of a convex polygon permutes its vertices. */
export function repeatSymmetries(scene: FoldScene, outline: readonly SheetPoint[]): RepeatSymmetry[] {
  const found: RepeatSymmetry[] = [];
  for (let i = 0; i < outline.length; i++)
    for (let j = i + 1; j < outline.length; j++) {
      const p = outline[i]!,
        q = outline[j]!,
        l = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (l < REPEAT_TOL) continue;
      const n: [number, number] = [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
      const axis = { n, d: (n[0] * (p[0] + q[0]) + n[1] * (p[1] + q[1])) / 2 };
      const m = reflection(axis);
      if (
        !outline.every((v) =>
          outline.some(
            (w) =>
              Math.hypot(...(mappedPoint(m, v).map((x, k) => x - w[k]!) as [number, number])) < REPEAT_TOL,
          ),
        )
      )
        continue;
      if (found.some((s) => sameImages(reflection(s.sheet), m, UNIT))) continue;
      const valid = verifiedSymmetry(scene, axis);
      if (valid) found.push(valid);
    }
  return found;
}
