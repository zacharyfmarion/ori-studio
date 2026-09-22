import type { TFunction } from 'i18next';
import { untitledTitle } from '../i18n/documentNames';
import { identityTranslate } from '../i18n/identityTranslate';
import { SITE_NAME } from '../seo/siteMeta';
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
  /**
   * The title of the site page being shown, when the app is showing one rather
   * than a document — the landing, or `/download/` and its siblings.
   *
   * There is no document to name on those pages, and the store still holds one —
   * a blank project called `Untitled`. Titling the landing after it is what put
   * "Ori Studio: Untitled" in Google's result for the site: the prerendered HTML
   * carried {@link SITE_TITLE}, Googlebot's render pass then ran this and
   * replaced it, and the rendered title is the one that gets indexed. So the
   * page's own title wins here, and it has to be the exact string the prerender
   * wrote, or a crawler is back to watching the title change under it.
   */
  pageTitle?: string;
  surface?: RuntimeSurface;
  /**
   * Names a project whose title is blank. The hook threads its live `t` so the
   * fallback reads "Untitled" in the app's language; a pure caller may omit it.
   */
  t?: TFunction;
}

export function formatWindowTitle({
  projectTitle,
  dirty,
  fileName,
  filePath = null,
  pageTitle,
  surface = getRuntimeSurface(),
  t = identityTranslate,
}: WindowTitleInput): string {
  // Two different answers on purpose, because the string lands in two different
  // places. In a browser it is the tab *and* the search result, so it is the
  // page's title verbatim. Desktop has neither a tab nor a crawler, just a title
  // bar that a page title written for a result would be absurd in.
  if (pageTitle) return surface === 'desktop' ? SITE_NAME : pageTitle;

  const fromFile = filePath ? (fileName?.trim() ?? '') : '';
  const title = fromFile || projectTitle.trim() || untitledTitle(t);
  const dirtyMark = dirty ? '*' : '';
  return `${dirtyMark}${title} - ${SITE_NAME}`;
}

export async function applyWindowTitle(title: string, surface: RuntimeSurface = getRuntimeSurface()) {
  if (typeof document !== 'undefined') {
    document.title = title;
  }

  if (surface !== 'desktop') return;

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setTitle(title);
  } catch (error) {
    console.warn('Failed to update Tauri window title', error);
  }
}
