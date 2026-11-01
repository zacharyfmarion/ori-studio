// @vitest-environment jsdom
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type {
  OristudioCpDocumentState,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureSnapshot,
  OristudioCpFoldedRenderSnapshot,
  OristudioCpFoldSource,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';
import { IDENTITY_FOLDED_PLACEMENT } from '../../engine/oristudioCpTypes';
import type { LayerOrderSolutionStep } from '../../layer-order/host/hostEngineGateway';
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';

/**
 * Another solution within a constrained Edit figure's constraints
 * (`implementation-plans/layer-order-dialog.md`, row H6, D9), through the
 * store and the verbs, with the CP kernel and the host engine's solutions
 * cursor stood in for: the cursor is made on the first press and never
 * before, stepped by later ones, and let go whenever the figure stops
 * holding what it last landed — an undo or a redo, an Apply, an edit to its
 * creases, a Delete, a document closing. Each step that moved is one undo
 * entry, a new fold of the step's order with the step's record; every other
 * answer writes nothing, and says why when it is news. An unconstrained
 * figure makes exactly the kernel calls it always made.
 */

/** The kernel, as the store reaches it: every call logged by its export's name, in order. */
const kernel = vi.hoisted(() => ({
  calls: [] as string[],
  freed: [] as number[],
  nextHandle: 9,
  digest: '00000000c0ffee01',
  /** What `foldOristudioCpWithOrder` answers: a fold on the next handle unless a test says otherwise. */
  foldWithOrder: null as null | ((...args: unknown[]) => Promise<unknown>),
}));

vi.mock('./oristudioCpRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./oristudioCpRuntime')>();
  const logged =
    <A extends unknown[], R>(name: string, run: (...args: A) => R) =>
    (...args: A): R => {
      kernel.calls.push(name);
      return run(...args);
    };
  return {
    ...actual,
    freeOristudioCpFoldedFigure: logged('freeOristudioCpFoldedFigure', async (handle: number) => {
      kernel.freed.push(handle);
    }),
    getOristudioCpFoldedFigureSource: logged('getOristudioCpFoldedFigureSource', async () => kernelSource()),
    getOristudioCpSelectionFoldSource: logged('getOristudioCpSelectionFoldSource', async () => kernelSource()),
    foldOristudioCpWithOrder: logged('foldOristudioCpWithOrder', async (...args: unknown[]) => {
      if (kernel.foldWithOrder) return kernel.foldWithOrder(...args);
      const handle = kernel.nextHandle++;
      return { status: 'folded', handle, snapshot: snapshot({ shown_order: 'given' }) };
    }),
    getOristudioCpFoldedFigureDigest: logged('getOristudioCpFoldedFigureDigest', async () => kernel.digest),
    getOristudioCpFoldedFigureRenderSnapshot: logged(
      'getOristudioCpFoldedFigureRenderSnapshot',
      async (handle: number) => picture(handle)
    ),
    foldOristudioCpFigureAnother: logged('foldOristudioCpFigureAnother', async () =>
      snapshot({ discovered_fold_cases: 2, current_fold_case: 2 })
    ),
    foldOristudioCpFigureToCase: logged('foldOristudioCpFigureToCase', async () => ({
      snapshot: snapshot({ discovered_fold_cases: 2, current_fold_case: 1 }),
      discovered_case_numbers: [1, 2],
    })),
    setOristudioCpFoldedFigureModel: logged(
      'setOristudioCpFoldedFigureModel',
      async (_handle: number, model: OristudioCpFoldedFigureSnapshot['model']) => ({ ...snapshot(), model })
    ),
    isCurrentOristudioCpDocumentState: () => true,
  };
});

/** The host engine's door: each cursor the press opens is the test's to script. */
const gateway = vi.hoisted(() => ({ open: vi.fn(), resolve: vi.fn() }));
vi.mock('../../layer-order/host/hostEngineGateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../layer-order/host/hostEngineGateway')>()),
  openLayerOrderSolutionCursor: (...args: unknown[]) => gateway.open(...args),
  // A Refold of a constrained figure resolves its record on the creases as they are (H4).
  resolveLayerOrder: (...args: unknown[]) => gateway.resolve(...args),
}));

const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  track: analytics.track,
}));

/** Whether the kernel's cancel transport is there (a cross-origin isolated page, or desktop); a test may take it away. */
const cancellation = vi.hoisted(() => ({
  next: 0,
  available: true,
  beginFoldRun: () => ++cancellation.next,
  cancelFoldRun: () => {},
  foldCancellationAvailable: () => cancellation.available,
}));
vi.mock('../../lib/foldCancellation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/foldCancellation')>()),
  beginFoldRun: () => cancellation.beginFoldRun(),
  cancelFoldRun: () => cancellation.cancelFoldRun(),
  foldCancellationAvailable: () => cancellation.foldCancellationAvailable(),
}));

const toasts = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), message: vi.fn(), dismiss: vi.fn() });
  return { toast };
});
vi.mock('sonner', () => ({ toast: toasts.toast }));

