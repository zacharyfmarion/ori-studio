import { useSyncExternalStore } from 'react';

/**
 * Shift, for a device with no Shift key.
 *
 * A finger can reach every *button* in the crease-pattern editor and none of the
 * modifiers, and Shift is the one that costs a capability rather than a
 * convenience. Held down it means "add to what is already selected" — for a
 * click, for a marquee, and for the commit of any region-select tool. Without it
 * a touch user can act on one crease or one marquee and never on both, which
 * gates most of the Crease Pattern menu: Change Crease Type, Make
 * Mountain/Valley/Edge/Aux, the whole Transform submenu, Delete Selected Lines.
 * It also frees a reference image's aspect ratio during a resize, which is
 * otherwise locked with no way out at all.
 *
 * So this is that key as a latch: on until switched off, because there is no
 * "held" on a touchscreen. Consumers OR it with the real `event.shiftKey`, which
 * keeps one code path — the latch produces exactly the boolean the key produces
 * and nothing downstream learns a second way to be additive. In particular it
 * does not go near the store-ids-versus-kernel-flags split that additive
 * selection already has; whatever Shift does today, the latch does too.
 *
 * Module state rather than a store slice: it is one boolean with one question,
 * it is read at event time from callbacks that must not re-subscribe, and it is
 * deliberately not persisted — a modifier that survived a reload would be a
 * mystery rather than a memory. Same shape as `platform/pointerSurface`.
 */
let latched = false;
const listeners = new Set<() => void>();

/** Read at event time, from a pointer handler that must not re-subscribe. */
export function isShiftLatched(): boolean {
  return latched;
}

/**
 * Is Shift down — by key, or by latch?
 *
 * The one question every consumer asks, so that "additive" stays a single
 * boolean with a single meaning rather than each surface learning to OR two
 * things in its own order.
 */
export function withShiftLatch(modifierHeld: boolean | undefined): boolean {
  return modifierHeld === true || latched;
}

export function setShiftLatched(next: boolean): void {
  if (latched === next) return;
  latched = next;
  for (const listener of listeners) listener();
}

/** Test seam, and the reset a surface teardown wants. */
export function resetShiftLatch(): void {
  setShiftLatched(false);
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Reactive {@link isShiftLatched}, for the control that shows its state. */
export function useShiftLatched(): boolean {
  return useSyncExternalStore(subscribe, isShiftLatched, () => false);
}
