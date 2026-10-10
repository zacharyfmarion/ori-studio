import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { isShortcutEditingTarget } from '../../keyboard/shortcutDispatcher';
import { DiagramColorSelect } from './DiagramColorSelect';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  // What Radix's select asks of the DOM, which jsdom does not have.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

function render(value: string | null, onChange = vi.fn()) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(<DiagramColorSelect variant="row" label="Color" value={value} ink="#231f20" onChange={onChange} />));
  return onChange;
}

const trigger = () => container!.querySelector<HTMLButtonElement>('button[aria-label="Color"]')!;
const open = () =>
  act(() => {
    trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
const choose = (name: string) =>
  act(() => {
    const option = options().find((each) => each.textContent === name)!;
    option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });

describe('DiagramColorSelect (17a)', () => {
  it('offers Ink, References’ magenta, five print colours and Custom…, each a swatch and a name', () => {
    render(null);
    expect(trigger().textContent).toBe('Ink');
    open();
    expect(options().map((option) => option.textContent)).toEqual([
      'Ink',
      'Reference',
      'Red',
      'Orange',
      'Green',
      'Blue',
      'Purple',
      'Custom…',
    ]);
    const swatches = options().map((option) => option.querySelector<HTMLElement>('span[aria-hidden="true"][style]')?.style.background);
    expect(swatches.slice(0, 3)).toEqual(['rgb(35, 31, 32)', 'rgb(201, 29, 135)', 'rgb(224, 49, 49)']);
  });

  it('says a palette colour by its value, and Ink as none', () => {
    const onChange = render('#1971c2');
    expect(trigger().textContent).toBe('Blue');
    open();
    choose('Orange');
    expect(onChange).toHaveBeenLastCalledWith('#e8590c');
    open();
    choose('Ink');
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('shows a colour picked by hand as its own item while it is chosen', () => {
    render('#123456');
    expect(trigger().textContent).toBe('#123456');
    open();
    expect(options().map((option) => option.textContent)).toContain('#123456');
  });

  it('says a palette colour written in capitals by its name, with no item of its own', () => {
    render('#1971C2');
    expect(trigger().textContent).toBe('Blue');
    open();
    expect(options().map((option) => option.textContent)).not.toContain('#1971C2');
    expect(options()).toHaveLength(8);
  });

  it('asks for a list as tall as the window allows, so Custom… is never cut off', () => {
    render('#123456');
    open();
    expect(document.querySelector('[role="listbox"]')?.closest('[data-fit]')?.getAttribute('data-fit')).toBe('available');
  });

  it('keeps the focus on its trigger while the picker is up and once it closes, so the Diagram’s keys still act', async () => {
    render(null);
    const picker = container!.querySelector<HTMLInputElement>('input[type="color"]')!;
    picker.showPicker = vi.fn();
    open();
    choose('Custom…');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(picker.showPicker).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger());
    // The pick ends: the engine's `change`, as its picker closes.
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(picker, '#ff00aa');
      picker.dispatchEvent(new Event('input', { bubbles: true }));
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(document.activeElement).toBe(trigger());
    expect(isShortcutEditingTarget(document.activeElement)).toBeFalsy();
  });

  it('opens the engine’s picker for Custom…, as the list closes, and reports each colour it moves to as one pick', async () => {
    const onChange = render(null);
    const picker = container!.querySelector<HTMLInputElement>('input[type="color"]')!;
    const shown = vi.fn();
    picker.showPicker = shown;
    open();
    choose('Custom…');
    // The list hands back the focus a moment after it closes: the picker opens then, in its place.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(shown).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    for (const value of ['#102030', '#405060']) {
      act(() => {
        setter.call(picker, value);
        picker.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    const picks = onChange.mock.calls.map(([, pick]) => pick);
    expect(onChange.mock.calls.map(([color]) => color)).toEqual(['#102030', '#405060']);
    expect(picks[0]).toBeTypeOf('number');
    expect(picks[1]).toBe(picks[0]);
  });
});
