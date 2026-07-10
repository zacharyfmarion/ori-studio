import { create } from 'zustand';
import type { DockviewApi, IDockviewPanel, SerializedDockview } from 'dockview';
import type { WorkspaceId } from '../workspaces/workspaces';
import { workspaceForPanelId } from '../workspaces/workspaces';
import type { WorkflowTarget } from '../lib/sampleProject';

const LAYOUT_STORAGE_KEY = 'treemaker-web-layout';
const LAYOUT_VERSION_KEY = 'treemaker-web-layout-version';
const LAYOUT_VERSION = 13;

/**
 * The Design workspace layout depends on the active design method (the
 * box-pleat variant adds the BP Editor pane), so the layout store needs to
 * read the current workflow target. To avoid a hard import cycle with the
 * workspace store, the source is registered at app init and defaults to the
 * TreeMaker layout everywhere else (tests, non-design workspaces).
 */
let readWorkflowTarget: () => WorkflowTarget = () => 'treemaker';

export function registerWorkflowTargetSource(source: () => WorkflowTarget): void {
  readWorkflowTarget = source;
}

/**
 * Persisted-layout scope. Only the Design workspace varies by design method;
 * TreeMaker keeps the plain `design` scope for backward compatibility, and the
 * box-pleat variant is stored separately so the two do not clobber each other.
 */
function layoutScope(workspace: WorkspaceId, workflowTarget: WorkflowTarget): string {
  if (workspace === 'design' && workflowTarget === 'box-pleat') {
    return 'design:box-pleat';
  }
  return workspace;
}

function currentLayoutScope(workspace: WorkspaceId): string {
  return layoutScope(workspace, readWorkflowTarget());
}

function layoutStorageKey(scope: string): string {
  return `${LAYOUT_STORAGE_KEY}:${scope}`;
}

function layoutVersionKey(scope: string): string {
  return `${LAYOUT_VERSION_KEY}:${scope}`;
}

interface PrimaryPanelOptions {
  id: string;
  component: string;
  title: string;
}

export function applyDefaultLayout(
  api: DockviewApi,
  workspace: WorkspaceId = 'design',
  workflowTarget: WorkflowTarget = readWorkflowTarget()
): void {
  switch (workspace) {
    case 'design':
      applyDesignLayout(api, workflowTarget);
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

function applyDesignLayout(api: DockviewApi, workflowTarget: WorkflowTarget): void {
  const design = addHeaderlessPanel(api, { id: 'design', component: 'design', title: 'Design' });
  if (workflowTarget === 'box-pleat') {
    // Box-pleat Design: BP tree editor beside the BP Editor packing pane, with
    // the shared Design inspector/diagnostics on the right.
    api.addPanel({
      id: 'bp-editor',
      component: 'bp-editor',
      title: 'BP Editor',
      position: { referencePanel: 'design', direction: 'right' },
      initialWidth: 520,
    });
    addDesignSidePanes(api, 'bp-editor');
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
  simulator.api.setActive();
}

interface LayoutState {
  dockviewApi: DockviewApi | null;
  activeWorkspace: WorkspaceId;
  setDockviewApi: (api: DockviewApi | null) => void;
  setActiveWorkspace: (workspace: WorkspaceId) => void;
  activateWorkspace: (workspace: WorkspaceId) => void;
  activatePanel: (id: string) => void;
  rematerializeWorkspace: (workspace?: WorkspaceId) => void;
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
        const scope = currentLayoutScope(workspace);
        localStorage.removeItem(layoutStorageKey(scope));
        localStorage.removeItem(layoutVersionKey(scope));
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
  rematerializeWorkspace: (workspace = get().activeWorkspace) => {
    const { dockviewApi } = get();
    if (!dockviewApi || workspace !== get().activeWorkspace) return;
    dockviewApi.clear();
    applyDefaultLayout(dockviewApi, workspace);
    get().saveLayout(workspace);
  },
  saveLayout: (workspace = get().activeWorkspace) => {
    const { dockviewApi } = get();
    if (!dockviewApi) return;
    const scope = currentLayoutScope(workspace);
    try {
      localStorage.setItem(layoutStorageKey(scope), JSON.stringify(dockviewApi.toJSON()));
      localStorage.setItem(layoutVersionKey(scope), String(LAYOUT_VERSION));
    } catch (error) {
      console.warn('Failed to save layout', error);
    }
  },
  loadLayout: (workspace = get().activeWorkspace) => {
    const scope = currentLayoutScope(workspace);
    const version = localStorage.getItem(layoutVersionKey(scope));
    if (version !== String(LAYOUT_VERSION)) {
      localStorage.removeItem(layoutStorageKey(scope));
      localStorage.removeItem(layoutVersionKey(scope));
      localStorage.removeItem(LAYOUT_STORAGE_KEY);
      localStorage.removeItem(LAYOUT_VERSION_KEY);
      return null;
    }
    const saved = localStorage.getItem(layoutStorageKey(scope));
    if (!saved) return null;
    try {
      return JSON.parse(saved) as SerializedDockview;
    } catch (error) {
      console.warn('Failed to parse saved layout', error);
      return null;
    }
  },
  resetLayout: (workspace = get().activeWorkspace) => {
    const scope = currentLayoutScope(workspace);
    localStorage.removeItem(layoutStorageKey(scope));
    localStorage.removeItem(layoutVersionKey(scope));
    const { dockviewApi } = get();
    if (!dockviewApi || workspace !== get().activeWorkspace) return;
    dockviewApi.clear();
    applyDefaultLayout(dockviewApi, workspace);
    get().saveLayout(workspace);
  },
}));
