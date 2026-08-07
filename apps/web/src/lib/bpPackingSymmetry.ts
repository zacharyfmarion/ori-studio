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
import { bpPackingSheetFrame, snapBpPackingAnchorToGrid } from './bpPackingViewport';
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

/**
 * The axis normal, unit length, pointing at its positive side.
 *
 * Directions match `SymmetryAxis::grid_normal` in
 * `crates/oristudio-bp/src/optimizer.rs`; normalized here because this one is
 * used to measure distances rather than to compare a sign.
 */
function axisUnitNormal(axis: OptimizerSymmetryAxis): Point {
  const diagonal = Math.SQRT1_2;
  switch (axis) {
    case 'verticalHalf':
      return { x: 1, y: 0 };
    case 'horizontalHalf':
      return { x: 0, y: 1 };
    case 'mainDiagonal':
      return { x: diagonal, y: -diagonal };
    case 'antiDiagonal':
      return { x: diagonal, y: diagonal };
  }
}

/** How far the box's nearest and furthest corners sit from the axis, signed. */
export function bpFlapAxisSpan(
  anchor: Point,
  box: FlapBox,
  center: Point,
  axis: OptimizerSymmetryAxis
): { min: number; max: number } {
  const normal = axisUnitNormal(axis);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const corner of [
    anchor,
    { x: anchor.x + box.width, y: anchor.y },
    { x: anchor.x, y: anchor.y + box.height },
    { x: anchor.x + box.width, y: anchor.y + box.height },
  ]) {
    const distance = (corner.x - center.x) * normal.x + (corner.y - center.y) * normal.y;
    min = Math.min(min, distance);
    max = Math.max(max, distance);
  }
  return { min, max };
}

/**
 * Which half of the paper the whole box sits in, or 0 when it straddles the
 * mirror.
 *
 * A box that merely touches the axis counts as being on its own side, so a flap
 * pushed right up against the mirror by an earlier drag step does not read as
 * straddling on the next one and get released.
 */
export function bpFlapAxisSide(
  anchor: Point,
  box: FlapBox,
  center: Point,
  axis: OptimizerSymmetryAxis,
  tolerance = BP_PACKING_SYMMETRY_TOLERANCE
): -1 | 0 | 1 {
  const { min, max } = bpFlapAxisSpan(anchor, box, center, axis);
  if (min >= -tolerance) return 1;
  if (max <= tolerance) return -1;
  return 0;
}

/**
 * The smallest displacement *along the axis normal* that takes a flap from one
 * grid position to another.
 *
 * The clamp only ever corrects across the mirror, so this is the quantum it has
 * to work in. For the perpendicular axes the normal is a grid direction and the
 * quantum is one cell. For the diagonals it is `interval · √2`, not
 * `interval / √2`: the nearest lattice point to a diagonal does sit `1/√2` from
 * it, but reaching it needs a step *along* the axis as well, which a normal-only
 * correction has no way to make. `√2` along the normal is the (1, -1) move — the
 * shortest purely perpendicular hop the lattice has.
 */
function axisNormalStep(sheet: OristudioBpSheet, axis: OptimizerSymmetryAxis): number {
  const interval = Math.max(sheet.grid.interval, 0);
  return optimizerSymmetryAxisSwapsDimensions(axis) ? interval * Math.SQRT2 : interval;
}

/**
 * The smallest displacement along the axis normal that leaves this flap clear of
 * the mirror, in whole grid cells.
 *
 * The BP kernel requires flap coordinates on the grid: an off-grid flap makes the
 * junction overlap fractional, which `single_overlap_devices` rejects outright
 * and which takes the *whole* layout snapshot down with it, not just that gadget.
 * So the stopping position cannot be chosen as a distance and assumed to exist —
 * it has to be solved in the steps the grid actually offers. Doing it that way
 * also removes the sheet-parity special case: a centre that falls on a grid line
 * stops a full cell out, a centre that falls between two stops half a cell out,
 * and neither is written down anywhere.
 *
 * `distance` is the flap's near edge, signed along the normal and positive on the
 * flap's own side. `strict` distinguishes the two cases the mirror has: a box
 * with extent across the axis may rest its near edge *on* the line, because the
 * box still lies wholly on its own side and only touches its reflection, while a
 * box with none — a unit leaf's flap is 0×0 — may not, because a point on the
 * line *is* its own reflection and the pair becomes two flaps at one spot.
 */
