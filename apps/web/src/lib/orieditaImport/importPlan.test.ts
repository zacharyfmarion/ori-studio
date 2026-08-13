import { describe, expect, it } from 'vitest';
import {
  buildOrieditaImportPlan,
  type OrieditaImportPlan,
  type OrieditaImportRow,
} from './importPlan';
import type { JavaPropertyValue } from './javaProperties';
import {
  SHORTCUT_DEFINITIONS,
  getResolvedShortcuts,
  getShortcutDefinition,
  keyChordEquals,
  keyChordId,
  type KeyChord,
  type ShortcutActionId,
  type ShortcutDefaultsSource,
  type ShortcutOverrides,
  type ShortcutResolution,
  type ShortcutScope,
} from '../../keyboard/shortcuts';

/**
 * `null` stands for a present-but-empty property — the case that must never be
 * read as an unbind. An action simply left out of the object is absent.
 */
function hotkeys(entries: Record<string, string | null>): Map<string, JavaPropertyValue> {
  return new Map(
    Object.entries(entries).map(([action, value]) => [
      action,
      value === null ? { kind: 'empty' } : { kind: 'value', value },
    ])
  );
}

interface PlanOptions {
  readonly currentOverrides?: ShortcutOverrides;
  readonly defaultsSource?: ShortcutDefaultsSource;
  /** Rows the user pressed "Use anyway" on, by target id. */
  readonly allowEvictionFor?: readonly ShortcutActionId[];
}

function plan(
  entries: Record<string, string | null>,
  options: PlanOptions = {}
): OrieditaImportPlan {
  return buildOrieditaImportPlan({
    hotkeys: hotkeys(entries),
    currentOverrides: options.currentOverrides ?? {},
    defaultsSource: options.defaultsSource,
    allowEvictionFor: new Set(options.allowEvictionFor ?? []),
  });
}

function rowFor(built: OrieditaImportPlan, action: string): OrieditaImportRow {
  const row = built.rows.find((candidate) => candidate.orieditaAction === action);
  if (!row) throw new Error(`no row for ${action}`);
  return row;
}

/** Compact row summary, so an expectation reads like the preview would. */
function outcomeOf(built: OrieditaImportPlan, action: string): string {
  const { outcome } = rowFor(built, action);
  return outcome.kind === 'apply' ? `apply:${keyChordId(outcome.chord)}` : `skip:${outcome.reason}`;
}

function overrideEntries(overrides: ShortcutOverrides): Array<[ShortcutActionId, KeyChord[]]> {
  return Object.entries(overrides).flatMap(([id, chords]) =>
    chords ? [[id as ShortcutActionId, chords]] : []
  );
}

/**
 * The definition `handleShortcutKeyDown` actually reaches for a chord — the same
 * "first scope in the stack that claims it, then registry order within that
 * scope" walk `shortcutDispatcher.ts` performs.
 *
 * Spelled out here rather than delegated to `findShortcutShadowing` on purpose.
 * That function is what the plan uses to *decide*, so asking it again could only
 * ever prove the plan agrees with itself — and it did: it reports the single
 * highest-precedence claimant, so a `simulator` binding on top hid the real
 * collision underneath, and an assertion phrased in its terms passed over an
 * applied chord that never fired.
 */
function dispatchWinner(
  stack: readonly ShortcutScope[],
  chord: KeyChord,
  resolution: ShortcutResolution
): ShortcutActionId | null {
  for (const scope of stack) {
    const definition = SHORTCUT_DEFINITIONS.find(
      (candidate) =>
        candidate.scope === scope &&
        getResolvedShortcuts(candidate.id, resolution).some((existing) =>
          keyChordEquals(existing, chord)
        )
    );
    if (definition) return definition.id;
  }
  return null;
}

/**
 * The stack the user is in for all ordinary editing: `shortcutScopeStackForContext`
 * pushes `simulator` only while a simulation owns the keyboard.
 */
const STACK_WITHOUT_SIMULATION: readonly ShortcutScope[] = ['viewport', 'crease-pattern', 'global'];

/**
 * The property the whole shadowing pass exists to guarantee: after applying the
 * plan, every imported chord reaches the action it was imported for.
 *
 * Checked with no simulation focused, which is both the common case and the
 * strict one — a chord the simulator also claims is allowed to defer to it while
 * a simulation is in hand, but it must work the rest of the time. That is
 * exactly the distinction an assertion written in `findShortcutShadowing`'s own
 * terms cannot make.
 */
