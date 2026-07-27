import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu } from './ContextMenu';
import type { ContextMenuItem } from './contextMenuTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Radix menu touches a few pointer/scroll APIs that jsdom does not implement.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(open: boolean, items: ContextMenuItem[], onOpenChange = () => {}) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <ContextMenu open={open} x={10} y={20} items={items} onOpenChange={onOpenChange} />
    );
  });
}

function menuItems(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
}

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ContextMenu', () => {
  it('renders nothing when closed', () => {
    render(false, [{ kind: 'action', id: 'a', label: 'Flip', onSelect: () => {} }]);
    expect(menuItems()).toHaveLength(0);
  });

  it('renders action items with their labels when open', () => {
    render(true, [
      { kind: 'action', id: 'flip', label: 'Flip', onSelect: () => {} },
      { kind: 'separator' },
      { kind: 'action', id: 'delete', label: 'Delete', danger: true, onSelect: () => {} },
    ]);
    const labels = menuItems().map((element) => element.textContent);
    expect(labels).toEqual(['Flip', 'Delete']);
    expect(document.querySelector('[role="separator"]')).not.toBeNull();
  });

  it('invokes onSelect when an item is clicked', () => {
    const onSelect = vi.fn();
    render(true, [{ kind: 'action', id: 'flip', label: 'Flip', onSelect }]);
    const item = menuItems()[0];
    expect(item).toBeDefined();
    act(() => {
      item?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  // The anchor must sit under the cursor in viewport coordinates. It is portaled
  // to document.body because `position: fixed` resolves against any transformed /
  // will-change-promoted ancestor, and callers render this inside the CP viewport
  // (a centring grid) inside transformed Dockview panels — where it would
  // otherwise drift to the container's origin or get centred over the model.
  it('anchors to the cursor via a fixed, body-level element', () => {
    render(true, [{ kind: 'action', id: 'flip', label: 'Flip', onSelect: () => {} }]);
    const anchor = document.querySelector<HTMLElement>('[data-context-menu-anchor]');
    expect(anchor).not.toBeNull();
    expect(anchor?.parentElement).toBe(document.body);
    expect(anchor?.style.position).toBe('fixed');
    expect(anchor?.style.left).toBe('10px');
    expect(anchor?.style.top).toBe('20px');
  });

  it('marks disabled items so they cannot be selected', () => {
    const onSelect = vi.fn();
    render(true, [{ kind: 'action', id: 'flip', label: 'Flip', disabled: true, onSelect }]);
    const item = menuItems()[0];
    expect(item?.getAttribute('data-disabled')).not.toBeNull();
    act(() => {
      item?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders a submenu as a trigger, keeping its items out of the top level', () => {
    render(true, [
      { kind: 'action', id: 'flip', label: 'Flip', onSelect: () => {} },
      {
        kind: 'submenu',
        id: 'style',
        label: 'Display style',
        items: [
          { kind: 'radio', id: 'paper', label: 'Paper', checked: true, onSelect: () => {} },
          { kind: 'radio', id: 'wire', label: 'Wireframe', checked: false, onSelect: () => {} },
        ],
      },
    ]);
    // The trigger is itself a menuitem (Radix SubTrigger), distinguished by
    // aria-haspopup rather than by being absent from the item list. Scoped to
    // menuitems so it does not match the menu's own invisible cursor anchor.
    const trigger = menuItems().find(
      (element) => element.getAttribute('aria-haspopup') === 'menu'
    );
    expect(trigger?.textContent).toContain('Display style');
    // Closed submenu: its options are not in the document yet, so they cannot be
    // reached by a stray click on the parent menu.
    const labels = menuItems().map((element) => element.textContent);
    expect(labels).toContain('Flip');
    expect(labels).not.toContain('Paper');
    expect(labels).not.toContain('Wireframe');
  });

  it('renders radio items with a check on the current one', () => {
    render(true, [
      { kind: 'radio', id: 'paper', label: 'Paper', checked: true, onSelect: () => {} },
      { kind: 'radio', id: 'wire', label: 'Wireframe', checked: false, onSelect: () => {} },
    ]);
    const [paper, wire] = menuItems();
    // The check lives in the leading icon slot; only the current option fills it.
    expect(paper?.querySelector('.context-menu__icon')?.childElementCount).toBe(1);
    expect(wire?.querySelector('.context-menu__icon')?.childElementCount).toBe(0);
  });

  it('invokes onSelect for a radio item', () => {
    const onSelect = vi.fn();
    render(true, [{ kind: 'radio', id: 'wire', label: 'Wireframe', checked: false, onSelect }]);
    act(() => {
      menuItems()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
