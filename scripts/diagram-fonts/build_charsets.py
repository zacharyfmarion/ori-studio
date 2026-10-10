"""Write the character sets the font build cuts its tiers from (charsets/*.txt).

Run once, by hand, when a set should change; the outputs are committed, so the
font build itself needs no frequency data. Needs `wordfreq` (pip install
wordfreq). Coverage figures are in implementation-plans/diagram-workspace.md
(Phase 0, Decision 2).

- latin.txt: what the bundled Noto Sans subset carries: ASCII, Latin-1,
  Latin Extended-A and -B, Latin Extended Additional (Vietnamese), the
  spacing modifiers and combining marks, Greek, Cyrillic, general
  punctuation, the minus, the multiplication sign, the degree sign and the
  replacement character. Noto Sans has no arrows; a text with one is set in
  a CJK font, whose common tier carries them.
- common.txt: what every CJK common tier also carries: ASCII, Latin-1,
  general and CJK punctuation, kana and the fullwidth forms, and the symbols
  diagrams use in every script — arrows, circled numbers, geometric shapes,
  stars, letterlike symbols (℃), maths operators and the CJK unit squares
  (㎝, ㎜).
- sc.txt: GB2312 level 1 plus the 3,500 most frequent Han in wordfreq's large
  Chinese list (99.86% of Han use).
- tc.txt: Big5 level 1.
- jp.txt: JIS X 0208 level-1 kanji.
- kr.txt: KS X 1001 Hangul.
"""
import os
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))


def chars(ranges):
    return {chr(c) for start, end in ranges for c in range(start, end + 1)}


def decode_range(encoding, highs, lows):
    out = set()
    for hi in highs:
        for lo in lows:
            try:
                out.add(bytes([hi, lo]).decode(encoding))
            except UnicodeDecodeError:
                pass
    return out


def han(text):
    return {c for c in text if 0x4E00 <= ord(c) <= 0x9FFF}


def write(name, charset):
    text = ''.join(sorted(charset))
    with open(os.path.join(HERE, 'charsets', name), 'w', encoding='utf-8') as out:
        out.write(text + '\n')
    print(name, len(text))


LATIN = chars([(0x20, 0x7E), (0xA0, 0x24F), (0x2B0, 0x2FF), (0x300, 0x36F), (0x370, 0x3FF), (0x400, 0x4FF),
               (0x1E00, 0x1EFF), (0x2000, 0x206F), (0x2212, 0x2212), (0xFFFD, 0xFFFD)])
COMMON = chars([(0x20, 0x7E), (0xA0, 0xFF), (0x2000, 0x206F), (0x2100, 0x214F), (0x2190, 0x21FF), (0x2200, 0x22FF),
                (0x2460, 0x24FF), (0x25A0, 0x25FF), (0x2600, 0x26FF), (0x3000, 0x303F), (0x3040, 0x30FF),
                (0x3300, 0x33FF), (0xFF00, 0xFFEF)])


def main():
    from wordfreq import get_frequency_dict

    write('latin.txt', LATIN)
    write('common.txt', COMMON)

    frequencies = Counter()
    for word, frequency in get_frequency_dict('zh', wordlist='large').items():
        for c in han(word):
            frequencies[c] += frequency
    top = {c for c, _ in frequencies.most_common(3500)}
    gb2312_l1 = han(''.join(decode_range('gb2312', range(0xB0, 0xD8), range(0xA1, 0xFF))))
    write('sc.txt', gb2312_l1 | top)
    write('tc.txt', han(''.join(decode_range('big5', range(0xA4, 0xC7), list(range(0x40, 0x7F)) + list(range(0xA1, 0xFF))))))
    write('jp.txt', han(''.join(decode_range('euc_jp', range(0xB0, 0xD0), range(0xA1, 0xFF)))))
    write('kr.txt', {c for c in decode_range('euc_kr', range(0xB0, 0xC9), range(0xA1, 0xFF)) if 0xAC00 <= ord(c) <= 0xD7A3})


if __name__ == '__main__':
    main()
