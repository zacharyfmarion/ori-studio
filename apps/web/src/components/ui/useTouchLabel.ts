import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useIsCoarsePointerSurface } from '../../platform/pointerSurface';

/**
 * How long a finger rests on a control before the control names itself. Long
 * enough that a tap never trips it, short enough that it does not feel broken.
 */
export const TOUCH_LABEL_HOLD_MS = 400;

/**
 * Movement, in CSS px, that reads as a scroll or a drag rather than a hold.
 * Checked only while the timer is still pending: once the label is up the
 * gesture has already been classified, and re-classifying it on a jitter is how
 * a peek turns into an accidental activation.
 */
export const TOUCH_LABEL_SLOP_PX = 10;

export interface TouchLabelHold {
  /**
   * What to hand Radix's `<Tooltip open>`.
   *
   * `true` while a hold is showing the label, and `undefined` — *not* `false` —
   * every other moment. `undefined` leaves the tooltip uncontrolled, so hover
   * keeps working exactly as it does today. An iPad with a Magic Keyboard
   * reports a coarse pointer while its trackpad still hovers, and a permanently
   * controlled tooltip would take the label away from that trackpad to give it
   * to the finger.
   */
  open: true | undefined;
  /** Spread on the tooltip's trigger. */
  handlers: {
    onPointerDown: (event: ReactPointerEvent) => void;
    onPointerMove: (event: ReactPointerEvent) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onContextMenu: (event: { preventDefault: () => void }) => void;
  };
  /**
   * True for the click that ends a hold, and false for every other click.
   *
   * The trigger must ask this before running its own action, because the press
   * that summoned the label is still a press: without it, holding Delete to find
   * out what Delete does deletes. Deliberately a call and not a prop wrapper —
   * the two call sites own their `onClick`, and a hook that swallowed it would
   * have to be given it.
   */
  consumeClick: () => boolean;
}

/**
 * A finger's way of asking an icon what it is.
 *
 * Radix's tooltip has no touch path at all, by design rather than by omission:
 * its trigger returns early from `onPointerMove` when `pointerType === "touch"`,
 * closes on `onPointerDown`, and suppresses the `onFocus` open whenever a
 * pointer is down — which is every focus a tap produces. So on a bare iPad an
 * icon button's only visible label is unreachable in any order the events
 * arrive, and the tool rail is 52 icons deep.
 *
 * This is the in-place answer: press and hold, read the label, lift. It is not
 * the *discoverable* one — a user who does not know to try it never learns
 * anything — which is why the rail also grows a visible picker. Here for the
 * case where you know roughly where the tool is and only need to be told which.
 *
 * Not a canvas long-press, and not the same risk. That one was removed because a
 * deliberate press on the canvas *is* a work-producing gesture — press-and-hold
 * with a drawing tool places a crease start, so the timer fired on real work. A
 * button's only interaction is a tap; there is nothing here for a press to be
 * mistaken for, and {@link TouchLabelHold.consumeClick} means it commits
 * nothing.
 */
export function useTouchLabel(): TouchLabelHold {
  const coarsePointer = useIsCoarsePointerSurface();
  const [held, setHeld] = useState(false);
  const timerRef = useRef<number | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  /** The hold fired, so the click closing this gesture is not an activation. */
  const suppressRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      clearTimer();
      // A fresh gesture inherits nothing. A hold that ended in `pointercancel`
      // never produced the click it armed, and without this the flag would sit
      // there and eat the next real tap on the same control.
      suppressRef.current = false;
      setHeld(false);
      if (!coarsePointer || event.pointerType !== 'touch') return;
      originRef.current = { x: event.clientX, y: event.clientY };
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        suppressRef.current = true;
        setHeld(true);
      }, TOUCH_LABEL_HOLD_MS);
    },
    [clearTimer, coarsePointer]
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      const origin = originRef.current;
      if (timerRef.current === null || !origin) return;
      const moved = Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
      if (moved > TOUCH_LABEL_SLOP_PX) clearTimer();
    },
    [clearTimer]
  );

  const onPointerUp = useCallback(() => {
    clearTimer();
    setHeld(false);
  }, [clearTimer]);

  const onPointerCancel = useCallback(() => {
    clearTimer();
    setHeld(false);
    suppressRef.current = false;
  }, [clearTimer]);

  // Android Chrome raises a context menu on the same press. Refused only once
  // the label is up, so a right-click on a desktop still reaches whatever owns
  // it — nothing on these controls today, but silently claiming the event would
  // be a trap for whatever does next.
  const onContextMenu = useCallback((event: { preventDefault: () => void }) => {
    if (suppressRef.current) event.preventDefault();
  }, []);

  const consumeClick = useCallback(() => {
    if (!suppressRef.current) return false;
    suppressRef.current = false;
    return true;
  }, []);

  return {
    open: held ? true : undefined,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onContextMenu },
    consumeClick,
  };
}
