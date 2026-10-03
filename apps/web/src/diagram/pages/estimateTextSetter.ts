/**
 * A text setter that estimates widths: CJK characters a full em, everything
 * else about half of one. For the layout's tests, and for a layout wanted
 * before the fonts are loaded; the composer sets text from the font itself
 * (`fontTextSetter.ts`). Both set paragraphs through `setText.ts`, so they
 * break and cut text alike.
 *
 * Pure.
 */
import { graphemesOf, isCjkGrapheme } from '../../lib/paper/textWrap';
import type { TextSetter } from './diagramPageLayout';
import { setTextLines, type TextFaces } from './setText';

const LATIN_ADVANCE = 0.52;
const ESTIMATE = 'estimate';

const advance = (grapheme: string) => (isCjkGrapheme(grapheme) ? 1 : LATIN_ADVANCE);

function facesAt(sizeMm: number): TextFaces {
  return {
    set: (graphemes) => ({
      fonts: graphemes.map(() => ESTIMATE),
      advances: graphemes.map((grapheme) => advance(grapheme) * sizeMm),
    }),
    ellipsis: () => ({ font: ESTIMATE, advance: LATIN_ADVANCE * sizeMm }),
  };
}

export const estimateTextSetter: TextSetter = {
  paragraph: (text, widthMm, sizeMm, maxLines) => setTextLines(text, widthMm, maxLines, facesAt(sizeMm)),
  line(text, sizeMm) {
    const graphemes = graphemesOf(text);
    const widthMm = graphemes.reduce((sum, grapheme) => sum + advance(grapheme), 0) * sizeMm;
    return { text, widthMm, runs: [{ font: ESTIMATE, text, xMm: 0, widthMm }], ellipsis: false };
  },
};
