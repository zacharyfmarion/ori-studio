import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const menu = vi.hoisted(() => ({ handleMenuAction: vi.fn() }));

vi.mock('../commands/menuActions', () => ({ handleMenuAction: menu.handleMenuAction }));

const capabilities = vi.hoisted(() => ({
  value: {} as Record<string, { enabled: boolean; visible: boolean; label: string; reason: string }>,
}));

vi.mock('../store/workspaceStore/useWorkspaceCapabilities', () => ({
  useWorkspaceCapabilities: () => capabilities.value,
}));

import { useLayoutStore } from '../store/layoutStore';
import { TooltipProvider } from './ui/Tooltip';
import { CanvasHistoryPills } from './CanvasHistoryPills';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialLayoutState = useLayoutStore.getInitialState();

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function stubCapabilities(options: { undo?: boolean; redo?: boolean } = {}) {
  const one = (enabled: boolean, label: string) => ({
    enabled,
    visible: true,
    label,
    reason: label,
  });
  capabilities.value = {
    'edit.undo': one(options.undo ?? true, 'Undo'),
    'edit.redo': one(options.redo ?? true, 'Redo'),
  };
}

function render() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  // `IconButton` renders a Radix tooltip whenever it has a title, and Radix
  // throws without a provider. App.tsx wraps the whole app in one.
  act(() =>
    root?.render(
      <TooltipProvider>
        <CanvasHistoryPills />
      </TooltipProvider>
    )
  );
}

const buttons = () => [...(container?.querySelectorAll('button') ?? [])];
const button = (label: string) =>
  buttons().find((candidate) => candidate.getAttribute('aria-label') === label);

beforeEach(() => {
  useLayoutStore.setState({ ...initialLayoutState, activeWorkspace: 'edit' }, true);
  menu.handleMenuAction.mockClear();
  stubCapabilities();
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  useLayoutStore.setState(initialLayoutState, true);
});

describe('the canvas history pills', () => {
  it('offers undo and redo in the Edit workspace', () => {
    render();

    expect(buttons().map((each) => each.getAttribute('aria-label'))).toEqual(['Undo', 'Redo']);
  });

  it.each(['design', 'simulate'] as const)('renders nothing in the %s workspace', (workspace) => {
    // Simulate shows both in its Edit menu, but they act on the crease pattern
    // you are not looking at; Design's panes are a separate piece of work. A
    // pill that edits something off-screen is worse than no pill.
    useLayoutStore.setState({ activeWorkspace: workspace });

    render();

    expect(buttons()).toHaveLength(0);
  });

  it('dispatches through the menu-action chokepoint', () => {
    // Not a store call: `handleMenuAction` is what keeps one implementation
    // behind the menu item, the keyboard chord and this button — and it is where
    // the analytics event is captured, which is why these add none of their own.
    render();

    act(() => button('Undo')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    act(() => button('Redo')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(menu.handleMenuAction.mock.calls).toEqual([['edit.undo'], ['edit.redo']]);
  });

  it('disables each side independently, from the capability layer', () => {
    // The capability resolves per active editing context — the CP editor's own
    // stack, or the active design kind's. A pill wired straight to
    // `oristudioCpHistoryPast` would be grey over a design with edits behind it.
    stubCapabilities({ undo: true, redo: false });

    render();

    expect(button('Undo')?.disabled).toBe(false);
    expect(button('Redo')?.disabled).toBe(true);
  });
});
