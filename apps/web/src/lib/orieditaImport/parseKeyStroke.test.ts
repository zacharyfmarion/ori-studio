import { describe, expect, it } from 'vitest';
import { keyChordFromKeyboardEvent, keyChordId, type KeyChord } from '../../keyboard/shortcuts';
import { parseOrieditaKeyStrokeStrict, type KeyStrokeRejectReason } from './parseKeyStroke';

function expectChord(value: string): KeyChord {
  const result = parseOrieditaKeyStrokeStrict(value);
  if (!result.ok) {
    throw new Error(`expected ${JSON.stringify(value)} to parse, got ${result.reason}`);
  }
  return result.chord;
}

function expectReason(value: string): KeyStrokeRejectReason {
  const result = parseOrieditaKeyStrokeStrict(value);
  if (result.ok) {
    throw new Error(
      `expected ${JSON.stringify(value)} to be rejected, got ${keyChordId(result.chord)}`,
    );
  }
  return result.reason;
}

/**
 * The only test that matters for "will this binding ever fire": build the chord
 * the dispatcher would derive from a real keydown and compare identities.
 */
function chordIdFromEvent(init: KeyboardEventInit): string {
  const chord = keyChordFromKeyboardEvent(new KeyboardEvent('keydown', init));
  if (!chord) throw new Error(`no chord for ${JSON.stringify(init)}`);
  return keyChordId(chord);
}

