import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dialogOpener, isTopmostDialog, topmostModalDialog, useModalDialog } from './useModalDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
});

function element<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  document.body.append(node);
  return node;
}

describe('what a dialog gives focus back to', () => {
  it('is what has focus, or nothing for the page itself', () => {
    expect(dialogOpener()).toBeNull();
    const button = element('button');
    button.focus();
    expect(dialogOpener()).toBe(button);
  });

  it('is the button that opened a menu, for a row of that menu, which goes with it', () => {
    const trigger = element('button', { id: 'menu-trigger' });
    const menu = element('div', { role: 'menu', 'aria-labelledby': 'menu-trigger' });
    const row = document.createElement('div');
    row.setAttribute('role', 'menuitem');
    row.tabIndex = -1;
    menu.append(row);
    row.focus();
    expect(dialogOpener()).toBe(trigger);
  });

  it('is nothing for a row of a menu opened at the pointer, whose anchor cannot take focus', () => {
    element('span', { id: 'anchor', 'aria-hidden': 'true' });
    const menu = element('div', { role: 'menu', 'aria-labelledby': 'anchor' });
    const row = document.createElement('div');
    row.setAttribute('role', 'menuitem');
    row.tabIndex = -1;
    menu.append(row);
    row.focus();
    expect(dialogOpener()).toBeNull();
  });
});

describe('the dialog on top', () => {
  it('is the last modal dialog in the document', () => {
    expect(topmostModalDialog()).toBeNull();
    const first = element('div', { role: 'dialog', 'aria-modal': 'true' });
    expect(isTopmostDialog(first)).toBe(true);
    const second = element('div', { role: 'dialog', 'aria-modal': 'true' });
    element('div', { role: 'dialog' });
    expect(topmostModalDialog()).toBe(second);
    expect(isTopmostDialog(first)).toBe(false);
  });
});

describe('a modal dialog’s focus and Escape', () => {
  function Dialog({ onEscape }: { onEscape: () => void }) {
    const { rootRef, documentRef, keepFocus } = useModalDialog(onEscape, null);
    return (
      <div ref={rootRef} role="dialog" aria-modal="true" data-shortcut-barrier="">
        <div ref={documentRef} role="document" tabIndex={-1} onBlur={keepFocus}>
          <button type="button">First</button>
          <input type="checkbox" aria-label="Also" />
          <input type="text" aria-label="Name" />
          <button type="button">Last</button>
        </div>
      </div>
    );
  }

  function open() {
    const behind = element('button');
    behind.textContent = 'Behind';
    const host = element('div');
    const root = createRoot(host);
    const onEscape = vi.fn();
    act(() => root.render(<Dialog onEscape={onEscape} />));
    const named = (name: string) =>
      [...host.querySelectorAll<HTMLElement>('button, input')].find(
        (control) => control.textContent === name || control.getAttribute('aria-label') === name
      )!;
    const surface = host.querySelector<HTMLElement>('[role="document"]')!;
    const press = (key: string, shiftKey = false) => {
      const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
      act(() => void document.activeElement!.dispatchEvent(event));
      return event;
    };
    return { behind, named, surface, press, onEscape, close: () => act(() => root.unmount()) };
  }

  it('takes Tab round from its last control to its first, and Shift+Tab the other way', () => {
    const { named, surface, press, close } = open();
    named('Last').focus();
    expect(press('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(named('First'));
    press('Tab', true);
    expect(document.activeElement).toBe(named('Last'));
    surface.focus();
    press('Tab', true);
    expect(document.activeElement).toBe(named('Last'));
    // Between, Tab is the browser's.
    named('First').focus();
    expect(press('Tab').defaultPrevented).toBe(false);
    close();
  });

  it('takes back focus that lands on the page behind it', () => {
    const { behind, surface, close } = open();
    act(() => behind.focus());
    expect(document.activeElement).toBe(surface);
    close();
  });

  it('keeps Alt+← and Alt+→ from going Back or Forward, but leaves them to a field', () => {
    const { named, press, close } = open();
    const alt = (key: string) => {
      const event = new KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true });
      act(() => void document.activeElement!.dispatchEvent(event));
      return event.defaultPrevented;
    };
    named('First').focus();
    expect([alt('ArrowLeft'), alt('ArrowRight')]).toEqual([true, true]);
    named('Name').focus();
    expect(alt('ArrowLeft')).toBe(false);
    expect(press('ArrowLeft').defaultPrevented).toBe(false);
    close();
  });

  it('closes on Escape from a checkbox, which does nothing with it, but not from a field, whose Escape it is', () => {
    const { named, press, onEscape, close } = open();
    named('Also').focus();
    press('Escape');
    expect(onEscape).toHaveBeenCalledOnce();
    named('Name').focus();
    press('Escape');
    expect(onEscape).toHaveBeenCalledOnce();
    close();
  });
});
