import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  buildOrieditaImportPlan,
  type OrieditaImportPlan,
  type OrieditaImportRow,
} from './importPlan';
import { parseJavaProperties, type JavaPropertyValue } from './javaProperties';
import { readOriconfigArchive } from './oriconfigArchive';
import { parseOrieditaKeyStrokeStrict } from './parseKeyStroke';
import {
  getResolvedShortcuts,
  getShortcutDefinition,
  keyChordEquals,
  keyChordId,
  type KeyChord,
  type ShortcutActionId,
  type ShortcutOverrides,
} from '../../keyboard/shortcuts';
import { handleShortcutKeyDown } from '../../keyboard/shortcutDispatcher';
import { shortcutScopeStackForContext } from '../../keyboard/shortcutRuntime';

/**
 * End to end: the bytes of a real Java-written `.oriconfig` all the way to a
 * keydown.
 *
 * Every other test in this directory checks one stage in isolation, and none of
 * them proves the thing the feature exists for — that after the import, pressing
 * the key the preview promised runs the action the preview named. A binding that
 * parses, plans and applies but never fires is exactly the silent dead key the
 * whole design is built around, so it is checked here against the real
 * dispatcher, the real scope stack and the real registry, with nothing of ours
 * mocked.
 */

// `new URL('./x', import.meta.url)` is Vite's asset-URL form and would be
// rewritten to an http URL under vitest, so the fixture path is built by hand.
const FIXTURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
  'sample.oriconfig'
);

type Hotkeys = ReadonlyMap<string, JavaPropertyValue>;

async function readSampleArchiveHotkeys(): Promise<Hotkeys> {
  const bytes = readFileSync(FIXTURE_PATH);
  // The browser hands `readOriconfigArchive` a standalone ArrayBuffer; a small
  // Buffer's own `.buffer` is a shared pool, so copy out at its offsets.
  const isolated = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(isolated).set(bytes);

  const archive = await readOriconfigArchive(isolated);
  if (!archive.ok) throw new Error(`sample.oriconfig did not read: ${archive.reason}`);
  const text = archive.entries.get('hotkey.properties');
  if (text === undefined) throw new Error('sample.oriconfig carried no hotkey.properties');
  return parseJavaProperties(text);
}

/**
 * A second `hotkey.properties`, in the exact shape `Properties.store()` writes
 * (ASCII, `#<timestamp>` header, `KeyStroke.toString()` values, canonical
 * `shift ctrl` modifier order).
 *
 * It exists because the real archive's own deltas all collide with an Ori Studio
 * default and so apply nothing at all, which would leave no firing to check.
 * This one is a user who moved a handful of tools onto keys of their own, which
 * is the ordinary case. It still goes through the real properties parser, so
 * nothing here is a stub.
 */
const CUSTOMIZED_HOTKEY_PROPERTIES = [
  '#Wed Aug 12 10:25:37 PDT 2026',
  'perpendicularDrawAction=alt pressed P',
  'lengthenCrease2Action=shift ctrl pressed E',
  'foldAction=pressed F',
  'colBlueAction=pressed V',
  'senbun_henkan2Action=shift pressed C',
  'saveAction=ctrl pressed S',
  'fishBoneDrawAction=pressed G',
  '',
].join('\n');

/**
 * The `event.key` a browser reports for a chord's normalized key.
 *
 * `normalizeKey` lowercases and renames, so this deliberately goes the other way:
 * a test that fed the chord's own key straight back in would agree with the
 * implementation by construction and prove nothing about a real keypress.
 */
const BROWSER_KEY_NAMES: Readonly<Record<string, string>> = {
  space: ' ',
  escape: 'Escape',
  delete: 'Delete',
  backspace: 'Backspace',
  enter: 'Enter',
  tab: 'Tab',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
};

function browserKeyFor(chord: KeyChord): string {
  const named = BROWSER_KEY_NAMES[chord.key];
  if (named) return named;
  if (/^f\d+$/u.test(chord.key)) return chord.key.toUpperCase();
  // A real keydown reports the shifted character for a letter.
  if (chord.shift && /^[a-z]$/u.test(chord.key)) return chord.key.toUpperCase();
  return chord.key;
}

function keyDownEventFor(chord: KeyChord, platform: 'mac' | 'windows'): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: browserKeyFor(chord),
    ctrlKey: platform === 'windows' ? Boolean(chord.primary) : false,
    metaKey: platform === 'mac' ? Boolean(chord.primary) : false,
    altKey: Boolean(chord.alt),
    shiftKey: Boolean(chord.shift),
    bubbles: true,
    cancelable: true,
  });
}

interface DispatchResult {
  readonly handled: boolean;
  readonly firedId: ShortcutActionId | null;
}

/**
 * Dispatch one chord through the real runtime with the crease-pattern canvas
 * active: the context an Oriedita importer does essentially all their work in,
 * and the only one where the `crease-pattern` scope is live at all. No simulation
 * owns the keyboard, which is the normal state — that is what makes a loss to the
 * `simulator` scope a deferral rather than a death.
 */
