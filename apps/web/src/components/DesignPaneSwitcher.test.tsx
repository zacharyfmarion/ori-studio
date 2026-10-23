import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLayoutStore } from '../store/layoutStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { singleDesignTab } from '../store/workspaceStore/designTabs';
import type { DesignKindId } from '../designKinds';
import { DesignPaneSwitcher } from './DesignPaneSwitcher';
import { TooltipProvider } from './ui/Tooltip';

/**
 * The phone's way between a design's panes: a toggle for a kind with two, a
 * list for one with more, and nothing for a kind whose panes are a flow.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** Every query the phone layout asks contains "pointer: coarse" (`phoneLayoutQuery`). */
function stubLayout(phone: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: phone && query.includes('pointer: coarse'),
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
}

function render(kind: DesignKindId, { phone = true } = {}) {
  stubLayout(phone);
  useLayoutStore.setState({ activeWorkspace: 'design', designPaneId: null });
  useWorkspaceStore.setState(
    { ...useWorkspaceStore.getInitialState(), ...singleDesignTab(kind) },
    true
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <TooltipProvider>
        <DesignPaneSwitcher />
      </TooltipProvider>
    );
  });
  return container;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useLayoutStore.setState({ designPaneId: null });
});

const buttons = () => [...(container?.querySelectorAll('button') ?? [])];
const press = (element: Element | null | undefined) =>
  act(() => element?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const paneList = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Panes"]');

describe('a kind with two panes', () => {
  it('is one pill, named for the pane you are not looking at', () => {
    render('box-pleat');

    expect(buttons().map((button) => button.textContent)).toEqual(['BP Editor']);
    expect(buttons()[0].getAttribute('aria-haspopup')).toBeNull();
  });

  it('goes there in one press, and then names the way back', () => {
    render('box-pleat');

    press(buttons()[0]);

    // Stored and reported: `activePanelId` drives the menus, the undo stack and
    // the shortcut scope.
    expect(useLayoutStore.getState().designPaneId).toBe('bp-editor');
    expect(useWorkspaceStore.getState().activePanelId).toBe('bp-editor');
    expect(buttons().map((button) => button.textContent)).toEqual(['Tree editor']);
  });
});

describe('a kind with more than two', () => {
  it('names the pane on screen and opens a list of them all', () => {
    render('treemaker');
    const [trigger] = buttons();

    expect(trigger.textContent).toBe('Design');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    press(trigger);

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const rows = [...(paneList()?.querySelectorAll('li > button') ?? [])];
    expect(rows.map((row) => row.textContent)).toEqual([
      'Design',
      'Inspector',
      'Diagnostics',
      'Conditions',
    ]);
    expect(rows.map((row) => row.getAttribute('aria-current'))).toEqual([
      'true',
      null,
      null,
      null,
    ]);
  });

  it('shows the pane chosen and closes, handing focus back to the pill', () => {
    render('treemaker');
    const [trigger] = buttons();
    press(trigger);

    const conditions = [...(paneList()?.querySelectorAll('li > button') ?? [])].find(
      (row) => row.textContent === 'Conditions'
    );
    press(conditions);

    expect(useLayoutStore.getState().designPaneId).toBe('conditions');
    expect(paneList()).toBeNull();
    expect(document.activeElement).toBe(buttons()[0]);
    expect(buttons()[0].textContent).toBe('Conditions');
  });

  it('closes on Escape without choosing', () => {
    render('treemaker');
    press(buttons()[0]);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(paneList()).toBeNull();
    expect(useLayoutStore.getState().designPaneId).toBeNull();
  });
});

describe('where there is nothing to switch', () => {
  it('stays out of a kind whose panes are a flow', () => {
    // ExplOri's own Search and Back buttons are its navigation.
    render('explori');

    expect(buttons()).toHaveLength(0);
  });

  it('stays out of every layout but the phone one', () => {
    render('box-pleat', { phone: false });

    expect(buttons()).toHaveLength(0);
  });
});
