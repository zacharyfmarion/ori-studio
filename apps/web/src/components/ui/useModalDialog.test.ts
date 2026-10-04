import { afterEach, describe, expect, it } from 'vitest';
import { dialogOpener, isTopmostDialog, topmostModalDialog } from './useModalDialog';

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
