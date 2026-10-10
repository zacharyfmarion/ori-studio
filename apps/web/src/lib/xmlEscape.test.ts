import { describe, expect, it } from 'vitest';

import { escapeXml, xmlText } from './xmlEscape';

describe('xmlText', () => {
  it('keeps every character XML can hold, including tab, newlines and astral CJK', () => {
    const text = 'Fold\tthe corner,\nthen\r unfold. 将底角 𠀀 鶴 🙂 & <ok>';
    expect(xmlText(text)).toBe(text);
  });

  it('removes C0 controls XML 1.0 cannot hold', () => {
    expect(xmlText('a\u0000b\u0008c\u000Bd\u000Ce\u001Ff')).toBe('abcdef');
  });

  it('removes U+FFFE, U+FFFF and lone surrogates, never half of a pair', () => {
    expect(xmlText('a￾b￿c')).toBe('abc');
    expect(xmlText('a\uD800b')).toBe('ab');
    expect(xmlText('a\uDC00b')).toBe('ab');
    expect(xmlText('a𠀀b')).toBe('a𠀀b');
  });

  it('leaves escaping to escapeXml', () => {
    expect(escapeXml(xmlText('<a & b>'))).toBe('&lt;a &amp; b&gt;');
  });
});
