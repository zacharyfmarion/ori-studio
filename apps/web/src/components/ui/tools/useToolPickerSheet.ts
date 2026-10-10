import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { useSheetEscape } from '../useSheetEscape';

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
 * Modelled on `useWorkspaceViewDrawer`, and closing on Escape through the one
 * listener every touch sheet shares (`useSheetEscape`): the same problem (a
 * sheet that must close from wherever focus landed inside it, unless the key is
 * another's) has one answer in this repo, and a second, subtly different one
 * would be worse than either.
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

  useSheetEscape(open, pickerId, close);

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
