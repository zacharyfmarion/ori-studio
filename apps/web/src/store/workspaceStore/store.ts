import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { createCreasePatternSlice } from './slices/creasePatternSlice';
import { createClipboardSlice } from './slices/clipboardSlice';
import { createConditionSlice } from './slices/conditionSlice';
import { createEditingSlice } from './slices/editingSlice';
import { createHistorySlice } from './slices/historySlice';
import { createProjectSlice } from './slices/projectSlice';
import { createOristudioBpSlice } from './slices/oristudioBpSlice';
import { registerDesignVariantSource } from '../layoutStore';
import { resolveEditingContext } from '../../workspaces/editingContext';
import type { WorkspaceState } from './types';

export const useWorkspaceStore = create<WorkspaceState>()(
  devtools(
    (...args) => ({
      ...createProjectSlice(...args),
      ...createHistorySlice(...args),
      ...createEditingSlice(...args),
      ...createClipboardSlice(...args),
      ...createConditionSlice(...args),
      ...createCreasePatternSlice(...args),
      ...createOristudioBpSlice(...args),
    }),
    { name: 'treemaker-workspace' }
  )
);

// Let the layout store read the active Design layout variant so it can
// materialize the NUX chooser, box-pleat split, or TreeMaker layout.
registerDesignVariantSource(() => {
  const state = useWorkspaceStore.getState();
  if (state.pendingDesignChoice) return 'nux';
  return state.workflowTarget === 'box-pleat' ? 'box-pleat' : 'treemaker';
});

// Keep `activeEditingContext` derived from the active panel + design state. The
// active panel (`activePanelId`) is the source of truth; every other input
// (design choice, workflow target, BP document presence) also feeds the
// resolution, so recompute on any store change and write back only when it
// actually changes (the equality guard prevents re-entrancy).
useWorkspaceStore.subscribe((state) => {
  const next = resolveEditingContext({
    activePanelId: state.activePanelId,
    pendingDesignChoice: state.pendingDesignChoice,
    workflowTarget: state.workflowTarget,
    hasBpDocument: state.oristudioBpDocument !== null,
  });
  if (next !== state.activeEditingContext) {
    useWorkspaceStore.setState({ activeEditingContext: next });
  }
});

if (import.meta.env.DEV && typeof window !== 'undefined') {
  const debugWindow = window as Window & {
    __treemakerWorkspaceStore?: typeof useWorkspaceStore;
  };
  debugWindow.__treemakerWorkspaceStore = useWorkspaceStore;
}
