import type { DockviewApi, SerializedDockview } from 'dockview';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyDefaultLayout,
  registerWorkflowTargetSource,
  useLayoutStore,
} from './layoutStore';
import type { WorkflowTarget } from '../lib/sampleProject';

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
  let workflowTarget: WorkflowTarget = 'treemaker';
  registerWorkflowTargetSource(() => workflowTarget);

  beforeEach(() => {
    localStorage.clear();
    useLayoutStore.setState(initialLayoutState, true);
    vi.restoreAllMocks();
    workflowTarget = 'treemaker';
  });

  it('builds the default design workspace with design-only side panes', () => {
    const api = createDockviewApi();

    applyDefaultLayout(api);

    expect(api.addPanel).toHaveBeenCalledTimes(4);
    expect(api.addPanel.mock.calls.map(([options]) => options.id)).toEqual([
      'design',
      'inspector',
      'diagnostics',
      'conditions',
    ]);
    expect(api.addGroup).toHaveBeenCalledWith({ direction: 'right', hideHeader: true });
    expect(api.panelMap.get('design')?.group.hideHeader).toBe(true);
    expect(api.addPanel.mock.calls[1][0]).toMatchObject({
      id: 'inspector',
      initialWidth: 320,
      position: { referencePanel: 'design', direction: 'right' },
    });
    expect(api.addPanel.mock.calls[3][0]).toMatchObject({
      id: 'conditions',
      inactive: true,
      position: { referenceGroup: 'inspector-group' },
    });
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
    ]);
    expect(simulateApi.addGroup).toHaveBeenCalledWith({ direction: 'right', hideHeader: true });
    expect(simulateApi.panelMap.get('simulator')?.group.hideHeader).toBe(true);
  });

  it('activates existing panels through the dockview api', () => {
    const api = createDockviewApi();
    applyDefaultLayout(api);
    useLayoutStore.getState().setDockviewApi(api);

    useLayoutStore.getState().activatePanel('conditions');

    expect(api.panelMap.get('conditions')?.api.setActive).toHaveBeenCalledOnce();
  });

  it('switches workspaces when activating panels from another workspace', () => {
    const api = createDockviewApi();
    applyDefaultLayout(api);
    useLayoutStore.getState().setDockviewApi(api);

    useLayoutStore.getState().activatePanel('crease-pattern');

    expect(useLayoutStore.getState().activeWorkspace).toBe('edit');
    expect(api.clear).toHaveBeenCalledOnce();
    expect(api.addPanel.mock.calls.map(([options]) => options.id)).toEqual([
      'design',
      'inspector',
      'diagnostics',
      'conditions',
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
    expect(localStorage.getItem('treemaker-web-layout:design')).toContain('branch');
  });

  it('rejects stale or malformed saved layouts', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    localStorage.setItem('treemaker-web-layout-version:design', '1');
    localStorage.setItem('treemaker-web-layout:design', '{"grid":true}');

    expect(useLayoutStore.getState().loadLayout()).toBeNull();
    expect(localStorage.getItem('treemaker-web-layout:design')).toBeNull();

    localStorage.setItem('treemaker-web-layout-version:design', '13');
    localStorage.setItem('treemaker-web-layout:design', '{broken');

    expect(useLayoutStore.getState().loadLayout()).toBeNull();
    expect(warn).toHaveBeenCalledWith('Failed to parse saved layout', expect.any(SyntaxError));
  });

  it('resets to the default layout and persists the replacement', () => {
    const api = createDockviewApi(dockviewLayout('reset'));
    useLayoutStore.getState().setDockviewApi(api);
    localStorage.setItem('treemaker-web-layout-version:design', '10');
    localStorage.setItem('treemaker-web-layout:design', '{"old":true}');

    useLayoutStore.getState().resetLayout();

    expect(api.clear).toHaveBeenCalledOnce();
    expect(api.addPanel).toHaveBeenCalledTimes(4);
    expect(localStorage.getItem('treemaker-web-layout:design')).toContain('reset');
  });

  it('adds the BP Editor pane to the box-pleat design layout', () => {
    workflowTarget = 'box-pleat';
    const api = createDockviewApi();

    applyDefaultLayout(api, 'design');

    expect(api.addPanel.mock.calls.map(([options]) => options.id)).toEqual([
      'design',
      'bp-editor',
      'inspector',
      'diagnostics',
      'conditions',
    ]);
    expect(api.addPanel.mock.calls[1][0]).toMatchObject({
      id: 'bp-editor',
      position: { referencePanel: 'design', direction: 'right' },
    });
    // Inspector docks to the right of the BP Editor, not the design pane.
    expect(api.addPanel.mock.calls[2][0]).toMatchObject({
      id: 'inspector',
      position: { referencePanel: 'bp-editor', direction: 'right' },
    });
  });

  it('keeps TreeMaker and box-pleat design layouts in separate storage scopes', () => {
    const api = createDockviewApi(dockviewLayout('treemaker-design'));
    useLayoutStore.getState().setDockviewApi(api);

    workflowTarget = 'treemaker';
    useLayoutStore.getState().saveLayout('design');
    workflowTarget = 'box-pleat';
    useLayoutStore.getState().saveLayout('design');

    expect(localStorage.getItem('treemaker-web-layout:design')).toContain('treemaker-design');
    expect(localStorage.getItem('treemaker-web-layout:design:box-pleat')).toContain(
      'treemaker-design'
    );
    // The two scopes are independent keys.
    expect(localStorage.getItem('treemaker-web-layout:design')).not.toBeNull();
    expect(localStorage.getItem('treemaker-web-layout:design:box-pleat')).not.toBeNull();
  });

  it('rematerializes the active design layout for the current method', () => {
    const api = createDockviewApi();
    useLayoutStore.getState().setDockviewApi(api);
    workflowTarget = 'box-pleat';

    useLayoutStore.getState().rematerializeWorkspace('design');

    expect(api.clear).toHaveBeenCalledOnce();
    expect(api.addPanel).toHaveBeenCalledTimes(5);
    expect(api.getPanel('bp-editor')).not.toBeNull();
    expect(localStorage.getItem('treemaker-web-layout:design:box-pleat')).not.toBeNull();
  });

  it('does not rematerialize an inactive workspace', () => {
    const api = createDockviewApi();
    useLayoutStore.getState().setDockviewApi(api);

    useLayoutStore.getState().rematerializeWorkspace('edit');

    expect(api.clear).not.toHaveBeenCalled();
    expect(api.addPanel).not.toHaveBeenCalled();
  });
});
