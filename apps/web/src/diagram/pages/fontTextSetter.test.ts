import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { graphemesOf } from '../../lib/paper/textWrap';
import type { DiagramFontKey, DiagramFontWeight } from '../fonts/diagramFontFaces';
import { readFontMetrics, type FontMetrics } from '../fonts/fontMetrics';
import { assignFonts, textCjkKey } from '../fonts/fontScripts';
import { fontTextSetter, type FontLookup } from './fontTextSetter';

/**
 * Against the real fonts: the bundled Latin pair, and CJK fixtures cut from the
 * built common tiers (`src/diagram/fonts/fixtures/`, a few dozen characters
 * each, advances unchanged).
 */
const FONT_DIR = resolve(process.cwd(), 'src/diagram/fonts');
const read = (path: string) => readFontMetrics(readFileSync(resolve(FONT_DIR, path)));
const FONTS: Partial<Record<string, FontMetrics>> = {
  'latin-400': read('NotoSans-Regular.ttf'),
  'latin-700': read('NotoSans-Bold.ttf'),
  'sc-400': read('fixtures/NotoSansSC-Regular.fixture.ttf'),
  'sc-700': read('fixtures/NotoSansSC-Bold.fixture.ttf'),
  'tc-400': read('fixtures/NotoSansTC-Regular.fixture.ttf'),
  'jp-400': read('fixtures/NotoSansJP-Regular.fixture.ttf'),
  'kr-400': read('fixtures/NotoSansKR-Regular.fixture.ttf'),
};
const lookup: FontLookup = (key, weight) => FONTS[`${key}-${weight}`] ?? null;
const only =
  (...faces: string[]): FontLookup =>
  (key, weight) =>
    faces.includes(`${key}-${weight}`) ? (FONTS[`${key}-${weight}`] ?? null) : null;

/** A run's width the long way: each code point's advance, scaled to mm. */
function widthOf(text: string, face: string, sizeMm: number): number {
  const metrics = FONTS[face]!;
  let units = 0;
  for (const character of text) units += metrics.advance(character.codePointAt(0)!);
  return (units * sizeMm) / metrics.unitsPerEm;
}

const covers = (fonts: FontLookup, weight: DiagramFontWeight) => (key: DiagramFontKey, grapheme: string) => {
  const metrics = fonts(key, weight);
  return !!metrics && [...grapheme].every((character) => metrics.has(character.codePointAt(0)!));
};

describe('assignFonts', () => {
  it('sets letters in Noto Sans, CJK in the text’s CJK font, and the rest with the run before it', () => {
    // The middle dot is Han by Script_Extensions, Common by Script: it stays with "Crane".
    const graphemes = graphemesOf('Crane · 千纸 鹤');
    const { fonts, missing } = assignFonts(graphemes, 'sc', covers(lookup, 400));
    expect(fonts).toEqual([...Array<string>(8).fill('latin'), 'sc', 'sc', 'sc', 'sc']);
    expect(missing).toEqual([]);
  });

  it('starts a text with the first run it has', () => {
    const { fonts } = assignFonts(graphemesOf('「千纸鹤」'), 'sc', covers(lookup, 400));
    expect(new Set(fonts)).toEqual(new Set(['sc']));
  });

  it('picks Japanese for kana, Korean for Hangul, the Han style otherwise', () => {
    expect(textCjkKey('鶴を折ります', 'sc')).toBe('jp');
    expect(textCjkKey('종이학', 'tc')).toBe('kr');
    expect(textCjkKey('千纸鹤', 'tc')).toBe('tc');
  });

  it('falls back to another CJK font for a character its own lacks, and reports one none has', () => {
    // 纸 is simplified: the Japanese fixture has no glyph for it, the Chinese one does.
    const { fonts, missing } = assignFonts(graphemesOf('鶴纸𠀀'), 'jp', covers(lookup, 400));
    expect(fonts.slice(0, 2)).toEqual(['jp', 'sc']);
    expect(missing).toEqual(['𠀀']);
  });
});

