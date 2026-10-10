/**
 * The composer's text setter: every width from the fonts' own advances
 * (Decision 2), so a line set here is exactly as wide in Chromium, WebKit and
 * the PDF, whose fonts are cut from the same files with no layout features.
 *
 * A run's `font` is its face's id (`sc-400`), which the composer turns back
 * into the family and weight it names and embeds.
 *
 * Pure: the fonts are loaded by the caller.
 */
import { graphemesOf } from '../../lib/paper/textWrap';
import type { DiagramHanStyle } from '../document/diagramDocument';
import {
  fontFaceId,
  parseFontFaceId,
  type DiagramFontFace,
  type DiagramFontKey,
  type DiagramFontWeight,
} from '../fonts/diagramFontFaces';
import type { FontMetrics } from '../fonts/fontMetrics';
import { assignFonts, coverFonts, needsNoGlyph, textCjkKey } from '../fonts/fontScripts';
import type { SetLine, TextSetter } from './diagramPageLayout';
import { ELLIPSIS, setTextLines, type TextFaces } from './setText';

/** The metrics of a loaded face, or null for one that could not be loaded. */
export type FontLookup = (key: DiagramFontKey, weight: DiagramFontWeight) => FontMetrics | null;

export interface FontTextSetter extends TextSetter {
  /** Every grapheme set so far that no loaded font has: drawn as a missing-glyph box. */
  readonly missing: ReadonlySet<string>;
}


export function fontTextSetter(fonts: FontLookup, hanStyle: DiagramHanStyle): FontTextSetter {
  const missing = new Set<string>();

  const covers = (weight: DiagramFontWeight) => (key: DiagramFontKey, grapheme: string) => {
    const metrics = fonts(key, weight);
    if (!metrics) return false;
    for (const character of grapheme) {
      if (!needsNoGlyph(character) && !metrics.has(character.codePointAt(0)!)) return false;
    }
    return true;
  };

  /** A grapheme's advance in mm, in its font at `sizeMm`. */
  const advanceOf = (grapheme: string, key: DiagramFontKey, weight: DiagramFontWeight, sizeMm: number) => {
    const metrics = fonts(key, weight) ?? fonts('latin', weight);
    if (!metrics) return 0;
    let units = 0;
    for (const character of grapheme) {
      const codePoint = character.codePointAt(0)!;
      if (needsNoGlyph(character) && !metrics.has(codePoint)) continue;
      units += metrics.advance(codePoint);
    }
    return (units * sizeMm) / metrics.unitsPerEm;
  };

  const facesFor = (text: string, weight: DiagramFontWeight, sizeMm: number): TextFaces => {
    const cjk = textCjkKey(text, hanStyle);
    const coverage = covers(weight);
    return {
      set(graphemes) {
        const assigned = assignFonts(graphemes, cjk, coverage);
        for (const grapheme of assigned.missing) missing.add(grapheme);
        return {
          fonts: assigned.fonts.map((key) => fontFaceId({ key, weight })),
          advances: graphemes.map((grapheme, index) => advanceOf(grapheme, assigned.fonts[index]!, weight, sizeMm)),
        };
      },
      ellipsis(font) {
        const before = parseFontFaceId(font)?.key ?? 'latin';
        const key = coverage(before, ELLIPSIS) ? before : 'latin';
        return { font: fontFaceId({ key, weight }), advance: advanceOf(ELLIPSIS, key, weight, sizeMm) };
      },
    };
  };

  return {
    missing,
    paragraph: (text, widthMm, sizeMm, maxLines) =>
      setTextLines(text, widthMm, maxLines, facesFor(text, 400, sizeMm)),
    line(text, sizeMm, weight, maxWidthMm = Number.POSITIVE_INFINITY): SetLine {
      const set = setTextLines(text, maxWidthMm, 1, facesFor(text, weight, sizeMm));
      return set.lines[0] ?? { text: '', widthMm: 0, runs: [], ellipsis: false };
    },
    runs(text, { key, weight }) {
      const graphemes = graphemesOf(text);
      const assigned = coverFonts(graphemes, graphemes.map(() => key), covers(weight));
      for (const grapheme of assigned.missing) missing.add(grapheme);
      const runs: { face: DiagramFontFace; text: string }[] = [];
      graphemes.forEach((grapheme, index) => {
        const font = assigned.fonts[index]!;
        const last = runs[runs.length - 1];
        if (last?.face.key === font) last.text += grapheme;
        else runs.push({ face: { key: font, weight }, text: grapheme });
      });
      return runs;
    },
  };
}
