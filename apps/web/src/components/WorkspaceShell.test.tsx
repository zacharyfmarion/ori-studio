import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DockviewApi } from 'dockview';

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
import { TooltipProvider } from './ui/Tooltip';
import { WorkspaceShell } from './WorkspaceShell';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

let coarse = false;
const mediaListeners = new Set<() => void>();

function stubPointer(initial: boolean) {
  coarse = initial;
  mediaListeners.clear();
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        return query.includes('pointer: coarse') ? coarse : false;
      },
      addEventListener: (_type: string, listener: () => void) => void mediaListeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) =>
        void mediaListeners.delete(listener),
    }))
  );
}

/** What a convertible flipping out of tablet mode looks like to the app. */
function flipPointer(next: boolean) {
  coarse = next;
  act(() => {
    for (const listener of [...mediaListeners]) listener();
  });
}

function renderShell() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      // `TooltipProvider` because the shell is full of `IconButton`s and Radix
      // throws without it — App.tsx wraps the whole app in one. Rendering
      // without it left every icon-only region as an error-boundary fallback,
      // which the older assertions here happened not to look at.
      <TooltipProvider>
        <MemoryRouter initialEntries={['/edit']}>
          <WorkspaceShell />
        </MemoryRouter>
      </TooltipProvider>
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
  mediaListeners.clear();
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

  it('floats the pill lane over the canvas, never over the chrome', () => {
    // The dock stops showing the View pane on touch, so its trigger is the only
    // way to it. The lane sits inside `.workspace-shell__canvas` — column 2,
    // row 2 of the shell grid — which is what keeps it clear of the toolbar and
    // the rail without a z-index having to win.
    stubPointer(true);
    useLayoutStore.setState({ activeWorkspace: 'edit' });

    renderShell();

    const lane = container?.querySelector('.canvas-pill-lane');
    expect(lane?.parentElement?.classList.contains('workspace-shell__canvas')).toBe(true);
    expect(lane?.querySelector('.view-drawer__trigger')?.textContent).toBe('View');
  });

  it('puts undo and redo left of everything else in the lane', () => {
    // The order is DOM order, and it is this file that decides it: the pills
    // themselves know nothing about each other.
    stubPointer(true);
    useLayoutStore.setState({ activeWorkspace: 'edit' });

    renderShell();

    const labels = [...(container?.querySelectorAll('.canvas-pill-lane__row .ui-button') ?? [])].map(
      (button) => button.getAttribute('aria-label') ?? button.textContent
    );
    expect(labels).toEqual(['Undo', 'Redo', 'View']);
  });

  it('leaves the canvas bare under a fine pointer', () => {
    // Not merely invisible: every rule that shapes the lane lives in the
    // coarse-pointer layer, so an unstyled one would take a grid row of the
    // canvas and push the dock down.
    stubPointer(false);
    useLayoutStore.setState({ activeWorkspace: 'edit' });

    renderShell();

    expect(container?.querySelector('.canvas-pill-lane')).toBeNull();
  });

  it('makes the dock agree with the pointer, in both directions', () => {
    // The wiring, not the reconcile itself (that is `layoutStore.test.ts`). It
    // lives on the shell rather than beside the drawer precisely because of the
    // second half of this test: on a fine pointer the drawer is not mounted, so
    // a reconcile owned by it could never put the pane back.
    stubPointer(true);
    const docked = new Map<string, { id: string }>([
      ['crease-pattern', { id: 'crease-pattern' }],
      ['cp-view-controls', { id: 'cp-view-controls' }],
    ]);
    const dockviewApi = {
      getPanel: vi.fn((id: string) => docked.get(id) ?? null),
      removePanel: vi.fn((panel: { id: string }) => void docked.delete(panel.id)),
      addPanel: vi.fn((options: { id: string }) => {
        docked.set(options.id, { id: options.id });
        return options;
      }),
    } as unknown as DockviewApi;
    useLayoutStore.setState({ activeWorkspace: 'edit', dockviewApi });

    renderShell();

    expect(dockviewApi.removePanel).toHaveBeenCalledWith({ id: 'cp-view-controls' });
    expect([...docked.keys()]).toEqual(['crease-pattern']);

    flipPointer(false);

    expect(dockviewApi.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cp-view-controls', initialWidth: 260 })
    );
  });
});
