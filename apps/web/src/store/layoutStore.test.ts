import type { DockviewApi, SerializedDockview } from 'dockview';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyDefaultLayout, useLayoutStore } from './layoutStore';

interface MockPanel {
  id: string;
  group: { id: string };
  api: { setActive: ReturnType<typeof vi.fn> };
}

type MockDockviewApi = DockviewApi & {
  panelMap: Map<string, MockPanel>;
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
  const panels = new Map<string, MockPanel>();
  const api = {
    panelMap: panels,
    addPanel: vi.fn(
      (options: { id: string; position?: { referenceGroup?: string; referencePanel?: string } }) => {
        const referenceGroup = options.position?.referenceGroup;
        const panel: MockPanel = {
          id: options.id,
          group: { id: referenceGroup ?? `${options.id}-group` },
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
    ]);
    expect(simulateApi.addPanel.mock.calls.map(([options]) => options.id)).toEqual([
      'simulator',
      'sequence',
    ]);
    expect(simulateApi.addPanel.mock.calls[1][0]).toMatchObject({
      id: 'sequence',
      position: { referencePanel: 'simulator', direction: 'right' },
      initialWidth: 360,
    });
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

    localStorage.setItem('treemaker-web-layout-version:design', '9');
    localStorage.setItem('treemaker-web-layout:design', '{broken');

    expect(useLayoutStore.getState().loadLayout()).toBeNull();
    expect(warn).toHaveBeenCalledWith('Failed to parse saved layout', expect.any(SyntaxError));
  });

  it('resets to the default layout and persists the replacement', () => {
    const api = createDockviewApi(dockviewLayout('reset'));
    useLayoutStore.getState().setDockviewApi(api);
    localStorage.setItem('treemaker-web-layout-version:design', '9');
    localStorage.setItem('treemaker-web-layout:design', '{"old":true}');

    useLayoutStore.getState().resetLayout();

    expect(api.clear).toHaveBeenCalledOnce();
    expect(api.addPanel).toHaveBeenCalledTimes(4);
    expect(localStorage.getItem('treemaker-web-layout:design')).toContain('reset');
  });
});
