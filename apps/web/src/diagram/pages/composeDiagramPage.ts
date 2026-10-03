/**
 * One diagram page as an SVG document, in pt (D10): what the Pages view shows
 * as an `<img>`, what a page file is, and what the PDF prints — the screen is
 * the file.
 *
 * From back to front: the flow band, the title tab and its rule, each cell's
 * picture, number and instruction, and the page number. An empty step keeps
 * its number and its text and leaves its picture box blank; the placeholder,
 * the margin guide and the selection ring are the Pages view's overlay, never
 * in the file.
 *
 * Text is set by the layout's setter and written run by run: one `<tspan>` per
 * font, each placed at its own x, so no renderer re-breaks or re-spaces a line.
 * Every face the page uses is embedded, cut to the characters it sets
 * (`fontEmbedding.ts`), and the page turns off what browsers add on their own
 * — kerning, ligatures, and the spacing CJK text gets beside Latin.
 *
 * Pure: no DOM, no store.
 */
import { PT_PER_MM } from '../../lib/paper/paperSvg';
import { escapeXml, xmlText } from '../../lib/xmlEscape';
import type { DiagramAsset, DiagramStep, DiagramStyle } from '../document/diagramDocument';
import { DIAGRAM_FONT_FAMILY, fontFaceId, parseFontFaceId } from '../fonts/diagramFontFaces';
import type { FontUsage } from '../fonts/fontEmbedding';
import {
  PAGE_NUMBER_SIZE_MM,
  STEP_NUMBER_SIZE_MM,
  STEP_TEXT_LEADING_MM,
  STEP_TEXT_SIZE_MM,
  TITLE_SIZE_MM,
  type DiagramPagesLayout,
  type LayoutPage,
  type SetLine,
  type TextSetter,
} from './diagramPageLayout';
import { cellPicture } from './pagePictures';

/** The page's own inks: the mockup's, whatever the paper style. */
const INK = '#16191c';
const TEXT_INK = '#26292c';
const BAND_INK = '#ecece8';
const TAB_RADIUS_MM = 1.4;
const RULE_WIDTH_MM = 0.35;

/** What browsers would otherwise add to text the composer has already set. */
const SET_TEXT_CSS =
  '.dt{font-kerning:none;font-variant-ligatures:none;' +
  'font-feature-settings:"kern" 0,"liga" 0,"clig" 0,"calt" 0;' +
  'text-spacing-trim:space-all;text-autospace:no-autospace}';

export interface ComposeDiagramPageInput {
  layout: DiagramPagesLayout;
  page: LayoutPage;
  steps: ReadonlyMap<string, DiagramStep>;
  assets: Readonly<Record<string, DiagramAsset>>;
  style: DiagramStyle;
  /** The layout's own setter: numbers are set as the instructions were. */
  setter: TextSetter;
  /** The page's `@font-face` rules for what it sets; `''` writes none. */
  embedFonts: (usage: FontUsage) => string;
}

export interface ComposedPage {
  svg: string;
  widthPt: number;
  heightPt: number;
}

