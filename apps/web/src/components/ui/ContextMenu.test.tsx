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
});
