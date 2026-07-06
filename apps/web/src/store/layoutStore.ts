import { create } from 'zustand';
import type { DockviewApi, SerializedDockview } from 'dockview';

const LAYOUT_STORAGE_KEY = 'treemaker-web-layout';
const LAYOUT_VERSION_KEY = 'treemaker-web-layout-version';
const LAYOUT_VERSION = 8;

export function applyDefaultLayout(api: DockviewApi): void {
  const design = api.addPanel({ id: 'design', component: 'design', title: 'Design' });
  api.addPanel({
    id: 'crease-pattern',
    component: 'crease-pattern',
    title: 'Crease Pattern',
    position: { referenceGroup: design.group.id },
    inactive: true,
  });
  api.addPanel({
    id: 'simulator',
    component: 'simulator',
    title: 'Simulator',
    position: { referenceGroup: design.group.id },
    inactive: true,
  });
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

interface LayoutState {
  dockviewApi: DockviewApi | null;
  setDockviewApi: (api: DockviewApi | null) => void;
  activatePanel: (id: string) => void;
  saveLayout: () => void;
  loadLayout: () => SerializedDockview | null;
  resetLayout: () => void;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  dockviewApi: null,
  setDockviewApi: (api) => set({ dockviewApi: api }),
  activatePanel: (id) => {
    const panel = get().dockviewApi?.getPanel(id);
    panel?.api.setActive();
  },
  saveLayout: () => {
    const { dockviewApi } = get();
    if (!dockviewApi) return;
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(dockviewApi.toJSON()));
      localStorage.setItem(LAYOUT_VERSION_KEY, String(LAYOUT_VERSION));
    } catch (error) {
      console.warn('Failed to save layout', error);
    }
  },
  loadLayout: () => {
    const version = localStorage.getItem(LAYOUT_VERSION_KEY);
    if (version !== String(LAYOUT_VERSION)) {
      localStorage.removeItem(LAYOUT_STORAGE_KEY);
      localStorage.removeItem(LAYOUT_VERSION_KEY);
      return null;
    }
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!saved) return null;
    try {
      return JSON.parse(saved) as SerializedDockview;
    } catch (error) {
      console.warn('Failed to parse saved layout', error);
      return null;
    }
  },
  resetLayout: () => {
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
    localStorage.removeItem(LAYOUT_VERSION_KEY);
    const { dockviewApi } = get();
    if (!dockviewApi) return;
    dockviewApi.clear();
    applyDefaultLayout(dockviewApi);
    get().saveLayout();
  },
}));
