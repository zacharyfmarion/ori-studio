import { describe, expect, it } from 'vitest';
import {
  classifyReservedKey,
  findShortcutConflict,
  findShortcutShadowing,
  formatKeyChord,
  getDefaultShortcutChords,
  getResolvedShortcut,
  getResolvedShortcuts,
  getShortcutRegistryDiagnostics,
  keyChordEquals,
  keyChordId,
  ORIEDITA_ACTION_TARGETS,
  parseOrieditaKeyStroke,
  SHORTCUT_DEFINITIONS,
  shortcutIdForOrieditaAction,
  shortcutLabelForAction,
  type KeyChord,
  type ShortcutActionId,
  type ShortcutOverrides,
  type ShortcutScope,
} from './shortcuts';
import { handleShortcutKeyDown } from './shortcutDispatcher';
import { ORIEDITA_DEFAULT_HOTKEYS } from '../lib/orieditaImport/orieditaDefaultHotkeys.generated';

/**
 * The action a chord actually reaches, asked of the real dispatcher.
 *
 * Classifying a collision is a claim about which binding answers a key, so the
 * claims above are checked against the thing that decides it rather than against
 * the function that describes it.
 */
function dispatched(
  chord: KeyChord,
  scopeStack: ShortcutScope[],
  overrides: ShortcutOverrides = {}
): ShortcutActionId | null {
  let fired: ShortcutActionId | null = null;
  const claim = (id: ShortcutActionId) => {
    fired = id;
  };
  handleShortcutKeyDown(
    new KeyboardEvent('keydown', {
      key: chord.key === 'space' ? ' ' : chord.key,
      shiftKey: Boolean(chord.shift),
      altKey: Boolean(chord.alt),
      ctrlKey: Boolean(chord.primary),
      metaKey: false,
      cancelable: true,
    }),
    {
      scopeStack,
      overrides,
      executors: {
        menu: claim,
        cpAction: claim,
        simulator: claim,
        viewport: (id) => {
          claim(id);
          return true;
        },
      },
    }
  );
  return fired;
}

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

    // Still deliberately unmapped: `exitAction` has no browser meaning, and
    // `gridConfigureAction` is G upstream — the key `foldAction` owns here, so
    // annotating it would take the chord off one of them.
    expect(diagnostics.unmappedOrieditaActions).toContain('exitAction');
    expect(diagnostics.unmappedOrieditaActions).toContain('gridConfigureAction');
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

describe('Oriedita action mapping', () => {
  function upstreamClaims(): Map<string, string[]> {
    const claims = new Map<string, string[]>();
    for (const definition of SHORTCUT_DEFINITIONS) {
      if (!definition.upstreamAction) continue;
      claims.set(definition.upstreamAction, [
        ...(claims.get(definition.upstreamAction) ?? []),
        definition.id,
      ]);
    }
    return claims;
  }

  // The guard the import relies on. Without it a new definition reusing an
  // upstream label would bind whichever of the two `SHORTCUT_DEFINITIONS` lists
  // first — silently, and with no way to tell from the outside which one it was.
  // Equality in both directions, so a stale entry fails as loudly as a new
  // collision.
  it('names a winner for exactly the upstream actions more than one definition claims', () => {
    const duplicates = [...upstreamClaims()]
      .filter(([, ids]) => ids.length > 1)
      .map(([upstreamAction]) => upstreamAction);

    expect(duplicates.sort()).toEqual(Object.keys(ORIEDITA_ACTION_TARGETS).sort());
  });

  it('picks a winner that actually claims the upstream action', () => {
    const claims = upstreamClaims();
    for (const [upstreamAction, winner] of Object.entries(ORIEDITA_ACTION_TARGETS)) {
      expect(claims.get(upstreamAction)).toContain(winner);
    }
  });

  it('resolves upstream actions through the table, then the unique inverse', () => {
    // Table entry: two definitions claim `foldAction`, and folding-estimate is
    // the one carrying G.
    expect(shortcutIdForOrieditaAction('foldAction')).toBe('cp.action.folding-estimate');
    // Unique inverse: one claimant, no table entry needed.
    expect(shortcutIdForOrieditaAction('saveAsAction')).toBe('file.saveAs');
    expect(shortcutIdForOrieditaAction('rotateClockwiseAction')).toBe('viewport.rotateCw');
    // No counterpart at all — the common case, and the one an import must treat
    // as "nothing to bind" rather than as an error.
    expect(shortcutIdForOrieditaAction('exitAction')).toBeNull();
    expect(shortcutIdForOrieditaAction('gridConfigureAction')).toBeNull();
  });

  it('does not resolve inherited object keys', () => {
    // `action` arrives from a parsed hotkey.properties, where `constructor` and
    // `__proto__` are ordinary keys.
    expect(shortcutIdForOrieditaAction('constructor')).toBeNull();
    expect(shortcutIdForOrieditaAction('toString')).toBeNull();
  });
});

