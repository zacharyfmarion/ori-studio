import { describe, expect, it, vi } from 'vitest';
import { SHORTCUT_DEFINITIONS } from '../../keyboard/shortcuts';
import {
  REFERENCES_SHORTCUT_IDS,
  runReferencesShortcut,
  type ReferencesShortcutActions,
} from './referencesShortcuts';

function mockActions(): ReferencesShortcutActions {
  return {
    nextStep: vi.fn(),
    previousStep: vi.fn(),
    nextCandidate: vi.fn(),
    previousCandidate: vi.fn(),
    recompute: vi.fn(),
    toggleLandmarksFirst: vi.fn(),
    resetView: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    clearTarget: vi.fn(),
    playFold: vi.fn(),
    exportStep: vi.fn(),
    exportAllSteps: vi.fn(),
    exportStepSvg: vi.fn(),
    exportStepPng: vi.fn(),
  };
}

describe('runReferencesShortcut', () => {
  it.each([
    ['references.nextStep', 'nextStep'],
    ['references.previousStep', 'previousStep'],
    ['references.nextCandidate', 'nextCandidate'],
    ['references.previousCandidate', 'previousCandidate'],
    ['references.recompute', 'recompute'],
    ['references.toggleLandmarksFirst', 'toggleLandmarksFirst'],
    ['references.resetView', 'resetView'],
    ['references.zoomIn', 'zoomIn'],
    ['references.zoomOut', 'zoomOut'],
    ['references.clearTarget', 'clearTarget'],
    ['references.playFold', 'playFold'],
    ['references.exportStep', 'exportStep'],
    ['references.exportStepSvg', 'exportStepSvg'],
    ['references.exportStepPng', 'exportStepPng'],
  ] as const)('routes %s to exactly %s', (id, verb) => {
    const actions = mockActions();
    runReferencesShortcut(id, actions);
    for (const [name, fn] of Object.entries(actions)) {
      expect(fn, name).toHaveBeenCalledTimes(name === verb ? 1 : 0);
    }
  });

  it('lists every registered references binding, once', () => {
    // The transport strip and the context menu are built from this list; a
    // binding added to the registry but not here would have a key and no row.
    const registered = SHORTCUT_DEFINITIONS.filter((d) => d.scope === 'references').map(
      (d) => d.id
    );
    expect([...REFERENCES_SHORTCUT_IDS].sort()).toEqual([...registered].sort());
    expect(new Set(REFERENCES_SHORTCUT_IDS).size).toBe(REFERENCES_SHORTCUT_IDS.length);
  });

  it('ships the export verbs unbound: a row and a button, never a key by default', () => {
    for (const id of [
      'references.exportStep',
      'references.exportStepSvg',
      'references.exportStepPng',
    ] as const) {
      const definition = SHORTCUT_DEFINITIONS.find((d) => d.id === id);
      expect(definition?.defaultChord).toBeNull();
      expect(definition?.defaultChords).toEqual([]);
    }
  });

  it('registers each binding under the references scope and target', () => {
    for (const definition of SHORTCUT_DEFINITIONS.filter((d) => d.scope === 'references')) {
      expect(definition.target).toBe('references');
      expect(definition.category).toBe('References');
    }
  });
});
