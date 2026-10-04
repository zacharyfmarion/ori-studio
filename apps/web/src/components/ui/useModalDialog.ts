import { useCallback, useEffect, useRef, type FocusEvent, type RefObject } from 'react';
import { isOpenLayerTarget, isShortcutEditingTarget } from '../../keyboard/shortcutDispatcher';

/** The modal dialog on top — the last in the document, as they stack — or null with none open. */
export function topmostModalDialog(): Element | null {
  const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
  return dialogs[dialogs.length - 1] ?? null;
}

/** Is `root` the dialog on top? */
export function isTopmostDialog(root: Element | null): boolean {
  return root !== null && topmostModalDialog() === root;
}

/**
 * What a dialog opening now gives focus back to when it closes: what has
 * focus — or, when that is a menu's row, which goes with its menu, the button
 * that opened the menu (`aria-labelledby` names it, as Radix's menus do).
 * Null when there is nothing to go back to.
 */
export function dialogOpener(): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return null;
  const menu = active.closest('[role="menu"]');
  if (!menu) return active;
  const trigger = document.getElementById(menu.getAttribute('aria-labelledby') ?? '');
  return trigger instanceof HTMLElement && trigger.tabIndex >= 0 ? trigger : null;
}

export interface ModalDialog {
  /** The dialog: `role="dialog" aria-modal="true" data-shortcut-barrier`, its backdrop. */
  rootRef: RefObject<HTMLDivElement | null>;
  /** The surface inside it, `role="document" tabIndex={-1}`: where focus rests. */
  documentRef: RefObject<HTMLDivElement | null>;
  /** The surface's `onBlur`: focus a field let go of comes back to the surface rather than to `<body>`. */
  keepFocus: (event: FocusEvent<HTMLElement>) => void;
}

/**
 * What a modal dialog does with focus and Escape, for a dialog that is a
 * shortcut barrier (`data-shortcut-barrier`): no key aimed inside it reaches
 * the workspace behind, so it owns them.
 *
 * - Its surface takes focus as it opens — and a moment later, if a menu that
 *   opened it took focus back as it closed — and back when a field lets go of
 *   it (NumberField blurs itself on Enter and Escape), so focus is never on
 *   `<body>` — outside the barrier — with the dialog up.
 * - Focus stays inside it: Tab from its last control comes round to its
 *   first and Shift+Tab from its first to its last, and focus that lands
 *   outside anyway (a click on the page behind, a programmatic move) is taken
 *   back — but not from an open layer of its own (a Select's list), nor while
 *   another dialog is on top.
 * - Alt+← and Alt+→, the browser's Back and Forward on Windows and Linux, go
 *   nowhere from it.
 * - Escape is the house pattern (`useCpToolsTrigger`, the View drawer): capture
 *   on `window`, ahead of the workspace's own Escape, standing down while a
 *   control that uses Escape holds it (a number field reverts, an open Select
 *   closes; a checkbox does nothing with it, so it does not count) and while
 *   another dialog is open over this one, whose Escape it is. `onEscape`
 *   decides what it does.
 * - Focus goes back to `returnFocus` when the dialog closes, if it is still in
 *   the document.
 */
export function useModalDialog(onEscape: () => void, returnFocus: HTMLElement | null): ModalDialog {
  const rootRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<HTMLDivElement>(null);
  const escape = useRef(onEscape);
  useEffect(() => {
    escape.current = onEscape;
  });

  useEffect(() => {
    const settle = () => {
      if (!rootRef.current?.contains(document.activeElement)) documentRef.current?.focus({ preventScroll: true });
    };
    settle();
    // A menu row that opened the dialog: the menu's own focus trap still holds
    // focus as the dialog mounts, and drops it on <body> as the menu closes,
    // a moment later. Take it then.
    const timer = window.setTimeout(settle, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        wrapTab(event, rootRef.current, documentRef.current);
        return;
      }
      if (isHistoryChord(event)) {
        // Alt+← / → is the browser's Back / Forward on Windows and Linux: a
        // key pressed in a dialog must not leave the page under it. Not a
        // field's: there it moves by word on a Mac.
        if (isTopmostDialog(rootRef.current) && !isShortcutEditingTarget(event.target)) event.preventDefault();
        return;
      }
      if (event.key !== 'Escape') return;
      if (usesEscape(event.target) || isOpenLayerTarget(event.target)) return;
      if (!isTopmostDialog(rootRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
      escape.current();
    };
    const onFocusIn = (event: Event) => {
      const root = rootRef.current;
      if (!root || !isTopmostDialog(root)) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      if (isOpenLayerTarget(event.target)) return;
      documentRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
    };
  }, []);

  useEffect(
    () => () => {
      if (returnFocus?.isConnected) returnFocus.focus();
    },
    [returnFocus]
  );

  const keepFocus = useCallback((event: FocusEvent<HTMLElement>) => {
    // Focus moving within the dialog, or into a portalled layer of it (an
    // open Select), names where it went; a field blurring itself names
    // nowhere, and the browser parks focus on <body>.
    if (event.relatedTarget !== null) return;
    queueMicrotask(() => {
      const active = document.activeElement;
      if (active === null || active === document.body) {
        documentRef.current?.focus({ preventScroll: true });
      }
    });
  }, []);

  return { rootRef, documentRef, keepFocus };
}

/** Alt+← or Alt+→ and no other modifier: the browser's Back or Forward on Windows and Linux. */
function isHistoryChord(event: KeyboardEvent): boolean {
  return (
    event.altKey && !event.metaKey && !event.ctrlKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
  );
}

/** An input whose kind does nothing with Escape: a checkbox or a radio. */
const ESCAPE_FREE_INPUTS = new Set(['checkbox', 'radio']);

/** Whether a key aimed at `target` is the control's own Escape to use: a field's, not a checkbox's. */
function usesEscape(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement && ESCAPE_FREE_INPUTS.has(target.type)) return false;
  return isShortcutEditingTarget(target);
}

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

/**
 * Tab inside the dialog on top, at either end of its controls: round to the
 * other end, so focus never leaves for the page behind it.
 */
function wrapTab(event: KeyboardEvent, root: HTMLElement | null, surface: HTMLElement | null): void {
  if (!root || !isTopmostDialog(root) || !(event.target instanceof Node) || !root.contains(event.target)) return;
  const tabbable = [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (element) => element.tabIndex >= 0 && !element.closest('[hidden], [inert]')
  );
  const first = tabbable[0];
  const last = tabbable.at(-1);
  if (!first || !last) return;
  const at = event.target;
  const leaving = event.shiftKey ? at === first || at === surface || at === root : at === last;
  if (!leaving) return;
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
}
