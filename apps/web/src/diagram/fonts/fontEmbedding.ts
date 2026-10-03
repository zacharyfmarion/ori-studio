/**
 * The fonts a page uses, embedded in it (Decision 2): each face cut to the
 * characters the page sets in it, with no layout features, as a data-URI
 * `@font-face` — which an SVG shown as an `<img>` renders, where a linked
 * font would not load.
 *
 * Pure but for the subsetter, which is handed in once its wasm is loaded.
 */
import { bytesToBase64 } from '../../lib/base64';
import { parseFontFaceId } from './diagramFontFaces';
import type { DiagramFonts } from './diagramFonts';
import type { FontSubsetter } from './fontSubset';

/** Characters by face id (`sc-400`): what a page sets in each. */
export type FontUsage = ReadonlyMap<string, string>;

/**
 * The page's `@font-face` rules, one per face it uses, in a stable order. A
 * face that is not loaded is left out: its characters were set in another.
 */
export function embeddedFontFaces(usage: FontUsage, fonts: DiagramFonts, subsetter: FontSubsetter): string {
  const rules: string[] = [];
  for (const id of [...usage.keys()].sort()) {
    const face = parseFontFaceId(id);
    const font = face ? fonts.font(face.key, face.weight) : null;
    const text = usage.get(id) ?? '';
    if (!font || text === '') continue;
    const subset = subsetter.subset(`${id}-${font.tier}`, font.bytes, text);
    rules.push(
      `@font-face{font-family:'${font.family}';font-weight:${font.weight};font-style:normal;` +
        `src:url(data:font/ttf;base64,${bytesToBase64(subset)}) format('truetype')}`
    );
  }
  return rules.join('\n');
}
