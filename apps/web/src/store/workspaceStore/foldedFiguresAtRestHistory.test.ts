import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type {
  OristudioCpDocumentState,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureSnapshot,
  OristudioCpFoldedRenderSnapshot,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';
import { IDENTITY_FOLDED_PLACEMENT } from '../../engine/oristudioCpTypes';

/**
 * History never stores a folded figure mid-press (`foldedFiguresAtRest.ts`).
 *
 * Every press that folds marks its figure `loading` — a fold and a Duplicate
 * by adding a placeholder — and an undo taken while it runs used to push the
 * live list, `loading` figure and all, onto the redo stack. The press then
 * landed on nothing (its figure was gone from the live list), and a redo
 * brought back a figure that waited forever, its verbs held. Here each press
 * is held in the kernel while an undo runs, then let go, then redone: the
 * figure comes back as it was before the press, a placeholder not at all,
 * and every fold is still held exactly once per reference.
 *
 * The kernel's figure arena is stood in for as in
 * `foldedFigureHandleUndo.test.ts`: a fold takes the lowest free slot, a free
 * gives it back, and the gate holds each answer.
 */
const arena = vi.hoisted(() => ({
  live: new Set<number>(),
  freed: [] as number[],
  take(): number {
    let slot = 0;
    while (this.live.has(slot)) slot += 1;
    this.live.add(slot);
    return slot;
  },
}));

const gate = vi.hoisted(() => ({
  pending: null as Promise<void> | null,
  open: () => {},
  close() {
    this.pending = new Promise<void>((resolve) => {
      this.open = () => {
        this.pending = null;
        resolve();
      };
    });
  },
}));

vi.mock('./oristudioCpRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./oristudioCpRuntime')>();
  const folded = async (given: boolean) => {
    const handle = arena.take();
    await gate.pending;
    return { handle, snapshot: snapshot(given) };
  };
  return {
    ...actual,
    freeOristudioCpFoldedFigure: async (handle: number) => {
      arena.freed.push(handle);
      arena.live.delete(handle);
    },
    foldOristudioCpDocument: () => folded(false),
    duplicateOristudioCpFoldedFigure: () => folded(false),
    foldOristudioCpWithOrder: async () => ({ status: 'folded', ...(await folded(true)) }),
    foldOristudioCpFigureAnother: async () => {
      await gate.pending;
      return { ...snapshot(false), discovered_fold_cases: 2, current_fold_case: 2 };
    },
    foldOristudioCpFigureToCase: async () => {
      await gate.pending;
      return { snapshot: { ...snapshot(false), discovered_fold_cases: 2, current_fold_case: 1 }, discovered_case_numbers: [1, 2] };
    },
    getOristudioCpFoldedFigureDigest: async () => DIGEST,
    getOristudioCpFoldedFigureSource: async () => ({ segments: LINES, starting_face_id: 1, aux_segments: [], digest: DIGEST }),
    getOristudioCpFoldedFigureRenderSnapshot: async (handle: number) => {
      if (!arena.live.has(handle)) throw new Error(`no folded figure in slot ${handle}`);
      return renderSnapshot();
    },
    setOristudioCpFoldedFigureModel: async (handle: number, model: OristudioCpFoldedFigureSnapshot['model']) => {
      if (!arena.live.has(handle)) throw new Error(`no folded figure in slot ${handle}`);
      return { ...snapshot(false), model };
    },
    isCurrentOristudioCpDocumentState: () => true,
  };
});

/** The host engine's door: a constrained figure's step is scripted, and moves. */
const gateway = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../../layer-order/host/hostEngineGateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../layer-order/host/hostEngineGateway')>()),
  openLayerOrderSolutionCursor: (...args: unknown[]) => gateway.open(...args),
}));

import { useWorkspaceStore } from './store';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import { foldedFigureLayerOrder } from '../../lib/layerOrder/foldedFigureLayerOrder';
import { twoConstraintRecord } from '../../lib/layerOrder/layerOrderRecord.fixtures';
import { layerOrderSourceOf } from '../../lib/layerOrder/layerOrderSource';
import {
  foldedFigureHandleRefCount,
  resetFoldedFigureHandles,
  retainFoldedFigureHandle,
} from '../../cp-workspace/folded/foldedFigureHandles';
import { foldedFigureGesture } from '../../cp-workspace/folded/foldedFigureGesture';
import { foldedSourceBounds } from '../../cp-workspace/folded/foldedFigureStaleness';
import { endOpenCanvasSessions } from '../../cp-workspace/canvasObjects/canvasSessions';
import {
  foldedFiguresAtRest,
  foldedSelectionAtRest,
  holdFoldedFigureAtRest,
  holdFoldedPlaceholderAtRest,
  resetFoldedFiguresAtRestForTests,
} from '../../cp-workspace/folded/foldedFiguresAtRest';
import { dropFoldedSolutionCursor } from '../../cp-workspace/folded/foldedSolutionCursor';
import { scriptedSolutionCursor, solutionPosition } from '../../cp-workspace/folded/foldedSolutionCursor.fixtures';
import {
  showAnotherFoldedSolution,
  showPreviousFoldedSolution,
} from '../../cp-workspace/folded/foldedFigureVerbs';
import { applyFoldedFigureLayerOrder } from '../../cp-workspace/folded/openFoldedFigureLayerOrder';
import { markFoldPress } from '../../cp-workspace/folded/foldPress';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;
const DIGEST = '00000000c0ffee01';

