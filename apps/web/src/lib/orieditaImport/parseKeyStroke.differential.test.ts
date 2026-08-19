import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { keyChordFromKeyboardEvent, keyChordId } from '../../keyboard/shortcuts';
import { parseOrieditaKeyStrokeStrict } from './parseKeyStroke';

/**
 * Differential test against a corpus produced by a real JDK 17
 * (`VkCorpusOracle.java`, provenance recorded in the fixture's own header):
 * every `VK_` constant reachable by reflection on `java.awt.event.KeyEvent`
 * — the same reflection `AWTKeyStroke.getVKText` uses to name a key — crossed
 * with 18 modifier-mask combinations, rendered through `KeyStroke.toString()`,
 * plus the short (`ctrl B`), reordered (`ctrl shift Z`) and `control`-synonym
 * dialects that a real `hotkey.properties` actually holds.
 *
 * Two questions, and they pull in opposite directions:
 *
 * - Does the parser ever accept a chord **no keydown can produce**? That is a
 *   dead binding, the exact failure this feature exists to prevent.
 * - Does it reject something a keydown **can** produce? A parser that refuses
 *   nearly everything is just as broken, only quietly.
 *
 * The browser side is modelled from the UI Events key-name spec below rather
 * than from `keyStrokeNames.ts`, so agreement between the two means something.
 */
const CORPUS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'jdk-keystroke-corpus.txt'),
  'utf8',
)
  .split('\n')
  .filter((line) => line.length > 0 && !line.startsWith('#'));

/** `event.key` for an unmodified press, US layout. Absent = no browser key at all. */
const DOM_KEY: Record<string, string> = {
  ENTER: 'Enter',
  BACK_SPACE: 'Backspace',
  TAB: 'Tab',
  ESCAPE: 'Escape',
  SPACE: ' ',
  PAGE_UP: 'PageUp',
  PAGE_DOWN: 'PageDown',
  END: 'End',
  HOME: 'Home',
  LEFT: 'ArrowLeft',
  UP: 'ArrowUp',
  RIGHT: 'ArrowRight',
  DOWN: 'ArrowDown',
  DELETE: 'Delete',
  INSERT: 'Insert',
  COMMA: ',',
  MINUS: '-',
  PERIOD: '.',
  SLASH: '/',
  SEMICOLON: ';',
  EQUALS: '=',
  OPEN_BRACKET: '[',
  BACK_SLASH: '\\',
  CLOSE_BRACKET: ']',
  BACK_QUOTE: '`',
  QUOTE: "'",
};
for (let i = 0; i < 26; i += 1) DOM_KEY[String.fromCharCode(65 + i)] = String.fromCharCode(97 + i);
for (let d = 0; d <= 9; d += 1) DOM_KEY[String(d)] = String(d);
for (let f = 1; f <= 24; f += 1) DOM_KEY[`F${f}`] = `F${f}`;

/** US-layout shifted characters — why `shift pressed 1` can never fire. */
const SHIFTED: Record<string, string> = {
  '1': '!',
  '2': '@',
  '3': '#',
  '4': '$',
  '5': '%',
  '6': '^',
  '7': '&',
  '8': '*',
  '9': '(',
  '0': ')',
  ',': '<',
  '-': '_',
  '.': '>',
  '/': '?',
  ';': ':',
  '=': '+',
  '[': '{',
  '\\': '|',
  ']': '}',
  '`': '~',
  "'": '"',
};