export function composeDiagramPage(input: ComposeDiagramPageInput): ComposedPage {
  const { layout, page, setter } = input;
  const widthPt = layout.paper.widthMm * PT_PER_MM;
  const heightPt = layout.paper.heightMm * PT_PER_MM;
  const usage = new Map<string, Set<string>>();
  const use = (face: string, text: string) => {
    const characters = usage.get(face) ?? new Set<string>();
    for (const character of text) characters.add(character);
    usage.set(face, characters);
  };
  const body: string[] = [];

  if (page.band && page.band.length > 1) {
    body.push(
      `<path d="${smoothPath(page.band)}" fill="none" stroke="${BAND_INK}" ` +
        `stroke-width="${pt(layout.bandWidthMm)}" stroke-linecap="round" stroke-linejoin="round"/>`
    );
  }

  if (layout.title) {
    const { tab, textAt, line, rule } = layout.title;
    body.push(
      `<rect x="${pt(tab.x)}" y="${pt(tab.y)}" width="${pt(tab.w)}" height="${pt(tab.h)}" ` +
        `rx="${pt(TAB_RADIUS_MM)}" fill="${INK}"/>`,
      textElement([line], textAt.x, textAt.y, TITLE_SIZE_MM, 0, 700, '#ffffff', use),
      `<line x1="${pt(rule.x1)}" y1="${pt(rule.y)}" x2="${pt(rule.x2)}" y2="${pt(rule.y)}" ` +
        `stroke="${INK}" stroke-width="${pt(RULE_WIDTH_MM)}"/>`
    );
  }

  page.cells.forEach((cell, index) => {
    const step = input.steps.get(cell.stepId);
    const parts: string[] = [];
    const picture = step ? cellPicture(step, input.assets, input.style, cell, `c${index}-`) : null;
    if (picture) {
      parts.push(picture.markup);
      if (picture.text) use(fontFaceId({ key: picture.text.family, weight: picture.text.weight }), picture.text.characters);
    }
    const number = setter.line(String(cell.number), STEP_NUMBER_SIZE_MM, 700);
    parts.push(textElement([number], cell.numberAt.x, cell.numberAt.y, STEP_NUMBER_SIZE_MM, 0, 700, INK, use));
    if (cell.text.lines.length > 0) {
      parts.push(
        textElement(
          cell.text.lines,
          cell.text.x,
          cell.text.firstBaseline,
          STEP_TEXT_SIZE_MM,
          STEP_TEXT_LEADING_MM,
          400,
          TEXT_INK,
          use
        )
      );
    }
    body.push(`<g>\n${parts.join('\n')}\n</g>`);
  });

  if (page.pageNumberAt) {
    const line = setter.line(String(page.number), PAGE_NUMBER_SIZE_MM, 700);
    const { x, y, anchor } = page.pageNumberAt;
    // Right-aligned by its measured width, not `text-anchor`: no renderer's
    // idea of the width moves it.
    const left = anchor === 'end' ? x - line.widthMm : x;
    body.push(textElement([line], left, y, PAGE_NUMBER_SIZE_MM, 0, 700, INK, use));
  }

  const fonts = input.embedFonts(
    new Map([...usage].map(([face, characters]) => [face, [...characters].join('')]))
  );
  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(widthPt)}pt" height="${num(heightPt)}pt" ` +
      `viewBox="0 0 ${num(widthPt)} ${num(heightPt)}">`,
    `<defs><style>${fonts === '' ? '' : `\n${fonts}\n`}${SET_TEXT_CSS}</style></defs>`,
    ...body,
    '</svg>',
  ].join('\n');
  return { svg, widthPt, heightPt };
}

/**
 * Set lines as one `<text>`: a `<tspan>` per run, each at its own x, every
 * line `leadingMm` below the last. Runs of the estimate setter, which name no
 * face, fall back to Noto Sans.
 */
function textElement(
  lines: readonly SetLine[],
  xMm: number,
  firstBaselineMm: number,
  sizeMm: number,
  leadingMm: number,
  weight: 400 | 700,
  fill: string,
  use: (face: string, text: string) => void
): string {
  const spans: string[] = [];
  lines.forEach((line, index) => {
    const y = pt(firstBaselineMm + index * leadingMm);
    for (const run of line.runs) {
      const face = parseFontFaceId(run.font);
      const family = DIAGRAM_FONT_FAMILY[face?.key ?? 'latin'];
      if (face) use(run.font, run.text);
      spans.push(
        `<tspan x="${pt(xMm + run.xMm)}" y="${y}" font-family="'${family}', sans-serif">` +
          `${escapeXml(xmlText(run.text))}</tspan>`
      );
    }
  });
  return (
    `<text class="dt" xml:space="preserve" font-size="${pt(sizeMm)}" font-weight="${weight}" fill="${fill}">` +
    `${spans.join('')}</text>`
  );
}

/** The band through its points, smoothed as the mockup draws it (Catmull–Rom as cubic Béziers). */
function smoothPath(points: readonly { x: number; y: number }[]): string {
  const p = points.map(({ x, y }) => ({ x: x * PT_PER_MM, y: y * PT_PER_MM }));
  let d = `M ${num(p[0]!.x)} ${num(p[0]!.y)}`;
  for (let i = 0; i < p.length - 1; i += 1) {
    const a = p[i - 1] ?? p[i]!;
    const b = p[i]!;
    const c = p[i + 1]!;
    const e = p[i + 2] ?? c;
    d +=
      ` C ${num(b.x + (c.x - a.x) / 6)} ${num(b.y + (c.y - a.y) / 6)}` +
      ` ${num(c.x - (e.x - b.x) / 6)} ${num(c.y - (e.y - b.y) / 6)} ${num(c.x)} ${num(c.y)}`;
  }
  return d;
}

const pt = (mm: number) => num(mm * PT_PER_MM);

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}