function renderSnapshot(): OristudioCpFoldedRenderSnapshot {
  return { schema_version: 1, fixture: null, pass: 'paper-front-full', primitives: [] };
}

function snapshot(given: boolean): OristudioCpFoldedFigureSnapshot {
  return {
    model: {
      front_color: { red: 255, green: 255, blue: 50 },
      back_color: { red: 233, green: 233, blue: 233 },
      line_color: { red: 0, green: 0, blue: 0 },
      scale: 1,
      rotation: 0,
      anti_alias: true,
      display_shadows: false,
      state: 'Front0',
      folded_cases: 1,
      transparent_transparency: 16,
      transparency_color: false,
    },
    estimation_step: 'Step5',
    display_style: 'Paper5',
    discovered_fold_cases: 1,
    current_fold_case: 1,
    find_another_overlap_valid: true,
    outcome: 'Solved',
    ...(given ? { shown_order: 'given' } : {}),
    text_result: '',
    wireframe: {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      lines: [{ begin: 0, end: 1, color: 'Red1' }],
      faces: [[0, 1, 2]],
      starting_face: 0,
      face_positions: [1],
      next_faces: [null],
      associated_lines: [null],
    },
  } as OristudioCpFoldedFigureSnapshot;
}

function line(a: { x: number; y: number }, b: { x: number; y: number }, color: 'Red1' | 'Blue2'): OristudioCpLineSegment {
  return { a, b, color, active: 'Inactive0', selected: 0, customized: 0, customized_color: { red: 0, green: 0, blue: 0 } };
}

const LINES = [line({ x: 0, y: 0 }, { x: 1, y: 1 }, 'Red1'), line({ x: 1, y: 0 }, { x: 0, y: 1 }, 'Blue2')];

function cpState(): OristudioCpDocumentState {
  const document = createStarterOristudioCpDocument();
  return {
    handle: 4,
    loadSerial: 1,
    document: { ...document, crease_pattern: { ...document.crease_pattern, line_segments: LINES } },
    geometry: null,
    summary: {
      title: 'Untitled CP',
      line_segments: LINES.length,
      circles: 0,
      points: 0,
      aux_line_segments: 0,
      texts: 0,
      can_save_as_cp: true,
      is_empty: false,
    },
    source: { format: 'cp', filename: 'Untitled.cp', path: null },
    operationDescriptors: [],
    lastCommandResult: null,
  };
}

const RECORD = twoConstraintRecord();
function held() {
  const made = foldedFigureLayerOrder(RECORD);
  if (!made.ok) throw new Error('the fixture record encodes');
  return made.layerOrder;
}

/** A flat figure folded from the two creases, on a slot the arena gives it, with one entry for it. */
async function foldedAsEntry(overrides: Partial<OristudioCpFoldedFigureEntry> = {}): Promise<OristudioCpFoldedFigureEntry> {
  const handle = arena.take();
  retainFoldedFigureHandle(handle);
  const figure: OristudioCpFoldedFigureEntry = {
    id: 'generated-1',
    title: 'Folded model 1',
    handle,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 0,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    placement: IDENTITY_FOLDED_PLACEMENT,
    snapshot: snapshot(false),
    renderSnapshot: renderSnapshot(),
    sourceBounds: foldedSourceBounds(LINES),
    sourceFingerprint: null,
    sourceLineIds: [1, 2],
    error: null,
    ...overrides,
  };
  await foldedFigureGesture.run('verb', 'Fold model', () => {
    useWorkspaceStore.setState({ oristudioCpFoldedFigures: [...figures(), figure] });
  });
  return figure;
}

const state = () => useWorkspaceStore.getState();
const figures = () => state().oristudioCpFoldedFigures;

/** Every figure live or in history, none of them waiting. */
function everyFigure(): OristudioCpFoldedFigureEntry[] {
  return [
    ...figures(),
    ...state().oristudioCpHistoryPast.flatMap((entry) => entry.foldedFigures ?? []),
    ...state().oristudioCpHistoryFuture.flatMap((entry) => entry.foldedFigures ?? []),
  ];
}

