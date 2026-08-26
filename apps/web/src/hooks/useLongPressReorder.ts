/**
 * Reorder a vertical list by dragging a row — long press on a finger, plain drag
 * on a mouse.
 *
 * # Why this is not a library
 *
 * The repo already had both halves. `DesignTabStrip` reorders a horizontal strip
 * by hit-testing the live DOM and permuting as it goes, and `useTouchLabel`
 * classifies a press-and-hold with a timer, a slop radius and a consumed click.
 * This composes them for a vertical list, which is the simplest possible case —
 * one container, no grid, no cross-list drag, no virtualization — and precisely
 * the case a drag library's weight buys nothing for.
 *
 * The one thing a library would have given free is keyboard reordering, and the
 * answer to that is the one `DesignTabStrip` already reached: a Move up / Move
 * down pair beside the drag, which is the accessible equivalent rather than a
 * convenience.
 *
 * # Activation splits on pointer type, and that is what makes it reusable
 *
 * A finger gets a long press, because a vertical drag with no delay is
 * indistinguishable from a scroll. A mouse gets a distance threshold, because
 * waiting 400ms to move something you are already holding feels broken. A hook
 * that knew only the touch activation would push every future desktop surface
 * into working around it.
 *
 * # The scroll problem, which is the actual hard part
 *
 * The list this drags lives inside a vertically scrolling container, so the
 * browser's default reading of a vertical drag is "scroll". Two fixes that look
 * right and are not:
 *
 * - `touch-action: none` on the row *when the press arms* is too late. The value
 *   is consulted when the gesture starts; by 400ms the browser has already
 *   decided this is a pan.
 * - `touch-action: none` on the rows permanently works, and makes the top of the
 *   sheet a region you cannot scroll from — on the surface with the least room.
 *
 * What works is a non-passive `touchmove` listener installed **at arm time**
 * that calls `preventDefault()`. That is legitimate here only because the long
 * press requires stillness: {@link TOUCH_LABEL_SLOP_PX} of movement cancels the
 * timer, so when we arm, no scroll has begun and cancelling a not-yet-started
 * pan is honoured. It must go through `addEventListener` with
 * `{ passive: false }` — React routes `onTouchMove` through a passive root
 * listener that cannot cancel anything. The repo does the same for `wheel` in
 * `useViewportSurface`, `CreasePatternWebglCanvas`, `SimulatorViewport` and
 * `useWheelPassthrough`.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { TOUCH_LABEL_HOLD_MS, TOUCH_LABEL_SLOP_PX } from '../components/ui/useTouchLabel';

/**
 * How far a mouse travels before a click becomes a drag. `DesignTabStrip`'s
 * number, and the same reasoning: small enough to feel immediate, large enough
 * that a click with a shaky hand is still a click.
 */
export const POINTER_DRAG_THRESHOLD_PX = 4;

export interface LongPressReorderOptions {
  /**
   * The attribute each row carries, holding its id — e.g. `data-cp-favorite`.
   * Rows are found through it rather than through refs, so the hit test reads
   * the same live DOM the user is looking at.
   */
  itemAttribute: string;
  /** Fired continuously during a drag, with the row's new index. */
  onReorder: (id: string, toIndex: number) => void;
  /** Fired once when a drag completes, with where it ended up. */
  onDragEnd?: (id: string, toIndex: number) => void;
}

export interface LongPressReorder {
  /** The row being dragged, for a `[data-dragging]` attribute. */
  draggingId: string | null;
  /**
   * Spread on every row. The row's id is read back from
   * {@link LongPressReorderOptions.itemAttribute}, so there is one handlers
   * object for the whole list rather than a closure per row.
   */
  handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onContextMenu: (event: { preventDefault: () => void }) => void;
  };
  /**
   * True for the click that ends a drag, false otherwise.
   *
   * Callers must ask before running the row's own action. Without it, holding a
   * row to move it also activates it on release — the same trap `useTouchLabel`
   * documents, where holding Delete to find out what Delete does deletes.
   */
  consumeClick: () => boolean;
}

