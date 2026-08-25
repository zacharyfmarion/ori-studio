import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The real view-controls panes read the workspace store, which pulls in workers
 * and wasm. The subject here is the drawer around them, so they are replaced by
 * a body with one focusable field — enough to exercise the one thing the drawer
 * has to get right about focus (see the Escape tests below).
 */
vi.mock('./panels/CpViewControlsPanel', () => ({
  CpViewControlsPanel: () => <input aria-label="grid size" defaultValue="8" />,
}));
vi.mock('./panels/SimulatorViewControlsPanel', () => ({
  SimulatorViewControlsPanel: () => <p>simulator view controls</p>,
}));

const analytics = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../analytics')>();
  return { ...actual, track: analytics.track };
});

import { useLayoutStore } from '../store/layoutStore';
import { WorkspaceViewDrawer } from './WorkspaceViewDrawer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialLayoutState = useLayoutStore.getInitialState();

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

function render() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<WorkspaceViewDrawer />));
}

const trigger = () => container?.querySelector<HTMLButtonElement>('.view-drawer__trigger');
/**
 * `document`, not `container`. The sheet is portaled to `document.body` because
 * the pill lane it renders inside is `pointer-events: none` and a stacking
 * context — see the comment at the `createPortal` call.
 */
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const sheet = () => document.querySelector<HTMLElement>('.view-drawer__sheet');

function press(element: Element | null | undefined) {
  act(() => element?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function pointerDown(element: Element | null | undefined) {
  act(() => element?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true })));
}

function pressEscape(target: EventTarget = window) {
  act(() =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  );
}

beforeEach(() => {
  useLayoutStore.setState({ ...initialLayoutState, activeWorkspace: 'edit' }, true);
  analytics.track.mockClear();
  stubPointer(true);
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

describe('the workspace View drawer', () => {
  it('renders nothing under a fine pointer', () => {
    // The pane is docked there, and a second way to reach it would be two
    // affordances for one job.
    stubPointer(false);

    render();

    expect(container?.innerHTML).toBe('');
  });

  it('renders nothing in the Design workspace', () => {
    // Its panes live in the active tab's own dock, and there is no single "view
    // pane" among them. Deliberately out of scope.
    useLayoutStore.setState({ activeWorkspace: 'design' });

    render();

    expect(trigger()).toBeNull();
  });

  it('opens the pane from a floating trigger', () => {
    render();

    expect(trigger()?.getAttribute('aria-expanded')).toBe('false');
    expect(dialog()).toBeNull();

    press(trigger());

    expect(trigger()?.getAttribute('aria-expanded')).toBe('true');
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    expect(dialog()?.getAttribute('aria-label')).toBe('View options');
    // The trigger names the thing it opened, which is the dialog it opened.
    expect(dialog()?.id).toBe(trigger()?.getAttribute('aria-controls'));
    expect(document.querySelector('input[aria-label="grid size"]')).not.toBeNull();
  });

  it('shows the workspace its own controls', () => {
    useLayoutStore.setState({ activeWorkspace: 'simulate' });
    render();

    press(trigger());

    expect(dialog()?.textContent).toContain('simulator view controls');
  });

  it('reports that the drawer was opened', () => {
    // No menu action reaches the drawer, so the `handleMenuAction` chokepoint
    // cannot see it — and whether people find the controls again after the pane
    // stopped being docked is the question this change raises.
    useLayoutStore.setState({ activeWorkspace: 'simulate' });
    render();

    press(trigger());

    expect(analytics.track).toHaveBeenCalledWith('view drawer opened', {
      workspace: 'simulate',
    });
  });

  it('counts one visit even if the trigger is activated again while open', () => {
    // There is no focus trap, so the trigger stays in the tab order behind the
    // backdrop and a keyboard can reach it. Firing `view drawer opened` a second
    // time for the same visit would inflate the one number this change added.
    render();

    press(trigger());
    press(trigger());

    expect(analytics.track).toHaveBeenCalledTimes(1);
    expect(dialog()).not.toBeNull();
  });

  it('closes on Escape and hands focus back to the trigger', () => {
    render();
    press(trigger());
    expect(document.activeElement).toBe(sheet());

    pressEscape();

    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('leaves Escape to a field that is being edited', () => {
    // The pane is full of `NumberField`s whose own Escape reverts the half-typed
    // draft before blurring — a React bubble handler, which the drawer's capture
    // listener would otherwise beat. Committing a number the user was cancelling
    // *and* closing the sheet is two wrong answers to one key.
    render();
    press(trigger());
    const field = document.querySelector<HTMLInputElement>('input[aria-label="grid size"]');
    act(() => field?.focus());

    pressEscape(field as EventTarget);

    expect(dialog()).not.toBeNull();
  });

  it('closes on a backdrop press but not on a press inside the sheet', () => {
    render();
    press(trigger());

    press(sheet());
    expect(dialog()).not.toBeNull();

    press(dialog());
    expect(dialog()).toBeNull();
  });

  it('does not dismiss on pointerdown, so a backdrop tap cannot retarget behind it', () => {
    // Dismissing on `pointerdown` unmounts the backdrop inside the same commit,
    // and the browser retargets the rest of the gesture to whatever is newly
    // under the finger. Measured on an iPad: a backdrop tap over the tool rail
    // closed the drawer *and* switched the active tool to Eraser, leaving the
    // next canvas tap to delete a crease nobody aimed at. `click` fires only
    // after the press has resolved against this element, so there is nothing
    // left to retarget — this pins that.
    render();
    press(trigger());

    pointerDown(dialog());

    expect(dialog()).not.toBeNull();
  });

  it('closes itself when the pointer stops being coarse', () => {
    // Otherwise the trigger unmounts under an open dialog, leaving it holding
    // focus with nothing to hand it back to.
    render();
    press(trigger());

    flipPointer(false);

    expect(dialog()).toBeNull();
    expect(trigger()).toBeNull();
  });

  it('closes when the workspace changes under it', () => {
    render();
    press(trigger());

    act(() => useLayoutStore.setState({ activeWorkspace: 'simulate' }));

    expect(dialog()).toBeNull();
  });
});
// The dock reconcile that pairs with this drawer moved to `useViewPanelReconcile`,
// called by `WorkspaceShell` — it has to keep running on the pointer where this
// component does not render at all. Its wiring test moved with it, to
// `WorkspaceShell.test.tsx`.
