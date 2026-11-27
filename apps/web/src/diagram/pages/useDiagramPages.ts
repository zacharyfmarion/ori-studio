import { useCallback, useEffect, useState } from 'react';
import { reportError } from '../../monitoring';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramDocument } from '../document/diagramDocument';
import { browserFontSource } from '../fonts/browserFontSource';
import { DiagramFontDownloadError } from '../fonts/diagramFonts';
import { browserFontSubsetter } from '../fonts/browserFontSubsetter';
import { svgDataUrl } from '../pictures/stepPictureCache';
import type { PageComposeOptions } from './composeDiagramPage';
import { prepareDiagramPages, type PreparedDiagramPages } from './diagramPages';

export interface DiagramPagesState {
  /** The pages of the diagram, or of the last one that laid out while the next does. */
  pages: PreparedDiagramPages | null;
  /** The diagram the pages are of: behind the current one while it lays out. */
  of: DiagramDocument | null;
  /** The last layout failed: the fonts or the subsetter could not be had. */
  failed: boolean;
}

/** The pages, and a way to lay them out again after a layout failed. */
export interface DiagramPagesBinding extends DiagramPagesState {
  /** Lay the diagram out again: what the Pages view's Try again does, and coming back online. */
  retry: () => void;
}

const EMPTY: DiagramPagesState = { pages: null, of: null, failed: false };

/** The pages each diagram the store adopted a layout's packing into already has: that layout's. */
const adoptedPages = new WeakMap<DiagramDocument, PreparedDiagramPages>();

/**
 * A diagram's pages, laid out with the fonts its text needs (`diagramPages.ts`),
 * for the Pages view and for the cards' "Text doesn't fit".
 *
 * The fonts load once a session, so after the first a new layout costs the
 * layout alone; the last pages stay on screen until the next are ready, so an
 * edit never blanks the view. A layout that outlives its diagram is dropped,
 * and one whose diagram is outlived before it starts is never begun: it
 * starts a task later, behind the input already waiting, so a burst of edits
 * — Arrow Up held in the path's width — lays out its last diagram, not each.
 *
 * The flow pages a layout packed are adopted into the store's diagram while
 * it is still the one laid out ({@link adoptPacked}), so the next layout
 * holds them; the adopted diagram takes these same pages, not a layout of its
 * own. Not a layout that went without a CJK face its text needs
 * (`PreparedDiagramPages.unavailableFonts`, offline on the desktop): its
 * captions were measured with another face's advances, and boxes cut for
 * those would be held, and saved, once the face is had.
 *
 * A layout that failed is laid out again by `retry` (the view's Try again),
 * and when the browser comes back online, as one that went without a CJK
 * face is. One that failed for a font the network would not give
 * (`DiagramFontDownloadError`) is not reported: being offline is not a
 * defect.
 */
export function useDiagramPages(document: DiagramDocument | null): DiagramPagesBinding {
  const [state, setState] = useState<DiagramPagesState>(EMPTY);
  // Bumped to lay the same diagram out again.
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  useEffect(() => {
    if (!document) return;
    const ready = adoptedPages.get(document);
    if (ready) {
      setState({ pages: ready, of: document, failed: false });
      return;
    }
    let current = true;
    const start = setTimeout(() => {
      prepareDiagramPages(document, { fontSource: browserFontSource, subsetter: browserFontSubsetter })
        .then((pages) => {
          if (!current) return;
          setState({ pages, of: document, failed: false });
          // Captions measured without a face they need would be held in boxes cut for the wrong metrics:
          // the pages are drawn as packed, and packed again, and adopted, once the face is had.
          if (pages.unavailableFonts.length === 0) adoptPacked(pages, document);
        })
        .catch((error: unknown) => {
          // Offline, or a connection that dropped (ORI-STUDIO-16): the view says so and offers to try again.
          if (!(error instanceof DiagramFontDownloadError)) reportError(error, { surface: 'diagram:pages' });
          if (current) setState((previous) => ({ ...previous, failed: true }));
        });
    });
    return () => {
      current = false;
      clearTimeout(start);
    };
  }, [document, attempt]);
  // A layout that failed, or went without a CJK face, is tried again once the browser is back online.
  const wanting = document !== null && (state.failed || (state.pages?.unavailableFonts.length ?? 0) > 0);
  useEffect(() => {
    if (!wanting) return;
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [wanting, retry]);
  return { ...(document ? state : EMPTY), retry };
}

/**
 * The arrangements `pages` packed (`DiagramPagesLayout.packed`), and the room
 * they measured the title block's words to after an edit of them, taken into
 * the store's diagram while it is still `document`, the one laid out — no
 * edit, no undo entry (`adoptDiagramPageArrangements`). The adopted diagram
 * lays out as `pages` do, so it takes them as its own, the pages they have
 * composed with them.
 */
function adoptPacked(pages: PreparedDiagramPages, document: DiagramDocument): void {
  const { packed, titleBlockRoom } = pages.layout;
  if (!packed && titleBlockRoom === undefined) return;
  if (!useWorkspaceStore.getState().adoptDiagramPageArrangements(packed ?? {}, document, titleBlockRoom)) return;
  const adopted = useWorkspaceStore.getState().diagram;
  if (!adopted || !pages.adoptedAs) return;
  const same = pages.adoptedAs(adopted);
  composed.set(same, composedOf(pages));
  adoptedPages.set(adopted, same);
}

const composed = new WeakMap<PreparedDiagramPages, Map<string, string>>();

/** The pages composed of `pages` so far, by page and options. */
function composedOf(pages: PreparedDiagramPages): Map<string, string> {
  let byPage = composed.get(pages);
  if (!byPage) {
    byPage = new Map();
    composed.set(pages, byPage);
  }
  return byPage;
}

/**
 * Page `index` as a `data:` URL, composed once per layout. `band: false`
 * leaves the flow band out, for the Pages view, which draws it under the
 * image itself (`DiagramPageBand`): the band's colour is then not in the
 * image, and a new one leaves the image as it was.
 */
export function composedPageUrl(pages: PreparedDiagramPages, index: number, options: PageComposeOptions = {}): string {
  const byPage = composedOf(pages);
  const key = `${index} ${JSON.stringify(options)}`;
  let url = byPage.get(key);
  if (url === undefined) {
    url = svgDataUrl(pages.compose(index, options).svg);
    byPage.set(key, url);
  }
  return url;
}
