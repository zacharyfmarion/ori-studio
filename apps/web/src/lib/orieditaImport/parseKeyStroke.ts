import { normalizeKeyChord, type KeyChord } from '../../keyboard/shortcuts';
import { lookupVkName, VK_KEY_LOCATION_NAMES, VK_MODIFIER_NAMES } from './keyStrokeNames';

/**
 * Strict parser for the `KeyStroke.toString()` strings in an Oriedita
 * `hotkey.properties`.
 *
 * Separate from `parseOrieditaKeyStroke` in `keyboard/shortcuts.ts`, which is
 * deliberately lenient because it only ever reads *our own* hand-written default
 * table — every string there is known-good. An imported file is user data, so
 * every rejection has to be nameable: the import preview shows the user which of
 * their Oriedita hotkeys did not survive and why, and "silently dropped" is the
 * exact failure this feature exists to avoid.
 */
export type KeyStrokeRejectReason =
  /** Blank value — Oriedita's Clear button, or restore-default on an unbound action. */
  | 'empty'
  /** `released X`: our dispatcher only ever sees keydown. */
  | 'released-not-supported'
  /** AltGr is a layout-dependent composition modifier with no `KeyChord` field. */
  | 'alt-graph-not-supported'
  /** Java records the *unshifted* VK; the browser reports the shifted character. */
  | 'shift-non-letter-unrepresentable'
  /** Numpad and friends: `KeyChord` cannot say *which* physical key. */
  | 'key-location-unrepresentable'
  /** A VK name outside the set we can faithfully map. */
  | 'unknown-key-name'
  /** Modifiers with no key, or a key that is itself a modifier. */
  | 'modifier-only'
  /** `typed <char>` whose character has no unambiguous keydown chord. */
  | 'typed-unrepresentable'
  /**
   * `ctrl` and `meta` held at once. Each alone maps to `primary`; together they
   * are a third, distinct physical chord — Control+Command, an everyday macOS
   * combination — that `KeyChord` has no way to say. Collapsing it to `primary`
   * would bind something strictly broader than the user pressed, so it is
   * refused instead. Oriedita really does record these: `getKeyStrokeForEvent`
   * on a physical Ctrl+Cmd+S yields `ctrl meta pressed S`.
   */
  | 'ctrl-meta-unrepresentable';

export type ParsedKeyStroke =
  | { ok: true; chord: KeyChord }
  | { ok: false; reason: KeyStrokeRejectReason };

/**
 * `ctrl` and `meta` get their own slots rather than both writing `primary`, so
 * the two-held-at-once case stays visible. They still *resolve* to `primary` —
 * see {@link parseOrieditaKeyStrokeStrict} for why that is a correctness rule
 * and not a platform convenience — but a parser that merges them on the way in
 * cannot tell Control+S from Control+Command+S afterwards.
 */
type ModifierSlot = 'shift' | 'ctrl' | 'meta' | 'alt' | 'altGraph';

const MODIFIER_TOKENS: ReadonlyMap<string, ModifierSlot> = new Map([
  ['shift', 'shift'],
  ['ctrl', 'ctrl'],
  ['control', 'ctrl'],
  ['meta', 'meta'],
  ['alt', 'alt'],
  ['altgraph', 'altGraph'],
]);

type ActionToken = 'pressed' | 'released' | 'typed';

function actionToken(token: string): ActionToken | null {
  if (token === 'pressed' || token === 'released' || token === 'typed') return token;
  return null;
}

/**
 * Parse one Oriedita keystroke string into a chord our dispatcher can match.
 *
 * Accepts all three dialects seen in the wild, in a token-order-agnostic way:
 * the canonical `KeyStroke.toString()` form (`shift ctrl pressed V` — note Java
 * emits `shift ctrl meta alt altGraph`, *not* the order a human writes), the
 * shorthand the jar's own default table uses (`ctrl B`, `DELETE`), and
 * `typed <char>`.
 *
 * `ctrl` and `meta` both collapse to `primary`, always. This is forced by
 * `keyChordFromKeyboardEvent`, which computes `primary = metaKey || ctrlKey` and
 * then `ctrl: event.ctrlKey && !primary` — always false. A chord carrying `ctrl`
 * or `meta` therefore cannot be produced by any real keydown, so emitting one
 * would mint a permanently dead binding.
 *
 * Rejections are checked in a fixed order — event type, then AltGr, then
 * ctrl+meta, then the key itself, then shift-representability — so a string with
 * several problems always reports the same reason.
 */
