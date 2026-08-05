import type {
  OristudioBpFlap,
  OristudioBpSheet,
  OristudioBpTreeView,
} from '../engine/oristudioBpTypes';
import {
  optimizerSymmetryAxisForFold,
  optimizerSymmetryAxisSwapsDimensions,
  type OptimizerSymmetryAxis,
} from './bpOptimizerSymmetry';
import {
  mirrorBpTreeVertexId,
  type BpTreeSymmetryPair,
  type SymmetryFold,
} from './bpTreeSymmetry';
import { bpPackingSheetFrame } from './bpPackingViewport';
import type { SymmetryAxis } from './symmetryGeometry';
import type { Point } from './geometry';

/**
 * Box-Pleating **layout** adapter for symmetry: the mirror as it falls on the
 * paper, rather than on the tree.
 *
 * The tree's mirror line ({@link ./bpTreeSymmetry}) is an authoring aid and is
 * always vertical through the centre of the *tree* sheet. Flaps live on the
 * *layout* sheet, which is a different sheet of a different size, and how the
 * mirror lands there depends on the fold the design was drawn for and on whether
 * the grid is rectangular or diagonal. Reflecting a flap anchor about the tree's
 * axis would reflect about the wrong line.
 *
 * Which flaps pair with which is still resolved on the tree — a flap *is* its
 * dual leaf vertex, and `flap.id === flap.vertexId` — so only the geometry is
 * new here.
 */

/** Match tolerance in grid cells, for "is this flap centred on the axis". */
export const BP_PACKING_SYMMETRY_TOLERANCE = 1e-6;

/** A flap move, as the packing pane and the store already model them. */
export interface BpFlapMove {
  id: number;
  loc: Point;
}

/** The size of a flap's box, which the mirror of its anchor depends on. */
interface FlapBox {
  width: number;
  height: number;
}

/**
 * The centre of the layout sheet, in grid coordinates.
 *
 * Every mirror axis passes through it. Taken from the render frame rather than
 * from `width`/`height` directly so a diagonal sheet — a square placed as a
 * diamond, shifted half a cell on odd sizes — lands on the same centre its
 * geometry is drawn about.
 */
export function bpPackingSheetCenter(sheet: OristudioBpSheet): Point {
  const frame = bpPackingSheetFrame(sheet);
  return {
    x: frame.originX + frame.spanX / 2,
    y: frame.originY + frame.spanY / 2,
  };
}

/**
 * Whether this sheet can be mirrored about this axis at all.
 *
 * A diagonal reflection maps a rectangle onto itself only when it is square. A
 * diagonal sheet is always square (one size input), but a rectangular one has
 * independent width and height, so `book` on a tall sheet resolves to a diagonal
 * axis that has no valid mirror. The UI disables the fold in that case; this
 * exists for the file that was saved square and reopened after a resize.
 */
export function bpPackingSheetSupportsAxis(
  sheet: OristudioBpSheet,
  axis: OptimizerSymmetryAxis
): boolean {
  if (axis === 'verticalHalf' || axis === 'horizontalHalf') return true;
  const frame = bpPackingSheetFrame(sheet);
  return Math.abs(frame.spanX - frame.spanY) <= BP_PACKING_SYMMETRY_TOLERANCE;
}

/** The layout-space axis a design's fold resolves to on this sheet. */
export function bpPackingSymmetryAxis(
  sheet: OristudioBpSheet,
  fold: SymmetryFold
): OptimizerSymmetryAxis {
  return optimizerSymmetryAxisForFold(sheet.kind, fold);
}

/**
 * The mirror of a flap's anchor across the axis, in grid coordinates.
 *
 * A flap's anchor is the **lower-left corner** of its box, not its centre, so
 * mirroring the flap is not the same as mirroring the anchor — the reflected
 * box's lower-left corner picks up the size term, and the diagonals additionally
 * exchange width for height. This is `SymmetryAxis::mirror_grid` in
 * `crates/oristudio-bp/src/optimizer.rs`, rewritten about the sheet centre
 * instead of the kernel's per-axis centred origin; the two agree wherever the
 * kernel's map is defined, and the centre form also covers the axes the kernel
 * measures from a corner.
 */
export function mirrorBpFlapAnchor(
  anchor: Point,
  box: FlapBox,
  center: Point,
  axis: OptimizerSymmetryAxis
): Point {
  const { width, height } = box;
  switch (axis) {
    case 'verticalHalf':
      return { x: 2 * center.x - anchor.x - width, y: anchor.y };
    case 'horizontalHalf':
      return { x: anchor.x, y: 2 * center.y - anchor.y - height };
    case 'mainDiagonal':
      return { x: center.x + (anchor.y - center.y), y: center.y + (anchor.x - center.x) };
    case 'antiDiagonal':
      return {
        x: center.x - (anchor.y - center.y) - height,
        y: center.y - (anchor.x - center.x) - width,
      };
  }
}

/**
 * The nearest anchor that leaves this flap centred on the axis — its own mirror.
 *
 * An on-axis flap is not frozen the way an on-axis *tree vertex* is: a vertex on
 * the mirror line has nothing left to be if it moves off, while a flap still has
 * a free parameter along the axis and a centre flap that could not slide would
 * make symmetric designs unusable. So a drag on one is projected here rather
 * than refused. Matches `SymmetryAxis::axis_point`.
 *
 * The diagonals pin both coordinates of the corner, which is why only a square
 * flap can sit on one — see {@link isBpFlapOnAxis}.
 */
