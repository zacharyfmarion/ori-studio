import { useEffect, type RefObject } from 'react';
import { isCanvasCompanionSurface } from '../canvasObjects/canvasCompanionSurface';

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
      // A press that reached nothing under `body` landed while a modal layer
      // held the page — a Radix select's list puts `pointer-events: none` on
      // the body, so the press that closes it arrives on `<html>`. That press
      // is the layer's to dismiss, not a press outside the window: measured on
      // the Properties pane, choosing a crease style then clicking beside the
      // list blurred the window and emptied the pane mid-edit.
      if (!document.body.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      // The window's floating inspector, its portalled menus, and any docked
      // surface that edits the selection are outside the panel and must not
      // count as leaving it — one predicate answers that for every such rule.
      if (isCanvasCompanionSurface(target)) return;
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
