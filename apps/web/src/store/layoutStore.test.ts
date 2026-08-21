import type { DockviewApi, SerializedDockview } from 'dockview';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKSPACE_IDS, workspaceForPanelId } from '../workspaces/workspaces';
import {
  LAYOUT_VERSION,
  applyDefaultLayout,
  reconcileViewPanel,
  registerActivePanelSink,
  useLayoutStore,
  viewPanelFor,
} from './layoutStore';

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
  removePanel: ReturnType<typeof vi.fn>;
  toJSON: ReturnType<typeof vi.fn>;
};

const initialLayoutState = useLayoutStore.getInitialState();

function dockviewLayout(label = 'branch', panelIds: string[] = []): SerializedDockview {
  return {
    grid: { root: { type: label } },
    panels: Object.fromEntries(panelIds.map((id) => [id, { id }])),
  } as unknown as SerializedDockview;
}

function createDockviewApi(layout: SerializedDockview = dockviewLayout()) {
  const groups = new Map<string, MockGroup>();
  const panels = new Map<string, MockPanel>();
  let groupSequence = 0;
  // Dockview activates a panel as it is added, and `setActive()` moves it. The
  // real one reports the result as `api.activePanel`; modelled here because
  // reconciling against it is the point of the no-op-switch test below.
  let activePanelId: string | null = null;

  function addPanel(options: {
    id: string;
    position?: { referenceGroup?: string | MockGroup; referencePanel?: string };
  }): MockPanel {
    const referenceGroup = options.position?.referenceGroup;
    const group =
      typeof referenceGroup === 'string'
        ? (groups.get(referenceGroup) ?? { id: referenceGroup })
        : (referenceGroup ?? { id: `${options.id}-group` });
    // A panel positioned against another *panel* lands in a new group of its
    // own, and that group is a column in the dock — registering it is what lets
    // a test see the column go when the panel is removed.
    groups.set(group.id, group);
    const panel: MockPanel = {
      id: options.id,
      group,
      api: {
        setActive: vi.fn(() => {
          activePanelId = options.id;
        }),
      },
    };
    panels.set(options.id, panel);
    activePanelId = options.id;
    return panel;
  }

  const api = {
    groupMap: groups,
    panelMap: panels,
    get activePanel() {
      return activePanelId === null ? undefined : panels.get(activePanelId);
    },
    addGroup: vi.fn((options?: { id?: string; hideHeader?: boolean }) => {
      const id = options?.id ?? `group-${++groupSequence}`;
      const group: MockGroup = { id, hideHeader: options?.hideHeader };
      groups.set(id, group);
      return group;
    }),
    addPanel: vi.fn(addPanel),
    clear: vi.fn(() => {
      panels.clear();
      activePanelId = null;
    }),
    // Enough of a restore to matter: the real `fromJSON` replaces the layout with
    // whatever panel set was serialized, and that set is exactly what reconciling
    // afterwards has to answer for.
    fromJSON: vi.fn((serialized: SerializedDockview) => {
      panels.clear();
      groups.clear();
      activePanelId = null;
      for (const id of Object.keys(serialized.panels ?? {})) addPanel({ id });
    }),
    getPanel: vi.fn((id: string) => panels.get(id) ?? null),
    // Dockview's own default is `removeEmptyGroup: true` (verified in
    // dockview-core's `DockviewComponent.removePanel`), which is the whole point
    // here: the emptied group goes with the panel, so the dock stops allocating
    // the column rather than holding an invisible one.
    removePanel: vi.fn((panel: MockPanel) => {
      panels.delete(panel.id);
      if (activePanelId === panel.id) activePanelId = null;
      const stillInGroup = [...panels.values()].some(
        (candidate) => candidate.group.id === panel.group.id
      );
      if (!stillInGroup) groups.delete(panel.group.id);
    }),
    toJSON: vi.fn(() => layout),
  };
  return api as unknown as MockDockviewApi;
}

