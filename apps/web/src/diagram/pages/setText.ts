/**
 * A paragraph set into lines, from each grapheme's font and advance: the one
 * setting the composer's font and the layout's estimate share, so they break
 * and cut text the same way and differ only in how wide a character is.
 *
 * - The instruction's own line breaks are kept; runs of spaces are one space,
 *   a blank line is an empty line, and the text is set composed (NFC).
 * - Lines break as `wrapGraphemes` breaks them (kinsoku, Korean keep-all).
 * - A text past `maxLines` keeps that many, the last ending in "…", set in the
 *   font of the character before it when that font has one.
 * - Each line is split into runs of one font, placed from the line's start.
 *
 * Pure.
 */
import { graphemesOf, isBreakSpace, wrapGraphemes } from '../../lib/paper/textWrap';
import type { SetLine, SetRun, SetText } from './diagramPageLayout';

export const ELLIPSIS = '…';

/** How a paragraph's graphemes are set: each one's font, and its advance in mm. */
export interface SetGraphemes {
  fonts: readonly string[];
  advances: readonly number[];
}

export interface TextFaces {
  /** Fonts and advances for one paragraph's graphemes. */
  set: (graphemes: readonly string[]) => SetGraphemes;
  /** The font "…" is set in after a grapheme in `font`, and its advance in mm. */
  ellipsis: (font: string) => { font: string; advance: number };
}

interface Paragraph {
  graphemes: string[];
  fonts: readonly string[];
  /** prefix[i]: the advance of graphemes [0, i). */
  prefix: number[];
}

/** Lines of `text`, at most `widthMm` wide and `maxLines` many. */
export function setTextLines(text: string, widthMm: number, maxLines: number, faces: TextFaces): SetText {
  const paragraphs = paragraphsOf(text).map((source): Paragraph => {
    const graphemes = graphemesOf(source);
    const { fonts, advances } = faces.set(graphemes);
    const prefix = [0];
    for (const advance of advances) prefix.push(prefix.at(-1)! + advance);
    return { graphemes, fonts, prefix };
  });
  const measureIn = (paragraph: Paragraph) => (start: number, end: number) =>
    paragraph.prefix[end]! - paragraph.prefix[start]!;

  const all: { paragraph: Paragraph; start: number; end: number }[] = [];
  for (const paragraph of paragraphs) {
    const { lines } = wrapGraphemes(paragraph.graphemes, { width: widthMm, measure: measureIn(paragraph) });
    if (lines.length === 0) all.push({ paragraph, start: 0, end: 0 });
    for (const line of lines) all.push({ paragraph, start: line.start, end: line.end });
  }
  const linesNeeded = all.length;
  if (linesNeeded <= maxLines) {
    return { lines: all.map(({ paragraph, start, end }) => lineOf(paragraph, start, end, null)), linesNeeded };
  }

  const kept = all.slice(0, Math.max(0, maxLines));
  const last = kept.at(-1);
  if (!last) return { lines: [], linesNeeded };
  // The last kept line gives up graphemes until "…" fits after them — also
  // when it ends its paragraph and the text cut is a paragraph after it.
  const { paragraph, start } = last;
  const measure = measureIn(paragraph);
  const trimEnd = (end: number) => {
    while (end > start && isBreakSpace(paragraph.graphemes[end - 1]!)) end -= 1;
    return end;
  };
  const ellipsisAfter = (end: number) =>
    faces.ellipsis(paragraph.fonts[end > start ? end - 1 : start] ?? '').advance;
  let end = last.end;
  while (end > start && measure(start, trimEnd(end)) + ellipsisAfter(trimEnd(end)) > widthMm + 1e-9) end -= 1;
  end = trimEnd(end);
  const lines = kept.slice(0, -1).map((line) => lineOf(line.paragraph, line.start, line.end, null));
  lines.push(lineOf(paragraph, start, end, faces));
  return { lines, linesNeeded };
}

/** One set line; `ellipsis` given, it ends in "…". */
function lineOf(paragraph: Paragraph, start: number, end: number, ellipsis: TextFaces | null): SetLine {
  const runs: SetRun[] = [];
  let x = 0;
  for (let index = start; index < end; index += 1) {
    const font = paragraph.fonts[index]!;
    const advance = paragraph.prefix[index + 1]! - paragraph.prefix[index]!;
    appendRun(runs, font, paragraph.graphemes[index]!, x, advance);
    x += advance;
  }
  if (ellipsis) {
    const before = end > start ? paragraph.fonts[end - 1]! : (paragraph.fonts[start] ?? '');
    const mark = ellipsis.ellipsis(before);
    appendRun(runs, mark.font, ELLIPSIS, x, mark.advance);
    x += mark.advance;
  }
  return { text: runs.map((run) => run.text).join(''), widthMm: x, runs, ellipsis: ellipsis !== null };
}

function appendRun(runs: SetRun[], font: string, text: string, x: number, advance: number): void {
  const last = runs.at(-1);
  if (last && last.font === font) {
    last.text += text;
    last.widthMm += advance;
  } else {
    runs.push({ font, text, xMm: x, widthMm: advance });
  }
}

/**
 * The text's paragraphs: its own lines, each with runs of white space made one
 * space, in composed form (NFC) — a decomposed accent, as pasted from some
 * sources, is set as the font's own accented letter.
 */
function paragraphsOf(text: string): string[] {
  const trimmed = text.normalize('NFC').trim();
  if (trimmed === '') return [];
  return trimmed.split(/\r\n|\r|\n/).map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim());
}
