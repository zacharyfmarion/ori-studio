/**
 * A vertical swipe under a finger, as one discrete verb per gesture: up or
 * down, fired the moment the travel qualifies, never twice for one touch.
 *
 * Touch and pen only. A mouse has buttons and keys for the same verbs, and a
 * vertical drag with a mouse is a selection or nothing.
 *
 * # The surface must not scroll vertically
 *
 * The browser claims a drag as a pan as soon as it moves past its slop, and a
 * claimed pointer is cancelled — so the element these handlers are spread on
 * needs `touch-action: pan-x` (or `none`) for the vertical travel to arrive
 * here at all. `pan-x` keeps a horizontal strip scrolling under the same
 * finger, which is the combination this exists for: the browser takes a
 * sideways drag and cancels the pointer, and a vertical one comes through.
 */
import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';

export type SwipeDirection = 'up' | 'down';

/**
 * How far a finger travels before it is a swipe, in CSS pixels. Past a tap's
 * slop on every platform, well short of a card's height.
 */
export const SWIPE_TRAVEL_PX = 24;

/**
 * How much more vertical than horizontal the travel must be. A drag that is
 * only somewhat vertical is a reader scrolling the strip at an angle.
 */
export const SWIPE_DOMINANCE = 1.5;

/** The swipe a finger's travel so far makes, if it makes one yet. */
export function swipeDirection(dx: number, dy: number): SwipeDirection | null {
  const vertical = Math.abs(dy);
  if (vertical < SWIPE_TRAVEL_PX || vertical < SWIPE_DOMINANCE * Math.abs(dx)) return null;
  return dy < 0 ? 'up' : 'down';
}

export interface VerticalSwipeHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

/**
 * Handlers to spread on the swiped element. `onSwipe` receives the direction
 * and the element the finger came down on, so one set of handlers can serve a
 * whole list and ask which item was swiped.
 */
export function useVerticalSwipe(
  onSwipe: (direction: SwipeDirection, target: EventTarget) => void
): VerticalSwipeHandlers {
  const gesture = useRef<{ pointer: number; x: number; y: number; target: EventTarget } | null>(
    null
  );

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    // A second finger makes it a pinch, not a swipe, and ends the first.
    gesture.current =
      event.pointerType !== 'mouse' && event.isPrimary
        ? { pointer: event.pointerId, x: event.clientX, y: event.clientY, target: event.target }
        : null;
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const start = gesture.current;
      if (!start || event.pointerId !== start.pointer) return;
      const direction = swipeDirection(event.clientX - start.x, event.clientY - start.y);
      if (!direction) return;
      gesture.current = null;
      onSwipe(direction, start.target);
    },
    [onSwipe]
  );

  const onPointerEnd = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (gesture.current?.pointer === event.pointerId) gesture.current = null;
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd };
}
