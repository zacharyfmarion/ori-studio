import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

/** Movement before a press becomes a drag. Below this it is still a click. */
const DRAG_THRESHOLD_PX = 6;

export interface PointerDragHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Swallows the click that a browser fires at the end of a drag. */
  onClickCapture: (event: { preventDefault: () => void; stopPropagation: () => void }) => void;
}

/**
 * Drag-to-scroll for a mouse, over a container that already scrolls.
 *
 * **Mouse only.** A touch drag on a scroll container is already a swipe, with
 * the platform's own momentum, rubber-banding and snap physics; intercepting it
 * would mean reimplementing four things worse than the browser does them. This
 * exists purely because a mouse cannot swipe.
 *
 * Two details that are the whole point:
 *
 * - Nothing happens until the pointer has moved {@link DRAG_THRESHOLD_PX}, so a
 *   click on something inside the track is still a click.
 * - Once it *has* dragged, the trailing `click` is swallowed. Without that,
 *   dragging across a link or a button inside a slide activates it on release.
 */
export function usePointerDrag(
  ref: RefObject<HTMLElement | null>,
  options: { onSettle?: () => void } = {}
): PointerDragHandlers {
  const { onSettle } = options;
  const drag = useRef<{ id: number; startX: number; startScroll: number; moved: boolean } | null>(
    null
  );
  // Outlives the gesture: `pointerup` fires before `click`, and the click is
  // what has to be suppressed.
  const suppressClick = useRef(false);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'mouse') return;
      const element = ref.current;
      if (!element) return;
      drag.current = {
        id: event.pointerId,
        startX: event.clientX,
        startScroll: element.scrollLeft,
        moved: false,
      };
    },
    [ref]
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = drag.current;
      const element = ref.current;
      if (!state || !element || event.pointerId !== state.id) return;

      const dx = event.clientX - state.startX;
      if (!state.moved) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
        state.moved = true;
        // Capture only once it is a real drag, so a plain click never retargets.
        element.setPointerCapture?.(state.id);
      }
      element.scrollLeft = state.startScroll - dx;
    },
    [ref]
  );

  const finish = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = drag.current;
      const element = ref.current;
      if (!state || event.pointerId !== state.id) return;
      drag.current = null;

      if (element?.hasPointerCapture?.(state.id)) element.releasePointerCapture?.(state.id);
      if (!state.moved) return;

      suppressClick.current = true;
      onSettle?.();
    },
    [onSettle, ref]
  );

  const onClickCapture = useCallback(
    (event: { preventDefault: () => void; stopPropagation: () => void }) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    []
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: finish,
    onPointerCancel: finish,
    onClickCapture,
  };
}
