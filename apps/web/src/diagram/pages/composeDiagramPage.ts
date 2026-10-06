/**
 * One diagram page as an SVG document, in pt (D10): what the Pages view shows
 * as an `<img>`, what a page file is, and what the PDF prints — the screen is
 * the file. (The view leaves the flow band out and draws it under the image
 * from the same path and pen, so a colour pick repaints only the band.)
 *
 * From back to front: the flow band, the title tab and its rule, each cell's
 * picture, number and instruction, the turns between steps (D22) in the
 * gutters, and the page number. An empty step keeps
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
import type { DiagramAsset, DiagramHanStyle, DiagramStep, DiagramStyle } from '../document/diagramDocument';
import { DIAGRAM_FONT_FAMILY, parseFontFaceId } from '../fonts/diagramFontFaces';
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
import { paintTurnGlyph, TURN_FRAME_MM } from '../annotate/turnGlyph';
import type { Lane } from './flowLane';
import { setUploadText } from '../upload/uploadText';
import { cellPicture } from './pagePictures';

/** The page's own inks: the mockup's, whatever the paper style. The band's is the page setup's (`layout.bandInk`). */
const INK = '#16191c';
const TEXT_INK = '#26292c';
const TAB_RADIUS_MM = 1.4;
const RULE_WIDTH_MM = 0.35;

/**
 * What browsers would otherwise add to the page's text: to the composer's,
 * which is set already, and to an upload's, which the PDF sets without it.
 */
const SET_TEXT_CSS =
  'text{font-kerning:none;font-variant-ligatures:none;' +
  'font-feature-settings:"kern" 0,"liga" 0,"clig" 0,"calt" 0;' +
  'text-spacing-trim:space-all;text-autospace:no-autospace}';

export interface ComposeDiagramPageInput {
  layout: DiagramPagesLayout;
  page: LayoutPage;
  steps: ReadonlyMap<string, DiagramStep>;
  assets: Readonly<Record<string, DiagramAsset>>;
  style: DiagramStyle;
  /** The Han style an upload's Han is set in. */
  hanStyle: DiagramHanStyle;
  /** The layout's own setter: numbers are set as the instructions were, an upload's text in its fonts. */
  setter: TextSetter;
  /** The page's `@font-face` rules for what it sets; `''` writes none. */
  embedFonts: (usage: FontUsage) => string;
  /**
   * Art past the trim on every side, mm, for a print shop's bleed: the page
   * grows by it, and what reaches the trim — the flow band — runs on into it.
   */
  bleedMm?: number;
  /**
   * Draw the flow band (true). False for the Pages view, which draws it
   * itself under the rest (`DiagramPageBand`), from {@link bandPath} and the
   * same pen, so that a new colour repaints the band and not the page.
   */
  band?: boolean;
}

export interface ComposedPage {
  svg: string;
  widthPt: number;
  heightPt: number;
}

