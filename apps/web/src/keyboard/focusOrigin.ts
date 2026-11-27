/**
 * Whether a pointer press put focus where it is: the question a surface asks
 * before it leaves a key to the focused control.
 *
 * Chromium focuses a button a pointer presses; Safari and Firefox on the Mac
 * do not. So after a click on a rail button, a header button or a switch,
 * focus can sit on a control the keyboard never went to, and a key the
 * surface leaves to a focused control — Fold's Enter, which commits — goes to
 * that button instead. A control the keyboard reached keeps its keys; one a
 * pointer pressed need not.
 *
 * Tracked for the lifetime of the app, beside the held modifiers: the press
 * that focused a control can come before the surface that asks is mounted,
 * as the workspace rail's button that opens it does.
 */

/** Whether the latest input was a pointer press rather than a key. */
let pressing = false;
/** The element focus last moved to while `pressing`, or null when the keyboard or a script after a key moved it. */
let pressed: Element | null = null;

/** Track how focus arrives for the lifetime of the app. Call once; returns an uninstall. */
export function installFocusOriginTracker(target: Window = window): () => void {
  const onPointerDown = () => {
    pressing = true;
  };
  const onKeyDown = () => {
    pressing = false;
  };
  const onFocusIn = (event: FocusEvent) => {
    pressed = pressing && event.target instanceof Element ? event.target : null;
  };
  target.addEventListener('pointerdown', onPointerDown, true);
  target.addEventListener('keydown', onKeyDown, true);
  target.addEventListener('focusin', onFocusIn, true);
  return () => {
    target.removeEventListener('pointerdown', onPointerDown, true);
    target.removeEventListener('keydown', onKeyDown, true);
    target.removeEventListener('focusin', onFocusIn, true);
    pressing = false;
    pressed = null;
  };
}

/**
 * Whether `element` took focus from a pointer press and holds it still. A key
 * since then does not change the answer: focus moved by Tab, or by a script
 * after a key, is the keyboard's.
 */
export function focusedByPointer(element: Element | null): boolean {
  return element !== null && element === pressed;
}
