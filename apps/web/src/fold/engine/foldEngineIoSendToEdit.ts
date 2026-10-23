/**
 * Send to Edit for a Fold state (plan D10): the FOLD text the engine writes
 * (`FoldEngineIoCalls.sendToEdit`) as the payload Edit's import chokepoint
 * takes, `importAddOristudioCpText` — the path every other Send to Edit uses,
 * with its undo entry and its merge.
 *
 * Fold's precreases are written as unassigned creases remembering their
 * letter, and arrive in Edit as auxiliary lines, always: the payload's
 * `unassignedAsAuxiliary` flag has Edit recolour them after the import, in
 * the same undo entry. Nothing else Fold sends is unassigned, and a partial
 * precrease's marks already go as auxiliary lines.
 *
 * Pure: no React, no store.
 */

import type { SendToEditPayload } from '../../designKinds/types';

export interface FoldSendToEditOptions {
  /** The undo label for the merge, already translated. */
  label: string;
  /** A `.fold` name for the payload; never sent anywhere as analytics. */
  filename: string;
}

export function foldSendToEditPayload(text: string, options: FoldSendToEditOptions): SendToEditPayload {
  return {
    text,
    format: 'fold',
    label: options.label,
    filename: options.filename,
    unassignedAsAuxiliary: true,
  };
}
