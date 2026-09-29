import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_STYLE, type Pen } from '../../lib/paper/paperStyle';
import { DASH_MENU_HEIGHT, PaperDashMenu, dashMenuFlipsUp, previewDashArray } from './PaperDashMenu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
/** What the card last wrote, so a test can ask what the menu committed. */
const written = { pen: DEFAULT_PAPER_STYLE.edges };
const pen = () => written.pen;

/** The field as a pen card holds it: the menu writes, the card hands the pen back. */
function Harness({ initial }: { initial: Pen }) {
  const [current, setCurrent] = useState(initial);
  return (
    <PaperDashMenu
      label="Edges dash"
      pen={current}
      disabled={false}
      onCommit={(dash) => {
        written.pen = { ...current, dash };
        setCurrent(written.pen);
      }}
    />
  );
}

function render(initial: Pen = DEFAULT_PAPER_STYLE.edges): HTMLDivElement {
  written.pen = initial;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<Harness initial={initial} />));
  return container;
}

const trigger = () => container!.querySelector<HTMLButtonElement>('.settings-paper-dash__trigger')!;
const menu = () => container!.querySelector<HTMLElement>('[role="menu"]');
const options = () =>
  Array.from(container!.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
const customField = () =>
  container!.querySelector<HTMLInputElement>('.settings-paper-dash__custom-field')!;

const open = () => act(() => trigger().click());

function press(key: string, target: Element = document.activeElement ?? document.body) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

/** React listens for the native input event, so the value goes in through the setter. */
function typeInto(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    element.focus();
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('previewDashArray', () => {
  it('draws a pattern at the preview’s own width, not the pen’s', () => {
    expect(previewDashArray(null)).toBeUndefined();
    expect(previewDashArray([])).toBeUndefined();
    expect(previewDashArray([8, 2, 1, 2])).toBe('12.8 3.2 1.6 3.2');
  });
});

describe('dashMenuFlipsUp', () => {
  it('opens upward only when the menu would reach past what is scrolling it', () => {
    expect(dashMenuFlipsUp(100, 100 + DASH_MENU_HEIGHT)).toBe(false);
    expect(dashMenuFlipsUp(100, 100 + DASH_MENU_HEIGHT - 1)).toBe(true);
  });
});

describe('PaperDashMenu', () => {
  it('is a menu button that says which dash the pen is on', () => {
    render();
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().textContent).toBe('Solid');
    expect(menu()).toBeNull();

    open();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(options().map((option) => option.textContent)).toEqual([
      'Solid',
      'Dashed',
      'Dash-dot',
      'Dash double-dot',
      'Dotted',
      'Long dash',
      'Fine dash',
    ]);
    // Every option is drawn, not just named.
    expect(container!.querySelectorAll('[role="menuitemradio"] line')).toHaveLength(7);
    expect(options().map((option) => option.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
      'false',
      'false',
    ]);
  });

  it('opens at the dash the pen is on, and walks the options and the field with the arrows', () => {
    render({ ...DEFAULT_PAPER_STYLE.edges, dash: [1, 2] });
    open();
    expect(document.activeElement).toBe(options()[4]);

    press('ArrowDown');
    expect(document.activeElement).toBe(options()[5]);
    press('ArrowUp');
    press('ArrowUp');
    expect(document.activeElement).toBe(options()[3]);
    press('End');
    // Past the last named dash is the custom field: it is one of the answers.
    expect(document.activeElement).toBe(customField());
    press('ArrowDown');
    expect(document.activeElement).toBe(options()[0]);
  });

  /**
   * The two keys a caret most needs. Up and down still walk out of the field:
   * one line has nowhere else for them to go.
   */
  it('leaves Home and End to the caret while the custom field has focus', () => {
    render();
    open();
    act(() => customField().focus());
    press('Home', customField());
    expect(document.activeElement).toBe(customField());
    press('End', customField());
    expect(document.activeElement).toBe(customField());
    press('ArrowUp', customField());
    expect(document.activeElement).toBe(options()[6]);
  });

  it('keeps the custom field out of the menu, which may own only menu items', () => {
    render();
    open();
    expect(menu()!.contains(customField())).toBe(false);
    expect(menu()!.querySelectorAll('[role="menuitemradio"]')).toHaveLength(7);
  });

  it('writes the dash it is asked for and closes back onto the trigger', () => {
    render();
    open();
    act(() => options()[2]!.click());
    expect(pen().dash).toEqual([8, 2, 1, 2]);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(trigger().textContent).toBe('Dash-dot');
  });

  it('writes a dash with two dots, the diagrammer’s mountain fold', () => {
    render();
    open();
    act(() => options()[3]!.click());
    expect(pen().dash).toEqual([8, 2, 1, 2, 1, 2]);
    expect(trigger().textContent).toBe('Dash double-dot');
  });

  it('takes a dash the list does not hold, and names it by its runs', () => {
    render();
    open();
    typeInto(customField(), '3 1 5');
    press('Enter', customField());
    expect(pen().dash).toEqual([3, 1, 5]);
    // The field is the long way round to the same answer, so the menu stays.
    expect(menu()).not.toBeNull();
    expect(options().map((option) => option.getAttribute('aria-checked'))).toEqual(
      new Array(7).fill('false')
    );
    act(() => trigger().click());
    expect(trigger().textContent).toBe('Custom · 3 1 5');
  });

  it('puts a draft that is not a dash back rather than writing it', () => {
    render();
    open();
    typeInto(customField(), '3 x');
    act(() => customField().blur());
    expect(pen().dash).toBeNull();
    expect(customField().value).toBe('');
  });

  it('closes on Escape, back onto the trigger, and on a press outside', () => {
    render();
    open();
    press('Escape');
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());

    open();
    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(menu()).toBeNull();
    // A press somewhere else is not a request to come back here.
    expect(document.activeElement).not.toBe(trigger());
  });
});
