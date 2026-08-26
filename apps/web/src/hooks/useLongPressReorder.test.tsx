import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOUCH_LABEL_HOLD_MS, TOUCH_LABEL_SLOP_PX } from '../components/ui/useTouchLabel';
import { POINTER_DRAG_THRESHOLD_PX, useLongPressReorder } from './useLongPressReorder';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ATTRIBUTE = 'data-row';
const ROW_HEIGHT = 40;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let reorders: Array<[string, number]> = [];
let ends: Array<[string, number]> = [];
let clickWasConsumed: boolean | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  reorders = [];
  ends = [];
  clickWasConsumed = null;
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  vi.useRealTimers();
});

/**
 * A list of rows laid out vertically.
 *
 * jsdom has no layout, so `getBoundingClientRect` is stubbed per row from its
 * index. That is the whole geometry the hook consults, and stubbing it is what
 * lets the hit test be driven from a test at all.
 */
function List({ ids }: { ids: string[] }) {
  const { draggingId, handlers, consumeClick } = useLongPressReorder({
    itemAttribute: ATTRIBUTE,
    onReorder: (id, index) => reorders.push([id, index]),
    onDragEnd: (id, index) => ends.push([id, index]),
  });
  return (
    <ul>
      {ids.map((id, index) => (
        <li
          key={id}
          {...{ [ATTRIBUTE]: id }}
          data-dragging={draggingId === id || undefined}
          ref={(element) => stubBox(element, index)}
          {...handlers}
          onClick={() => {
            clickWasConsumed = consumeClick();
          }}
        >
          {id}
        </li>
      ))}
    </ul>
  );
}

function stubBox(element: HTMLElement | null, index: number): void {
  if (!element) return;
  const top = index * ROW_HEIGHT;
  element.getBoundingClientRect = () =>
    ({ top, bottom: top + ROW_HEIGHT, left: 0, right: 100, width: 100, height: ROW_HEIGHT }) as
      DOMRect;
}

function render(ids: string[]): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<List ids={ids} />);
  });
  return container;
}

function row(host: HTMLElement, id: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(`[${ATTRIBUTE}="${id}"]`);
  if (!found) throw new Error(`no row ${id}`);
  return found;
}

/** The centre of the slot at `index`, in the stubbed geometry. */
function slotY(index: number): number {
  return index * ROW_HEIGHT + ROW_HEIGHT / 2;
}

function pointerDown(target: HTMLElement, pointerType: string, y: number): void {
  act(() => {
    target.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerType,
        clientX: 0,
        clientY: y,
      })
    );
  });
}

function pointerMove(y: number, x = 0): void {
  act(() => {
    window.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y })
    );
  });
}

