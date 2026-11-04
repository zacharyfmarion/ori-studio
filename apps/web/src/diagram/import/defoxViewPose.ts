/**
 * The pose a flat fold is shown in when it replaces a saved Defox view: the
 * side the view showed up, and its turn, so Show as Folded draws what the
 * view drew, in the Diagram's pens, rather than whatever face the kernel
 * holds still the right way up. Most Defox views are turned over (`flip0`)
 * and turned by eighths; started on its front, unturned, a fold showed the
 * other side of the paper on most of a project's steps, and the layer the
 * step folds was underneath.
 *
 * Defox draws a step as `A · Vf + b` (`STEP.get_T`, `N.mat`): each face of
 * its folded state `Vf` placed by its own map from the paper, then `A`,
 * mirrored when `flip0` and turned by `(2 · rotate − 1) π`. The kernel's
 * paper scene places each face by a map from the paper too, and the two
 * papers differ by a scale alone (Defox writes its CP at 400 across; the
 * import only moves it). So one face's maps, composed, give the turn — and
 * the mirror — from the kernel's picture to Defox's.
 *
 * Pure: no store, no kernel.
 */
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { fitPlacement, type Placement } from '../zoom/zoomImprint';

type Pt = [number, number];
/** A linear map, row by row: `[[a, b], [c, d]]`. */
type Linear = [number, number, number, number];

interface SavedView {
  V: Pt[];
  Vf: Pt[];
  FV: number[][];
  Ff: boolean[];
  flip0: boolean;
  rotate: number;
}

const isPoint = (value: unknown): value is Pt =>
  Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number' && Number.isFinite(n));

function savedView(snapshot: string): SavedView | null {
  let saved: unknown;
  try {
    saved = JSON.parse(snapshot);
  } catch {
    return null;
  }
  const { fold, params } = (saved ?? {}) as { fold?: Record<string, unknown>; params?: Record<string, unknown> };
  const { V, Vf, FV, Ff } = fold ?? {};
  if (!Array.isArray(V) || !V.every(isPoint) || !Array.isArray(Vf) || Vf.length !== V.length || !Vf.every(isPoint)) {
    return null;
  }
  if (!Array.isArray(FV) || !Array.isArray(Ff) || Ff.length !== FV.length) return null;
  const faces = FV.every(
    (face) => Array.isArray(face) && face.length >= 3 && face.every((i) => Number.isInteger(i) && i >= 0 && i < V.length)
  );
  const rotate = params?.rotate ?? 0.5;
  if (!faces || typeof rotate !== 'number' || !Number.isFinite(rotate)) return null;
  return { V, Vf, FV: FV as number[][], Ff: Ff.map(Boolean), flip0: params?.flip0 === true, rotate };
}

function linearOf(placement: Placement): Linear {
  const [a, c] = placement.applyVector([1, 0]);
  const [b, d] = placement.applyVector([0, 1]);
  return [a, b, c, d];
}

const times = ([a, b, c, d]: Linear, [e, f, g, h]: Linear): Linear => [
  a * e + b * g,
  a * f + b * h,
  c * e + d * g,
  c * f + d * h,
];

function inverse([a, b, c, d]: Linear): Linear | null {
  const det = a * d - b * c;
  return Math.abs(det) > 0 ? [d / det, -b / det, -c / det, a / det] : null;
}

function insideRing(ring: readonly Pt[], [x, y]: Pt): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function ringArea(ring: readonly Pt[]): number {
  let twice = 0;
  ring.forEach(([x0, y0], i) => {
    const [x1, y1] = ring[(i + 1) % ring.length]!;
    twice += x0 * y1 - x1 * y0;
  });
  return Math.abs(twice) / 2;
}

function boxOf(points: readonly Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of points) {
    box.minX = Math.min(box.minX, x);
    box.minY = Math.min(box.minY, y);
    box.maxX = Math.max(box.maxX, x);
    box.maxY = Math.max(box.maxY, y);
  }
  return box;
}

/** How the kernel's picture of a flat fold differs from a saved Defox view of it. */
export interface DefoxViewTurn {
  /** The view showed the paper's other side: the fold is to be turned over, and measured again. */
  reflected: boolean;
  /** The clockwise turn that lays the kernel's picture as the view lay; meaningful when not reflected. */
  rotationDeg: number;
}

