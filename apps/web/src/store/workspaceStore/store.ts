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
import { registerDesignVariantSource } from '../layoutStore';
import { activeSlotTracksProjectDirty, rememberPristineCpDocumentState } from './cpDocumentSlots';
import { resolveEditingContext } from '../../workspaces/editingContext';
import { deriveDesignVariant } from './designVariant';
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

// Capture the pristine document-scoped state before anything can load a
// document. A crease-pattern slot that has never been entered starts from this,
// so the slot module never has to restate slice initial values (which would
// drift the first time one changed).
rememberPristineCpDocumentState(useWorkspaceStore.getState());

// Let the layout store read the active Design layout variant so it can
// materialize the NUX chooser, box-pleat split, or TreeMaker layout.
registerDesignVariantSource(() => deriveDesignVariant(useWorkspaceStore.getState()));

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
    state.oristudioBpDocument !== null ||
    state.project.edges.length > 0;
  if (hasDocument) useWorkspaceStore.setState({ projectEstablished: true });
});

// An ephemeral crease-pattern slot (the tutorial's practice canvas) is not part
// of the user's project and can never be saved, so nothing done in it may claim
// the project has unsaved work.
//
// Enforced here, as an invariant over the flag, rather than at the ~30 places
// that set `dirty` — those are spread across the crease-pattern and history
// slices, and a predicate repeated at each would rot the first time someone
// added a thirty-first. This form also stays correct for edit paths that don't
// exist yet.
//
// Blanket-clearing is safe because routes pin `/design` to the edit slot: the
// only surfaces reachable under an ephemeral slot are the tutorial and the
// simulator, and neither can edit the tree or a box-pleated design. If that
// routing rule ever changes, this has to become context-aware.
useWorkspaceStore.subscribe((state) => {
  if (state.dirty && !activeSlotTracksProjectDirty()) {
    useWorkspaceStore.setState({ dirty: false });
  }
});

if (import.meta.env.DEV && typeof window !== 'undefined') {
  const debugWindow = window as Window & {
    __treemakerWorkspaceStore?: typeof useWorkspaceStore;
  };
  debugWindow.__treemakerWorkspaceStore = useWorkspaceStore;
}
