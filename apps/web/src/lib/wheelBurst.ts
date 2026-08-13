/**
 * Which surface a wheel gesture belongs to, for as long as it is in flight.
 *
 * A wheel event carries no gesture identity: there is no `wheelstart` and no
 * `wheelend`, so every event is delivered to whatever happens to be under the
 * cursor at that instant. On a canvas with objects floating over it — inline
 * simulation windows, folded figures — that means a pan begun on the pattern
 * changes hands the moment the cursor crosses one, and turns into a zoom of the
 * thing it crossed. The gesture was never aimed at that object; the cursor was
 * merely passing over it on the way somewhere else.
 *
 * So ownership is decided once, by the first event of a burst, and every later
 * event is routed to that owner regardless of where the cursor now is. A drag
 * gets this for free from pointer capture — this is the same guarantee for the
 * one input that cannot be captured.
 *
 * The burst is bounded by an idle timer, which is the only end a wheel has. The
 * same shape as `useFoldedFigures`'s zoom-commit burst, and deliberately a
 * separate quantity: that one debounces a store write, this one decides who is
 * being gestured at.
 */

/**
 * How long the wheel must go quiet before the next event starts a new gesture.
 *
 * Trackpad momentum keeps events flowing at frame rate long after the fingers
 * lift, and that tail is part of the same gesture — so this has to outlast the
 * gaps *within* a flick without swallowing the pause between two deliberate
 * ones. 220ms is what the folded-figure zoom settled on for the same reason.
 */
const WHEEL_BURST_SETTLE_MS = 220;

interface LiveBurst {
  id: number;
  owner: Element;
  timer: number;
}

let live: LiveBurst | null = null;
let nextId = 1;

export interface WheelBurstClaim {
  /** The element this gesture belongs to, which may not be the caller. */
  owner: Element;
  /**
   * Identity of the gesture in flight. A caller that derives something at the
   * start of a burst — which object was under the cursor, say — keeps it keyed
   * on this rather than on a "was I first" flag: several handlers claim per
   * event (the object, then the surface it forwards to), so only one of them
   * would ever see the burst as new.
   */
  id: number;
}

/**
 * Report who owns the wheel gesture now in flight, starting one owned by
 * `candidate` when none is.
 *
 * Safe to call more than once for the same event: the first call fixes the
 * owner, later ones only extend the idle window.
 */
export function claimWheelBurst(candidate: Element): WheelBurstClaim {
  if (live) window.clearTimeout(live.timer);
  const id = live?.id ?? nextId++;
  const owner = live?.owner ?? candidate;
  live = {
    id,
    owner,
    timer: window.setTimeout(endWheelBurst, WHEEL_BURST_SETTLE_MS),
  };
  return { owner, id };
}

/**
 * Drop the gesture in flight, so the next event starts a fresh one.
 *
 * Called by the idle timer. Exported for tests, and for anything that knows a
 * gesture is over sooner than the clock does.
 */
export function endWheelBurst(): void {
  if (live) window.clearTimeout(live.timer);
  live = null;
}

/**
 * Deliver a wheel event to a surface that is not under the cursor.
 *
 * A copy rather than the event itself: an event already being dispatched cannot
 * be re-dispatched, and the copy is deliberately non-bubbling so it reaches the
 * intended surface without walking back up through whatever forwarded it.
 */
export function forwardWheel(target: EventTarget, event: WheelEvent): void {
  target.dispatchEvent(
    new WheelEvent('wheel', {
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      clientX: event.clientX,
      clientY: event.clientY,
      // The modifiers are what tell a canvas pan from a zoom, so a copy without
      // them turns a pinch over the chrome into a pan.
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      cancelable: true,
    })
  );
}
