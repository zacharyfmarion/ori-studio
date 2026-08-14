import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type {
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureStatus,
} from '../../engine/oristudioCpTypes';
import {
  buildFoldedFigureActions,
  foldedFigureFlipState,
  isFoldedFigureReady,
  type FoldedFigureActionDeps,
  type FoldedFigureChoice,
  type FoldedFigureCommand,
} from './foldedFigureActions';

// The builder only ever calls t(key, defaultValue); return the default so the
// assertions read as the English UI.
const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

function makeFigure(
  overrides: Partial<OristudioCpFoldedFigureEntry> = {}
): OristudioCpFoldedFigureEntry {
  const status: OristudioCpFoldedFigureStatus = 'ready';
  return {
    id: 'folded-1',
    title: 'Folded model 1',
    handle: 3,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status,
    snapshot: {
      model: { state: 'Front0' },
      find_another_overlap_valid: true,
      discovered_fold_cases: 3,
      current_fold_case: 3,
    },
    renderSnapshot: {},
    placement: { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 },
    error: null,
    ...overrides,
  } as unknown as OristudioCpFoldedFigureEntry;
}

const IDENTITY_ORIENT = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;

/** A 3D figure, optionally carrying a model up the user has set. */
function make3dFigure(orient?: typeof IDENTITY_ORIENT): OristudioCpFoldedFigureEntry {
  return makeFigure({
    folded3d: { model: { state: 'Front0' }, verdict: { verdict: 'folded' } },
    camera: orient ? { yaw: 0, pitch: 0, zoom: 1, orient } : { yaw: 0, pitch: 0, zoom: 1 },
  } as unknown as Partial<OristudioCpFoldedFigureEntry>);
}

function makeDeps(overrides: Partial<FoldedFigureActionDeps> = {}): FoldedFigureActionDeps {
  return {
    t,
    flip: vi.fn(),
    resetView: vi.fn(),
    setUpright: vi.fn(),
    clearUpright: vi.fn(),
    setDisplayStyle: vi.fn(),
    foldAnother: vi.fn(),
    duplicate: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  };
}

function commandIds(figure: OristudioCpFoldedFigureEntry, deps: FoldedFigureActionDeps) {
  return buildFoldedFigureActions(figure, deps)
    .filter((action): action is FoldedFigureCommand => action.kind === 'command')
    .map((action) => action.id);
}

function command(
  figure: OristudioCpFoldedFigureEntry,
  deps: FoldedFigureActionDeps,
  id: FoldedFigureCommand['id']
): FoldedFigureCommand {
  const found = buildFoldedFigureActions(figure, deps).find(
    (action): action is FoldedFigureCommand => action.kind === 'command' && action.id === id
  );
  if (!found) throw new Error(`no ${id} command`);
  return found;
}

function choice(
  figure: OristudioCpFoldedFigureEntry,
  deps: FoldedFigureActionDeps,
  id: FoldedFigureChoice['id'] = 'display-style'
): FoldedFigureChoice {
  const found = buildFoldedFigureActions(figure, deps).find(
    (action): action is FoldedFigureChoice => action.kind === 'choice' && action.id === id
  );
  if (!found) throw new Error(`no ${id} choice`);
  return found;
}

function choiceIds(figure: OristudioCpFoldedFigureEntry, deps: FoldedFigureActionDeps) {
  return buildFoldedFigureActions(figure, deps)
    .filter((action): action is FoldedFigureChoice => action.kind === 'choice')
    .map((action) => action.id);
}