function pointerUp(): void {
  act(() => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
}

function hold(): void {
  act(() => {
    vi.advanceTimersByTime(TOUCH_LABEL_HOLD_MS);
  });
}

function click(target: HTMLElement): void {
  act(() => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('a finger', () => {
  it('arms after the hold and reorders on the move that follows', () => {
    const host = render(['a', 'b', 'c']);
    pointerDown(row(host, 'a'), 'touch', slotY(0));
    expect(row(host, 'a').getAttribute('data-dragging')).toBeNull();

    hold();
    expect(row(host, 'a').getAttribute('data-dragging')).toBe('true');

    pointerMove(slotY(2));
    expect(reorders).toEqual([['a', 2]]);
  });

  /*
   * The gesture this feature has to survive: a vertical drag on a scrolling
   * list. Moving before the timer fires is a scroll, and must stay one.
   */
  it('does not arm when the finger moves before the hold completes', () => {
    const host = render(['a', 'b', 'c']);
    pointerDown(row(host, 'a'), 'touch', slotY(0));
    pointerMove(slotY(0) + TOUCH_LABEL_SLOP_PX + 1);
    hold();

    expect(row(host, 'a').getAttribute('data-dragging')).toBeNull();
    pointerMove(slotY(2));
    expect(reorders).toEqual([]);
  });

  it('tolerates jitter within the slop radius', () => {
    const host = render(['a', 'b', 'c']);
    pointerDown(row(host, 'a'), 'touch', slotY(0));
    pointerMove(slotY(0) + TOUCH_LABEL_SLOP_PX - 1);
    hold();
    expect(row(host, 'a').getAttribute('data-dragging')).toBe('true');
  });

  /*
   * The non-passive listener is the whole scroll fix, so assert it is installed
   * at arm time and — just as important — not before. Installing it at
   * pointerdown would make the list unscrollable.
   */
  it('cancels page scrolling only once armed', () => {
    const host = render(['a', 'b', 'c']);
    const cancelled = () => {
      const event = new Event('touchmove', { bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    pointerDown(row(host, 'a'), 'touch', slotY(0));
    expect(cancelled()).toBe(false);

    hold();
    expect(cancelled()).toBe(true);

    pointerUp();
    expect(cancelled()).toBe(false);
  });
});

describe('a mouse', () => {
  it('arms on distance rather than time', () => {
    const host = render(['a', 'b', 'c']);
    pointerDown(row(host, 'a'), 'mouse', slotY(0));
    hold();
    expect(row(host, 'a').getAttribute('data-dragging')).toBeNull();

    pointerMove(slotY(0) + POINTER_DRAG_THRESHOLD_PX + 1);
    expect(row(host, 'a').getAttribute('data-dragging')).toBe('true');
  });

  it('stays a click below the threshold', () => {
    const host = render(['a', 'b', 'c']);
    pointerDown(row(host, 'a'), 'mouse', slotY(0));
    pointerMove(slotY(0) + POINTER_DRAG_THRESHOLD_PX - 1);
    pointerUp();

    expect(reorders).toEqual([]);
    click(row(host, 'a'));
    expect(clickWasConsumed).toBe(false);
  });
});

describe('the drag itself', () => {
  it('reports each slot once, not once per move', () => {
    const host = render(['a', 'b', 'c', 'd']);
    pointerDown(row(host, 'a'), 'touch', slotY(0));
    hold();

    pointerMove(slotY(1));
    pointerMove(slotY(1) + 2);
    pointerMove(slotY(2));
    expect(reorders).toEqual([
      ['a', 1],
      ['a', 2],
    ]);
  });

  it('clamps past either end instead of going blank', () => {
    const host = render(['a', 'b', 'c']);
    pointerDown(row(host, 'b'), 'touch', slotY(1));
    hold();

    pointerMove(-500);
    pointerMove(500);
    expect(reorders).toEqual([
      ['b', 0],
      ['b', 2],
    ]);
  });

  it('reports the final slot once on release', () => {
    const host = render(['a', 'b', 'c']);
    pointerDown(row(host, 'a'), 'touch', slotY(0));
    hold();
    pointerMove(slotY(2));
    pointerUp();

    expect(ends).toEqual([['a', 2]]);
  });

  it('reports nothing on release when the press never armed', () => {
    const host = render(['a', 'b', 'c']);
    pointerDown(row(host, 'a'), 'touch', slotY(0));
    pointerUp();
    expect(ends).toEqual([]);
  });

  /*
   * Without this, holding a row to move it also activates it on release — on
   * the tool sheet that means picking a tool and closing the sheet mid-reorder.
   */
  it('consumes the click that ends a drag', () => {
    const host = render(['a', 'b', 'c']);
    pointerDown(row(host, 'a'), 'touch', slotY(0));
    hold();
    pointerMove(slotY(2));
    pointerUp();

    click(row(host, 'a'));
    expect(clickWasConsumed).toBe(true);
  });

  it('leaves the next tap alone once the flag is spent', () => {
    const host = render(['a', 'b', 'c']);
    pointerDown(row(host, 'a'), 'touch', slotY(0));
    hold();
    pointerMove(slotY(2));
    pointerUp();
    click(row(host, 'a'));

    pointerDown(row(host, 'a'), 'touch', slotY(0));
    pointerUp();
    click(row(host, 'a'));
    expect(clickWasConsumed).toBe(false);
  });

  it('stops tracking after release', () => {
    const host = render(['a', 'b', 'c']);
    pointerDown(row(host, 'a'), 'touch', slotY(0));
    hold();
    pointerUp();
    reorders = [];

    pointerMove(slotY(2));
    expect(reorders).toEqual([]);
  });
});