describe('Oriedita defaults source', () => {
  function oriedita(id: ShortcutActionId): string[] {
    return getDefaultShortcutChords(id, 'oriedita').map(keyChordId);
  }

  /**
   * Every upstream binding, checked as a set rather than by example.
   *
   * The examples below say the derived table got the keys we thought to name.
   * They cannot say it got *all* of them: a binding that stops being derived —
   * because its action was renamed, hidden, or lost its `upstreamAction` — just
   * disappears, and no hand-written expectation misses it. So each of upstream's
   * 34 is sorted into "carries upstream's chord" or "deliberately dropped", and
   * the dropped list is spelled out with its reason.
   */
  it('gives every upstream binding either its own chord or a named reason', () => {
    // Reasons are the three the derived table recognizes: no Ori Studio verb
    // answers to that action; the verb is hidden or unimplemented, so a chord on
    // it selects a tool the rail cannot show; or it is app chrome, which the
    // swap deliberately leaves on Ori Studio's platform-native keys.
    const dropped: Record<string, string> = {
      // Unmapped.
      gridConfigureAction: 'no counterpart',
      foldedFigureFlipAction: 'no counterpart',
      haltAction: 'no counterpart',
      foldedFigureTrashAction: 'no counterpart',
      exitAction: 'no counterpart',
      pasteOffsetClipboardAction: 'no counterpart',
      // Mapped, but the tool is hidden from the UI.
      continuousSymmetricDrawAction: 'hidden tool',
      foldableLineDrawAction: 'hidden tool',
      // Mapped, but `global` scope — chrome keeps our chords under either source.
      selectAllAction: 'chrome',
      deleteSelectedLineSegmentAction: 'chrome',
      v_del_allAction: 'chrome',
      undoAction: 'chrome',
      redoAction: 'chrome',
      newAction: 'chrome',
      openAction: 'chrome',
      saveAction: 'chrome',
      saveAsAction: 'chrome',
      prefAction: 'chrome',
      copyClipboardAction: 'chrome',
      cutClipboardAction: 'chrome',
      pasteClipboardAction: 'chrome',
    };

    const applied: Record<string, string> = {};
    const missing: string[] = [];
    for (const [action, keyStroke] of Object.entries(ORIEDITA_DEFAULT_HOTKEYS)) {
      if (action in dropped) continue;
      const id = shortcutIdForOrieditaAction(action);
      const chord = id ? parseOrieditaKeyStroke(keyStroke, { ctrlAsPrimary: true }) : null;
      if (!id || !chord) {
        missing.push(action);
        continue;
      }
      applied[action] = oriedita(id).join(' / ');
      if (!oriedita(id).includes(keyChordId(chord))) missing.push(action);
    }

    expect(missing).toEqual([]);
    // Spelled out so a binding that quietly stops being derived shows up as a
    // changed value here rather than as an absence nobody looks for.
    expect(applied).toEqual({
      lengthenCrease2Action: 'e',
      angleBisectorAction: 'b',
      rabbitEarAction: 'primary+b',
      perpendicularDrawAction: 'p',
      symmetricDrawAction: 'r',
      fishBoneDrawAction: 'g',
      doubleSymmetricDrawAction: 'primary+g',
      reflectAction: 'primary+m',
      senbun_henkan2Action: 'c',
      colRedAction: 'm',
      colBlueAction: 'v',
      colBlackAction: 'l',
      foldAction: 'f',
    });
    // And the two lists between them account for all 34.
    expect(Object.keys(applied).length + Object.keys(dropped).length).toBe(
      Object.keys(ORIEDITA_DEFAULT_HOTKEYS).length
    );
  });

  it('puts upstream keys on the actions upstream binds them to', () => {
    expect(oriedita('cp.action.line-type.mountain')).toEqual(['m']);
    expect(oriedita('cp.action.line-type.valley')).toEqual(['v']);
    expect(oriedita('cp.action.line-type.edge')).toEqual(['l']);
    expect(oriedita('cp.action.symmetric-draw')).toEqual(['r']);
    expect(oriedita('cp.action.perpendicular-draw')).toEqual(['p']);
    // `foldAction` is F upstream, and lands on the routed stub the panel turns
    // into the real fold — the one exemption the derived table grants.
    expect(oriedita('cp.action.folding-estimate')).toEqual(['f']);
    // Menu chords do NOT come from that table. The swap covers the drawing
    // surface only, so app chrome keeps Ori Studio's platform-native chords even
    // though upstream binds both of these — see the scope test below.
    expect(oriedita('file.settings')).toEqual(['primary+,']);
    expect(oriedita('file.saveAs')).toEqual(['primary+shift+s']);
    // Unchanged either way: the shipped layout already kept these upstream.
    expect(oriedita('cp.action.lengthen-crease-same-color')).toEqual(['e']);
    expect(oriedita('cp.action.crease-toggle-mv')).toEqual(['c']);
  });

  it('keeps Ori Studio-only tools, except where Oriedita wants the key', () => {
    // Upstream has no opinion about these, so they keep their keys.
    expect(oriedita('cp.action.draw-crease')).toEqual(['z']);
    expect(oriedita('cp.action.draw-crease-restricted')).toEqual(['space']);
    expect(oriedita('cp.action.vertex-make-angularly-flat-foldable')).toEqual(['t']);
    expect(oriedita('cp.action.display-length-between-points1')).toEqual(['shift+m']);
    expect(oriedita('viewport.simulateSelectionInline')).toEqual(['shift+s']);

    // ...and where it does, Oriedita wins and ours is dropped rather than moved.
    // Radial snapping holds R here; upstream gives R to Mirror Line.
    expect(oriedita('cp.action.draw-crease-angle-restricted5')).toEqual([]);
    // Auxiliary holds F here; upstream gives F to Fold.
    expect(oriedita('cp.action.line-type.auxiliary')).toEqual([]);
  });

  it('leaves cross-scope sharing alone', () => {
    // `viewport.delete` shares Delete with `edit.delete` by design: the viewport
    // is asked first and declines when it does not own the press.
    //
    // `edit.delete` keeps BOTH chords: upstream's `deleteSelectedLineSegmentAction`
    // is DELETE alone, and applying that would drop Backspace — the only delete
    // key most Mac laptops have. It is `global` scope, which the swap does not
    // touch.
    expect(oriedita('edit.delete')).toEqual(['delete', 'backspace']);
    expect(oriedita('viewport.delete')).toEqual(['delete', 'backspace']);
    // Escape likewise: upstream's `haltAction` names a different verb, so it maps
    // to nothing and cancel keeps the key.
    expect(oriedita('viewport.cancel')).toEqual(['escape']);
  });

  it('has no duplicate default chords in any scope', () => {
    // The invariant `getShortcutRegistryDiagnostics` enforces on the shipped
    // table. It matters more here: this layout is derived, and the dispatcher
    // takes the first match in a scope, so a duplicate disables a tool silently.
    const buckets = new Map<string, ShortcutActionId[]>();
    for (const definition of SHORTCUT_DEFINITIONS) {
      for (const chord of getDefaultShortcutChords(definition.id, 'oriedita')) {
        const key = `${definition.scope}:${keyChordId(chord)}`;
        buckets.set(key, [...(buckets.get(key) ?? []), definition.id]);
      }
    }

    expect([...buckets].filter(([, ids]) => ids.length > 1)).toEqual([]);
  });

  it('binds no hard-reserved browser chords', () => {
    const reserved = SHORTCUT_DEFINITIONS.flatMap((definition) =>
      getDefaultShortcutChords(definition.id, 'oriedita')
        .filter((chord) => classifyReservedKey(chord) === 'hard-reserved')
        .map((chord) => `${definition.id}=${keyChordId(chord)}`)
    );

    expect(reserved).toEqual([]);
  });

  it('binds no action the UI cannot run', () => {
    // Upstream binds Ctrl+R to Reflect Through Lines, which is hidden here. A
    // chord on a hidden action selects a tool the rail cannot show as active,
    // so the derived table drops it — asked through the mapping so the case
    // cannot go vacuous if the action is renamed.
    const hidden = shortcutIdForOrieditaAction('continuousSymmetricDrawAction');
    expect(hidden).not.toBeNull();
    expect(oriedita(hidden!)).toEqual([]);
  });

  it('resolves overrides against the active source, not the other one', () => {
    const overrides = { 'file.saveAs': [{ key: 'j' }] };

    // A plain override replaces, so both sources agree.
    expect(getResolvedShortcuts('file.saveAs', { overrides })).toEqual([{ key: 'j' }]);
    expect(
      getResolvedShortcuts('file.saveAs', { overrides, defaultsSource: 'oriedita' })
    ).toEqual([{ key: 'j' }]);

    // Undo and Redo merge instead of replacing, and the defaults they merge with
    // have to be the active source's — otherwise the inactive table leaks a
    // chord in. Upstream agrees with us on both, which is the answer to pin.
    expect(
      getResolvedShortcuts('edit.undo', { overrides: { 'edit.undo': null }, defaultsSource: 'oriedita' })
    ).toEqual([{ primary: true, key: 'z' }]);
    expect(oriedita('edit.redo')).toEqual(['primary+shift+z']);
  });

  it('reads shadowing against the active source', () => {
    // M is Mirror Line here and Mountain upstream, so "who else holds M" has a
    // different answer per source. The capture UI asks this before rebinding.
    expect(findShortcutShadowing('file.save', { key: 'm' })?.definition.id).toBe(
      'cp.action.symmetric-draw'
    );
    expect(
      findShortcutShadowing('file.save', { key: 'm' }, { defaultsSource: 'oriedita' })?.definition
        .id
    ).toBe('cp.action.line-type.mountain');
  });
});

