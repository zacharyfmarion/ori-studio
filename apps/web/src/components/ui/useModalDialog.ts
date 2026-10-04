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
 * - Escape is the house pattern (`useCpToolsTrigger`, the View drawer): capture
 *   on `window`, ahead of the workspace's own Escape, standing down while a
 *   field or an open layer holds the key (Escape in a number field reverts it,
 *   in an open Select closes the Select) and while another dialog is open over
 *   this one, whose Escape it is. `onEscape` decides what it does.
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
      if (event.key !== 'Escape') return;
      if (isShortcutEditingTarget(event.target) || isOpenLayerTarget(event.target)) return;
      if (!isTopmostDialog(rootRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
      escape.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
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
