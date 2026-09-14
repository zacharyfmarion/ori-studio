/**
 * The one answer to "does this pointer or focus target belong to a surface
 * that edits the current canvas selection?"
 *
 * Two rules used to answer it with two attribute lists: the focused-window
 * blur (`useBlurOnPressOutside`) allowed the window's floating inspector and
 * its portalled colour menu, and the text editor's `focusout` exit allowed
 * `[data-cp-text-toolbar]`. A Properties pane docked outside the crease-pattern
 * panel is a third surface both rules must allow, so the attribute is one and
 * the predicate is one — per AGENTS.md's "one predicate per question".
 *
 * Every floating toolbar over the canvas carries it (`FloatingToolbar` sets it
 * on its root), as do the region chips, the Properties pane, and every
 * portalled menu those surfaces open.
 */
export const CANVAS_COMPANION_ATTR = 'data-cp-companion';

export function isCanvasCompanionSurface(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${CANVAS_COMPANION_ATTR}]`) !== null;
}

/** Spread onto a root element or a portalled content to mark it. */
export const CANVAS_COMPANION_PROPS = { [CANVAS_COMPANION_ATTR]: '' } as const;
