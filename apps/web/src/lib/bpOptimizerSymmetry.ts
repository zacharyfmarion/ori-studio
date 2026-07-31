import type { OristudioBpTreeView } from '../engine/oristudioBpTypes';
import { mirrorBpTreeVertexId, type BpTreeSymmetryPair } from './bpTreeSymmetry';
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

const ANGLE_EPSILON = 1e-6;
const DISTANCE_EPSILON = 1e-6;

function normalizeAngle(angle: number): number {
  return ((angle % 180) + 180) % 180;
}

/**
 * The axis an authoring angle denotes, in the optimizer's normalized frame.
 *
 * The angle is the direction of the mirror *line* in layout coordinates, and the
 * layout frame is the grid frame for both sheet types, so this mapping does not
 * depend on the sheet. What *does* depend on the sheet is whether a given axis
 * reads as a book fold or a diagonal fold of the paper — a diagonal-grid sheet is
 * the paper rotated 45 degrees against the grid, so the two swap.
 */
export function optimizerSymmetryAxisForAngle(angle: number): OptimizerSymmetryAxis | null {
  const normalized = normalizeAngle(angle);
  const matches = (target: number) => Math.abs(normalized - target) <= ANGLE_EPSILON;
  if (matches(90)) return 'verticalHalf';
  if (matches(0)) return 'horizontalHalf';
  if (matches(45)) return 'mainDiagonal';
  if (matches(135)) return 'antiDiagonal';
  return null;
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
  /**
   * Whether a flap with no explicitly declared partner may have one inferred from
   * where it currently sits.
   *
   * Only safe in view mode. Inference reads the *current* positions, so it is
   * right when the layout is already roughly symmetric and meaningless when the
   * optimizer is about to discard those positions anyway.
   */
  allowInference: boolean;
}

export function resolveOptimizerSymmetry(
  tree: OristudioBpTreeView,
  symmetry: { enabled: boolean; angle: number; loc: { x: number; y: number }; pairs: BpTreeSymmetryPair[] },
  options: ResolveOptimizerSymmetryOptions
): OptimizerSymmetryResolution {
  if (!symmetry.enabled) {
    return { ok: false, reason: 'Symmetry is not turned on.' };
  }

  const axis = optimizerSymmetryAxisForAngle(symmetry.angle);
  if (!axis) {
    return {
      ok: false,
      reason:
        'The optimizer can only mirror about the four symmetry axes of the sheet, ' +
        'because the sheet has to share the layout’s symmetry. Choose a book or ' +
        'diagonal axis.',
    };
  }
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
    // A pair whose two members are the same flap declares it as sitting on the
    // axis. Without that there would be no way to say so when inference is off,
    // because a flap on the axis has no partner to pair with.
    const explicit = symmetry.pairs.find((pair) => pair.v1 === leaf.id || pair.v2 === leaf.id);
    let mirror: number | null = null;
    if (explicit) {
      mirror = explicit.v1 === leaf.id ? explicit.v2 : explicit.v1;
    } else if (options.allowInference) {
      mirror = mirrorBpTreeVertexId(tree, symmetry.pairs, axisSpec, leaf.id);
    }
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
        `Symmetry does not say what mirrors ${names}. Pair each flap with its ` +
        'mirror, or place it on the axis.',
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

  return {
    ok: true,
    payload: {
      axis,
      partners: [...partner].map(([id, mirror]): [number, number] => [id, mirror]),
    },
    inconsistentPairs,
  };
}