function expectNoDeadBindings(built: OrieditaImportPlan, options: PlanOptions = {}): void {
  const applied: ShortcutResolution = {
    overrides: { ...(options.currentOverrides ?? {}), ...built.overrides },
    defaultsSource: options.defaultsSource,
  };
  for (const [id, chords] of overrideEntries(built.overrides)) {
    for (const chord of chords) {
      expect(
        dispatchWinner(STACK_WITHOUT_SIMULATION, chord, applied),
        `${id} ${keyChordId(chord)}`
      ).toBe(id);
    }
  }
}

describe('empty values are ambiguous, never an unbind', () => {
  // Oriedita writes `""` from the Clear button *and* from per-hotkey
  // restore-default, which fires for the 198 of 232 actions whose jar default is
  // unbound. Acting on it either way would be a guess.
  it('reports an empty value and changes nothing', () => {
    const built = plan({ colRedAction: null });
    expect(outcomeOf(built, 'colRedAction')).toBe('skip:ambiguous-empty');
    expect(built.overrides).toEqual({});
  });
});

describe('an import carries the archive and nothing else', () => {
  it('produces a row only for the actions the archive names', () => {
    const built = plan({ colRedAction: 'pressed INSERT' });
    expect(built.rows.map((row) => row.orieditaAction)).toEqual(['colRedAction']);
  });

  it('never brings in a binding upstream ships but the archive is silent about', () => {
    // Upstream's own layout is the `oriedita` defaults source now, reachable and
    // reversible from Settings. Smuggling it in through a file picker is the
    // conflation this import was split apart to remove: `foldAction` is bound to
    // F upstream, and an archive that does not mention it must not move Fold.
    const built = plan({ colRedAction: 'pressed INSERT' });
    expect(Object.keys(built.overrides)).toEqual(['cp.action.line-type.mountain']);
  });
});

describe('actions that must never receive a chord', () => {
  it('refuses a not-implemented crease-pattern action', () => {
    // `foldedFigureMoveAction` targets `cp.action.move-calculated-shape`, which
    // is still a stub — the chord would arm a tool that does nothing.
    const built = plan({ foldedFigureMoveAction: 'pressed INSERT' });
    expect(outcomeOf(built, 'foldedFigureMoveAction')).toBe('skip:action-not-bindable');
    expect(built.overrides).toEqual({});
  });

  it('allows a hidden variant that arms a visible tool', () => {
    // `lengthenCrease2Action` targets the non-host half of the merged Extend
    // Line tool: hidden because it has no button of its own, but arming it
    // lights up the host's button.
    expect(outcomeOf(plan({ lengthenCrease2Action: 'pressed INSERT' }), 'lengthenCrease2Action')).toBe(
      'apply:insert'
    );
  });

  it('allows the fold stub the shortcut executor routes to the real fold', () => {
    expect(outcomeOf(plan({ foldAction: 'pressed INSERT' }), 'foldAction')).toBe('apply:insert');
  });

  it('refuses undo and redo, which merge overrides instead of replacing them', () => {
    const built = plan({ undoAction: 'ctrl pressed Y', redoAction: 'ctrl pressed U' });
    expect(outcomeOf(built, 'undoAction')).toBe('skip:action-not-bindable');
    expect(outcomeOf(built, 'redoAction')).toBe('skip:action-not-bindable');
    expect(built.overrides).toEqual({});
  });

  it('keeps undo and redo out of the overrides even when Mod+Z lands elsewhere', () => {
    // A user who moved Undo put Mod+Z on something else — neither that nor their
    // new Undo chord may reach `edit.undo`, whose overrides merge with the
    // defaults instead of replacing them.
    const built = plan({
      colRedAction: 'ctrl pressed Z',
      undoAction: 'ctrl pressed Y',
      redoAction: 'ctrl pressed U',
    });
    expect(outcomeOf(built, 'undoAction')).toBe('skip:action-not-bindable');
    expect(outcomeOf(built, 'redoAction')).toBe('skip:action-not-bindable');
    expect(built.overrides['edit.undo']).toBeUndefined();
    expect(built.overrides['edit.redo']).toBeUndefined();
    // And Mod+Z does not quietly become Mountain either, since Undo answers first.
    expect(outcomeOf(built, 'colRedAction')).toBe('skip:shadowed');
  });

  it('reports an upstream action with no counterpart here', () => {
    const built = plan({ exitAction: 'ctrl pressed Q' });
    const row = rowFor(built, 'exitAction');
    expect(row.outcome).toEqual({ kind: 'skip', reason: 'unmapped-action' });
    expect(row.shortcutId).toBeNull();
    expect(row.label).toBeNull();
    expect(row.scope).toBeNull();
  });
});

