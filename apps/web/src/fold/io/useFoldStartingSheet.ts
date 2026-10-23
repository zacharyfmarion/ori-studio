import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { trackFoldSheetChanged } from '../../analytics/trackFold';
import { trackFoldImportRefused } from '../../analytics/trackFoldIo';
import { reportError } from '../../monitoring';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { shownFoldSequence } from '../../store/workspaceStore/foldState';
import { foldSession } from '../../store/workspaceStore/foldSession';
import { projectCpImport } from '../collapse/projectCpImport';
import { SQUARE_PAPER } from '../document/foldSequenceDocument';
import {
  createFoldStartingSheetFlow,
  type FoldStartingSheetFlow,
  type FoldStartingSheetState,
} from './foldStartingSheet';

const IDLE = createStore<FoldStartingSheetState>(() => ({ phase: 'idle' }));

/** The starting-sheet flow as the app runs it: the app's session, the store's edit, the analytics events. */
export function createAppFoldStartingSheetFlow(): FoldStartingSheetFlow {
  return createFoldStartingSheetFlow({
    session: foldSession(),
    projectCp: projectCpImport,
    adopt: (shape) => useWorkspaceStore.getState().setFoldPaperShape(shape),
    onChanged: (shape, origin) => {
      const paper = shownFoldSequence(useWorkspaceStore.getState())?.document.paper ?? SQUARE_PAPER;
      trackFoldSheetChanged('shape', { shape: shape.kind, startSide: paper.startSide }, origin);
    },
    onRefused: trackFoldImportRefused,
  });
}

/**
 * Import starting sheet's flow for a dialog's lifetime (`foldStartingSheet.ts`),
 * as `useFoldImportFlow` is Import CP's: made when the dialog mounts, let go
 * when it unmounts.
 */
export function useFoldStartingSheetFlow(): { flow: FoldStartingSheetFlow | null; state: FoldStartingSheetState } {
  const [flow, setFlow] = useState<FoldStartingSheetFlow | null>(null);
  useEffect(() => {
    const made = createAppFoldStartingSheetFlow();
    setFlow(made);
    return () => {
      made.dispose();
      setFlow((current) => (current === made ? null : current));
    };
  }, []);
  const state = useStore(flow?.store ?? IDLE);
  // An error is no refusal: the dialog says it plainly, and it is reported.
  useEffect(() => {
    if (state.phase === 'failed') reportError(state.error, { surface: 'fold:starting-sheet' });
  }, [state]);
  return { flow, state };
}
