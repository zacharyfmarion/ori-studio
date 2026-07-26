import { describe, expect, it } from 'vitest';
import {
  SHORTCUT_DEFINITIONS,
  classifyReservedKey,
  getShortcutRegistryDiagnostics,
  keyChordId,
  type ShortcutDefinition,
} from './shortcuts';
import { ORISTUDIO_CP_ACTIONS } from '../lib/oristudioCpActions';

/**
 * Registry invariants for the default keybindings.
 *
 * `buildCpShortcutDefinitions` silently drops a duplicate default chord to
 * `null` (first-come wins), so a remap can quietly un-bind a tool. These tests
 * are the guard: they fail loudly instead.
 */

function boundDefinitions(): ShortcutDefinition[] {
  return SHORTCUT_DEFINITIONS.filter((definition) => definition.defaultChords.length > 0);
}

describe('shortcut registry invariants', () => {
  it('has no duplicate default chords within a scope', () => {
    expect(getShortcutRegistryDiagnostics().duplicateDefaultChords).toEqual([]);
  });

  it('binds no hard-reserved browser chords by default', () => {
    const hardReserved = getShortcutRegistryDiagnostics().reservedDefaultChords.filter(
      (entry) => entry.classification === 'hard-reserved'
    );
    expect(hardReserved).toEqual([]);
  });

  it('never assigns a default chord to a bare Ctrl combination', () => {
    // Ctrl is the accel on Windows/Linux, so a bare `ctrl` chord would collide
    // there. Everything must go through `primary` instead. Alt is the
    // designated third modifier.
    const bareCtrl = boundDefinitions().filter((definition) =>
      definition.defaultChords.some((chord) => chord.ctrl)
    );
    expect(bareCtrl.map((definition) => definition.id)).toEqual([]);
  });

  it('only binds crease-pattern defaults to actions the UI can run', () => {
    // Exception: the fold chord resolves to a stub CP command but is routed to
    // the real fold path in CreasePatternPanel (`handleCpShortcutAction`).
    const routedExceptions = new Set(['cp.action.folding-estimate', 'cp.action.fold']);
    const actionById = new Map<string, (typeof ORISTUDIO_CP_ACTIONS)[number]>(
      ORISTUDIO_CP_ACTIONS.map((action) => [action.id, action])
    );

    const notReady = boundDefinitions()
      .filter((definition) => definition.scope === 'crease-pattern')
      .filter((definition) => !routedExceptions.has(definition.id))
      .filter((definition) => actionById.get(definition.id)?.uiStatus !== 'ready')
      .map((definition) => `${definition.id}=${definition.defaultChords.map(keyChordId).join(',')}`);

    expect(notReady).toEqual([]);
  });

  it('classifies every default chord it binds', () => {
    for (const definition of boundDefinitions()) {
      for (const chord of definition.defaultChords) {
        expect(classifyReservedKey(chord)).not.toBe('hard-reserved');
      }
    }
  });
});

/**
 * The adopted single-key layout, pinned key-by-key. `ORIEDITA_DEFAULTS` is
 * matched by `upstreamAction`, so a command whose upstream changes would
 * silently lose its key without this table.
 */
const EXPECTED_SINGLE_KEY_LAYOUT: ReadonlyArray<[chord: string, actionId: string]> = [
  // Tool / mode
  ['q', 'cp.action.crease-select'],
  ['w', 'cp.action.crease-move'],
  ['2', 'cp.action.crease-copy'],
  // Line types (left-hand home row)
  ['a', 'cp.action.line-type.mountain'],
  ['s', 'cp.action.line-type.valley'],
  ['d', 'cp.action.line-type.edge'],
  ['f', 'cp.action.line-type.auxiliary'],
  // Draw / construct
  ['z', 'cp.action.draw-crease'],
  ['space', 'cp.action.draw-crease-restricted'],
  ['m', 'cp.action.symmetric-draw'],
  ['y', 'cp.action.perpendicular-draw'],
  ['b', 'cp.action.square-bisector'],
  ['e', 'cp.action.lengthen-crease-same-color'],
  ['t', 'cp.action.vertex-make-angularly-flat-foldable'],
  ['r', 'cp.action.draw-crease-angle-restricted5'],
  ['h', 'cp.action.fish-bone-draw'],
  // Mountain / valley
  ['c', 'cp.action.crease-toggle-mv'],
  ['x', 'cp.action.crease-make-mv'],
  // Fold
  ['g', 'cp.action.folding-estimate'],
];

describe('adopted single-key layout', () => {
  const byChord = new Map<string, string[]>();
  for (const definition of SHORTCUT_DEFINITIONS) {
    for (const chord of definition.defaultChords) {
      const id = keyChordId(chord);
      byChord.set(id, [...(byChord.get(id) ?? []), definition.id]);
    }
  }

  it.each(EXPECTED_SINGLE_KEY_LAYOUT)('binds %s to %s', (chord, actionId) => {
    expect(byChord.get(chord)).toEqual([actionId]);
  });

  it('binds the view-rotation chords', () => {
    expect(byChord.get('3')).toEqual(['viewport.rotateCcw']);
    expect(byChord.get('4')).toEqual(['viewport.rotateCw']);
  });

  it('keeps the bare zoom chords alongside the accel ones', () => {
    expect(byChord.get('6')).toEqual(['viewport.zoomIn']);
    expect(byChord.get('5')).toEqual(['viewport.zoomOut']);
    expect(byChord.get('primary+=')).toEqual(['viewport.zoomIn']);
    expect(byChord.get('primary+-')).toEqual(['viewport.zoomOut']);
  });

  it('leaves the keys the remap freed unbound', () => {
    // V/L/P/N were pre-adoption line-type and draw keys. M was too, and is now
    // reused for Mirror Line (asserted above).
    for (const freed of ['v', 'l', 'p', 'n']) {
      expect(byChord.get(freed)).toBeUndefined();
    }
  });

  it('leaves reset-rotation available but unbound by default', () => {
    // Deliberately chordless: the toolbar exposes it, and no key is worth
    // spending on an action reachable from the readout button.
    const reset = SHORTCUT_DEFINITIONS.find((d) => d.id === 'viewport.resetRotation');
    expect(reset).toBeDefined();
    expect(reset!.defaultChords).toEqual([]);
  });
});
