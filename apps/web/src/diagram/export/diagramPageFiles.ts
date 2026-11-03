/**
 * The diagram's pages as SVG files, one a page: the SVG export's default
 * (Zach, 2026-11-02: "export each page kind of like the PDF version, because
 * people want to edit each page individually in Affinity and then export it
 * as a PDF"). The sheet of spreads (`diagramSheet.ts`) is the other choice.
 *
 * Each file is a page as the Pages view composes it and the PDF prints it, a
 * document of its own: in pt, its text live and set in the diagram's fonts,
 * each face it sets embedded and cut to that page's characters. It has no
 * white ground, as the page the PDF writer is handed has none, so a drawing
 * app's own page shows through and nothing under the drawing is picked up by
 * a drag on the paper. (The sheet draws one under each page to mark it out on
 * the sheet.)
 *
 * Pure but for the subsetter, which the prepared pages hold.
 */
import type { PaperSvgResult } from '../../lib/paper/paperSvg';
import type { PreparedDiagramPages } from '../pages/diagramPages';

export interface DiagramPageFile {
  /** The file's name in the archive, before its extension: `<title>-page-07`. */
  fileStem: string;
  page: PaperSvgResult;
}

/** Every page as its file, named from `title` and numbered from 1, zero-padded to the width of the page count. */
export function diagramPageFiles(prepared: PreparedDiagramPages, title: string): DiagramPageFile[] {
  const { pages } = prepared.layout;
  const digits = String(pages.length).length;
  return pages.map((_, index) => ({
    fileStem: `${title}-page-${String(index + 1).padStart(digits, '0')}`,
    page: prepared.compose(index),
  }));
}
