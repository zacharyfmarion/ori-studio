import { describe, expect, it } from 'vitest';
import {
  SHORTCUT_DEFINITIONS,
  classifyReservedKey,
  getShortcutRegistryDiagnostics,
  keyChordId,
  shortcutMayDecline,
  type ShortcutDefinition,
} from './shortcuts';
import { ORISTUDIO_CP_ACTIONS, cpHiddenActions } from '../lib/oristudioCpActions';
import { cpVariantHostAction } from '../lib/cpToolVariants';

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

/**
 * CP actions whose chord is legitimately bound even though the action itself is
 * a hidden stub: `handleCpShortcutAction` intercepts them and drives the real
 * fold path (the Fold toolbar button) instead of selecting them as a tool. That
 * is what makes them safe — the chord still lands on something visible.
 */
const ROUTED_CHORD_EXCEPTIONS = new Set(['cp.action.folding-estimate', 'cp.action.fold']);

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
    const actionById = new Map<string, (typeof ORISTUDIO_CP_ACTIONS)[number]>(
      ORISTUDIO_CP_ACTIONS.map((action) => [action.id, action])
    );

    const notReady = boundDefinitions()
      .filter((definition) => definition.scope === 'crease-pattern')
      .filter((definition) => !ROUTED_CHORD_EXCEPTIONS.has(definition.id))
      .filter((definition) => actionById.get(definition.id)?.uiStatus !== 'ready')
      .map((definition) => `${definition.id}=${definition.defaultChords.map(keyChordId).join(',')}`);

    expect(notReady).toEqual([]);
  });

  it('leaves every hidden crease-pattern action unbound, unless it arms a visible one', () => {
    // `handleShortcutKeyDown` dispatches on the registry, not on placement, so a
    // chord on a hidden action still selects it — with no rail button to show it
    // is active. Hiding a tool therefore has to take its chord out of
    // `ORIEDITA_DEFAULTS` too, which is what this catches.
    //
    // The exception is a merged tool's non-host variant. It is hidden because it
    // has no button *of its own*, but `handleCpToolAction` arms its host and sets
    // the mode, so the rail does light up — see `cpVariantHostAction`. That is
    // how E keeps upstream's `lengthenCrease2Action` binding.
    const hiddenIds = new Set<string>(
      cpHiddenActions()
        .filter(
          (action) => action.kind !== 'command' || cpVariantHostAction(action).id === action.id
        )
        .map((action) => action.id)
    );

    const boundButHidden = boundDefinitions()
      .filter((definition) => hiddenIds.has(definition.id))
      .filter((definition) => !ROUTED_CHORD_EXCEPTIONS.has(definition.id))
      .map((definition) => `${definition.id}=${definition.defaultChords.map(keyChordId).join(',')}`);

    expect(boundButHidden).toEqual([]);
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
  // Upstream's own binding, unchanged by the tool merge: naming a variant in a
  // chord arms the merged Extend Line tool *in that variant's mode*, so E still
  // means "extend, keeping each crease's colour".
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
  // The simulator scope is excluded on purpose. It reuses several of these keys
  // -- Space, F, C, R -- and that is the design: it is pushed ahead of
  // `crease-pattern` only while a simulation owns the keyboard, so the same
  // chord reaches the fold then and the CP tool the rest of the time. Asserting
  // global chord uniqueness would forbid exactly what the scope stack exists to
  // allow. The arbitration itself is covered in shortcutDispatcher.test.ts.
  const byChord = new Map<string, string[]>();
  for (const definition of SHORTCUT_DEFINITIONS) {
    if (definition.scope === 'simulator') continue;
    for (const chord of definition.defaultChords) {
      const id = keyChordId(chord);
      byChord.set(id, [...(byChord.get(id) ?? []), definition.id]);
    }
  }

  it('reuses crease-pattern keys in the simulator scope, deliberately', () => {
    const simulatorChords = new Set(
      SHORTCUT_DEFINITIONS.filter((d) => d.scope === 'simulator').flatMap((d) =>
        d.defaultChords.map(keyChordId)
      )
    );
    // If these stop overlapping the layout above, the scope stack has become
    // unnecessary and should be reconsidered rather than left in place.
    expect(simulatorChords.has('space')).toBe(true);
    expect(simulatorChords.has('f')).toBe(true);
    expect(simulatorChords.has('c')).toBe(true);
    expect(simulatorChords.has('r')).toBe(true);
  });

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

  it('marks exactly the viewport verbs whose CP executor can decline', () => {
    // Pinned rather than spot-checked, so widening the set is a deliberate edit
    // with a test to update. The conflict rules read this: a verb in here is
    // transparent when something else wants its chord, and one outside it is an
    // ordinary blocker the user may evict. Membership mirrors the arms of
    // `CreasePatternPanel`'s viewport switch that can answer `false`.
    const declining = SHORTCUT_DEFINITIONS.filter((definition) =>
      shortcutMayDecline(definition.id)
    ).map((definition) => definition.id);
    expect(declining).toEqual([
      'viewport.solveAnglesPrevious',
      'viewport.solveAnglesNext',
      'viewport.solveAnglesApply',
      'viewport.delete',
    ]);
  });

  it('leaves reset-rotation available but unbound by default', () => {
    // Deliberately chordless: the toolbar exposes it, and no key is worth
    // spending on an action reachable from the readout button.
    const reset = SHORTCUT_DEFINITIONS.find((d) => d.id === 'viewport.resetRotation');
    expect(reset).toBeDefined();
    expect(reset!.defaultChords).toEqual([]);
  });
});
