import type { OristudioBpSheet } from '../engine/oristudioBpTypes';
import {
  bpPackingSheetCenter,
  bpPackingSheetSupportsAxis,
  bpPackingSymmetryAxis,
  isBpFlapOnAxis,
  mirrorBpFlapAnchor,
  projectBpFlapAnchorOntoAxis,
} from './bpPackingSymmetry';
import { bpPackingSheetFrame, constrainBpPackingPoint } from './bpPackingViewport';
import type { BpMirrorOrientation } from './bpTreeSymmetry';
import type { Point } from './geometry';

/**
 * Where a newly drawn leaf's flap starts on the paper.
 *
 * The engine seeds a new flap from the leaf's position at the moment `add_leaf`
 * runs, which is the arbitrary spot `closest_empty_spot` picked and not where the
 * user then drew the leaf. That spot is chosen against *tree node* occupancy, and
 * repositioning the leaf immediately vacates it — so every subsequent add picks
 * the same spot and every new flap lands on the same cell.
 *
 * That path is a faithful port of Box Pleating Studio
 * (`vertexContainer.$addLeaf` → `_findClosestEmptySpot` →
 * `layout.$createFlapPrototype`) and is left alone. This is the additive layer on
 * top: once the leaf is where the user put it, seed its flap from *that*, and
 * seed its mirror partner's from the reflection of where the first one landed.
 */

/**
 * A flap is created empty, so its box contributes nothing to the mirror. Named
 * rather than inlined because the mirror map's size terms are the easiest part of
 * it to get wrong, and a bare `0` at the call site hides which term is vanishing.
 */
const NEW_FLAP_BOX = { width: 0, height: 0 };

/**
 * A point in the tree sheet, expressed in the layout sheet.
 *
 * The two sheets are different sizes, so this is a proportional map and not a
 * copy. Port of `relative_layout_point` in
 * `crates/oristudio-bp/src/engine/project_session.rs`, which is upstream's
 * `getRelativePoint` — the same map the engine already uses when it seeds a flap,
 * so a leaf seeded here lands where the engine would have put it had it known the
 * final position.
 */
export function bpTreePointToLayoutPoint(
  point: Point,
  treeSheet: OristudioBpSheet,
  layoutSheet: OristudioBpSheet,
): Point {
  const from = bpPackingSheetFrame(treeSheet);
  const to = bpPackingSheetFrame(layoutSheet);
  if (from.spanX === 0 || from.spanY === 0) return point;
  return constrainBpPackingPoint(
    {
      x: Math.round((point.x * to.spanX) / from.spanX),
      y: Math.round((point.y * to.spanY) / from.spanY),
    },
    layoutSheet,
  );
}

export interface BpFlapSeedInput {
  treeLoc: Point;
  treeSheet: OristudioBpSheet;
  layoutSheet: OristudioBpSheet;
  /** Where the design's mirror falls on the paper, or null when mirror draw is off. */
  mirror: BpMirrorOrientation | null;
  /**
   * Whether the leaf is its own mirror — drawn on the tree's mirror line.
   *
   * Such a leaf must land on the *paper's* mirror, which is not the image of the
   * tree's under this map: the tree's line is always vertical, while a diagonal
   * fold puts the paper's at 45°. Projecting fixes the mismatch; under a book
   * fold on a rectangular sheet the projection is already a no-op.
   */
  selfMirrored: boolean;
}

/** Where a newly drawn leaf's own flap should start. */
export function seedBpFlapAnchor(input: BpFlapSeedInput): Point {
  const { treeLoc, treeSheet, layoutSheet, mirror, selfMirrored } = input;
  const anchor = bpTreePointToLayoutPoint(treeLoc, treeSheet, layoutSheet);
  if (!selfMirrored || mirror === null) return anchor;
  const axis = bpPackingSymmetryAxis(layoutSheet, mirror);
  if (!bpPackingSheetSupportsAxis(layoutSheet, axis)) return anchor;
  const center = bpPackingSheetCenter(layoutSheet);
  if (isBpFlapOnAxis(anchor, NEW_FLAP_BOX, center, axis)) return anchor;
  return constrainBpPackingPoint(
    projectBpFlapAnchorOntoAxis(anchor, NEW_FLAP_BOX, center, axis),
    layoutSheet,
  );
}

/**
 * Where the mirror partner's flap should start, given where the primary's
 * actually landed.
 *
 * Derived from the primary rather than mapped independently from the partner's
 * own tree position: the map rounds, and two positions that are exact mirrors in
 * the tree can round to positions that are not. Reflecting the answer instead of
 * computing it twice makes the pair symmetric by construction rather than by
 * rounding luck.
 *
 * Null when the fold has no mirror on this sheet — the partner then keeps
 * whatever the engine gave it, which is the same partial-mirror rule the move
 * path follows.
 */
export function seedBpPartnerFlapAnchor(
  primaryAnchor: Point,
  layoutSheet: OristudioBpSheet,
  mirror: BpMirrorOrientation,
): Point | null {
  const axis = bpPackingSymmetryAxis(layoutSheet, mirror);
  if (!bpPackingSheetSupportsAxis(layoutSheet, axis)) return null;
  return mirrorBpFlapAnchor(primaryAnchor, NEW_FLAP_BOX, bpPackingSheetCenter(layoutSheet), axis);
}
