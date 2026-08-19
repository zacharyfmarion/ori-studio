import { useEffect, useRef } from 'react';
import { forwardWheel } from '../lib/wheelBurst';

/**
 * Hand a wheel gesture over a piece of floating chrome to the surface underneath.
 *
 * Chrome that sits over a pan/zoom canvas — selection handles, a floating
 * toolbar — takes pointer events so its own controls work, and that also makes
 * it swallow the wheel. Left alone the canvas stops zooming while the cursor is
 * over it, and, worse, the browser zooms the *page* instead: a trackpad pinch
 * arrives as ctrl+wheel, and React registers `wheel` passively at its root, so
 * `preventDefault()` from an `onWheel` prop never takes effect. The listener
 * here is native and non-passive, which is the only way that call is honoured.
 *
 * The gesture is claimed whether or not a target resolves. It was aimed at the
 * canvas, and browser zoom is never the right answer for it — so a missing
 * target means the gesture is dropped, not escalated to the page.
 *
 * @param element the chrome to intercept on; null while it is unmounted
 * @param resolveTarget the surface to forward to, re-read on every event so a
 *   caller can point at something that mounts later. Undefined leaves the wheel
 *   alone entirely — chrome over ordinary scrollable content wants the default.
 */
export function useWheelPassthrough(
  element: Element | null,
  resolveTarget: (() => Element | null | undefined) | undefined,
): void {
  // Held in a ref so an inline arrow from the caller does not detach and
  // reattach the listener on every render.
  const resolveRef = useRef(resolveTarget);
  useEffect(() => {
    resolveRef.current = resolveTarget;
  }, [resolveTarget]);

  const enabled = resolveTarget !== undefined;

  useEffect(() => {
    if (!element || !enabled) return;

    // Typed as `Event` because `Element` carries no wheel entry in its event
    // map — the narrowing is what gives the deltas back, not a cast.
    const onWheel = (event: Event) => {
      if (!(event instanceof WheelEvent)) return;
      event.preventDefault();
      const target = resolveRef.current?.();
      // `contains` covers itself, so chrome that resolves to something within
      // its own subtree drops the gesture rather than re-entering this handler.
      if (!target || element.contains(target)) return;
      forwardWheel(target, event);
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [element, enabled]);
}
