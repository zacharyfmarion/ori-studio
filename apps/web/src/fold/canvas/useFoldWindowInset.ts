import { useLayoutEffect, useMemo, useState } from 'react';
import type { CpSurfaceInset } from '../../cp-workspace/surface/useCpSurface';

/** The part of a `DOMRect` the inset reads. */
export interface FoldInsetRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * How far up from the pane's bottom edge a window over it reaches, CSS px:
 * from its top edge down, within the pane. Nothing for a window beside the
 * pane rather than over it, or one with no box (not laid out yet).
 */
export function coveredFromBottom(pane: FoldInsetRect, cover: FoldInsetRect): number {
  const overlaps = cover.right > pane.left && cover.left < pane.right && cover.bottom > pane.top;
  if (!overlaps || cover.bottom <= cover.top) return 0;
  return Math.max(0, Math.min(pane.bottom - pane.top, pane.bottom - cover.top));
}

/**
 * The inset a phone's Fold pane fits its paper within (`useCpSurface`'s
 * `inset`): the bottom of the viewport the tool window covers, its bar
 * included, so the paper stays in view above the window rather than centred
 * under it. Followed as the window opens, closes and animates between, and as
 * the viewport changes size; null off a phone, where the window sits over the
 * corner of the crease pattern and the paper keeps the whole pane.
 *
 * The window's frame is never given to a `ResizeObserver`. Its height is set
 * by `useAnimatedHeight` from inside that hook's own observer callback, and a
 * second observer on the frame then has a notification the browser cannot
 * deliver in that pass: it fires "ResizeObserver loop completed with
 * undelivered notifications" at the window, which the app shows as a
 * background error. So the frame is followed through what changes it — its
 * own attributes (the height and `data-resizing` that hook sets) and its
 * content — measured on the next frame, and every frame while its height
 * moves. Only the viewport, which nothing resizes from an observer, is
 * observed.
 *
 * Whole px, so a sub-pixel reflow is not a new inset to fit to.
 */
export function useFoldWindowInset(
  viewport: HTMLElement | null,
  frame: HTMLElement | null,
  enabled: boolean
): CpSurfaceInset | null {
  const [bottom, setBottom] = useState(0);

  useLayoutEffect(() => {
    if (!enabled || !viewport || !frame) {
      setBottom(0);
      return undefined;
    }
    const measure = () => setBottom(Math.round(coveredFromBottom(viewport.getBoundingClientRect(), frame.getBoundingClientRect())));
    measure();
    // On the next frame, and on each one after while the window's height animates.
    let pending = 0;
    const follow = () => {
      if (pending) return;
      const step = () => {
        measure();
        pending = 'resizing' in frame.dataset ? requestAnimationFrame(step) : 0;
      };
      pending = requestAnimationFrame(step);
    };
    // jsdom has neither observer for layout; the inset is then measured once.
    const changes = typeof MutationObserver === 'undefined' ? null : new MutationObserver(follow);
    changes?.observe(frame, { attributes: true, childList: true, subtree: true, characterData: true });
    const resizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(follow);
    resizes?.observe(viewport);
    window.addEventListener('resize', follow);
    return () => {
      changes?.disconnect();
      resizes?.disconnect();
      cancelAnimationFrame(pending);
      window.removeEventListener('resize', follow);
    };
  }, [viewport, frame, enabled]);

  return useMemo(() => (bottom > 0 ? { top: 0, right: 0, bottom, left: 0 } : null), [bottom]);
}
