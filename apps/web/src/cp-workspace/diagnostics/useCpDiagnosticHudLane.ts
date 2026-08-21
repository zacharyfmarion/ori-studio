/**
 * Feeds {@link cpDiagnosticHudLaneTop} the two boxes it compares.
 *
 * Both are measured rather than assumed. The readout's width follows the active
 * tool's step prompt and the document's line count, and its height follows
 * whether that text wrapped — which is the whole narrow-width case. The HUD's own
 * width is capped in the stylesheet against the pane and grows when it expands,
 * so where its left edge lands is a fact about the layout too, not a constant
 * this file could restate.
 *
 * The viewport is found by class, and the readout inside it the same way
 * `useCpToolHintAnchor` finds the viewport toolbar. One lookup serves twice: the
 * viewport is both the box the HUD's `top` resolves against and the scope that
 * keeps the readout query off another surface's status strip.
 */
import { useLayoutEffect, useState } from 'react';
import { cpDiagnosticHudLaneTop } from './hudPlacement';

export function useCpDiagnosticHudLane(hud: HTMLElement | null): number | null {
  const [top, setTop] = useState<number | null>(null);

  useLayoutEffect(() => {
    const viewport = hud?.closest('.cp-panel__viewport');
    if (!hud || !(viewport instanceof HTMLElement)) {
      setTop(null);
      return undefined;
    }

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());

    const measure = () => {
      const frame = viewport.getBoundingClientRect();
      // A viewport that exists but is not being displayed measures 0x0, and every
      // box inside it collapses onto the origin — indistinguishable from a real
      // overlap. Nothing to place against, so nothing to say.
      if (frame.width === 0 && frame.height === 0) {
        setTop(null);
        return;
      }

      const readout = viewport.querySelector('.viewport-status-readout');
      // Observed here rather than at setup, because it mounts with the editable
      // document and then changes size in place as the step prompt and counts
      // change under it. `observe` is idempotent per element, so repeating it
      // costs nothing.
      if (readout) observer?.observe(readout);

      const hudRect = hud.getBoundingClientRect();
      const readoutRect = readout?.getBoundingClientRect();
      const next = cpDiagnosticHudLaneTop(
        { left: hudRect.left - frame.left },
        readoutRect && {
          left: readoutRect.left - frame.left,
          right: readoutRect.right - frame.left,
          bottom: readoutRect.bottom - frame.top,
        }
      );
      // The observers fire for changes this rule ignores — a height-only pane
      // resize, a sub-pixel reflow. Bailing on an equal result keeps those out of
      // the HUD's render path, which is also the virtualizer's.
      setTop((current) => (current === next ? current : next));
    };

    measure();

    // The HUD's own box is an input: expanding it states a width where the
    // collapsed badge shrank to fit, moving its left edge. Only its size is read,
    // so writing `top` back cannot re-trigger this.
    observer?.observe(hud);
    observer?.observe(viewport);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [hud]);

  return top;
}