describe('findShortcutShadowing', () => {
  it('catches the global shadowing that findShortcutConflict is blind to', () => {
    // The failure an Oriedita import produces in bulk: upstream is single-scope
    // and binds bare letters, so its keymap lands crease-pattern chords on top
    // of menu ones. `crease-pattern` precedes `global` in the scope stack, so a
    // CP tool on Mod+S does not coexist with Save — it replaces it whenever the
    // CP canvas is the editing context.
    expect(findShortcutConflict('cp.action.line-type.mountain', { primary: true, key: 's' }))
      .toBeNull();

    const shadowing = findShortcutShadowing('cp.action.line-type.mountain', {
      primary: true,
      key: 's',
    });
    expect(shadowing?.definition.id).toBe('file.save');
    expect(shadowing?.winnerId).toBe('cp.action.line-type.mountain');
  });

  it('reports the import losing its own chord, not only taking one', () => {
    // Same pair, asked from the other side: a chord proposed for the global menu
    // entry is the one that dies, so the preview has to say something different.
    const shadowing = findShortcutShadowing('file.save', { key: 'a' });
    expect(shadowing?.definition.id).toBe('cp.action.line-type.mountain');
    expect(shadowing?.winnerId).toBe('cp.action.line-type.mountain');
  });

  it('sees the simulator shadowing crease-pattern tools', () => {
    // Deliberate reuse rather than a mistake — the simulator scope is pushed
    // only while a simulation owns the keyboard — but an import that moves a CP
    // tool onto F still needs to hear that the key goes elsewhere while a
    // simulation is focused.
    const shadowing = findShortcutShadowing('cp.action.line-type.auxiliary', { key: 'f' });
    expect(shadowing?.definition.id).toBe('simulator.toggleFaces');
    expect(shadowing?.winnerId).toBe('simulator.toggleFaces');
  });

  it('still catches same-scope duplicates, resolved by registry order', () => {
    const shadowing = findShortcutShadowing('file.open', { primary: true, key: 's' });
    expect(shadowing?.definition.id).toBe('file.save');
    // Both are global, so the dispatcher's `find` decides and `file.open` is
    // listed first.
    expect(shadowing?.winnerId).toBe('file.open');
  });

  it('finds the live registry collision on the extra-vertex sweep', () => {
    // `cp.deleteExtraVertices` and `cp.action.delete-extra-vertices` both carry
    // upstream's `v_del_allAction` and both default to Mod+Shift+V, in different
    // scopes. Harmless today because they run the same sweep, but it is the
    // shape of collision the import has to be able to see.
    const chord = { primary: true, shift: true, key: 'v' };
    expect(findShortcutConflict('cp.deleteExtraVertices', chord)).toBeNull();
    expect(findShortcutShadowing('cp.deleteExtraVertices', chord)).toEqual({
      definition: expect.objectContaining({ id: 'cp.action.delete-extra-vertices' }),
      winnerId: 'cp.action.delete-extra-vertices',
      // Hard: `crease-pattern` is in the stack whenever the CP canvas is the
      // editing context, so the global binding really is unreachable there.
      kind: 'hard',
    });
  });

  it('calls a loss to the simulator conditional, because that scope comes and goes', () => {
    // `simulator` is pushed only while a simulation owns the keyboard, so a CP
    // tool sharing one of its letters is deferred, not dead. The shipped
    // defaults already rely on this — `deg2Action` R and `simulator.replay` r
    // coexist — so a caller that refuses every shadowed chord throws away keys
    // that work fine. The Oriedita import did exactly that and lost F, C, R
    // and L, four of upstream's most-used bindings.
    const shadowing = findShortcutShadowing('cp.action.draw-crease-angle-restricted5', {
      key: 'r',
    });
    expect(shadowing).toMatchObject({
      winnerId: 'simulator.replay',
      kind: 'conditional',
    });
  });

  it('does not call a simulator binding hard-shadowed by a crease-pattern one', () => {
    // The mirror image of the case above, and the one that used to come back
    // `hard`. `simulator` is the *top* of the scope stack, so nothing outside it
    // can take a chord away from a simulator binding: put `simulator.replay` on
    // M and it answers M whenever a simulation is focused, while Mirror Line
    // keeps answering M the rest of the time — the coexistence F, C, R and L
    // already ship. Reading it as hard made the capture UI offer to unbind a
    // Mirror Line that was never in the way.
    const chord = { key: 'm' };
    const shadowing = findShortcutShadowing('simulator.replay', chord);
    expect(shadowing?.definition.id).toBe('cp.action.symmetric-draw');
    expect(shadowing?.winnerId).toBe('simulator.replay');
    expect(shadowing?.kind).toBe('conditional');

    // Both bindings are live, which is what makes `conditional` the true answer:
    // the chord goes to the simulator while a simulation owns the keyboard, and
    // to the tool otherwise.
    const overrides = { 'simulator.replay': [chord] };
    expect(dispatched(chord, ['simulator', 'viewport', 'crease-pattern', 'global'], overrides)).toBe(
      'simulator.replay'
    );
    expect(dispatched(chord, ['viewport', 'crease-pattern', 'global'], overrides)).toBe(
      'cp.action.symmetric-draw'
    );
  });

  it('calls two simulator bindings on one chord a hard collision', () => {
    // Same scope, so the dispatcher's `find` takes exactly one of them and the
    // other key is dead in every stack a simulator binding is ever dispatched
    // from. Nothing outside the simulator scope claims Shift+Right, and reading
    // "no non-simulator claimant" as conditional let the capture UI assign this
    // silently onto a chord that fires the other action.
    const chord = { shift: true, key: 'arrowright' };
    expect(getResolvedShortcuts('simulator.foldEnd')).toEqual([chord]);

    const shadowing = findShortcutShadowing('simulator.foldStart', chord);
    expect(shadowing?.definition.id).toBe('simulator.foldEnd');
    expect(shadowing?.winnerId).toBe('simulator.foldEnd');
    expect(shadowing?.kind).toBe('hard');

    // And the classification is not a guess: the chord really does reach the
    // other action.
    expect(
      dispatched(chord, ['simulator', 'viewport', 'crease-pattern', 'global'], {
        'simulator.foldStart': [chord],
      })
    ).toBe('simulator.foldEnd');
  });

  it('reads the proposed overrides rather than the defaults they replace', () => {
    // An import checks a whole proposed keymap at once, so the chord it must
    // compare against is the one the plan assigns, not the shipped default.
    const overrides = { 'cp.action.line-type.valley': [{ key: 'j' }] };
    expect(findShortcutShadowing('file.save', { key: 'j' }, overrides)?.definition.id).toBe(
      'cp.action.line-type.valley'
    );
    expect(findShortcutShadowing('file.save', { key: 's' }, overrides)).toBeNull();
  });

  it('returns null when nothing else claims the chord', () => {
    expect(findShortcutShadowing('file.save', { primary: true, alt: true, key: 'j' })).toBeNull();
  });
});

