import type { OristudioBpSheetKind, OristudioBpTreeView } from '../engine/oristudioBpTypes';
import {
  mirrorBpTreeVertexId,
  type BpTreeSymmetryPair,
  type SymmetryFold,
} from './bpTreeSymmetry';
import { isPaperCenter } from './symmetryPresets';
import type { SymmetryAxis } from './symmetryGeometry';

/**
 * Turns the BP tree's symmetry-authoring state into the payload the optimizer
 * takes, or explains why it cannot.
 *
 * The optimizer needs two things the authoring state does not directly hold:
 *
 * - **One of four axes.** The optimizer works in a normalized unit sheet, so the
 *   only axes it can honour are the four symmetry axes of the square through the
 *   sheet centre — the sheet has to share the layout's symmetry, and the sheet
 *   size is one of the variables being solved for. Any other angle, or an
 *   off-centre axis, is rejected.
 * - **A total involution over the flaps.** Every flap must either pair with
 *   exactly one other flap or sit on the axis. A flap that resolves to neither is
 *   named rather than quietly assumed to be on the axis, which would silently
 *   optimize a layout the user did not ask for.
 */

/** Matches the kernel's `SymmetryAxis`, named for the normalized unit sheet. */
export type OptimizerSymmetryAxis =
  | 'verticalHalf'
  | 'horizontalHalf'
  | 'mainDiagonal'
  | 'antiDiagonal';

export interface OptimizerSymmetryPayload {
  axis: OptimizerSymmetryAxis;
  /** `[flap id, mirror partner id]` for every flap. */
  partners: [number, number][];
  /**
   * Flap ids drawn on the left of the tree's mirror line.
   *
   * A mirror pair occupies two mirrored positions and which member takes which
   * is free as far as the packing goes, so the solver settles it arbitrarily —
   * in random mode differently per pair per run, which reads as flaps swapping
   * sides. This carries the drawing's answer; the kernel honours it after
   * solving, and only where the exchange leaves the layout valid.
   */
  negativeSide: number[];
}

export interface OptimizerSymmetryResolved {
  ok: true;
  payload: OptimizerSymmetryPayload;
  /**
   * Pairs whose members are not interchangeable in the tree. Such a pairing is
   * still a legal mirror — symmetry is a purely geometric constraint — but every
   * mismatched distance binds at the larger of the two, so it costs paper.
   */
  inconsistentPairs: [number, number][];
}

export interface OptimizerSymmetryRejected {
  ok: false;
  reason: string;
}

export type OptimizerSymmetryResolution = OptimizerSymmetryResolved | OptimizerSymmetryRejected;

export type { SymmetryFold } from './bpTreeSymmetry';

const DISTANCE_EPSILON = 1e-6;

/**
 * Where a fold falls in the optimizer's normalized frame.
 *
 * This is the only place the sheet matters. A diagonal-grid sheet is the paper
 * turned 45 degrees against the grid, so its corners point along the grid axes:
 * a corner-to-corner fold runs *along* a grid line there, while on a rectangular
 * sheet it cuts across at 45 degrees. The two therefore swap.
 *
 * Each fold has a second variant — the other book fold, the other diagonal — but
 * they are the same problem rotated a quarter turn, so only one is offered.
 */
export function optimizerSymmetryAxisForFold(
  sheetKind: OristudioBpSheetKind,
  fold: SymmetryFold
): OptimizerSymmetryAxis {
  const alongGrid = sheetKind === 'diagonal' ? fold === 'diagonal' : fold === 'book';
  return alongGrid ? 'verticalHalf' : 'mainDiagonal';
}

/**
 * Whether the mirror exchanges a flap's width and height.
 *
 * A reflection across a vertical line leaves a rectangle's extents alone; one
 * across a diagonal turns the rectangle a quarter turn, so the partner's width
 * is this flap's height. Mirrors `SymmetryAxis::swaps_dimensions` in
 * `crates/oristudio-bp/src/optimizer.rs`, which is what actually rejects a pair
 * whose boxes are not mirror images.
 */
export function optimizerSymmetryAxisSwapsDimensions(axis: OptimizerSymmetryAxis): boolean {
  return axis === 'mainDiagonal' || axis === 'antiDiagonal';
}

/** Tree distance between every pair of leaves, keyed `min,max`. */
function leafDistances(tree: OristudioBpTreeView): Map<string, number> {
  const neighbours = new Map<number, { id: number; length: number }[]>();
  for (const edge of tree.edges ?? []) {
    const [a, b] = edge.vertices;
    if (!neighbours.has(a)) neighbours.set(a, []);
    if (!neighbours.has(b)) neighbours.set(b, []);
    neighbours.get(a)!.push({ id: b, length: edge.length });
    neighbours.get(b)!.push({ id: a, length: edge.length });
  }
  const leaves = (tree.vertices ?? []).filter((vertex) => vertex.isLeaf).map((vertex) => vertex.id);
  const distances = new Map<string, number>();
  for (const source of leaves) {
    // The tree is small and this runs once per optimizer run, so a plain
    // breadth-first walk per leaf is cheaper than maintaining an LCA structure.
    const seen = new Map<number, number>([[source, 0]]);
    const queue = [source];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of neighbours.get(current) ?? []) {
        if (seen.has(next.id)) continue;
        seen.set(next.id, seen.get(current)! + next.length);
        queue.push(next.id);
      }
    }
    for (const target of leaves) {
      if (target <= source) continue;
      distances.set(`${source},${target}`, seen.get(target) ?? Number.POSITIVE_INFINITY);
    }
  }
  return distances;
}

function distanceKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

export interface ResolveOptimizerSymmetryOptions {
  /** Which fold of the paper the layout should be mirrored about. */
  fold: SymmetryFold;
}

export function resolveOptimizerSymmetry(
  tree: OristudioBpTreeView,
  symmetry: { enabled: boolean; angle: number; loc: { x: number; y: number }; pairs: BpTreeSymmetryPair[] },
  options: ResolveOptimizerSymmetryOptions
): OptimizerSymmetryResolution {
  if (!symmetry.enabled) {
    return { ok: false, reason: 'Symmetry is not turned on.' };
  }

  // The tree's own mirror line is an authoring aid and is always vertical — a
  // tree is not drawn on the paper. Which fold of the paper that mirror becomes
  // is a separate choice, made per run.
  const axis = optimizerSymmetryAxisForFold(tree.sheet.kind, options.fold);
  if (!isPaperCenter(symmetry.loc, tree.sheet.width, tree.sheet.height)) {
    return {
      ok: false,
      reason:
        'The symmetry axis must pass through the centre of the sheet for the ' +
        'optimizer to keep the sheet symmetric.',
    };
  }

  const leaves = (tree.vertices ?? []).filter((vertex) => vertex.isLeaf);
  const leafIds = new Set(leaves.map((vertex) => vertex.id));
  const axisSpec: SymmetryAxis = { loc: symmetry.loc, angle: symmetry.angle };

  const partner = new Map<number, number>();
  const unresolved: number[] = [];
  for (const leaf of leaves) {
    // Read from the tree drawing: a flap drawn with mirror-draw carries an
    // explicit pair, and one drawn on the mirror line is its own mirror.
    //
    // This holds whichever layout method the run uses. Random mode discards the
    // *packing*, not the tree, so the drawing is just as good a statement of
    // intent there as it is in view mode.
    const mirror = mirrorBpTreeVertexId(tree, symmetry.pairs, axisSpec, leaf.id);
    if (mirror == null || !leafIds.has(mirror)) {
      unresolved.push(leaf.id);
      continue;
    }
    partner.set(leaf.id, mirror);
  }

  if (unresolved.length > 0) {
    const names = unresolved
      .map((id) => leaves.find((vertex) => vertex.id === id)?.name || String(id))
      .join(', ');
    return {
      ok: false,
      reason:
        `Nothing mirrors ${names}. Draw each flap with mirror draw on so it gets ` +
        'a partner, or move it onto the mirror line.',
    };
  }

  for (const [id, mirror] of partner) {
    if (partner.get(mirror) !== id) {
      return {
        ok: false,
        reason:
          'The pairing is not a mirror: some flaps do not pair back to each other. ' +
          'Every flap must pair with exactly one other flap, or with itself on the axis.',
      };
    }
  }

  // A pairing that is not a tree automorphism is still a legal mirror, but every
  // mismatched distance binds at the larger of the two and costs paper.
  const distances = leafDistances(tree);
  const inconsistentPairs: [number, number][] = [];
  const reported = new Set<string>();
  for (const [a, mirrorA] of partner) {
    for (const [b, mirrorB] of partner) {
      if (b <= a) continue;
      const direct = distances.get(distanceKey(a, b));
      const mirrored = distances.get(distanceKey(mirrorA, mirrorB));
      if (direct == null || mirrored == null) continue;
      if (Math.abs(direct - mirrored) <= DISTANCE_EPSILON) continue;
      const key = distanceKey(a, b);
      if (reported.has(key)) continue;
      reported.add(key);
      inconsistentPairs.push([a, b]);
    }
  }

  // Which member of each pair the user drew on the left. The tree's mirror is
  // always vertical, so "left" is simply a smaller x; where that lands on the
  // paper is the fold's business, and all that matters is that it is consistent.
  const negativeSide: number[] = [];
  for (const vertex of tree.vertices) {
    const mirror = partner.get(vertex.id);
    if (mirror === undefined || mirror === vertex.id) continue;
    if (vertex.loc.x < symmetry.loc.x) negativeSide.push(vertex.id);
  }

  return {
    ok: true,
    payload: {
      axis,
      partners: [...partner].map(([id, mirror]): [number, number] => [id, mirror]),
      negativeSide,
    },
    inconsistentPairs,
  };
}
