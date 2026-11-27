// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { focusedByPointer, installFocusOriginTracker } from './focusOrigin';

let uninstall: (() => void) | null = null;
afterEach(() => {
  uninstall?.();
  uninstall = null;
  document.body.replaceChildren();
});

/** A press as Chromium makes one: the pointer goes down, then the button takes focus. */
function press(element: HTMLElement): void {
  element.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  element.focus();
}

function key(element: Element, name: string): void {
  element.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
}

function buttons(count: number): HTMLButtonElement[] {
  const made = Array.from({ length: count }, () => document.createElement('button'));
  document.body.append(...made);
  return made;
}

describe('how focus arrived', () => {
  it('holds a pressed button as the pointer’s, through the keys pressed since', () => {
    uninstall = installFocusOriginTracker(window);
    const [rail] = buttons(1);
    press(rail!);
    expect(focusedByPointer(rail!)).toBe(true);
    // Shift+R takes Repeat in hand; focus stays where the press put it.
    key(rail!, 'R');
    expect(focusedByPointer(rail!)).toBe(true);
  });

  it('holds focus the keyboard moved as the keyboard’s, even back to a button once pressed', () => {
    uninstall = installFocusOriginTracker(window);
    const [first, second] = buttons(2);
    press(first!);
    key(first!, 'Tab');
    second!.focus();
    expect(focusedByPointer(second!)).toBe(false);
    expect(focusedByPointer(first!)).toBe(false);
    key(second!, 'Tab');
    first!.focus();
    expect(focusedByPointer(first!)).toBe(false);
  });

  it('answers no for no element, and forgets every press once uninstalled', () => {
    uninstall = installFocusOriginTracker(window);
    const [button] = buttons(1);
    press(button!);
    expect(focusedByPointer(null)).toBe(false);
    uninstall();
    uninstall = null;
    expect(focusedByPointer(button!)).toBe(false);
  });
});
