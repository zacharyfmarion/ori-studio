/**
 * Is this the tool the editor rests in?
 *
 * Escape deactivates whatever tool is running, and the panel then re-selects
 * {@link DEFAULT_ORISTUDIO_CP_ACTION_ID} — so the resting tool is where every
 * cancelled gesture, and every fresh document, ends up. Today that is Box
 * Select.
 *
 * The tool hint window uses this to stay shut. A hint that is on screen most of
 * the time is not a hint, and the one the resting tool has to offer ("drag a box
 * to select") is the thing nobody needs told.
 *
 * Read from the constant rather than hard-coding `CreaseSelect`, so that
 * changing which tool is the default moves this with it.
 */
import {
  DEFAULT_ORISTUDIO_CP_ACTION_ID,
  cpActionById,
  type OristudioCpActionDefinition,
} from '../../lib/oristudioCpActions';
import type { OristudioCpCommandDefinition } from '../../lib/oristudioCpCommands';

export function isRestingCpTool(
  action: OristudioCpActionDefinition | undefined,
  command: OristudioCpCommandDefinition
): boolean {
  if (action?.id === DEFAULT_ORISTUDIO_CP_ACTION_ID) return true;
  // The rail sets an action, but other routes activate a command directly and
  // leave `activeActionId` null. Matching on the operation too means the window
  // does not reappear depending on how the resting tool was reached.
  const resting = cpActionById(DEFAULT_ORISTUDIO_CP_ACTION_ID);
  return resting?.kind === 'command' && resting.command.operationId === command.operationId;
}
