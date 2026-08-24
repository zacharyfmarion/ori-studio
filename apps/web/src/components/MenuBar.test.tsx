import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pruneMenuItems } from '../menus/menuVisibility';
import { PHONE_MEDIA_QUERY } from '../platform/phoneLayout';
import type { MenuItemDef } from '../menus/menuDefinition';
import type { WorkspaceCapabilities } from '../lib/workspaceCapabilities';
import { MenuBar } from './MenuBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// pruneMenuItems only reads capabilities[id].visible; ids absent from the map
// default to visible, so a partial fixture suffices.
function caps(visibility: Record<string, boolean>): WorkspaceCapabilities {
  const entries = Object.fromEntries(
    Object.entries(visibility).map(([id, visible]) => [
      id,
      { visible, enabled: visible, label: id, reason: '' },
    ])
  );
  return entries as unknown as WorkspaceCapabilities;
}

const exportItems: MenuItemDef[] = [
  { type: 'action', id: 'file.exportV5', label: 'Export TreeMaker 5...' },
  { type: 'action', id: 'file.exportV4', label: 'Export TreeMaker 4...' },
  { type: 'separator' },
  { type: 'action', id: 'file.exportCp', label: 'Export CP...' },
  { type: 'action', id: 'file.exportBps', label: 'Export .bps...' },
  { type: 'separator' },
  { type: 'action', id: 'file.exportSvg', label: 'Export SVG...' },
];

describe('pruneMenuItems', () => {
  it('drops separators orphaned around a lone visible item', () => {
    const pruned = pruneMenuItems(
      exportItems,
      caps({
        'file.exportV5': false,
        'file.exportV4': false,
        'file.exportCp': false,
        'file.exportBps': true,
        'file.exportSvg': false,
      })
    );
    expect(pruned).toEqual([{ type: 'action', id: 'file.exportBps', label: 'Export .bps...' }]);
  });

  it('keeps a separator that divides two visible groups', () => {
    const pruned = pruneMenuItems(
      exportItems,
      caps({
        'file.exportV5': true,
        'file.exportV4': false,
        'file.exportCp': false,
        'file.exportBps': false,
        'file.exportSvg': true,
      })
    );
    expect(pruned.map((item) => (item.type === 'action' ? item.id : item.type))).toEqual([
      'file.exportV5',
      'separator',
      'file.exportSvg',
    ]);
  });

  it('collapses leading and doubled separators', () => {
    const items: MenuItemDef[] = [
      { type: 'separator' },
      { type: 'separator' },
      { type: 'action', id: 'file.exportBps', label: 'Export .bps...' },
      { type: 'separator' },
    ];
    expect(pruneMenuItems(items, caps({ 'file.exportBps': true }))).toEqual([
      { type: 'action', id: 'file.exportBps', label: 'Export .bps...' },
    ]);
  });
});

/**
 * jsdom has no `matchMedia`, so the phone predicate answers `false` and the bar
 * renders its desktop arm — which is what every other test in this file wants,
 * and why the phone arm needs this. A stub, not a boolean: `useIsPhoneLayout`
 * subscribes to the query, and one that cannot be subscribed to would throw on
 * mount rather than fail on an assertion.
 */
function stubViewport(isPhone: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === PHONE_MEDIA_QUERY ? isPhone : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function renderMenuBar(): HTMLDivElement {
  container = document.createElement('div');
  // The dropdown measures its floor against `.app-layout`; without one the hook
  // finds neither shell nor tab bar and leaves the cap to the stylesheet, which
  // is the branch this exercises.
  container.className = 'app-layout';
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(createElement(MenuBar)));
  return container;
}

function openMenu(host: HTMLElement, label: string): void {
  const trigger = [...host.querySelectorAll<HTMLButtonElement>('.menubar__trigger')].find(
    (button) => button.textContent?.trim() === label
  );
  if (!trigger) throw new Error(`no menu named ${label}`);
  act(() => trigger.click());
}

