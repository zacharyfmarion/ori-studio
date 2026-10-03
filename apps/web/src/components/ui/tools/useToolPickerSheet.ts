import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { isOpenLayerTarget, isShortcutEditingTarget } from '../../../keyboard/shortcutDispatcher';

export interface ToolPickerSheetState {
  open: boolean;
  /** DOM id the trigger points `aria-controls` at, and the sheet wears. */
  pickerId: string;
  openPicker: () => void;
  /** Close, and hand focus back to the trigger it was opened from. */
  close: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

/**
 * Whether a workspace's phone tool sheet is open, and the ways it closes.
 *
 * `available` is whether the Tools pill exists at all — each workspace has its
 * own rule (the phone layout, its own workspace, something to pick from) — and
 * the sheet closes when it stops being: a rotation into the tablet layout, a
 * workspace switch, a document closing. A sheet outliving its trigger would be
 * holding focus with nothing to hand it back to.
 *
 * Modelled on `useWorkspaceViewDrawer`, including the Escape listener and both
 * of its guards: the same problem (a sheet that must close from wherever focus
 * landed inside it) has one answer in this repo, and a second, subtly different
 * one would be worse than either. The layer guard asks about the key's *target*,
 * so a `useTouchLabel` tooltip, which holds no focus, cannot trip it and leave
 * the sheet's one keyboard exit dead.
 *
 * `onOpened` runs once per visit, for the workspace's own analytics event: the
 * backdrop stops a *tap* on the trigger behind it but not a keyboard
 * activation, so an unguarded counter would double-count one visit.
 */
export function useToolPickerSheet({
  available,
  onOpened,
}: {
  available: boolean;
  onOpened?: () => void;
}): ToolPickerSheetState {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const pickerId = useId();

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (available) return;
    setOpen(false);
  }, [available]);

  // Capture-phase on `window`, like `HelpModal`, `SettingsModal` and the View
  // drawer — so it fires wherever focus is inside the sheet rather than only on
  // whatever happens to be focused. `isShortcutEditingTarget` and
  // `isOpenLayerTarget` are the repo's one answer each to "does this target own
  // its keystrokes"; there is no copy of them here for the same reason there is
  // no copy of them there.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isShortcutEditingTarget(event.target) || isOpenLayerTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, close]);

  const onOpenedRef = useRef(onOpened);
  useEffect(() => {
    onOpenedRef.current = onOpened;
  }, [onOpened]);

  const openPicker = useCallback(() => {
    if (open) return;
    setOpen(true);
    onOpenedRef.current?.();
  }, [open]);

  return { open, pickerId, openPicker, close, triggerRef };
}
