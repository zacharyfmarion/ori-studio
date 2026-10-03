/**
 * A diagram as one PDF (D11, route C): every page composed as the Pages view
 * shows it, set in fonts cut once for the whole document, written by
 * `crates/oristudio-pdf` through its wasm bridge.
 *
 * - **At home:** each page is its trim.
 * - **Print shop:** each page is drawn 3 mm past its trim (the flow band runs
 *   on into the bleed), and the PDF carries the bleed and trim boxes and crop
 *   marks in a 5 mm slug.
 *
 * The pages name their fonts by family and embed none: the writer is handed
 * one subset per face, cut to every character the document sets in it, so a
 * font is embedded once, not once a page. The writer refuses text it would set
 * in any other font than the page names, so what prints is what was measured.
 *
 * The writer is handed in: the browser's runs in a worker, a test's in node.
 */
import type { DiagramDocument } from '../document/diagramDocument';
import { parseFontFaceId } from '../fonts/diagramFontFaces';
import type { DiagramFonts } from '../fonts/diagramFonts';
import type { FontSubsetter } from '../fonts/fontSubset';
import { composeDiagramPage } from '../pages/composeDiagramPage';
import { preparedPages } from '../pages/diagramPages';

/** The print shop's margins: the art past the trim, and the slug the crop marks stand in. */
export const PRINT_SHOP_BLEED_MM = 3;
export const PRINT_SHOP_SLUG_MM = 5;

export type DiagramPdfMode = 'home' | 'print-shop';

export interface PdfWriterOptions {
  trimWidthMm: number;
  trimHeightMm: number;
  artBleedMm: number;
  printShop?: { bleedMm: number; slugMm: number };
  title?: string;
}

/**
 * The PDF writer: the wasm bridge's `pages_to_pdf`, however it is reached.
 * Aborting `signal` stops it, and its promise rejects with an `AbortError`.
 */
export type PdfWriter = (
  pages: string[],
  fonts: Uint8Array[],
  options: PdfWriterOptions,
  signal?: AbortSignal
) => Promise<Uint8Array>;

export interface DiagramPdfInput {
  pages: string[];
  fonts: Uint8Array[];
  options: PdfWriterOptions;
  /** Characters no font has: the writer would refuse them. */
  missing: string[];
}

/** What the writer is handed: the composed pages, and one subset per face they set. */
export function diagramPdfInput(
  document: DiagramDocument,
  fonts: DiagramFonts,
  subsetter: FontSubsetter,
  mode: DiagramPdfMode
): DiagramPdfInput {
  const prepared = preparedPages(document, fonts, subsetter);
  const { layout } = prepared;
  const steps = new Map(document.steps.map((step) => [step.id, step]));
  const bleedMm = mode === 'print-shop' ? PRINT_SHOP_BLEED_MM : 0;
  const usage = new Map<string, Set<string>>();
  const pages = layout.pages.map(
    (page) =>
      composeDiagramPage({
        layout,
        page,
        steps,
        assets: document.assets,
        style: document.style,
        hanStyle: document.hanStyle,
        setter: prepared.setter,
        bleedMm,
        embedFonts: (used) => {
          for (const [face, characters] of used) {
            const all = usage.get(face) ?? new Set<string>();
            for (const character of characters) all.add(character);
            usage.set(face, all);
          }
          return '';
        },
      }).svg
  );
  const subsets: Uint8Array[] = [];
  for (const id of [...usage.keys()].sort()) {
    const face = parseFontFaceId(id);
    const font = face ? fonts.font(face.key, face.weight) : null;
    const characters = [...(usage.get(id) ?? [])].join('');
    if (font && characters !== '') subsets.push(subsetter.subset(`${id}-${font.tier}`, font.bytes, characters));
  }
  return {
    pages,
    fonts: subsets,
    missing: prepared.missing,
    options: {
      trimWidthMm: layout.paper.widthMm,
      trimHeightMm: layout.paper.heightMm,
      artBleedMm: bleedMm,
      ...(mode === 'print-shop' ? { printShop: { bleedMm: PRINT_SHOP_BLEED_MM, slugMm: PRINT_SHOP_SLUG_MM } } : {}),
      ...(document.title.trim() === '' ? {} : { title: document.title.trim() }),
    },
  };
}