/** Every slot referred to is live and counted once per reference; every live slot is referred to. */
function expectEachFoldHeldOnce() {
  const references = new Map<number, number>();
  for (const figure of everyFigure()) {
    if (figure.handle != null) references.set(figure.handle, (references.get(figure.handle) ?? 0) + 1);
  }
  for (const [handle, count] of references) {
    expect(arena.live.has(handle), `slot ${handle} is referred to but free`).toBe(true);
    expect(foldedFigureHandleRefCount(handle), `slot ${handle}'s count`).toBe(count);
  }
  for (const handle of arena.live) {
    expect(references.has(handle), `slot ${handle} is taken but nothing refers to it`).toBe(true);
  }
}

/** `press`, its kernel answer held until an undo (as the menu takes one) has run. */
async function undoWhile(press: () => Promise<unknown>) {
  gate.close();
  const running = press();
  await vi.waitFor(() => expect(figures().some((figure) => figure.status === 'loading')).toBe(true));
  endOpenCanvasSessions('history');
  await state().undo();
  gate.open();
  await running;
}

beforeEach(async () => {
  dropFoldedSolutionCursor();
  foldedFigureGesture.abortAll();
  await resetFoldedFigureHandles();
  resetFoldedFiguresAtRestForTests();
  arena.live.clear();
  arena.freed.length = 0;
  gate.pending = null;
  gateway.open.mockReset();
  useWorkspaceStore.setState({
    activePanelId: 'crease-pattern',
    oristudioCpDocument: cpState(),
    oristudioCpFoldedFigures: [],
    oristudioCpActiveFoldedFigureId: null,
    oristudioCpHistoryPast: [],
    oristudioCpHistoryFuture: [],
    oristudioCpError: null,
  });
});

describe('the registry', () => {
  const figure = { id: 'a', handle: 3, status: 'ready' } as OristudioCpFoldedFigureEntry;
  const loading = { ...figure, status: 'loading' } as OristudioCpFoldedFigureEntry;

  it('reads a figure a press is working on as it was, a placeholder not at all, and lets go when the press ends', () => {
    const list = [loading];
    expect(foldedFiguresAtRest(list)).toBe(list);
    const release = holdFoldedFigureAtRest(figure);
    expect(foldedFiguresAtRest(list)).toEqual([figure]);
    // Only while it waits: landed, it is what it is.
    const landed = [{ ...figure, handle: 9 }];
    expect(foldedFiguresAtRest(landed)).toBe(landed);
    release();
    expect(foldedFiguresAtRest(list)).toBe(list);

    const draft = { id: 'b', handle: null, status: 'loading' } as OristudioCpFoldedFigureEntry;
    const letGo = holdFoldedPlaceholderAtRest('b', 'a');
    expect(foldedFiguresAtRest([figure, draft])).toEqual([figure]);
    // Selected, it reads as what was selected before the press; landed, as itself.
    expect(foldedSelectionAtRest('b', [figure, draft])).toBe('a');
    expect(foldedSelectionAtRest('b', [figure, { ...draft, status: 'ready' }])).toBe('b');
    expect(foldedSelectionAtRest('a', [figure, draft])).toBe('a');
    letGo();
    expect(foldedFiguresAtRest([figure, draft])).toEqual([figure, draft]);
    expect(foldedSelectionAtRest('b', [figure, draft])).toBe('b');
  });

  it('never trades a figure for one on another fold, so history’s handle counts hold', () => {
    const release = holdFoldedFigureAtRest(figure);
    const elsewhere = [{ ...loading, handle: 4 }];
    expect(foldedFiguresAtRest(elsewhere)).toBe(elsewhere);
    release();
  });

  it('lets go only of its own hold', () => {
    const first = holdFoldedFigureAtRest(figure);
    const again = { ...figure, title: 'again' } as OristudioCpFoldedFigureEntry;
    const second = holdFoldedFigureAtRest(again);
    first();
    expect(foldedFiguresAtRest([loading])).toEqual([again]);
    second();
  });
});

