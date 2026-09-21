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

  it('closes on a radio pick unless the item asks to stay open', () => {
    const onOpenChange = vi.fn();
    render(
      true,
      [
        { kind: 'radio', id: 'wire', label: 'Wireframe', checked: false, onSelect: () => {} },
        {
          kind: 'radio',
          id: 'xray',
          label: 'X-ray',
          checked: false,
          keepOpen: true,
          onSelect: () => {},
        },
      ],
      onOpenChange
    );
    const [wire, xray] = menuItems();
    act(() => {
      xray?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    act(() => {
      wire?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // Labels share one column per list: a row without an icon keeps the slot
  // when a sibling draws in it, and a list with no icons keeps its labels at
  // the edge, as every icon-less menu always has.
  it('aligns a glyph-less row with its iconed siblings, per list', () => {
    render(true, [
      { kind: 'action', id: 'a', label: 'With icon', icon: <span />, onSelect: () => {} },
      { kind: 'action', id: 'b', label: 'Without', onSelect: () => {} },
      {
        kind: 'submenu',
        id: 'sub',
        label: 'Plain list',
        items: [
          { kind: 'action', id: 'c', label: 'One', onSelect: () => {} },
          { kind: 'action', id: 'd', label: 'Two', onSelect: () => {} },
        ],
      },
    ]);
    const [withIcon, without, sub] = menuItems();
    expect(withIcon?.querySelector('.context-menu__icon')).not.toBeNull();
    expect(without?.querySelector('.context-menu__icon')).not.toBeNull();
    expect(without?.querySelector('.context-menu__icon')?.childElementCount).toBe(0);
    expect(sub?.querySelector('.context-menu__icon')).not.toBeNull();
  });

  it('keeps labels at the edge in a list where nothing draws a leading slot', () => {
    render(true, [
      { kind: 'action', id: 'a', label: 'One', onSelect: () => {} },
      { kind: 'action', id: 'b', label: 'Two', onSelect: () => {} },
    ]);
    for (const row of menuItems()) expect(row.querySelector('.context-menu__icon')).toBeNull();
  });

  it('gives a disabled submenu trigger its hint as a tooltip', () => {
    render(true, [
      {
        kind: 'submenu',
        id: 'side',
        label: 'Side',
        disabled: true,
        hint: 'Turn a 3D model with Other side',
        items: [],
      },
    ]);
    const trigger = menuItems().find((element) => element.getAttribute('aria-haspopup') === 'menu');
    expect(trigger?.getAttribute('title')).toBe('Turn a 3D model with Other side');
  });

  describe('checkbox', () => {
    function checkboxes(): HTMLElement[] {
      return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]'));
    }

    it('renders a check row, ticked when on', () => {
      render(true, [
        { kind: 'checkbox', id: 'shadow', label: 'Shadow', checked: true, onToggle: () => {} },
        { kind: 'checkbox', id: 'alias', label: 'Anti-alias', checked: false, onToggle: () => {} },
      ]);
      const [shadow, alias] = checkboxes();
      expect(shadow?.getAttribute('aria-checked')).toBe('true');
      expect(shadow?.querySelector('.context-menu__icon')?.childElementCount).toBe(1);
      expect(alias?.querySelector('.context-menu__icon')?.childElementCount).toBe(0);
    });

    it('toggles and closes, unless asked to stay open', () => {
      const onToggle = vi.fn();
      const onOpenChange = vi.fn();
      render(
        true,
        [
          { kind: 'checkbox', id: 'shadow', label: 'Shadow', checked: true, onToggle },
          {
            kind: 'checkbox',
            id: 'alias',
            label: 'Anti-alias',
            checked: false,
            keepOpen: true,
            onToggle,
          },
        ],
        onOpenChange
      );
      const [shadow, alias] = checkboxes();
      act(() => {
        alias?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(onToggle).toHaveBeenCalledTimes(1);
      expect(onOpenChange).not.toHaveBeenCalled();
      act(() => {
        shadow?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(onToggle).toHaveBeenCalledTimes(2);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('carries its hint as a tooltip when disabled', () => {
      render(true, [
        {
          kind: 'checkbox',
          id: 'shadow',
          label: 'Shadow',
          checked: false,
          disabled: true,
          hint: 'Shadows are not drawn for a 3D folded model yet',
          onToggle: () => {},
        },
      ]);
      expect(checkboxes()[0]?.getAttribute('title')).toBe(
        'Shadows are not drawn for a 3D folded model yet'
      );
    });
  });

  describe('color', () => {
    // React tracks the value it last set on the instance and ignores a change
    // that lands through that same setter, so a test has to write the value
    // the way the engine does — through the prototype — before it fires input.
    function typeColor(input: HTMLInputElement, hex: string) {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      set?.call(input, hex);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function colorInput(): HTMLInputElement {
      const input = document.querySelector<HTMLInputElement>('input[type="color"]');
      if (!input) throw new Error('no colour input');
      return input;
    }

    let showPicker: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      showPicker = vi.fn();
      (HTMLInputElement.prototype as { showPicker?: () => void }).showPicker =
        showPicker as unknown as () => void;
    });
    afterEach(() => {
      delete (HTMLInputElement.prototype as { showPicker?: () => void }).showPicker;
    });

    function renderColor(overrides: { disabled?: boolean } = {}) {
      const onChange = vi.fn();
      const onCommit = vi.fn();
      render(true, [
        {
          kind: 'color',
          id: 'front',
          label: 'Front colour',
          value: '#ffff32',
          onChange,
          onCommit,
          ...overrides,
        },
      ]);
      return { onChange, onCommit };
    }

    it('is a menu item painting its swatch from the value', () => {
      renderColor();
      const [row] = menuItems();
      expect(row?.textContent).toContain('Front colour');
      // In the leading slot, where a sibling's icon or check sits, so the
      // label starts in the same column as every other row's.
      const swatch = row?.querySelector<HTMLElement>('.context-menu__icon .context-menu__swatch');
      expect(swatch?.style.background).toBe('rgb(255, 255, 50)');
      expect(colorInput().value).toBe('#ffff32');
    });

    it('opens the picker from the row, with the input focused', () => {
      renderColor();
      act(() => {
        menuItems()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(showPicker).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(colorInput());
    });

    it('falls back to a click when showPicker refuses', () => {
      showPicker.mockImplementation(() => {
        throw new DOMException('no activation', 'NotAllowedError');
      });
      renderColor();
      const click = vi.spyOn(HTMLInputElement.prototype, 'click');
      act(() => {
        menuItems()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(click).toHaveBeenCalledTimes(1);
      click.mockRestore();
    });

    it('streams changes and commits on blur', () => {
      const item = renderColor();
      act(() => {
        typeColor(colorInput(), '#ff0000');
        typeColor(colorInput(), '#00ff00');
      });
      expect(item.onChange.mock.calls).toEqual([['#ff0000'], ['#00ff00']]);
      // The swatch follows the picker even though the row's descriptor has
      // not been rebuilt — a context menu's rows never are while it is open.
      const swatch = menuItems()[0]?.querySelector<HTMLElement>('.context-menu__swatch');
      expect(swatch?.style.background).toBe('rgb(0, 255, 0)');
      expect(item.onCommit).not.toHaveBeenCalled();
      act(() => {
        colorInput().focus();
        colorInput().blur();
      });
      expect(item.onCommit).toHaveBeenCalledTimes(1);
    });

    it('commits when the menu unmounts without a blur', () => {
      const item = renderColor();
      act(() => {
        typeColor(colorInput(), '#ff0000');
      });
      act(() => {
        root?.unmount();
      });
      root = null;
      expect(item.onCommit).toHaveBeenCalledTimes(1);
    });

    function shield(): HTMLElement | null {
      return document.querySelector<HTMLElement>('.context-menu__picker-shield');
    }

    // The engine closes an open picker on any press outside it, and that press
    // then lands on the page. A shield under the menu absorbs it, so closing
    // the picker closes only the picker — not the menu, not the selection.
    it('shields the page while the picker is open, and one press takes it down', async () => {
      const onOpenChange = vi.fn();
      const onChange = vi.fn();
      const onCommit = vi.fn();
      render(
        true,
        [{ kind: 'color', id: 'front', label: 'Front colour', value: '#ffff32', onChange, onCommit }],
        onOpenChange
      );
      expect(shield()).toBeNull();
      act(() => {
        menuItems()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(shield()).not.toBeNull();
      // Radix attaches its outside-press listener a tick after opening.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const outsideSeen = vi.fn();
      document.addEventListener('pointerdown', outsideSeen);
      act(() => {
        shield()?.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
        );
      });
      document.removeEventListener('pointerdown', outsideSeen);
      // Stopped at the shield: nothing further up the document saw the press,
      // Radix included, and the menu is still open.
      expect(outsideSeen).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(shield()).toBeNull();
      // With no picker up, the next press outside dismisses as usual.
      act(() => {
        container?.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
        );
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('takes the shield down when the picker is dismissed by other means', () => {
      renderColor();
      act(() => {
        menuItems()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(shield()).not.toBeNull();
      // A picker dismissed by the engine blurs the input (iOS's sheet, a
      // press elsewhere in Chromium); nothing else on the page says it closed.
      act(() => {
        colorInput().blur();
      });
      expect(shield()).toBeNull();
    });

    /**
     * jsdom has no `:open`, so the shield tests above run the engine-cannot-say
     * path. This lends the input an engine that can: `matches(':open')`
     * answers `showing`, everything else as before.
     */
    function lendPickerState() {
      const state = { showing: false };
      const matches = Element.prototype.matches;
      vi.spyOn(HTMLInputElement.prototype, 'matches').mockImplementation(function (
        this: Element,
        selector: string
      ) {
        return selector === ':open' ? state.showing : matches.call(this, selector);
      });
      return state;
    }

    // A pick in WebKit's popover closes the popover, and the page hears
    // nothing: no blur, no event. Left up, the shield would swallow the next
    // press on the canvas.
    it('takes the shield down when the engine reports the picker closed', () => {
      vi.useFakeTimers();
      try {
        const engine = lendPickerState();
        const item = renderColor();
        engine.showing = true;
        act(() => {
          menuItems()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
        expect(shield()).not.toBeNull();
        act(() => {
          vi.advanceTimersByTime(500);
        });
        expect(shield()).not.toBeNull();
        engine.showing = false;
        act(() => {
          vi.advanceTimersByTime(100);
        });
        expect(shield()).toBeNull();
        // Nothing blurred the input, so nothing has committed yet: the next
        // press, or the menu closing, does that as ever.
        expect(document.activeElement).toBe(colorInput());
        expect(item.onCommit).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
        vi.restoreAllMocks();
      }
    });

    it('leaves the shield to the press when the picker never reports open', () => {
      vi.useFakeTimers();
      try {
        lendPickerState();
        renderColor();
        act(() => {
          menuItems()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
        act(() => {
          vi.advanceTimersByTime(1000);
        });
        expect(shield()).not.toBeNull();
      } finally {
        vi.useRealTimers();
        vi.restoreAllMocks();
      }
    });

    it('takes the shield down with the row', () => {
      renderColor();
      act(() => {
        menuItems()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(shield()).not.toBeNull();
      act(() => {
        root?.unmount();
      });
      root = null;
      expect(shield()).toBeNull();
    });

    it('does not open for a disabled row', () => {
      renderColor({ disabled: true });
      act(() => {
        menuItems()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(showPicker).not.toHaveBeenCalled();
    });

    function hover(target: Element, type: 'pointermove' | 'pointerleave') {
      act(() => {
        target.dispatchEvent(
          new PointerEvent(type, { bubbles: type === 'pointermove', pointerType: 'mouse' })
        );
      });
    }

    /** The colour row and a check row beside it, as an open menu. */
    function renderColorBesideCheck(): [HTMLElement, HTMLElement] {
      render(true, [
        { kind: 'color', id: 'front', label: 'Front colour', value: '#ffff32', onChange: () => {}, onCommit: () => {} },
        { kind: 'checkbox', id: 'shadow', label: 'Shadow', checked: true, onToggle: () => {} },
      ]);
      const [row, sibling] = document.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="menuitemcheckbox"]'
      );
      if (!row || !sibling) throw new Error('expected two rows');
      return [row, sibling];
    }

    // Radix focuses a row on every mouse move over it, and the menu when the
    // mouse leaves one. WebKit closes a colour picker the moment its input
    // blurs, so in Safari the picker went away on the first mouse movement.
    it('holds focus on the input while the picker is open, whatever the mouse does', () => {
      const [row, sibling] = renderColorBesideCheck();
      act(() => {
        row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(document.activeElement).toBe(colorInput());

      hover(row, 'pointermove');
      expect(document.activeElement).toBe(colorInput());
      hover(row, 'pointerleave');
      expect(document.activeElement).toBe(colorInput());
      // A neighbour too: a picker stays until it is dismissed, not until the
      // mouse drifts over the next row.
      hover(sibling, 'pointermove');
      expect(document.activeElement).toBe(colorInput());
      expect(shield()).not.toBeNull();
    });

    // The right-click menu keeps its colour rows in a Style submenu. One
    // picker state per menu tree, not per list, or the parent's rows would
    // still take focus while a submenu's picker is up.
    it('holds focus for a picker opened inside a submenu, over the parent rows too', () => {
      render(true, [
        { kind: 'action', id: 'flip', label: 'Flip', onSelect: () => {} },
        {
          kind: 'submenu',
          id: 'style',
          label: 'Style',
          items: [
            { kind: 'color', id: 'front', label: 'Front colour', value: '#ffff32', onChange: () => {}, onCommit: () => {} },
          ],
        },
      ]);
      const [flip, trigger] = menuItems();
      if (!flip || !trigger) throw new Error('expected two rows');
      act(() => {
        trigger.focus();
        trigger.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
        );
      });
      const row = document.querySelector<HTMLElement>('[role="menuitem"] .context-menu__swatch')?.closest<HTMLElement>('[role="menuitem"]');
      if (!row) throw new Error('submenu did not open');
      act(() => {
        row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(document.activeElement).toBe(colorInput());
      hover(row, 'pointerleave');
      hover(flip, 'pointermove');
      expect(document.activeElement).toBe(colorInput());
    });

    it('moves focus on hover again once the picker is closed', () => {
      const [row, sibling] = renderColorBesideCheck();
      act(() => {
        row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      act(() => {
        colorInput().blur();
      });
      expect(shield()).toBeNull();
      hover(sibling, 'pointermove');
      expect(document.activeElement).toBe(sibling);
    });
  });
});
