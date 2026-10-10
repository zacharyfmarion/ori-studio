/**
 * An upload's text, set in the diagram's fonts (D7, route C).
 *
 * The PDF prints text only in a font the page names and embeds, and a page
 * embeds only the diagram's: Noto Sans, and Noto Sans SC, TC, JP or KR, each
 * Regular or Bold. So an upload's text is set in them as an instruction is:
 * each run of characters in its script's font (`fontScripts.ts`), Regular or
 * Bold, upright.
 *
 * - **The sanitizer** (`setTextFonts` in `svgSanitize.ts`) takes every font
 *   property but the size off every element, and writes a family and a weight
 *   on each run: an element whose only child is its text. A run of Han in a
 *   text with no kana or Hangul is written in Noto Sans SC, which stands for
 *   the diagram's Han style: the upload is shared, the style is the
 *   diagram's.
 * - **The composer** reads the runs back from the stored markup
 *   (`uploadTextRuns`), which the sanitizer wrote, so a run is always one
 *   element around its text; and sets them (`setUploadText`): the Han style
 *   put in, a character the run's font lacks moved to a font that has it, and
 *   what each face sets counted, so the page embeds it.
 *
 * Pure: strings only.
 */
import type { DiagramHanStyle } from '../document/diagramDocument';
import {
  DIAGRAM_FONT_FAMILY,
  fontFaceId,
  type DiagramFontFace,
  type DiagramFontKey,
  type DiagramFontWeight,
} from '../fonts/diagramFontFaces';
import { escapeXml } from '../../lib/xmlEscape';

/** The key a Han run is stored in: the diagram's Han style replaces it. */
export const UPLOAD_HAN_KEY = 'sc' satisfies DiagramFontKey;

/** A run's `font-family`, as the sanitizer writes it: the face, then a generic for a reader without it. */
export function uploadTextFamily(key: DiagramFontKey): string {
  return `'${DIAGRAM_FONT_FAMILY[key]}', sans-serif`;
}

const KEY_OF_FAMILY = new Map(
  (Object.keys(DIAGRAM_FONT_FAMILY) as DiagramFontKey[]).map((key) => [uploadTextFamily(key), key])
);

/** A run: an element of text whose only child is its text. */
const RUN = /<(text|tspan|textPath)(\s[^>]*)?>([^<]*)<\/\1>/g;
const TEXT_START = /<text(\s[^>]*)?>/g;
const FAMILY_ATTRIBUTE = /\sfont-family="([^"]*)"/;
const WEIGHT_ATTRIBUTE = /\sfont-weight="([^"]*)"/;

/** One run of an upload's text, its Han in the diagram's style. */
export interface UploadTextRun {
  face: DiagramFontFace;
  text: string;
}

/** A run's face from its attributes, or null for an element the sanitizer wrote no font on. */
function runFace(attributes: string, hanStyle: DiagramHanStyle): DiagramFontFace | null {
  const family = attributes.match(FAMILY_ATTRIBUTE)?.[1];
  const key = family === undefined ? undefined : KEY_OF_FAMILY.get(decodeXml(family));
  if (key === undefined) return null;
  return { key: key === UPLOAD_HAN_KEY ? hanStyle : key, weight: weightOf(attributes) };
}

function weightOf(attributes: string): DiagramFontWeight {
  return attributes.match(WEIGHT_ATTRIBUTE)?.[1] === '700' ? 700 : 400;
}

/** Every run of text in a sanitized upload. */
export function uploadTextRuns(svg: string, hanStyle: DiagramHanStyle): UploadTextRun[] {
  const runs: UploadTextRun[] = [];
  for (const [, , attributes = '', content = ''] of svg.matchAll(RUN)) {
    const face = runFace(attributes, hanStyle);
    if (face) runs.push({ face, text: decodeXml(content) });
  }
  return runs;
}

/**
 * The upload's text as a page sets it. `split` gives a run's text in the faces
 * that set it — its own, or another where its own lacks a character — and
 * `count` hears every character each face sets, the spaces between runs
 * included: they are set in Noto Sans at their text's weight.
 */
export function setUploadText(
  svg: string,
  hanStyle: DiagramHanStyle,
  split: (text: string, face: DiagramFontFace) => readonly UploadTextRun[],
  count: (face: string, characters: string) => void
): string {
  if (!svg.includes('<text')) return svg;
  for (const [, attributes = ''] of svg.matchAll(TEXT_START)) {
    count(fontFaceId({ key: 'latin', weight: weightOf(attributes) }), ' ');
  }
  return svg.replace(RUN, (whole, tag: string, attributes: string = '', content: string) => {
    const face = runFace(attributes, hanStyle);
    if (!face) return whole;
    const runs = split(decodeXml(content), face);
    // A line break or a tab is drawn as a space, or as nothing.
    for (const run of runs) count(fontFaceId(run.face), run.text.replace(/[\t\n\r]/g, ' '));
    const only = runs.length === 1 ? runs[0]!.face.key : face.key;
    const own = attributes.replace(FAMILY_ATTRIBUTE, ` font-family="${uploadTextFamily(only)}"`);
    if (runs.length <= 1) return `<${tag}${own}>${content}</${tag}>`;
    const spans = runs.map(
      (run) => `<tspan font-family="${uploadTextFamily(run.face.key)}">${escapeXml(run.text)}</tspan>`
    );
    return `<${tag}${own}>${spans.join('')}</${tag}>`;
  });
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** XML text or an attribute value, its entities and character references read. */
function decodeXml(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, name: string) => {
    if (name.startsWith('#x')) return codePoint(Number.parseInt(name.slice(2), 16)) ?? whole;
    if (name.startsWith('#')) return codePoint(Number.parseInt(name.slice(1), 10)) ?? whole;
    return ENTITIES[name] ?? whole;
  });
}

function codePoint(value: number): string | null {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : null;
}
