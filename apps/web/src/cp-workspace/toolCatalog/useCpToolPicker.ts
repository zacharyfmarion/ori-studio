import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { isShortcutEditingTarget } from '../../keyboard/shortcutDispatcher';
import { useIsCoarsePointerSurface } from '../../platform/pointerSurface';

export interface CpToolPickerState {
  /** False on any fine-pointer session, where the rail's tooltips already name every tool. */
  available: boolean;
  open: boolean;
  /** DOM id the trigger points `aria-controls` at, and the sheet wears. */
  pickerId: string;
  openPicker: () => void;
  /** Close, and hand focus back to the trigger it was opened from. */
  close: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

/**
 * Open state for the touch tool picker, and the pointer gate that decides
 * whether it exists at all.
 *
 * Modelled on `useWorkspaceViewDrawer`, down to the Escape listener: the same
 * problem (a sheet that must close from wherever focus landed inside it) has one
 * answer in this repo, and a second, subtly different one would be worse than
 * either.
 */
export function useCpToolPicker(): CpToolPickerState {
  const coarsePointer = useIsCoarsePointerSurface();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const pickerId = useId();

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // A flip to fine unmounts the trigger, and a sheet outliving it would hold
  // focus with nothing to hand it back to.
  useEffect(() => {
    if (coarsePointer) return;
    setOpen(false);
  }, [coarsePointer]);

  // Capture-phase on `window`, like `HelpModal`, `SettingsModal` and the View
  // drawer — so it fires wherever focus is inside the sheet rather than only on
  // whatever happens to be focused. `isShortcutEditingTarget` is the repo's one
  // answer to "does this target own its keystrokes"; there is no copy of it
  // here for the same reason there is no copy of it there.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isShortcutEditingTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, close]);

  return {
    available: coarsePointer,
    open,
    pickerId,
    openPicker: useCallback(() => setOpen(true), []),
    close,
    triggerRef,
  };
}
