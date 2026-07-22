import { useSyncExternalStore } from 'react';
import type { CpOverlayView } from './CreasePatternWebglCanvas';

/**
 * The live model→CSS camera affine, published every camera frame and consumed by
 * the DOM overlays (text boxes + selection handles) via {@link useCpOverlayView}.
 *
 * This is deliberately *outside* React state: the WebGL canvas reports a new view
 * on every pan/zoom frame, and routing that through the (huge) CreasePatternPanel
 * as state would re-render the whole panel 60×/s. An external store lets only the
 * small overlay components subscribe and re-render, so they stay crisp (real
 * font size, no transform-scaling blur) and in sync with the GL canvas without
 * dragging the panel into every frame.
 */
let current: CpOverlayView | null = null;
const listeners = new Set<() => void>();

export const cpOverlayViewStore = {
  get(): CpOverlayView | null {
    return current;
  },
  set(view: CpOverlayView): void {
    current = view;
    for (const listener of listeners) listener();
  },
  subscribe(onChange: () => void): () => void {
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  },
};

/** Subscribe to the live camera affine; re-renders the caller on every frame. */
export function useCpOverlayView(): CpOverlayView | null {
  return useSyncExternalStore(cpOverlayViewStore.subscribe, cpOverlayViewStore.get, () => null);
}