describe('chord-level rejections', () => {
  it('names the parser reason for an unparseable keystroke', () => {
    const built = plan({ colRedAction: 'released A' });
    expect(outcomeOf(built, 'colRedAction')).toBe('skip:unparseable');
    expect(rowFor(built, 'colRedAction').detail.rejectReason).toBe('released-not-supported');
  });

  it('treats a whitespace-only value as unparseable rather than empty', () => {
    // `a=\ ` is a bound single space in Java, so it arrives as a value.
    const built = plan({ colRedAction: ' ' });
    expect(outcomeOf(built, 'colRedAction')).toBe('skip:unparseable');
    expect(rowFor(built, 'colRedAction').detail.rejectReason).toBe('empty');
  });

  it('refuses a chord the browser reserves', () => {
    expect(outcomeOf(plan({ colRedAction: 'ctrl pressed W' }), 'colRedAction')).toBe(
      'skip:reserved-chord'
    );
  });

  it('refuses a menu-scope key the native accelerator cannot express', () => {
    // `acceleratorKey` would pass `arrowleft` through verbatim and Tauri would
    // reject the whole menu.
    expect(outcomeOf(plan({ selectAllAction: 'pressed LEFT' }), 'selectAllAction')).toBe(
      'skip:menu-accelerator-unsupported'
    );
  });

  it('accepts the same key on a non-menu target', () => {
    // Same key, different scope: nothing builds an accelerator for a viewport
    // binding, so the restriction must not leak past `global`.
    //
    // Home also happens to be `simulator.resetView`'s chord. That is a
    // *conditional* shadow — the simulator scope is only in the stack while a
    // simulation is focused — so the row applies and carries a double-duty note
    // rather than being dropped. What this case is really pinning is the
    // absence of `menu-accelerator-unsupported`, which is why the assertion
    // names the reason it must not be.
    expect(outcomeOf(plan({ creasePatternZoomInAction: 'pressed HOME' }), 'creasePatternZoomInAction')).toBe(
      'apply:home'
    );
    expect(outcomeOf(plan({ creasePatternZoomInAction: 'pressed INSERT' }), 'creasePatternZoomInAction')).toBe(
      'apply:insert'
    );
  });
});

describe('replacing a multi-chord binding', () => {
  it('records the chords an applied row drops', () => {
    // Oriedita binds one chord per action; `viewport.zoomIn` holds two.
    const built = plan({ creasePatternZoomInAction: 'pressed INSERT' });
    const row = rowFor(built, 'creasePatternZoomInAction');
    expect(row.outcome).toEqual({ kind: 'apply', chord: { key: 'insert' } });
    expect(row.detail.replacedChords.map(keyChordId)).toEqual(['primary+=', '6']);
    expect(built.overrides['viewport.zoomIn']).toEqual([{ key: 'insert' }]);
  });

  it('drops both chords of a menu action for the one Oriedita carries', () => {
    // `edit.delete` answers to Delete *and* Backspace; Oriedita's
    // `deleteSelectedLineSegmentAction` is one keystroke, and an applied row
    // replaces the whole list. Backspace is the one a user would not think to
    // look for, so the preview has to name it.
    const built = plan({ deleteSelectedLineSegmentAction: 'pressed F13' });
    expect(outcomeOf(built, 'deleteSelectedLineSegmentAction')).toBe('apply:f13');
    expect(
      rowFor(built, 'deleteSelectedLineSegmentAction').detail.replacedChords.map(keyChordId)
    ).toEqual(['delete', 'backspace']);
  });

  it('measures the drop against existing overrides, not the defaults', () => {
    const built = plan(
      { creasePatternZoomInAction: 'pressed INSERT' },
      { currentOverrides: { 'viewport.zoomIn': [{ key: '9' }] } }
    );
    expect(rowFor(built, 'creasePatternZoomInAction').detail.replacedChords.map(keyChordId)).toEqual([
      '9',
    ]);
  });
});

/**
 * An import lands on whichever keyboard the user is running, so every question
 * the plan asks — is this taken, does it already match — has to be asked of the
 * active layout rather than of the shipped one.
 */
describe('the active defaults source', () => {
  it('reads an Oriedita key as already matching under the Oriedita layout', () => {
    const built = plan({ colRedAction: 'pressed M' }, { defaultsSource: 'oriedita' });
    expect(outcomeOf(built, 'colRedAction')).toBe('apply:m');
    expect(rowFor(built, 'colRedAction').detail.alreadyMatches).toBe(true);
    // Nothing to write: M is where Mountain already is, so pinning it would make
    // the Shortcuts list read as customized for a key the user never touched.
    expect(built.overrides).toEqual({});
  });

  it('reads the same key as taken under the Ori Studio layout', () => {
    // Brandon's layout gives M to Mirror Line, so the identical archive is a
    // collision here and a no-op there.
    expect(outcomeOf(plan({ colRedAction: 'pressed M' }), 'colRedAction')).toBe('skip:shadowed');
  });
});

