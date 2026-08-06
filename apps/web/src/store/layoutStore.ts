import { create } from 'zustand';
import type { DockviewApi, IDockviewPanel, SerializedDockview } from 'dockview';
import type { WorkspaceId } from '../workspaces/workspaces';
import { workspaceForPanelId } from '../workspaces/workspaces';
import { readJson, readString, removeKey, storageKey, STORAGE_KEYS, writeJson, writeString } from '../lib/storage';

// v18: the Design workspace collapsed to one panel — every design pane moved
// into the per-tab dock inside it — so any stored Design layout is a layout of
// panels that no longer live at this level.
// v17: the Simulate workspace gained its options pane; a layout persisted before
// it existed restores a lone simulator panel and never picks the pane up.
// v16: the box-pleat tree pane gained a tab header (draggable/rearrangeable), so
// invalidate persisted box-pleat layouts that still have it in a headerless group.
// v15: workspace routing rebuilt the layout lifecycle; invalidate any layouts
// persisted by the racy pre-routing/interim builds (e.g. a vertically stacked BP
// split, an Edit layout missing the View pane).
export const LAYOUT_VERSION = 18;

/**
 * Persisted-layout scope — one per workspace, and nothing else.
 *
 * The Design workspace used to have three (`design`, `design:box-pleat`,
 * `design:nux`) because its dock layout changed with the design's kind. It no
 * longer has a dock layout worth varying: the workspace holds one panel, and the
 * panes inside it belong to a design tab, which persists its own arrangement in
 * the `.osf` rather than in local storage.
 */
function currentLayoutScope(workspace: WorkspaceId): string {
  return workspace;
}

function layoutStorageKey(scope: string): string {
  return storageKey(STORAGE_KEYS.layout, scope);
}

function layoutVersionKey(scope: string): string {
  return storageKey(STORAGE_KEYS.layoutVersion, scope);
}

/** Remove the persisted layout (and its version) for a workspace. */
export function clearPersistedLayout(workspace: WorkspaceId): void {
  const scope = currentLayoutScope(workspace);
  removeKey(layoutStorageKey(scope));
  removeKey(layoutVersionKey(scope));
}

/**
 * Every scope that has ever been written, including the two the Design
 * workspace's old per-variant scoping produced. Kept in the *clear* list so an
 * upgrade does not strand them in local storage forever.
 */
const ALL_LAYOUT_SCOPES = ['design', 'design:box-pleat', 'design:nux', 'edit', 'simulate'];

/**
 * Drop every persisted layout, for the app-level error recovery path: when the
 * whole shell has failed to render we cannot know which workspace's stored
 * layout is at fault, and a corrupt one would survive an ordinary reload.
 *
 * Unlike `clearPersistedLayout` this reads no store state (no design variant, no
 * active workspace) — it is called from an error fallback, where any store may
 * be the thing that is broken.
 */
export function clearAllPersistedLayouts(): void {
  for (const scope of ALL_LAYOUT_SCOPES) {
    removeKey(layoutStorageKey(scope));
    removeKey(layoutVersionKey(scope));
  }
}

interface PrimaryPanelOptions {
  id: string;
  component: string;
  title: string;
}

export function applyDefaultLayout(api: DockviewApi, workspace: WorkspaceId = 'design'): void {
  switch (workspace) {
    case 'design':
      applyDesignLayout(api);
      return;
    case 'edit':
      applyEditLayout(api);
      return;
    case 'simulate':
      applySimulateLayout(api);
      return;
  }
}

function addHeaderlessPanel(api: DockviewApi, options: PrimaryPanelOptions): IDockviewPanel {
  const group = api.addGroup({ direction: 'right', hideHeader: true });
  return api.addPanel({ ...options, position: { referenceGroup: group } });
}

/**
 * One headerless panel, always.
 *
 * The Design workspace's panes — the canvas, the inspector, the BP packing
 * editor — moved inside it, into a dock owned by the active design tab. What is
 * left at this level does not vary with anything, which is what removed
 * `DesignLayoutVariant`, `mountedDesignVariant`, and the tear-down-and-rebuild
 * that ran on every tab switch.
 */
function applyDesignLayout(api: DockviewApi): void {
  addHeaderlessPanel(api, {
    id: 'design-workspace',
    component: 'design-workspace',
    title: 'Design',
  }).api.setActive();
}