import { useWorkspaceStore } from './store';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import { foldedFigureLayerOrder } from '../../lib/layerOrder/foldedFigureLayerOrder';
import { layerOrderRecordOfSize, twoConstraintRecord } from '../../lib/layerOrder/layerOrderRecord.fixtures';
import { LAYER_ORDER_RECORD_MAX_BYTES } from '../../lib/layerOrder/layerOrderRecord';
import { layerOrderSourceOf } from '../../lib/layerOrder/layerOrderSource';
import { useLayoutStore } from '../layoutStore';
import { useLayerOrderDialogStore } from '../../layer-order/dialog/layerOrderDialogStore';
import { FOLDED_SOLUTION_CURSOR_IDLE_MS } from '../../cp-workspace/folded/foldedSolutionCursor';
import {
  foldedFigureHandleRefCount,
  resetFoldedFigureHandles,
  retainFoldedFigureHandle,
} from '../../cp-workspace/folded/foldedFigureHandles';
import { foldedFigureGesture } from '../../cp-workspace/folded/foldedFigureGesture';
import { foldedSourceBounds } from '../../cp-workspace/folded/foldedFigureStaleness';
import {
  deleteFoldedFigure,
  refoldFoldedFigure,
  showAnotherFoldedSolution,
  showPreviousFoldedSolution,
} from '../../cp-workspace/folded/foldedFigureVerbs';
import {
  dropFoldedSolutionCursor,
  foldedSolutionCursorFigure,
  foldedSolutionPlace,
} from '../../cp-workspace/folded/foldedSolutionCursor';
import {
  scriptedSolutionCursor,
  solutionPosition,
  type ScriptedSolutionCursor,
  type ScriptedSolutionStep,
} from '../../cp-workspace/folded/foldedSolutionCursor.fixtures';
import { applyFoldedFigureLayerOrder } from '../../cp-workspace/folded/openFoldedFigureLayerOrder';
import { markFoldPress } from '../../cp-workspace/folded/foldPress';
import { endOpenCanvasSessions } from '../../cp-workspace/canvasObjects/canvasSessions';
import { foldedFiguresAtRest, resetFoldedFiguresAtRestForTests } from '../../cp-workspace/folded/foldedFiguresAtRest';

const t = ((_key: string, fallback: string, options?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/gu, (_match, name: string) => String(options?.[name] ?? ''))) as unknown as TFunction;

function line(a: { x: number; y: number }, b: { x: number; y: number }, color: 'Red1' | 'Blue2'): OristudioCpLineSegment {
  return { a, b, color, active: 'Inactive0', selected: 0, customized: 0, customized_color: { red: 0, green: 0, blue: 0 } };
}

/** The X the figure is folded from, mountain and valley. */
const LINES = [line({ x: 0, y: 0 }, { x: 1, y: 1 }, 'Red1'), line({ x: 1, y: 0 }, { x: 0, y: 1 }, 'Blue2')];

function kernelSource(): OristudioCpFoldSource {
  return { segments: LINES, starting_face_id: 1, aux_segments: [], digest: kernel.digest };
}

function picture(handle: number): OristudioCpFoldedRenderSnapshot {
  return { schema_version: 1, fixture: null, pass: `fold ${handle}`, primitives: [] } as OristudioCpFoldedRenderSnapshot;
}

function snapshot(overrides: Partial<OristudioCpFoldedFigureSnapshot> = {}): OristudioCpFoldedFigureSnapshot {
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
    find_another_overlap_valid: false,
    outcome: 'Solved',
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
    ...overrides,
  } as OristudioCpFoldedFigureSnapshot;
}