describe('shadowing', () => {
  it('skips a crease-pattern chord that would take a menu chord away', () => {
    // The collision `findShortcutConflict` cannot see: `shortcutScopesOverlap`
    // says global and crease-pattern do not overlap, but the scope stack puts
    // crease-pattern first, so Mountain would silently replace Save.
    const built = plan({ colRedAction: 'ctrl pressed S' });
    expect(outcomeOf(built, 'colRedAction')).toBe('skip:shadowed');
    expect(rowFor(built, 'colRedAction').detail.shadowing).toEqual({
      actionId: 'file.save',
      label: 'Save',
      scope: 'global',
      winnerId: 'cp.action.line-type.mountain',
    });
    expect(built.overrides).toEqual({});
  });

  it('applies a menu chord a declining viewport binding only shares', () => {
    // `viewport.delete` holds Delete too and precedes global scope, but it
    // answers `false` when nothing is selected and the chord falls through —
    // the coexistence `edit.delete` has relied on all along. This row used to be
    // skipped on the strength of the very mechanism that makes it safe.
    const built = plan({ deleteSelectedLineSegmentAction: 'pressed DELETE' });
    expect(outcomeOf(built, 'deleteSelectedLineSegmentAction')).toBe('apply:delete');
    expect(built.overrides['edit.delete']).toEqual([{ key: 'delete' }]);
  });

  it('still skips a chord an always-claiming viewport binding owns', () => {
    // The other half of the same distinction, and the bug a user hit: `5` is a
    // default second chord on Zoom Out, which claims it unconditionally, so a
    // crease-pattern tool bound there would simply never fire. Skipped — but now
    // with an offer to displace it, asserted below.
    const built = plan({ makeFlatFoldableAction: 'pressed 5' });
    expect(outcomeOf(built, 'makeFlatFoldableAction')).toBe('skip:shadowed');
    expect(rowFor(built, 'makeFlatFoldableAction').detail.shadowing?.actionId).toBe(
      'viewport.zoomOut'
    );
  });

  it('reports no phantom conflict when two keys are swapped', () => {
    // Mountain and Valley trade A and S. Validating incrementally would see the
    // other still holding its default and reject both.
    const built = plan({ colRedAction: 'pressed S', colBlueAction: 'pressed A' });
    expect(outcomeOf(built, 'colRedAction')).toBe('apply:s');
    expect(outcomeOf(built, 'colBlueAction')).toBe('apply:a');
    expectNoDeadBindings(built);
  });

  it('re-checks survivors after a rejection restores a default chord', () => {
    // Mountain→Mod+S loses to Save. Dropping it puts Mountain back on A, which
    // is exactly where Valley was headed — so a single validation pass would
    // leave Valley bound to a key it can never win.
    const built = plan({ colRedAction: 'ctrl pressed S', colBlueAction: 'pressed A' });
    expect(outcomeOf(built, 'colRedAction')).toBe('skip:shadowed');
    expect(outcomeOf(built, 'colBlueAction')).toBe('skip:shadowed');
    expect(built.overrides).toEqual({});
  });
});

/**
 * A `simulator` claimant is allowed to share a chord, and only a claimant — it
 * must not *hide* one. `findShortcutShadowing` answers with the single
 * highest-precedence other binding, so a simulator hit on top masks everything
 * below it, and everything below it is unconditional.
 *
 * This was not hypothetical: an import of upstream's F for Fold applied it and
 * reported it as sharing the key with `simulator.toggleFaces`, while
 * `cp.action.line-type.auxiliary` still held F and came first in the registry.
 * Fold never fired.
 */
