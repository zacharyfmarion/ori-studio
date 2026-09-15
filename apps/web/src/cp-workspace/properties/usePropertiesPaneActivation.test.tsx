import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DockviewApi } from 'dockview';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { FIGURE, IMAGE, TEXT, WINDOW } from '../canvasObjects/canvasObjectKinds.fixtures';
import { usePropertiesPaneActivation } from './usePropertiesPaneActivation';

/**
 * The reveal rule: the Properties tab comes forward on a transition to a
 * different selected object, after the pointer gesture that made it, and
 * only when it is docked and not already showing.
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

/** A dock holding the Properties tab, visible or behind the View tab. */
function dock(visible: boolean) {
  const setActive = vi.fn();
  const api = {
    getPanel: (id: string) =>
      id === 'cp-properties' ? { id, api: { isVisible: visible, setActive } } : null,
  } as unknown as DockviewApi;
  return { api, setActive };
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

    // Another kind, another object: again.
    select({ oristudioCpSelectedAnnotationId: null, oristudioCpActiveFoldedFigureId: FIGURE.id });
    await settle();
    expect(setActive).toHaveBeenCalledTimes(2);
  });

  it('flips nothing on a release, so View stays View until the next object', async () => {
    const { api, setActive } = dock(false);
    useLayoutStore.setState({ dockviewApi: api });
    select({ oristudioCpSelectedAnnotationId: IMAGE.id });
    await settle();
    setActive.mockClear();

    select({ oristudioCpSelectedAnnotationId: null });
    await settle();
    expect(setActive).not.toHaveBeenCalled();

    // The same object again after the release is a transition.
    select({ oristudioCpSelectedAnnotationId: IMAGE.id });
    await settle();
    expect(setActive).toHaveBeenCalledTimes(1);
  });

  it('leaves a tab the user is already looking at alone', async () => {
    const { api, setActive } = dock(true);
    useLayoutStore.setState({ dockviewApi: api });
    select({ oristudioCpFocusedInlineSimulationId: WINDOW.id });
    await settle();
    expect(setActive).not.toHaveBeenCalled();
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
