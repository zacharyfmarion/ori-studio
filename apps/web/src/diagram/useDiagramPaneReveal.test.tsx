import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayoutStore } from '../store/layoutStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useDiagramPaneReveal } from './useDiagramPaneReveal';

vi.mock('../lib/pointerGesture', () => ({ runAfterPointerGesture: (run: () => void) => run() }));
const pointer = vi.hoisted(() => ({ coarse: false }));
vi.mock('../platform/pointerSurface', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/pointerSurface')>()),
  isCoarsePointerSurface: () => pointer.coarse,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A dock with the Step and Page tabs; `shown` is the one on top. */
let shown = 'diagram-step';
const activatePanel = vi.fn((id: string) => {
  shown = id;
});

function Probe() {
  useDiagramPaneReveal();
  return null;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  shown = 'diagram-step';
  activatePanel.mockClear();
  pointer.coarse = false;
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useLayoutStore.setState({
    activatePanel,
    dockviewApi: {
      getPanel: (id: string) =>
        id === 'diagram-step' || id === 'diagram-page' ? { api: { isVisible: shown === id } } : undefined,
    } as never,
  });
  host = document.createElement('div');
  root = createRoot(host);
  act(() => root.render(<Probe />));
});
afterEach(() => act(() => root.unmount()));

const state = () => useWorkspaceStore.getState();

describe('useDiagramPaneReveal', () => {
  it('brings Page forward on switching to Pages, and Step back on switching to Steps', () => {
    act(() => state().setDiagramView('pages'));
    expect(shown).toBe('diagram-page');
    act(() => state().setDiagramView('steps'));
    expect(shown).toBe('diagram-step');
  });

  it('brings Step forward when a different step is selected, and leaves the user’s tab otherwise', () => {
    const [first, second] = [state().addDiagramStep()!, state().addDiagramStep()!];
    act(() => state().selectDiagramStep(null));
    shown = 'diagram-page';
    act(() => state().setDiagramStepText(first, 'An edit is not a selection.'));
    expect(shown).toBe('diagram-page');
    act(() => state().selectDiagramStep(second));
    expect(shown).toBe('diagram-step');
    // Deselecting brings nothing forward.
    shown = 'diagram-page';
    act(() => state().selectDiagramStep(null));
    expect(shown).toBe('diagram-page');
  });

  it('never brings a tab forward on touch, where the panes are a drawer', () => {
    pointer.coarse = true;
    act(() => state().setDiagramView('pages'));
    expect(activatePanel).not.toHaveBeenCalled();
  });
});
