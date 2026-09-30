import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SWIPE_DOMINANCE,
  SWIPE_TRAVEL_PX,
  swipeDirection,
  useVerticalSwipe,
  type SwipeDirection,
} from './useVerticalSwipe';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('swipeDirection', () => {
  it('is up or down once the travel is long enough and mostly vertical', () => {
    expect(swipeDirection(0, -SWIPE_TRAVEL_PX)).toBe('up');
    expect(swipeDirection(0, SWIPE_TRAVEL_PX)).toBe('down');
    expect(swipeDirection(10, 40)).toBe('down');
  });

  it('is nothing for a tap or a drag along the strip', () => {
    expect(swipeDirection(0, SWIPE_TRAVEL_PX - 1)).toBeNull();
    expect(swipeDirection(60, 30)).toBeNull();
    // Diagonal past the dominance line is a reader scrolling the strip.
    expect(swipeDirection(40, 40 * SWIPE_DOMINANCE - 1)).toBeNull();
  });
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let swipes: Array<[SwipeDirection, string]> = [];

function Surface() {
  const handlers = useVerticalSwipe((direction, target) =>
    swipes.push([direction, (target as HTMLElement).id])
  );
  return (
    <div {...handlers}>
      <span id="a">a</span>
      <span id="b">b</span>
    </div>
  );
}

beforeEach(() => {
  swipes = [];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<Surface />));
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function pointer(
  type: string,
  on: string,
  init: { y: number; x?: number; pointerType?: string; pointerId?: number; isPrimary?: boolean }
): void {
  const target = container?.querySelector(`#${on}`);
  act(() => {
    target?.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: init.pointerId ?? 1,
        pointerType: init.pointerType ?? 'touch',
        isPrimary: init.isPrimary ?? true,
        clientX: init.x ?? 0,
        clientY: init.y,
      })
    );
  });
}

describe('useVerticalSwipe', () => {
  it('fires once per touch, with the element the finger came down on', () => {
    pointer('pointerdown', 'a', { y: 100 });
    // Implicit capture sends every later move to where the touch began.
    pointer('pointermove', 'a', { y: 90 });
    pointer('pointermove', 'a', { y: 60 });
    pointer('pointermove', 'a', { y: 20 });
    pointer('pointerup', 'a', { y: 20 });
    pointer('pointerdown', 'b', { y: 20 });
    pointer('pointermove', 'b', { y: 80 });
    expect(swipes).toEqual([
      ['up', 'a'],
      ['down', 'b'],
    ]);
  });

  it('leaves a mouse alone, which has buttons and keys for this', () => {
    pointer('pointerdown', 'a', { y: 100, pointerType: 'mouse' });
    pointer('pointermove', 'a', { y: 20, pointerType: 'mouse' });
    expect(swipes).toEqual([]);
  });

  it('gives up when a second finger lands, or the browser takes the touch', () => {
    pointer('pointerdown', 'a', { y: 100 });
    pointer('pointerdown', 'b', { y: 100, pointerId: 2, isPrimary: false });
    pointer('pointermove', 'a', { y: 20 });
    pointer('pointerdown', 'a', { y: 100 });
    pointer('pointercancel', 'a', { y: 100 });
    pointer('pointermove', 'a', { y: 20 });
    expect(swipes).toEqual([]);
  });
});