export function composeDiagramPage(input: ComposeDiagramPageInput): ComposedPage {
  const { layout, page, setter } = input;
  const bleedPt = (input.bleedMm ?? 0) * PT_PER_MM;
  const widthPt = layout.paper.widthMm * PT_PER_MM + 2 * bleedPt;
  const heightPt = layout.paper.heightMm * PT_PER_MM + 2 * bleedPt;
  const usage = new Map<string, Set<string>>();
  const use = (face: string, text: string) => {
    const characters = usage.get(face) ?? new Set<string>();
    for (const character of text) characters.add(character);
    usage.set(face, characters);
  };
  const body: string[] = [];

  if (input.band !== false && page.band && page.band.curves.length > 0) {
    body.push(
      `<path d="${bandPath(page.band)}" fill="none" stroke="${escapeXml(layout.bandInk)}" ` +
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
    const picture = step
      ? cellPicture(step, input.assets, input.style, cell, `c${index}-`, { hanStyle: input.hanStyle, runs: setter.runs })
      : null;
    if (picture) {
      parts.push(picture.markup);
      for (const { face, characters } of picture.text) use(face, characters);
    }
    const number = setter.line(String(cell.number), STEP_NUMBER_SIZE_MM, 700);
    parts.push(stepNumberElement(number, cell.numberAt.x, cell.numberAt.y, use));
    if (cell.text.lines.length > 0) parts.push(stepTextElement(cell.text.lines, cell.text.x, cell.text.firstBaseline, use));
    body.push(`<g>\n${parts.join('\n')}\n</g>`);
  });

  // A turn's glyph, as an annotation's prints: at its own ink size, centred on
  // its place, going the way its row is read.
  for (const { id, turn, at, rightToLeft } of page.turns) {
    const sizePt = TURN_FRAME_MM * PT_PER_MM;
    const box = { x: at.x * PT_PER_MM - sizePt / 2, y: at.y * PT_PER_MM - sizePt / 2, width: sizePt, height: sizePt };
    const glyph = paintTurnGlyph(turn, box, input.style, id, { rightToLeft });
    // A rotation's fraction is set as a label's is: in the diagram's fonts, which embed its digits.
    if (glyph) body.push(setUploadText(glyph.markup, input.hanStyle, setter.runs, use));
  }

  if (page.pageNumberAt) {
    const line = setter.line(String(page.number), PAGE_NUMBER_SIZE_MM, 700);
    const { x, y, anchor } = page.pageNumberAt;
    // Right-aligned by its measured width, not `text-anchor`: no renderer's
    // idea of the width moves it.
    const left = anchor === 'end' ? x - line.widthMm : x;
    body.push(textElement([line], left, y, PAGE_NUMBER_SIZE_MM, 0, 700, INK, use));
  }

  const svg = svgDocument({
    widthPt,
    heightPt,
    originPt: { x: -bleedPt, y: -bleedPt },
    fonts: input.embedFonts(new Map([...usage].map(([face, characters]) => [face, [...characters].join('')]))),
    body,
  });
  return { svg, widthPt, heightPt };
}

/** The characters each face sets, as a page counts them for its fonts. */
export type FontUse = (face: string, text: string) => void;

/**
 * A page or a step's file as an SVG document in pt: `widthPt` × `heightPt`
 * from `originPt`, its fonts' `@font-face` rules and the set-text rules in
 * its style, then `body`.
 */
export function svgDocument({
  widthPt,
  heightPt,
  originPt,
  fonts,
  body,
}: {
  widthPt: number;
  heightPt: number;
  originPt: { x: number; y: number };
  fonts: string;
  body: readonly string[];
}): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(widthPt)}pt" height="${num(heightPt)}pt" ` +
      `viewBox="${num(originPt.x)} ${num(originPt.y)} ${num(widthPt)} ${num(heightPt)}">`,
    `<defs><style>${fonts === '' ? '' : `\n${fonts}\n`}${SET_TEXT_CSS}</style></defs>`,
    ...body,
    '</svg>',
  ].join('\n');
}

/** A step's number as a page and a step's file print it: bold, in the page's ink. */
export function stepNumberElement(line: SetLine, xMm: number, baselineMm: number, use: FontUse): string {
  return textElement([line], xMm, baselineMm, STEP_NUMBER_SIZE_MM, 0, 700, INK, use);
}

/** A step's instruction as a page and a step's file print it. */
export function stepTextElement(lines: readonly SetLine[], xMm: number, firstBaselineMm: number, use: FontUse): string {
  return textElement(lines, xMm, firstBaselineMm, STEP_TEXT_SIZE_MM, STEP_TEXT_LEADING_MM, 400, TEXT_INK, use);
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
  use: FontUse
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
    `<text xml:space="preserve" font-size="${pt(sizeMm)}" font-weight="${weight}" fill="${fill}">` +
    `${spans.join('')}</text>`
  );
}

/** The lane as the layout made it (`flowLane`): its cubic Béziers, end to end, in pt. */
export function bandPath(lane: Lane): string {
  const at = ({ x, y }: { x: number; y: number }) => `${pt(x)} ${pt(y)}`;
  return [`M ${at(lane.from)}`, ...lane.curves.map(({ c1, c2, to }) => `C ${at(c1)} ${at(c2)} ${at(to)}`)].join(' ');
}

const pt = (mm: number) => num(mm * PT_PER_MM);

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}
