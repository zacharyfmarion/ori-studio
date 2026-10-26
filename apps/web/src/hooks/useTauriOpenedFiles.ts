import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import i18n from '../i18n';
import { isShortcutBarrierOpen } from '../keyboard/shortcutDispatcher';
import { isDesktopRuntime } from '../platform/runtime';

type OpenPathHandler = (path: string) => Promise<void>;

/**
 * Open the `.osf` files the OS hands the app: a double-click in the Finder, or
 * the file the app was launched on.
 *
 * Not while a modal dialog is open: the file would replace the document the
 * dialog was opened on, as the File menu's Open would (which the menus hold
 * back, `HELD_BEHIND_MODAL_ACTIONS`). Refused with a toast, not queued for when
 * the dialog closes: closing is not when a dialog's work is done — Layer
 * order's Apply commits after the dialog has gone — so an open run then would
 * race that commit, and could pass the unsaved-changes check before the commit
 * marks the document changed.
 */
export function useTauriOpenedFiles(enabled: boolean, openPath: OpenPathHandler): void {
  useEffect(() => {
    if (!enabled || !isDesktopRuntime()) return;

    let disposed = false;
    let unlisten: (() => void) | null = null;

    const openFirstPath = (paths: string[]) => {
      const path = paths.find((candidate) => /\.osf$/i.test(candidate));
      if (!path || disposed) return;
      if (isShortcutBarrierOpen()) {
        toast.message(i18n.t('toasts:fileOpen.closeDialog', 'Close the dialog to open another file'));
        return;
      }
      void openPath(path);
    };

    Promise.resolve()
      .then(async () => {
        const dispose = await listen<string[]>('opened-files', (event) => {
          openFirstPath(event.payload);
          void invoke<string[]>('take_opened_files').catch(() => undefined);
        });
        const initialPaths = await invoke<string[]>('take_opened_files');
        openFirstPath(initialPaths);
        return dispose;
      })
      .then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }
        unlisten = dispose;
      })
      .catch((error) => {
        console.warn('Failed to register Tauri opened-file listener', error);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [enabled, openPath]);
}