describe('a simulator collision must not hide a real one', () => {
  it('skips F for Fold, which the Auxiliary line type still owns', () => {
    const built = plan({ foldAction: 'pressed F' });
    expect(outcomeOf(built, 'foldAction')).toBe('skip:shadowed');
    expect(rowFor(built, 'foldAction').detail.shadowing?.actionId).toBe(
      'cp.action.line-type.auxiliary'
    );
  });

  it('applies a chord whose claimants above it may all decline', () => {
    // The counterpart to the case above, and the reason "look beneath the
    // simulator claim" is not the same rule as "reject what you find there".
    // Left is claimed by `simulator.foldBackward` *and*
    // `viewport.solveAnglesPrevious`. Viewport does always precede
    // crease-pattern, but that binding answers `false` unless a fold-angle solve
    // is holding answers, so Mountain gets the key the rest of the time — the
    // same deferral the simulator claim above it is already forgiven for.
    const built = plan({ colRedAction: 'pressed LEFT' });
    expect(outcomeOf(built, 'colRedAction')).toBe('apply:arrowleft');
    expect(built.overrides['cp.action.line-type.mountain']).toEqual([{ key: 'arrowleft' }]);
  });

  it('still applies a chord only a simulator binding shares', () => {
    // `simulator.toggleLighting` is L's one other claimant, so Edge on L is the
    // double-duty case the preview is meant to describe rather than refuse.
    const built = plan({ colBlackAction: 'pressed L' });
    expect(outcomeOf(built, 'colBlackAction')).toBe('apply:l');
    expect(rowFor(built, 'colBlackAction').detail.shadowing?.actionId).toBe(
      'simulator.toggleLighting'
    );
    expectNoDeadBindings(built);
  });
});

/**
 * The plan has to be a function of the archive's *contents*. `hotkey.properties`
 * is written by `Properties.store`, whose line order is `Hashtable` iteration
 * order — so the same keymap can arrive in any order at all, and two users with
 * identical hotkeys must get identical plans.
 */
describe('the plan depends on the archive, not on its line order', () => {
  const ENTRIES: Record<string, string | null> = {
    colRedAction: 'ctrl pressed S',
    colBlueAction: 'pressed A',
    colBlackAction: 'pressed S',
    senbun_henkan2Action: null,
    fishBoneDrawAction: 'pressed G',
  };
  const reversed = Object.fromEntries(Object.entries(ENTRIES).reverse());
  const sortedSummary = (built: OrieditaImportPlan): string[] =>
    built.rows.map((row) => `${row.orieditaAction}=${outcomeOf(built, row.orieditaAction)}`).sort();

  it('is deterministic', () => {
    expect(plan(ENTRIES)).toEqual(plan(ENTRIES));
  });

  it('decides the same rows from a reversed file', () => {
    expect(sortedSummary(plan(reversed))).toEqual(sortedSummary(plan(ENTRIES)));
    expect(plan(reversed).overrides).toEqual(plan(ENTRIES).overrides);
  });

  it('re-importing over its own result is a no-op', () => {
    // Someone who imports twice, or re-opens the dialog after applying, must
    // not see the plan fight the overrides it just produced.
    const first = plan(ENTRIES);
    const second = plan(ENTRIES, { currentOverrides: { ...first.overrides } });
    // Stronger than "the same overrides twice": once the first import has
    // landed, every row already matches, so the second contributes *nothing*.
    // That is what makes re-opening the dialog after applying safe.
    expect(second.overrides).toEqual({});
    // The rows are still all there — the user can see each key was accounted
    // for — they have simply moved from "will change" to "already matches".
    expect(sortedSummary(second)).toEqual(sortedSummary(first));
  });
});

/**
 * One archive, exercised end to end. Every row here is a different rule, and the
 * expectations are written as the preview would group them.
 */
const REALISTIC_DELTAS: Record<string, string | null> = {
  colRedAction: 'pressed INSERT',
  senbun_henkan2Action: null,
  undoAction: 'ctrl pressed Y',
  exitAction: 'ctrl pressed Q',
  perpendicularDrawAction: 'released P',
  colBlueAction: 'ctrl pressed W',
  selectAllAction: 'pressed LEFT',
  colBlackAction: 'ctrl pressed S',
  creasePatternZoomInAction: 'shift pressed 1',
  symmetricDrawAction: 'pressed F13',
};

