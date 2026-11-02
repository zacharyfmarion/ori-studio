import { useEffect } from 'react';
import { isOpenLayerTarget } from '../keyboard/shortcutDispatcher';
import { cancelCommandDialog } from '../store/commandDialogStore';

/**
 * Cancel command dialog `id` on Escape, from the window in the capture phase so
 * the workspace behind never sees the key — except one aimed at an open Select
 * or menu in the dialog, which closes itself first. Returns the unlisten.
 *
 * It asks nothing about which dialog is on top: a command dialog is the last
 * modal the app root mounts (`App.tsx`), so it always is — but for the Export
 * crease pattern dialog while the Layer order dialog it opened is up, when it
 * steps aside and stops listening ({@link useCommandDialogEscape}).
 */
export function listenForCommandDialogEscape(id: number): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    // An open Select or menu in the dialog closes itself first.
    if (isOpenLayerTarget(event.target)) return;
    event.preventDefault();
    cancelCommandDialog(id);
  };
  window.addEventListener('keydown', onKeyDown, true);
  return () => window.removeEventListener('keydown', onKeyDown, true);
}

/**
 * A command dialog's Escape, standing down while it is `aside`: while the Layer
 * order dialog it opened is up, whose Escape it is to close.
 */
export function useCommandDialogEscape(id: number, aside: boolean): void {
  useEffect(() => (aside ? undefined : listenForCommandDialogEscape(id)), [id, aside]);
}
