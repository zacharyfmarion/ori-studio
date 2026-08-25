import { useSyncExternalStore } from 'react';

/**
 * Whether the device's *primary* pointer is a fingertip.
 *
 * `pointer` and not `any-pointer`: the question callers ask is "must this
 * interaction survive touch", and that is decided by what the user reaches for
 * first. An iPad with a Magic Keyboard still reports `coarse` — the trackpad is
 * the accessory, the screen is the input — while a touchscreen laptop reports
 * `fine`. `any-pointer: coarse` would answer "is a finger available at all" and
 * sweep every touchscreen laptop into the touch behaviour.
 *
 * This is deliberately not the phone gate (`platform/mobileSurface`). That one
 * asks whether the workspace fits at all and combines coarseness with viewport
 * size; this one asks only what the pointer is, because an iPad is a device the
 * app opens on and still has no `dragstart`.
 */
export const COARSE_POINTER_QUERY = '(pointer: coarse)';

/** A host that can answer media queries. */
export type MediaHost = Pick<Window, 'matchMedia'>;

function defaultHost(): MediaHost | null {
  if (typeof window === 'undefined') return null;
  if (typeof window.matchMedia !== 'function') return null;
  return window;
}

/**
 * True on a touch-first device.
 *
 * A host that cannot answer media queries — jsdom without a stub, any
 * non-browser — answers `false`, so anything headless gets the pointer
 * behaviour rather than the touch fallback.
 */
export function isCoarsePointerSurface(host: MediaHost | null = defaultHost()): boolean {
  return host?.matchMedia(COARSE_POINTER_QUERY).matches ?? false;
}

// --- Reactive binding -------------------------------------------------------

function subscribe(onChange: () => void): () => void {
  const query = defaultHost()?.matchMedia(COARSE_POINTER_QUERY);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

function readSnapshot(): boolean {
  return isCoarsePointerSurface();
}

/**
 * Reactive {@link isCoarsePointerSurface}.
 *
 * The primary pointer can change under a live app: a convertible flipped out of
 * tablet mode reports `fine` from that moment on. Anything gated on coarseness
 * should follow rather than sample once at mount, since the alternative is a
 * dock that stays locked until reload.
 */
export function useIsCoarsePointerSurface(): boolean {
  return useSyncExternalStore(subscribe, readSnapshot, () => false);
}