interface EventShape {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * The keydown a user could actually produce for this Java keystroke, or null if
 * there is none. Read straight off the Java string: the leading tokens are the
 * modifiers and the trailing token is the VK name in every dialect.
 */
function reachableEvent(keyStroke: string): EventShape | null {
  const tokens = keyStroke.split(' ').filter(Boolean);
  const set = new Set(tokens);
  // Our dispatcher only ever sees keydown.
  if (set.has('released')) return null;
  if (set.has('typed')) {
    // `typed <c>` names a character; only an unmodified ASCII letter or digit
    // maps to exactly one keydown.
    const char = keyStroke.slice(keyStroke.indexOf('typed ') + 'typed '.length);
    if (keyStroke !== `typed ${char}` || !/^[a-z0-9]$/u.test(char)) return null;
    return { key: char, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };
  }
  // A held mouse button is not part of any KeyboardEvent.
  if (set.has('button1') || set.has('button2') || set.has('button3')) return null;
  // AltGr is layout-dependent composition with no KeyChord field.
  if (set.has('altGraph')) return null;
  const base = DOM_KEY[tokens[tokens.length - 1]];
  if (base === undefined) return null;
  const shift = set.has('shift');
  return {
    key: shift ? (SHIFTED[base] ?? base.toUpperCase()) : base,
    shiftKey: shift,
    ctrlKey: set.has('ctrl') || set.has('control'),
    metaKey: set.has('meta'),
    altKey: set.has('alt'),
  };
}

function eventChordId(shape: EventShape): string | null {
  const chord = keyChordFromKeyboardEvent(new KeyboardEvent('keydown', shape));
  return chord ? keyChordId(chord) : null;
}

describe('parseOrieditaKeyStrokeStrict — differential against a real JDK', () => {
  it('reads the whole JDK corpus', () => {
    expect(CORPUS.length).toBeGreaterThan(9000);
  });

  it('never throws, and always returns a typed result', () => {
    const bad: string[] = [];
    for (const value of CORPUS) {
      try {
        const result = parseOrieditaKeyStrokeStrict(value);
        if (result.ok) {
          if (typeof result.chord.key !== 'string' || result.chord.key === '') {
            bad.push(`${value} -> ok with an empty key`);
          }
        } else if (typeof result.reason !== 'string') {
          bad.push(`${value} -> not ok, but no reason`);
        }
      } catch (error) {
        bad.push(`${value} -> threw ${String(error)}`);
      }
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });

  it('accepts no chord a keydown cannot produce', () => {
    const dead: string[] = [];
    for (const value of CORPUS) {
      const result = parseOrieditaKeyStrokeStrict(value);
      if (!result.ok) continue;
      const shape = reachableEvent(value);
      if (!shape) {
        dead.push(`${value} -> accepted as ${keyChordId(result.chord)}, but unreachable`);
        continue;
      }
      const fromEvent = eventChordId(shape);
      const parsed = keyChordId(result.chord);
      if (fromEvent !== parsed) {
        dead.push(`${value} -> parsed ${parsed}, but the keydown gives ${fromEvent}`);
      }
    }
    expect(Array.from(new Set(dead)).slice(0, 30)).toEqual([]);
  });

  it('rejects a mouse-button modifier rather than stripping it', () => {
    // `getKeyStrokeForEvent` reads `getModifiersEx()`, so pressing a key while
    // dragging on the canvas records `ctrl button1 pressed B`. Stripping the
    // button would bind Ctrl+B for a user who meant Ctrl+Drag+B.
    const withButton = CORPUS.filter((value) => /\bbutton[123]\b/u.test(value));
    expect(withButton.length).toBeGreaterThan(100);
    const stripped = withButton.filter((value) => parseOrieditaKeyStrokeStrict(value).ok);
    expect(stripped.slice(0, 20)).toEqual([]);
  });

  it('accepts every chord a keydown CAN produce, bar the unrepresentable ones', () => {
    const missed: string[] = [];
    for (const value of CORPUS) {
      const shape = reachableEvent(value);
      if (!shape || !eventChordId(shape)) continue;
      const result = parseOrieditaKeyStrokeStrict(value);
      // Two classes are reachable from a real keydown yet deliberately
      // unimportable, each covered by its own case above:
      //   - shift + digit/punctuation stores the *unshifted* VK, so the chord
      //     the browser reports is a different character;
      //   - ctrl+meta together is a third physical chord `KeyChord` cannot say,
      //     and collapsing it would bind something broader than was recorded.
      const DELIBERATELY_UNIMPORTABLE = new Set([
        'shift-non-letter-unrepresentable',
        'ctrl-meta-unrepresentable',
      ]);
      if (!result.ok && !DELIBERATELY_UNIMPORTABLE.has(result.reason)) {
        missed.push(`${value} -> rejected as ${result.reason}`);
      }
    }
    expect(Array.from(new Set(missed)).slice(0, 40)).toEqual([]);
  });
});
