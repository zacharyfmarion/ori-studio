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

if (import.meta.env.DEV && typeof window !== 'undefined') {
  const debugWindow = window as Window & {
    __treemakerWorkspaceStore?: typeof useWorkspaceStore;
  };
  debugWindow.__treemakerWorkspaceStore = useWorkspaceStore;
}
