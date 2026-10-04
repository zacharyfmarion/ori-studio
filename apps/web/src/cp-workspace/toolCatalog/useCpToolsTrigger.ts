import { ANALYTICS_EVENTS, track } from '../../analytics';
import { useToolPickerSheet, type ToolPickerSheetState } from '../../components/ui/tools/useToolPickerSheet';
import { useIsPhoneLayout } from '../../platform/phoneLayout';
import { useLayoutStore } from '../../store/layoutStore';
import { useCpToolSurface, type CpToolSurface } from './cpToolSurface';

export interface CpToolsTriggerState extends ToolPickerSheetState {
  /**
   * The panel's tool state, or `null` where the phone tool button should not
   * exist at all — every workspace but Edit, every layout but the phone one, and
   * any moment with no editable crease pattern mounted.
   */
  surface: CpToolSurface | null;
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
 * Opening, closing, focus and Escape are the shared sheet's
 * (`useToolPickerSheet`); what is Edit's is the gate above and the event.
 */
export function useCpToolsTrigger(): CpToolsTriggerState {
  const phoneLayout = useIsPhoneLayout();
  const activeWorkspace = useLayoutStore((state) => state.activeWorkspace);
  const published = useCpToolSurface();

  const surface = phoneLayout && activeWorkspace === 'edit' ? published : null;
  const sheet = useToolPickerSheet({ available: surface !== null, onOpened: trackPickerOpened });
  return { surface, ...sheet };
}

/** Whether people find the Tools pill that replaced the rail at all. */
function trackPickerOpened(): void {
  track(ANALYTICS_EVENTS.cpToolPickerOpened);
}
