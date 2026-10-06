/**
 * The whole diagram as one SVG (D11, amended): every page on one sheet, laid
 * out as it prints, in spreads. Pages pair from the page setup's First page —
 * `left`: 1|2, 3|4, …; `right`: page 1 alone on the right, then 2|3, 4|5, … —
 * meeting at the spine, and the spreads are stacked top to bottom with a gap
 * between them. Zach, 2026-10-06: "export like a single SVG that has all the
 * pages like laid out".
 *
 * Each page is the PDF's: composed as the Pages view shows it, on a white
 * page, in a viewport of its own that clips it at its trim as a PDF page is
 * clipped, its ids renamed under a prefix of its own so no two pages share
 * one. Its text stays text, set in the diagram's fonts, which are embedded once
 * in the sheet's one style, each cut to every character the pages set in it.
 * The sheet is in mm: a user unit is a millimetre of paper.
 *
 * Pure but for the subsetter, which is handed in.
 */
import { escapeXml, xmlText } from '../../lib/xmlEscape';
import type { DiagramDocument, DiagramPageSide } from '../document/diagramDocument';
import { embeddedFontFaces } from '../fonts/fontEmbedding';
import type { DiagramFonts } from '../fonts/diagramFonts';
import type { FontSubsetter } from '../fonts/fontSubset';
import type { PreparedDiagramPages } from '../pages/diagramPages';
import { prefixIds } from '../pictures/prefixIds';
import { composeEveryPage } from './diagramPdf';

/** The space between one spread and the next, mm. */
export const SPREAD_GAP_MM = 10;

/** One printed spread: its left and right page, by index, or null where it has none. */
export type SheetSpread = readonly [left: number | null, right: number | null];

export interface DiagramSheetLayout {
  /** The sheet, mm. */
  widthMm: number;
  heightMm: number;
  /** A page, mm: the page setup's paper. */
  pageMm: { width: number; height: number };
  /** Pages side by side: two, or one for a diagram of a single page. */
  across: 1 | 2;
  /** The spreads, top to bottom. With one across, each is its page alone, on the left. */
  spreads: SheetSpread[];
  /** Each page's top left corner on the sheet, mm, by index. */
  places: { x: number; y: number }[];
}

/**
 * Where each page goes on the sheet: `sides` is each page's side of its spread
 * (`LayoutPage.side`, from the First page setting). A right page faces the left
 * page before it; any other page starts a spread, and keeps its side there.
 */
export function diagramSheetLayout(
  sides: readonly DiagramPageSide[],
  pageMm: { width: number; height: number },
  gapMm = SPREAD_GAP_MM
): DiagramSheetLayout {
  const across = sides.length > 1 ? 2 : 1;
  const spreads: [number | null, number | null][] = [];
  sides.forEach((side, index) => {
    const last = spreads.at(-1);
    if (across === 1) spreads.push([index, null]);
    else if (side === 'right' && last && last[0] === index - 1 && last[1] === null) last[1] = index;
    else spreads.push(side === 'left' ? [index, null] : [null, index]);
  });
  const places: { x: number; y: number }[] = [];
  spreads.forEach(([left, right], row) => {
    const y = row * (pageMm.height + gapMm);
    if (left !== null) places[left] = { x: 0, y };
    if (right !== null) places[right] = { x: pageMm.width, y };
  });
  return {
    widthMm: across * pageMm.width,
    heightMm: spreads.length === 0 ? 0 : spreads.length * pageMm.height + (spreads.length - 1) * gapMm,
    pageMm,
    across,
    spreads,
    places,
  };
}

/** A page document as `svgDocument` writes it: its prolog, its root, its one style, its body. */
const PAGE_DOCUMENT =
  /^\s*(?:<\?xml[^>]*\?>\s*)?<svg\b([^>]*)>\s*(?:<defs><style>([\s\S]*?)<\/style><\/defs>)?([\s\S]*)<\/svg>\s*$/;

/** The page's id prefix: unlike any id a page writes, as every one of those is renamed under it. */
export function sheetPagePrefix(index: number): string {
  return `p${index + 1}-`;
}

/**
 * The sheet as one SVG document: each page of `pages` — page documents as
 * `composeDiagramPage` writes them, composed with no fonts in them — placed by
 * `layout` on a white page, in its own viewport, and `fonts`, the
 * `@font-face` rules for every face the pages set, written once beside the
 * pages' own style (the set-text rules, which each page repeats), once.
 */
export function diagramSheetSvg({
  pages,
  layout,
  fonts,
  title,
}: {
  pages: readonly string[];
  layout: DiagramSheetLayout;
  fonts: string;
  title: string;
}): string {
  const rules = new Set(fonts.split('\n').filter((rule) => rule.trim() !== ''));
  const placed: string[] = [];
  pages.forEach((document, index) => {
    const match = PAGE_DOCUMENT.exec(document);
    const at = layout.places[index];
    if (!match || !at) throw new Error(`Page ${index + 1} is not a composed page.`);
    const [, root = '', style = '', body = ''] = match;
    for (const rule of style.split('\n')) if (rule.trim() !== '') rules.add(rule);
    const viewBox = /\sviewBox="([^"]*)"/.exec(root)?.[1];
    const { width, height } = layout.pageMm;
    const box = `x="${num(at.x)}" y="${num(at.y)}" width="${num(width)}" height="${num(height)}"`;
    placed.push(
      `<g id="page-${index + 1}">\n` +
        `<rect ${box} fill="#ffffff"/>\n` +
        `<svg ${box}${viewBox ? ` viewBox="${viewBox}"` : ''}>\n${prefixIds(body.trim(), sheetPagePrefix(index))}\n</svg>\n` +
        '</g>'
    );
  });
  const named = xmlText(title).trim();
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(layout.widthMm)}mm" height="${num(layout.heightMm)}mm" ` +
      `viewBox="0 0 ${num(layout.widthMm)} ${num(layout.heightMm)}">`,
    ...(named === '' ? [] : [`<title>${escapeXml(named)}</title>`]),
    `<defs><style>\n${[...rules].join('\n')}\n</style></defs>`,
    ...placed,
    '</svg>',
  ].join('\n');
}

/** The diagram's sheet, every page composed, with its fonts cut once for all of them. */
export function diagramSheetFile(
  document: DiagramDocument,
  prepared: PreparedDiagramPages,
  fonts: DiagramFonts,
  subsetter: FontSubsetter
): { svg: string; layout: DiagramSheetLayout } {
  const { pages, usage } = composeEveryPage(document, prepared);
  const layout = sheetLayoutOf(prepared);
  const svg = diagramSheetSvg({
    pages,
    layout,
    fonts: embeddedFontFaces(usage, fonts, subsetter),
    title: document.title,
  });
  return { svg, layout };
}

/** Where the prepared pages go on the sheet. */
export function sheetLayoutOf(prepared: PreparedDiagramPages): DiagramSheetLayout {
  const { paper, pages } = prepared.layout;
  return diagramSheetLayout(
    pages.map((page) => page.side),
    { width: paper.widthMm, height: paper.heightMm }
  );
}

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}
