/**
 * Which font sets each character of a text (Decision 2): one font per run,
 * chosen by Unicode Script, never by Script_Extensions.
 *
 * - A text's CJK characters are set in one CJK font: Japanese when it has kana,
 *   Korean when it has Hangul, otherwise the diagram's Han style, since the
 *   same Han code point is drawn differently in Chinese, Japanese and Korean.
 * - Latin, Cyrillic and Greek letters are set in Noto Sans.
 * - Everything else — spaces, digits, punctuation, the middle dot — joins the
 *   run before it, or the first run after it at a text's start.
 * - A character the chosen font lacks falls back through the CJK fonts, then
 *   Noto Sans; one none of them has is reported missing and set in Noto Sans,
 *   measured as its missing-glyph box.
 *
 * Pure.
 */
import { isWideCjkPunctuation } from '../../lib/paper/textWrap';
import type { DiagramHanStyle } from '../document/diagramDocument';
import { CJK_FONT_KEYS, type CjkFontKey, type DiagramFontKey } from './diagramFontFaces';

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL = /\p{Script=Hangul}/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u;
const LATIN = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]/u;

type ScriptKind = 'cjk' | 'latin' | 'common';

function kindOf(grapheme: string): ScriptKind {
  if (CJK.test(grapheme) || isWideCjkPunctuation(grapheme.codePointAt(0) ?? 0)) return 'cjk';
  if (LATIN.test(grapheme)) return 'latin';
  return 'common';
}

/** Whether a text has any character set in a CJK font. */
export function hasCjk(text: string): boolean {
  for (const character of text) {
    if (kindOf(character) === 'cjk') return true;
  }
  return false;
}

/** The CJK font a text's CJK characters are set in. */
export function textCjkKey(text: string, hanStyle: DiagramHanStyle): CjkFontKey {
  if (KANA.test(text)) return 'jp';
  if (HANGUL.test(text)) return 'kr';
  return hanStyle;
}

export interface FontAssignment {
  /** Each grapheme's font. */
  fonts: DiagramFontKey[];
  /** The graphemes no font has, in order. */
  missing: string[];
}

/**
 * Each grapheme's font. `covers(key, grapheme)` says whether a font that is
 * available has every code point of the grapheme; an unavailable font covers
 * nothing.
 */
export function assignFonts(
  graphemes: readonly string[],
  cjkKey: CjkFontKey,
  covers: (key: DiagramFontKey, grapheme: string) => boolean
): FontAssignment {
  const strong: (DiagramFontKey | null)[] = graphemes.map((grapheme) => {
    const kind = kindOf(grapheme);
    return kind === 'cjk' ? cjkKey : kind === 'latin' ? 'latin' : null;
  });
  const first = strong.find((font): font is DiagramFontKey => font !== null) ?? 'latin';
  const fonts: DiagramFontKey[] = [];
  let previous: DiagramFontKey | null = null;
  for (const font of strong) {
    const chosen: DiagramFontKey = font ?? previous ?? first;
    fonts.push(chosen);
    previous = chosen;
  }
  const missing: string[] = [];
  fonts.forEach((font, index) => {
    const grapheme = graphemes[index]!;
    if (covers(font, grapheme)) return;
    const fallback = fallbacks(font).find((key) => covers(key, grapheme));
    if (fallback) {
      fonts[index] = fallback;
    } else {
      // Measured, and named, as the bundled font's missing-glyph box: the
      // page never names a font it did not embed.
      fonts[index] = 'latin';
      missing.push(grapheme);
    }
  });
  return { fonts, missing };
}

/** Where a character the font lacks is looked for: the other CJK fonts, then Noto Sans. */
function fallbacks(font: DiagramFontKey): DiagramFontKey[] {
  return [...CJK_FONT_KEYS, 'latin' as const].filter((key) => key !== font);
}
