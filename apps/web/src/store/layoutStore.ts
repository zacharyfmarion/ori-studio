import { create } from 'zustand';
import type { DockviewApi, IDockviewPanel, SerializedDockview } from 'dockview';
import type { WorkspaceId } from '../workspaces/workspaces';
import { workspaceForPanelId } from '../workspaces/workspaces';
import { readJson, readString, removeKey, storageKey, STORAGE_KEYS, writeJson, writeString } from '../lib/storage';

// v17: the Simulate workspace gained its options pane; a layout persisted before
// it existed restores a lone simulator panel and never picks the pane up.
// v16: the box-pleat tree pane gained a tab header (draggable/rearrangeable), so
// invalidate persisted box-pleat layouts that still have it in a headerless group.
// v15: workspace routing rebuilt the layout lifecycle; invalidate any layouts
// persisted by the racy pre-routing/interim builds (e.g. a vertically stacked BP
// split, an Edit layout missing the View pane).
export const LAYOUT_VERSION = 17;

/**
 * The Design workspace renders one of three layouts depending on the active
 * design state:
 *
 * - `nux`: the method chooser only (single design pane, no side panes).
 * - `box-pleat`: the BP tree editor beside the BP Editor packing pane, each in
 *   its own headered group so both can be dragged and rearranged. All BP
 *   behavior lives in these two panes; the TreeMaker inspector/diagnostics/
 *   conditions panes are intentionally absent.
 * - `treemaker`: the circle-packed tree editor with its inspector/diagnostics/
 *   conditions side panes.
 */
export type DesignLayoutVariant = 'nux' | 'treemaker' | 'box-pleat';

/**
 * Source for the current Design layout variant. Registered by the workspace
 * store at app init to avoid an import cycle; defaults to `treemaker` for tests
 * and non-design workspaces.
 */
let readDesignVariant: () => DesignLayoutVariant = () => 'treemaker';

export function registerDesignVariantSource(source: () => DesignLayoutVariant): void {
  readDesignVariant = source;
}

/**
 * Persisted-layout scope. Only the Design workspace varies (by design variant);
 * TreeMaker keeps the plain `design` scope for backward compatibility. The NUX
 * layout is transient and never persisted.
 */
function layoutScope(workspace: WorkspaceId, variant: DesignLayoutVariant): string {
  if (workspace !== 'design') return workspace;
  switch (variant) {
    case 'box-pleat':
      return 'design:box-pleat';
    case 'nux':
      return 'design:nux';
    case 'treemaker':
      return 'design';
  }
}

function currentLayoutScope(workspace: WorkspaceId): string {
  return layoutScope(workspace, readDesignVariant());
}

function isPersistentScope(workspace: WorkspaceId): boolean {
  // The NUX chooser layout is transient and must not clobber a real design layout.
  return !(workspace === 'design' && readDesignVariant() === 'nux');
}

function layoutStorageKey(scope: string): string {
  return storageKey(STORAGE_KEYS.layout, scope);
}

function layoutVersionKey(scope: string): string {
  return storageKey(STORAGE_KEYS.layoutVersion, scope);
}

/**
 * Remove the persisted layout (and its version) for a workspace's current scope.
 * Uses the variant-aware scope, so clearing the Design workspace targets the
 * layout actually stored for its active variant (treemaker/box-pleat), not a
 * stale plain-`design` key.
 */
export function clearPersistedLayout(workspace: WorkspaceId): void {
  const scope = currentLayoutScope(workspace);
  removeKey(layoutStorageKey(scope));
  removeKey(layoutVersionKey(scope));
}

/** Every scope `layoutScope` can produce. */
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

