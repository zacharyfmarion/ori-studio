/**
 * The popover's keyboard contract.
 *
 * The focus test is the one that earns its place. The input is two deferrals
 * away from this component's first render — the anchor measurement, then
 * `FloatingPortal`'s own mount effect — so a `useEffect(..., [])` ran against a
 * null ref and silently did nothing. Shift+A opened the popover with focus left
 * on whatever opened it, and everything typed went to the canvas instead.
 * Nothing else caught it: the popover renders identically either way, so only
 * an assertion about focus can see it.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreaseAnglePopover } from './CreaseAnglePopover';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let anchor: HTMLDivElement | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  anchor?.remove();
  anchor = null;
});

/** `anchored: false` is the phone case, where there is no toolbar field. */
function renderPopover({
  degrees = 180,
  anchored = true,
}: { degrees?: number; anchored?: boolean } = {}) {
  const onChange = vi.fn();
  const onClose = vi.fn();

  anchor = document.createElement('div');
  document.body.appendChild(anchor);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      <CreaseAnglePopover
        degrees={degrees}
        onChange={onChange}
        onClose={onClose}
        anchorRef={{ current: anchored ? anchor : null }}
      />
    );
  });

  return { onChange, onClose };
}

function input(): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>('.crease-angle-popover__input');
  if (!found) throw new Error('the popover rendered no input');
  return found;
}

function chips(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('.crease-angle-popover__chips .ui-chip')];
}

function chip(label: string): HTMLButtonElement {
  const found = chips().find((button) => button.textContent?.trim() === label);
  if (!found) throw new Error(`no ${label} chip`);
  return found;
}

/**
 * Type into the controlled input.
 *
 * Through the prototype's own `value` setter, not `field.value = ...`. React
 * installs its own setter on the element to track changes, and assigning
 * directly updates the DOM while leaving that tracker thinking nothing moved —
 * so `onChange` never fires and the draft keeps its old value. The test then
 * passes or fails for reasons that have nothing to do with the component.
 */
function type(value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setValue) throw new Error('no native value setter to write through');
  act(() => {
    const field = input();
    setValue.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function press(key: string) {
  act(() => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

describe('CreaseAnglePopover', () => {
  it('opens with the input focused and its value selected', () => {
    renderPopover();
    const field = input();
    expect(document.activeElement).toBe(field);
    // Selected, so typing replaces the angle rather than appending to it.
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length]);
  });

  // No anchor is the phone case, and it takes the centred frame — which has no
  // portal, so the deferral above does not apply to it. One callback ref covers
  // both paths, and this is the half that would not have caught the bug.
  it('focuses the input in the centred frame too', () => {
    renderPopover({ anchored: false });
    expect(document.activeElement).toBe(input());
  });

  it('commits a typed angle on Enter and closes', () => {
    const { onChange, onClose } = renderPopover();
    type('90');
    press('Enter');

    // No sign typed, so no direction asked for: the line type is left alone.
    expect(onChange).toHaveBeenCalledWith(90, null);
    expect(onClose).toHaveBeenCalled();
  });

  /**
   * The sign is the direction, following the convention the rest of the app
   * reads — negative mountain, positive valley, the same way a mountain badges
   * as `-45°`. So typing `-45` on a valley pen asks for a 45 degree *mountain*.
   */
  it('reads a typed sign as the fold direction', () => {
    const { onChange } = renderPopover();
    type('-45');
    press('Enter');
    expect(onChange).toHaveBeenCalledWith(45, 'Mountain');
  });

  it('reads an explicit plus as a valley', () => {
    const { onChange } = renderPopover();
    type('+45');
    press('Enter');
    expect(onChange).toHaveBeenCalledWith(45, 'Valley');
  });

  /**
   * The reason only an *explicit* sign carries a direction. If a bare `45` meant
   * valley, there would be no way to change the angle while staying on mountain
   * — which is the common case by far.
   */
  it('leaves the direction alone for an unsigned entry', () => {
    const { onChange } = renderPopover();
    type('45');
    press('Enter');
    expect(onChange).toHaveBeenCalledWith(45, null);
  });

  // The input accepts a sign; the readout does not carry one back. The pen is a
  // magnitude, and the direction it pairs with is on the rail.
  it('opens showing the magnitude, unsigned', () => {
    renderPopover({ degrees: 45 });
    expect(input().value).toBe('45');
  });

  // The user opened this to set an angle. Putting the pen back to 180 because
  // they mistyped is the one outcome nobody wants, so a bad entry changes
  // nothing at all.
  it('closes without changing the pen when the entry is unusable', () => {
    const { onChange, onClose } = renderPopover();
    for (const value of ['', '200', 'abc']) {
      type(value);
      press('Enter');
    }
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('escapes without changing the pen', () => {
    const { onChange, onClose } = renderPopover();
    type('45');
    press('Escape');

    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  // Plain buttons in DOM order, not a roving-tabindex composite: a roving group
  // is a single tab stop, so Tab would skip the whole row — the opposite of what
  // this control exists for.
  it('offers every preset as its own tab stop', () => {
    renderPopover();
    expect(chips().length).toBeGreaterThan(1);
    for (const button of chips()) {
      expect(button.tabIndex).toBe(0);
    }
  });

  it('applies a preset chip and closes', () => {
    const { onChange, onClose } = renderPopover();
    act(() => {
      chip('90°').click();
    });

    // Magnitude only: a chip labelled `90°` must not also flip mountain to
    // valley. The sign is typed, deliberately.
    expect(onChange).toHaveBeenCalledWith(90, null);
    expect(onClose).toHaveBeenCalled();
  });

  it('marks the chip that matches the live pen', () => {
    renderPopover({ degrees: 90 });
    expect(chip('90°').getAttribute('aria-pressed')).toBe('true');
    expect(chip('180°').getAttribute('aria-pressed')).toBe('false');
  });
});
