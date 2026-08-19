/**
 * The `java.awt.event.KeyEvent` VK constant names that appear in an Oriedita
 * `hotkey.properties`, and what each one has to become for our dispatcher.
 *
 * `KeyStroke.toString()` emits VK *constant names*, not localized key text —
 * measured against a real JDK, every probe round-tripping through
 * `KeyStroke.getKeyStroke(String)`. So `ctrl B` is stored as `ctrl pressed B`
 * and the bracket key as `pressed OPEN_BRACKET`.
 *
 * The `key` values below are what `normalizeKey()` in `keyboard/shortcuts.ts`
 * produces for the corresponding browser `event.key` — that is the only thing
 * `keyChordFromKeyboardEvent` compares on, so a mapping that disagrees with it
 * mints a binding no keypress can ever match.
 */

/** Why a key's category matters: see `shift-non-letter-unrepresentable`. */
export type KeyStrokeKeyCategory = 'letter' | 'digit' | 'punctuation' | 'named' | 'function';

export interface KeyStrokeKeyName {
  /** The normalized `event.key` name a real keydown would carry. */
  key: string;
  category: KeyStrokeKeyCategory;
}

function entries(
  category: KeyStrokeKeyCategory,
  table: Record<string, string>,
): Array<[string, KeyStrokeKeyName]> {
  return Object.entries(table).map(([vk, key]) => [vk, { key, category }]);
}

const LETTERS: Record<string, string> = Object.fromEntries(
  Array.from({ length: 26 }, (_, index) => {
    const letter = String.fromCharCode(65 + index);
    return [letter, letter.toLowerCase()];
  }),
);

const DIGITS: Record<string, string> = Object.fromEntries(
  Array.from({ length: 10 }, (_, digit) => [String(digit), String(digit)]),
);

/**
 * F1–F24. Java defines all 24; browsers report `event.key` as `F13`… for the
 * high ones on the keyboards that have them, and `normalizeKey` lowercases.
 */
const FUNCTION_KEYS: Record<string, string> = Object.fromEntries(
  Array.from({ length: 24 }, (_, index) => [`F${index + 1}`, `f${index + 1}`]),
);

const NAMED_KEYS: Record<string, string> = {
  DELETE: 'delete',
  ESCAPE: 'escape',
  ENTER: 'enter',
  // `normalizeKey(' ')` is `'space'`, so the space bar's chord key is 'space'.
  SPACE: 'space',
  TAB: 'tab',
  BACK_SPACE: 'backspace',
  INSERT: 'insert',
  HOME: 'home',
  END: 'end',
  PAGE_UP: 'pageup',
  PAGE_DOWN: 'pagedown',
  // Java's arrows predate the DOM's `Arrow*` names.
  LEFT: 'arrowleft',
  RIGHT: 'arrowright',
  UP: 'arrowup',
  DOWN: 'arrowdown',
};

const PUNCTUATION_KEYS: Record<string, string> = {
  PERIOD: '.',
  COMMA: ',',
  SLASH: '/',
  SEMICOLON: ';',
  QUOTE: "'",
  BACK_QUOTE: '`',
  MINUS: '-',
  EQUALS: '=',
  OPEN_BRACKET: '[',
  CLOSE_BRACKET: ']',
  BACK_SLASH: '\\',
};

const VK_KEY_NAMES: ReadonlyMap<string, KeyStrokeKeyName> = new Map([
  ...entries('letter', LETTERS),
  ...entries('digit', DIGITS),
  ...entries('function', FUNCTION_KEYS),
  ...entries('named', NAMED_KEYS),
  ...entries('punctuation', PUNCTUATION_KEYS),
]);

/**
 * VK names that identify a key by its *location* on the keyboard.
 *
 * `KeyChord` has no location field, so a numpad binding is indistinguishable
 * from the main-row key with the same character — and `SUBTRACT` would land on
 * `-`, which `viewport.zoomOut` already owns. Importing one would either do
 * nothing visible or silently steal an existing chord, so they are rejected
 * with their own reason rather than mapped.
 */
export const VK_KEY_LOCATION_NAMES: ReadonlySet<string> = new Set([
  ...Array.from({ length: 10 }, (_, digit) => `NUMPAD${digit}`),
  'MULTIPLY',
  'ADD',
  'SUBTRACT',
  'DECIMAL',
  'DIVIDE',
  // The keypad's own arrow keys. A browser reports plain `ArrowUp` for these
  // and distinguishes them only by `event.location`, which `KeyChord` has no
  // field for — the same reason NUMPAD0–9 are here.
  'KP_UP',
  'KP_DOWN',
  'KP_LEFT',
  'KP_RIGHT',
  // The keypad separator. `SEPARATER` is the deprecated misspelling that shares
  // its key code, and `getVKText` resolves the code by reflection, so either
  // spelling can come back.
  'SEPARATOR',
  'SEPARATER',
]);

/**
 * VK names for the modifier keys themselves. Oriedita's capture dialog cannot
 * produce these, but a hand-edited properties file can, and a chord whose key
 * *is* a modifier can never fire: `keyChordFromKeyboardEvent` drops any event
 * whose normalized key is a modifier name.
 */
export const VK_MODIFIER_NAMES: ReadonlySet<string> = new Set([
  'SHIFT',
  'CONTROL',
  'ALT',
  'META',
  'ALT_GRAPH',
]);

/**
 * Look a VK constant name up. Matching is case-insensitive even though Java's
 * own `getKeyStroke` is not: `hotkey.properties` is a plain text file a user may
 * have edited by hand, and lower-cased `pressed delete` means exactly one thing.
 */
export function lookupVkName(name: string): KeyStrokeKeyName | undefined {
  return VK_KEY_NAMES.get(name.toUpperCase());
}
