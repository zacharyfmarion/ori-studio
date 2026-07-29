import { useEffect, type RefObject } from 'react';

/**
 * The parts of the UI a focused window owns that are not inside the panel.
 *
 * Both are body-portaled: the inspector because {@link FloatingToolbar} escapes
 * transformed Dockview ancestors, and its colour menu because Radix portals
 * menu content. A containment check against the panel alone would therefore
 * blur on every scrub of the fold slider.
 */
const PORTALED_SURFACES = '.cp-inline-simulation-inspector, [data-inline-simulation-menu]';

/**
 * Give up a focused simulation window when a press lands outside the
 * crease-pattern surface entirely — another panel, a sidebar, the menu bar.
 *
 * Deliberately scoped to *outside the panel*. Presses on the canvas are already
 * handled there and handled better: the canvas knows whether the press hit a
 * crease, empty paper, or the window's own resize handles, and blurring from
 * out here would fight it. Notably, the handles live on the selection overlay
 * rather than inside the window, so a blanket outside-the-window rule would
 * drop focus at the start of every resize — and since a blurred window gives up
 * its solver session, that would reload the simulation mid-drag.
 *
 * Why windows and not annotations or folded figures: focus here also claims the
 * app-wide `simulator` shortcut scope, so a window left focused from another
 * panel keeps Space, F, C and R shadowed everywhere. An image that stays
 * selected while you click a sidebar costs nothing.
 */
export function useBlurOnPressOutside({
  active,
  panelRef,
  onBlur,
}: {
  /** Whether a window currently holds focus. Nothing is listened for when false. */
  active: boolean;
  panelRef: RefObject<HTMLElement | null>;
  onBlur: () => void;
}): void {
  useEffect(() => {
    if (!active) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(PORTALED_SURFACES)) return;
      onBlur();
    };
    // Capture, so a press that something else stops from propagating is still
    // seen. Registered only while a window is focused, and blurring immediately
    // clears `active`, so this runs at most once per focus session rather than
    // on every press — an unconditional state update per pointerdown is what
    // reflowed a pane mid-gesture and ate clicks in the BP toolbar.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [active, panelRef, onBlur]);
}