describe('buildFoldedFigureActions', () => {
  it('orders verbs frequency-first with delete last', () => {
    expect(commandIds(makeFigure(), makeDeps())).toEqual([
      'flip',
      'another',
      'duplicate',
      'delete',
    ]);
  });

  it('puts the display-style choice directly after flip', () => {
    const actions = buildFoldedFigureActions(makeFigure(), makeDeps());
    expect(actions[0]).toMatchObject({ kind: 'command', id: 'flip' });
    expect(actions[1]).toMatchObject({ kind: 'choice', id: 'display-style' });
  });

  it('separates the appearance, solution and manage groups', () => {
    const kinds = buildFoldedFigureActions(makeFigure(), makeDeps()).map((a) => a.kind);
    expect(kinds.filter((kind) => kind === 'separator')).toHaveLength(2);
  });

  it('disables kernel-backed verbs until the figure is ready', () => {
    const deps = makeDeps();
    const loading = makeFigure({ status: 'loading', snapshot: null });
    expect(command(loading, deps, 'flip').disabled).toBe(true);
    expect(command(loading, deps, 'another').disabled).toBe(true);
    expect(choice(loading, deps).disabled).toBe(true);
    // Delete always works: a figure you cannot fold is one you most want gone.
    expect(command(loading, deps, 'delete').disabled).toBe(false);
  });

  // At the end of the enumeration the kernel restarts rather than dead-ending,
  // so the button keeps working and says so.
  it('offers a wrap back to the first solution at the end of the enumeration', () => {
    const figure = makeFigure({
      snapshot: {
        model: { state: 'Front0' },
        find_another_overlap_valid: false,
        discovered_fold_cases: 8,
      },
    } as unknown as Partial<OristudioCpFoldedFigureEntry>);
    const action = command(figure, makeDeps(), 'another');
    expect(action.disabled).toBe(false);
    expect(action.label).toBe('Back to first solution');
    expect(action.icon).toBe('first-solution');
  });

  it('reads as a forward step while solutions remain', () => {
    const action = command(makeFigure(), makeDeps(), 'another');
    expect(action.label).toBe('Another solution');
    expect(action.icon).toBe('another');
  });

  // Wrapping a single-solution fold would land exactly where it started, and
  // costs a re-fold to get there.
  it('disables Another solution when the fold has only one solution', () => {
    const figure = makeFigure({
      snapshot: {
        model: { state: 'Front0' },
        find_another_overlap_valid: false,
        discovered_fold_cases: 1,
      },
    } as unknown as Partial<OristudioCpFoldedFigureEntry>);
    expect(command(figure, makeDeps(), 'another').disabled).toBe(true);
  });

  it('disables Duplicate without a kernel handle', () => {
    const figure = makeFigure({ handle: null });
    expect(command(figure, makeDeps(), 'duplicate').disabled).toBe(true);
  });

  // Exclusive even when nothing is checked: the figure's current style can be a
  // value the quick list does not offer, and a check column that vanished in
  // that case would shift every label sideways.
  it('marks display style as an exclusive set regardless of the current value', () => {
    expect(choice(makeFigure({ displayStyle: 'Wire2' }), makeDeps()).exclusive).toBe(true);
    const offList = choice(makeFigure({ displayStyle: 'Development1' }), makeDeps());
    expect(offList.exclusive).toBe(true);
    expect(offList.options.some((option) => option.checked)).toBe(false);
  });

  it('checks the current display style and no other', () => {
    const options = choice(makeFigure({ displayStyle: 'Wire2' }), makeDeps()).options;
    expect(options.filter((option) => option.checked).map((option) => option.id)).toEqual([
      'display-style-Wire2',
    ]);
    expect(options.map((option) => option.id)).toEqual([
      'display-style-Paper5',
      'display-style-Wire2',
      'display-style-Transparent3',
    ]);
  });

  it('routes each verb to its dependency', () => {
    const deps = makeDeps();
    const figure = makeFigure();
    command(figure, deps, 'flip').run();
    command(figure, deps, 'another').run();
    command(figure, deps, 'duplicate').run();
    command(figure, deps, 'delete').run();
    choice(figure, deps).options.find((option) => option.id === 'display-style-Wire2')?.run();
    expect(deps.flip).toHaveBeenCalledWith(figure);
    expect(deps.foldAnother).toHaveBeenCalledWith(figure);
    expect(deps.duplicate).toHaveBeenCalledWith(figure);
    expect(deps.remove).toHaveBeenCalledWith(figure);
    expect(deps.setDisplayStyle).toHaveBeenCalledWith(figure, 'Wire2');
  });

  it('routes the up-direction verbs to their dependencies', () => {
    const deps = makeDeps();
    const figure = make3dFigure(IDENTITY_ORIENT);

    command(figure, deps, 'set-upright').run();
    command(figure, deps, 'clear-upright').run();

    expect(deps.setUpright).toHaveBeenCalledWith(figure);
    expect(deps.clearUpright).toHaveBeenCalledWith(figure);
  });

  it('offers Set upright only on a 3D figure, which is the only kind with a viewpoint', () => {
    const deps = makeDeps();
    expect(commandIds(makeFigure(), deps)).not.toContain('set-upright');
    expect(commandIds(make3dFigure(), deps)).toContain('set-upright');
  });

  it('offers Clear upright only once there is an upright to forget', () => {
    // Otherwise the toolbar carries a permanently dead button for the flat-sheet
    // case, which is most of them.
    const deps = makeDeps();

    expect(commandIds(make3dFigure(), deps)).not.toContain('clear-upright');
    expect(commandIds(make3dFigure(IDENTITY_ORIENT), deps)).toContain('clear-upright');
  });

  it('marks delete as the only destructive verb', () => {
    const deps = makeDeps();
    const danger = buildFoldedFigureActions(makeFigure(), deps)
      .filter((action): action is FoldedFigureCommand => action.kind === 'command')
      .filter((action) => action.danger)
      .map((action) => action.id);
    expect(danger).toEqual(['delete']);
  });

  describe('export', () => {
    it('is absent when the caller supplies no export support', () => {
      expect(choiceIds(makeFigure(), makeDeps())).toEqual(['display-style']);
    });

    it('sits between the solution group and the manage group', () => {
      const deps = makeDeps({ exportAs: vi.fn() });
      const ids = buildFoldedFigureActions(makeFigure(), deps)
        .filter((action) => action.kind !== 'separator')
        .map((action) => action.id);
      expect(ids).toEqual([
        'flip',
        'display-style',
        'another',
        'export',
        'duplicate',
        'delete',
      ]);
    });

    it('offers image formats only — a folded figure is geometry on a page', () => {
      const deps = makeDeps({ exportAs: vi.fn() });
      expect(choice(makeFigure(), deps, 'export').options.map((option) => option.id)).toEqual([
        'export-svg',
        'export-png',
      ]);
    });

    // Not an exclusive set, so renderers must not reserve a check column for it:
    // an always-empty column reads as a stray indent beside the labels.
    it('is a list of actions, not a current mode', () => {
      const deps = makeDeps({ exportAs: vi.fn() });
      const group = choice(makeFigure(), deps, 'export');
      expect(group.exclusive).toBe(false);
      expect(group.options.every((option) => !option.checked)).toBe(true);
    });

    it('routes each format to the export dependency', () => {
      const exportAs = vi.fn();
      const deps = makeDeps({ exportAs });
      const figure = makeFigure();
      choice(figure, deps, 'export').options.forEach((option) => option.run());
      expect(exportAs).toHaveBeenNthCalledWith(1, figure, 'svg');
      expect(exportAs).toHaveBeenNthCalledWith(2, figure, 'png');
    });

    // Exported from the render snapshot, so a figure whose creases have since
    // moved can still be saved — but one that has never drawn cannot.
    it('is disabled only when the figure has no render snapshot', () => {
      const deps = makeDeps({ exportAs: vi.fn() });
      expect(choice(makeFigure({ status: 'stale' }), deps, 'export').disabled).toBe(false);
      expect(choice(makeFigure({ renderSnapshot: null }), deps, 'export').disabled).toBe(true);
    });
  });

  describe('refold', () => {
    it('is absent when the caller supplies no refold support', () => {
      expect(commandIds(makeFigure(), makeDeps())).not.toContain('refold');
    });

    it('is absent when the figure is up to date', () => {
      const deps = makeDeps({ refold: vi.fn(), isStale: () => false });
      expect(commandIds(makeFigure(), deps)).not.toContain('refold');
    });

    it('appears after Another solution when the figure is stale', () => {
      const deps = makeDeps({ refold: vi.fn(), isStale: () => true });
      expect(commandIds(makeFigure(), deps)).toEqual([
        'flip',
        'another',
        'refold',
        'duplicate',
        'delete',
      ]);
    });

    it('routes to the refold dependency', () => {
      const refold = vi.fn();
      const deps = makeDeps({ refold, isStale: () => true });
      const figure = makeFigure();
      command(figure, deps, 'refold').run();
      expect(refold).toHaveBeenCalledWith(figure);
    });
  });
});

