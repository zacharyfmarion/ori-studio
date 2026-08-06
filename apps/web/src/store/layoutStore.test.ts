import type { DockviewApi, SerializedDockview } from 'dockview';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LAYOUT_VERSION, applyDefaultLayout, useLayoutStore } from './layoutStore';

interface MockPanel {
  id: string;
  group: MockGroup;
  api: { setActive: ReturnType<typeof vi.fn> };
}

interface MockGroup {
  id: string;
  hideHeader?: boolean;
}

type MockDockviewApi = DockviewApi & {
  groupMap: Map<string, MockGroup>;
  panelMap: Map<string, MockPanel>;
  addGroup: ReturnType<typeof vi.fn>;
  addPanel: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  fromJSON: ReturnType<typeof vi.fn>;
  getPanel: ReturnType<typeof vi.fn>;
  toJSON: ReturnType<typeof vi.fn>;
};

const initialLayoutState = useLayoutStore.getInitialState();

function dockviewLayout(label = 'branch'): SerializedDockview {
  return { grid: { root: { type: label } }, panels: {} } as unknown as SerializedDockview;
}

function createDockviewApi(layout: SerializedDockview = dockviewLayout()) {
  const groups = new Map<string, MockGroup>();
  const panels = new Map<string, MockPanel>();
  let groupSequence = 0;
  const api = {
    groupMap: groups,
    panelMap: panels,
    addGroup: vi.fn((options?: { id?: string; hideHeader?: boolean }) => {
      const id = options?.id ?? `group-${++groupSequence}`;
      const group: MockGroup = { id, hideHeader: options?.hideHeader };
      groups.set(id, group);
      return group;
    }),
    addPanel: vi.fn(
      (options: {
        id: string;
        position?: { referenceGroup?: string | MockGroup; referencePanel?: string };
      }) => {
        const referenceGroup = options.position?.referenceGroup;
        const group =
          typeof referenceGroup === 'string'
            ? (groups.get(referenceGroup) ?? { id: referenceGroup })
            : (referenceGroup ?? { id: `${options.id}-group` });
        const panel: MockPanel = {
          id: options.id,
          group,
          api: { setActive: vi.fn() },
        };
        panels.set(options.id, panel);
        return panel;
      }
    ),
    clear: vi.fn(() => panels.clear()),
    fromJSON: vi.fn(() => undefined),
    getPanel: vi.fn((id: string) => panels.get(id) ?? null),
    toJSON: vi.fn(() => layout),
  };
  return api as unknown as MockDockviewApi;
}