describe('parseOrieditaKeyStrokeStrict', () => {
  describe('accepts', () => {
    it('bare letters and digits in both dialects', () => {
      expect(expectChord('pressed A')).toEqual({ key: 'a' });
      expect(expectChord('pressed 7')).toEqual({ key: '7' });
      // The jar's own default table omits `pressed` entirely.
      expect(expectChord('B')).toEqual({ key: 'b' });
      expect(expectChord('DELETE')).toEqual({ key: 'delete' });
      expect(expectChord('ctrl B')).toEqual({ primary: true, key: 'b' });
    });

    it('ctrl and meta alike as primary, never as ctrl or meta', () => {
      // `keyChordFromKeyboardEvent` computes primary = meta||ctrl and then
      // ctrl = ctrlKey && !primary, which is always false — a chord carrying
      // ctrl or meta can never match a keydown.
      expect(expectChord('ctrl pressed X')).toEqual({ primary: true, key: 'x' });
      expect(expectChord('meta pressed X')).toEqual({ primary: true, key: 'x' });
      expect(expectChord('control pressed X')).toEqual({ primary: true, key: 'x' });
    });

    /**
     * FAILING — reports a defect, not a regression.
     *
     * The plan lists `ctrl` + `meta` *together* under "Reject, each with a
     * distinct reason shown in the preview" (oriedita-settings-import.md, the
     * first bullet of that section): "not expressible; both collapse to
     * `primary`". `ctrl` alone and `meta` alone become `primary`; the two held
     * at once is a third, distinct physical chord — Control+Command on macOS —
     * that a `KeyChord` has no way to say.
     *
     * The parser collapses it instead, so `ctrl meta pressed S` and
     * `ctrl pressed S` are indistinguishable, and the import silently binds a
     * chord the user never recorded. There is no `KeyStrokeRejectReason` for it,
     * which is the tell that the rule was never implemented.
     */
    it('rejects ctrl and meta held together, which no KeyChord can express', () => {
      expect(parseOrieditaKeyStrokeStrict('ctrl meta pressed S')).toEqual({
        ok: false,
        reason: 'ctrl-meta-unrepresentable',
      });
      // Either modifier *alone* is still `primary` — the rejection is about the
      // pair being a third chord, not about ctrl or meta being unsupported.
      expect(keyChordId(expectChord('ctrl pressed S'))).toBe('primary+s');
      expect(keyChordId(expectChord('meta pressed S'))).toBe('primary+s');
    });

    it('the canonical modifier order Java emits, not the order a human writes', () => {
      // `ctrl shift V` round-trips through KeyStroke as `shift ctrl pressed V`.
      expect(expectChord('shift ctrl pressed V')).toEqual({
        primary: true,
        shift: true,
        key: 'v',
      });
      // `alt shift ctrl Z` is stored as `shift ctrl alt pressed Z`.
      expect(expectChord('shift ctrl alt pressed Z')).toEqual({
        primary: true,
        alt: true,
        shift: true,
        key: 'z',
      });
      // Token order is not assumed either way, so the human order parses too.
      expect(expectChord('ctrl shift pressed V')).toEqual(expectChord('shift ctrl pressed V'));
    });

    it('shift plus a letter', () => {
      expect(expectChord('shift pressed A')).toEqual({ shift: true, key: 'a' });
    });

    it('the named keys', () => {
      expect(expectChord('pressed DELETE')).toEqual({ key: 'delete' });
      expect(expectChord('pressed ESCAPE')).toEqual({ key: 'escape' });
      expect(expectChord('pressed ENTER')).toEqual({ key: 'enter' });
      expect(expectChord('pressed SPACE')).toEqual({ key: 'space' });
      expect(expectChord('pressed TAB')).toEqual({ key: 'tab' });
      expect(expectChord('pressed BACK_SPACE')).toEqual({ key: 'backspace' });
      expect(expectChord('pressed INSERT')).toEqual({ key: 'insert' });
      expect(expectChord('pressed HOME')).toEqual({ key: 'home' });
      expect(expectChord('pressed END')).toEqual({ key: 'end' });
      expect(expectChord('pressed PAGE_UP')).toEqual({ key: 'pageup' });
      expect(expectChord('pressed PAGE_DOWN')).toEqual({ key: 'pagedown' });
    });

    it('Java arrow names as DOM arrow keys', () => {
      expect(expectChord('pressed LEFT')).toEqual({ key: 'arrowleft' });
      expect(expectChord('pressed RIGHT')).toEqual({ key: 'arrowright' });
      expect(expectChord('pressed UP')).toEqual({ key: 'arrowup' });
      expect(expectChord('pressed DOWN')).toEqual({ key: 'arrowdown' });
    });

    it('F1 through F24', () => {
      expect(expectChord('pressed F1')).toEqual({ key: 'f1' });
      expect(expectChord('pressed F12')).toEqual({ key: 'f12' });
      expect(expectChord('pressed F24')).toEqual({ key: 'f24' });
      expect(expectReason('pressed F25')).toBe('unknown-key-name');
    });

    it('punctuation VK names as their characters', () => {
      expect(expectChord('pressed PERIOD')).toEqual({ key: '.' });
      expect(expectChord('pressed COMMA')).toEqual({ key: ',' });
      expect(expectChord('pressed SLASH')).toEqual({ key: '/' });
      expect(expectChord('pressed SEMICOLON')).toEqual({ key: ';' });
      expect(expectChord('pressed QUOTE')).toEqual({ key: "'" });
      expect(expectChord('pressed BACK_QUOTE')).toEqual({ key: '`' });
      expect(expectChord('pressed MINUS')).toEqual({ key: '-' });
      expect(expectChord('pressed EQUALS')).toEqual({ key: '=' });
      expect(expectChord('pressed OPEN_BRACKET')).toEqual({ key: '[' });
      expect(expectChord('pressed CLOSE_BRACKET')).toEqual({ key: ']' });
      expect(expectChord('pressed BACK_SLASH')).toEqual({ key: '\\' });
    });

    it('shift with a key whose character shift does not change', () => {
      expect(expectChord('shift pressed DELETE')).toEqual({ shift: true, key: 'delete' });
      expect(expectChord('shift pressed LEFT')).toEqual({ shift: true, key: 'arrowleft' });
      expect(expectChord('shift pressed F5')).toEqual({ shift: true, key: 'f5' });
    });

    it('typed with an unmodified ASCII letter or digit', () => {
      expect(expectChord('typed a')).toEqual({ key: 'a' });
      expect(expectChord('typed 4')).toEqual({ key: '4' });
    });

    it('hand-lowercased VK names, since hotkey.properties is hand-editable', () => {
      expect(expectChord('pressed delete')).toEqual({ key: 'delete' });
      expect(expectChord('ctrl pressed b')).toEqual({ primary: true, key: 'b' });
    });
  });

  describe('rejects', () => {
    it('empty and whitespace-only values', () => {
      // Oriedita's Clear button *and* its per-hotkey restore-default both write
      // this, so the caller decides what it means — the parser only names it.
      expect(expectReason('')).toBe('empty');
      expect(expectReason('   ')).toBe('empty');
    });

    it('released keystrokes, because the dispatcher is keydown-only', () => {
      expect(expectReason('released A')).toBe('released-not-supported');
      expect(expectReason('shift ctrl released V')).toBe('released-not-supported');
    });

    it('altGraph', () => {
      expect(expectReason('altGraph pressed P')).toBe('alt-graph-not-supported');
      expect(expectReason('shift altGraph pressed P')).toBe('alt-graph-not-supported');
    });

    it('shift plus a digit or punctuation, which could never fire', () => {
      expect(expectReason('shift pressed 1')).toBe('shift-non-letter-unrepresentable');
      expect(expectReason('shift pressed MINUS')).toBe('shift-non-letter-unrepresentable');
      expect(expectReason('shift pressed SLASH')).toBe('shift-non-letter-unrepresentable');
      expect(expectReason('shift ctrl pressed 9')).toBe('shift-non-letter-unrepresentable');
    });

    it('numpad and other location-specific keys', () => {
      for (const digit of [0, 1, 5, 9]) {
        expect(expectReason(`pressed NUMPAD${digit}`)).toBe('key-location-unrepresentable');
      }
      expect(expectReason('pressed MULTIPLY')).toBe('key-location-unrepresentable');
      expect(expectReason('pressed ADD')).toBe('key-location-unrepresentable');
      // SUBTRACT would land on `-`, which viewport.zoomOut already owns.
      expect(expectReason('pressed SUBTRACT')).toBe('key-location-unrepresentable');
      expect(expectReason('pressed DECIMAL')).toBe('key-location-unrepresentable');
      expect(expectReason('pressed DIVIDE')).toBe('key-location-unrepresentable');
      // The keypad arrows are the same problem wearing a different name: a
      // browser reports plain `ArrowUp` and separates them only by
      // `event.location`. Reporting them as an unknown key would tell the user
      // the wrong thing about a key we understand perfectly well.
      expect(expectReason('pressed KP_UP')).toBe('key-location-unrepresentable');
      expect(expectReason('pressed KP_DOWN')).toBe('key-location-unrepresentable');
      expect(expectReason('pressed KP_LEFT')).toBe('key-location-unrepresentable');
      expect(expectReason('pressed KP_RIGHT')).toBe('key-location-unrepresentable');
      expect(expectReason('pressed SEPARATOR')).toBe('key-location-unrepresentable');
      expect(expectReason('pressed SEPARATER')).toBe('key-location-unrepresentable');
    });

    it('VK names outside the mappable set', () => {
      // Both are real VK constants Java will happily emit.
      expect(expectReason('pressed CONTEXT_MENU')).toBe('unknown-key-name');
      expect(expectReason('pressed AMPERSAND')).toBe('unknown-key-name');
      expect(expectReason('pressed NOT_A_KEY')).toBe('unknown-key-name');
      // An unrecognized leading token lands as the key name.
      expect(expectReason('hyper pressed A')).toBe('unknown-key-name');
      expect(expectReason('pressed A B')).toBe('unknown-key-name');
    });

    it('modifiers with no key, and keys that are themselves modifiers', () => {
      expect(expectReason('ctrl')).toBe('modifier-only');
      expect(expectReason('shift ctrl')).toBe('modifier-only');
      expect(expectReason('shift ctrl pressed')).toBe('modifier-only');
      expect(expectReason('pressed SHIFT')).toBe('modifier-only');
      expect(expectReason('pressed CONTROL')).toBe('modifier-only');
      expect(expectReason('ctrl pressed ALT')).toBe('modifier-only');
      expect(expectReason('pressed META')).toBe('modifier-only');
    });

    it('typed characters with no unambiguous keydown chord', () => {
      // Uppercase names a character, not a key — which physical chord produces
      // it is layout-dependent.
      expect(expectReason('typed A')).toBe('typed-unrepresentable');
      expect(expectReason('typed !')).toBe('typed-unrepresentable');
      expect(expectReason('ctrl typed a')).toBe('typed-unrepresentable');
      expect(expectReason('shift typed a')).toBe('typed-unrepresentable');
      expect(expectReason('typed')).toBe('typed-unrepresentable');
      expect(expectReason('typed ab')).toBe('typed-unrepresentable');
    });

    it('reports the earlier reason when a string has several problems', () => {
      // Event type first, then AltGr, then the key, then shift-representability.
      expect(expectReason('altGraph released NUMPAD0')).toBe('released-not-supported');
      expect(expectReason('shift altGraph pressed 1')).toBe('alt-graph-not-supported');
      expect(expectReason('shift pressed NUMPAD1')).toBe('key-location-unrepresentable');
    });
  });

  describe('agrees with the dispatcher on what a real keydown produces', () => {
    const cases: Array<[string, KeyboardEventInit]> = [
      ['pressed A', { key: 'a' }],
      ['shift pressed A', { key: 'A', shiftKey: true }],
      ['ctrl pressed B', { key: 'b', ctrlKey: true }],
      // Same chord from a Mac Cmd press — both collapse to `primary`.
      ['meta pressed B', { key: 'b', metaKey: true }],
      ['shift ctrl pressed V', { key: 'V', ctrlKey: true, shiftKey: true }],
      ['alt pressed F', { key: 'f', altKey: true }],
      ['pressed DELETE', { key: 'Delete' }],
      ['pressed BACK_SPACE', { key: 'Backspace' }],
      ['pressed ESCAPE', { key: 'Escape' }],
      ['pressed ENTER', { key: 'Enter' }],
      ['pressed TAB', { key: 'Tab' }],
      ['pressed SPACE', { key: ' ' }],
      ['pressed LEFT', { key: 'ArrowLeft' }],
      ['pressed RIGHT', { key: 'ArrowRight' }],
      ['pressed UP', { key: 'ArrowUp' }],
      ['pressed DOWN', { key: 'ArrowDown' }],
      ['pressed PAGE_UP', { key: 'PageUp' }],
      ['pressed PAGE_DOWN', { key: 'PageDown' }],
      ['pressed HOME', { key: 'Home' }],
      ['pressed END', { key: 'End' }],
      ['pressed INSERT', { key: 'Insert' }],
      ['pressed F5', { key: 'F5' }],
      ['pressed 3', { key: '3' }],
      ['pressed PERIOD', { key: '.' }],
      ['pressed COMMA', { key: ',' }],
      ['pressed SLASH', { key: '/' }],
      ['pressed SEMICOLON', { key: ';' }],
      ['pressed QUOTE', { key: "'" }],
      ['pressed BACK_QUOTE', { key: '`' }],
      ['pressed MINUS', { key: '-' }],
      ['pressed EQUALS', { key: '=' }],
      ['pressed OPEN_BRACKET', { key: '[' }],
      ['pressed CLOSE_BRACKET', { key: ']' }],
      ['pressed BACK_SLASH', { key: '\\' }],
      ['typed a', { key: 'a' }],
    ];

    it.each(cases)('%s matches the keydown chord', (keyStroke, init) => {
      expect(keyChordId(expectChord(keyStroke))).toBe(chordIdFromEvent(init));
    });

    it('rejects shift+digit precisely because the two sides disagree', () => {
      // The browser reports `!` for Shift+1, so `{shift, key:'1'}` — which is
      // what a naive mapping of `shift pressed 1` yields — matches nothing.
      expect(chordIdFromEvent({ key: '!', shiftKey: true })).toBe('shift+!');
      expect(expectReason('shift pressed 1')).toBe('shift-non-letter-unrepresentable');
    });
  });
});
