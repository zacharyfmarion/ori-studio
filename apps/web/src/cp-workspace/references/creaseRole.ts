/**
 * What a crease of the document is on the paper, read off its colour.
 *
 * The kernel's own FOLD reading (`fold_assignment_for_line_color`): black is
 * the paper's edge, red and blue the folds, cyan through grey the aux lines
 * it exports as `F`, and anything else a crease with no direction. A crease
 * folded to an angle takes its hinted direction. One reading for every
 * References picture of a raw pattern — the rail's card and the big view —
 * so they cannot disagree, and the Simulate card reads the same roles off
 * the FOLD (`sheets/segmentSheet`).
 *
 * Read from the raw number rather than through `lineColorName`, which throws on
 * a code outside its table: a picture that cannot read a colour should draw an
 * unassigned line, not take the workspace down. The planner's own steps do not
 * come through here — the crate settles their direction and `Step` carries it
 * (plan D24).
 */
import { SEG_ATTR_STRIDE } from '../../engine/oristudioCpGeometry';
import { HINT_MOUNTAIN, HINT_VALLEY } from '../../lib/foldAngle';
import type { SheetStrokeRole } from '../sheets/sheetThumbnail';

/** Oriedita's colour codes, as `LINE_COLOR_BY_NUMBER` names them. */
const CP_ANGLE = -2;
const CP_BLACK = 0;
const CP_MOUNTAIN = 1;
const CP_VALLEY = 2;
const CP_CYAN = 3;
const CP_GREY = 10;

/** The role of crease `index` (0-based) in `segAttr`. */
export function creaseRoleAt(attr: Int32Array, index: number): SheetStrokeRole {
  // An unreadable slot is no colour at all, and falls through to unassigned.
  const color = attr[index * SEG_ATTR_STRIDE] ?? Number.NaN;
  if (color === CP_BLACK) return 'edge';
  if (color === CP_MOUNTAIN) return 'mountain';
  if (color === CP_VALLEY) return 'valley';
  if (color >= CP_CYAN && color <= CP_GREY) return 'aux';
  if (color === CP_ANGLE) {
    const hint = attr[index * SEG_ATTR_STRIDE + 4];
    if (hint === HINT_MOUNTAIN) return 'mountain';
    if (hint === HINT_VALLEY) return 'valley';
  }
  return 'unassigned';
}
