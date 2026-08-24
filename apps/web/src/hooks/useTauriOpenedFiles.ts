import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { surfaceSupports } from '../platform/capabilities';

type OpenPathHandler = (path: string) => Promise<void>;

/**
 * One document the shell has asked the app to open. Mirrors `OpenedFile` in
 * `apps/tauri/src-tauri/src/lib.rs`, including the reason both fields are
 * nullable: Windows and Linux deliver a path with no URL, and a URL need not
 * resolve to a path.
 *
 * `path` is the only half this hook can act on. `url` is carried because on iOS
 * it is the half that matters — the security scope lives on the URL, not on the
 * path inside it — and the iOS file layer that will read through it does not
 * exist yet.
 */
type OpenedFile = { url: string | null; path: string | null };

export function useTauriOpenedFiles(enabled: boolean, openPath: OpenPathHandler): void {
  useEffect(() => {
    if (!enabled || !surfaceSupports('nativeFileIo')) return;

    let disposed = false;
    let unlisten: (() => void) | null = null;

    const openFirstPath = (files: OpenedFile[]) => {
      const path = files
        .map((file) => file.path)
        .find((candidate) => candidate !== null && /\.osf$/i.test(candidate));
      if (!path || disposed) return;
      void openPath(path);
    };

    Promise.resolve()
      .then(async () => {
        const dispose = await listen<OpenedFile[]>('opened-files', (event) => {
          openFirstPath(event.payload);
          void invoke<OpenedFile[]>('take_opened_files').catch(() => undefined);
        });
        const initial = await invoke<OpenedFile[]>('take_opened_files');
        openFirstPath(initial);
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
