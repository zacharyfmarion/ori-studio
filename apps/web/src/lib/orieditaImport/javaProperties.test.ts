import { describe, expect, it } from 'vitest';
import { parseJavaProperties } from './javaProperties';
import type { JavaPropertyValue } from './javaProperties';

/** Flatten the tri-state so a test can assert on it in one expression. */
function read(text: string, key: string): string | 'EMPTY' | 'ABSENT' {
  const entry: JavaPropertyValue | undefined = parseJavaProperties(text).get(key);
  if (!entry) return 'ABSENT';
  return entry.kind === 'empty' ? 'EMPTY' : entry.value;
}

describe('parseJavaProperties', () => {
  describe('separators', () => {
    it('accepts equals, colon and whitespace', () => {
      expect(read('a=one', 'a')).toBe('one');
      expect(read('b:two', 'b')).toBe('two');
      expect(read('c three', 'c')).toBe('three');
      expect(read('d\tfour', 'd')).toBe('four');
    });

    it('skips whitespace around the separator', () => {
      expect(read('a   =   one', 'a')).toBe('one');
      expect(read('b \t: \ttwo', 'b')).toBe('two');
      expect(read('c    three', 'c')).toBe('three');
    });

    it('keeps a second separator as part of the value', () => {
      // Whitespace ends the key, then one separator is consumed; the next is data.
      expect(read('a == one', 'a')).toBe('= one');
      expect(read('b=:two', 'b')).toBe(':two');
    });

    it('keeps trailing whitespace in the value', () => {
      expect(read('a = one  ', 'a')).toBe('one  ');
    });
  });

  it('skips leading whitespace on a line', () => {
    expect(read('   \t a = one', 'a')).toBe('one');
  });

  describe('comments', () => {
    it('ignores lines whose first non-whitespace character is # or !', () => {
      const text = '#Wed Aug 12 10:25:37 PDT 2026\n  ! a=nope\na=one\n';
      expect(read(text, 'a')).toBe('one');
      expect(read(text, '#Wed')).toBe('ABSENT');
      expect(read(text, '!')).toBe('ABSENT');
    });

    it('does not let a comment continue onto the next line', () => {
      // A comment is discarded whole, so its trailing backslash joins nothing.
      expect(read('# trailing backslash \\\na=one\n', 'a')).toBe('one');
    });

    it('treats # and ! after the start of a line as ordinary characters', () => {
      expect(read('a=one#two', 'a')).toBe('one#two');
    });

    it('still starts a comment when a continuation left the logical line empty', () => {
      // JDK 17's LineReader asks `len == 0` per character rather than tracking a
      // one-shot start-of-line flag, so a physical line that is nothing but a
      // continuation backslash leaves the *next* line able to open a comment.
      // All three expectations were read off java.util.Properties.load().
      const bogus = parseJavaProperties(
        'foldAction=ctrl shift Z\n\\\n!angleBisectorAction=ctrl pressed B\n',
      );
      expect([...bogus.keys()]).toEqual(['foldAction']);

      // Worse than a bogus key: the "comment" ends in a backslash, so reading it
      // as data swallows the real binding on the line after it.
      const swallowed = parseJavaProperties(
        '\\\n# a comment ending in a backslash \\\nfoldAction=ctrl shift Z\n',
      );
      expect([...swallowed.keys()]).toEqual(['foldAction']);
      expect(swallowed.get('foldAction')).toEqual({ kind: 'value', value: 'ctrl shift Z' });

      expect([...parseJavaProperties('\\\n#a=one\nb=two\n').keys()]).toEqual(['b']);
    });

    it('keeps # ordinary on a continuation line that carried content over', () => {
      // The mirror case: the buffer is non-empty, so `#` is data, not a comment.
      expect(read('a=b\\\n#c\n', 'a')).toBe('b#c');
    });
  });

  describe('line continuations', () => {
    it('continues a line ending in an odd number of backslashes', () => {
      expect(read('a=one\\\ntwo', 'a')).toBe('onetwo');
      expect(read('a=one\\\\\\\ntwo', 'a')).toBe('one\\two');
    });

    it('does not continue a line ending in an even number of backslashes', () => {
      const entries = parseJavaProperties('a=one\\\\\nb=two\n');
      expect(entries.get('a')).toEqual({ kind: 'value', value: 'one\\' });
      expect(entries.get('b')).toEqual({ kind: 'value', value: 'two' });
    });

    it('strips the leading whitespace of the continuation line', () => {
      expect(read('a=one\\\n     two', 'a')).toBe('onetwo');
    });

    it('continues across CRLF as well as LF', () => {
      expect(read('a=one\\\r\n  two\r\n', 'a')).toBe('onetwo');
    });

    it('continues the key itself, not just the value', () => {
      expect(read('long\\\nKey=one', 'longKey')).toBe('one');
    });

    it('ends the logical line when the continuation line is empty', () => {
      expect(read('a=one\\\n\nb=two\n', 'a')).toBe('one');
      expect(read('a=one\\\n\nb=two\n', 'b')).toBe('two');
    });

    it('drops a dangling continuation backslash at end of input', () => {
      expect(read('a=one\\', 'a')).toBe('one');
    });

    it('stays linear in the number of continuations', () => {
      // A continuation has to un-append the backslash it just buffered. Doing
      // that by copying the line makes the parser quadratic, and the file being
      // parsed is user-supplied: 1.2MB of continuations took 11.5s on the main
      // thread, versus ~35ms linear. The margin here is ~100x, so this fails on
      // a return to copying and not on a slow machine.
      const text = `k=${'a\\\n'.repeat(400_000)}end`;
      const started = Date.now();
      expect(parseJavaProperties(text).get('k')).toEqual({
        kind: 'value',
        value: `${'a'.repeat(400_000)}end`,
      });
      expect(Date.now() - started).toBeLessThan(4000);
    }, 20_000);
  });

  describe('escapes', () => {
    it('decodes the named escapes in a value', () => {
      expect(read('a=x\\ty\\nz\\rw\\fv', 'a')).toBe('x\ty\nz\rw\fv');
    });

    it('decodes an escaped character as itself', () => {
      expect(read('a=\\\\', 'a')).toBe('\\');
      expect(read('a=\\:\\=', 'a')).toBe(':=');
      expect(read('a=\\#\\!', 'a')).toBe('#!');
      expect(read('a=x\\ y', 'a')).toBe('x y');
    });

    it('decodes escapes in the key, including escaped separators', () => {
      expect(read('a\\=b\\:c\\ d=one', 'a=b:c d')).toBe('one');
      expect(read('\\#a=one', '#a')).toBe('one');
    });

    it('decodes an escaped space as a value rather than an empty value', () => {
      // The value is a single space, so this is bound — not the empty variant.
      expect(read('a=\\ ', 'a')).toBe(' ');
    });
  });

  describe('unicode escapes', () => {
    it('decodes \\uXXXX in either case', () => {
      expect(read('a=\\u00E9\\u65E5', 'a')).toBe('\u00e9\u65e5');
      expect(read('a=\\u00e9\\u65e5', 'a')).toBe('\u00e9\u65e5');
    });

    it('decodes \\uXXXX in the key', () => {
      expect(read('\\u65E5=one', '\u65e5')).toBe('one');
    });

    it('joins a surrogate pair written as two escapes', () => {
      expect(read('a=\\uD83D\\uDE00', 'a')).toBe('\u{1f600}');
    });

    it('falls back to the literal character on a malformed escape', () => {
      // Java throws here; one damaged line must not cost the caller the file.
      expect(read('a=\\uZZZZ', 'a')).toBe('uZZZZ');
      expect(read('a=\\u12', 'a')).toBe('u12');
    });
  });

  describe('the bound / empty / absent tri-state', () => {
    it('reports a key with a separator and nothing after it as empty', () => {
      expect(read('a=\n', 'a')).toBe('EMPTY');
      expect(read('a:\n', 'a')).toBe('EMPTY');
    });

    it('reports a key with only whitespace after the separator as empty', () => {
      expect(read('a=   \n', 'a')).toBe('EMPTY');
    });

    it('reports a bare key with no separator at all as empty', () => {
      expect(read('a\n', 'a')).toBe('EMPTY');
    });

    it('reports a key that never appears as absent', () => {
      expect(read('a=one\n', 'b')).toBe('ABSENT');
    });

    it('drops a line with an empty key, where Java would store it under ""', () => {
      // The one deliberate departure from Properties.load(). No Oriedita action
      // is named "", so keeping it would only add a junk row to the preview.
      expect(parseJavaProperties('=one\na=two\n').size).toBe(1);
      expect(parseJavaProperties(':one\n').size).toBe(0);
    });
  });

  describe('line endings and blank lines', () => {
    it('accepts LF, CRLF and a missing final newline', () => {
      const entries = parseJavaProperties('a=one\r\n\r\nb=two\n\n\nc=three');
      expect(entries.get('a')).toEqual({ kind: 'value', value: 'one' });
      expect(entries.get('b')).toEqual({ kind: 'value', value: 'two' });
      expect(entries.get('c')).toEqual({ kind: 'value', value: 'three' });
      expect(entries.size).toBe(3);
    });

    it('returns an empty map for empty or whitespace-only input', () => {
      expect(parseJavaProperties('').size).toBe(0);
      expect(parseJavaProperties('\n  \t\n\r\n').size).toBe(0);
    });
  });

  it('lets the last definition of a key win, as Properties.put does', () => {
    expect(read('a=one\na=two\n', 'a')).toBe('two');
    expect(read('a=one\na=\n', 'a')).toBe('EMPTY');
  });

  it('parses the exact bytes Properties.store() produced', () => {
    // Verbatim from the hotkey.properties inside the real Java-generated
    // sample.oriconfig: an ASCII-only file with a leading timestamp comment, an
    // empty value, and every non-ASCII character escaped.
    const stored = [
      '#Wed Aug 12 10:25:37 PDT 2026',
      'spacedAction=shift ctrl pressed V',
      'colRedAction=shift pressed A',
      'angleBisectorAction=ctrl pressed B',
      'clearedAction=',
      'nonAsciiAction=\\u00E9\\u65E5\\u672C',
      '',
    ].join('\n');

    const entries = parseJavaProperties(stored);
    expect(entries.size).toBe(5);
    expect(entries.get('spacedAction')).toEqual({ kind: 'value', value: 'shift ctrl pressed V' });
    expect(entries.get('colRedAction')).toEqual({ kind: 'value', value: 'shift pressed A' });
    expect(entries.get('angleBisectorAction')).toEqual({ kind: 'value', value: 'ctrl pressed B' });
    // Ambiguous in Oriedita — present and empty, never an unbind.
    expect(entries.get('clearedAction')).toEqual({ kind: 'empty' });
    expect(entries.get('nonAsciiAction')).toEqual({ kind: 'value', value: 'é日本' });
    expect(entries.get('#Wed')).toBeUndefined();
  });
});
