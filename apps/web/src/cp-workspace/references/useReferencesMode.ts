import { useCallback, useEffect, useRef } from 'react';
import { ANALYTICS_EVENTS, track } from '../../analytics';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { ReferencesMode } from './referencesMode';

/**
 * The workspace's mode, bound to the store (AGENTS.md > Panel components:
 * store bindings for one concern live in a `use*` hook beside its modules).
 *
 * Two rules live here rather than in the panel. **A new document lands in
 * Find**: the mode is where the reader is, and a different pattern is a
 * different place to be, so the load serial (`framingKey`) resets it the way
 * it refits the camera. **Leaving Find clears the pick**: a target belongs to
 * Find — the sequence has no picked vertex — while the plan belongs to the
 * pattern and survives a switch either way, so coming back to Sequence costs
 * nothing.
 */
/** What switched the mode: the tab itself, or the lead's line under it. */
export type ReferencesModeSource = 'tab' | 'lead';

export interface ReferencesModeController {
  mode: ReferencesMode;
  setMode: (mode: ReferencesMode, source?: ReferencesModeSource) => void;
}

export function useReferencesMode(
  /** Refit-on-new-document key from `useReferencesView`. */
  framingKey: string,
  /** Whether a vertex or crease is picked — there is something to clear. */
  hasPick: boolean,
  /**
   * The target controller's `clear`, run when Find is left with a pick. Only
   * then: it also ends whatever run the registry holds, and with nothing
   * picked that is the sequence's own plan, which a switch away and back
   * would otherwise leave computing with its status reset to idle.
   */
  clearPick: () => void
): ReferencesModeController {
  const mode = useWorkspaceStore((state) => state.referencesView.mode);
  const setReferencesView = useWorkspaceStore((state) => state.setReferencesView);

  // Through refs, so the effect below keys on the document alone and the
  // callback closes over nothing that changes identity per render.
  const clearRef = useRef(clearPick);
  const hasPickRef = useRef(hasPick);
  const modeRef = useRef(mode);
  useEffect(() => {
    clearRef.current = clearPick;
    hasPickRef.current = hasPick;
    modeRef.current = mode;
  });

  // A new document: back to Find. Skipped on mount — the mode the store
  // already holds is the reader's, and remounting the panel (every workspace
  // switch rebuilds the dock) is not a new document.
  const seen = useRef(framingKey);
  useEffect(() => {
    if (seen.current === framingKey) return;
    seen.current = framingKey;
    if (modeRef.current !== 'find') setReferencesView({ mode: 'find' });
  }, [framingKey, setReferencesView]);

  const setMode = useCallback(
    (next: ReferencesMode, source: ReferencesModeSource = 'tab') => {
      if (next === modeRef.current) return;
      if (next === 'sequence' && hasPickRef.current) clearRef.current();
      setReferencesView({ mode: next });
      track(ANALYTICS_EVENTS.referencesModeChanged, { mode: next, source });
    },
    [setReferencesView]
  );

  return { mode, setMode };
}