export function parseOrieditaKeyStrokeStrict(value: string): ParsedKeyStroke {
  const tokens = value.trim().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) return { ok: false, reason: 'empty' };

  const modifiers: Record<ModifierSlot, boolean> = {
    shift: false,
    ctrl: false,
    meta: false,
    alt: false,
    altGraph: false,
  };
  let action: ActionToken | null = null;
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index].toLowerCase();
    const parsedAction = actionToken(token);
    if (parsedAction) {
      action = parsedAction;
      index += 1;
      break;
    }
    const modifier = MODIFIER_TOKENS.get(token);
    // Not a modifier and not an action token, so the shorthand dialect's key
    // name starts here — `ctrl B` has no `pressed`.
    if (!modifier) break;
    modifiers[modifier] = true;
    index += 1;
  }
  const rest = tokens.slice(index);

  if (action === 'released') return { ok: false, reason: 'released-not-supported' };
  if (modifiers.altGraph) return { ok: false, reason: 'alt-graph-not-supported' };
  // Checked before the key, because the chord is unrepresentable whatever it is.
  if (modifiers.ctrl && modifiers.meta) {
    return { ok: false, reason: 'ctrl-meta-unrepresentable' };
  }
  if (action === 'typed') return parseTypedKeyStroke(rest, modifiers);

  // Trailing junk after the key name means the string is not a keystroke at all;
  // so does an unrecognized modifier token, which lands here as `rest[0]`.
  if (rest.length > 1) return { ok: false, reason: 'unknown-key-name' };
  const name = rest[0];
  if (!name) return { ok: false, reason: 'modifier-only' };

  const upper = name.toUpperCase();
  if (VK_MODIFIER_NAMES.has(upper)) return { ok: false, reason: 'modifier-only' };
  if (VK_KEY_LOCATION_NAMES.has(upper)) {
    return { ok: false, reason: 'key-location-unrepresentable' };
  }

  const vk = lookupVkName(upper);
  if (!vk) return { ok: false, reason: 'unknown-key-name' };

  // Java stores the *unshifted* VK for a shifted press — `Shift+1` is
  // `shift pressed 1` — but our chords compare on `event.key`, which the browser
  // reports as `!`. Shift + letter is safe because `normalizeKey` lowercases, so
  // both sides agree on `{shift, key:'a'}`; shift + digit or punctuation can
  // never fire and must not be imported as a silent dead key.
  if (modifiers.shift && (vk.category === 'digit' || vk.category === 'punctuation')) {
    return { ok: false, reason: 'shift-non-letter-unrepresentable' };
  }

  return { ok: true, chord: toChord(vk.key, modifiers) };
}

/**
 * `typed <char>` names a character, not a key, so the physical chord that
 * produces it depends on the layout. Only unmodified ASCII letters and digits
 * are unambiguous enough to import — for anything else the honest answer is that
 * we do not know which keydown to bind.
 */
function parseTypedKeyStroke(
  rest: string[],
  modifiers: Record<ModifierSlot, boolean>
): ParsedKeyStroke {
  if (rest.length !== 1) return { ok: false, reason: 'typed-unrepresentable' };
  if (modifiers.shift || modifiers.ctrl || modifiers.meta || modifiers.alt) {
    return { ok: false, reason: 'typed-unrepresentable' };
  }
  const char = rest[0];
  if (!/^[a-z0-9]$/u.test(char)) return { ok: false, reason: 'typed-unrepresentable' };
  return { ok: true, chord: toChord(char, modifiers) };
}

function toChord(key: string, modifiers: Record<ModifierSlot, boolean>): KeyChord {
  return normalizeKeyChord({
    key,
    // Either one alone becomes `primary`; both together never reach here.
    primary: modifiers.ctrl || modifiers.meta,
    alt: modifiers.alt,
    shift: modifiers.shift,
  });
}
