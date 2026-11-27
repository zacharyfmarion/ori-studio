import { describe, expect, it } from 'vitest';
import { needsNoGlyph } from './fontScripts';

const hex = (character: string) => `U+${character.codePointAt(0)!.toString(16).toUpperCase()}`;

describe('needsNoGlyph', () => {
  it('lets a joiner, a variation selector, a soft hyphen or a line break go without a glyph', () => {
    for (const character of ['\u{200D}', '\u{200B}', '\u{FE0F}', '\u{E0100}', '\u{00AD}', '\u{180B}', '\t', '\n', '\r']) {
      expect(needsNoGlyph(character), hex(character)).toBe(true);
    }
  });

  it('asks a glyph for what the shapers draw though Unicode calls it ignorable: the Hangul fillers, and the rest', () => {
    for (const character of ['\u{115F}', '\u{1160}', '\u{3164}', '\u{FFA0}', '\u{180F}', '\u{1BCA0}', '\u{1BCA3}']) {
      expect(needsNoGlyph(character), hex(character)).toBe(false);
    }
  });

  it('asks a glyph for every letter, digit, space and mark', () => {
    for (const character of ['a', '3', ' ', '\u{3000}', '\u{0301}', '\u{304B}', '\u{6298}']) {
      expect(needsNoGlyph(character), hex(character)).toBe(false);
    }
  });
});
