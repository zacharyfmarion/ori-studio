import { useEffect, useMemo } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { locateSheet } from './referencesReaderState';
import type { SheetAnalysis } from './sheetFrames';

/**
 * The sheet a reopened project was saved on, once the frames analysis can say
 * which component it is now; null when there is none to place, or it is not
 * there any more.
 *
 * Returned during render rather than only written to the store: the panel
 * resolves its sheet from it in the same render, so the auto-plan that fires
 * as the frames land plans the restored sheet and never the fallback. The
 * store is told after, which ends the restore (`commitReferencesRestoredSheet`).
 *
 * `frames` must be the current revision's — `useReferencesTarget` hands out
 * nothing else.
 */
export function useReferencesRestoredSheet(frames: SheetAnalysis | null): number | null {
  const pending = useWorkspaceStore((state) =>
    state.referencesRestore?.loadSerial === state.oristudioCpDocument?.loadSerial
      ? (state.referencesRestore?.sheet ?? null)
      : null
  );
  const commit = useWorkspaceStore((state) => state.commitReferencesRestoredSheet);
  const resolved = useMemo(
    () => (pending && frames ? locateSheet(frames, pending) : null),
    [pending, frames]
  );
  useEffect(() => {
    if (pending && frames) commit(resolved);
  }, [pending, frames, resolved, commit]);
  return resolved;
}