function cpState(lines: OristudioCpLineSegment[] = LINES): OristudioCpDocumentState {
  const document = createStarterOristudioCpDocument();
  return {
    handle: 4,
    loadSerial: 1,
    document: { ...document, crease_pattern: { ...document.crease_pattern, line_segments: lines } },
    geometry: null,
    summary: {
      title: 'Untitled CP',
      line_segments: lines.length,
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

/** A record as the figure holds it. */
function held(record: LayerOrderRecord) {
  const made = foldedFigureLayerOrder(record);
  if (!made.ok) throw new Error('the fixture record encodes');
  return made.layerOrder;
}

/** The record the figure starts on, and one per solution a step lands on: the same constraints, each its own order. */
const RECORD = twoConstraintRecord();
const solutionRecord = (n: number) => twoConstraintRecord({ order: [[0, 2, n % 2 === 0 ? 1 : -1]], faces: [...RECORD.faces.slice(0, 2), { at: [0.5, 0.75 + n / 1000], area: 0.25 }] });

const MODEL = snapshot().model;
const SOURCE = () => layerOrderSourceOf(kernelSource(), MODEL);

/** A step that moved to `index` of `n`, onto solution `index`'s record. */
function movedTo(index: number, n: number, exact = true): LayerOrderSolutionStep {
  return {
    outcome: 'moved',
    applied: { record: solutionRecord(index), relations: Uint32Array.of(0, 1, index, 2), source: SOURCE() },
    position: solutionPosition(index, n, exact),
    counted: true,
  };
}

const state = () => useWorkspaceStore.getState();
const figureNow = () => state().oristudioCpFoldedFigures[0]!;
const history = () => state().oristudioCpHistoryPast.map((entry) => entry.label);

/** A constrained flat figure on handle 3 (unless `overrides` says otherwise), the store holding only it. */
function seed(overrides: Partial<OristudioCpFoldedFigureEntry> = {}): OristudioCpFoldedFigureEntry {
  const figure: OristudioCpFoldedFigureEntry = {
    id: 'generated-1',
    title: 'Folded model 1',
    handle: 3,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 0,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    placement: IDENTITY_FOLDED_PLACEMENT,
    snapshot: snapshot({ shown_order: 'given' }),
    renderSnapshot: picture(3),
    sourceBounds: foldedSourceBounds(LINES),
    sourceFingerprint: null,
    sourceLineIds: [1, 2],
    error: null,
    layerOrder: held(RECORD),
    ...overrides,
  };
  if (figure.handle !== null) retainFoldedFigureHandle(figure.handle);
  useWorkspaceStore.setState({
    oristudioCpFoldedFigures: [figure],
    oristudioCpActiveFoldedFigureId: figure.id,
    oristudioCpHistoryPast: [],
    oristudioCpHistoryFuture: [],
    dirty: false,
  });
  return figure;
}

/** The next cursor a press opens answers `steps` in turn. */
function script(...steps: ScriptedSolutionStep[]): ScriptedSolutionCursor {
  const cursor = scriptedSolutionCursor(steps);
  gateway.open.mockReturnValueOnce(cursor);
  return cursor;
}

const cycled = () => analytics.track.mock.calls.filter(([name]) => name === 'fold solution cycled').map(([, properties]) => properties);

beforeEach(async () => {
  dropFoldedSolutionCursor();
  foldedFigureGesture.abortAll();
  await resetFoldedFigureHandles();
  resetFoldedFiguresAtRestForTests();
  kernel.calls.length = 0;
  kernel.freed.length = 0;
  kernel.nextHandle = 9;
  kernel.foldWithOrder = null;
  gateway.open.mockReset();
  gateway.resolve.mockReset();
  analytics.track.mockClear();
  toasts.toast.mockClear();
  toasts.toast.error.mockClear();
  toasts.toast.message.mockClear();
  toasts.toast.dismiss.mockClear();
  useWorkspaceStore.setState({
    activePanelId: 'crease-pattern',
    oristudioCpDocument: cpState(),
    oristudioCpFoldedFigures: [],
    oristudioCpActiveFoldedFigureId: null,
    oristudioCpHistoryPast: [],
    oristudioCpHistoryFuture: [],
    oristudioCpError: null,
    error: null,
  });
});

describe('the cursor’s life', () => {
  it('is made on the first press, never on selection, and the step lands as one entry with its own record', async () => {
    const figure = seed();
    state().setOristudioCpActiveFoldedFigure(figure.id);
    expect(gateway.open).not.toHaveBeenCalled();
    expect(foldedSolutionPlace(figure)).toBeNull();
    // (Selecting redraws its selection marker, as it always has.)
    kernel.calls.length = 0;

    const cursor = script(movedTo(2, 3, false));
    await expect(showAnotherFoldedSolution(figure.id, t)).resolves.toBe(true);

    // Made on the press, over the figure's own fold and its record (Edit's frame is the crease pattern's).
    expect(gateway.open).toHaveBeenCalledTimes(1);
    expect(gateway.open).toHaveBeenCalledWith(SOURCE(), RECORD);
    expect(cursor.asked).toEqual([{ direction: 'next', by: { picture: 'front' } }]);
    // Folded as an Apply is: the step's order on the very segments, its faces checked, drawn, adopted.
    expect(kernel.calls).toEqual([
      'getOristudioCpFoldedFigureSource',
      'foldOristudioCpWithOrder',
      'getOristudioCpFoldedFigureDigest',
      'getOristudioCpFoldedFigureRenderSnapshot',
    ]);
    expect(figureNow()).toMatchObject({
      handle: 9,
      status: 'ready',
      renderSnapshot: picture(9),
      snapshot: { shown_order: 'given' },
      layerOrder: held(solutionRecord(2)),
    });
    expect(history()).toEqual(['Show another solution']);
    expect(state().dirty).toBe(true);
    // The fold before stays with history: an undo shows the order it draws.
    expect(foldedFigureHandleRefCount(3)).toBe(1);
    expect(foldedFigureHandleRefCount(9)).toBe(1);
    expect(kernel.freed).toEqual([]);
    // Where it stands now, for the readout.
    expect(foldedSolutionPlace(figureNow())).toEqual({ position: solutionPosition(2, 3, false), counted: true });
    expect(cycled()).toEqual([{ direction: 'next', solution_count_bucket: expect.any(String), constrained: true }]);
  });

  it('steps on and back with the same cursor, one entry a press', async () => {
    const figure = seed();
    const cursor = script(movedTo(2, 3), movedTo(3, 3), movedTo(2, 3));
    await showAnotherFoldedSolution(figure.id, t);
    await showAnotherFoldedSolution(figure.id, t);
    await showPreviousFoldedSolution(figure.id, t);

    expect(gateway.open).toHaveBeenCalledTimes(1);
    expect(cursor.asked.map(({ direction }) => direction)).toEqual(['next', 'next', 'previous']);
    // The source was read once, for the cursor; each step folds on what the cursor answered.
    expect(kernel.calls.filter((call) => call === 'getOristudioCpFoldedFigureSource')).toHaveLength(1);
    expect(figureNow()).toMatchObject({ handle: 11, layerOrder: held(solutionRecord(2)) });
    expect(history()).toEqual(['Show another solution', 'Show another solution', 'Show previous solution']);
    expect(cycled().map((event) => (event as { direction: string }).direction)).toEqual(['next', 'next', 'previous']);
    expect(cursor.closed).toBe(false);
  });

  it('is let go on an undo of a step, which shows the order before; the next press makes a fresh one', async () => {
    const figure = seed();
    const first = script(movedTo(2, 3));
    await showAnotherFoldedSolution(figure.id, t);

    await state().undo();
    expect(figureNow()).toMatchObject({ handle: 3, layerOrder: held(RECORD), renderSnapshot: picture(3) });
    expect(first.closed).toBe(true);
    expect(foldedSolutionCursorFigure()).toBeNull();
    expect(foldedSolutionPlace(figureNow())).toBeNull();

    // Redo puts the stepped fold back, with no cursor: none is made until a press.
    await state().redo();
    expect(figureNow()).toMatchObject({ handle: 9, layerOrder: held(solutionRecord(2)) });
    expect(foldedSolutionCursorFigure()).toBeNull();
    expect(gateway.open).toHaveBeenCalledTimes(1);

    const second = script(movedTo(3, 3));
    await showAnotherFoldedSolution(figure.id, t);
    // From the record the figure holds now: the redone step's.
    expect(gateway.open).toHaveBeenLastCalledWith(SOURCE(), solutionRecord(2));
    expect(second.asked).toHaveLength(1);
    expect(figureNow().layerOrder).toEqual(held(solutionRecord(3)));
  });

  it('is let go when an Apply gives the figure another record', async () => {
    const figure = seed();
    const cursor = script(movedTo(2, 3));
    await showAnotherFoldedSolution(figure.id, t);
    const applied = twoConstraintRecord({ constraints: [[0, 1, 1]] });
    await applyFoldedFigureLayerOrder(
      figure.id,
      { record: applied, relations: Uint32Array.of(1, 0), source: SOURCE() },
      markFoldPress(state()),
      t
    );
    expect(figureNow().layerOrder).toEqual(held(applied));
    expect(cursor.closed).toBe(true);
    expect(foldedSolutionCursorFigure()).toBeNull();
  });

  it('is let go when the creases it was folded from change, and kept through an edit elsewhere', async () => {
    const figure = seed();
    const cursor = script(movedTo(2, 3));
    await showAnotherFoldedSolution(figure.id, t);

    // A crease far outside the figure's creases: its creases are as they were.
    useWorkspaceStore.setState({ oristudioCpDocument: cpState([...LINES, line({ x: 5, y: 5 }, { x: 6, y: 5 }, 'Red1')]) });
    expect(cursor.closed).toBe(false);
    expect(foldedSolutionPlace(figureNow())).not.toBeNull();

    // One of its own creases moved.
    useWorkspaceStore.setState({
      oristudioCpDocument: cpState([LINES[0]!, line({ x: 1, y: 0 }, { x: 0, y: 0.9 }, 'Blue2')]),
    });
    expect(cursor.closed).toBe(true);
    expect(foldedSolutionCursorFigure()).toBeNull();
  });

  it('is let go when Refold refolds the figure in its order (H4), and when a refold keeps it flagged', async () => {
    const figure = seed();
    const first = script(movedTo(2, 3));
    await showAnotherFoldedSolution(figure.id, t);
    gateway.resolve.mockResolvedValueOnce({
      outcome: 'applied',
      applied: { record: solutionRecord(2), relations: Uint32Array.of(0, 1, 2, 2), source: SOURCE() },
      record: solutionRecord(2),
      attention: null,
      found: {},
    });
    await refoldFoldedFigure(figure.id, t);
    // A new fold, in its order: the cursor's session shows the fold before.
    expect(figureNow()).toMatchObject({ handle: 10, layerOrder: held(solutionRecord(2)) });
    expect(first.closed).toBe(true);
    expect(foldedSolutionCursorFigure()).toBeNull();
    expect(foldedSolutionPlace(figureNow())).toBeNull();
    // The refold let go of its hold at rest: a figure waiting on its old fold reads as it is, not as the refold found it.
    const waiting = { ...figureNow(), handle: 9, status: 'loading' as const };
    expect(foldedFiguresAtRest([waiting])).toEqual([waiting]);

    const second = script(movedTo(3, 3));
    await showAnotherFoldedSolution(figure.id, t);
    expect(second.closed).toBe(false);
    gateway.resolve.mockResolvedValueOnce({
      outcome: 'clash',
      clashing: [0],
      record: solutionRecord(3),
      attention: { reason: 'conflict', count: 1 },
      found: {},
    });
    await refoldFoldedFigure(figure.id, t);
    // Kept, its picture as it was and its record flagged (D10): its ‹ › wait for a review.
    expect(figureNow().layerOrder).not.toEqual(held(solutionRecord(3)));
    expect(second.closed).toBe(true);
    expect(foldedSolutionCursorFigure()).toBeNull();
  });

  it('is let go when the figure is deleted, and when the document closes', async () => {
    const figure = seed();
    const deleted = script(movedTo(2, 3));
    await showAnotherFoldedSolution(figure.id, t);
    await deleteFoldedFigure(figure.id, t);
    expect(deleted.closed).toBe(true);

    await state().undo();
    const closed = script(movedTo(3, 3));
    await showAnotherFoldedSolution(figure.id, t);
    expect(foldedSolutionCursorFigure()).toBe(figure.id);
    await state().clearOristudioCpFoldedFigures();
    expect(closed.closed).toBe(true);
    expect(foldedSolutionCursorFigure()).toBeNull();
  });

  it('asks where it stands again when the figure turns over, and reads nothing until it answers', async () => {
    const figure = seed();
    const cursor = scriptedSolutionCursor([movedTo(2, 3)], [{ position: solutionPosition(1, 2), counted: true }]);
    gateway.open.mockReturnValueOnce(cursor);
    await showAnotherFoldedSolution(figure.id, t);
    expect(foldedSolutionPlace(figureNow())).toMatchObject({ position: solutionPosition(2, 3) });

    await state().updateOristudioCpFoldedFigureModel(figure.id, { state: 'Back1' });
    expect(cursor.placesAsked).toEqual([{ picture: 'back' }]);
    await vi.waitFor(() => expect(foldedSolutionPlace(figureNow())).toEqual({ position: solutionPosition(1, 2), counted: true }));
    // A turn over is no step: the cursor stays, and nothing was written.
    expect(cursor.closed).toBe(false);
    expect(figureNow().layerOrder).toEqual(held(solutionRecord(2)));
  });

  it.each([
    ['the selection moves off the figure', () => state().setOristudioCpActiveFoldedFigure(null)],
    ['the workspace switches', () => useLayoutStore.setState({ activeWorkspace: 'diagram' })],
    [
      'the Layer order dialog opens',
      () => useLayerOrderDialogStore.setState({ opening: { id: 99 } as never }),
    ],
  ] as const)('is let go, with its worker, when %s', async (_what, meanwhile) => {
    const workspace = useLayoutStore.getState().activeWorkspace;
    const figure = seed();
    const cursor = script(movedTo(2, 3));
    await showAnotherFoldedSolution(figure.id, t);
    expect(cursor.closed).toBe(false);
    try {
      meanwhile();
      expect(cursor.closed).toBe(true);
      expect(foldedSolutionCursorFigure()).toBeNull();
    } finally {
      useLayoutStore.setState({ activeWorkspace: workspace });
      useLayerOrderDialogStore.setState({ opening: null });
    }
  });

  it('is let go as a press that moved nothing ends, when the selection moved off its figure meanwhile', async () => {
    const figure = seed();
    let answer: ((step: LayerOrderSolutionStep) => void) | null = null;
    const cursor = script(() => new Promise((resolve) => (answer = resolve)));
    const press = showAnotherFoldedSolution(figure.id, t);
    await vi.waitFor(() => expect(answer).not.toBeNull());
    state().setOristudioCpActiveFoldedFigure(null);
    // Kept while the press runs: the press settles it when it ends.
    expect(cursor.closed).toBe(false);
    answer!({ outcome: 'end', position: solutionPosition(1, 3), counted: true });
    await press;
    expect(cursor.closed).toBe(true);
    expect(foldedSolutionCursorFigure()).toBeNull();
  });

  it('is let go after a minute with no press, and kept through presses', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const figure = seed();
      const cursor = script(movedTo(2, 3), movedTo(3, 3));
      await showAnotherFoldedSolution(figure.id, t);
      vi.advanceTimersByTime(FOLDED_SOLUTION_CURSOR_IDLE_MS - 1000);
      await showAnotherFoldedSolution(figure.id, t);
      vi.advanceTimersByTime(FOLDED_SOLUTION_CURSOR_IDLE_MS - 1000);
      expect(cursor.closed).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(cursor.closed).toBe(true);
      expect(foldedSolutionCursorFigure()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  /** One step, then the minute: the worker has gone, and where the figure's order lies is kept. */
  async function steppedThenRested(): Promise<ScriptedSolutionCursor> {
    const figure = seed();
    const cursor = script(movedTo(2, 3));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await showAnotherFoldedSolution(figure.id, t);
      vi.advanceTimersByTime(FOLDED_SOLUTION_CURSOR_IDLE_MS);
    } finally {
      vi.useRealTimers();
    }
    return cursor;
  }

  it('keeps where the figure’s order lies once the minute lets go of the worker, and the next press reads it until it answers', async () => {
    const first = await steppedThenRested();
    expect(first.closed).toBe(true);
    expect(foldedSolutionCursorFigure()).toBeNull();
    expect(foldedSolutionPlace(figureNow())).toEqual({ position: solutionPosition(2, 3), counted: true });
    // Turned over, nothing can ask where it stands on that side; turned back, it reads as it did.
    await state().updateOristudioCpFoldedFigureModel(figureNow().id, { state: 'Back1' });
    expect(foldedSolutionPlace(figureNow())).toBeNull();
    await state().updateOristudioCpFoldedFigureModel(figureNow().id, { state: 'Front0' });
    expect(foldedSolutionPlace(figureNow())).toEqual({ position: solutionPosition(2, 3), counted: true });

    let answer: ((step: LayerOrderSolutionStep) => void) | null = null;
    const second = script(() => new Promise((resolve) => (answer = resolve)));
    const press = showAnotherFoldedSolution(figureNow().id, t);
    await vi.waitFor(() => expect(answer).not.toBeNull());
    // A fresh cursor, restored from the record the figure holds, and the readout as it was meanwhile.
    expect(gateway.open).toHaveBeenLastCalledWith(SOURCE(), solutionRecord(2));
    expect(foldedSolutionPlace(figureNow())).toEqual({ position: solutionPosition(2, 3), counted: true });
    answer!(movedTo(3, 3));
    await press;
    expect(second.closed).toBe(false);
    expect(foldedSolutionPlace(figureNow())).toEqual({ position: solutionPosition(3, 3), counted: true });
  });

  it.each([
    ['the selection moves off the figure', () => state().setOristudioCpActiveFoldedFigure(null)],
    ['the workspace switches', () => useLayoutStore.setState({ activeWorkspace: 'diagram' })],
    ['the Layer order dialog opens', () => useLayerOrderDialogStore.setState({ opening: { id: 99 } as never })],
    [
      'one of its creases moves',
      () =>
        useWorkspaceStore.setState({
          oristudioCpDocument: cpState([LINES[0]!, line({ x: 1, y: 0 }, { x: 0, y: 0.9 }, 'Blue2')]),
        }),
    ],
  ] as const)('forgets where the rested figure’s order lay when %s', async (_what, meanwhile) => {
    const workspace = useLayoutStore.getState().activeWorkspace;
    await steppedThenRested();
    try {
      meanwhile();
    } finally {
      useLayoutStore.setState({ activeWorkspace: workspace });
      useLayerOrderDialogStore.setState({ opening: null });
      useWorkspaceStore.setState({ oristudioCpDocument: cpState() });
      state().setOristudioCpActiveFoldedFigure(figureNow().id);
    }
    // Put back as it was, the figure holds what it did; the place is not.
    expect(foldedSolutionPlace(figureNow())).toBeNull();
  });

  it('forgets where the rested figure’s order lay on an undo, and a redo brings back no readout', async () => {
    await steppedThenRested();
    await state().undo();
    await state().redo();
    expect(figureNow()).toMatchObject({ handle: 9, layerOrder: held(solutionRecord(2)) });
    expect(foldedSolutionPlace(figureNow())).toBeNull();
  });

  it('goes to the figure last stepped: one cursor, one worker, at a time', async () => {
    const one = seed();
    const two = { ...one, id: 'generated-2', handle: 5 };
    retainFoldedFigureHandle(5);
    useWorkspaceStore.setState({ oristudioCpFoldedFigures: [one, two] });
    const first = script(movedTo(2, 3));
    await showAnotherFoldedSolution(one.id, t);
    const second = script(movedTo(2, 3));
    await showAnotherFoldedSolution(two.id, t);
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);
    expect(foldedSolutionCursorFigure()).toBe(two.id);
  });
});

describe('a press that moves nothing', () => {
  it('at the end writes nothing and says nothing, and the ends wait from then on', async () => {
    const figure = seed();
    script({ outcome: 'end', position: solutionPosition(1, 3), counted: true });
    await expect(showPreviousFoldedSolution(figure.id, t)).resolves.toBe(false);
    expect(figureNow()).toBe(figure);
    expect(history()).toEqual([]);
    expect(state().dirty).toBe(false);
    expect(kernel.calls).toEqual(['getOristudioCpFoldedFigureSource']);
    expect(toasts.toast).not.toHaveBeenCalled();
    expect(toasts.toast.error).not.toHaveBeenCalled();
    expect(foldedSolutionPlace(figureNow())).toEqual({
      position: solutionPosition(1, 3),
      counted: true,
      ended: { previous: true, next: false },
    });
    expect(cycled()).toEqual([]);
  });

  it('at an end the count hasn’t reached says nothing either: E9 proved it, and › waits there', async () => {
    const figure = seed();
    const cursor = script({ outcome: 'end', position: solutionPosition(4, 4, false), counted: true });
    await expect(showAnotherFoldedSolution(figure.id, t)).resolves.toBe(false);
    expect(figureNow()).toBe(figure);
    expect(history()).toEqual([]);
    expect(toasts.toast.error).not.toHaveBeenCalled();
    // Kept: ‹ still steps back on the same worker.
    expect(cursor.closed).toBe(false);
    expect(foldedSolutionPlace(figureNow())).toEqual({
      position: solutionPosition(4, 4, false),
      counted: true,
      ended: { previous: false, next: true },
    });
  });

  // Running out of time is an answer, not a fault: said calmly (a message), the rest as errors.
  it.each([
    [
      'an engine that didn’t load',
      { outcome: 'lost', cause: 'load' },
      'Layer order couldn’t load, so the figure wasn’t changed. Reload Ori Studio to try again.',
      true,
      'Reload',
      'error',
    ],
    [
      'a lost engine',
      { outcome: 'lost', cause: 'crashed' },
      'Layer order stopped unexpectedly, so the figure wasn’t changed.',
      true,
      undefined,
      'error',
    ],
    [
      'a restore out of time (D10)',
      { outcome: 'timed_out', stage: 'restore' },
      'Couldn’t check this figure’s layer constraints in time, so it wasn’t changed.',
      false,
      'Keep trying',
      'message',
    ],
    [
      'a step out of time',
      { outcome: 'timed_out', stage: 'step' },
      'Couldn’t find another solution in time, so the figure wasn’t changed.',
      false,
      'Keep trying',
      'message',
    ],
    [
      'a record that needs attention',
      { outcome: 'unrestored', why: 'clash' },
      'This figure’s layer constraints need attention, so it can’t step through solutions. Open Layer order… to review them.',
      true,
      undefined,
      'error',
    ],
    [
      'a solution too large to save',
      { outcome: 'too_large' },
      'This layer order is too large to save with the figure, so it is unchanged.',
      true,
      undefined,
      'error',
    ],
  ] as const)('on %s writes nothing and says so', async (_what, answer, said, spent, offered, how) => {
    const figure = seed();
    const cursor = script(answer as LayerOrderSolutionStep);
    await expect(showAnotherFoldedSolution(figure.id, t)).resolves.toBe(false);
    expect(figureNow()).toBe(figure);
    expect(history()).toEqual([]);
    expect(kernel.calls).toEqual(['getOristudioCpFoldedFigureSource']);
    expect(toasts.toast[how]).toHaveBeenCalledTimes(1);
    expect(toasts.toast[how === 'error' ? 'message' : 'error']).not.toHaveBeenCalled();
    const [text, options] = toasts.toast[how].mock.calls[0] as [string, { id?: string; action?: { label: string } }];
    expect(text).toBe(said);
    // Each kind under an id of its own, the other kind's dismissed: sonner merges a toast into what its id
    // last showed, so a message under an error's id would be drawn as the error.
    const ids = { error: 'layer-order-step-0', message: 'layer-order-step-0-timed-out' };
    expect(options.id).toBe(ids[how]);
    expect(toasts.toast.dismiss).toHaveBeenCalledWith(ids[how === 'error' ? 'message' : 'error']);
    // Out of time offers to keep trying, longer; a load that failed, the reload that alone retries it.
    expect(options.action?.label).toBe(offered);
    // An engine gone, a record it can't restore or an order it can't save takes the cursor with it;
    // running out of time keeps it for Keep trying.
    expect(cursor.closed).toBe(spent);
    expect(foldedSolutionCursorFigure()).toBe(spent ? null : figure.id);
  });

  it('on an engine that didn’t load offline says to reconnect before the Reload', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    onTestFinished(() => onLine.mockRestore());
    const figure = seed();
    script({ outcome: 'lost', cause: 'load' });
    await expect(showAnotherFoldedSolution(figure.id, t)).resolves.toBe(false);
    expect(figureNow()).toBe(figure);
    expect(toasts.toast.error).toHaveBeenCalledTimes(1);
    const [text, options] = toasts.toast.error.mock.calls[0] as [string, { action?: { label: string } }];
    expect(text).toBe(
      'Layer order couldn’t load while offline, so the figure wasn’t changed. Reconnect, then reload Ori Studio to try again.'
    );
    expect(options.action?.label).toBe('Reload');
  });

  it('keeps trying, longer each time, on the same cursor, when asked', async () => {
    const figure = seed();
    // The restore runs out, then E9's search for the next solution, then it lands.
    const cursor = script({ outcome: 'timed_out', stage: 'restore' }, { outcome: 'timed_out', stage: 'step' }, movedTo(2, 3));
    await showAnotherFoldedSolution(figure.id, t);
    const keepTrying = () => {
      const calls = toasts.toast.message.mock.calls;
      (calls.at(-1)![1] as { action: { onClick: () => void } }).action.onClick();
    };
    keepTrying();
    await vi.waitFor(() => expect(cursor.triesAsked).toHaveLength(2));
    await vi.waitFor(() => expect(toasts.toast.message).toHaveBeenCalledTimes(2));
    // Each try says so under a toast of its own: one shown again under the id Keep trying just
    // dismissed would be lost in its exit.
    const ids = toasts.toast.message.mock.calls.map(([, options]) => (options as { id: string }).id);
    expect(new Set(ids).size).toBe(2);
    keepTrying();
    await vi.waitFor(() => expect(figureNow().handle).toBe(9));
    expect(cursor.triesAsked).toEqual([0, 1, 2]);
    expect(gateway.open).toHaveBeenCalledTimes(1);
    expect(history()).toEqual(['Show another solution']);
  });

  it('says the store’s own too-large refusal the same way, freeing the fold', async () => {
    const figure = seed();
    const huge = layerOrderRecordOfSize(LAYER_ORDER_RECORD_MAX_BYTES + 1);
    const moved = movedTo(2, 3) as Extract<LayerOrderSolutionStep, { outcome: 'moved' }>;
    script({ ...moved, applied: { ...moved.applied, record: huge } });
    await expect(showAnotherFoldedSolution(figure.id, t)).resolves.toBe(false);
    expect(kernel.freed).toEqual([9]);
    expect(figureNow()).toBe(figure);
    expect(toasts.toast.error.mock.calls[0]![0]).toBe('This layer order is too large to save with the figure, so it is unchanged.');
    expect(foldedSolutionCursorFigure()).toBeNull();
  });

  it('says nothing for a press whose figure was undone or deleted while it ran', async () => {
    for (const meanwhile of ['undo', 'delete'] as const) {
      dropFoldedSolutionCursor();
      toasts.toast.error.mockClear();
      toasts.toast.message.mockClear();
      const figure = seed();
      await foldedFigureGesture.run('verb', 'Rotate folded form', () =>
        state().setOristudioCpFoldedFigurePlacement(figure.id, { rotation: 1 })
      );
      let answer: ((step: LayerOrderSolutionStep) => void) | null = null;
      script(() => new Promise((resolve) => (answer = resolve)));
      const press = showAnotherFoldedSolution(figure.id, t);
      await vi.waitFor(() => expect(answer).not.toBeNull());
      if (meanwhile === 'undo') {
        endOpenCanvasSessions('history');
        await state().undo();
      } else {
        await deleteFoldedFigure(figure.id, t);
      }
      answer!({ outcome: 'end', position: solutionPosition(3, 3, false), counted: true });
      await press;
      expect(toasts.toast.error, meanwhile).not.toHaveBeenCalled();
      expect(toasts.toast, meanwhile).not.toHaveBeenCalled();
    }
  });

  it('offers Stop while the engine steps, whatever the kernel’s transport allows, and only what it allows for the fold after', async () => {
    cancellation.available = false;
    try {
      const figure = seed();
      let fold: (() => void) | null = null;
      kernel.foldWithOrder = () =>
        new Promise((resolve) => {
          fold = () => resolve({ status: 'folded', handle: 9, snapshot: snapshot({ shown_order: 'given' }) });
        });
      let answer: ((step: LayerOrderSolutionStep) => void) | null = null;
      script(() => new Promise((resolve) => (answer = resolve)));
      const press = showAnotherFoldedSolution(figure.id, t);
      await vi.waitFor(() => expect(answer).not.toBeNull());
      const run = () => Object.values(state().oristudioCpFoldRuns)[0]!;
      expect(run().cancellable).toBe(true);
      answer!(movedTo(2, 3));
      await vi.waitFor(() => expect(fold).not.toBeNull());
      // The kernel's fold: as stoppable as the transport makes it, here not at all.
      expect(run().cancellable).toBe(false);
      fold!();
      await expect(press).resolves.toBe(true);
    } finally {
      cancellation.available = true;
    }
  });

  it('a Stop ends the step through the fold run, quietly, and the cursor with it, on a page with no kernel transport', async () => {
    cancellation.available = false;
    onTestFinished(() => {
      cancellation.available = true;
    });
    const figure = seed();
    let signalled = false;
    const cursor = script(
      ({ signal }) =>
        new Promise<LayerOrderSolutionStep>((resolve) => {
          signal?.addEventListener('abort', () => {
            signalled = true;
            resolve({ outcome: 'cancelled' });
          });
        })
    );
    const press = showAnotherFoldedSolution(figure.id, t);
    // The step is running in the cursor, inside the fold run the indicator shows.
    await vi.waitFor(() => expect(cursor.asked).toHaveLength(1));
    expect(Object.keys(state().oristudioCpFoldRuns)).toHaveLength(1);
    expect(figureNow().status).toBe('loading');

    expect(state().stopOristudioCpFolds()).toBe(true);
    await expect(press).resolves.toBe(false);
    expect(signalled).toBe(true);
    expect(figureNow()).toBe(figure);
    expect(history()).toEqual([]);
    expect(toasts.toast.error).not.toHaveBeenCalled();
    expect(cursor.closed).toBe(true);
    expect(state().oristudioCpFoldRuns).toEqual({});
  });

  it('a fold the kernel refuses, or whose faces aren’t the cursor’s, is freed: nothing lands, and the cursor goes', async () => {
    const figure = seed();
    const cursor = script(movedTo(2, 3), movedTo(2, 3));
    kernel.foldWithOrder = async () => ({ status: 'refused', refusal: { code: 'order_not_drawn' } });
    await expect(showAnotherFoldedSolution(figure.id, t)).resolves.toBe(false);
    expect(figureNow()).toMatchObject({ handle: 3, status: 'ready', layerOrder: held(RECORD) });
    expect(state().oristudioCpError).toBe('Layer order couldn’t apply this order to Folded model 1. Its picture is unchanged.');
    expect(history()).toEqual([]);
    // Its session shows an order the figure never took.
    expect(cursor.closed).toBe(true);

    kernel.foldWithOrder = null;
    kernel.digest = '00000000c0ffee01';
    const again = script(movedTo(2, 3));
    const digest = vi.fn();
    kernel.foldWithOrder = async () => {
      digest();
      kernel.digest = 'ffffffffffffffff';
      return { status: 'folded', handle: 20, snapshot: snapshot({ shown_order: 'given' }) };
    };
    await expect(showAnotherFoldedSolution(figure.id, t)).resolves.toBe(false);
    expect(kernel.freed).toContain(20);
    expect(figureNow().handle).toBe(3);
    expect(again.closed).toBe(true);
    kernel.digest = '00000000c0ffee01';
  });

  it('an undo while the step folds lands it on nothing: its fold is freed, the cursor goes', async () => {
    const figure = seed();
    await foldedFigureGesture.run('verb', 'Rotate folded form', () =>
      state().setOristudioCpFoldedFigurePlacement(figure.id, { rotation: 1 })
    );
    let answer: (() => void) | null = null;
    kernel.foldWithOrder = () =>
      new Promise((resolve) => {
        answer = () => resolve({ status: 'folded', handle: 9, snapshot: snapshot({ shown_order: 'given' }) });
      });
    const cursor = script(movedTo(2, 3));
    const press = showAnotherFoldedSolution(figure.id, t);
    await vi.waitFor(() => expect(answer).not.toBeNull());
    endOpenCanvasSessions('history');
    await state().undo();
    answer!();
    await expect(press).resolves.toBe(false);
    expect(kernel.freed).toEqual([9]);
    expect(figureNow()).toMatchObject({ handle: 3, layerOrder: held(RECORD) });
    expect(cursor.closed).toBe(true);
  });
});

describe('what it steps by, and from', () => {
  it('steps every layer order with X-ray on (D5), and the pictures of the side the figure shows otherwise', async () => {
    seed({ displayStyle: 'Transparent3' });
    const xray = script(movedTo(2, 3));
    await showAnotherFoldedSolution('generated-1', t);
    expect(xray.asked[0]!.by).toBe('layer_order');

    dropFoldedSolutionCursor();
    seed({ snapshot: snapshot({ shown_order: 'given', model: { ...MODEL, state: 'Back1' } }) });
    const back = script(movedTo(2, 3));
    await showAnotherFoldedSolution('generated-1', t);
    expect(back.asked[0]!.by).toEqual({ picture: 'back' });
  });

  it('folds a figure reopened from a file from its creases as they stand, and it is live from then on', async () => {
    const figure = seed({ handle: null });
    script(movedTo(2, 3));
    await expect(showAnotherFoldedSolution(figure.id, t)).resolves.toBe(true);
    expect(kernel.calls[0]).toBe('getOristudioCpSelectionFoldSource');
    expect(gateway.open).toHaveBeenCalledWith(SOURCE(), RECORD);
    expect(figureNow()).toMatchObject({ handle: 9, status: 'ready', layerOrder: held(solutionRecord(2)) });
    expect(history()).toEqual(['Show another solution']);
    await state().undo();
    expect(figureNow()).toMatchObject({ handle: null, layerOrder: held(RECORD) });
  });

  it('refuses a figure it can’t step now, asking nothing of the engine', async () => {
    for (const overrides of [
      { status: 'loading' as const },
      { layerOrder: { kind: 'newer' as const, saved: {} } },
      { handle: null, sourceBounds: null },
      // Saved as clashing since an edit (D10): no solution fits until they are reviewed.
      { layerOrder: held({ ...RECORD, attention: { reason: 'conflict', count: 2 } }) },
    ]) {
      dropFoldedSolutionCursor();
      const figure = seed(overrides);
      await expect(state().stepOristudioCpFigureLayerOrder(figure.id, 'next')).resolves.toEqual({ status: 'blocked' });
    }
    expect(gateway.open).not.toHaveBeenCalled();
    expect(kernel.calls).toEqual([]);
  });

  it('keeps Oriedita’s search away from a chosen order, called directly', async () => {
    const figure = seed();
    await expect(state().foldAnotherOristudioCpFigure(figure.id)).resolves.toBe(false);
    await expect(state().foldOristudioCpFigureToCase(figure.id, 1)).resolves.toBe(false);
    expect(kernel.calls).toEqual([]);
    expect(figureNow()).toBe(figure);
  });
});

describe('an unconstrained figure (the parity guard)', () => {
  it('steps on and back with exactly the kernel calls it always made, and no cursor', async () => {
    const plain = seed({
      layerOrder: undefined,
      snapshot: snapshot({ discovered_fold_cases: 1, current_fold_case: 1, find_another_overlap_valid: true }),
    });
    await expect(showAnotherFoldedSolution(plain.id, t)).resolves.toBe(true);
    expect(kernel.calls).toEqual(['foldOristudioCpFigureAnother', 'getOristudioCpFoldedFigureRenderSnapshot']);
    kernel.calls.length = 0;
    await expect(showPreviousFoldedSolution(plain.id, t)).resolves.toBe(true);
    expect(kernel.calls).toEqual(['foldOristudioCpFigureToCase', 'getOristudioCpFoldedFigureRenderSnapshot']);
    expect(gateway.open).not.toHaveBeenCalled();
    expect(foldedSolutionCursorFigure()).toBeNull();
    expect(figureNow().handle).toBe(3);
    expect(history()).toEqual(['Show another solution', 'Show previous solution']);
    // Its events as they always were: no `constrained`.
    expect(cycled()).toEqual([
      { direction: 'next', solution_count_bucket: expect.any(String) },
      { direction: 'previous', solution_count_bucket: expect.any(String) },
    ]);
  });
});
