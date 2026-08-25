/**
 * Which tool a button standing in for "the active tool" should draw.
 *
 * Pure, and separate from the button, because the answer has three cases and
 * only one of them is the obvious one.
 */
import {
  cpActionByOperation,
  cpActionById,
  DEFAULT_ORISTUDIO_CP_ACTION_ID,
  type OristudioCpActionDefinition,
  type OristudioCpActionId,
} from '../../lib/oristudioCpActions';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';

export interface ActiveCpToolGlyph {
  action: OristudioCpActionDefinition;
  /**
   * The variant to draw, when the active tool is a merged one. Passed straight
   * to `CpToolGlyph`, which prefers it over the action's own operation.
   */
  glyphOperationId: OristudioCpOperationId | null;
}

/**
 * Resolve the glyph for the tool the canvas is currently armed with.
 *
 * 1. An `activeActionId` is the rail's answer, and the active operation rides
 *    along so a merged tool (Extend Line, Divided Line) draws the variant its
 *    mode names — the same rule `CpToolRail` applies to its own buttons.
 * 2. A command reached by shortcut, menu or action request leaves
 *    `activeActionId` null and sets only the operation, so it is matched on the
 *    operation. `toolHint/restingTool` documents this asymmetry and handles it
 *    the same way, for the same reason: a tool should not read differently
 *    depending on how it was reached.
 * 3. Neither is set — nothing armed yet, or Escape has just deactivated — so it
 *    draws the resting tool, which is where the panel puts itself and therefore
 *    what the next tap on the canvas will actually do. A neutral icon here would
 *    be a lie by omission: the canvas is armed with Box Select regardless.
 */
export function activeCpToolGlyph(
  activeActionId: OristudioCpActionId | null,
  activeOperationId: OristudioCpOperationId | null
): ActiveCpToolGlyph | null {
  if (activeActionId) {
    const action = cpActionById(activeActionId);
    if (action) return { action, glyphOperationId: activeOperationId };
  }

  if (activeOperationId) {
    const action = cpActionByOperation(activeOperationId);
    if (action) return { action, glyphOperationId: activeOperationId };
  }

  const resting = cpActionById(DEFAULT_ORISTUDIO_CP_ACTION_ID);
  return resting ? { action: resting, glyphOperationId: null } : null;
}
