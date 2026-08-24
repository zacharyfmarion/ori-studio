import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { ANALYTICS_EVENTS, track } from '../../analytics';
import { isShortcutEditingTarget } from '../../keyboard/shortcutDispatcher';
import { useIsPhoneLayout } from '../../platform/phoneLayout';
import { useLayoutStore } from '../../store/layoutStore';
import { useCpToolSurface, type CpToolSurface } from './cpToolSurface';

export interface CpToolsTriggerState {
  /**
   * The panel's tool state, or `null` where the phone tool button should not
   * exist at all — every workspace but Edit, every layout but the phone one, and
   * any moment with no editable crease pattern mounted.
   */
  surface: CpToolSurface | null;
  open: boolean;
  /** DOM id the trigger points `aria-controls` at, and the sheet wears. */
  pickerId: string;
  openPicker: () => void;
  /** Close, and hand focus back to the trigger it was opened from. */
  close: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

/**
 * The phone tool button: whether it exists, and whether its sheet is open.
 *
 * Three conditions, all of which must hold, and each for its own reason:
 *
 * - **Phone layout**, not coarse pointer. A tablet keeps its rail, and a Tools
 *   button beside the View pill there would be a second way to do what the rail
 *   already does in place. `useIsPhoneLayout` and not `useIsPhoneSurface`: the
 *   latter is the *gate*, off on both Tauri shells, so a native iPhone build
 *   would take the desktop layout through it.
 * - **The Edit workspace.** The rail this replaces is CP-only; Design and
 *   Simulate have their own panels and must not grow a button that leads
 *   nowhere.
 * - **A published tool surface.** No editable crease pattern means no tools, and
 *   it is the same condition the rail itself renders under.
 *
 * Modelled on `useWorkspaceViewDrawer`, including the Escape listener: the same
 * problem (a sheet that must close from wherever focus landed inside it) has one
 * answer in this repo, and a second, subtly different one would be worse than
 * either.
 *
 * With one of its guards deliberately absent. The drawer also bails while a
 * `[data-radix-popper-content-wrapper]` is mounted, because its body is full of
 * `Select`s whose open dropdown owns Escape from outside the sheet. This sheet
 * holds buttons and the Shift latch and nothing that portals a layer, so the
 * only popper that can be up is a `useTouchLabel` tooltip — which owns nothing,
 * and bailing for it would leave the sheet's one keyboard exit dead.
 */
export function useCpToolsTrigger(): CpToolsTriggerState {
  const phoneLayout = useIsPhoneLayout();
  const activeWorkspace = useLayoutStore((state) => state.activeWorkspace);
  const published = useCpToolSurface();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const pickerId = useId();

  const surface = phoneLayout && activeWorkspace === 'edit' ? published : null;
  const available = surface !== null;

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Anything that removes the trigger closes the sheet with it: a rotation into
  // the tablet layout, a workspace switch, a document closing. A sheet outliving
  // its trigger would be holding focus with nothing to hand it back to, and
  // `close`'s optional call correctly does nothing once the ref is null.
  useEffect(() => {
    if (available) return;
    setOpen(false);
  }, [available]);

  // Capture-phase on `window`, like `HelpModal`, `SettingsModal` and the View
  // drawer — so it fires wherever focus is inside the sheet rather than only on
  // whatever happens to be focused. `isShortcutEditingTarget` is the repo's one
  // answer to "does this target own its keystrokes"; there is no copy of it here
  // for the same reason there is no copy of it there.
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
    surface,
    open,
    pickerId,
    // Guarded, for the reason the View drawer's is: the backdrop stops a *tap* on
    // the trigger behind it but not a keyboard activation, so an unguarded
    // counter would double-count one visit — and this event exists to count the
    // sessions that went looking for the tools, which is the one thing an
    // inflated count would stop it answering.
    openPicker: useCallback(() => {
      if (open) return;
      setOpen(true);
      track(ANALYTICS_EVENTS.cpToolPickerOpened);
    }, [open]),
    close,
    triggerRef,
  };
}
