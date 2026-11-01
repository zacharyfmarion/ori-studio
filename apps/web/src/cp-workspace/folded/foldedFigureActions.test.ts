import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { PaperScene } from '@treemaker/origami-simulator';
import { dropFoldedSolutionCursor } from './foldedSolutionCursor';
import {
  landedAt,
  scriptedSolutionCursor,
  seatFoldedSolutionCursor,
  solutionPosition,
} from './foldedSolutionCursor.fixtures';

/** The host engine's door: a constrained figure's cursor is the test's to script (H6). */
const gateway = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../../layer-order/host/hostEngineGateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../layer-order/host/hostEngineGateway')>()),
  openLayerOrderSolutionCursor: (...args: unknown[]) => gateway.open(...args),
}));
import { DEFAULT_PAPER_STYLE, applyCreaseStyle } from '../../lib/paper/paperStyle';
import type {
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureStatus,
} from '../../engine/oristudioCpTypes';
import {
  buildFoldedFigureActions,
  foldedFigureFlipState,
  foldedFigureHeaderCommands,
  foldedFigureStyleGroup,
  isFoldedFigureReady,
  layerOrderCommand,
  previousSolutionCommand,
  type FoldedFigureAction,
  type FoldedFigureActionDeps,
  type FoldedFigureChoice,
  type FoldedFigureColorOption,
  type FoldedFigureCommand,
  type FoldedFigureStyleItem,
  type FoldedFigureToggleOption,
} from './foldedFigureActions';
import { foldedFigureNotice } from './foldedFigureNotice';
import { foldedFigureLayerOrder } from '../../lib/layerOrder/foldedFigureLayerOrder';
import type { LayerOrderAttention } from '../../lib/layerOrder/layerOrderRecord';
import { twoConstraintRecord } from '../../lib/layerOrder/layerOrderRecord.fixtures';

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

/** A 3D figure's picture. Only its presence is read here. */
const SCENE: PaperScene = {
  bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  sheet: 1,
  items: [],
};

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
    setDisplayStyle: vi.fn(),
    updateModel: vi.fn(),
    endModelGesture: vi.fn(),
    paperStyle: () => DEFAULT_PAPER_STYLE,
    inheritedPaperStyle: DEFAULT_PAPER_STYLE,
    setAppearance: vi.fn(),
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

