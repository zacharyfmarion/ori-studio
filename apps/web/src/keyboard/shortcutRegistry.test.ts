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
