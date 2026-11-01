/**
 * Which cell of a folded scene is under a point, and the faces stacked there,
 * top first: the stack hit index Fold's folded pane and the Layer order
 * dialog's panes share (`implementation-plans/layer-order-dialog.md`, U1).
 *
 * **What it is built from.** The cells the painter reads: a paper scene's
 * `subfaces` (`OristudioCpFoldedPaperSubface`, which Fold's `FoldScene`
 * carries too), each a region of the overlay with `faces_top_to_bottom`. It
 * keeps them in their own coordinates, the frame a pane's `modelToSvg` maps
 * from, never the painted scene (scene px, spread or not). A pane asks with
 * the pointer taken back through that same map, so paint, tints and hits
 * agree. A cell's identity is its index in the list: the spot's id, stable
 * for one scene.
 *
 * **Convex and not.** A convex cell takes the fast test, Fold's
 * `insideConvex`. Any other is tested by the even-odd rule: Oriedita's
 * subfaces need not be convex, and a sheet with a notch or a window in it
 * folds to cells that bend round it (`holed_frame_collinear.ori`). Each cell
 * is checked once, here; a caller whose cells are all convex says so
 * (`convex: true`) and skips the check, as Fold does, whose overlay is convex
 * by construction (fold-workspace plan, D8).
 *
 * **Ties.** A point on an edge two cells share, or within `epsilon` of it, is
 * in both, and the first in the scene's order is the answer, as Fold's linear
 * scan always had it. From {@link GRID_MIN_CELLS} cells up, the cells' boxes
 * are binned into a uniform grid so a query reads a few of them; the answer
 * is the same either way.
 *
 * Pure: no React, no store, no engine.
 */
import type { Point } from '../../lib/geometry';
import type { Aabb } from './lineHitIndex';
import { insideConvex, insideEvenOdd, isConvexPolygon } from './polygonContains';

/** A cell as a scene lists it: the kernel's `OristudioCpFoldedPaperSubface`. */
export interface StackCell {
  readonly polygon: readonly Point[];
  /** The faces over the cell as the viewer sees them; `[0]` is on top. */
  readonly faces_top_to_bottom: readonly number[];
}

/** A cell as the index holds it. */
export interface StackHitCell {
  /** Its outline, in the frame the index was built in. */
  readonly polygon: readonly Point[];
  readonly box: Aabb;
  /** The faces over it, top first: the scene's `faces_top_to_bottom`, as given. */
  readonly stack: readonly number[];
  /** It takes the convex test, and a fill fans it from its first corner. */
  readonly convex: boolean;
}

/** The cell under a point, by its index in the scene's list, and its faces, top first. */
export interface StackHit {
  cell: number;
  faces: readonly number[];
}

export interface StackHitIndexOptions {
  /** Every cell is convex: skip the check, and test each the fast way. */
  convex?: boolean;
  /** Bin the cells into a grid; by default from {@link GRID_MIN_CELLS} cells up. Tests force either way. */
  grid?: boolean;
}

/** From this many cells, a query reads a grid's bin rather than every cell's box. */
export const GRID_MIN_CELLS = 64;

/** The most bins along either side of the grid. */
const GRID_MAX_SIDE = 1024;

/** The cells' boxes, binned: per bin, the cells whose box meets it, in the scene's order. */
interface Grid {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  size: number;
  nx: number;
  ny: number;
  /** Bin `b`'s cells are `items[start[b]]` up to `items[start[b + 1]]`. */
  start: Int32Array;
  items: Int32Array;
}

function boxOf(polygon: readonly Point[]): Aabb {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of polygon) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

function gridOf(cells: readonly StackHitCell[]): Grid | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { box } of cells) {
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
  }
  if (!Number.isFinite(minX)) return null;
  // About one bin per cell, square, over the cells' extent.
  const width = maxX - minX;
  const height = maxY - minY;
  const area = width * height;
  let size = area > 0 ? Math.sqrt(area / cells.length) : Math.max(width, height) / cells.length;
  if (!(size > 0)) return null;
  size = Math.max(size, width / GRID_MAX_SIDE, height / GRID_MAX_SIDE);
  const nx = Math.max(1, Math.min(GRID_MAX_SIDE, Math.ceil(width / size)));
  const ny = Math.max(1, Math.min(GRID_MAX_SIDE, Math.ceil(height / size)));
  const grid: Grid = {
    minX,
    minY,
    maxX,
    maxY,
    size,
    nx,
    ny,
    start: new Int32Array(nx * ny + 1),
    items: new Int32Array(0),
  };
  // Count, then place: a cell goes in every bin its box meets, in the scene's order.
  const count = grid.start;
  for (const { box } of cells) {
    forEachBin(grid, box.minX, box.minY, box.maxX, box.maxY, (bin) => {
      count[bin + 1]! += 1;
    });
  }
  for (let bin = 0; bin < nx * ny; bin += 1) count[bin + 1]! += count[bin]!;
  const items = new Int32Array(count[nx * ny]!);
  const next = count.slice(0, nx * ny);
  cells.forEach(({ box }, cell) => {
    forEachBin(grid, box.minX, box.minY, box.maxX, box.maxY, (bin) => {
      items[next[bin]!++] = cell;
    });
  });
  grid.items = items;
  return grid;
}

