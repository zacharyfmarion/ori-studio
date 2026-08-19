import { useCallback, useEffect, useRef, useState } from 'react';
import type { CpOverlayView } from '../CreasePatternWebglCanvas';
import { cpOverlayViewStore } from '../cpOverlayViewStore';

/**
 * A camera subscription for DOM overlays that place content by projecting
 * model-space points to CSS pixels.
 *
 * The direct subscription — {@link useCpOverlayView} — re-renders its caller on
 * every camera frame. For a layer of N absolutely-positioned children that means
 * N inline `transform` writes, a full reconciliation, and a style/layout/paint
 * pass, per frame. Measured on a 3.5s pan with the fold-angle badges on: 202ms
 * of React and ~230ms of style, layout and layerize, against 7.5ms for the GL
 * canvas the overlay sits on top of.
 *
 * But a pan is a *pure translation*. It moves `origin` and leaves the basis
 * (`ex`, `ey`) alone, so while the basis holds every projected point moves by
 * the same delta — and one `translate()` on the container reproduces all of them
 * exactly. Not an approximation of the projection; the same affine, factored.
 * Only zoom and rotation change the basis, and only then does a caller have to
 * re-project (which is also when it must: screen *lengths* change, and those are
 * what decide culling and level of detail).
 *
 * So this hands back a **plan view** that changes only when the basis does, plus
 * a ref for the container it writes the pan offset onto directly. A caller
 * projects against `view` exactly as it would have against the live view, and
 * re-renders orders of magnitude less often.
 *
 * The offset is written synchronously from the store notification, and the
 * canvas publishes its view synchronously just before it draws, so the overlay
 * stays in lockstep with the GL surface rather than trailing it by a frame.
 *
 * Sibling of `useSettledScale`, which does the same thing along the other axis:
 * hold the layout still while the camera moves and let a transform carry the
 * change. The two differ where the axes differ. Scale has no exact factoring —
 * a stretched raster is a lossy stand-in for a re-layout — so that one waits out
 * a settle timer and bounds how far it will stretch first. Translation *is*
 * exact, so this one needs neither: it re-projects precisely when the basis
 * changes, and never merely because time passed.
 *
 * They compose, and the window layers are the case for it: they defuse zoom with
 * `useSettledScale` but still re-render on every pan frame.
 */

/** True when two views differ by at most a translation. */
function sameBasis(a: CpOverlayView, b: CpOverlayView): boolean {
  return a.ex[0] === b.ex[0] && a.ex[1] === b.ex[1] && a.ey[0] === b.ey[0] && a.ey[1] === b.ey[1];
}

export interface PannedOverlayView {
  /** Project against this. Changes only when the camera basis does. */
  view: CpOverlayView | null;
  /** Attach to the element wrapping the projected content. */
  containerRef: (node: HTMLElement | null) => void;
}

export function usePannedOverlayView(): PannedOverlayView {
  const [view, setView] = useState<CpOverlayView | null>(
    () => cpOverlayViewStore.get()?.model ?? null,
  );
  // The plan the DOM currently reflects. Held in a ref as well as state because
  // the store notification runs outside React and has to compare against the
  // plan as it is *now*, not the one the last render closed over.
  const planRef = useRef<CpOverlayView | null>(view);
  const nodeRef = useRef<HTMLElement | null>(null);

  const writeOffset = useCallback((live: CpOverlayView | null) => {
    const node = nodeRef.current;
    if (!node) return;
    const plan = planRef.current;
    if (!live || !plan) {
      node.style.transform = '';
      return;
    }
    const dx = live.origin[0] - plan.origin[0];
    const dy = live.origin[1] - plan.origin[1];
    node.style.transform = dx === 0 && dy === 0 ? '' : `translate(${dx}px, ${dy}px)`;
  }, []);

  const sync = useCallback(() => {
    const live = cpOverlayViewStore.get()?.model ?? null;
    const plan = planRef.current;
    if (live && plan && sameBasis(plan, live)) {
      // A pan: one style write, and React never hears about it.
      writeOffset(live);
      return;
    }
    // A zoom, a rotation, or the first view — the projection itself changed, so
    // the caller re-projects and the accumulated offset goes back to zero.
    planRef.current = live;
    writeOffset(live);
    setView(live);
  }, [writeOffset]);

  useEffect(() => {
    // Catch anything published between this render and the subscription landing.
    sync();
    return cpOverlayViewStore.subscribe(sync);
  }, [sync]);

  const containerRef = useCallback(
    (node: HTMLElement | null) => {
      nodeRef.current = node;
      // The container can mount a pan behind the live camera — a re-plan renders
      // at the new basis, and any frame that arrived since still has to land on
      // the node that just appeared.
      writeOffset(cpOverlayViewStore.get()?.model ?? null);
    },
    [writeOffset],
  );

  return { view, containerRef };
}
