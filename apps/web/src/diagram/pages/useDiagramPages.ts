import { useEffect, useState } from 'react';
import { reportError } from '../../monitoring';
import type { DiagramDocument } from '../document/diagramDocument';
import { browserFontSource } from '../fonts/browserFontSource';
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

const EMPTY: DiagramPagesState = { pages: null, of: null, failed: false };

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
 */
export function useDiagramPages(document: DiagramDocument | null): DiagramPagesState {
  const [state, setState] = useState<DiagramPagesState>(EMPTY);
  useEffect(() => {
    if (!document) return;
    let current = true;
    const start = setTimeout(() => {
      prepareDiagramPages(document, { fontSource: browserFontSource, subsetter: browserFontSubsetter })
        .then((pages) => {
          if (current) setState({ pages, of: document, failed: false });
        })
        .catch((error: unknown) => {
          reportError(error, { surface: 'diagram:pages' });
          if (current) setState((previous) => ({ ...previous, failed: true }));
        });
    });
    return () => {
      current = false;
      clearTimeout(start);
    };
  }, [document]);
  return document ? state : EMPTY;
}

const composed = new WeakMap<PreparedDiagramPages, Map<string, string>>();

/**
 * Page `index` as a `data:` URL, composed once per layout. `band: false`
 * leaves the flow band out, for the Pages view, which draws it under the
 * image itself (`DiagramPageBand`): the band's colour is then not in the
 * image, and a new one leaves the image as it was.
 */
export function composedPageUrl(pages: PreparedDiagramPages, index: number, options: PageComposeOptions = {}): string {
  let byPage = composed.get(pages);
  if (!byPage) {
    byPage = new Map();
    composed.set(pages, byPage);
  }
  const key = `${index} ${JSON.stringify(options)}`;
  let url = byPage.get(key);
  if (url === undefined) {
    url = svgDataUrl(pages.compose(index, options).svg);
    byPage.set(key, url);
  }
  return url;
}
