import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DockviewApi } from 'dockview';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { FIGURE, IMAGE, TEXT, WINDOW } from '../canvasObjects/canvasObjectKinds.fixtures';
import {
  resetPropertiesPaneActivationForTests,
  usePropertiesPaneActivation,
} from './usePropertiesPaneActivation';

/**
 * The reveal rule: the Properties tab comes forward on a transition to a
 * different selected object, after the pointer gesture that made it, and
 * only when it is docked and not already showing. The release rule: the tab
 * it displaced comes back once nothing is selected — unless the user had
 * Properties on top already, or changed the group's tab since.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialLayoutState = useLayoutStore.getInitialState();
const initialWorkspaceState = useWorkspaceStore.getInitialState();

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let coarse = false;

function Probe() {
  usePropertiesPaneActivation();
  return null;
}

/**
 * A dock with one side group holding the View and Properties tabs, the way the
 * Edit layout docks them: `setActive` on a tab puts it on top of the group and
 * fires the group's change event, as dockview does synchronously.
 */
function dock(visible: boolean) {
  const setActive = vi.fn();
  const listeners = new Set<(event: { panel: { id: string } }) => void>();
  const group = {
    activePanel: { id: visible ? 'cp-properties' : 'cp-view-controls' },
    api: {
      onDidActivePanelChange: (listener: (event: { panel: { id: string } }) => void) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    },
  };
  const activate = (id: string) => {
    if (group.activePanel.id === id) return;
    group.activePanel = { id };
    for (const listener of [...listeners]) listener({ panel: { id } });
  };
  const tab = (id: string) => ({
    id,
    group,
    api: {
      get isVisible() {
        return group.activePanel.id === id;
      },
      setActive: () => {
        setActive(id);
        activate(id);
      },
    },
  });
  const tabs = { 'cp-properties': tab('cp-properties'), 'cp-view-controls': tab('cp-view-controls') };
  const api = {
    getPanel: (id: string) => tabs[id as keyof typeof tabs] ?? null,
  } as unknown as DockviewApi;
  /** The user clicking a tab: the group changes without `setActive` being asked. */
  const clickTab = (id: string) => activate(id);
  return { api, setActive, group, clickTab };
}

function select(patch: Partial<ReturnType<typeof useWorkspaceStore.getState>>) {
  act(() => useWorkspaceStore.setState(patch));
}

