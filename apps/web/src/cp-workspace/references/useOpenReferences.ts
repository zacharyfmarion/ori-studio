import { useCallback } from 'react';
import { cpLineSegmentCount } from '../../engine/oristudioCpGeometry';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import { useWorkspaceStore } from '../../store/workspaceStore';

/**
 * Whether a resolved segment is the whole crease pattern rather than one
 * bordered region of it.
 *
 * The selection toolbar offers References only then: the workspace opens on the
 * whole pattern and nothing carries over, so a button on a partial selection
 * would promise a scope it does not deliver. Compared by count, which is enough
 * because a segment's `cpLineIds` are distinct ids drawn from the document's
 * lines — equal counts means every line.
 */
export function selectionCoversEntireCp(
  match: { cpLineIds: readonly number[] } | null,
  cpDocument: OristudioCpDocumentSnapshot | null
): boolean {
  if (!match || !cpDocument) return false;
  return match.cpLineIds.length === cpLineSegmentCount(cpDocument);
}

/**
 * Open the References workspace on the whole pattern.
 *
 * In the `useSimulateSelection` shape so the selection toolbar wires it the way
 * it wires its siblings. Unlike that hook it has no failure path: the store
 * action only switches workspace, and the panel itself says when there is no
 * crease pattern to read.
 */
export function useOpenReferences(): () => void {
  const openReferencesWorkspace = useWorkspaceStore((state) => state.openReferencesWorkspace);
  return useCallback(() => {
    openReferencesWorkspace();
  }, [openReferencesWorkspace]);
}