/**
 * How `scene`, a flat fold as the kernel draws it on one side, unturned,
 * differs from `snapshot`'s saved Defox view of the same fold: measured on
 * its largest face that the snapshot places. Null when the snapshot does
 * not read, or names no face under the scene's.
 */
export function defoxViewTurn(snapshot: string, scene: OristudioCpFoldedPaperScene): DefoxViewTurn | null {
  const view = savedView(snapshot);
  const sheet = scene.sheet_points.map(({ x, y }): Pt => [x, y]);
  if (!view || sheet.length === 0) return null;
  const [ours, theirs] = [boxOf(sheet), boxOf(view.V)];
  const scale = (theirs.maxX - theirs.minX) / (ours.maxX - ours.minX);
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  const toDefox = ([x, y]: Pt): Pt => [
    theirs.minX + (x - ours.minX) * scale,
    theirs.minY + (y - ours.minY) * scale,
  ];
  const faces = scene.faces
    .map(({ points, outline }) => ({
      paper: points.map((index) => sheet[index]),
      folded: outline.map(({ x, y }): Pt => [x, y]),
    }))
    .filter((face): face is { paper: Pt[]; folded: Pt[] } =>
      face.paper.length >= 3 && face.paper.length === face.folded.length && face.paper.every((point) => point !== undefined)
    )
    .sort((a, b) => ringArea(b.paper) - ringArea(a.paper));
  const theta = (2 * view.rotate - 1) * Math.PI;
  const [cos, sin] = [Math.cos(theta), Math.sin(theta)];
  // `N.mat(flip0, 1, θ)`: the view's own turn, mirrored when it is turned over.
  const shown: Linear = view.flip0 ? [-cos, sin, sin, cos] : [cos, -sin, sin, cos];
  for (const face of faces) {
    const middle = face.paper.reduce<Pt>((sum, [x, y]) => [sum[0] + x / face.paper.length, sum[1] + y / face.paper.length], [0, 0]);
    if (!insideRing(face.paper, middle)) continue;
    const at = toDefox(middle);
    const saved = view.FV.findIndex((ring) => insideRing(ring.map((index) => view.V[index]!), at));
    if (saved < 0) continue;
    const ring = view.FV[saved]!;
    const kernel = fitPlacement(face.paper, face.folded);
    const defox = fitPlacement(ring.map((index) => view.V[index]!), ring.map((index) => view.Vf[index]!));
    const back = kernel && inverse(linearOf(kernel));
    if (!back || !defox) continue;
    // The kernel's picture onto Defox's: back to the paper, Defox's fold, then its view.
    const [a, b, c, d] = times(times(shown, linearOf(defox)), back);
    const degrees = (((Math.atan2(c, a) * 180) / Math.PI) % 360 + 360) % 360;
    return { reflected: a * d - b * c < 0, rotationDeg: (Math.round(degrees * 1000) / 1000) % 360 };
  }
  return null;
}

/**
 * `pose`, a flat fold's, as `snapshot`'s saved Defox view showed the fold:
 * on the side the view showed up — the fold held turned over by `turnOver`,
 * which says what the kernel draws then — and turned as the view lay.
 * `scene` is the fold as the kernel draws it on `pose`'s side. `pose` itself
 * where the view says nothing.
 */
export async function asDefoxShowed<Pose extends { side: 'front' | 'back'; rotationDeg: number }>(
  snapshot: string,
  pose: Pose,
  scene: OristudioCpFoldedPaperScene | null,
  turnOver: (side: 'front' | 'back') => Promise<OristudioCpFoldedPaperScene | null>
): Promise<Pose> {
  let turn = scene && defoxViewTurn(snapshot, scene);
  let posed = pose;
  if (turn?.reflected) {
    const side = pose.side === 'back' ? 'front' : 'back';
    posed = { ...posed, side };
    const over = await turnOver(side);
    turn = over && defoxViewTurn(snapshot, over);
  }
  return turn && !turn.reflected ? { ...posed, rotationDeg: turn.rotationDeg } : posed;
}