describe('layout store', () => {
  beforeEach(() => {
    localStorage.clear();
    useLayoutStore.setState(initialLayoutState, true);
    // Module-level seam, so it outlives `setState` and has to be cleared by hand.
    registerActivePanelSink(() => {});
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

  it('reconciles the active panel when the workspace is already active', () => {
    // Regression: `activateWorkspace` returned early when the workspace was
    // already the active one, on the assumption that nothing could have drifted.
    // But `activePanelId` is a cache of what Dockview owns, fed only by
    // `onDidActivePanelChange` -- an event that reports *changes*. Anything that
    // writes the field behind Dockview's back (the file loaders did, to name the
    // pane before a dock exists) leaves a disagreement no event will ever
    // correct, because from Dockview's side nothing happened.
    //
    // A no-op switch is exactly the moment to re-read the dock instead.
    const reported: Array<string | null> = [];
    registerActivePanelSink((id) => reported.push(id));
    const api = createDockviewApi();
    applyDefaultLayout(api, 'edit');
    useLayoutStore.getState().setDockviewApi(api);
    useLayoutStore.setState({ activeWorkspace: 'edit' });

    useLayoutStore.getState().activateWorkspace('edit');

    expect(api.clear).not.toHaveBeenCalled();
    expect(reported).toEqual(['cp-view-controls']);
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

  it('stores one layout per workspace, not one per pointer', () => {
    // This replaces "persists the same layout whatever the pointer is", which
    // asserted the serialized bytes were pointer-independent. That stopped being
    // true the moment the dock legitimately holds a different panel set on touch
    // — but the property it was really protecting still holds, and is stronger:
    // there is exactly one stored layout per workspace, and restoring it is
    // *total*. Whatever pointer captured it, either pointer can restore it and
    // end up with the arrangement it wants.
    //
    // A second, pointer-scoped bucket was the obvious alternative and is worse:
    // it cannot touch a dock that is already built, so the live flip needs
    // `reconcileViewPanel` regardless, and once that exists the extra key buys
    // nothing while doubling what `clearAllPersistedLayouts` has to know about.
    const capture = (coarse: boolean) => {
      const api = createDockviewApi(dockviewLayout(coarse ? 'touch' : 'desktop'));
      applyDefaultLayout(api, 'edit', coarse);
      useLayoutStore.getState().setDockviewApi(api);
      useLayoutStore.getState().saveLayout('edit');
      return localStorage.getItem('oristudio:layout:edit');
    };

    expect(capture(true)).toContain('touch');
    // One key, overwritten — not `oristudio:layout:edit:coarse` beside it.
    expect(capture(false)).toContain('desktop');
    expect(
      Object.keys(localStorage).filter((key) => key.startsWith('oristudio:layout:'))
    ).toEqual(['oristudio:layout:edit']);
    expect(localStorage.getItem('oristudio:layout-version:edit')).toBe(String(LAYOUT_VERSION));

    // Restoring across the mismatch, in both directions. `fromJSON` is what the
    // real store calls; the mock cannot replay a serialized grid, so the panel
    // set each capture would have produced is built directly and reconciled.
    const restored = (captured: boolean, restoring: boolean) => {
      const api = createDockviewApi();
      applyDefaultLayout(api, 'edit', captured);
      reconcileViewPanel(api, 'edit', restoring);
      return [...api.panelMap.keys()];
    };

    expect(restored(true, false)).toEqual(['crease-pattern', 'cp-view-controls']);
    expect(restored(false, true)).toEqual(['crease-pattern']);
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

/**
 * On an iPad in portrait the docked View pane's 260px column, plus the tool
 * rail, leaves the canvas a sliver — and the pane's own controls ran off the
 * right edge. So on touch the pane is not docked, and `WorkspaceViewDrawer`
 * is how it is reached instead.
 */
describe('the View pane under a coarse pointer', () => {
  beforeEach(() => {
    localStorage.clear();
    useLayoutStore.setState(initialLayoutState, true);
    registerActivePanelSink(() => {});
    vi.restoreAllMocks();
  });

  it('leaves it out of the default edit and simulate layouts', () => {
    const editApi = createDockviewApi();
    const simulateApi = createDockviewApi();

    applyDefaultLayout(editApi, 'edit', true);
    applyDefaultLayout(simulateApi, 'simulate', true);

    expect(editApi.addPanel.mock.calls.map(([options]) => options.id)).toEqual(['crease-pattern']);
    expect(simulateApi.addPanel.mock.calls.map(([options]) => options.id)).toEqual(['simulator']);
    // Never mounted for a frame and then removed: the touch build simply does
    // not add it, so the pane's controls never run.
    expect(editApi.removePanel).not.toHaveBeenCalled();
    expect(simulateApi.removePanel).not.toHaveBeenCalled();
  });

  it('gives the canvas the column back rather than hiding it', () => {
    // A restored desktop layout arrives with the pane docked. Removing it takes
    // the group with it (dockview's `removeEmptyGroup` default), which is what
    // makes this reclaim width instead of leaving an invisible column.
    const api = createDockviewApi();
    applyDefaultLayout(api, 'edit', false);
    const viewGroupId = api.panelMap.get('cp-view-controls')?.group.id;
    expect(viewGroupId).toBeDefined();
    expect(api.groupMap.has(viewGroupId as string)).toBe(true);

    reconcileViewPanel(api, 'edit', true);

    expect(api.getPanel('cp-view-controls')).toBeNull();
    expect(api.groupMap.has(viewGroupId as string)).toBe(false);
    // The crease pattern keeps its own headerless group.
    expect([...api.panelMap.keys()]).toEqual(['crease-pattern']);
  });

  it('puts it back when the pointer becomes fine again', () => {
    // The failure that matters most: without this a convertible flipped out of
    // tablet mode is left with no View pane *and* no trigger, and nothing in the
    // app reopens a panel by id — `VIEW_PANEL_ACTIONS` does not name either View
    // pane and `FixedDockTab` hides the close button precisely because there is
    // no reopen path. The only escape would be View -> Reset Layout.
    const api = createDockviewApi();
    applyDefaultLayout(api, 'simulate', true);

    reconcileViewPanel(api, 'simulate', false);

    expect(api.addPanel.mock.calls.at(-1)?.[0]).toMatchObject({
      id: 'simulator-view-controls',
      component: 'simulator-view-controls',
      position: { referencePanel: 'simulator', direction: 'right' },
      initialWidth: 260,
    });
  });

  it('is idempotent in both directions', () => {
    const api = createDockviewApi();
    applyDefaultLayout(api, 'edit', false);

    reconcileViewPanel(api, 'edit', true);
    reconcileViewPanel(api, 'edit', true);
    expect(api.removePanel).toHaveBeenCalledOnce();

    reconcileViewPanel(api, 'edit', false);
    reconcileViewPanel(api, 'edit', false);
    expect(api.addPanel.mock.calls.filter(([o]) => o.id === 'cp-view-controls')).toHaveLength(2);
  });

  it('leaves the Design workspace alone', () => {
    // Design's panes live in the active tab's own dock and persist into the
    // `.osf`, so a pane-less layout written there would travel to other devices
    // and other users. Deliberately out of scope, in both directions.
    const api = createDockviewApi();
    applyDefaultLayout(api, 'design', true);

    reconcileViewPanel(api, 'design', true);
    reconcileViewPanel(api, 'design', false);

    expect(api.removePanel).not.toHaveBeenCalled();
    expect([...api.panelMap.keys()]).toEqual(['design-workspace']);
  });

  it('leaves the dock alone when there is nothing to dock beside', () => {
    // `addPanel` throws on a missing `referencePanel`, and reconciling runs
    // against layouts this module did not build.
    const api = createDockviewApi();

    expect(() => reconcileViewPanel(api, 'edit', false)).not.toThrow();
    expect(api.addPanel).not.toHaveBeenCalled();
  });

  it('reconciles a layout restored by a workspace switch', () => {
    // The restore path is the one that strands people: `fromJSON` replaces the
    // whole layout with the serialized panel set, whatever pointer captured it.
    localStorage.setItem('oristudio:layout-version:edit', String(LAYOUT_VERSION));
    localStorage.setItem(
      'oristudio:layout:edit',
      JSON.stringify(dockviewLayout('branch', ['crease-pattern', 'cp-view-controls']))
    );
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: query.includes('coarse') }))
    );
    const api = createDockviewApi();
    applyDefaultLayout(api, 'design');
    useLayoutStore.getState().setDockviewApi(api);

    useLayoutStore.getState().activateWorkspace('edit');

    expect(api.fromJSON).toHaveBeenCalledOnce();
    expect([...api.panelMap.keys()]).toEqual(['crease-pattern']);
    vi.unstubAllGlobals();
  });

  it('keeps the pane table and the workspace lookup in agreement', () => {
    // Two directions, two modules: this one owns the `addPanel` options, and
    // `workspaces.ts` owns "which workspace does this panel id belong to". They
    // are written by hand and nothing else would notice them drifting.
    const mapped = WORKSPACE_IDS.flatMap((workspace) => {
      const spec = viewPanelFor(workspace);
      return spec ? [[workspace, workspaceForPanelId(spec.id)]] : [];
    });

    expect(mapped).toEqual([
      ['edit', 'edit'],
      ['simulate', 'simulate'],
    ]);
  });

  it('keeps the active editing context on the primary pane', () => {
    // `editingContext` maps both View panes to the same context as the pane they
    // sit beside, so losing one cannot change which context is active.
    const api = createDockviewApi();
    applyDefaultLayout(api, 'edit', true);
    useLayoutStore.getState().setDockviewApi(api);
    useLayoutStore.setState({ activeWorkspace: 'edit' });

    expect(useLayoutStore.getState().activePanelId()).toBe('crease-pattern');
  });
});