function submenuTrigger(host: HTMLElement, label: string): HTMLButtonElement {
  const trigger = [
    ...host.querySelectorAll<HTMLButtonElement>('.menu-dropdown__item--submenu'),
  ].find((button) => button.textContent?.trim().startsWith(label));
  if (!trigger) throw new Error(`no submenu named ${label}`);
  return trigger;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('the menu bar on a phone', () => {
  it('expands a submenu in place, and says so', () => {
    stubViewport(true);
    const host = renderMenuBar();
    openMenu(host, 'File');

    const exportTrigger = submenuTrigger(host, 'Export');
    expect(exportTrigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(exportTrigger.getAttribute('aria-expanded')).toBe('false');
    // Collapsed means gone from the tree, not merely hidden.
    expect(host.querySelectorAll('[role="menu"]')).toHaveLength(1);

    act(() => exportTrigger.click());
    expect(exportTrigger.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelectorAll('[role="menu"]')).toHaveLength(2);
    expect(host.querySelector('.menu-dropdown__group')).not.toBeNull();
    expect(
      host.querySelectorAll('.menu-dropdown__group .menu-dropdown__item').length
    ).toBeGreaterThan(0);

    act(() => exportTrigger.click());
    expect(exportTrigger.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('.menu-dropdown__group')).toBeNull();
  });

  it('never emits the fly-out classes, so no overflow can clip one', () => {
    stubViewport(true);
    const host = renderMenuBar();
    openMenu(host, 'File');
    act(() => submenuTrigger(host, 'Export').click());

    // `.menu-dropdown--submenu` is what `top: -5px; left: calc(100% - 4px)` and
    // the `:hover` / `:focus-within` reveal both key off. Absent, the scroll
    // container on the root has nothing left to clip.
    expect(host.querySelector('.menu-dropdown--submenu')).toBeNull();
    expect(host.querySelector('.menu-dropdown--phone')).not.toBeNull();
  });

  it('keeps one group open at a time', () => {
    stubViewport(true);
    const host = renderMenuBar();
    openMenu(host, 'Edit');

    // Select, Node, Edge, Strain, Stubs — asserted so this cannot go vacuous if
    // a capability change ever prunes the menu down to one group.
    const groups = [...host.querySelectorAll<HTMLButtonElement>('.menu-dropdown__item--submenu')];
    expect(groups.length).toBeGreaterThanOrEqual(2);

    act(() => groups[0].click());
    act(() => groups[1].click());
    expect(groups[0].getAttribute('aria-expanded')).toBe('false');
    expect(groups[1].getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelectorAll('.menu-dropdown__group')).toHaveLength(1);
  });

  /**
   * The regression is specifically `pointerdown`, and specifically outside the
   * bar. `mousedown` is a compatibility event on touch — synthesised after
   * `touchend`, and not synthesised at all when the page claims the contact —
   * so over the crease-pattern canvas it never arrives and the only way out of
   * an open menu goes with it. Measured in Mobile Safari before the fix: one tap
   * on the canvas selected a crease and left File standing.
   */
  it('closes on a pointerdown outside it, without waiting for a mouse event', () => {
    stubViewport(true);
    const host = renderMenuBar();
    openMenu(host, 'File');
    expect(host.querySelector('.menu-dropdown')).not.toBeNull();

    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(host.querySelector('.menu-dropdown')).toBeNull();
  });

  it('leaves a pointerdown on its own rows alone', () => {
    stubViewport(true);
    const host = renderMenuBar();
    openMenu(host, 'File');

    const row = host.querySelector('.menu-dropdown__item');
    act(() => {
      row!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    // Otherwise the menu would tear itself down under the finger between
    // pointerdown and click, and no row could ever be chosen.
    expect(host.querySelector('.menu-dropdown')).not.toBeNull();
  });
});

describe('the menu bar on a mouse', () => {
  it('keeps the fly-out mounted and claims nothing about its open state', () => {
    stubViewport(false);
    const host = renderMenuBar();
    openMenu(host, 'File');

    const exportTrigger = submenuTrigger(host, 'Export');
    // The open state is `:hover` / `:focus-within` here, so React genuinely does
    // not know it — and a hardcoded `aria-expanded` would be a lie.
    expect(exportTrigger.hasAttribute('aria-expanded')).toBe(false);
    expect(host.querySelector('.menu-dropdown--submenu')).not.toBeNull();
    expect(host.querySelector('.menu-dropdown__group')).toBeNull();
    expect(host.querySelector('.menu-dropdown--phone')).toBeNull();

    // Clicking it does nothing at all: the fly-out is CSS's business.
    act(() => exportTrigger.click());
    expect(host.querySelector('.menu-dropdown--submenu')).not.toBeNull();
    expect(host.querySelector('.menu-dropdown__group')).toBeNull();
  });

  it('still dismisses on mousedown, and only on mousedown', () => {
    stubViewport(false);
    const host = renderMenuBar();
    openMenu(host, 'File');

    // The extra `pointerdown` listener is the phone's, and a fine pointer must
    // not acquire it: `mousedown` reaches this bar on every surface that has a
    // mouse, and an earlier close would be a behaviour change nobody asked for.
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(host.querySelector('.menu-dropdown')).not.toBeNull();

    act(() => {
      document.body.dispatchEvent(new Event('mousedown', { bubbles: true }));
    });
    expect(host.querySelector('.menu-dropdown')).toBeNull();
  });
});