export function projectBpFlapAnchorOntoAxis(
  anchor: Point,
  box: FlapBox,
  center: Point,
  axis: OptimizerSymmetryAxis
): Point {
  const { width, height } = box;
  switch (axis) {
    case 'verticalHalf':
      return { x: center.x - width / 2, y: anchor.y };
    case 'horizontalHalf':
      return { x: anchor.x, y: center.y - height / 2 };
    case 'mainDiagonal': {
      const t = (anchor.x - center.x + (anchor.y - center.y)) / 2;
      return { x: center.x + t, y: center.y + t };
    }
    case 'antiDiagonal': {
      const t = (center.x - height - anchor.x + (anchor.y - center.y)) / 2;
      return { x: center.x - t - height, y: center.y + t };
    }
  }
}

/**
 * Whether a flap is its own mirror: its whole box, not just its anchor, comes
 * back to itself.
 *
 * A diagonal mirror exchanges width for height, so a non-square flap with its
 * corner on a diagonal is *not* self-mirror however its anchor reflects — the
 * reflected box is a quarter turn away. Such a flap is simply unpaired, and the
 * partial-mirror rule lets it move freely rather than pinning it to a line it
 * does not actually sit on.
 */
export function isBpFlapOnAxis(
  anchor: Point,
  box: FlapBox,
  center: Point,
  axis: OptimizerSymmetryAxis,
  tolerance = BP_PACKING_SYMMETRY_TOLERANCE
): boolean {
  if (
    optimizerSymmetryAxisSwapsDimensions(axis) &&
    Math.abs(box.width - box.height) > tolerance
  ) {
    return false;
  }
  const mirrored = mirrorBpFlapAnchor(anchor, box, center, axis);
  return (
    Math.abs(mirrored.x - anchor.x) <= tolerance && Math.abs(mirrored.y - anchor.y) <= tolerance
  );
}

export interface BuildMirroredBpFlapMovesInput {
  tree: OristudioBpTreeView;
  pairs: BpTreeSymmetryPair[];
  /** The tree-space axis, used only to resolve which flap pairs with which. */
  treeAxis: SymmetryAxis;
  sheet: OristudioBpSheet;
  fold: SymmetryFold;
  flaps: readonly OristudioBpFlap[];
  /** Where the gesture is putting the flaps it grabbed. */
  moves: readonly BpFlapMove[];
}

/**
 * The partner moves a primary set of flap moves should carry with it.
 *
 * Partial mirror, like the tree: a flap with no resolvable partner moves alone
 * rather than blocking the gesture, so a partially-symmetric design stays
 * editable. A flap whose partner is itself in the primary set is skipped, so a
 * selection holding both members of a pair translates rigidly and is not written
 * twice.
 *
 * The partner's **target** is mirrored, not the primary's displacement, so a
 * partner that has drifted out of symmetry snaps back on the first drag. Same
 * rule as `buildMirroredBpTreeUpdates`.
 *
 * Returns an empty list when the fold has no valid mirror on this sheet.
 */
export function buildMirroredBpFlapMoves(input: BuildMirroredBpFlapMovesInput): BpFlapMove[] {
  const { tree, pairs, treeAxis, sheet, fold, flaps, moves } = input;
  const axis = bpPackingSymmetryAxis(sheet, fold);
  if (!bpPackingSheetSupportsAxis(sheet, axis)) return [];
  const center = bpPackingSheetCenter(sheet);
  const primaryIds = new Set(moves.map((move) => move.id));
  const emitted = new Set<number>();
  const mirrored: BpFlapMove[] = [];
  for (const { id, loc } of moves) {
    const box = flaps.find((flap) => flap.id === id);
    if (!box) continue;
    const partnerId = mirrorBpTreeVertexId(tree, pairs, treeAxis, id);
    if (partnerId === null || partnerId === id) continue;
    if (primaryIds.has(partnerId) || emitted.has(partnerId)) continue;
    const partner = flaps.find((flap) => flap.id === partnerId);
    if (!partner) continue;
    emitted.add(partnerId);
    mirrored.push({ id: partnerId, loc: mirrorBpFlapAnchor(loc, box, center, axis) });
  }
  return mirrored;
}

/**
 * Where a flap that is its own mirror should go instead of `loc`.
 *
 * Returns `null` when the flap is not on the axis, which reads at the call site
 * as "this move needs no constraining".
 */
export function constrainBpFlapMoveToAxis(
  flap: OristudioBpFlap,
  loc: Point,
  sheet: OristudioBpSheet,
  fold: SymmetryFold
): Point | null {
  const axis = bpPackingSymmetryAxis(sheet, fold);
  if (!bpPackingSheetSupportsAxis(sheet, axis)) return null;
  const center = bpPackingSheetCenter(sheet);
  if (!isBpFlapOnAxis(flap.anchor, flap, center, axis)) return null;
  return projectBpFlapAnchorOntoAxis(loc, flap, center, axis);
}
