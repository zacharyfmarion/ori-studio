import { useSyncExternalStore } from 'react';
import type { CpOverlayView } from './CreasePatternWebglCanvas';

/**
 * The live camera affines, published every camera frame and consumed by the DOM
 * overlays (text boxes + selection handles) via {@link useCpOverlayViews}.
 *
 * Two spaces are published because the surface draws in two. Creases, images and
 * text boxes live in crease-pattern *model* space; folded figures are drawn in
 * SVG *user* space, the space their render primitives land in. The two coincide
 * only when the document carries no native Oriedita camera, so chrome for a
 * folded figure has to project through `user` while annotation chrome projects
 * through `model`.
 *
 * This is deliberately *outside* React state: the WebGL canvas reports a new view
 * on every pan/zoom frame, and routing that through the (huge) CreasePatternPanel
 * as state would re-render the whole panel 60×/s. An external store lets only the
 * small overlay components subscribe and re-render, so they stay crisp (real
 * font size, no transform-scaling blur) and in sync with the GL canvas without
 * dragging the panel into every frame.
 */
export interface CpOverlayViews {
  /** Crease-pattern model space → CSS pixels. */
  model: CpOverlayView;
  /** SVG user space → CSS pixels. */
  user: CpOverlayView;
}

let current: CpOverlayViews | null = null;
const listeners = new Set<() => void>();

export const cpOverlayViewStore = {
  get(): CpOverlayViews | null {
    return current;
  },
  set(views: CpOverlayViews): void {
    current = views;
    for (const listener of listeners) listener();
  },
  subscribe(onChange: () => void): () => void {
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  },
};

/** Subscribe to the live camera affines; re-renders the caller on every frame. */
export function useCpOverlayViews(): CpOverlayViews | null {
  return useSyncExternalStore(cpOverlayViewStore.subscribe, cpOverlayViewStore.get, () => null);
}

/** The model→CSS affine alone, for overlays that only place model-space content. */
export function useCpOverlayView(): CpOverlayView | null {
  return useCpOverlayViews()?.model ?? null;
}
