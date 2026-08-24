import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Dockview is replaced wholesale: the subject is which options the shell hands
 * it, and the real component needs a laid-out DOM that jsdom cannot give it.
 */
const dockviewProps: Record<string, unknown>[] = [];

vi.mock('dockview', () => ({
  DockviewReact: (props: Record<string, unknown>) => {
    dockviewProps.push(props);
    return null;
  },
}));

// The dock's panels are never rendered here (the mock above drops them), and
// importing them for real drags the whole workspace — canvases, workers, wasm —
// into a test about two booleans.
vi.mock('./panels/PanelComponents', () => ({ panelComponents: {} }));
vi.mock('./panels/DesignTabStrip', () => ({ DesignTabStrip: () => null }));

// The View drawer *is* mounted here — its trigger is the touch layer's only way
// back to the pane the dock stops showing, so the wiring is worth asserting. Only
// its two bodies are stubbed, for the same reason as the dock's panels above.
vi.mock('./panels/CpViewControlsPanel', () => ({ CpViewControlsPanel: () => null }));
vi.mock('./panels/SimulatorViewControlsPanel', () => ({
  SimulatorViewControlsPanel: () => null,
}));

import { useLayoutStore } from '../store/layoutStore';
import { WorkspaceShell } from './WorkspaceShell';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function stubPointer(coarse: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('pointer: coarse') ? coarse : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
}

function renderShell() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <MemoryRouter initialEntries={['/edit']}>
        <WorkspaceShell />
      </MemoryRouter>
    );
  });
  return dockviewProps.at(-1) ?? {};
}

const initialLayoutState = useLayoutStore.getInitialState();

beforeEach(() => {
  dockviewProps.length = 0;
  useLayoutStore.setState(initialLayoutState, true);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  useLayoutStore.setState(initialLayoutState, true);
});

/**
 * Dockview drags panels with HTML5 drag-and-drop, which iOS Safari never fires
 * for a finger. A touch device that keeps the draggable tabs offers a gesture
 * that cannot complete; one that loses them keeps everything else.
 */
describe('the workspace dock under a coarse pointer', () => {
  it('locks panel drag-and-drop', () => {
    stubPointer(true);

    expect(renderShell().disableDnd).toBe(true);
  });

  it('leaves it alone under a fine pointer', () => {
    stubPointer(false);

    expect(renderShell().disableDnd).toBe(false);
  });

  it('locks nothing else about the dock', () => {
    // Losing the drag must not cost the panels themselves: they are declared by
    // the workspace, cannot be closed, and stay reachable by tapping a tab, the
    // workspace rail, or a View menu entry.
    stubPointer(true);

    const props = renderShell();

    expect(props.components).toBeDefined();
    expect(props.defaultTabComponent).toBeDefined();
    expect(props.onReady).toBeTypeOf('function');
  });

  it('floats the View trigger over the canvas, never over the chrome', () => {
    // The dock stops showing the View pane on touch, so this trigger is the only
    // way to it. It sits inside `.workspace-shell__canvas` — column 2, row 2 of
    // the shell grid — which is what keeps it clear of the toolbar and the rail
    // without a z-index having to win.
    stubPointer(true);
    useLayoutStore.setState({ activeWorkspace: 'edit' });

    renderShell();

    const anchor = container?.querySelector('.view-drawer-anchor');
    expect(anchor?.parentElement?.classList.contains('workspace-shell__canvas')).toBe(true);
    expect(anchor?.querySelector('button')?.textContent).toBe('View');
  });

  it('leaves the canvas bare under a fine pointer', () => {
    stubPointer(false);
    useLayoutStore.setState({ activeWorkspace: 'edit' });

    renderShell();

    expect(container?.querySelector('.view-drawer-anchor')).toBeNull();
  });
});