/**
 * The solution verb reads the same on a 3D figure as on a flat one, at every
 * point of a stream.
 *
 * A requirement, not a nicety: one verb serves both kinds, so any divergence in
 * label, icon or disabled state is a divergence the user meets. The individual
 * cases above already pin what each state *should* say; what this adds is that
 * the two kinds say it identically — which the cases above cannot show, because
 * each is written against one kind.
 *
 * The states are the ones a real stream passes through, in order, and they are
 * the kernel's own vocabulary: `a_3d_stream_ends_the_way_a_flat_stream_ends` in
 * `crates/oristudio-cp/tests/folding3d_boundary.rs` is what says a real 3D
 * stream actually produces them. Before that landed, the last-solution row here
 * was unreachable in 3D — the stream reported another solution and then wrapped
 * without warning.
 */
describe('the solution verb is the same verb on either kind of figure', () => {
  const STREAM = [
    {
      what: 'the first of several solutions',
      cycling: {
        find_another_overlap_valid: true,
        discovered_fold_cases: 1,
        current_fold_case: 1,
      },
    },
    {
      what: 'the middle of a stream',
      cycling: {
        find_another_overlap_valid: true,
        discovered_fold_cases: 5,
        current_fold_case: 5,
      },
    },
    {
      what: 'the last solution, where the next press wraps',
      cycling: {
        find_another_overlap_valid: false,
        discovered_fold_cases: 8,
        current_fold_case: 8,
      },
    },
    {
      what: 'just after the wrap, back on solution 1',
      cycling: {
        find_another_overlap_valid: true,
        discovered_fold_cases: 8,
        current_fold_case: 1,
      },
    },
    {
      what: 'a fold with exactly one solution',
      cycling: {
        find_another_overlap_valid: false,
        discovered_fold_cases: 1,
        current_fold_case: 1,
      },
    },
  ];

  function verb(figure: OristudioCpFoldedFigureEntry) {
    const action = command(figure, makeDeps(), 'another');
    return { label: action.label, icon: action.icon, disabled: action.disabled };
  }

  for (const { what, cycling } of STREAM) {
    it(`reads the same at ${what}`, () => {
      const flat = makeFigure({
        snapshot: { model: { state: 'Front0' }, ...cycling },
      } as unknown as Partial<OristudioCpFoldedFigureEntry>);
      const spatial = makeFigure({
        sourceKind: 'generated-3d',
        snapshot: null,
        folded3d: { model: { state: 'Front0' }, verdict: { verdict: 'folded' }, ...cycling },
      } as unknown as Partial<OristudioCpFoldedFigureEntry>);

      expect(verb(spatial)).toEqual(verb(flat));
    });
  }

  it('says which of the two a press will do, rather than only that it can', () => {
    // The row above compares the two kinds; this one is why the comparison is
    // worth making. Without it a test that returned a constant for both kinds
    // would pass every case above.
    const at = (index: number) =>
      verb(
        makeFigure({
          sourceKind: 'generated-3d',
          snapshot: null,
          folded3d: {
            model: { state: 'Front0' },
            verdict: { verdict: 'folded' },
            ...STREAM[index]!.cycling,
          },
        } as unknown as Partial<OristudioCpFoldedFigureEntry>)
      );
    expect(at(1)).toEqual({ label: 'Another solution', icon: 'another', disabled: false });
    expect(at(2)).toEqual({
      label: 'Back to first solution',
      icon: 'first-solution',
      disabled: false,
    });
    // Nowhere to go: wrapping a one-solution fold lands where it started.
    expect(at(4).disabled).toBe(true);
  });
});

describe('isFoldedFigureReady', () => {
  it('requires a ready status, a handle and a snapshot', () => {
    expect(isFoldedFigureReady(makeFigure())).toBe(true);
    expect(isFoldedFigureReady(makeFigure({ handle: null }))).toBe(false);
    expect(isFoldedFigureReady(makeFigure({ snapshot: null }))).toBe(false);
    expect(isFoldedFigureReady(makeFigure({ status: 'stale' }))).toBe(false);
  });
});

describe('foldedFigureFlipState', () => {
  it('turns the paper over, defaulting to Front for a figure with no snapshot', () => {
    expect(foldedFigureFlipState(makeFigure())).toBe('Back1');
    expect(foldedFigureFlipState(makeFigure({ snapshot: null }))).toBe('Back1');
  });
});
