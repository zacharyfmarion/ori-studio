import type { LayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import { create } from 'zustand';
import type { FoldImportFlow, FoldImportFlowState } from '../io/foldImportFlow';

/** Ephemeral handoff from the file/import flow to the full Fold canvas. */
export const useFoldImportOrderUi = create<{
  flow: FoldImportFlow | null;
  spread: LayerSpreadOptions | null;
  choosing: Extract<FoldImportFlowState, { phase: 'choosing' }> | null;
}>(() => ({ flow: null, choosing: null, spread: null }));
