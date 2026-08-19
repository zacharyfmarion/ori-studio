/**
 * A crease-picking tool starts from an empty selection.
 *
 * Its picks render in the *selection* style — that is how a picked crease reads
 * as picked — so a selection left over from before is visually
 * indistinguishable from a pick while counting for nothing: the tool builds its
 * own set and the document's is ignored. Clearing removes the only state that
 * can look like an input without being one.
 *
 * Lives beside {@link cpInputModel} because that registry is what *defines* a
 * crease-picking tool, and this is a rule about that category rather than about
 * any one tool. Scoped to `line-entity` on purpose: tools that operate *on* the
 * selection must obviously not clear it, and point-sequence tools never confuse
 * the two because their input is a point.
 */
import { useEffect } from 'react';

import { useWorkspaceStore } from '../../store/workspaceStore/store';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { cpInputModel } from './inputModelRegistry';

export function usePickToolSelectionReset(
  activeOperationId: OristudioCpOperationId | undefined,
): void {
  const clearSelection = useWorkspaceStore((state) => state.clearOristudioCpSelection);
  useEffect(() => {
    if (cpInputModel(activeOperationId)?.model !== 'line-entity') return;
    clearSelection();
  }, [activeOperationId, clearSelection]);
}
