import { foldTools } from '../tools/foldToolState';
import { useFoldImportUiStore } from './foldImportUiStore';
import { useFoldImportOrderUi } from '../orders/foldImportOrderUi';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { trackFoldChoiceOffered, trackFoldOrderResolved } from '../../analytics/trackFold';
import { trackFoldCpBatchEnded, trackFoldCpImported, trackFoldImportRefused } from '../../analytics/trackFoldIo';
import i18n from '../../i18n';
import { prefetchLayerOrderDialog } from '../../layer-order/dialog/layerOrderDialogGateway';
import { reportError } from '../../monitoring';
import type { PickedFile } from '../../platform/fileService';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { foldSession } from '../../store/workspaceStore/foldSession';
import { getOristudioCpFoldedFigurePaperScene } from '../../store/workspaceStore/oristudioCpRuntime';
import { projectCpImport } from '../collapse/projectCpImport';
import { foldStartingFigureScene } from './foldEditFigure';
import { createFoldImportFlow, type FoldImportFlow, type FoldImportFlowState, type FoldImportRequest } from './foldImportFlow';
import { chooseFoldImportLayerOrder, foldImportView } from './foldImportLayerOrder';
import { createFoldImportQueue, type FoldImportQueue, type FoldImportQueueState } from './foldImportQueue';

/** What the dialog reads before its flow exists: nothing under way. */
const IDLE = createStore<FoldImportFlowState>(() => ({ phase: 'idle' }));
/** And before its queue exists: no files. */
const NO_QUEUE = createStore<FoldImportQueueState>(() => ({ status: 'idle' }));
const NO_FILES: readonly PickedFile[] = [];

/**
 * The import flow as the app runs it: the app's session, Edit's figures, the
 * analytics events, and the Layer order dialog to choose among several orders
 * (row H10), whose code starts loading only once an import reports several.
 */
export function createAppFoldImportFlow(): FoldImportFlow {
  return createFoldImportFlow({
    session: foldSession(),
    editFoldedFigure: () =>
      foldStartingFigureScene(useWorkspaceStore.getState(), (handle) => getOristudioCpFoldedFigurePaperScene(handle)),
    projectCp: projectCpImport,
    onImported: trackFoldCpImported,
    onChoiceOffered: (orders) => trackFoldChoiceOffered('import_order', orders),
    onOrderResolved: (result, count) => trackFoldOrderResolved(result, 'cp', count),
    onRefused: trackFoldImportRefused,
    chooseLayerOrder: (ask, signal) =>
      chooseFoldImportLayerOrder(ask, foldImportView(useWorkspaceStore.getState()), i18n.t.bind(i18n), signal),
    prefetchLayerOrder: prefetchLayerOrderDialog,
  });
}

/**
 * Import CP's flow for a dialog's lifetime (`foldImportFlow.ts`), with the
 * queue that runs several files through it (`foldImportQueue.ts`): made when
 * the dialog mounts — holding the engine from then on — started on `files`
 * or opened on `initial` when it brings either, and let go with everything
 * they hold when it unmounts — the Layer order dialog it opened included,
 * which closes, and a batch under way, which ends there. Made in an effect,
 * so React's double mount in development makes a second flow rather than
 * reusing one already disposed.
 */
export function useFoldImportFlow(
  initial: FoldImportRequest | null,
  files: readonly PickedFile[] = NO_FILES
): {
  flow: FoldImportFlow | null;
  state: FoldImportFlowState;
  queue: FoldImportQueue | null;
  progress: FoldImportQueueState;
} {
  const [flow, setFlow] = useState<FoldImportFlow | null>(null);
  const [queue, setQueue] = useState<FoldImportQueue | null>(null);
  useEffect(() => {
    const made = createAppFoldImportFlow();
    const queued = createFoldImportQueue({ flow: made, onBatchEnded: trackFoldCpBatchEnded });
    useFoldImportOrderUi.setState({ spread: null });
    const unsubscribe = made.store.subscribe((next, before) => {
      // A choice let go (the chooser's, or the Layer order dialog's Cancel) closes the import.
      if ((before.phase === 'choosing' || before.phase === 'ordering') && next.phase === 'idle') {
        useFoldImportUiStore.getState().close();
      }
    });
    setFlow(made);
    setQueue(queued);
    if (files.length > 0) queued.start(files, 'drop');
    else if (initial) void made.open(initial);
    return () => {
      unsubscribe();
      // Before the flow: a batch that ends here ends as stopped, its next file never opened.
      queued.dispose();
      // Let go with a choice in hand (the browser's Back, a workspace switch): the import is
      // cancelled, so Import CP closes too, and Forward finds it closed rather than importing again.
      const phase = made.store.getState().phase;
      if (phase === 'choosing' || phase === 'ordering') useFoldImportUiStore.getState().close();
      made.dispose();
      setFlow((current) => (current === made ? null : current));
      setQueue((current) => (current === queued ? null : current));
    };
  }, [initial, files]);
  const state = useStore(flow?.store ?? IDLE);
  const progress = useStore(queue?.store ?? NO_QUEUE);
  useEffect(() => foldTools().store.subscribe((next, before) => {
    if (next.tool !== before.tool && flow?.store.getState().phase === 'choosing') useFoldImportUiStore.getState().close();
  }), [flow]);
  // An error is no refusal: the dialog says it plainly, and it is reported.
  useEffect(() => {
    if (state.phase === 'failed') reportError(state.error, { surface: 'fold:import' });
  }, [state]);
  useEffect(() => {
    const choosing = state.phase === 'choosing' ? state : null;
    useFoldImportOrderUi.setState({ flow, choosing });
    return () => {
      if (useFoldImportOrderUi.getState().flow === flow) useFoldImportOrderUi.setState({ flow: null, choosing: null });
    };
  }, [flow, state]);
  return { flow, state, queue, progress };
}
