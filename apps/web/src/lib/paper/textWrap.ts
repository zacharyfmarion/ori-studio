/**
 * Line breaking for text set on a page: the crease-pattern export's caption and
 * the Diagram's step instructions (implementation-plans/diagram-workspace.md,
 * D10).
 *
 * The breaker iterates by grapheme (`Intl.Segmenter`), so a surrogate pair or
 * a combining sequence is never split, and it knows the scripts a diagram is
 * written in:
 * - a line may break after a space, which hangs at the line's end and is not
 *   drawn;
 * - between CJK ideographs and kana, under strict kinsoku: no line starts with
 *   closing punctuation, small kana or a prolonged mark, and none ends with
 *   opening punctuation;
 * - Korean keeps its words whole (`keep-all`), breaking at spaces;
 * - Latin, Cyrillic and Greek words are never split, unless one word is wider
 *   than the line, which then breaks between graphemes.
 *
 * Measurement is the caller's, over a range of graphemes, so one breaker
 * serves an estimate and a font's own advances alike. Truncation follows
 * line-clamp: the last kept line gives up graphemes until "…" fits after it.
 *
 * Pure: no DOM.
 */

const GRAPHEMES = new Intl.Segmenter('und', { granularity: 'grapheme' });

/** A text's graphemes, in order. */
export function graphemesOf(text: string): string[] {
  return Array.from(GRAPHEMES.segment(text), (segment) => segment.segment);
}

// Script, not Script_Extensions: U+00B7 MIDDLE DOT lists Han among a dozen
// scripts, and must stay with the run around it.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u;
const HANGUL = /\p{Script=Hangul}/u;