describe('the Oriedita layout covers the drawing surface only', () => {
  // Decided deliberately: what a user coming from Oriedita has in their hands is
  // M/V/L, F, R — the tools. Taking over their app chrome as well costs real
  // things for no muscle-memory gain, so `global`, `viewport` and `simulator`
  // keep Ori Studio's chords under either source.
  it('changes crease-pattern defaults and nothing else', () => {
    const changedScopes = new Set(
      SHORTCUT_DEFINITIONS.filter((definition) => {
        const ours = getDefaultShortcutChords(definition.id, 'ori-studio');
        const theirs = getDefaultShortcutChords(definition.id, 'oriedita');
        return JSON.stringify(ours) !== JSON.stringify(theirs);
      }).map((definition) => definition.scope)
    );

    expect([...changedScopes]).toEqual(['crease-pattern']);
  });

  it('keeps the chrome chords upstream would otherwise take', () => {
    // `prefAction` is ctrl shift P upstream, which would move Settings off the
    // macOS-standard Cmd+comma; `deleteSelectedLineSegmentAction` is DELETE
    // alone, which would drop Backspace — the only delete key most Mac laptops
    // have. Both are faithful derivations, and both are wrong to apply.
    for (const id of ['file.settings', 'file.saveAs', 'edit.delete'] as const) {
      expect(getDefaultShortcutChords(id, 'oriedita'), id).toEqual(
        getDefaultShortcutChords(id, 'ori-studio')
      );
    }
  });
});