/** The column or row a coordinate falls in, held to the grid. */
function binAlong(value: number, min: number, size: number, bins: number): number {
  return Math.min(bins - 1, Math.max(0, Math.floor((value - min) / size)));
}

function forEachBin(grid: Grid, minX: number, minY: number, maxX: number, maxY: number, visit: (bin: number) => void) {
  const x0 = binAlong(minX, grid.minX, grid.size, grid.nx);
  const x1 = binAlong(maxX, grid.minX, grid.size, grid.nx);
  const y0 = binAlong(minY, grid.minY, grid.size, grid.ny);
  const y1 = binAlong(maxY, grid.minY, grid.size, grid.ny);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) visit(y * grid.nx + x);
  }
}

/** A folded scene's cells, indexed for "which cell, and which stack, is under this point". */
export class StackHitIndex {
  /** The cells, in the scene's order: `cells[k]` is cell `k`. */
  readonly cells: readonly StackHitCell[];
  private readonly grid: Grid | null;

  constructor(cells: readonly StackCell[], options: StackHitIndexOptions = {}) {
    this.cells = cells.map(({ polygon, faces_top_to_bottom }) => {
      const copy = polygon.map(({ x, y }) => ({ x, y }));
      return {
        polygon: copy,
        box: boxOf(copy),
        stack: faces_top_to_bottom,
        convex: options.convex === true || isConvexPolygon(copy),
      };
    });
    const binned = options.grid ?? this.cells.length >= GRID_MIN_CELLS;
    this.grid = binned ? gridOf(this.cells) : null;
  }

  /** Whether cell `cell` holds `p`, or comes within `epsilon` of it. */
  contains(cell: number, p: Point, epsilon = 0): boolean {
    const entry = this.cells[cell];
    if (!entry) return false;
    const { box, polygon } = entry;
    if (p.x < box.minX - epsilon || p.x > box.maxX + epsilon || p.y < box.minY - epsilon || p.y > box.maxY + epsilon) {
      return false;
    }
    return entry.convex ? insideConvex(polygon, p, epsilon) : insideEvenOdd(polygon, p, epsilon);
  }

  /** The cell under `p` and its faces, top first; null off the paper. The first in the scene's order where cells meet. */
  stackAt(p: Point, epsilon = 0): StackHit | null {
    const cell = this.firstAt(p, epsilon);
    return cell < 0 ? null : { cell, faces: this.cells[cell]!.stack };
  }

  /** Every cell that holds `p`, or comes within `epsilon` of it, in the scene's order: the cells round a spot. */
  cellsAt(p: Point, epsilon = 0): number[] {
    const { grid } = this;
    if (!grid) return this.cells.flatMap((_, cell) => (this.contains(cell, p, epsilon) ? [cell] : []));
    if (outside(grid, p, epsilon)) return [];
    const found = new Set<number>();
    forEachBin(grid, p.x - epsilon, p.y - epsilon, p.x + epsilon, p.y + epsilon, (bin) => {
      for (let k = grid.start[bin]!; k < grid.start[bin + 1]!; k += 1) {
        const cell = grid.items[k]!;
        if (!found.has(cell) && this.contains(cell, p, epsilon)) found.add(cell);
      }
    });
    return [...found].sort((a, b) => a - b);
  }

  private firstAt(p: Point, epsilon: number): number {
    const { grid } = this;
    if (!grid) {
      for (let cell = 0; cell < this.cells.length; cell += 1) if (this.contains(cell, p, epsilon)) return cell;
      return -1;
    }
    if (outside(grid, p, epsilon)) return -1;
    // Each bin lists its cells in the scene's order, so the first that holds
    // `p` is that bin's answer; across the bins `epsilon` reaches, the least.
    let best = Infinity;
    forEachBin(grid, p.x - epsilon, p.y - epsilon, p.x + epsilon, p.y + epsilon, (bin) => {
      for (let k = grid.start[bin]!; k < grid.start[bin + 1]!; k += 1) {
        const cell = grid.items[k]!;
        if (cell >= best) break;
        if (this.contains(cell, p, epsilon)) {
          best = cell;
          break;
        }
      }
    });
    return Number.isFinite(best) ? best : -1;
  }
}

function outside(grid: Grid, p: Point, epsilon: number): boolean {
  return (
    p.x < grid.minX - epsilon || p.x > grid.maxX + epsilon || p.y < grid.minY - epsilon || p.y > grid.maxY + epsilon
  );
}