describe('a realistic archive', () => {
  it('decides every row', () => {
    const built = plan(REALISTIC_DELTAS);
    expect(
      built.rows.map((row) => `${row.orieditaAction} -> ${outcomeOf(built, row.orieditaAction)}`)
    ).toEqual([
      'colRedAction -> apply:insert',
      'senbun_henkan2Action -> skip:ambiguous-empty',
      'undoAction -> skip:action-not-bindable',
      'exitAction -> skip:unmapped-action',
      'perpendicularDrawAction -> skip:unparseable',
      'colBlueAction -> skip:reserved-chord',
      'selectAllAction -> skip:menu-accelerator-unsupported',
      'colBlackAction -> skip:shadowed',
      // Java records the unshifted VK, so this can never fire in a browser.
      'creasePatternZoomInAction -> skip:unparseable',
      'symmetricDrawAction -> apply:f13',
    ]);
    expect(built.overrides).toEqual({
      'cp.action.line-type.mountain': [{ key: 'insert' }],
      'cp.action.symmetric-draw': [{ key: 'f13' }],
    });
  });

  it('contains exactly the apply rows that change something', () => {
    const built = plan(REALISTIC_DELTAS);
    // An apply row whose target already resolves to that chord is previewed but
    // not written: an override there would show up in Settings as a customized
    // binding the user never made. See the `alreadyMatches` note in importPlan.
    const changing = built.rows.flatMap((row) =>
      row.outcome.kind === 'apply' && row.shortcutId && !row.detail.alreadyMatches
        ? [row.shortcutId]
        : []
    );
    expect(Object.keys(built.overrides).sort()).toEqual([...new Set(changing)].sort());
    // And nothing written is ever a no-op.
    expect(
      built.rows.some((row) => row.detail.alreadyMatches && row.shortcutId && row.shortcutId in built.overrides)
    ).toBe(false);
  });
});

describe('no plan ever produces a shadowed binding', () => {
  const cases: Array<[name: string, entries: Record<string, string | null>]> = [
    ['a realistic archive', REALISTIC_DELTAS],
    ['a key swap', { colRedAction: 'pressed S', colBlueAction: 'pressed A' }],
    ['two actions claiming one chord', { colRedAction: 'pressed J', colBlueAction: 'pressed J' }],
    [
      'Oriedita line types over ours',
      { colRedAction: 'pressed M', colBlueAction: 'pressed V', colBlackAction: 'pressed L' },
    ],
  ];

  it.each(cases)('%s', (_name, entries) => {
    for (const defaultsSource of ['ori-studio', 'oriedita'] as const) {
      const options: PlanOptions = {
        currentOverrides: { 'cp.action.crease-select': [{ key: '9' }] },
        defaultsSource,
      };
      expectNoDeadBindings(plan(entries, options), options);
    }
  });

  it('leaves a chord two rows both want unbound', () => {
    const built = plan({ colRedAction: 'pressed J', colBlueAction: 'pressed J' });
    expect(built.overrides).toEqual({});
    expect(built.rows.every((row) => row.outcome.kind === 'skip')).toBe(true);
  });
});

/**
 * "Use anyway", per row.
 *
 * The archive here is the measured chain that leaves a migration half-done:
 * radial snapping is an Ori Studio-only tool holding R, so Mirror Line cannot
 * reach R, so it keeps M, so Mountain cannot reach M. Nothing upstream ever
 * moves radial snapping, so without a way to unbind it the import is stuck for
 * good.
 */
const LINE_TYPE_MIGRATION: Record<string, string | null> = {
  colRedAction: 'pressed M',
  colBlueAction: 'pressed V',
  colBlackAction: 'pressed L',
  symmetricDrawAction: 'pressed R',
};

describe('per-row eviction', () => {
  it('offers nothing until a row asks, and unbinds nothing', () => {
    const built = plan(LINE_TYPE_MIGRATION);
    expect(built.evictions).toEqual([]);
    expect(Object.values(built.overrides).some((chords) => chords === null)).toBe(false);
    expect(outcomeOf(built, 'symmetricDrawAction')).toBe('skip:shadowed');
    expect(outcomeOf(built, 'colRedAction')).toBe('skip:shadowed');
  });

  it('names, on the blocked row, what "Use anyway" would cost', () => {
    const offer = rowFor(plan(LINE_TYPE_MIGRATION), 'symmetricDrawAction').detail.evictionOffer;
    expect(offer).toEqual({
      evictedId: 'cp.action.draw-crease-angle-restricted5',
      evictedLabel: getShortcutDefinition('cp.action.draw-crease-angle-restricted5')?.label,
      chord: { key: 'r' },
      takenById: 'cp.action.symmetric-draw',
      takenByLabel: getShortcutDefinition('cp.action.symmetric-draw')?.label,
    });
  });

  it('unwinds the chain from the one row the user approved', () => {
    // Approving Mirror Line frees R, which frees M, which is what lets Mountain
    // through without the user having to answer for it separately.
    const built = plan(LINE_TYPE_MIGRATION, { allowEvictionFor: ['cp.action.symmetric-draw'] });
    expect(outcomeOf(built, 'symmetricDrawAction')).toBe('apply:r');
    expect(outcomeOf(built, 'colRedAction')).toBe('apply:m');
    expect(outcomeOf(built, 'colBlueAction')).toBe('apply:v');
    expect(outcomeOf(built, 'colBlackAction')).toBe('apply:l');
    expectNoDeadBindings(built);
  });

  it('records every removal as an explicit null override', () => {
    const built = plan(LINE_TYPE_MIGRATION, { allowEvictionFor: ['cp.action.symmetric-draw'] });
    expect(built.evictions.map((eviction) => eviction.evictedId)).toEqual([
      'cp.action.draw-crease-angle-restricted5',
    ]);
    for (const eviction of built.evictions) {
      expect(built.overrides[eviction.evictedId]).toBeNull();
    }
  });

  it('leaves a row the user did not approve alone', () => {
    // Approving Mirror Line must not also unbind the flat-foldable tool for the
    // unrelated row that wants T.
    const built = plan(
      { ...LINE_TYPE_MIGRATION, perpendicularDrawAction: 'pressed T' },
      { allowEvictionFor: ['cp.action.symmetric-draw'] }
    );
    expect(outcomeOf(built, 'perpendicularDrawAction')).toBe('skip:shadowed');
    expect(built.evictions.map((eviction) => eviction.evictedId)).toEqual([
      'cp.action.draw-crease-angle-restricted5',
    ]);
    expect(rowFor(built, 'perpendicularDrawAction').detail.evictionOffer?.evictedId).toBe(
      'cp.action.vertex-make-angularly-flat-foldable'
    );
  });
});