function dispatch(
  chord: KeyChord,
  overrides: ShortcutOverrides,
  platform: 'mac' | 'windows' = 'windows'
): DispatchResult {
  let firedId: ShortcutActionId | null = null;
  const record = (id: ShortcutActionId): void => {
    firedId = id;
  };

  const handled = handleShortcutKeyDown(keyDownEventFor(chord, platform), {
    scopeStack: shortcutScopeStackForContext({
      activeEditingContext: 'crease-pattern',
      activeViewportSurface: 'crease-pattern',
      simulatorFocused: false,
    }),
    overrides,
    executors: {
      menu: (id) => record(id),
      cpAction: (id) => record(id),
      viewport: (id) => {
        record(id);
        return true;
      },
    },
  });

  return { handled, firedId };
}

function appliedRows(plan: OrieditaImportPlan): OrieditaImportRow[] {
  return plan.rows.filter((row) => row.outcome.kind === 'apply');
}

function describeRow(row: OrieditaImportRow): string {
  const chord =
    row.outcome.kind === 'apply' ? keyChordId(row.outcome.chord) : `"${row.sourceKeyStroke}"`;
  return `${row.orieditaAction} -> ${String(row.shortcutId)} (${chord})`;
}

/** The chord a skipped row would have pressed, where that is knowable at all. */
function chordForSkippedRow(row: OrieditaImportRow): KeyChord | null {
  if (row.outcome.kind !== 'skip') return null;
  const parsed = parseOrieditaKeyStrokeStrict(row.sourceKeyStroke);
  return parsed.ok ? parsed.chord : null;
}

interface PlanCase {
  readonly name: string;
  readonly hotkeys: () => Hotkeys;
  /**
   * Whether this case must exercise real firing. The real archive applies
   * nothing at all — both of its mapped customizations are dropped as shadowed,
   * even though the dispatcher would hand each of them to the imported action —
   * so that case is checked for the reverse property only.
   */
  readonly expectsApplied: boolean;
}

let sampleHotkeys: Hotkeys;
const customizedHotkeys = parseJavaProperties(CUSTOMIZED_HOTKEY_PROPERTIES);

const CASES: readonly PlanCase[] = [
  { name: 'real archive', hotkeys: () => sampleHotkeys, expectsApplied: false },
  { name: 'customized archive', hotkeys: () => customizedHotkeys, expectsApplied: true },
];

beforeAll(async () => {
  sampleHotkeys = await readSampleArchiveHotkeys();
});

describe.each(CASES)('imported bindings fire — $name', (planCase) => {
  const plan = (): OrieditaImportPlan =>
    buildOrieditaImportPlan({ hotkeys: planCase.hotkeys() });

  it('runs the action the preview named, for every applied row', () => {
    const built = plan();
    const applied = appliedRows(built);
    if (planCase.expectsApplied) expect(applied.length).toBeGreaterThan(0);

    /** Applied, but no scope claims the chord: a dead key. */
    const dead: string[] = [];
    /** Applied, and the chord runs somebody else: worse than dead. */
    const wrong: string[] = [];

    for (const row of applied) {
      if (row.outcome.kind !== 'apply' || !row.shortcutId) continue;
      const result = dispatch(row.outcome.chord, built.overrides);
      if (!result.handled || result.firedId === null) {
        dead.push(describeRow(row));
        continue;
      }
      if (result.firedId !== row.shortcutId) {
        wrong.push(`${describeRow(row)} ran ${String(result.firedId)}`);
      }
    }

    expect({ dead, wrong }).toEqual({ dead: [], wrong: [] });
  });

  it('runs the same actions when primary arrives as the Cmd key', () => {
    const built = plan();
    const mismatched: string[] = [];
    for (const row of appliedRows(built)) {
      if (row.outcome.kind !== 'apply' || !row.shortcutId) continue;
      const result = dispatch(row.outcome.chord, built.overrides, 'mac');
      if (result.firedId !== row.shortcutId) {
        mismatched.push(`${describeRow(row)} ran ${String(result.firedId)}`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it('never quietly hands a skipped row its own action anyway', () => {
    const built = plan();
    const leaked: string[] = [];

    for (const row of built.rows) {
      if (row.outcome.kind !== 'skip' || !row.shortcutId) continue;
      const chord = chordForSkippedRow(row);
      if (!chord) continue;
      // A target that already holds that chord by default is not a leak: nothing
      // was imported, the key simply already did that.
      const held = getResolvedShortcuts(row.shortcutId, built.overrides);
      if (held.some((chordHeld) => keyChordEquals(chordHeld, chord))) continue;
      if (dispatch(chord, built.overrides).firedId === row.shortcutId) {
        leaked.push(`${describeRow(row)} ran anyway`);
      }
    }

    expect(leaked).toEqual([]);
  });

  it('emits one chord per override, against a real definition', () => {
    for (const [id, chords] of Object.entries(plan().overrides)) {
      expect(getShortcutDefinition(id as ShortcutActionId), `unknown action ${id}`).toBeDefined();
      expect(chords, `override for ${id}`).toHaveLength(1);
    }
  });
});
