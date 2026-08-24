import { useSyncExternalStore } from 'react';
import { isCoarsePointerSurface } from '../../platform/pointerSurface';

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

/**
 * Read at event time, from a pointer handler that must not re-subscribe.
 *
 * The pointer check is part of the answer rather than something a component
 * arranges. The latch stands in for a key the device does not have, so on a
 * device that *does* have one it is not merely unnecessary but wrong: a stale
 * `true` would make every click additive with nothing held and nothing on
 * screen to clear it.
 *
 * This lived in {@link CpShiftLatchToggle} as a flip-keyed effect and could
 * never run — both of that component's mount sites are themselves gated on a
 * coarse pointer, so React removed it in the same commit that would have told
 * it the pointer changed. An unmount cleanup, which is what it replaced, has the
 * opposite failure: on a phone the button's only home is the tool sheet, so
 * closing the sheet cleared the latch the user had just set. Neither lifecycle
 * is the right hook, because this is not a lifecycle question — the invariant is
 * "a fine pointer never sees a latch", and it holds no matter what is mounted.
 *
 * Ordering matters for cost, not just for logic: `latched` is false almost
 * always, so the media query is consulted only while the latch is on.
 */
export function isShiftLatched(): boolean {
  return latched && isCoarsePointerSurface();
}

/**
 * Is Shift down — by key, or by latch?
 *
 * The one question every consumer asks, so that "additive" stays a single
 * boolean with a single meaning rather than each surface learning to OR two
 * things in its own order.
 */
export function withShiftLatch(modifierHeld: boolean | undefined): boolean {
  return modifierHeld === true || isShiftLatched();
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
