import {
  activeDesignTab,
  selectDesignMethod,
  selectOristudioBpDocument,
  selectProject,
} from './designTabs';
import { registerActiveDesignSource } from './engineRuntime';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { createCreasePatternSlice } from './slices/creasePatternSlice';
import { createClipboardSlice } from './slices/clipboardSlice';
import { createConditionSlice } from './slices/conditionSlice';
import { createEditingSlice } from './slices/editingSlice';
import { createHistorySlice } from './slices/historySlice';
import { createProjectSlice } from './slices/projectSlice';
import { createOristudioBpSlice } from './slices/oristudioBpSlice';
import { createSimulatorSlice } from './slices/simulatorSlice';
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
      ...createSimulatorSlice(...args),
    }),
    { name: 'treemaker-workspace' }
  )
);

// Let the engine runtimes resolve the active design, so a tree handle belongs to
// the tab that owns it rather than to the module. Registered rather than imported
// because the runtimes sit under the store, and importing it would close a cycle.
//
// A chooser tab is reported too, `kind: null` and all. It is a real design with a
// real id, and a tree created *from* the chooser — the normal way one is made —
// belongs to it. Filtering it out here sent that tree to the module fallback
// instead, where the registry could not see it: Duplicate found nothing to copy,
// a tab switch parked nothing, and the next acquire built a second, blank tree.
registerActiveDesignSource(() => {
  const tab = activeDesignTab(useWorkspaceStore.getState());
  return { id: tab.id, kind: tab.kind };
});

// Keep `activeEditingContext` derived from the active panel + design state. The
// active panel (`activePanelId`) is the source of truth; every other input
// (design choice, workflow target, BP document presence) also feeds the
// resolution, so recompute on any store change and write back only when it
// actually changes (the equality guard prevents re-entrancy).
useWorkspaceStore.subscribe((state) => {
  const next = resolveEditingContext({
    activePanelId: state.activePanelId,
    designMethod: selectDesignMethod(state),
    hasBpDocument: selectOristudioBpDocument(state) !== null,
  });
  if (next !== state.activeEditingContext) {
    useWorkspaceStore.setState({ activeEditingContext: next });
  }
});

// Mark a project as established (sticky for the session) as soon as a real
// document appears: a crease pattern, a BP design, or an authored/loaded tree.
// A blank TreeMaker design picked from the chooser has no document content, so
// `chooseDesignMethod` sets the flag directly. Deep-linked workspace routes read
// this to redirect to /welcome when nothing has been established.
useWorkspaceStore.subscribe((state) => {
  if (state.projectEstablished) return;
  const hasDocument =
    state.oristudioCpDocument !== null ||
    state.importedCreasePattern !== null ||
    selectOristudioBpDocument(state) !== null ||
    selectProject(state).edges.length > 0;
  if (hasDocument) useWorkspaceStore.setState({ projectEstablished: true });
});

if (import.meta.env.DEV && typeof window !== 'undefined') {
  const debugWindow = window as Window & {
    __treemakerWorkspaceStore?: typeof useWorkspaceStore;
  };
  debugWindow.__treemakerWorkspaceStore = useWorkspaceStore;
}
