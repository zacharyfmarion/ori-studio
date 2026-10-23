import { useSyncExternalStore } from 'react';
import { isCoarsePointerSurface } from '../../platform/pointerSurface';

/**
 * Alt, for a device with no Alt key (plan D14): on the Fold canvas, Alt puts a
 * point down anywhere on the paper rather than snapping it to a landmark — a
 * free point is a sheet point like any other (D6) — and a finger has no Alt to
 * hold.
 *
 * Edit's Shift latch (`cp-workspace/touchModifiers/shiftLatch.ts`) to the
 * letter, for the other modifier: a latch, on until switched off, because
 * there is no "held" on a touchscreen; read at event time and OR'd with the
 * real key (`readHeldModifiers().alt`), so the canvas has one question to ask;
 * module state, never persisted. And, as there, the pointer check is part of
 * the answer: a stale latch on a device with a keyboard would make every point
 * free with nothing held and nothing on screen to clear it.
 */
let latched = false;
const listeners = new Set<() => void>();

/** Read at event time, from a pointer handler that must not re-subscribe. */
export function isFoldAltLatched(): boolean {
  return latched && isCoarsePointerSurface();
}

export function setFoldAltLatched(next: boolean): void {
  if (latched === next) return;
  latched = next;
  for (const listener of listeners) listener();
}

/** Test seam, and the reset a surface teardown wants. */
export function resetFoldAltLatch(): void {
  setFoldAltLatched(false);
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Reactive {@link isFoldAltLatched}, for the control that shows its state. */
export function useFoldAltLatched(): boolean {
  return useSyncExternalStore(subscribe, isFoldAltLatched, () => false);
}