describe('layout store', () => {
  beforeEach(() => {
    localStorage.clear();
    useLayoutStore.setState(initialLayoutState, true);
    vi.restoreAllMocks();
  });

  it('builds the design workspace as one headerless panel', () => {
    // Every design pane moved inside it, into a dock owned by the active design
    // tab. What is left at this level does not vary with anything — which is what
    // removed the tear-down-and-rebuild that ran on every tab switch.
    const api = createDockviewApi();

    applyDefaultLayout(api);

    expect(api.addPanel).toHaveBeenCalledTimes(1);
    expect(api.addPanel.mock.calls.map(([options]) => options.id)).toEqual([
      'design-workspace',
    ]);
    expect(api.addGroup).toHaveBeenCalledWith({ direction: 'right', hideHeader: true });
    expect(api.panelMap.get('design-workspace')?.group.hideHeader).toBe(true);
    // The panes a design used to contribute at this level are gone from it.
    expect(api.getPanel('inspector')).toBeNull();
    expect(api.getPanel('bp-editor')).toBeNull();
  });

  it('builds focused edit and simulate workspace defaults', () => {
    const editApi = createDockviewApi();
    const simulateApi = createDockviewApi();

    applyDefaultLayout(editApi, 'edit');
    applyDefaultLayout(simulateApi, 'simulate');

    expect(editApi.addPanel.mock.calls.map(([options]) => options.id)).toEqual([
      'crease-pattern',
      'cp-view-controls',
    ]);
    expect(editApi.addGroup).toHaveBeenCalledWith({ direction: 'right', hideHeader: true });
    expect(editApi.panelMap.get('crease-pattern')?.group.hideHeader).toBe(true);
    expect(editApi.addPanel.mock.calls[1][0]).toMatchObject({
      id: 'cp-view-controls',
      position: { referencePanel: 'crease-pattern', direction: 'right' },
      initialWidth: 260,
    });
    expect(simulateApi.addPanel.mock.calls.map(([options]) => options.id)).toEqual([
      'simulator',
      'simulator-view-controls',
    ]);
    expect(simulateApi.addGroup).toHaveBeenCalledWith({ direction: 'right', hideHeader: true });
    expect(simulateApi.panelMap.get('simulator')?.group.hideHeader).toBe(true);
    // Options pane, mirroring the Edit workspace's view pane.
    expect(simulateApi.addPanel.mock.calls[1][0]).toMatchObject({
      id: 'simulator-view-controls',
      position: { referencePanel: 'simulator', direction: 'right' },
      initialWidth: 260,
    });
  });

  it('activates existing panels through the dockview api', () => {
    const api = createDockviewApi();
    applyDefaultLayout(api, 'edit');
    useLayoutStore.getState().setDockviewApi(api);
    useLayoutStore.setState({ activeWorkspace: 'edit' });

    useLayoutStore.getState().activatePanel('cp-view-controls');

    expect(api.panelMap.get('cp-view-controls')?.api.setActive).toHaveBeenCalledOnce();
  });

  it("finds a design pane in the active tab's own dock", () => {
    // Design panes moved one level down, so a caller naming `conditions` would
    // otherwise find nothing. Callers name a pane, not a dock — the lookup is
    // what has to know there are two.
    const workspaceApi = createDockviewApi();
    applyDefaultLayout(workspaceApi);
    const designApi = createDockviewApi();
    designApi.addPanel({ id: 'conditions', component: 'conditions', title: 'Conditions' });
    useLayoutStore.getState().setDockviewApi(workspaceApi);
    useLayoutStore.getState().setDesignPaneApi(designApi);

    useLayoutStore.getState().activatePanel('conditions');

    expect(designApi.panelMap.get('conditions')?.api.setActive).toHaveBeenCalledOnce();
  });

  it('switches workspaces when activating panels from another workspace', () => {
    const api = createDockviewApi();
    applyDefaultLayout(api);
    useLayoutStore.getState().setDockviewApi(api);

    useLayoutStore.getState().activatePanel('crease-pattern');

    expect(useLayoutStore.getState().activeWorkspace).toBe('edit');
    expect(api.clear).toHaveBeenCalledOnce();
    expect(api.addPanel.mock.calls.map(([options]) => options.id)).toEqual([
      'design-workspace',
      'crease-pattern',
      'cp-view-controls',
    ]);
    expect(api.panelMap.get('crease-pattern')?.api.setActive).toHaveBeenCalledOnce();
  });

  it('saves and reloads versioned layouts from local storage', () => {
    const layout = dockviewLayout();
    const api = createDockviewApi(layout);
    useLayoutStore.getState().setDockviewApi(api);

    useLayoutStore.getState().saveLayout();

    expect(useLayoutStore.getState().loadLayout()).toEqual(layout);
    expect(localStorage.getItem('oristudio:layout:design')).toContain('branch');
  });

  it('rejects stale or malformed saved layouts', () => {
    // A stale version discards the saved layout and clears its keys.
    localStorage.setItem('oristudio:layout-version:design', '1');
    localStorage.setItem('oristudio:layout:design', '{"grid":true}');

    expect(useLayoutStore.getState().loadLayout()).toBeNull();
    expect(localStorage.getItem('oristudio:layout:design')).toBeNull();

    // A current version but malformed JSON falls back to null (no throw).
    localStorage.setItem('oristudio:layout-version:design', String(LAYOUT_VERSION));
    localStorage.setItem('oristudio:layout:design', '{broken');

    expect(useLayoutStore.getState().loadLayout()).toBeNull();
  });

  it('resets to the default layout and persists the replacement', () => {
    const api = createDockviewApi(dockviewLayout('reset'));
    useLayoutStore.getState().setDockviewApi(api);
    localStorage.setItem('oristudio:layout-version:design', '10');
    localStorage.setItem('oristudio:layout:design', '{"old":true}');

    useLayoutStore.getState().resetLayout();

    expect(api.clear).toHaveBeenCalledOnce();
    expect(api.addPanel).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('oristudio:layout:design')).toContain('reset');
  });

});
