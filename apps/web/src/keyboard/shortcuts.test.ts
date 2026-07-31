import { describe, expect, it } from 'vitest';
import {
  classifyReservedKey,
  findShortcutConflict,
  formatKeyChord,
  getResolvedShortcut,
  getResolvedShortcuts,
  getShortcutRegistryDiagnostics,
  keyChordEquals,
  parseOrieditaKeyStroke,
  SHORTCUT_DEFINITIONS,
  shortcutLabelForAction,
} from './shortcuts';

describe('shortcut registry', () => {
  it('parses Oriedita keystrokes into normalized chords', () => {
    expect(parseOrieditaKeyStroke('ctrl shift V', { ctrlAsPrimary: true })).toEqual({
      primary: true,
      shift: true,
      key: 'v',
    });
    expect(parseOrieditaKeyStroke('DELETE')).toEqual({ key: 'delete' });
    expect(parseOrieditaKeyStroke('F')).toEqual({ key: 'f' });
  });

  it('formats primary modifiers for each platform', () => {
    const chord = { primary: true, shift: true, key: 's' };

    expect(formatKeyChord(chord, { platform: 'mac' })).toBe('Cmd+Shift+S');
    expect(formatKeyChord(chord, { platform: 'other' })).toBe('Ctrl+Shift+S');
  });

  it('keeps hybrid globals while applying Oriedita scoped CP defaults', () => {
    expect(shortcutLabelForAction('file.saveAs')).toMatch(/Shift\+S$/u);
    // Line types sit on the left-hand home row: A/S/D/F.
    expect(getResolvedShortcut('cp.action.line-type.mountain')).toEqual({
      key: 'a',
    });
    expect(getResolvedShortcut('cp.action.line-type.valley')).toEqual({
      key: 's',
    });
    expect(getResolvedShortcut('cp.action.line-type.edge')).toEqual({
      key: 'd',
    });
    expect(getResolvedShortcut('cp.action.draw-crease')).toEqual({
      key: 'z',
    });
    expect(getResolvedShortcuts('edit.delete')).toEqual([
      { key: 'delete' },
      { key: 'backspace' },
    ]);
    expect(shortcutLabelForAction('edit.delete')).toContain('Delete / Backspace');
  });

  it('binds the fold chord to a single fold action (deduped)', () => {
    // Fold and FoldingEstimate both default to `foldAction` (G); the builder keeps
    // the chord on FoldingEstimate and drops the duplicate on Fold. CreasePatternPanel
    // routes both operationIds to the real fold, so this pins the de-dup it relies on.
    expect(getResolvedShortcut('cp.action.folding-estimate')).toEqual({ key: 'g' });
    expect(getResolvedShortcut('cp.action.fold')).toBeNull();
  });

  it('keeps undo and redo defaults available even when overrides are stale or cleared', () => {
    expect(getResolvedShortcuts('edit.undo', { 'edit.undo': null })).toEqual([
      { primary: true, key: 'z' },
    ]);
    expect(
      getResolvedShortcuts('edit.redo', {
        'edit.redo': [{ primary: true, alt: true, key: 'z' }],
      })
    ).toEqual([
      { primary: true, shift: true, key: 'z' },
      { primary: true, alt: true, key: 'z' },
    ]);
    expect(findShortcutConflict('file.save', { primary: true, key: 'z' }, { 'edit.undo': null })?.id)
      .toBe('edit.undo');
  });

  it('detects conflicts only across overlapping scopes', () => {
    const conflict = findShortcutConflict('file.open', { primary: true, key: 's' });
    expect(conflict?.id).toBe('file.save');

    expect(
      findShortcutConflict('cp.action.line-type.mountain', { primary: true, key: 's' })
    ).toBeNull();
  });

  it('classifies high-risk browser shortcuts', () => {
    expect(classifyReservedKey({ primary: true, key: 'l' })).toBe('hard-reserved');
    expect(classifyReservedKey({ primary: true, key: 'r' })).toBe('soft-reserved');
    expect(classifyReservedKey({ key: 'm' })).toBe('allowed');
  });

  it('normalizes equivalent chords', () => {
    expect(keyChordEquals({ key: 'DELETE' }, { key: 'delete' })).toBe(true);
  });

  it('binds the same-type vertex sweep to the upstream chord, platform-aware', () => {
    expect(getResolvedShortcut('cp.deleteExtraVertices')).toEqual({
      primary: true,
      shift: true,
      key: 'v',
    });
    // `primary` is Cmd on macOS and Ctrl elsewhere; Oriedita's own
    // hotkey.properties says `ctrl shift V` because it is a Java desktop app.
    expect(
      formatKeyChord({ primary: true, shift: true, key: 'v' }, { platform: 'mac' })
    ).toBe('Cmd+Shift+V');
  });

  it('keeps every shortcut id unique', () => {
    const ids = SHORTCUT_DEFINITIONS.map((definition) => definition.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The registry drops a duplicate default chord silently (buildCpShortcutDefinitions
  // keeps the first in ORISTUDIO_CP_ACTIONS order), so a collision would otherwise
  // disable a tool with no test failure. Measure on Shift+M is exactly the case that
  // would have shadowed Mirror Line had it taken the bare key.
  it('has no duplicate default chords in any scope', () => {
    expect(getShortcutRegistryDiagnostics().duplicateDefaultChords).toEqual([]);
  });

  it('lets the viewport share Delete with edit.delete, in its own scope', () => {
    // Deliberately the same chord as `edit.delete`: viewport scope resolves
    // first and declines when nothing in the viewport owns the press, so the
    // key falls through to crease deletion. The two are not a conflict for the
    // same reason a CP tool chord is not one — different, non-overlapping scopes.
    expect(getResolvedShortcuts('viewport.delete')).toEqual([
      { key: 'delete' },
      { key: 'backspace' },
    ]);
    expect(findShortcutConflict('viewport.delete', { key: 'delete' })).toBeNull();
  });

  it('puts inline simulation on Shift+S, clear of Save As', () => {
    // Bare Shift+S, joining the surface's other Shift+<letter> verbs. Save As is
    // Mod+Shift+S — a different chord, but close enough to be worth pinning.
    expect(getResolvedShortcut('viewport.simulateSelectionInline')).toEqual({
      shift: true,
      key: 's',
    });
    expect(getResolvedShortcut('file.saveAs')).toEqual({
      primary: true,
      shift: true,
      key: 's',
    });
  });

  it('keeps the mirror family on M and puts the measure tools on Shift+M / Shift+A', () => {
    expect(getResolvedShortcut('cp.action.symmetric-draw')).toEqual({ key: 'm' });
    expect(getResolvedShortcut('cp.action.draw-crease-symmetric')).toEqual({ primary: true, key: 'm' });
    expect(getResolvedShortcut('cp.action.display-length-between-points1')).toEqual({
      key: 'm',
      shift: true,
    });
    expect(getResolvedShortcut('cp.action.display-angle-between-three-points1')).toEqual({
      key: 'a',
      shift: true,
    });
    // The bare keys they shift stay with their own tools.
    expect(getResolvedShortcut('cp.action.line-type.mountain')).toEqual({ key: 'a' });
    expect(shortcutLabelForAction('cp.action.display-length-between-points1')).toMatch(
      /Shift\+M$/u
    );
    expect(shortcutLabelForAction('cp.action.display-angle-between-three-points1')).toMatch(
      /Shift\+A$/u
    );
  });

  it('reports import diagnostics for follow-up mapping work', () => {
    const diagnostics = getShortcutRegistryDiagnostics();

    expect(diagnostics.unmappedOrieditaActions).toContain('exitAction');
    expect(diagnostics.reservedDefaultChords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionId: 'optimize.scale',
          classification: 'soft-reserved',
        }),
      ])
    );
  });
});
