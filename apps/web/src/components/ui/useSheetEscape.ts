import { useEffect } from 'react';
import { isOpenLayerTarget, isShortcutEditingTarget } from '../../keyboard/shortcutDispatcher';
import { escapeEndsArmedMode } from '../../keyboard/shortcutRuntime';
import { isTopmostDialog } from './useModalDialog';

/**
 * Is this Escape the sheet's to close on? `sheet` is a touch sheet — the View
 * or Settings sheet (`WorkspaceViewDrawer`), a workspace's tool sheet
 * (`useToolPickerSheet`), Design's pane list (`DesignPaneSwitcher`) — and the
 * answer is yes unless something else owns the key. Each case below is one a
 * capture listener on `window` would otherwise beat to it.
 *
 * - A control holds it. A `NumberField`'s own Escape reverts the half-typed
 *   draft before blurring — a React bubble handler — and without the bail
 *   Escape in a mid-edit grid size committed the number and closed the
 *   sheet. `isShortcutEditingTarget` is the repo's one answer to "does this
 *   target own its keystrokes".
 * - A layer holds it. Radix portals an open `Select`'s list *outside* the
 *   sheet, so a listener scoped to the sheet would never see it, but the list
 *   holds focus while it is open, so the key's target is inside it, and
 *   `isOpenLayerTarget` is the repo's one answer to "is a layer holding this
 *   key". It asks about the target, so a `useTouchLabel` tooltip, which holds
 *   no focus, cannot trip it and leave the sheet's one keyboard exit dead.
 * - A mode armed in the workspace that Escape puts down first — the
 *   Diagram's anchor pick, armed from the Layers pane inside the Settings
 *   sheet (Revision 2) — is the runtime's to end (`escapeEndsArmedMode`).
 *   Without the bail, the first Escape on an iPad closed the sheet and only a
 *   second put the pick down.
 * - A dialog is over the sheet (rf6): one the sheet opened — Replace from
 *   References…, Delete Step's question — or one a shortcut opened while it
 *   was up. Dialogs come after the sheets in the document (`SheetLayer`), so
 *   the sheet is no longer the dialog on top, and Escape is that dialog's, as
 *   a modal stands down for the one over it (`useModalDialog`). Without the
 *   bail, one Escape closed the dialog and the sheet under it.
 */
export function sheetOwnsEscape(event: KeyboardEvent, sheet: Element | null): boolean {
  if (event.key !== 'Escape') return false;
  if (isShortcutEditingTarget(event.target) || isOpenLayerTarget(event.target)) return false;
  if (escapeEndsArmedMode()) return false;
  return isTopmostDialog(sheet);
}

/**
 * Close the open sheet whose dialog `sheetId` names on Escape, the way the
 * modals do it (`useModalDialog`): a capture-phase listener on `window`, so it
 * works wherever focus happens to be inside the sheet, standing down whenever
 * {@link sheetOwnsEscape} says the key is another's.
 *
 * Every touch sheet uses this one listener. The same problem has one answer
 * here, and a second, subtly different one is how the sheets drifted apart
 * before (rf6).
 */
export function useSheetEscape(open: boolean, sheetId: string, close: () => void): void {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!sheetOwnsEscape(event, document.getElementById(sheetId))) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, sheetId, close]);
}
