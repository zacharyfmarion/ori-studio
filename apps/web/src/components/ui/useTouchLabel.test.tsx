import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOUCH_LABEL_HOLD_MS, TOUCH_LABEL_SLOP_PX, useTouchLabel } from './useTouchLabel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function stubPointer(coarse: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('pointer: coarse') ? coarse : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/**
 * The hold state, published to the DOM rather than to a module variable.
 *
 * Writing one during render is what `react-hooks/immutability` forbids, and the
 * attribute is the better assertion anyway: it is exactly the value a controlled
 * Radix tooltip reads.
 */
const clicks: string[] = [];

function Harness() {
  const hold = useTouchLabel();
  return (
    <button
      type="button"
      data-hold-open={hold.open === undefined ? 'uncontrolled' : String(hold.open)}
      {...hold.handlers}
      onClick={() => {
        if (hold.consumeClick()) return;
        clicks.push('through');
      }}
    >
      hold me
    </button>
  );
}

/** `undefined` reads as "uncontrolled", which is a distinct answer from `false`. */
function openState(button: HTMLButtonElement): true | undefined {
  return button.dataset.holdOpen === 'true' ? true : undefined;
}

function render(coarse: boolean): HTMLButtonElement {
  stubPointer(coarse);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<Harness />);
  });
  const button = container.querySelector('button');
  if (!(button instanceof HTMLButtonElement)) throw new Error('no button');
  return button;
}

/**
 * jsdom has no `PointerEvent`, and the fields this hook reads are the ones
 * `MouseEvent` already carries plus `pointerType` — so a MouseEvent with that
 * property is a faithful stand-in for what React hands the handler.
 */
function pointer(
  type: string,
  init: { pointerType?: string; clientX?: number; clientY?: number } = {}
): Event {
  const event = new MouseEvent(type, {
    bubbles: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  });
  Object.defineProperty(event, 'pointerType', { value: init.pointerType ?? 'touch' });
  return event;
}

function dispatch(button: HTMLButtonElement, event: Event) {
  act(() => {
    button.dispatchEvent(event);
  });
}

beforeEach(() => {
  clicks.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useTouchLabel on a coarse pointer', () => {
  it('opens the label once the finger has rested, and a tap never trips it', () => {
    const button = render(true);

    dispatch(button, pointer('pointerdown'));
    act(() => {
      vi.advanceTimersByTime(TOUCH_LABEL_HOLD_MS - 1);
    });
    expect(openState(button)).toBeUndefined();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(openState(button)).toBe(true);
  });

  it('leaves the tooltip uncontrolled while nothing is held', () => {
    const button = render(true);
    expect(openState(button)).toBeUndefined();

    dispatch(button, pointer('pointerdown'));
    act(() => {
      vi.advanceTimersByTime(TOUCH_LABEL_HOLD_MS);
    });
    dispatch(button, pointer('pointerup'));

    // Not `false`: an iPad with a trackpad reports a coarse pointer and still
    // hovers, and a permanently controlled tooltip would never open for it.
    expect(openState(button)).toBeUndefined();
  });

  it('swallows the click that ends a hold, and only that one', () => {
    const button = render(true);

    dispatch(button, pointer('pointerdown'));
    act(() => {
      vi.advanceTimersByTime(TOUCH_LABEL_HOLD_MS);
    });
    dispatch(button, pointer('pointerup'));
    dispatch(button, new MouseEvent('click', { bubbles: true }));
    expect(clicks).toHaveLength(0);

    dispatch(button, pointer('pointerdown'));
    dispatch(button, pointer('pointerup'));
    dispatch(button, new MouseEvent('click', { bubbles: true }));
    expect(clicks).toHaveLength(1);
  });

  it('lets a plain tap through', () => {
    const button = render(true);

    dispatch(button, pointer('pointerdown'));
    act(() => {
      vi.advanceTimersByTime(TOUCH_LABEL_HOLD_MS - 50);
    });
    dispatch(button, pointer('pointerup'));
    dispatch(button, new MouseEvent('click', { bubbles: true }));

    expect(openState(button)).toBeUndefined();
    expect(clicks).toHaveLength(1);
  });

  it('abandons the hold when the finger moves — the rail scrolls', () => {
    const button = render(true);

    dispatch(button, pointer('pointerdown', { clientX: 0, clientY: 0 }));
    dispatch(button, pointer('pointermove', { clientX: 0, clientY: TOUCH_LABEL_SLOP_PX + 1 }));
    act(() => {
      vi.advanceTimersByTime(TOUCH_LABEL_HOLD_MS * 2);
    });

    expect(openState(button)).toBeUndefined();
    dispatch(button, pointer('pointerup'));
    dispatch(button, new MouseEvent('click', { bubbles: true }));
    expect(clicks).toHaveLength(1);
  });

  it('keeps a jitter inside the slop from cancelling', () => {
    const button = render(true);

    dispatch(button, pointer('pointerdown', { clientX: 0, clientY: 0 }));
    dispatch(button, pointer('pointermove', { clientX: 1, clientY: 2 }));
    act(() => {
      vi.advanceTimersByTime(TOUCH_LABEL_HOLD_MS);
    });

    expect(openState(button)).toBe(true);
  });

  /*
   * A cancelled gesture produces no click, so the suppression it armed has
   * nothing to spend itself on. Left set, it would eat the *next* real tap on
   * the same control.
   */
  it('does not carry a suppression across a cancelled gesture', () => {
    const button = render(true);

    dispatch(button, pointer('pointerdown'));
    act(() => {
      vi.advanceTimersByTime(TOUCH_LABEL_HOLD_MS);
    });
    dispatch(button, pointer('pointercancel'));
    expect(openState(button)).toBeUndefined();

    dispatch(button, pointer('pointerdown'));
    dispatch(button, pointer('pointerup'));
    dispatch(button, new MouseEvent('click', { bubbles: true }));
    expect(clicks).toHaveLength(1);
  });

  it('ignores a mouse press, which has hover already', () => {
    const button = render(true);

    dispatch(button, pointer('pointerdown', { pointerType: 'mouse' }));
    act(() => {
      vi.advanceTimersByTime(TOUCH_LABEL_HOLD_MS * 2);
    });

    expect(openState(button)).toBeUndefined();
  });
});

describe('useTouchLabel on a fine pointer', () => {
  it('does nothing at all', () => {
    const button = render(false);

    dispatch(button, pointer('pointerdown'));
    act(() => {
      vi.advanceTimersByTime(TOUCH_LABEL_HOLD_MS * 2);
    });

    expect(openState(button)).toBeUndefined();
    dispatch(button, pointer('pointerup'));
    dispatch(button, new MouseEvent('click', { bubbles: true }));
    expect(clicks).toHaveLength(1);
  });
});
