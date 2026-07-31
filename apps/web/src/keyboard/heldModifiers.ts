import { isShortcutEditingTarget } from './shortcutDispatcher';

/**
 * Which modifier keys are physically held right now.
 *
 * This is a third kind of keyboard input, distinct from the two the shortcut
 * registry handles. A *chord* is an event (Cmd+S fires once); a *held modifier*
 * is a state that persists between events and that other surfaces sample. The
 * registry cannot express it -- `keyChordFromKeyboardEvent` returns `null` for
 * modifier-only keys, by design -- so it gets this small primitive instead,
 * living beside the dispatcher rather than in whichever panel happened to want
 * it first.
 *
 * Window-scoped and capture-phase, because a held modifier must not depend on
 * where focus is: the crease-pattern surface portals its floating toolbars,
 * context menus and inline text editor, and a container-scoped listener goes
 * dead the moment one of those takes focus. (See AGENTS.md > "Panel
 * components"; `DesignPanel`'s container-scoped space-to-pan is the shape this
 * deliberately does not copy.)
 *
 * Ported from Oriedita, which tracks the same state as
 * `CanvasModel.toggleLineColor` through root-pane `InputMap` bindings at
 * `WHEN_IN_FOCUSED_WINDOW` (`App.java:210-258`).
 */
export interface HeldModifiers {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

const NONE: HeldModifiers = { ctrl: false, alt: false, shift: false, meta: false };

let held: HeldModifiers = NONE;
const listeners = new Set<() => void>();

/** The modifiers held right now. Stable identity between changes. */
export function readHeldModifiers(): HeldModifiers {
  return held;
}

/**
 * Subscribe to modifier changes. Fires on *any* modifier transition, so
 * subscribers should derive a primitive (see `isLineColorInversionModifierHeld`)
 * and let React bail out when their own answer did not change.
 */
export function subscribeHeldModifiers(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function publish(next: HeldModifiers): void {
  if (
    next.ctrl === held.ctrl &&
    next.alt === held.alt &&
    next.shift === held.shift &&
    next.meta === held.meta
  ) {
    // No transition. This is also the auto-repeat guard: a repeating keydown
    // reports the same modifier state, so it never reaches a listener. Upstream
    // needs an explicit `if (!getToggleLineColor())` for this (`App.java:215`).
    return;
  }
  held = next;
  for (const listener of listeners) listener();
}

/**
 * Adopt the modifier state carried by any UI event.
 *
 * One function serves keydown, keyup and the pointer resync because every such
 * event reports the modifier state *after* it: a `keydown` on Control has
 * `ctrlKey === true`, its `keyup` has `ctrlKey === false`.
 */
export function syncHeldModifiersFromEvent(event: {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): void {
  publish({
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  });
}

/** Drop every modifier. For focus loss, and for test teardown. */
export function clearHeldModifiers(): void {
  publish(NONE);
}

/**
 * Track held modifiers for the lifetime of the app. Call once; returns an
 * uninstall.
 */
export function installHeldModifierTracker(target: Window = window): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    // A text field owns its own keystrokes -- Ctrl+A is a line-start move on
    // macOS -- and letting one strobe the tool rail is noise. Same predicate the
    // shortcut dispatcher uses, so there is exactly one answer to "does this
    // target own its keys".
    if (isShortcutEditingTarget(event.target)) return;
    syncHeldModifiersFromEvent(event);
  };
  // Key-up is never gated on the target. A modifier pressed over the canvas and
  // released after focus moved into a text field must still come back up, or the
  // flag latches on with no key left to clear it.
  const onKeyUp = (event: KeyboardEvent) => syncHeldModifiersFromEvent(event);
  // Focus loss is the case a keyup cannot cover: Cmd+Tab away, or a macOS system
  // shortcut like Ctrl+Up, and the release lands in another application.
  const onReset = () => clearHeldModifiers();

  // `contextmenu` is deliberately *not* a reset. On macOS Ctrl+click raises the
  // menu with Control still genuinely down, so resetting there would drop the
  // state mid-gesture; a native menu that eats the keyup instead self-heals on
  // the next pointer move over the canvas (`syncHeldModifiersFromEvent`).
  target.addEventListener('keydown', onKeyDown, true);
  target.addEventListener('keyup', onKeyUp, true);
  target.addEventListener('blur', onReset);
  target.document.addEventListener('visibilitychange', onReset);

  return () => {
    target.removeEventListener('keydown', onKeyDown, true);
    target.removeEventListener('keyup', onKeyUp, true);
    target.removeEventListener('blur', onReset);
    target.document.removeEventListener('visibilitychange', onReset);
    clearHeldModifiers();
  };
}
