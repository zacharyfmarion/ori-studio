/**
 * A reader for `java.util.Properties.load(InputStream)`, close enough for the
 * `hotkey.properties` inside an Oriedita `.oriconfig` archive.
 *
 * Two behaviours of the Java writer force this to be a real parser rather than a
 * `split('=')`:
 *
 * - `Properties.store()` emits **pure ASCII** and escapes every non-ASCII
 *   character as `\uXXXX` (measured against a real JDK, including CJK input), so
 *   unicode unescaping is required, not optional.
 * - Logical lines may be continued with a trailing backslash, and both key and
 *   value carry backslash escapes — including escaped separators, which is how a
 *   key containing `=` or `:` survives the round trip.
 */

/**
 * The tri-state a caller needs, of which the Map expresses two: a key bound to a
 * value, or a key present with an empty value. The third — absent — is the key
 * simply not being in the Map.
 *
 * Keeping `empty` distinct from absent is the whole point of this type. An empty
 * value in Oriedita is *ambiguous*: both the Clear button and the per-hotkey
 * restore-default button write `""`, and the latter does so for the 198 of 232
 * actions whose jar default is unbound. So an empty value must never be read as
 * "the user unbound this" — it has to reach the caller as its own case.
 */
export type JavaPropertyValue =
  | { readonly kind: 'value'; readonly value: string }
  | { readonly kind: 'empty' };

/** Java treats exactly these three as whitespace when splitting a line. */
function isPropertiesSpace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\f';
}

/**
 * Collapse the input into logical lines, mirroring `Properties$LineReader`:
 * leading whitespace skipped, blank lines and `#`/`!` comment lines dropped, and
 * a line ending in an odd number of backslashes joined to the next with that
 * next line's own leading whitespace stripped.
 *
 * The odd/even backslash count is tracked as a running parity rather than counted
 * at the end of the line, because that is the only way `foo=bar\\` (an escaped
 * backslash, line ends) and `foo=bar\` (a continuation) stay distinguishable.
 */
function readLogicalLines(text: string): string[] {
  const lines: string[] = [];
  // The logical line is accumulated as characters rather than a string, because
  // a continuation has to *remove* the trailing backslash it already appended.
  // Doing that with `buffer.slice(0, -1)` copies the whole line per continuation,
  // which is quadratic: a 1.2MB file of continuations took 11.5s before this.
  let buffer: string[] = [];
  let skipWhitespace = true;
  let isCommentLine = false;
  // A continuation's leading whitespace is skipped, but a bare newline is not —
  // an empty continuation line terminates the logical line instead of extending it.
  let appendedLineBegin = false;
  let precedingBackslash = false;
  // Set after consuming the CR of a CRLF that ended a continued line, so the LF
  // is not mistaken for that empty-continuation-line case.
  let skipLineFeed = false;

  const finishLine = (): void => {
    lines.push(buffer.join(''));
    buffer = [];
    skipWhitespace = true;
    isCommentLine = false;
    appendedLineBegin = false;
    precedingBackslash = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (skipLineFeed) {
      skipLineFeed = false;
      if (char === '\n') continue;
    }

    if (skipWhitespace) {
      if (isPropertiesSpace(char)) continue;
      if (!appendedLineBegin && (char === '\r' || char === '\n')) continue;
      skipWhitespace = false;
      appendedLineBegin = false;
    }

    // A comment opens wherever the *logical* line is still empty, which is the
    // `len == 0` test `Properties$LineReader` makes per character. A one-shot
    // start-of-physical-line flag is not the same thing: a physical line holding
    // nothing but a continuation backslash leaves the logical line empty, so the
    // line after it can still open a comment — and if that comment itself ends in
    // a backslash, reading it as data swallows the binding on the line below.
    if (!isCommentLine && buffer.length === 0 && (char === '#' || char === '!')) {
      isCommentLine = true;
      continue;
    }

    if (char !== '\r' && char !== '\n') {
      // Comment characters are consumed, never buffered, so `buffer.length`
      // above keeps meaning "the logical line is still empty".
      if (!isCommentLine) {
        buffer.push(char);
        precedingBackslash = char === '\\' ? !precedingBackslash : false;
      }
      continue;
    }

    // End of a physical line.
    if (isCommentLine || buffer.length === 0) {
      // A comment is discarded whole, so a trailing backslash in one continues
      // nothing — which is what makes the `#<timestamp>` header always safe.
      buffer = [];
      skipWhitespace = true;
      isCommentLine = false;
      appendedLineBegin = false;
      precedingBackslash = false;
      continue;
    }

    if (precedingBackslash) {
      buffer.pop();
      skipWhitespace = true;
      appendedLineBegin = true;
      precedingBackslash = false;
      if (char === '\r') skipLineFeed = true;
      continue;
    }

    finishLine();
  }

  // An unterminated final line still counts; a dangling continuation backslash at
  // end of input has nothing to join to and is dropped.
  if (buffer.length > 0 && !isCommentLine) {
    if (precedingBackslash) buffer.pop();
    lines.push(buffer.join(''));
  }

  return lines;
}

