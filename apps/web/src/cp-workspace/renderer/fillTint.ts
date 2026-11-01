/**
 * Paper lit from above: the tint ladder, and the fills that carry it on a
 * renderer's overlay fill channel (`setDiagnosticFills`), in the pane's frame.
 *
 * Fold's folded pane and the Layer order dialog's panes both light paper this
 * way (`implementation-plans/layer-order-dialog.md`, U1). Two surfaces that
 * know nothing of each other must agree on what a choice offered, the thing
 * under the pointer, what moves and what is picked look like over paper, so
 * the alphas are one ladder, here. Which state takes which rung, and the
 * colour, stay with each caller (`fold/canvas/foldPaneOverlays.ts`, the
 * dialog's tint model): a rung is a share of the ink's own alpha.
 *
 * Geometry only. A convex ring is fanned from its first corner, as Fold has
 * always drawn one; any other is cut into triangles by earcut. A cell of a
 * {@link StackHitIndex} says which it is, and its triangles are worked out once.
 *
 * Pure: no React, no store.
 */
import earcut from 'earcut';
import type { Point } from '../../lib/geometry';
import { isConvexPolygon } from '../picking/polygonContains';
import type { StackHitCell, StackHitIndex } from '../picking/stackHitIndex';
import type { FillGeometry, Rgba } from './types';

/** How strongly paper is lit, by what the light says: Fold's alphas, named. */
export const TINT = {
  /** Offered, not taken: the layers a tuck may go against. */
  faint: 0.16,
  /** Under the pointer: the region a click would pick. */
  hover: 0.26,
  /** What a located fold moves. */
  moving: 0.3,
  /** Picked or taken: the region picked, the layer a tuck goes against. */
  picked: 0.42,
  /** Picked out of paper already lit: the flap under the pointer, over what moves. */
  emphasis: 0.5,
} as const;

/** Triangles, three corners each, gathered into one fill in the order they come. */
class FillBuilder {
  private readonly position: number[] = [];
  private readonly color: number[] = [];

  add(corners: readonly Point[], rgba: Rgba, alpha: number): void {
    const color = [rgba[0], rgba[1], rgba[2], rgba[3] * alpha];
    for (const { x, y } of corners) {
      this.position.push(x, y);
      this.color.push(...color);
    }
  }

  geometry(): FillGeometry | null {
    if (this.position.length === 0) return null;
    return {
      position: new Float32Array(this.position),
      color: new Float32Array(this.color),
      count: this.position.length / 2,
    };
  }
}

/** A ring's triangles, three corners each: a fan from its first corner when convex, earcut's otherwise. */
function triangles(ring: readonly Point[], convex: boolean): Point[] {
  const corners: Point[] = [];
  if (convex) {
    for (let k = 1; k + 1 < ring.length; k += 1) corners.push(ring[0]!, ring[k]!, ring[k + 1]!);
    return corners;
  }
  const flat = ring.flatMap(({ x, y }) => [x, y]);
  if (flat.length < 6) return corners;
  for (const k of earcut(flat)) corners.push(ring[k]!);
  return corners;
}

/** Each cell's triangles, worked out once: a cell never changes. */
const cellTriangles = new WeakMap<StackHitCell, readonly Point[]>();

function trianglesOfCell(cell: StackHitCell): readonly Point[] {
  let corners = cellTriangles.get(cell);
  if (!corners) {
    corners = triangles(cell.polygon, cell.convex);
    cellTriangles.set(cell, corners);
  }
  return corners;
}

/** Rings lit whole, in the pane's frame; null when they hold no triangle. */
export function ringsFill(rings: Iterable<readonly Point[]>, rgba: Rgba, alpha: number): FillGeometry | null {
  const fill = new FillBuilder();
  for (const ring of rings) fill.add(triangles(ring, isConvexPolygon(ring)), rgba, alpha);
  return fill.geometry();
}

/** Cells of an index lit whole, by their index in it; null for none. */
export function cellsFill(index: StackHitIndex, cells: Iterable<number>, rgba: Rgba, alpha: number): FillGeometry | null {
  const fill = new FillBuilder();
  for (const k of cells) {
    const cell = index.cells[k];
    if (cell) fill.add(trianglesOfCell(cell), rgba, alpha);
  }
  return fill.geometry();
}

/**
 * Every cell whose stack holds one of `faces`, whole: those faces shown
 * where they lie, under other layers too, since the fill is drawn over the
 * paper. Null for none.
 */
export function cellsHoldingFill(
  index: StackHitIndex,
  faces: ReadonlySet<number>,
  rgba: Rgba,
  alpha: number
): FillGeometry | null {
  const fill = new FillBuilder();
  for (const cell of index.cells) {
    if (cell.stack.some((face) => faces.has(face))) fill.add(trianglesOfCell(cell), rgba, alpha);
  }
  return fill.geometry();
}

/** Two fills drawn as one, the second over the first; either may be none. */
export function joinFills(first: FillGeometry | null, second: FillGeometry | null): FillGeometry | null {
  if (!first || !second) return first ?? second;
  const position = new Float32Array(first.position.length + second.position.length);
  position.set(first.position);
  position.set(second.position, first.position.length);
  const color = new Float32Array(first.color.length + second.color.length);
  color.set(first.color);
  color.set(second.color, first.color.length);
  return { position, color, count: first.count + second.count };
}