export function applyDefaultLayout(
  api: DockviewApi,
  workspace: WorkspaceId = 'design',
  variant: DesignLayoutVariant = readDesignVariant()
): void {
  switch (workspace) {
    case 'design':
      applyDesignLayout(api, variant);
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

function addDesignSidePanes(api: DockviewApi, referencePanelId: string): void {
  api.addPanel({
    id: 'inspector',
    component: 'inspector',
    title: 'Inspector',
    position: { referencePanel: referencePanelId, direction: 'right' },
    initialWidth: 320,
  });
  const inspector = api.getPanel('inspector');
  if (inspector) {
    api.addPanel({
      id: 'diagnostics',
      component: 'diagnostics',
      title: 'Diagnostics',
      position: { referenceGroup: inspector.group.id },
      inactive: true,
    });
    api.addPanel({
      id: 'conditions',
      component: 'conditions',
      title: 'Conditions',
      position: { referenceGroup: inspector.group.id },
      inactive: true,
    });
  }
}

function applyDesignLayout(api: DockviewApi, variant: DesignLayoutVariant): void {
  if (variant === 'box-pleat') {
    // BP tree editor + BP Editor packing pane, split evenly. Both panes carry a
    // tab header (the tree pane is added to its own headered group rather than a
    // headerless one) so either can be dragged and rearranged. No TreeMaker
    // panes; all BP behavior lives in these two surfaces.
    const design = api.addPanel({ id: 'design', component: 'design', title: 'Tree editor' });
    api.addPanel({
      id: 'bp-editor',
      component: 'bp-editor',
      title: 'BP Editor',
      position: { referencePanel: 'design', direction: 'right' },
    });
    design.api.setActive();
    return;
  }

  const design = addHeaderlessPanel(api, { id: 'design', component: 'design', title: 'Design' });

  if (variant === 'nux') {
    // Method chooser only — no TreeMaker side panes.
    design.api.setActive();
    return;
  }

  addDesignSidePanes(api, 'design');
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

/** Derive which design variant is currently mounted from panel presence. */
function mountedDesignVariant(api: DockviewApi): DesignLayoutVariant {
  if (api.getPanel('bp-editor')) return 'box-pleat';
  if (api.getPanel('inspector')) return 'treemaker';
  return 'nux';
}

interface LayoutState {
  dockviewApi: DockviewApi | null;
  activeWorkspace: WorkspaceId;
  setDockviewApi: (api: DockviewApi | null) => void;
  setActiveWorkspace: (workspace: WorkspaceId) => void;
  activateWorkspace: (workspace: WorkspaceId) => void;
  activatePanel: (id: string) => void;
  /** Rebuild the Design layout when the desired variant differs from what's mounted. */
  ensureDesignLayout: () => void;
  saveLayout: (workspace?: WorkspaceId) => void;
  loadLayout: (workspace?: WorkspaceId) => SerializedDockview | null;
  resetLayout: (workspace?: WorkspaceId) => void;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  dockviewApi: null,
  activeWorkspace: 'design',
  setDockviewApi: (api) => set({ dockviewApi: api }),
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
    const panel = get().dockviewApi?.getPanel(id);
    panel?.api.setActive();
  },
  ensureDesignLayout: () => {
    const { dockviewApi, activeWorkspace } = get();
    if (!dockviewApi || activeWorkspace !== 'design') return;
    const desired = readDesignVariant();
    if (mountedDesignVariant(dockviewApi) === desired) return;
    dockviewApi.clear();
    applyDefaultLayout(dockviewApi, 'design', desired);
    if (isPersistentScope('design')) get().saveLayout('design');
  },
  saveLayout: (workspace = get().activeWorkspace) => {
    const { dockviewApi } = get();
    if (!dockviewApi) return;
    if (!isPersistentScope(workspace)) return;
    const scope = currentLayoutScope(workspace);
    writeJson(layoutStorageKey(scope), dockviewApi.toJSON());
    writeString(layoutVersionKey(scope), String(LAYOUT_VERSION));
  },
  loadLayout: (workspace = get().activeWorkspace) => {
    if (!isPersistentScope(workspace)) return null;
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