/** A choice by id, whether it sits at the top level or inside Style. */
function choice(
  figure: OristudioCpFoldedFigureEntry,
  deps: FoldedFigureActionDeps,
  id: FoldedFigureChoice['id'] = 'display-style'
): FoldedFigureChoice {
  const actions = buildFoldedFigureActions(figure, deps);
  const candidates: Array<FoldedFigureAction | FoldedFigureStyleItem> = actions.flatMap(
    (action): Array<FoldedFigureAction | FoldedFigureStyleItem> =>
      action.kind === 'group' ? action.items : [action]
  );
  const found = candidates.find(
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

  it('puts the Style group directly after flip', () => {
    const actions = buildFoldedFigureActions(makeFigure(), makeDeps());
    expect(actions[0]).toMatchObject({ kind: 'command', id: 'flip' });
    expect(actions[1]).toMatchObject({ kind: 'group', id: 'style', icon: 'style' });
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

  it('routes Set upright to its dependency', () => {
    const deps = makeDeps();
    const figure = make3dFigure(IDENTITY_ORIENT);

    command(figure, deps, 'set-upright').run();

    expect(deps.setUpright).toHaveBeenCalledWith(figure);
  });

  it('offers Set upright only on a 3D figure, which is the only kind with a viewpoint', () => {
    const deps = makeDeps();
    expect(commandIds(makeFigure(), deps)).not.toContain('set-upright');
    expect(commandIds(make3dFigure(), deps)).toContain('set-upright');
  });

  it('offers no clear verb — undo is the way back from an upright', () => {
    // Deliberate: this is document state and Set upright takes one undo entry,
    // so a second button would be a second way to do what undo already does.
    // The simulator has no undo behind it and handles this differently — its
    // view reset drops the orientation.
    const deps = makeDeps();

    expect(commandIds(make3dFigure(IDENTITY_ORIENT), deps)).not.toContain('clear-upright');
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
      expect(commandIds(makeFigure(), makeDeps())).not.toContain('export');
    });

    it('sits after a separator of its own, between the solution group and the manage group', () => {
      const actions = buildFoldedFigureActions(makeFigure(), makeDeps({ exportFigure: vi.fn() }));
      expect(
        actions.filter((action) => action.kind !== 'separator').map((action) => action.id)
      ).toEqual(['flip', 'style', 'another', 'export', 'duplicate', 'delete']);
      const at = actions.findIndex((action) => action.id === 'export');
      expect(actions[at - 1]).toEqual({ kind: 'separator', id: 'before-export' });
    });

    // The dialog it opens chooses the format, so there is no list of formats to pick from.
    it('is one command, Export…, that hands the figure to the dialog once', () => {
      const exportFigure = vi.fn();
      const deps = makeDeps({ exportFigure });
      const figure = makeFigure();
      const action = command(figure, deps, 'export');
      expect(action).toMatchObject({ label: 'Export…', icon: 'export', disabled: false });
      expect(choiceIds(figure, deps)).toEqual([]);

      action.run();
      expect(exportFigure).toHaveBeenCalledTimes(1);
      expect(exportFigure).toHaveBeenCalledWith(figure);
    });

    // Exported from the figure's own picture, so a figure whose creases have
    // since moved can still be saved — but one that has never drawn cannot.
    // Either picture counts: a 3D figure keeps a scene and no snapshot.
    it('is disabled only when the figure has neither picture', () => {
      const deps = makeDeps({ exportFigure: vi.fn() });
      expect(command(makeFigure({ status: 'stale' }), deps, 'export').disabled).toBe(false);
      expect(
        command(makeFigure({ status: 'loading', snapshot: null, handle: null }), deps, 'export')
          .disabled
      ).toBe(false);
      expect(command(makeFigure({ renderSnapshot: null }), deps, 'export').disabled).toBe(true);
      expect(
        command(makeFigure({ renderSnapshot: null, scene: SCENE }), deps, 'export').disabled
      ).toBe(false);
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

describe('Layer order…, the dialog’s entry on a figure (H3)', () => {
  /** A flat figure whose fold found its layer orders, as the kernel says once solved. */
  const solved = (overrides: Partial<OristudioCpFoldedFigureEntry> = {}) =>
    makeFigure({
      snapshot: {
        model: { state: 'Front0' },
        display_style: 'Paper5',
        outcome: 'Solved',
        find_another_overlap_valid: true,
        discovered_fold_cases: 3,
        current_fold_case: 2,
      },
      sourceBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      ...overrides,
    } as unknown as Partial<OristudioCpFoldedFigureEntry>);
  const held = () => {
    const made = foldedFigureLayerOrder(twoConstraintRecord());
    if (!made.ok) throw new Error('the fixture record encodes');
    return made.layerOrder;
  };
  const withLayerOrder = (overrides: Partial<FoldedFigureActionDeps> = {}) =>
    makeDeps({ openLayerOrder: vi.fn(), ...overrides });

  it('is absent where the surface offers no way to open the dialog', () => {
    expect(commandIds(solved(), makeDeps())).not.toContain('layer-order');
    expect(layerOrderCommand(solved(), { t })).toBeNull();
  });

  it('sits right after Another solution, as a word, and opens the dialog on the figure', () => {
    const deps = withLayerOrder({ refold: vi.fn(), isStale: () => false });
    const figure = solved();
    expect(commandIds(figure, deps)).toEqual(['flip', 'another', 'layer-order', 'duplicate', 'delete']);
    const entry = command(figure, deps, 'layer-order');
    expect(entry).toMatchObject({ label: 'Layer order…', icon: 'layer-order', disabled: false });
    expect(entry.hint).toBeUndefined();
    entry.run();
    expect(deps.openLayerOrder).toHaveBeenCalledWith(figure);
  });

  it('stays enabled on a figure reopened from a file, with no live fold: the press folds it first', () => {
    expect(command(solved({ handle: null }), withLayerOrder(), 'layer-order').disabled).toBe(false);
  });

  // Every reason is read from the figure as saved: no engine, no kernel.
  it.each([
    ['a 3D figure (D13)', make3dFigure(), 'Layer order works on flat figures'],
    [
      'a fold that found no layer order (D3)',
      solved({
        snapshot: {
          model: { state: 'Front0' },
          display_style: 'Transparent3',
          outcome: 'NoSolutions',
          find_another_overlap_valid: false,
          discovered_fold_cases: 0,
        },
      } as unknown as Partial<OristudioCpFoldedFigureEntry>),
      'Layer order couldn’t be determined for this figure.',
    ],
    [
      'a newer build’s record',
      solved({ layerOrder: { kind: 'newer', saved: { figureKey: 'fk9:x', record: '{"v":2}' } } }),
      'Made with a newer Ori Studio: its layer constraints can’t be changed here.',
    ],
    [
      'no live fold and no source creases to fold again',
      solved({ handle: null, sourceBounds: null }),
      'This folded model has no source creases to work from',
    ],
  ])('is held on %s, saying why', (_what, figure, hint) => {
    expect(command(figure, withLayerOrder(), 'layer-order')).toMatchObject({ disabled: true, hint });
  });

  it('opens on a figure whose creases changed since the fold, constrained or not: on them as they are now (D12)', () => {
    const deps = withLayerOrder({ refold: vi.fn(), isStale: () => true });
    for (const figure of [solved(), solved({ layerOrder: held() })]) {
      const entry = command(figure, deps, 'layer-order');
      expect(entry.disabled).toBe(false);
      expect(entry.hint).toBeUndefined();
    }
  });

  it('refolds a figure that carries this build’s layer order, and holds Refold only on a newer build’s (H4)', () => {
    const deps = withLayerOrder({ refold: vi.fn(), isStale: () => true });
    for (const figure of [solved(), solved({ layerOrder: held() }), { ...make3dFigure(), layerOrder: held() }]) {
      const refold = command(figure, deps, 'refold');
      expect(refold.disabled).toBe(false);
      expect(refold.hint).toBeUndefined();
      refold.run();
      expect(deps.refold).toHaveBeenLastCalledWith(figure);
    }
    const newer = solved({ layerOrder: { kind: 'newer', saved: {} } });
    expect(command(newer, deps, 'refold')).toMatchObject({
      disabled: true,
      hint: 'Made with a newer Ori Studio: its layer constraints can’t be changed here.',
    });
  });

  describe('constraints that need attention since an edit (D10, D14)', () => {
    // Identity `t` with English plurals and interpolation.
    const tp = ((_key: string, fallback: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const values = typeof fallback === 'string' ? options : fallback;
      const text =
        typeof fallback === 'string'
          ? fallback
          : String((values?.count === 1 ? values.defaultValue_one : values?.defaultValue_other) ?? '');
      return text.replace(/\{\{(\w+)\}\}/gu, (_match, name: string) => String(values?.[name] ?? ''));
    }) as unknown as TFunction;
    const flagged = (attention: LayerOrderAttention, constraints = twoConstraintRecord().constraints) => {
      const made = foldedFigureLayerOrder(twoConstraintRecord({ constraints, attention }));
      if (!made.ok) throw new Error('the fixture record encodes');
      return solved({ layerOrder: made.layerOrder });
    };

    it('leads the toolbar and the menu with the flag, how many in its sentence, and Review…, which opens the dialog', () => {
      const runNoticeAction = vi.fn();
      const figure = flagged({ reason: 'conflict', count: 2 });
      const actions = buildFoldedFigureActions(figure, withLayerOrder({ t: tp, runNoticeAction }));
      const [note, separator] = actions;
      expect(note).toMatchObject({
        kind: 'note',
        id: 'notice',
        icon: 'notice-warn',
        notice: {
          id: 'layer-order-attention',
          tone: 'warn',
          label: 'Needs attention',
          detail: '2 layer constraints need attention since the creases changed.',
          action: { id: 'review-layer-order', label: 'Review…', lineIds: [] },
        },
      });
      expect(separator).toEqual({ kind: 'separator', id: 'after-notice' });
      if (note?.kind !== 'note') throw new Error('no notice');
      // The chip's label fits it (16 characters, as the board caps it).
      expect(note.notice.label.length).toBeLessThanOrEqual(16);
      note.run?.();
      expect(runNoticeAction).toHaveBeenCalledWith(figure, note.notice);
    });

    it('says a check that ran out of time, and an order chosen with no constraint, in their own words', () => {
      const timedOut = foldedFigureNotice(tp, flagged({ reason: 'timeout', count: 1 }));
      expect(timedOut).toMatchObject({ label: 'Needs attention', detail: '1 layer constraint couldn’t be checked in time.' });
      const chosen = flagged({ reason: 'timeout', count: 0 }, []);
      expect(foldedFigureNotice(tp, chosen)).toMatchObject({
        label: 'Needs attention',
        detail: 'This figure’s chosen layer order couldn’t be checked in time.',
      });
      // ‹ › point at the order itself: there is no constraint to review.
      expect(command(chosen, withLayerOrder(), 'another')).toMatchObject({
        disabled: true,
        hint: 'Review the chosen layer order first',
      });
    });

    it('says a record a reload detached isn’t applied, with Review…, from saved data alone', () => {
      const runNoticeAction = vi.fn();
      const plain = solved();
      const detached = { ...plain, detachedLayerOrder: { record: twoConstraintRecord(), json: '{}' } };
      const [note] = buildFoldedFigureActions(detached, withLayerOrder({ t: tp, runNoticeAction }));
      expect(note).toMatchObject({
        kind: 'note',
        notice: {
          id: 'layer-order-attention',
          label: 'Not applied',
          detail: 'An older Ori Studio refolded this figure, so its 2 layer constraints aren’t applied.',
          action: { id: 'review-layer-order', label: 'Review…' },
        },
      });
      // Never its own record: Another solution steps Oriedita's search as before.
      expect(command(detached, withLayerOrder(), 'another').disabled).toBe(false);
      // Refolded here since, from other creases: still shown, as the figure's flag.
      expect(foldedFigureNotice(tp, { ...detached, sourceFingerprint: 'cs1:another' })).toMatchObject({ label: 'Not applied' });
      // Taken up by an Apply, or let go with Dismiss: nothing to show.
      for (const settled of ['reattached', 'dismissed'] as const) {
        expect(foldedFigureNotice(tp, { ...detached, detachedLayerOrder: { ...detached.detachedLayerOrder, settled } })).toBeNull();
      }
    });

    it('flags a 3D figure whose creases fold flat again and whose record a refold could not draw: Layer order… opens', () => {
      const made = foldedFigureLayerOrder(twoConstraintRecord({ attention: { reason: 'conflict', count: 2 } }));
      if (!made.ok) throw new Error('the fixture record encodes');
      const figure = { ...make3dFigure(), sourceBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, layerOrder: made.layerOrder };
      expect(foldedFigureNotice(tp, figure)).toMatchObject({ id: 'layer-order-attention', label: 'Needs attention' });
      expect(command(figure, withLayerOrder({ t: tp }), 'layer-order')).toMatchObject({ disabled: false });
      expect(command(figure, withLayerOrder({ t: tp }), 'another')).toMatchObject({
        disabled: true,
        hint: 'Review the layer constraints that need attention first',
      });
    });

    it('says on a 3D figure that its constraints are kept for when it folds flat again (D13)', () => {
      const waiting = foldedFigureLayerOrder(twoConstraintRecord({ attention: { reason: 'route-3d', count: 2 } }));
      if (!waiting.ok) throw new Error('the fixture record encodes');
      expect(command({ ...make3dFigure(), layerOrder: waiting.layerOrder }, withLayerOrder({ t: tp }), 'layer-order')).toMatchObject({
        disabled: true,
        hint: 'Layer order works on flat figures. Its 2 layer constraints are kept for when it folds flat again.',
      });
    });

    it('says nothing on a figure whose record needs nothing, nor on a 3D one whose record waits (D13)', () => {
      expect(foldedFigureNotice(tp, solved({ layerOrder: held() }))).toBeNull();
      const waiting = foldedFigureLayerOrder(twoConstraintRecord({ attention: { reason: 'route-3d', count: 2 } }));
      if (!waiting.ok) throw new Error('the fixture record encodes');
      expect(foldedFigureNotice(tp, { ...make3dFigure(), layerOrder: waiting.layerOrder })).toBeNull();
    });

    it('holds Another solution and ‹ until they are reviewed', () => {
      const figure = flagged({ reason: 'unresolved', count: 1 });
      const hint = 'Review the layer constraints that need attention first';
      expect(command(figure, withLayerOrder(), 'another')).toMatchObject({ disabled: true, hint });
      expect(previousSolutionCommand(figure, { t, foldPrevious: vi.fn() })).toMatchObject({ disabled: true, hint });
      // Layer order… itself stays open: it is where they are reviewed.
      expect(command(figure, withLayerOrder({ isStale: () => true }), 'layer-order').disabled).toBe(false);
    });
  });

  it('waits with no reason while the figure folds or after it failed, as every verb waits', () => {
    for (const status of ['loading', 'error', 'stale'] as const) {
      const entry = command(solved({ status }), withLayerOrder(), 'layer-order');
      expect(entry.disabled, status).toBe(true);
      expect(entry.hint, status).toBeUndefined();
    }
    // The first fold, with nothing folded yet.
    expect(command(solved({ snapshot: null }), withLayerOrder(), 'layer-order').disabled).toBe(true);
  });

  describe('Another solution and ‹ within the constraints (H6, D9)', () => {
    afterEach(() => {
      dropFoldedSolutionCursor();
      gateway.open.mockReset();
    });

    /** Edit's table holding a cursor for `figure` at `index` of `n`, as a press that found its end leaves it. */
    /** A press landed the figure on `index` of `n`. */
    async function at(figure: OristudioCpFoldedFigureEntry, index: number, n: number, exact = true) {
      gateway.open.mockReturnValueOnce(scriptedSolutionCursor([landedAt(twoConstraintRecord(), index, n, { exact })]));
      await seatFoldedSolutionCursor(figure, twoConstraintRecord());
    }

    it('steps on with no cursor yet, as saved data allows, never wrapping round', () => {
      const deps = withLayerOrder();
      const constrained = solved({ layerOrder: held() });
      const another = command(constrained, deps, 'another');
      expect(another).toMatchObject({ label: 'Another solution', icon: 'another', disabled: false });
      expect(another.hint).toBeUndefined();
      another.run();
      expect(deps.foldAnother).toHaveBeenCalledWith(constrained);
      const foldPrevious = vi.fn();
      const previous = previousSolutionCommand(constrained, { t, foldPrevious });
      expect(previous).toMatchObject({ label: 'Previous solution', icon: 'previous', disabled: false });
      previous.run();
      expect(foldPrevious).toHaveBeenCalledWith(constrained);
      // At the end of Oriedita's lap, or on its first case: neither is the record's.
      const last = solved({
        layerOrder: held(),
        snapshot: {
          model: { state: 'Front0' },
          display_style: 'Paper5',
          outcome: 'Solved',
          find_another_overlap_valid: false,
          discovered_fold_cases: 1,
          current_fold_case: 1,
          shown_order: 'given',
        },
      } as unknown as Partial<OristudioCpFoldedFigureEntry>);
      expect(command(last, deps, 'another')).toMatchObject({ label: 'Another solution', disabled: false });
      expect(previousSolutionCommand(last, { t, foldPrevious }).disabled).toBe(false);
      // Reopened from a file: the press folds it as it steps.
      expect(command(solved({ layerOrder: held(), handle: null }), deps, 'another').disabled).toBe(false);
      // Nothing was asked of the engine to say so.
      expect(gateway.open).not.toHaveBeenCalled();
    });

    it('waits at each end of the solutions that fit once a press has found where it stands', async () => {
      const constrained = solved({ layerOrder: held() });
      const deps = withLayerOrder();
      const previous = () => previousSolutionCommand(constrained, { t, foldPrevious: vi.fn() });
      const next = () => command(constrained, deps, 'another');

      await at(constrained, 1, 3);
      expect(previous()).toMatchObject({ disabled: true, hint: 'This is its first solution' });
      expect(next().disabled).toBe(false);

      await at(constrained, 2, 3);
      expect(previous().disabled).toBe(false);
      expect(next().disabled).toBe(false);

      await at(constrained, 3, 3);
      expect(next()).toMatchObject({ disabled: true, hint: 'This is its last solution' });
      // Not the end while the count may find more.
      await at(constrained, 3, 3, false);
      expect(next().disabled).toBe(false);

      await at(constrained, 1, 1);
      expect(next()).toMatchObject({ disabled: true, hint: 'This figure has one solution' });
      expect(previous().disabled).toBe(true);
    });

    it('waits where a › found nothing, an end proved before the count is final (E9)', async () => {
      const constrained = solved({ layerOrder: held() });
      gateway.open.mockReturnValueOnce(
        scriptedSolutionCursor([{ outcome: 'end', position: solutionPosition(3, 3, false), counted: true }])
      );
      await seatFoldedSolutionCursor(constrained, twoConstraintRecord());
      expect(command(constrained, withLayerOrder(), 'another')).toMatchObject({
        disabled: true,
        hint: 'This is its last solution',
      });
      // Only that way: ‹ still steps back.
      expect(previousSolutionCommand(constrained, { t, foldPrevious: vi.fn() }).disabled).toBe(false);
    });

    it('reads the place only for the figure, the fold and the record it was found on', async () => {
      const constrained = solved({ layerOrder: held() });
      await at(constrained, 1, 3);
      const previousOf = (figure: OristudioCpFoldedFigureEntry) =>
        previousSolutionCommand(figure, { t, foldPrevious: vi.fn() }).disabled;
      expect(previousOf(constrained)).toBe(true);
      // Another fold (an undo put the old one back), another record, turned over, X-ray on.
      expect(previousOf({ ...constrained, handle: 99 })).toBe(false);
      const other = foldedFigureLayerOrder(twoConstraintRecord({ constraints: [[0, 1, 1]] }));
      if (!other.ok) throw new Error('the fixture record encodes');
      expect(previousOf({ ...constrained, layerOrder: other.layerOrder })).toBe(false);
      const back = { ...constrained, snapshot: { ...constrained.snapshot!, model: { ...constrained.snapshot!.model, state: 'Back1' } } };
      expect(previousOf(back as OristudioCpFoldedFigureEntry)).toBe(false);
      expect(previousOf({ ...constrained, displayStyle: 'Transparent3' })).toBe(false);
    });

    it('waits as Layer order… does: while it folds, on a stale figure, and on a newer build’s order', () => {
      expect(command(solved({ layerOrder: held(), status: 'loading' }), withLayerOrder(), 'another')).toMatchObject({
        disabled: true,
      });
      expect(command(solved({ layerOrder: held() }), withLayerOrder({ isStale: () => true }), 'another')).toMatchObject({
        disabled: true,
        hint: 'Its creases changed since it was folded',
      });
      const why = 'Made with a newer Ori Studio: its layer constraints can’t be changed here.';
      const newer = solved({ layerOrder: { kind: 'newer', saved: {} } });
      expect(command(newer, withLayerOrder(), 'another')).toMatchObject({ disabled: true, hint: why });
      expect(previousSolutionCommand(newer, { t, foldPrevious: vi.fn() })).toMatchObject({ disabled: true, hint: why });
    });

    it('waits on a figure whose constraints need a look since an edit, until they are reviewed (D10, D14)', () => {
      const why = 'Review the layer constraints that need attention first';
      for (const reason of ['conflict', 'unresolved'] as const) {
        const flagged = foldedFigureLayerOrder(twoConstraintRecord({ attention: { reason, count: 1 } }));
        if (!flagged.ok) throw new Error('the fixture record encodes');
        const figure = solved({ layerOrder: flagged.layerOrder });
        expect(command(figure, withLayerOrder(), 'another'), reason).toMatchObject({ disabled: true, hint: why });
        expect(previousSolutionCommand(figure, { t, foldPrevious: vi.fn() }), reason).toMatchObject({ disabled: true, hint: why });
      }
      // An order chosen with no constraint has the order itself to review (D16).
      const chosen = foldedFigureLayerOrder(twoConstraintRecord({ constraints: [], attention: { reason: 'unresolved', count: 0 } }));
      if (!chosen.ok) throw new Error('the fixture record encodes');
      expect(command(solved({ layerOrder: chosen.layerOrder }), withLayerOrder(), 'another')).toMatchObject({
        disabled: true,
        hint: 'Review the chosen layer order first',
      });
    });
  });

  it('leaves Another solution and ‹ exactly as they were on an unconstrained figure', () => {
    const plain = solved();
    const { run: _with, ...withEntry } = command(plain, withLayerOrder(), 'another');
    const { run: _without, ...withoutEntry } = command(plain, makeDeps(), 'another');
    expect(withEntry).toEqual(withoutEntry);
    expect(command(plain, withLayerOrder(), 'another')).toMatchObject({ disabled: false });
    expect(command(plain, withLayerOrder(), 'another').hint).toBeUndefined();
    expect(previousSolutionCommand(plain, { t, foldPrevious: vi.fn() })).toMatchObject({ disabled: false });
  });

  it('leaves a 3D figure’s Another solution as it was, whatever record waits on it', () => {
    const spatial = { ...make3dFigure(), layerOrder: held() };
    const plain = make3dFigure();
    const deps = withLayerOrder();
    expect(command(spatial, deps, 'another').disabled).toBe(command(plain, deps, 'another').disabled);
    expect(command(spatial, deps, 'another').hint).toBe(command(plain, deps, 'another').hint);
  });
});

describe('previousSolutionCommand, the Properties pane’s ‹', () => {
  const deps = () => ({ t, foldPrevious: vi.fn() });
  const at = (current: number) =>
    makeFigure({
      snapshot: {
        model: { state: 'Front0' },
        find_another_overlap_valid: true,
        discovered_fold_cases: 3,
        current_fold_case: current,
      },
    } as unknown as Partial<OristudioCpFoldedFigureEntry>);

  it('goes back from any but the first solution of a flat figure', () => {
    const d = deps();
    const figure = at(2);
    const previous = previousSolutionCommand(figure, d);
    expect(previous).toMatchObject({ id: 'previous', label: 'Previous solution', disabled: false });
    expect(previous.hint).toBeUndefined();
    previous.run();
    expect(d.foldPrevious).toHaveBeenCalledWith(figure);
  });

  it('stops at the first, saying so', () => {
    expect(previousSolutionCommand(at(1), deps())).toMatchObject({
      disabled: true,
      hint: 'This is its first solution',
    });
  });

  it('is held on a 3D figure, which has no numbered solutions to go back to', () => {
    const spatial = makeFigure({
      snapshot: null,
      folded3d: {
        model: { state: 'Front0' },
        verdict: { verdict: 'folded' },
        find_another_overlap_valid: true,
        discovered_fold_cases: 3,
        current_fold_case: 3,
      },
    } as unknown as Partial<OristudioCpFoldedFigureEntry>);
    expect(previousSolutionCommand(spatial, deps())).toMatchObject({
      disabled: true,
      hint: 'Stepping back works on flat figures',
    });
  });

  it('waits for the figure to be ready, as every kernel-backed verb does', () => {
    expect(previousSolutionCommand(makeFigure({ status: 'loading' }), deps()).disabled).toBe(true);
  });
});

describe('the header verbs', () => {
  it('are Export…, Duplicate and Delete, the toolbar’s last group, routed to the same deps', () => {
    const exportFigure = vi.fn();
    const d = makeDeps({ exportFigure });
    const figure = makeFigure();
    const header = foldedFigureHeaderCommands(figure, d);
    expect(header.map((item) => item.label)).toEqual(['Export…', 'Duplicate', 'Delete']);
    const toolbar = buildFoldedFigureActions(figure, d).filter(
      (item): item is FoldedFigureCommand =>
        item.kind === 'command' && ['export', 'duplicate', 'delete'].includes(item.id)
    );
    expect(toolbar.map(({ id, label, icon, disabled }) => ({ id, label, icon, disabled }))).toEqual(
      header.map(({ id, label, icon, disabled }) => ({ id, label, icon, disabled }))
    );
    for (const item of header) item.run();
    expect(exportFigure).toHaveBeenCalledWith(figure);
    expect(d.duplicate).toHaveBeenCalledWith(figure);
    expect(d.remove).toHaveBeenCalledWith(figure);
  });

  it('leave Export… out where the surface cannot export', () => {
    expect(foldedFigureHeaderCommands(makeFigure(), makeDeps()).map((item) => item.id)).toEqual([
      'duplicate',
      'delete',
    ]);
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

describe('foldedFigureStyleGroup', () => {
  const FULL_MODEL = {
    state: 'Front0',
    front_color: { red: 255, green: 255, blue: 50 },
    back_color: { red: 233, green: 233, blue: 233 },
    line_color: { red: 0, green: 0, blue: 0 },
    display_shadows: true,
  };

  function flat(model: Record<string, unknown> = FULL_MODEL) {
    return makeFigure({
      snapshot: { model, find_another_overlap_valid: true, discovered_fold_cases: 1 },
    } as unknown as Partial<OristudioCpFoldedFigureEntry>);
  }

  function spatial(model: Record<string, unknown> = FULL_MODEL) {
    return makeFigure({
      snapshot: null,
      folded3d: { model, verdict: { verdict: 'folded' } },
      camera: { yaw: 0, pitch: 0, zoom: 1 },
    } as unknown as Partial<OristudioCpFoldedFigureEntry>);
  }

  function styleChoice(figure: OristudioCpFoldedFigureEntry, deps: FoldedFigureActionDeps, id: string) {
    const found = foldedFigureStyleGroup(figure, deps).items.find(
      (item): item is FoldedFigureChoice => item.kind === 'choice' && item.id === id
    );
    if (!found) throw new Error(`no ${id} choice`);
    return found;
  }

  function colors(figure: OristudioCpFoldedFigureEntry, deps: FoldedFigureActionDeps) {
    return foldedFigureStyleGroup(figure, deps).items.filter(
      (item): item is FoldedFigureColorOption => item.kind === 'color'
    );
  }

  function shadow(figure: OristudioCpFoldedFigureEntry, deps: FoldedFigureActionDeps) {
    const found = foldedFigureStyleGroup(figure, deps).items.find(
      (item): item is FoldedFigureToggleOption => item.kind === 'toggle' && item.id === 'shadow'
    );
    if (!found) throw new Error('no shadow toggle');
    return found;
  }

  it('lays out render style, side, the three colours, shadow and auxiliary creases, in that order', () => {
    // Re-pinned for Phase 5: the existing-crease toggle is the last row on
    // every kind, after the flat figure's shadow or the 3D figure's light.
    const group = foldedFigureStyleGroup(flat(), makeDeps());
    expect(group).toMatchObject({ kind: 'group', id: 'style', icon: 'style', disabled: false });
    expect(group.items.map((item) => `${item.kind}:${item.id}`)).toEqual([
      'choice:display-style',
      'choice:side',
      'separator:before-colors',
      'color:front-color',
      'color:back-color',
      'color:line-color',
      'separator:before-shadow',
      'toggle:shadow',
      'separator:before-aux',
      'toggle:aux',
    ]);
  });

  it('checks the current render style, and routes a pick to setDisplayStyle', () => {
    const deps = makeDeps();
    const figure = flat();
    const options = styleChoice(figure, deps, 'display-style').options;
    expect(options.filter((option) => option.checked).map((option) => option.id)).toEqual([
      'display-style-Paper5',
    ]);
    options[1]?.run();
    expect(deps.setDisplayStyle).toHaveBeenCalledWith(figure, 'Wire2');
  });

  it('checks the current side, and writes the other as a discrete model change', () => {
    const deps = makeDeps();
    const figure = flat();
    const side = styleChoice(figure, deps, 'side');
    expect(side.exclusive).toBe(true);
    expect(side.disabled).toBe(false);
    expect(side.options.map((option) => [option.id, option.checked])).toEqual([
      ['side-Front0', true],
      ['side-Back1', false],
    ]);
    side.options[1]?.run();
    expect(deps.updateModel).toHaveBeenCalledWith(figure, { state: 'Back1' });
  });

  it('marks neither side current for a figure loaded in an overlay state', () => {
    const side = styleChoice(flat({ ...FULL_MODEL, state: 'Both2' }), makeDeps(), 'side');
    expect(side.options.some((option) => option.checked)).toBe(false);
  });

  // A 3D figure's state only seeds the camera a fresh fold opens at; after
  // that the figure re-projects at its own camera, so a side write is inert.
  it('offers side on a 3D figure disabled, with the verb that does work as the hint', () => {
    const side = styleChoice(spatial(), makeDeps(), 'side');
    expect(side.disabled).toBe(true);
    expect(side.hint).toBe('Turn a 3D model with Other side');
    expect(side.options.some((option) => option.checked)).toBe(false);
  });

  it('shows each colour of the effective style as hex and pins a change under its own gesture', () => {
    // Re-pinned for the paper style (Phase 1): the rows read the figure's
    // effective paper style and a change pins that field on the figure; the
    // kernel model follows through the mirror rather than being written here.
    const deps = makeDeps();
    const figure = flat();
    const rows = colors(figure, deps);
    expect(rows.map((row) => [row.label, row.value])).toEqual([
      ['Front color', '#ffff32'],
      ['Back color', '#e9e9e9'],
      ['Line color', '#000000'],
    ]);
    rows[0]?.set('#ff0000');
    expect(deps.setAppearance).toHaveBeenCalledWith(
      figure,
      { field: 'paper.front', value: '#ff0000' },
      { scope: 'folded-color:folded-1:front_color', label: 'Change folded model color' }
    );
    rows[0]?.commit();
    expect(deps.endModelGesture).toHaveBeenCalledWith('folded-color:folded-1:front_color');
    // The line colour is the edge pen's, and a pen is pinned whole.
    rows[2]?.set('#0000ff');
    expect(deps.setAppearance).toHaveBeenLastCalledWith(
      figure,
      { field: 'edges', value: { ...DEFAULT_PAPER_STYLE.edges, color: '#0000ff' } },
      { scope: 'folded-color:folded-1:line_color', label: 'Change folded model color' }
    );
  });

  it('pins the edge pen alone with a new line ink, on either figure', () => {
    // Re-pinned for Phase 9: the 3D figure drew M/V in the fold pens, so under
    // mono its line ink carried onto them. Both folded figures now draw every
    // fold as an edge, so the line ink is the edge pen and nothing more.
    const mono = applyCreaseStyle(DEFAULT_PAPER_STYLE, 'mono');
    const gesture = { scope: 'folded-color:folded-1:line_color', label: 'Change folded model color' };
    for (const figure of [spatial(), flat()]) {
      const deps = makeDeps({ paperStyle: () => mono });
      colors(figure, deps)[2]?.set('#333333');
      expect(deps.setAppearance).toHaveBeenCalledTimes(1);
      expect(deps.setAppearance).toHaveBeenCalledWith(
        figure,
        { field: 'edges', value: { ...mono.edges, color: '#333333' } },
        gesture
      );
    }
  });

  it('reads the colours from the effective style, whichever kind of figure', () => {
    const style = { ...DEFAULT_PAPER_STYLE, paper: { front: '#010203', back: '#e9e9e9' } };
    const rows = colors(spatial(), makeDeps({ paperStyle: () => style }));
    expect(rows[0]).toMatchObject({ value: '#010203', disabled: false });
    expect(colors(flat({ state: 'Front0' }), makeDeps({ paperStyle: () => style }))[0]?.value).toBe(
      '#010203'
    );
  });

  it('toggles shadow as a discrete model change', () => {
    const deps = makeDeps();
    const figure = flat();
    const row = shadow(figure, deps);
    expect(row).toMatchObject({ checked: true, disabled: false });
    row.toggle();
    expect(deps.updateModel).toHaveBeenCalledWith(figure, { display_shadows: false });
  });

  it('offers a 3D figure the light in place of the shadow, as a pin', () => {
    // Re-pinned for D7: the shadow used to be offered disabled on a 3D figure.
    // It is the flat figure's own option; a 3D figure is lit from the paper
    // style's light, whose switch pins the figure's `light`.
    const deps = makeDeps();
    const figure = spatial();
    const items = foldedFigureStyleGroup(figure, deps).items;
    expect(items.map((item) => `${item.kind}:${item.id}`)).toEqual([
      'choice:display-style',
      'choice:side',
      'separator:before-colors',
      'color:front-color',
      'color:back-color',
      'color:line-color',
      'separator:before-light',
      'toggle:light',
      'separator:before-aux',
      'toggle:aux',
    ]);
    const light = items.find(
      (item): item is FoldedFigureToggleOption => item.kind === 'toggle' && item.id === 'light'
    );
    expect(light).toMatchObject({ checked: true, disabled: false });
    light?.toggle();
    expect(deps.setAppearance).toHaveBeenCalledWith(figure, {
      field: 'light',
      value: { ...DEFAULT_PAPER_STYLE.light, enabled: false },
    });
    expect(deps.updateModel).not.toHaveBeenCalled();
  });

  it('offers the existing-crease toggle on both kinds, as a pin', () => {
    // Every surface's policy applies `auxCreases.visible` since Phase 5. The
    // pen and erode are numbers and belong to the Properties sheet.
    for (const figure of [flat(), spatial()]) {
      const deps = makeDeps();
      const aux = foldedFigureStyleGroup(figure, deps).items.find(
        (item): item is FoldedFigureToggleOption => item.kind === 'toggle' && item.id === 'aux'
      );
      expect(aux).toMatchObject({ label: 'Auxiliary creases', checked: true, disabled: false });
      aux?.toggle();
      expect(deps.setAppearance).toHaveBeenCalledWith(figure, {
        field: 'auxCreases.visible',
        value: false,
      });
    }
  });

  // The Properties sheet's switch clears a pin by flipping back to what it
  // inherits (`ToggleRow`). A menu that pinned the app's own value instead
  // left that row "Overridden" and showing the inherited value, which only a
  // flip away and back again could clear.
  it('clears the pin rather than copying the app style when a switch goes back to it', () => {
    const figure = spatial();
    const pinned = {
      ...DEFAULT_PAPER_STYLE,
      light: { ...DEFAULT_PAPER_STYLE.light, enabled: false },
      auxCreases: { ...DEFAULT_PAPER_STYLE.auxCreases, visible: false },
    };
    const deps = makeDeps({ paperStyle: () => pinned, inheritedPaperStyle: DEFAULT_PAPER_STYLE });
    const toggles = foldedFigureStyleGroup(figure, deps).items.filter(
      (item): item is FoldedFigureToggleOption => item.kind === 'toggle'
    );
    for (const toggle of toggles) toggle.toggle();
    expect(deps.setAppearance).toHaveBeenCalledTimes(2);
    expect(deps.setAppearance).toHaveBeenCalledWith(figure, { field: 'light', value: undefined });
    expect(deps.setAppearance).toHaveBeenCalledWith(figure, {
      field: 'auxCreases.visible',
      value: undefined,
    });
  });

  it('disables the whole group, and every row in it, until the figure is ready', () => {
    const loading = makeFigure({ status: 'loading', snapshot: null });
    const group = foldedFigureStyleGroup(loading, makeDeps());
    expect(group.disabled).toBe(true);
    for (const item of group.items) {
      if (item.kind !== 'separator') expect(item.disabled, item.id).toBe(true);
    }
  });
});