describe('an undo while a press folds, then a redo', () => {
  it.each([
    ['a Refold', 'Refold folded model', (id: string) => state().refoldOristudioCpFoldedFigure(id)],
    ['Another solution', 'Show another solution', (id: string) => showAnotherFoldedSolution(id, t)],
    ['a step back', 'Show previous solution', (id: string) => showPreviousFoldedSolution(id, t)],
  ] as const)('brings back the figure as it was before %s, never waiting', async (_what, label, press) => {
    const figure = await foldedAsEntry({ snapshot: { ...snapshot(false), discovered_fold_cases: 2, current_fold_case: 2 } });
    await foldedFigureGesture.run('verb', 'Rotate folded form', () =>
      state().setOristudioCpFoldedFigurePlacement(figure.id, { rotation: 1 })
    );
    const turned = figures()[0]!;

    await undoWhile(() => (label === 'Refold folded model' ? foldedFigureGesture.run('verb', label, () => press(figure.id)) : press(figure.id)));
    await state().redo();

    expect(figures()).toHaveLength(1);
    expect(figures()[0]).toMatchObject({ id: figure.id, handle: turned.handle, status: 'ready', placement: turned.placement });
    expect(everyFigure().some((entry) => entry.status === 'loading')).toBe(false);
    expectEachFoldHeldOnce();
  });

  it.each([
    ['a fold', () => foldedFigureGesture.run('verb', 'Fold model', () => state().foldOristudioCpDocument({ startingFaceId: 1, lineIds: [1, 2] }))],
    ['a Duplicate', () => foldedFigureGesture.run('verb', 'Duplicate folded model', () => state().duplicateOristudioCpFoldedFigure('generated-1'))],
  ] as const)('never brings back the placeholder of %s', async (_what, press) => {
    const figure = await foldedAsEntry();
    await foldedFigureGesture.run('verb', 'Rotate folded form', () =>
      state().setOristudioCpFoldedFigurePlacement(figure.id, { rotation: 1 })
    );

    await undoWhile(press);
    await state().redo();

    expect(figures().map((entry) => [entry.id, entry.status])).toEqual([[figure.id, 'ready']]);
    expect(everyFigure().some((entry) => entry.status === 'loading')).toBe(false);
    expectEachFoldHeldOnce();
  });

  it('records the selection as it was before a Duplicate whose placeholder it leaves out', async () => {
    const figure = await foldedAsEntry();
    state().setOristudioCpActiveFoldedFigure(figure.id);
    await foldedFigureGesture.run('verb', 'Rotate folded form', () =>
      state().setOristudioCpFoldedFigurePlacement(figure.id, { rotation: 1 })
    );

    // The copy's placeholder takes the selection while it folds; the undo's entry is taken meanwhile.
    await undoWhile(() =>
      foldedFigureGesture.run('verb', 'Duplicate folded model', () => state().duplicateOristudioCpFoldedFigure(figure.id))
    );
    const pushed = state().oristudioCpHistoryFuture[0]!;
    expect(pushed.foldedFigures?.map((entry) => entry.id)).toEqual([figure.id]);
    expect(pushed.activeFoldedFigureId).toBe(figure.id);

    await state().redo();
    expect(state().oristudioCpActiveFoldedFigureId).toBe(figure.id);
    // No entry names a selected figure it doesn't hold.
    for (const entry of [...state().oristudioCpHistoryPast, ...state().oristudioCpHistoryFuture]) {
      const selected = entry.activeFoldedFigureId ?? null;
      if (selected === null) continue;
      expect(entry.foldedFigures?.some((each) => each.id === selected), entry.label).toBe(true);
    }
  });

  it('brings back a constrained figure as it was before an Apply, or a step within its constraints', async () => {
    const figure = await foldedAsEntry({ snapshot: snapshot(true), layerOrder: held() });
    await foldedFigureGesture.run('verb', 'Rotate folded form', () =>
      state().setOristudioCpFoldedFigurePlacement(figure.id, { rotation: 1 })
    );
    const turned = figures()[0]!;
    const source = layerOrderSourceOf(
      { segments: LINES, starting_face_id: 1, aux_segments: [], digest: DIGEST },
      snapshot(true).model
    );

    const applied = twoConstraintRecord({ constraints: [[0, 1, 1]] });
    await undoWhile(() =>
      applyFoldedFigureLayerOrder(
        figure.id,
        { record: applied, relations: Uint32Array.of(1, 0), source },
        markFoldPress(state()),
        t
      )
    );
    await state().redo();
    expect(figures()[0]).toMatchObject({ handle: turned.handle, status: 'ready', layerOrder: held() });
    expect(everyFigure().some((entry) => entry.status === 'loading')).toBe(false);
    expectEachFoldHeldOnce();

    gateway.open.mockReturnValueOnce(
      scriptedSolutionCursor([
        {
          outcome: 'moved',
          applied: { record: twoConstraintRecord({ order: [[0, 2, -1]] }), relations: Uint32Array.of(0, 1), source },
          position: solutionPosition(2, 3),
          counted: true,
        },
      ])
    );
    await undoWhile(() => showAnotherFoldedSolution(figure.id, t));
    await state().redo();
    expect(figures()[0]).toMatchObject({ handle: turned.handle, status: 'ready', layerOrder: held() });
    expect(everyFigure().some((entry) => entry.status === 'loading')).toBe(false);
    expectEachFoldHeldOnce();
  });
});