describe('fontTextSetter', () => {
  const setter = () => fontTextSetter(lookup, 'sc');

  it('measures a line by the fonts’ own advances, run by run', () => {
    const line = setter().line('Crane · 千纸鹤', 3.8, 700);
    expect(line.runs.map((run) => [run.font, run.text])).toEqual([
      ['latin-700', 'Crane · '],
      ['sc-700', '千纸鹤'],
    ]);
    expect(line.runs[0]!.widthMm).toBeCloseTo(widthOf('Crane · ', 'latin-700', 3.8), 9);
    expect(line.runs[1]!.xMm).toBeCloseTo(line.runs[0]!.widthMm, 9);
    expect(line.widthMm).toBeCloseTo(widthOf('Crane · ', 'latin-700', 3.8) + widthOf('千纸鹤', 'sc-700', 3.8), 9);
  });

  it('breaks Chinese between characters but never before closing punctuation', () => {
    const text = '将底角向上折至顶角，压实折痕后展开。将底角向上折至顶角，压实折痕后展开。';
    const set = setter().paragraph(text, 20, 3.2, 99);
    expect(set.lines.length).toBeGreaterThan(2);
    for (const line of set.lines) {
      expect(line.widthMm).toBeLessThanOrEqual(20 + 1e-9);
      expect(line.text[0]).not.toMatch(/[，。]/u);
    }
    expect(set.lines.map((line) => line.text).join('')).toBe(text);
  });

  it('keeps Korean words whole', () => {
    const text = '아래 모서리를 위 모서리에 맞춰 접고 단단히 접은 뒤 펼칩니다.';
    const words = new Set(text.split(' '));
    for (const line of fontTextSetter(lookup, 'sc').paragraph(text, 18, 3.2, 99).lines) {
      for (const word of line.text.split(' ')) expect(words.has(word)).toBe(true);
    }
  });

  it('sets a decomposed accent as the font’s own letter', () => {
    const set = setter().paragraph('Pliez le cafe\u0301.', 60, 3.2, 1);
    expect(set.lines[0]!.text).toBe('Pliez le café.');
    expect(set.lines[0]!.widthMm).toBeCloseTo(widthOf('Pliez le café.', 'latin-400', 3.2), 9);
  });

  it('keeps the instruction’s own line breaks', () => {
    expect(setter().paragraph('Fold.\n\nUnfold.', 60, 3.2, 9).lines.map((line) => line.text)).toEqual([
      'Fold.',
      '',
      'Unfold.',
    ]);
  });

  it('cuts text past its lines with "…" that fits, in the font before it', () => {
    const text = '将底角向上折至顶角，压实折痕后展开。将底角向上折至顶角，压实折痕后展开。';
    const set = setter().paragraph(text, 20, 3.2, 2);
    expect(set.lines).toHaveLength(2);
    expect(set.linesNeeded).toBeGreaterThan(2);
    const last = set.lines[1]!;
    expect(last.ellipsis).toBe(true);
    expect(last.text.endsWith('…')).toBe(true);
    expect(last.runs.at(-1)!.font).toBe('sc-400');
    expect(last.widthMm).toBeLessThanOrEqual(20 + 1e-9);
  });

  it('marks a cut that falls between paragraphs, and keeps it inside the line', () => {
    const set = setter().paragraph('Fold the corner up.\nUnfold.\nTurn over.', 30, 3.2, 2);
    expect(set.lines.map((line) => line.text)).toEqual(['Fold the corner up.', 'Unfold.…']);
    expect(set.lines[1]!.widthMm).toBeLessThanOrEqual(30);
  });

  it('reports characters no loaded font has, and sets them in Noto Sans’s box', () => {
    const set = fontTextSetter(only('latin-400', 'latin-700'), 'sc');
    const line = set.paragraph('Crane 鶴', 60, 3.2, 1).lines[0]!;
    expect([...set.missing]).toEqual(['鶴']);
    expect(line.runs.map((run) => run.font)).toEqual(['latin-400']);
  });
});