function stepsToClearAxis(
  distance: number,
  step: number,
  strict: boolean,
  tolerance: number
): number {
  // A degenerate sheet has no grid to land on; fall back to the bare geometry,
  // which puts the near edge on the line.
  if (step <= 0) return -distance;
  const steps = -distance / step;
  const whole = strict
    ? Math.floor(steps + tolerance) + 1
    : Math.ceil(steps - tolerance);
  return whole * step;
}

export interface ConstrainBpFlapGroupInput {
  /** The flaps the gesture moves. The first is the one `target` refers to. */
  moving: readonly OristudioBpFlap[];
  /** Where the gesture wants to put the first flap's anchor. */
  target: Point;
  sheet: OristudioBpSheet;
  fold: SymmetryFold;
  /** Flaps that have a mirror partner, and so may not cross to its half. */
  pairedIds: ReadonlySet<number>;
}

/**
 * Hold a paired flap in its own half of the paper.
 *
 * A flap and its partner occupy reflected positions, so a box that crosses the
 * mirror overlaps its own reflection — not a tight packing but an impossible
 * one. The gesture is not refused: only the component of the move along the axis
 * normal is clamped, so the flap slides up against the mirror and keeps moving
 * freely along it.
 *
 * A group moves by one shared translation, so the clamp is the intersection of
 * every paired member's limit. Members that straddle the axis already (loaded
 * that way, or left there by a resize) are left out rather than snapped, and
 * unpaired members never constrain anything.
 */
export function constrainBpFlapGroupToAxisSides(input: ConstrainBpFlapGroupInput): Point {
  const { moving, target, sheet, fold, pairedIds } = input;
  const reference = moving[0];
  if (!reference) return target;
  const axis = bpPackingSymmetryAxis(sheet, fold);
  if (!bpPackingSheetSupportsAxis(sheet, axis)) return target;
  const center = bpPackingSheetCenter(sheet);
  const normal = axisUnitNormal(axis);
  const vector = { x: target.x - reference.anchor.x, y: target.y - reference.anchor.y };
  const along = vector.x * normal.x + vector.y * normal.y;

  const step = axisNormalStep(sheet, axis);

  let lower = Number.NEGATIVE_INFINITY;
  let upper = Number.POSITIVE_INFINITY;
  for (const flap of moving) {
    if (!pairedIds.has(flap.id)) continue;
    const side = bpFlapAxisSide(flap.anchor, flap, center, axis);
    if (side === 0) continue;
    const { min, max } = bpFlapAxisSpan(flap.anchor, flap, center, axis);
    // A flap with no extent across the mirror may not come to rest on it.
    const strict = max - min <= BP_PACKING_SYMMETRY_TOLERANCE;
    // The negative side is the positive one reflected, so solve it in the
    // reflected frame and flip the answer back rather than restating the algebra.
    if (side > 0) {
      lower = Math.max(lower, stepsToClearAxis(min, step, strict, BP_PACKING_SYMMETRY_TOLERANCE));
    } else {
      upper = Math.min(upper, -stepsToClearAxis(-max, step, strict, BP_PACKING_SYMMETRY_TOLERANCE));
    }
  }
  // Every constrained member is currently valid, so 0 always satisfies both
  // bounds and a group spanning both halves simply cannot move across.
  const clamped = Math.min(Math.max(along, lower), upper);
  if (clamped === along) return target;
  const correction = clamped - along;
  // Snapped because the correction is *ours*: having decided to move the flap,
  // we own where it lands, and the kernel accepts only exact grid coordinates.
  // The bound is already a whole number of grid steps, so this closes a rounding
  // gap of ~1e-15 (a diagonal correction routes through √2 · √½, which is not
  // exactly 1) rather than doing any real moving.
  return snapBpPackingAnchorToGrid(
    { x: target.x + correction * normal.x, y: target.y + correction * normal.y },
    sheet
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
 * **Whether it is its own mirror is the caller's answer, not this function's.**
 * Asking the geometry — is this box centred on the line? — pins any flap that
 * merely happens to be sitting there, including one with a distinct partner and
 * one with no partner at all, and a pinned flap cannot be dragged off again. A
 * flap is its own mirror because its tree vertex is, which is a fact about the
 * pairing.
 *
 * Returns `null` when the fold has no mirror on this sheet.
 */
export function constrainBpFlapMoveToAxis(
  flap: OristudioBpFlap,
  loc: Point,
  sheet: OristudioBpSheet,
  fold: SymmetryFold
): Point | null {
  const axis = bpPackingSymmetryAxis(sheet, fold);
  if (!bpPackingSheetSupportsAxis(sheet, axis)) return null;
  return projectBpFlapAnchorOntoAxis(loc, flap, bpPackingSheetCenter(sheet), axis);
}