export function useLongPressReorder({
  itemAttribute,
  onReorder,
  onDragEnd,
}: LongPressReorderOptions): LongPressReorder {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  /** Everything a live gesture needs, off the render path. */
  const gestureRef = useRef<{
    id: string;
    container: HTMLElement;
    origin: { x: number; y: number };
    touch: boolean;
    armed: boolean;
    lastIndex: number;
  } | null>(null);
  const timerRef = useRef<number | null>(null);
  const teardownRef = useRef<(() => void) | null>(null);
  /** A drag happened, so the click closing this gesture is not an activation. */
  const suppressRef = useRef(false);

  // Options are read at event time from refs, not captured directly, because the
  // window listeners are installed inside `pointerdown` and would otherwise hold
  // the callbacks from that one render for the life of the gesture — and every
  // `onReorder` re-renders the list mid-drag. Synced in an effect rather than
  // during render: the listeners only ever read them after paint.
  const onReorderRef = useRef(onReorder);
  const onDragEndRef = useRef(onDragEnd);
  useEffect(() => {
    onReorderRef.current = onReorder;
    onDragEndRef.current = onDragEnd;
  }, [onReorder, onDragEnd]);

  const endGesture = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    teardownRef.current?.();
    teardownRef.current = null;
    gestureRef.current = null;
    setDraggingId(null);
  }, []);

  // A component unmounting mid-drag must not leave window listeners behind. It
  // happens on this surface: selecting a tool closes the sheet.
  useEffect(() => endGesture, [endGesture]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const row = event.currentTarget;
      const id = row.getAttribute(itemAttribute);
      const container = row.parentElement;
      if (!id || !container) return;

      endGesture();
      // A fresh gesture inherits nothing. A drag that ended in `pointercancel`
      // never produced the click it armed, and a flag left set would eat the
      // next real tap on the same row.
      suppressRef.current = false;

      const touch = event.pointerType === 'touch';
      const gesture = {
        id,
        container,
        origin: { x: event.clientX, y: event.clientY },
        touch,
        armed: false,
        lastIndex: rowIndex(container, itemAttribute, id),
      };
      gestureRef.current = gesture;

      /** Cancel the browser's own scroll for the rest of an armed drag. */
      const preventScroll = (touchEvent: TouchEvent) => {
        if (touchEvent.cancelable) touchEvent.preventDefault();
      };

      const arm = () => {
        if (gestureRef.current !== gesture || gesture.armed) return;
        gesture.armed = true;
        suppressRef.current = true;
        if (gesture.touch) {
          window.addEventListener('touchmove', preventScroll, { passive: false });
        }
        setDraggingId(gesture.id);
      };

      const onMove = (move: PointerEvent) => {
        if (gestureRef.current !== gesture) return;
        const travelled = Math.hypot(
          move.clientX - gesture.origin.x,
          move.clientY - gesture.origin.y
        );
        if (!gesture.armed) {
          // Before arming the two pointer types are opposites: a finger must
          // hold *still* to arm and moving cancels it, while a mouse arms by
          // moving and holding still does nothing.
          if (gesture.touch) {
            if (travelled > TOUCH_LABEL_SLOP_PX) endGesture();
            return;
          }
          if (travelled < POINTER_DRAG_THRESHOLD_PX) return;
          arm();
        }
        const next = dropIndex(gesture.container, itemAttribute, move.clientY);
        if (next === -1 || next === gesture.lastIndex) return;
        gesture.lastIndex = next;
        onReorderRef.current(gesture.id, next);
      };

      const onUp = () => {
        const dragged = gesture.armed;
        const { id: draggedId, lastIndex } = gesture;
        endGesture();
        if (dragged) onDragEndRef.current?.(draggedId, lastIndex);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      teardownRef.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        window.removeEventListener('touchmove', preventScroll);
      };

      if (touch) {
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          arm();
        }, TOUCH_LABEL_HOLD_MS);
      }
    },
    [endGesture, itemAttribute]
  );

  // Android Chrome raises a context menu on the same press that arms the drag.
  // Refused only once armed, so a right-click still reaches whatever owns it.
  const onContextMenu = useCallback((event: { preventDefault: () => void }) => {
    if (suppressRef.current) event.preventDefault();
  }, []);

  const consumeClick = useCallback(() => {
    if (!suppressRef.current) return false;
    suppressRef.current = false;
    return true;
  }, []);

  return { draggingId, handlers: { onPointerDown, onContextMenu }, consumeClick };
}

function rows(container: HTMLElement, itemAttribute: string): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(`[${itemAttribute}]`)];
}

function rowIndex(container: HTMLElement, itemAttribute: string, id: string): number {
  return rows(container, itemAttribute).findIndex(
    (row) => row.getAttribute(itemAttribute) === id
  );
}

/**
 * Which slot the pointer is over, or -1 when the list is empty.
 *
 * Read from the live DOM on every move rather than computed from the index the
 * row had at `pointerdown` — this reorders as it goes, so the dragged row's own
 * position changes mid-gesture and a remembered index would make every later
 * move look like a move. That is `DesignTabStrip`'s lesson, and it is the one
 * thing about this that is not obvious.
 *
 * Past either end the answer clamps rather than going blank. The favorites list
 * is short and the gap below its last row is the natural place to aim for when
 * you mean "put it last".
 */
function dropIndex(container: HTMLElement, itemAttribute: string, clientY: number): number {
  const list = rows(container, itemAttribute);
  if (list.length === 0) return -1;
  const over = list.findIndex((row) => {
    const box = row.getBoundingClientRect();
    return clientY >= box.top && clientY <= box.bottom;
  });
  if (over !== -1) return over;
  return clientY < list[0].getBoundingClientRect().top ? 0 : list.length - 1;
}
