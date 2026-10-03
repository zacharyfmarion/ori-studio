import { describe, expect, it } from 'vitest';
import { breakOpportunities, graphemesOf, wrapEstimatedText, wrapGraphemes, type WrapOptions } from './textWrap';

/** Every grapheme one unit wide, CJK two: a monospace stand-in for a font. */
function units(graphemes: readonly string[]) {
  const width = (grapheme: string) => (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-〿＀-｠]/u.test(grapheme) ? 2 : 1);
  return (start: number, end: number) => {
    let total = 0;
    for (let i = start; i < end; i += 1) total += width(graphemes[i]!);
    return total;
  };
}

function wrap(text: string, width: number, options: Partial<WrapOptions> = {}) {
  const graphemes = graphemesOf(text);
  const result = wrapGraphemes(graphemes, { width, measure: units(graphemes), ...options });
  return {
    lines: result.lines.map((line) => graphemes.slice(line.start, line.end).join('') + (line.ellipsis ? '…' : '')),
    overflow: result.overflow,
    hidden: result.overflow ? graphemes.slice(result.overflow.hiddenStart).join('').trim() : '',
  };
}

describe('wrapGraphemes', () => {
  it('fills lines greedily, breaking after spaces, which hang and are not drawn', () => {
    expect(wrap('Fold the corner to the centre.', 12).lines).toEqual(['Fold the', 'corner to', 'the centre.']);
  });

  it('breaks between CJK characters', () => {
    expect(wrap('折り目をつけてから広げます', 10).lines).toEqual(['折り目をつ', 'けてから広', 'げます']);
  });

  // Strict kinsoku: no line starts with closing punctuation or a small kana,
  // and none ends with opening punctuation.
  it('keeps closing punctuation, small kana and the long mark off a line’s start, and openers off its end', () => {
    const lines = wrap('角を合わせる。「中心線」まで折ってください。ノートのページ', 10).lines;
    for (const line of lines) {
      expect(line[0]).not.toMatch(/[。、」）ーっゃゅょ]/u);
      expect(line.at(-1)).not.toMatch(/[「（]/u);
    }
    expect(lines.join('')).toBe('角を合わせる。「中心線」まで折ってください。ノートのページ');
  });

  it('keeps Korean words whole', () => {
    const text = '종이를 반으로 접어 주세요';
    const words = new Set(text.split(' '));
    const lines = wrap(text, 10).lines;
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) for (const word of line.split(' ')) expect(words.has(word)).toBe(true);
  });

  it('keeps a Korean word whole with the digits and Latin in it', () => {
    for (const text of ['종이를 45도로 접어 주세요', '먼저 CP를 보고 2번 선을 접으세요']) {
      const words = new Set(text.split(' '));
      // From the longest word's width up: narrower, a word must break inside itself.
      for (let width = 10; width <= 24; width += 1) {
        for (const line of wrap(text, width).lines) {
          for (const word of line.split(' ')) expect(words.has(word), `${text} at ${width}: ${line}`).toBe(true);
        }
      }
    }
  });

  it('splits a word wider than the line between graphemes, never inside one', () => {
    const lines = wrap('𠮷𠮷𠮷𠮷𠮷𠮷', 4).lines;
    expect(lines).toEqual(['𠮷𠮷', '𠮷𠮷', '𠮷𠮷']);
    expect(wrap('abcdefghij', 4).lines).toEqual(['abcd', 'efgh', 'ij']);
    // A combining sequence is one grapheme.
    expect(wrap('ééé', 2).lines).toEqual(['éé', 'é']);
  });

  it('truncates at maxLines with an ellipsis that fits, and says what it hid', () => {
    const result = wrap('one two three four five six seven', 9, { maxLines: 2, ellipsisWidth: () => 1 });
    expect(result.lines).toEqual(['one two', 'three…']);
    expect(result.overflow).toMatchObject({ linesNeeded: 4 });
    expect(result.hidden).toBe('four five six seven');
    // The ellipsis fits: the kept line plus "…" is within the width.
    expect(result.lines.every((line) => [...line].length <= 9)).toBe(true);
  });

  it('gives up graphemes on the last line until the ellipsis fits', () => {
    const result = wrap('abcdefgh ijkl', 8, { maxLines: 1, ellipsisWidth: () => 1 });
    expect(result.lines).toEqual(['abcdefg…']);
    expect(result.hidden).toBe('h ijkl');
  });

  it('loses no text: the lines and what was hidden are the text', () => {
    const texts = [
      'Fold the bottom edge up to the top edge, then unfold.',
      '底边向上折到顶边，然后展开。再沿对角线折。',
      'Сложите нижний край к верхнему, затем разверните.',
      '下の辺を上の辺に合わせて折り、折り筋をつけて戻します。',
    ];
    for (const text of texts) {
      for (const width of [6, 11, 17, 30]) {
        const result = wrap(text, width, { maxLines: 3, ellipsisWidth: () => 1 });
        const kept = result.lines.map((line) => line.replace(/…$/, '')).join('');
        const all = (kept + result.hidden).replace(/\s+/g, '');
        expect(all).toBe(text.replace(/\s+/g, ''));
      }
    }
  });
});

describe('breakOpportunities', () => {
  it('never ends a line before a space, and always may after one', () => {
    const allowed = breakOpportunities(graphemesOf('a b'));
    expect(allowed).toEqual([false, false, true, true]);
  });
});

describe('wrapEstimatedText', () => {
  it('wraps as the crease-pattern caption always has: words, hard breaks, collapsed spaces', () => {
    expect(wrapEstimatedText('alpha   beta\n\ngamma', 60, 20, 0.5)).toEqual([
      'alpha',
      'beta',
      '',
      'gamma',
    ]);
    expect(wrapEstimatedText('   ', 500, 20, 0.5)).toEqual([]);
  });

  it('breaks a Chinese caption between characters instead of as one word', () => {
    const lines = wrapEstimatedText('沿对角线折叠然后展开', 50, 10, 1);
    expect(lines).toEqual(['沿对角线折', '叠然后展开']);
  });
});
