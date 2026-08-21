/**
 * Which row of the viewport's top lane the diagnostic HUD sits in.
 *
 * Two surfaces are pinned to the top of the crease-pattern viewport: the tool
 * hint's status readout on the left (zoom, step prompt, line type, counts) and
 * this HUD on the right. Both are absolutely positioned siblings, and for a long
 * time the only thing keeping them apart was that their stylesheet `top` values
 * sat at opposite horizontal ends of a desktop-width pane. Nothing expressed the
 * relationship, so nothing enforced it: both boxes are sized by their content,
 * so on a narrow pane the readout's right edge reaches past the HUD's left one
 * and the two draw straight through each other, interleaving the step prompt
 * with the foldability headline. Which width that happens at is a fact about the
 * two strings, not about the pane — a long step prompt does it sooner, and so
 * does a headline wide enough to push the HUD out to its 360px cap — which is
 * why the rule below measures rather than naming a breakpoint.
 *
 * So the lane has one rule rather than two constants that must be kept apart by
 * hand. The readout owns the top row — it is always present, and it is the
 * leftmost thing in the pane — and the HUD sits beside it while there is room and
 * drops to the row below when there is not.
 *
 * The rule returns `null` for the beside case rather than the HUD's own inset.
 * The stylesheet already states that inset (`--space-4`), and a second copy of it
 * here is the same bug one level down: at every width where the two clear each
 * other, nothing is written to the element at all and the stylesheet is still the
 * only thing deciding where the HUD sits.
 */

/**
 * Vertical gap between the lane's two rows, and the horizontal clearance the two
 * surfaces must keep. `--space-2`, matching the gap inside the readout itself.
 */
export const CP_HUD_LANE_GAP = 8;

/**
 * A box in the lane, in CSS px from the viewport's top-left — the same origin
 * the HUD's own `top` is measured from.
 */
export interface CpHudLaneBox {
  left: number;
  right: number;
  bottom: number;
}

/**
 * The HUD's `top`, or `null` to leave the stylesheet's own value in place.
 *
 * `hud` needs only its left edge: dropping a row never moves the HUD sideways,
 * so the test cannot feed back into its own input and the placement settles in
 * one pass.
 */
export function cpDiagnosticHudLaneTop(
  hud: { left: number },
  readout: CpHudLaneBox | null | undefined
): number | null {
  if (!readout) return null;
  // A readout that has not been laid out yet measures as a zero box at the
  // origin, which would read as an overlap and drop the HUD for nothing.
  if (readout.right <= readout.left) return null;
  const clears = hud.left >= readout.right + CP_HUD_LANE_GAP;
  return clears ? null : readout.bottom + CP_HUD_LANE_GAP;
}
