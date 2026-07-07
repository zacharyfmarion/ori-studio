import { create } from 'zustand';
import type { DockviewApi, IDockviewPanel, SerializedDockview } from 'dockview';
import type { WorkspaceId } from '../workspaces/workspaces';
import { workspaceForPanelId } from '../workspaces/workspaces';

const LAYOUT_STORAGE_KEY = 'treemaker-web-layout';
const LAYOUT_VERSION_KEY = 'treemaker-web-layout-version';
const LAYOUT_VERSION = 12;

function layoutStorageKey(workspace: WorkspaceId): string {
  return `${LAYOUT_STORAGE_KEY}:${workspace}`;
}

function layoutVersionKey(workspace: WorkspaceId): string {
  return `${LAYOUT_VERSION_KEY}:${workspace}`;
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

function applyDesignLayout(api: DockviewApi): void {
  addHeaderlessPanel(api, { id: 'design', component: 'design', title: 'Design' });
  api.addPanel({
    id: 'inspector',
    component: 'inspector',
    title: 'Inspector',
    position: { referencePanel: 'design', direction: 'right' },
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
        localStorage.removeItem(layoutStorageKey(workspace));
        localStorage.removeItem(layoutVersionKey(workspace));
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
  saveLayout: (workspace = get().activeWorkspace) => {
    const { dockviewApi } = get();
    if (!dockviewApi) return;
    try {
      localStorage.setItem(layoutStorageKey(workspace), JSON.stringify(dockviewApi.toJSON()));
      localStorage.setItem(layoutVersionKey(workspace), String(LAYOUT_VERSION));
    } catch (error) {
      console.warn('Failed to save layout', error);
    }
  },
  loadLayout: (workspace = get().activeWorkspace) => {
    const version = localStorage.getItem(layoutVersionKey(workspace));
    if (version !== String(LAYOUT_VERSION)) {
      localStorage.removeItem(layoutStorageKey(workspace));
      localStorage.removeItem(layoutVersionKey(workspace));
      localStorage.removeItem(LAYOUT_STORAGE_KEY);
      localStorage.removeItem(LAYOUT_VERSION_KEY);
      return null;
    }
    const saved = localStorage.getItem(layoutStorageKey(workspace));
    if (!saved) return null;
    try {
      return JSON.parse(saved) as SerializedDockview;
    } catch (error) {
      console.warn('Failed to parse saved layout', error);
      return null;
    }
  },
  resetLayout: (workspace = get().activeWorkspace) => {
    localStorage.removeItem(layoutStorageKey(workspace));
    localStorage.removeItem(layoutVersionKey(workspace));
    const { dockviewApi } = get();
    if (!dockviewApi || workspace !== get().activeWorkspace) return;
    dockviewApi.clear();
    applyDefaultLayout(dockviewApi, workspace);
    get().saveLayout(workspace);
  },
}));