function applyEditLayout(api: DockviewApi): void {
  addHeaderlessPanel(api, {
    id: 'crease-pattern',
    component: 'crease-pattern',
    title: 'Crease Pattern',
  });
  api.addPanel({
    id: 'cp-view-controls',
    component: 'cp-view-controls',
    title: 'View',
    position: { referencePanel: 'crease-pattern', direction: 'right' },
    initialWidth: 260,
  });
}

function applySimulateLayout(api: DockviewApi): void {
  const simulator = addHeaderlessPanel(api, {
    id: 'simulator',
    component: 'simulator',
    title: 'Simulator',
  });
  api.addPanel({
    id: 'simulator-view-controls',
    component: 'simulator-view-controls',
    title: 'View',
    position: { referencePanel: 'simulator', direction: 'right' },
    initialWidth: 260,
  });
  simulator.api.setActive();
}

interface LayoutState {
  dockviewApi: DockviewApi | null;
  /**
   * The active design tab's own dock, registered by it while mounted.
   *
   * The design panes live one level down now, so `activatePanel('conditions')`
   * would find nothing at the workspace level. Rather than make every caller ask
   * which dock a pane is in — a question they have no business answering — the
   * layout store looks in both.
   */
  designPaneApi: DockviewApi | null;
  activeWorkspace: WorkspaceId;
  setDockviewApi: (api: DockviewApi | null) => void;
  setDesignPaneApi: (api: DockviewApi | null) => void;
  setActiveWorkspace: (workspace: WorkspaceId) => void;
  activateWorkspace: (workspace: WorkspaceId) => void;
  activatePanel: (id: string) => void;
  saveLayout: (workspace?: WorkspaceId) => void;
  loadLayout: (workspace?: WorkspaceId) => SerializedDockview | null;
  resetLayout: (workspace?: WorkspaceId) => void;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  dockviewApi: null,
  designPaneApi: null,
  activeWorkspace: 'design',
  setDockviewApi: (api) => set({ dockviewApi: api }),
  setDesignPaneApi: (api) => set({ designPaneApi: api }),
  setActiveWorkspace: (workspace) => set({ activeWorkspace: workspace }),
  activateWorkspace: (workspace) => {
    const { dockviewApi, activeWorkspace } = get();
    if (!dockviewApi) {
      set({ activeWorkspace: workspace });
      return;
    }
    if (workspace === activeWorkspace) return;

    get().saveLayout(activeWorkspace);
    dockviewApi.clear();
    set({ activeWorkspace: workspace });

    const saved = get().loadLayout(workspace);
    if (saved) {
      try {
        dockviewApi.fromJSON(saved);
        return;
      } catch (error) {
        console.warn('Failed to restore layout', error);
        clearPersistedLayout(workspace);
      }
    }

    applyDefaultLayout(dockviewApi, workspace);
  },
  activatePanel: (id) => {
    const targetWorkspace = workspaceForPanelId(id);
    if (targetWorkspace) get().activateWorkspace(targetWorkspace);
    const { dockviewApi, designPaneApi } = get();
    const panel = dockviewApi?.getPanel(id) ?? designPaneApi?.getPanel(id);
    panel?.api.setActive();
  },
  saveLayout: (workspace = get().activeWorkspace) => {
    const { dockviewApi } = get();
    if (!dockviewApi) return;
    const scope = currentLayoutScope(workspace);
    writeJson(layoutStorageKey(scope), dockviewApi.toJSON());
    writeString(layoutVersionKey(scope), String(LAYOUT_VERSION));
  },
  loadLayout: (workspace = get().activeWorkspace) => {
    const scope = currentLayoutScope(workspace);
    const version = readString(layoutVersionKey(scope));
    if (version !== String(LAYOUT_VERSION)) {
      clearPersistedLayout(workspace);
      return null;
    }
    return readJson<SerializedDockview | null>(layoutStorageKey(scope), null);
  },
  resetLayout: (workspace = get().activeWorkspace) => {
    clearPersistedLayout(workspace);
    const { dockviewApi } = get();
    if (!dockviewApi || workspace !== get().activeWorkspace) return;
    dockviewApi.clear();
    applyDefaultLayout(dockviewApi, workspace);
    get().saveLayout(workspace);
  },
}));
