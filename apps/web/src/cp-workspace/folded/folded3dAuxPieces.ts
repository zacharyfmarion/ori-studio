/**
 * Which layer shows each piece of a 3D figure's aux lines.
 *
 * The kernel carries the document's aux lines onto the figure's faces
 * (`folded_figure_3d_aux_lines`): one piece per face crossed, lying on that
 * face. A face, though, is not what is drawn — a **(cell, slot)** is
 * (`folded3dMesh`'s header): the face's place in the stack of each cell of
 * its plane it covers. So a piece is cut to every cell whose stack holds its
 * face, and each cut belongs to that cell's slot for the face — the same rule
 * a crease is drawn by, which is what makes a buried layer's aux lines hidden
 * with the layer and a top layer's shown.
 *
 * The cut is made in the plane's own `(u, v)`, where the cell rings are, and
 * lifted back through the plane's frame as the kernel lifts the rings — so a
 * piece lies in exactly the surface its layer is drawn as.
 *
 * Each cut also says which segments of its cell's ring its ends lie on: a cut
 * sits on vertices of its own, so where it meets its layer's outline — which
 * is where erode pulls an aux crease back — is only known here, in the plane.
 */
import {
  FOLDED_3D_CELL_ATTR_STRIDE,
  FOLDED_3D_FACE_ATTR_STRIDE,
  type OristudioCpFolded3dAuxLines,
  type OristudioCpFolded3dRenderModel,
} from '../../engine/oristudioCpTypes';
import type { Vec3 } from '@treemaker/origami-simulator';
import { cellRing, cellStack, planeFrame } from './folded3dModelReader';

/** One piece of an aux line on one layer, in the render model's coordinates. */
export type Folded3dAuxPiece = readonly [Vec3, Vec3];

/** A piece cut to one cell, and where its ends meet that cell's ring. */
export interface Folded3dAuxCut {
  ends: Folded3dAuxPiece;
  /**
   * Per end, the indices of the ring segments it lies on — segment `i` runs
   * from ring point `i` to `i + 1` — two at a ring corner, none inside the cell.
   */
  onRing: readonly [readonly number[], readonly number[]];
}

export interface Folded3dAuxSlots {
  /** The cuts each `(cell, slot)` shows: `cell → slot → cuts`. */
  bySlot: ReadonlyMap<number, ReadonlyMap<number, readonly Folded3dAuxCut[]>>;
  /** How many cuts in all. */
  count: number;
}

export const NO_FOLDED_3D_AUX_SLOTS: Folded3dAuxSlots = { bySlot: new Map(), count: 0 };

/** Pieces shorter than this share of the model's span are dust, and dropped. */
const MIN_PIECE_RELATIVE = 1e-9;
/**
 * How near a ring segment, as a share of the model's span, an end is on it:
 * the kernel's own shipped `distance_relative`, the tolerance it built the
 * rings to.
 */
const ON_RING_RELATIVE = 1e-6;

