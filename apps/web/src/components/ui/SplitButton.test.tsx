import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SplitButton } from './SplitButton';

/**
 * The split button's two load-bearing rules:
 *
 * - the label runs the default action and never opens the menu (which is only
 *   unambiguous because the caret is its own hit target);
 * - both halves disable together, since a live caret over a dead primary offers
 *   a menu of unavailable items and reads as broken rather than as disabled.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(node: React.ReactNode) {
  act(() => root.render(node));
}

/** Buttons and menu items are portalled, so search the whole document. */
function byName(name: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('button,[role="menuitem"]')].find(
    (element) =>
      element.getAttribute('aria-label') === name || element.textContent?.trim() === name
  );
}

function click(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    element.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  });
}

function splitButton(overrides: Partial<Parameters<typeof SplitButton>[0]> = {}) {
  return (
    <SplitButton
      label="Send to Edit"
      menuLabel="More options"
      actions={[{ id: 'with-circles', label: 'Send to Edit (include circles)', onSelect: vi.fn() }]}
      onClick={vi.fn()}
      {...overrides}
    />
  );
}

describe('SplitButton', () => {
  it('runs the primary action on click, without opening the menu', () => {
    const onClick = vi.fn();
    const onSelect = vi.fn();
    mount(
      splitButton({
        onClick,
        actions: [{ id: 'with-circles', label: 'Send to Edit (include circles)', onSelect }],
      })
    );

    const primary = byName('Send to Edit');
    expect(primary).toBeDefined();
    click(primary as HTMLElement);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('opens the menu from the caret and runs the chosen action', () => {
    const onClick = vi.fn();
    const onSelect = vi.fn();
    mount(
      splitButton({
        onClick,
        actions: [{ id: 'with-circles', label: 'Send to Edit (include circles)', onSelect }],
      })
    );

    click(byName('More options') as HTMLElement);
    const item = byName('Send to Edit (include circles)');
    expect(item).toBeDefined();
    click(item as HTMLElement);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disables the caret with the primary', () => {
    mount(splitButton({ disabled: true }));

    expect((byName('Send to Edit') as HTMLButtonElement).disabled).toBe(true);
    expect((byName('More options') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders no caret when there is nothing behind it', () => {
    mount(splitButton({ actions: [] }));

    expect(byName('Send to Edit')).toBeDefined();
    expect(byName('More options')).toBeUndefined();
  });
});