describe('an approval that cannot be made to work removes nothing', () => {
  /*
   * The blocker behind the blocker. Rabbit Ear is on Mod+Z by hand, so it — not
   * Undo — is what the plan names for an imported Mountain=Mod+Z, and the row
   * gets an offer. Approving it frees Mod+Z from Rabbit Ear and immediately
   * hands Mountain to Undo, which nothing may unbind.
   *
   * The removal is then worth nothing: Mountain is still skipped, and the only
   * thing the import would have done is take away a binding the user set by
   * hand. "Will be unbound" is the list of what Apply removes, so an entry there
   * that buys nobody a key is a removal the user consented to under a promise
   * that was not kept.
   */
  const OVER_UNDO: ShortcutOverrides = { 'cp.action.inward': [{ key: 'z', primary: true }] };

  it('keeps the offer that cannot be honoured out of the plan', () => {
    const built = plan(
      { colRedAction: 'ctrl pressed Z' },
      { currentOverrides: OVER_UNDO, allowEvictionFor: ['cp.action.line-type.mountain'] }
    );
    expect(outcomeOf(built, 'colRedAction')).toBe('skip:shadowed');
    expect(built.evictions).toEqual([]);
    expect(built.overrides).toEqual({});
  });

  it('names the blocker that actually decided it', () => {
    const built = plan(
      { colRedAction: 'ctrl pressed Z' },
      { currentOverrides: OVER_UNDO, allowEvictionFor: ['cp.action.line-type.mountain'] }
    );
    expect(rowFor(built, 'colRedAction').detail.shadowing?.actionId).toBe('edit.undo');
    // And no second offer, since Undo's `null` would not take either.
    expect(rowFor(built, 'colRedAction').detail.evictionOffer).toBeUndefined();
  });

  it('still unbinds for the approvals that do work', () => {
    // The same archive plus a row whose eviction succeeds: the failed approval
    // must not take the working one down with it, or vice versa.
    const built = plan(
      { colRedAction: 'ctrl pressed Z', symmetricDrawAction: 'pressed R' },
      {
        currentOverrides: OVER_UNDO,
        allowEvictionFor: ['cp.action.line-type.mountain', 'cp.action.symmetric-draw'],
      }
    );
    expect(outcomeOf(built, 'colRedAction')).toBe('skip:shadowed');
    expect(outcomeOf(built, 'symmetricDrawAction')).toBe('apply:r');
    expect(built.evictions.map((eviction) => eviction.evictedId)).toEqual([
      'cp.action.draw-crease-angle-restricted5',
    ]);
    expect(built.overrides['cp.action.inward']).toBeUndefined();
    expectNoDeadBindings(built, { currentOverrides: OVER_UNDO });
  });
});

/**
 * Every removal in the plan is one an approved row actually took the chord from.
 * `evictions` is what the preview lists under "Will be unbound" and what Apply
 * writes as a `null`, so an entry whose taker did not survive is a binding taken
 * away for nobody.
 */
