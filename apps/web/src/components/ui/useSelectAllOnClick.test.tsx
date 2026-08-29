/**
 * The three cases that make click-to-replace usable rather than domineering.
 *
 * jsdom does not move a caret on mouseup the way a browser does, so these drive
 * the handlers against the selection state each case would really produce —
 * which is what the hook branches on — rather than pretending to click.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useSelectAllOnClick } from './useSelectAllOnClick';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
});

function Field() {
  const handlers = useSelectAllOnClick();
  return <input defaultValue="180" {...handlers} />;
}

function render(): HTMLInputElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<Field />);
  });
  const field = container.querySelector('input');
  if (!field) throw new Error('no field');
  return field;
}

/** A press-and-release on the field, with the caret it would leave behind. */
function click(field: HTMLInputElement, caret: number, dragTo = caret) {
  act(() => {
    field.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  // The browser places the caret (or drags a range) between down and up.
  field.focus();
  field.setSelectionRange(caret, dragTo);
  act(() => {
    field.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
}

function selection(field: HTMLInputElement) {
  return [field.selectionStart, field.selectionEnd];
}

describe('useSelectAllOnClick', () => {
  it('selects the whole value on the click that focuses the field', () => {
    const field = render();
    click(field, 2);
    expect(selection(field)).toEqual([0, 3]);
  });

  // Otherwise the field could never be clicked into to place a caret, which is
  // what you want the second time — fixing a digit rather than replacing all.
  it('leaves a caret alone once the field is already focused', () => {
    const field = render();
    click(field, 2);
    click(field, 1);
    expect(selection(field)).toEqual([1, 1]);
  });

  it('respects a selection the click dragged out for itself', () => {
    const field = render();
    click(field, 1, 2);
    expect(selection(field)).toEqual([1, 2]);
  });
});