export function folded3dAuxSlots(
  model: OristudioCpFolded3dRenderModel,
  aux: OristudioCpFolded3dAuxLines | null | undefined
): Folded3dAuxSlots {
  if (!aux || aux.faces.length === 0) return NO_FOLDED_3D_AUX_SLOTS;
  const onFace = new Map<number, Folded3dAuxPiece[]>();
  aux.faces.forEach((face, i) => {
    const p = aux.points;
    const at = i * 6;
    const piece: Folded3dAuxPiece = [
      [p[at] ?? 0, p[at + 1] ?? 0, p[at + 2] ?? 0],
      [p[at + 3] ?? 0, p[at + 4] ?? 0, p[at + 5] ?? 0],
    ];
    const pieces = onFace.get(face);
    if (pieces) pieces.push(piece);
    else onFace.set(face, [piece]);
  });

  const minLength = MIN_PIECE_RELATIVE * model.span;
  const onRingTolerance = ON_RING_RELATIVE * model.span;
  const bySlot = new Map<number, Map<number, Folded3dAuxCut[]>>();
  let count = 0;
  for (let cell = 0; cell < model.cell_count; cell += 1) {
    const stack = cellStack(model, cell);
    if (!stack.some((face) => onFace.has(face))) continue;
    const plane = model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE] ?? 0;
    const frame = planeFrame(model, plane);
    const toPlane = (p: Vec3): [number, number] => {
      const dx = p[0] - frame.origin[0];
      const dy = p[1] - frame.origin[1];
      const dz = p[2] - frame.origin[2];
      return [
        dx * frame.u[0] + dy * frame.u[1] + dz * frame.u[2],
        dx * frame.v[0] + dy * frame.v[1] + dz * frame.v[2],
      ];
    };
    const lift = (x: number, y: number): Vec3 => [
      frame.origin[0] + frame.u[0] * x + frame.v[0] * y,
      frame.origin[1] + frame.u[1] * x + frame.v[1] * y,
      frame.origin[2] + frame.u[2] * x + frame.v[2] * y,
    ];
    const ring = cellRing(model, cell).map(toPlane);
    if (ring.length < 3) continue;
    stack.forEach((face, slot) => {
      const pieces = onFace.get(face);
      if (!pieces) return;
      // A face of another plane never has a slot here; the stack says so, and
      // this is only the guard against a model that disagrees with itself.
      if ((model.face_attr[face * FOLDED_3D_FACE_ATTR_STRIDE] ?? -1) !== plane) return;
      for (const [a3, b3] of pieces) {
        const a = toPlane(a3);
        const b = toPlane(b3);
        for (const [t0, t1] of clipToRing(a, b, ring, minLength)) {
          const from: [number, number] = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
          const to: [number, number] = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
          const cut: Folded3dAuxCut = {
            ends: [lift(from[0], from[1]), lift(to[0], to[1])],
            onRing: [
              ringSegmentsAt(from, ring, onRingTolerance),
              ringSegmentsAt(to, ring, onRingTolerance),
            ],
          };
          let slots = bySlot.get(cell);
          if (!slots) bySlot.set(cell, (slots = new Map()));
          const list = slots.get(slot);
          if (list) list.push(cut);
          else slots.set(slot, [cut]);
          count += 1;
        }
      }
    });
  }
  return { bySlot, count };
}

/**
 * The stretches of `a → b` inside `ring`, as fractions of it: split at every
 * crossing of a ring edge, and a stretch kept when its middle is inside by
 * the even-odd rule. Neighbouring stretches that are both inside are one.
 */
export function clipToRing(
  a: readonly [number, number],
  b: readonly [number, number],
  ring: readonly (readonly [number, number])[],
  minLength: number
): Array<[number, number]> {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (!(length > minLength)) return [];
  const cuts = [0, 1];
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const edge = Math.hypot(ex, ey);
    if (!(edge > minLength)) continue;
    const denominator = dx * ey - dy * ex;
    // Parallel: no crossing to split at; the middle test decides an overlap.
    if (Math.abs(denominator) <= 1e-12 * length * edge) continue;
    const ax = p[0] - a[0];
    const ay = p[1] - a[1];
    const t = (ax * ey - ay * ex) / denominator;
    const s = (ax * dy - ay * dx) / denominator;
    const tSlack = minLength / length;
    const sSlack = minLength / edge;
    if (t >= -tSlack && t <= 1 + tSlack && s >= -sSlack && s <= 1 + sSlack) {
      cuts.push(Math.min(1, Math.max(0, t)));
    }
  }
  cuts.sort((x, y) => x - y);
  const kept: Array<[number, number]> = [];
  for (let i = 0; i + 1 < cuts.length; i += 1) {
    const t0 = cuts[i]!;
    const t1 = cuts[i + 1]!;
    if ((t1 - t0) * length <= minLength) continue;
    const mid = (t0 + t1) / 2;
    if (!inside(a[0] + dx * mid, a[1] + dy * mid, ring)) continue;
    const last = kept[kept.length - 1];
    if (last && Math.abs(last[1] - t0) * length <= minLength) last[1] = t1;
    else kept.push([t0, t1]);
  }
  return kept;
}

/** The segments of `ring` that `point` lies within `tolerance` of. */
export function ringSegmentsAt(
  point: readonly [number, number],
  ring: readonly (readonly [number, number])[],
  tolerance: number
): number[] {
  const found: number[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const lengthSq = ex * ex + ey * ey;
    const t =
      lengthSq > 0
        ? Math.min(1, Math.max(0, ((point[0] - p[0]) * ex + (point[1] - p[1]) * ey) / lengthSq))
        : 0;
    const dx = point[0] - (p[0] + ex * t);
    const dy = point[1] - (p[1] + ey * t);
    if (Math.hypot(dx, dy) <= tolerance) found.push(i);
  }
  return found;
}

function inside(x: number, y: number, ring: readonly (readonly [number, number])[]): boolean {
  let within = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) within = !within;
  }
  return within;
}