/** Fullwidth and CJK punctuation: Script=Common, but set and broken as CJK. */
export function isWideCjkPunctuation(codePoint: number): boolean {
  return (
    (codePoint >= 0x3000 && codePoint <= 0x303f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    codePoint === 0x30fb ||
    codePoint === 0x30fc
  );
}

/** Whether a grapheme is set in a CJK font: Han, kana, Hangul, Bopomofo or wide punctuation. */
export function isCjkGrapheme(grapheme: string): boolean {
  return CJK.test(grapheme) || isWideCjkPunctuation(grapheme.codePointAt(0) ?? 0);
}

/** Strict kinsoku (JIS X 4051, simplified): never at a line's start. */
const NO_START = new Set(
  Array.from(
    '、。，．：；？！・）］｝〕〉》」』】〙〗〟’”｠»' +
      'ヽヾーァィゥェォッャュョヮヵヶぁぃぅぇぉっゃゅょゎゕゖㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ々〻ゝゞ' +
      '‐゠–〜～…‥' +
      ',.:;!?)]}%'
  )
);
/** Never at a line's end. */
const NO_END = new Set(Array.from('（［｛〔〈《「『【〘〖〝‘“｟«([{'));
const SPACES = new Set([' ', ' ', '　', '\t']);

type BreakClass = 'space' | 'close' | 'open' | 'hangul' | 'ideograph' | 'hyphen' | 'letter';

function breakClass(grapheme: string): BreakClass {
  if (SPACES.has(grapheme)) return 'space';
  if (NO_START.has(grapheme)) return 'close';
  if (NO_END.has(grapheme)) return 'open';
  if (HANGUL.test(grapheme)) return 'hangul';
  if (isCjkGrapheme(grapheme)) return 'ideograph';
  if (grapheme === '-' || grapheme === '‐') return 'hyphen';
  return 'letter';
}

/** Whether a grapheme is a space a line may hang at its end. */
export function isBreakSpace(grapheme: string): boolean {
  return SPACES.has(grapheme);
}

/**
 * Where a line may end: `allowed[i]` is whether it may end before grapheme
 * `i` (so `allowed[length]` is always true and `allowed[0]` never is).
 */
export function breakOpportunities(graphemes: readonly string[]): boolean[] {
  const classes = graphemes.map(breakClass);
  const allowed = new Array<boolean>(graphemes.length + 1).fill(false);
  allowed[graphemes.length] = true;
  for (let i = 1; i < graphemes.length; i += 1) {
    const before = classes[i - 1]!;
    const after = classes[i]!;
    let can: boolean;
    if (after === 'space') can = false; // a space hangs at the end of its line
    else if (before === 'space') can = true;
    else if (after === 'close') can = false;
    else if (before === 'open') can = false;
    else if (before === 'hyphen') can = after === 'letter' || after === 'hangul';
    // keep-all: a Korean word — its digits, Latin and particles with it, as
    // in '45도로' or 'CP를' — breaks only at a space.
    else if (before === 'hangul' || after === 'hangul') can = false;
    else if (before === 'ideograph' || after === 'ideograph') can = true;
    else can = false; // a word
    allowed[i] = can;
  }
  return allowed;
}

/** One set line: a grapheme range, its trailing spaces dropped. */
export interface WrappedLine {
  start: number;
  end: number;
  /** The line ends in "…": the text that did not fit follows it. */
  ellipsis: boolean;
}

export interface WrapOptions {
  /** The line width, in the caller's units. */
  width: number;
  /** The width of graphemes `[start, end)` set as one line. */
  measure: (start: number, end: number) => number;
  /** At most this many lines; the last of them ends in "…" when text is left over. */
  maxLines?: number;
  /** The width "…" adds after grapheme `end` on its line. Required with `maxLines`. */
  ellipsisWidth?: (end: number) => number;
}

export interface Wrapped {
  lines: WrappedLine[];
  /** Lines the whole text would need, when it did not fit in `maxLines`. */
  overflow: { linesNeeded: number; hiddenStart: number } | null;
}

const EPSILON = 1e-9;

/**
 * Break graphemes into lines at most `width` wide: greedy, at the last
 * opportunity that fits. A unit wider than a line on its own breaks between
 * graphemes. Leading spaces on a line are skipped.
 */
export function wrapGraphemes(graphemes: readonly string[], options: WrapOptions): Wrapped {
  const allowed = breakOpportunities(graphemes);
  const { width, measure } = options;
  const trimEnd = (start: number, end: number) => {
    let at = end;
    while (at > start && isBreakSpace(graphemes[at - 1]!)) at -= 1;
    return at;
  };
  const lines: WrappedLine[] = [];
  const n = graphemes.length;
  let start = 0;
  while (start < n) {
    while (start < n && isBreakSpace(graphemes[start]!)) start += 1;
    if (start >= n) break;
    let fit = -1;
    for (let at = start + 1; at <= n; at += 1) {
      if (!allowed[at]) continue;
      if (measure(start, trimEnd(start, at)) <= width + EPSILON) fit = at;
      else break;
    }
    if (fit === -1) {
      // A unit wider than the line: as many graphemes as fit, at least one.
      let at = start + 1;
      while (at < n && measure(start, at + 1) <= width + EPSILON) at += 1;
      fit = at;
    }
    lines.push({ start, end: trimEnd(start, fit), ellipsis: false });
    start = fit;
  }
  const maxLines = options.maxLines;
  if (maxLines === undefined || lines.length <= maxLines) return { lines, overflow: null };

  const kept = lines.slice(0, Math.max(0, maxLines));
  const last = kept.at(-1);
  if (!last) return { lines: [], overflow: { linesNeeded: lines.length, hiddenStart: 0 } };
  const ellipsis = options.ellipsisWidth ?? (() => 0);
  let end = last.end;
  while (end > last.start && measure(last.start, trimEnd(last.start, end)) + ellipsis(trimEnd(last.start, end)) > width + EPSILON) {
    end -= 1;
  }
  end = trimEnd(last.start, end);
  kept[kept.length - 1] = { start: last.start, end, ellipsis: true };
  return { lines: kept, overflow: { linesNeeded: lines.length, hiddenStart: end } };
}

/**
 * Text wrapped against an estimated glyph advance (`averageAdvance` × the font
 * size per grapheme): the crease-pattern export's caption, which is drawn in a
 * system font. Explicit newlines are hard breaks, runs of white space are one
 * space, and a blank paragraph is an empty line.
 */
export function wrapEstimatedText(
  text: string,
  maxWidth: number,
  fontSize: number,
  averageAdvance: number
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const advance = fontSize * averageAdvance;
  const lines: string[] = [];
  for (const paragraph of trimmed.split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    const graphemes = graphemesOf(words.join(' '));
    const { lines: set } = wrapGraphemes(graphemes, {
      width: maxWidth,
      measure: (start, end) => (end - start) * advance,
    });
    for (const line of set) lines.push(graphemes.slice(line.start, line.end).join(''));
  }
  return lines;
}
