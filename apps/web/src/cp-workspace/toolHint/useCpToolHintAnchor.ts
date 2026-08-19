/**
 * Keeps the tool hint window glued to the crease-pattern viewport's bottom-right
 * corner as the layout moves under it.
 *
 * The window is portaled to `document.body` and positioned `fixed` — it has to
 * be, because it overhangs the seam between two Dockview panels and either
 * neighbour would clip it (`.cp-panel__viewport` is `overflow: hidden`,
 * `.panel-body` is `overflow: auto`, and Dockview panels trap `fixed`
 * descendants). Being outside the layout, it has to be told where the layout
 * went.
 *
 * Deliberately **not** subscribed to `cpOverlayViewStore`. The object toolbars
 * subscribe there because they track a thing that moves under the camera; this
 * window is pinned to the pane, so a per-frame subscription would re-render it
 * 60x/s during a pan to compute the same numbers.
 */
import { useLayoutEffect, useState } from 'react';
import { cpToolHintPlacement, type CpToolHintPlacement } from './toolHintPlacement';

function samePlacement(a: CpToolHintPlacement | null, b: CpToolHintPlacement): boolean {
  return a !== null && a.left === b.left && a.bottom === b.bottom && a.width === b.width;
}

/**
 * Fixed-position offsets for the window, or null while there is nothing to
 * anchor to — no viewport element, or one that is laid out but not displayed.
 */
export function useCpToolHintAnchor(container: HTMLElement | null): CpToolHintPlacement | null {
  const [placement, setPlacement] = useState<CpToolHintPlacement | null>(null);

  useLayoutEffect(() => {
    if (!container) {
      setPlacement(null);
      return undefined;
    }

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());

    const measure = () => {
      const rect = container.getBoundingClientRect();
      // A panel that exists but is not being displayed measures 0x0. Anchoring to
      // that would park the window in the top-left corner of the screen.
      if (rect.width === 0 && rect.height === 0) {
        setPlacement(null);
        return;
      }
      // Scoped to this viewport, so it cannot pick up another surface's toolbar.
      // Measured rather than assumed constant: which controls the toolbar carries
      // depends on the document, and so does how wide it ends up.
      const toolbar = container.querySelector('.viewport-toolbar');
      // Observed here rather than at setup, because it mounts with the document
      // and then changes width in place — gaining folded-figure controls, say —
      // which the container's own box never reflects. `observe` is idempotent per
      // element, so repeating it costs nothing.
      if (toolbar) observer?.observe(toolbar);

      const next = cpToolHintPlacement(
        rect,
        { width: window.innerWidth, height: window.innerHeight },
        toolbar?.getBoundingClientRect() ?? null,
      );
      // The observer fires for changes that leave this rule's inputs alone
      // (height-only splits, sub-pixel reflows). Bailing on an equal result keeps
      // those out of the window's render path.
      setPlacement((current) => (samePlacement(current, next) ? current : next));
    };

    measure();

    // The sash between the viewport and the View pane resizes both, so observing
    // the viewport is enough to follow a drag of the seam itself.
    observer?.observe(container);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [container]);

  return placement;
}