describe('every eviction has a surviving taker', () => {
  const cases: Array<[name: string, entries: Record<string, string | null>, overrides: ShortcutOverrides, allow: ShortcutActionId[]]> = [
    ['the line-type chain', LINE_TYPE_MIGRATION, {}, ['cp.action.symmetric-draw']],
    [
      'a blocker with Undo behind it',
      { colRedAction: 'ctrl pressed Z' },
      { 'cp.action.inward': [{ key: 'z', primary: true }] },
      ['cp.action.line-type.mountain'],
    ],
    [
      'two rows approved for one chord',
      { colRedAction: 'ctrl pressed B', colBlueAction: 'ctrl pressed B' },
      {},
      ['cp.action.line-type.mountain', 'cp.action.line-type.valley'],
    ],
  ];

  it.each(cases)('%s', (_name, entries, currentOverrides, allowEvictionFor) => {
    const built = plan(entries, { currentOverrides, allowEvictionFor });
    const applied = new Set(
      built.rows.flatMap((row) =>
        row.outcome.kind === 'apply' && row.shortcutId ? [row.shortcutId] : []
      )
    );
    for (const eviction of built.evictions) {
      expect(applied, `${eviction.evictedId} gave up a key to nobody`).toContain(
        eviction.takenById
      );
    }
    // And the list is exactly the `null`s Apply writes — no more, nothing stale.
    expect(built.evictions.map((eviction) => eviction.evictedId).sort()).toEqual(
      Object.entries(built.overrides)
        .flatMap(([id, chords]) => (chords === null ? [id] : []))
        .sort()
    );
  });
});

/**
 * Blockers there is no offer to make for. Each is a binding whose `null` either
 * would not take or would break something that works, so a "Use anyway" button
 * on these rows would promise a change that cannot happen — the same dead end
 * the button exists to remove, only louder.
 *
 * Both halves are asserted: no offer *and* no eviction even when the caller asks
 * for one, since the dialog is not the only thing that can call this.
 */
describe('blockers that are never offered', () => {
  const cases: Array<[name: string, entries: Record<string, string | null>, action: string, id: ShortcutActionId]> = [
    // A declining viewport binding is deliberately absent: it no longer blocks a
    // row at all, so there is nothing here to withhold an offer from. That case
    // now lives in `shadowing` above, as an applied row.
    //
    // Undo merges its overrides with the defaults, so the `null` would not take.
    ['undo, which cannot honour a null override', { colRedAction: 'ctrl pressed Z' }, 'colRedAction', 'cp.action.line-type.mountain'],
    // `cp.deleteExtraVertices` and `cp.action.delete-extra-vertices` both carry
    // `v_del_allAction` and run the same sweep.
    ['the same verb under another id', { v_del_allAction: 'ctrl shift pressed V' }, 'v_del_allAction', 'cp.deleteExtraVertices'],
  ];

  it.each(cases)('%s', (_name, entries, action, id) => {
    const built = plan(entries);
    expect(outcomeOf(built, action)).toBe('skip:shadowed');
    expect(rowFor(built, action).detail.evictionOffer).toBeUndefined();

    const forced = plan(entries, { allowEvictionFor: [id] });
    expect(forced.evictions).toEqual([]);
    expect(outcomeOf(forced, action)).toBe('skip:shadowed');
  });
});

describe('an approval buys one removal, and only when that is enough', () => {
  it('withholds the offer when a second always-present claimant sits behind', () => {
    // Mod+B is held by Rabbit Ear (crease-pattern) AND Build Crease Pattern
    // (global). One approval spends itself on the binding it named, so removing
    // Rabbit Ear cannot rescue the row — and an offer that leads nowhere reads
    // as a way through. The row stays skipped with no button.
    const built = plan({ colRedAction: 'ctrl pressed B' });
    expect(built.rows[0].outcome.kind).toBe('skip');
    expect(built.rows[0].detail.evictionOffer).toBeUndefined();
  });

  it('offers, and removes exactly one, when the chord ends uncontested', () => {
    // Oriedita gives R to Mirror Line; only radial snapping holds it here, and
    // simulator.replay is allowed to keep sharing it.
    const offer = plan({ symmetricDrawAction: 'pressed R' }).rows[0].detail.evictionOffer;
    expect(offer?.evictedId).toBe('cp.action.draw-crease-angle-restricted5');

    const approved = plan({ symmetricDrawAction: 'pressed R' }, {
      allowEvictionFor: ['cp.action.symmetric-draw'],
    });
    expect(approved.evictions.map((eviction) => eviction.evictedId)).toEqual([
      'cp.action.draw-crease-angle-restricted5',
    ]);
    expect(approved.rows[0].outcome.kind).toBe('apply');
    expectNoDeadBindings(approved, { allowEvictionFor: ['cp.action.symmetric-draw'] });
  });
});
