import {
  activeDesignTab,
  defaultDesignTitle,
  selectDesignMethod,
  selectOristudioBpDocument,
  selectProject,
} from './designTabs';
import { registerActiveDesignSource } from './activeDesignSource';
import i18n from '../../i18n';
import { untitledTitle } from '../../i18n/documentNames';
import { DEFAULT_NAMESPACE } from '../../i18n/locales';
import { NATIVE_PROJECT_EXTENSION } from '../../lib/nativeProjectFile';
import { exportFilename } from '../../platform/exportFilename';
import { registerActivePanelSink, registerDesignPaneLayoutReset } from '../layoutStore';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { createCreasePatternSlice } from './slices/creasePatternSlice';
import { createClipboardSlice } from './slices/clipboardSlice';
import { createConditionSlice } from './slices/conditionSlice';
import { createEditingSlice } from './slices/editingSlice';
import { createHistorySlice } from './slices/historySlice';
import { createProjectSlice } from './slices/projectSlice';
import { createExploriSlice } from './slices/exploriSlice';
import { createOristudioBpSlice } from './slices/oristudioBpSlice';
import { createSimulatorSlice } from './slices/simulatorSlice';
import { createReferencesSlice } from './slices/referencesSlice';
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
      ...createExploriSlice(...args),
      ...createSimulatorSlice(...args),
      ...createReferencesSlice(...args),
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

// View ▸ Reset Layout has to reach the active design's own pane arrangement, not
// just the workspace dock above it. Registered rather than imported: the layout
// store sits under this one.
registerDesignPaneLayoutReset(() => {
  const state = useWorkspaceStore.getState();
  state.setDesignPaneLayout(state.activeDesignId, null);
});

// The layout store's pull half of the active-pane sync, to pair with the push
// from Dockview's `onDidActivePanelChange` in `WorkspaceShell`. Same seam, same
// reason: this store owns the field, that one owns the dock.
registerActivePanelSink((panelId) => {
  useWorkspaceStore.setState({ activePanelId: panelId });
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

// Name the placeholders again once the language is known.
//
// The initial state is built at module load, before any catalog could have
// arrived, so its placeholder names — the workspace title, the synthesized
// filename, the chooser tab's title — are English whatever language the app is
// about to run in. The moment to name them in it is when the language's
// `common` catalog lands in the store (`added`), and again on every switch in
// Settings (`languageChanged`, which also covers a switch onto a catalog that
// is already here). `added` rather than `languageChanged` alone for the cold
// path, and on purpose: a cold `/edit` names its blank crease pattern as soon
// as that same catalog lands and establishes the project a worker round-trip
// later, whereas `languageChanged` waits for every namespace — so the
// workspace placeholder must be renamed at the earlier event, or the flag would
// already be set and the window title would stay English.
//
// Only a name still carrying the placeholder is touched, so a project that has
// been established keeps its title (an opened file really can be called
// "Untitled"), and a tab someone renamed keeps its name the way any document
// keeps a name the user gave it. A chooser tab is renamed whether or not a
// project exists: it has chosen nothing, so its default is nobody's.
let placeholderTitle = useWorkspaceStore.getState().workspaceTitle;
let placeholderTabTitle = defaultDesignTitle();
i18n.on('languageChanged', reseedPlaceholderNames);
i18n.store.on('added', (lng: string, ns: string) => {
  if (lng === i18n.language && ns === DEFAULT_NAMESPACE) reseedPlaceholderNames();
});
function reseedPlaceholderNames() {
  const state = useWorkspaceStore.getState();
  const title = untitledTitle(i18n.t);
  const tabTitle = defaultDesignTitle();
  const patch: Partial<WorkspaceState> = {};
  if (!state.projectEstablished && state.workspaceTitle === placeholderTitle) {
    patch.workspaceTitle = title;
    patch.currentFileName = exportFilename(title, NATIVE_PROJECT_EXTENSION, i18n.t);
  }
  const wearsPlaceholder = (tab: WorkspaceState['designTabs'][number]) =>
    tab.kind === null && !tab.pendingHydration && tab.title === placeholderTabTitle;
  if (state.designTabs.some(wearsPlaceholder)) {
    patch.designTabs = state.designTabs.map((tab) =>
      wearsPlaceholder(tab) ? { ...tab, title: tabTitle } : tab
    );
  }
  if (Object.keys(patch).length > 0) useWorkspaceStore.setState(patch);
  placeholderTitle = title;
  placeholderTabTitle = tabTitle;
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  const debugWindow = window as Window & {
    __treemakerWorkspaceStore?: typeof useWorkspaceStore;
  };
  debugWindow.__treemakerWorkspaceStore = useWorkspaceStore;
}