const HEX_QUAD = /^[0-9a-fA-F]{4}$/;

/**
 * Apply Java's `loadConvert` escapes: the named control escapes, `\uXXXX`, and
 * the catch-all where any other escaped character stands for itself (which is how
 * `\=`, `\:`, `\#`, `\!`, `\ ` and `\\` get through the line splitter above).
 *
 * Java throws on a malformed `\u`. We fall through to the catch-all instead, so
 * one damaged line in an imported file degrades to a binding the caller can
 * reject rather than aborting the whole import.
 */
function unescape(raw: string): string {
  let out = '';
  let index = 0;

  while (index < raw.length) {
    const char = raw[index];
    index += 1;
    if (char !== '\\') {
      out += char;
      continue;
    }
    if (index >= raw.length) break;

    const escaped = raw[index];
    index += 1;
    if (escaped === 'u') {
      const hex = raw.slice(index, index + 4);
      if (HEX_QUAD.test(hex)) {
        // Surrogate pairs arrive as two consecutive escapes and concatenate
        // correctly, since JS strings are UTF-16 like Java's.
        out += String.fromCharCode(Number.parseInt(hex, 16));
        index += 4;
      } else {
        out += escaped;
      }
      continue;
    }
    if (escaped === 't') out += '\t';
    else if (escaped === 'r') out += '\r';
    else if (escaped === 'n') out += '\n';
    else if (escaped === 'f') out += '\f';
    else out += escaped;
  }

  return out;
}

/**
 * Split one logical line into raw key and raw value, mirroring `Properties.load0`.
 *
 * The key runs to the first unescaped `=`, `:` or whitespace; the value then
 * begins at the first non-whitespace character after it, tolerating one separator
 * that the whitespace form hasn't already consumed. That last rule is why
 * `key = value` and `key value` both yield `value`, while `key == value` yields
 * `= value`.
 */
function splitLogicalLine(line: string): { rawKey: string; rawValue: string } {
  let keyEnd = 0;
  let valueStart = line.length;
  let hasSeparator = false;
  let precedingBackslash = false;

  while (keyEnd < line.length) {
    const char = line[keyEnd];
    if (!precedingBackslash && (char === '=' || char === ':')) {
      valueStart = keyEnd + 1;
      hasSeparator = true;
      break;
    }
    if (!precedingBackslash && isPropertiesSpace(char)) {
      valueStart = keyEnd + 1;
      break;
    }
    precedingBackslash = char === '\\' ? !precedingBackslash : false;
    keyEnd += 1;
  }

  while (valueStart < line.length) {
    const char = line[valueStart];
    if (!isPropertiesSpace(char)) {
      if (hasSeparator || (char !== '=' && char !== ':')) break;
      hasSeparator = true;
    }
    valueStart += 1;
  }

  return { rawKey: line.slice(0, keyEnd), rawValue: line.slice(valueStart) };
}

/**
 * Parse the text of a Java `.properties` file.
 *
 * Later definitions of a key win, matching `Properties`' backing `put`. A key
 * written with no separator at all (`fooAction` on its own line) is a key with an
 * empty value in Java, and reads as `empty` here — not as absent.
 *
 * One deliberate departure from `Properties`: a line whose key is empty (`=one`)
 * is dropped rather than stored under `""`. Java keeps it; no Oriedita action is
 * named `""`, so keeping it would only add a junk row to the import preview.
 */
export function parseJavaProperties(text: string): Map<string, JavaPropertyValue> {
  const entries = new Map<string, JavaPropertyValue>();

  for (const line of readLogicalLines(text)) {
    const { rawKey, rawValue } = splitLogicalLine(line);
    const key = unescape(rawKey);
    if (key.length === 0) continue;
    const value = unescape(rawValue);
    entries.set(key, value.length === 0 ? { kind: 'empty' } : { kind: 'value', value });
  }

  return entries;
}