/** Let the deferred activation run: a frame, with no pointer down. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  });
}

beforeEach(() => {
  coarse = false;
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        return query.includes('pointer: coarse') ? coarse : false;
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
  useLayoutStore.setState({ ...initialLayoutState, activeWorkspace: 'edit' }, true);
  useWorkspaceStore.setState(
    {
      ...initialWorkspaceState,
      oristudioCpAnnotations: [IMAGE, TEXT],
      oristudioCpFoldedFigures: [FIGURE],
      oristudioCpInlineSimulations: [WINDOW],
    },
    true
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<Probe />));
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
  resetPropertiesPaneActivationForTests();
  useLayoutStore.setState(initialLayoutState, true);
  useWorkspaceStore.setState(initialWorkspaceState, true);
});

describe('usePropertiesPaneActivation', () => {
  it('brings the tab forward when a different object is selected', async () => {
    const { api, setActive } = dock(false);
    useLayoutStore.setState({ dockviewApi: api });

    select({ oristudioCpSelectedAnnotationId: IMAGE.id });
    expect(setActive).not.toHaveBeenCalled();
    await settle();
    expect(setActive).toHaveBeenCalledTimes(1);
    expect(setActive).toHaveBeenLastCalledWith('cp-properties');

    // Another kind, another object, with Properties now on top: nothing to do.
    select({ oristudioCpSelectedAnnotationId: null, oristudioCpActiveFoldedFigureId: FIGURE.id });
    await settle();
    expect(setActive).toHaveBeenCalledTimes(1);
  });

  it('gives the displaced tab back on a release, and comes forward again for the next object', async () => {
    const { api, setActive, group } = dock(false);
    useLayoutStore.setState({ dockviewApi: api });
    select({ oristudioCpSelectedAnnotationId: IMAGE.id });
    await settle();
    expect(group.activePanel.id).toBe('cp-properties');
    setActive.mockClear();

    select({ oristudioCpSelectedAnnotationId: null });
    // Deferred like the reveal: the deselect is a press on empty canvas.
    expect(setActive).not.toHaveBeenCalled();
    await settle();
    expect(setActive).toHaveBeenCalledTimes(1);
    expect(setActive).toHaveBeenLastCalledWith('cp-view-controls');
    expect(group.activePanel.id).toBe('cp-view-controls');

    // The same object again after the release is a transition.
    select({ oristudioCpSelectedAnnotationId: IMAGE.id });
    await settle();
    expect(setActive).toHaveBeenLastCalledWith('cp-properties');
  });

  it('keeps a Properties tab the user had on top through a release', async () => {
    const { api, setActive } = dock(true);
    useLayoutStore.setState({ dockviewApi: api });
    select({ oristudioCpFocusedInlineSimulationId: WINDOW.id });
    await settle();
    expect(setActive).not.toHaveBeenCalled();

    select({ oristudioCpFocusedInlineSimulationId: null });
    await settle();
    expect(setActive).not.toHaveBeenCalled();
  });

  it('keeps the tab the user chose after the reveal, whichever it is', async () => {
    const { api, setActive, group, clickTab } = dock(false);
    useLayoutStore.setState({ dockviewApi: api });
    select({ oristudioCpSelectedAnnotationId: IMAGE.id });
    await settle();
    setActive.mockClear();

    // Back to View by hand, then to Properties by hand: the reveal is over,
    // and Properties on top is now the user's choice.
    act(() => clickTab('cp-view-controls'));
    act(() => clickTab('cp-properties'));
    select({ oristudioCpSelectedAnnotationId: null });
    await settle();
    expect(setActive).not.toHaveBeenCalled();
    expect(group.activePanel.id).toBe('cp-properties');
  });

  it('gives nothing back once the user has moved to View themselves', async () => {
    const { api, setActive, group, clickTab } = dock(false);
    useLayoutStore.setState({ dockviewApi: api });
    select({ oristudioCpSelectedAnnotationId: IMAGE.id });
    await settle();
    setActive.mockClear();

    act(() => clickTab('cp-view-controls'));
    select({ oristudioCpSelectedAnnotationId: null });
    await settle();
    expect(setActive).not.toHaveBeenCalled();
    expect(group.activePanel.id).toBe('cp-view-controls');
  });

  it('stays put when the release is followed by another object before the pointer comes up', async () => {
    const { api, setActive, group } = dock(false);
    useLayoutStore.setState({ dockviewApi: api });
    select({ oristudioCpSelectedAnnotationId: IMAGE.id });
    await settle();
    setActive.mockClear();

    act(() => window.dispatchEvent(new PointerEvent('pointerdown')));
    select({ oristudioCpSelectedAnnotationId: null });
    select({ oristudioCpSelectedAnnotationId: TEXT.id });
    act(() => window.dispatchEvent(new PointerEvent('pointerup')));
    await settle();
    expect(setActive).not.toHaveBeenCalled();
    expect(group.activePanel.id).toBe('cp-properties');
  });

  it('waits for the pointer that made the selection to come up', async () => {
    const { api, setActive } = dock(false);
    useLayoutStore.setState({ dockviewApi: api });
    act(() => window.dispatchEvent(new PointerEvent('pointerdown')));
    select({ oristudioCpSelectedAnnotationId: TEXT.id });
    await settle();
    expect(setActive).not.toHaveBeenCalled();

    act(() => window.dispatchEvent(new PointerEvent('pointerup')));
    await settle();
    expect(setActive).toHaveBeenCalledTimes(1);
  });

  it('does nothing under a coarse pointer, where the pane is in the drawer', async () => {
    coarse = true;
    const { api, setActive } = dock(false);
    useLayoutStore.setState({ dockviewApi: api });
    select({ oristudioCpSelectedAnnotationId: IMAGE.id });
    await settle();
    expect(setActive).not.toHaveBeenCalled();
  });
});
