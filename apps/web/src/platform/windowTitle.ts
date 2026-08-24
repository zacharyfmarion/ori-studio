import { surfaceSupports } from './capabilities';
import { getRuntimeSurface, type RuntimeSurface } from './runtime';

export interface WindowTitleInput {
  projectTitle: string;
  dirty: boolean;
  /** The file the project was opened from or last saved to, e.g. `dragon.osf`. */
  fileName?: string;
  /**
   * Where that file lives, or `null` for a project that has never been written
   * to disk.
   *
   * **This, not `fileName`, is what says a real file exists.** `currentFileName`
   * is always populated — a new project is given the *synthesized* name
   * `Untitled.osf` by `defaultNativeFilename` — so keying the title off it would
   * name a window after a file that was never created. Only the path is null
   * until something is actually saved or opened.
   *
   * It also makes filename-titling desktop-only for free: `fileService` returns
   * `path: null` on every browser path and a real path only from the Tauri
   * dialog, so the browser tab keeps naming the project.
   */
  filePath?: string | null;
  surface?: RuntimeSurface;
}

export function formatWindowTitle({
  projectTitle,
  dirty,
  fileName,
  filePath = null,
  surface: _surface = getRuntimeSurface(),
}: WindowTitleInput): string {
  const fromFile = filePath ? (fileName?.trim() ?? '') : '';
  const title = fromFile || projectTitle.trim() || 'Untitled';
  const dirtyMark = dirty ? '*' : '';
  const suffix = 'Ori Studio';
  return `${dirtyMark}${title} - ${suffix}`;
}

export async function applyWindowTitle(title: string, surface: RuntimeSurface = getRuntimeSurface()) {
  if (typeof document !== 'undefined') {
    document.title = title;
  }

  // `document.title` above is the whole job everywhere else: a browser tab shows
  // it, and an iOS app has no title bar for the second half to write into.
  if (!surfaceSupports('nativeWindowChrome', surface)) return;

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setTitle(title);
  } catch (error) {
    console.warn('Failed to update Tauri window title', error);
  }
}
