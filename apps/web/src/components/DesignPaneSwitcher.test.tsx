import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignPaneOption, DesignPaneSwitcherState } from '../hooks/useDesignPaneSwitcher';

const switcher = vi.hoisted(() => ({
  /** TreeMaker's four panes on a phone: more than a toggle can say, so a list. */
  panes: [
    { id: 'tree', component: 'treemaker-tree', title: 'Tree' },
    { id: 'inspector', component: 'treemaker-inspector', title: 'Inspector' },
    { id: 'diagnostics', component: 'treemaker-diagnostics', title: 'Diagnostics' },
    { id: 'conditions', component: 'treemaker-conditions', title: 'Conditions' },
  ] as DesignPaneOption[],
  show: vi.fn(),
}));

vi.mock('../hooks/useDesignPaneSwitcher', () => ({
  useDesignPaneSwitcher: (): DesignPaneSwitcherState => ({
    panes: switcher.panes,
    active: switcher.panes[0]!,
    floating: true,
    show: switcher.show,
  }),
}));

import { useLayoutStore } from '../store/layoutStore';
import { DesignPaneSwitcher } from './DesignPaneSwitcher';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Design's pane list on a phone: a sheet like every other (rf6) — in the
 * sheet layer, under a dialog opened over it, which then has the Escape.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let layer: HTMLDivElement | null = null;
let modals: HTMLDivElement | null = null;

beforeEach(() => {
  // As App lays the document out: the sheet layer, then the modals.
  layer = document.body.appendChild(document.createElement('div'));
  modals = document.body.appendChild(document.createElement('div'));
  useLayoutStore.setState({ sheetLayer: layer });
  container = document.body.appendChild(document.createElement('div'));
  root = createRoot(container);
  act(() => root?.render(<DesignPaneSwitcher />));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  layer?.remove();
  modals?.remove();
  container = layer = modals = null;
  useLayoutStore.setState({ sheetLayer: null });
  switcher.show.mockClear();
});

const trigger = () => container?.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
const sheet = () => layer?.querySelector<HTMLElement>('[role="dialog"]') ?? null;
const escape = (target: EventTarget) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });

describe('Design’s pane list', () => {
  it('opens in the sheet layer, under a dialog opened over it, and leaves Escape to that dialog (rf6)', () => {
    act(() => trigger()?.click());
    expect(sheet()).not.toBeNull();
    expect(sheet()?.id).toBe(trigger()?.getAttribute('aria-controls'));

    // A dialog a shortcut opened while the list was up: on top, and Escape is its own.
    const dialog = modals!.appendChild(document.createElement('div'));
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    escape(dialog);
    expect(sheet()).not.toBeNull();

    dialog.remove();
    escape(window);
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('stands down for an open layer’s Escape, as every sheet does', () => {
    act(() => trigger()?.click());
    // A menu or an open Select's list, portaled outside the sheet and holding focus.
    const menu = modals!.appendChild(document.createElement('div'));
    menu.setAttribute('role', 'menu');
    escape(menu);
    expect(sheet()).not.toBeNull();
  });
});
