import {DEFAULT_CONNECTED_SPREAD} from '../../cp-workspace/folded/layerSpreadSettings';
import '../../layer-spread/captureWorker.testSupport';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import {
  foldedFigureHandleRefCount,
  resetFoldedFigureHandles,
  setFoldedFigureHandleFree,
} from '../../cp-workspace/folded/foldedFigureHandles';
import { sheetRegions } from '../../cp-workspace/sheets/cpSheetRegions';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { sheetWithCrease } from '../../lib/paper/paperScene.fixtures';
import {
  cpDocument,
  fakeCaptureRuntime,
  fakeFoldSource,
  fakeLayerOrderResolutions,
  halfFoldKernelScene,
  squareRenderSnapshot,
  movedLines,
  ORDERED_HANDLE,
  STEP_LAYER_ORDER,
  STEP_LAYER_ORDER_IN_SOURCE,
  stepLayerOrderJson,
  TWO_SQUARES,
  twoSquaresIndex,
} from './capture.fixtures';
import type { CpCaptureRuntime } from './captureFolded';
import { stepLayerOrderOf } from './captureLayerOrder';
import { DEFAULT_DIAGRAM_STYLE, setLinkedLayerOrder } from '../document/diagramDocument';
import type { LayerOrderDialogOutcome } from '../../layer-order/dialog/layerOrderDialogGateway';
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import type { LayerOrderRequest, LayerOrderSource } from '../../lib/layerOrder/layerOrderRequest';
import { diagramStepLayerOrderLook } from './stepLayerOrderActions';
import { createPoseController, linkedFoldKey } from './poseController';
import { ensureCpSheetIndex } from '../../cp-workspace/sheets/cpSheetIndex';
import { ringsBounds } from '../../layer-order/panes/layerPaneFigure';
import { stepsIn } from '../document/diagramSteps.fixtures';
import type { DiagramCpRender, DiagramLayerSpread } from '../document/diagramDocument';

const bindings = vi.hoisted(() => ({ runtime: null as CpCaptureRuntime | null }));
vi.mock('../../store/workspaceStore/cpFoldRuntimeBindings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/workspaceStore/cpFoldRuntimeBindings')>()),
  createCpCaptureRuntime: () => bindings.runtime,
}));
/** The pattern's sheets once it has moved; the fixture's until then. */
const pattern = vi.hoisted(() => ({ moved: null as unknown }));
vi.mock('../../cp-workspace/sheets/cpSheetIndex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cp-workspace/sheets/cpSheetIndex')>()),
  ensureCpSheetIndex: vi.fn(async () => pattern.moved ?? sheets),
  peekCpSheetIndex: vi.fn(() => pattern.moved ?? sheets),
}));
const engines = vi.hoisted(() => ({ listeners: new Set<(loss: { engine: string }) => void>() }));
vi.mock('../../engines/engineHost', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../engines/engineHost')>()),
  onEngineLost: (listener: (loss: { engine: string }) => void) => {
    engines.listeners.add(listener);
    return () => engines.listeners.delete(listener);
  },
}));
const toasts = vi.hoisted(() => ({ error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));
// A 3D figure's picture, with no window to build it in.
vi.mock('../../cp-workspace/folded/folded3dStoredScene', async (importOriginal) => {
  const { sheetWithCrease: drawn } = await import('../../lib/paper/paperScene.fixtures');
  return {
    ...(await importOriginal<typeof import('../../cp-workspace/folded/folded3dStoredScene')>()),
    folded3dFigureScene: () => drawn(),
  };
});
// The host engine, for a step with a layer order: the record's order applies, unless a test says otherwise.
const hostEngine = vi.hoisted(() => ({ resolveLayerOrder: vi.fn() }));
vi.mock('../../layer-order/host/hostEngineGateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../layer-order/host/hostEngineGateway')>()),
  resolveLayerOrder: hostEngine.resolveLayerOrder,
}));
const analytics = vi.hoisted(() => ({ trackDiagramPicturePosed: vi.fn(), trackLayerConstraintsNeedAttention: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...analytics,
}));
// The Layer order dialog, as its gateway answers a host: each test says how it ends (H8).
const dialog = vi.hoisted(() => ({
  outcome: null as null | ((request: LayerOrderRequest) => LayerOrderDialogOutcome | Promise<LayerOrderDialogOutcome>),
  openLayerOrderDialog: vi.fn(),
}));
vi.mock('../../layer-order/dialog/layerOrderDialogGateway', () => ({
  openLayerOrderDialog: dialog.openLayerOrderDialog,
}));

const sheets = twoSquaresIndex();
const [left] = sheetRegions(sheets);
const initialState = useWorkspaceStore.getInitialState();
const state = () => useWorkspaceStore.getState();
const document = cpDocument();

/** A step linked to the left square, shown as its crease pattern. */
async function linkedStep(): Promise<string> {
  const stepId = state().addDiagramStep()!;
  await state().captureDiagramStep(stepId, {
    scope: { kind: 'segment', region: regionReferenceFor(left!) },
    render: { mode: 'crease-pattern', rotationDeg: 0 },
    kind: 'diagram-capture',
    label: 'Link pattern',
  });
  return stepId;
}

const listener = () => ({ spatial: vi.fn(), solutions: vi.fn(), mirrorAxes: vi.fn(), preview: vi.fn() });
const render = (stepId: string) => stepsIn(state().diagram!).find((step) => step.id === stepId)!.source;

beforeEach(async () => {
  vi.clearAllMocks();
  pattern.moved = null;
  // The registry frees through the kernel; here there is none.
  setFoldedFigureHandleFree(() => {});
  await resetFoldedFigureHandles();
  useWorkspaceStore.setState(initialState, true);
  useWorkspaceStore.setState({
    oristudioCpDocument: { handle: 1, document, geometry: null } as unknown as OristudioCpDocumentState,
  });
  bindings.runtime = fakeCaptureRuntime();
  dialog.outcome = () => ({ kind: 'cancelled' });
  dialog.openLayerOrderDialog.mockImplementation(async (request: LayerOrderRequest) => dialog.outcome!(request));
});

describe('the Pose controller', () => {
  it('captures each verb as one undo step, folding once for all of them', async () => {
    const stepId = await linkedStep();
    const controller = createPoseController(stepId, listener());
    const before = state().diagramHistory.past.length;
    await controller.run({ verb: 'show-folded' });
    await controller.run({ verb: 'turn-over' });
    await controller.run({ verb: 'rotate-right' });
    expect(render(stepId)).toMatchObject({ render: { mode: 'folded-flat', side: 'back', rotationDeg: 15 } });
    expect(state().diagramHistory.past.slice(before).map((entry) => entry.label)).toEqual([
      'Adjust pose',
      'Adjust pose',
      'Adjust pose',
    ]);
    expect(bindings.runtime!.fold).toHaveBeenCalledOnce();
    expect(foldedFigureHandleRefCount(7)).toBe(1);
    expect(state().diagramCaptures).toEqual({});
    // Undo takes back one verb.
    state().undoDiagram();
    expect(render(stepId)).toMatchObject({ render: { side: 'back', rotationDeg: 0 } });
    controller.dispose();
    expect(foldedFigureHandleRefCount(7)).toBe(0);
  });

  // The whole pattern dragged since the step was linked: a Pose verb finds its
  // sheet by its creases, and the link follows it there.
  it('poses a step whose pattern moved: the same creases, the link following its sheet', async () => {
    const stepId = await linkedStep();
    const before = render(stepId);
    if (before?.kind !== 'cp') throw new Error('linked');
    const [dx, dy] = [431.3, -0.7000000000000001];
    const moved = twoSquaresIndex({ dx, dy });
    pattern.moved = moved;
    useWorkspaceStore.setState({
      oristudioCpDocument: {
        handle: 1,
        document: cpDocument(movedLines(TWO_SQUARES, dx, dy)),
        geometry: null,
      } as unknown as OristudioCpDocumentState,
    });
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'rotate-right' });
    const after = render(stepId);
    if (after?.kind !== 'cp') throw new Error('linked');
    expect(after.render).toMatchObject({ mode: 'crease-pattern', rotationDeg: 15 });
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(after.scope.region).toEqual(regionReferenceFor(sheetRegions(moved)[0]!));
    controller.dispose();
  });

  // A Relink or an undo moves the step to other creases while its detail is
  // open; what was learnt from the old fold must not be shown for the new one.
  it('says which creases each fact is of, so a view drops them when the step moves to others', async () => {
    const stepId = await linkedStep();
    const heard = listener();
    const controller = createPoseController(stepId, heard);
    await controller.run({ verb: 'show-folded' });
    const source = render(stepId)!;
    if (source.kind !== 'cp') throw new Error('linked');
    expect(heard.solutions).toHaveBeenLastCalledWith(expect.anything(), linkedFoldKey(stepId, source));
    // Another pattern, or the same one changed, is another key.
    expect(linkedFoldKey(stepId, { ...source, fingerprint: 'cs1:other' })).not.toBe(linkedFoldKey(stepId, source));
    const elsewhere = { ...source.scope.region, boundary: [[{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }]] };
    expect(linkedFoldKey(stepId, { ...source, scope: { kind: 'segment', region: elsewhere } })).not.toBe(
      linkedFoldKey(stepId, source)
    );
    controller.dispose();
  });

  it('lets the fold go when the crease pattern is replaced, and folds again next time', async () => {
    const stepId = await linkedStep();
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    controller.documentReplaced();
    expect(foldedFigureHandleRefCount(7)).toBe(0);
    await controller.run({ verb: 'turn-over' });
    expect(bindings.runtime!.fold).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('captures an orbit once the view rests, and not one that ends where it began or that undo overtook', async () => {
    vi.useFakeTimers();
    try {
      const stepId = await linkedStep();
      const commit = state().commitDiagramCapture;
      const commits = vi.fn(commit);
      useWorkspaceStore.setState({ commitDiagramCapture: commits });
      const controller = createPoseController(stepId, listener());
      const stored = { yaw: 0, pitch: 0, zoom: 1 };
      controller.orbit(stored, stored);
      await vi.advanceTimersByTimeAsync(1000);
      expect(commits).not.toHaveBeenCalled();
      // A drag: many moves, one capture when it rests.
      controller.orbit({ yaw: 0.2, pitch: 0, zoom: 1 }, stored);
      controller.orbit({ yaw: 0.4, pitch: 0, zoom: 1 }, stored);
      await vi.advanceTimersByTimeAsync(1000);
      expect(commits).toHaveBeenCalledOnce();
      // An undo before it rests: nothing.
      controller.orbit({ yaw: 0.6, pitch: 0, zoom: 1 }, stored);
      controller.historyMoved();
      await vi.advanceTimersByTimeAsync(1000);
      expect(commits).toHaveBeenCalledOnce();
      controller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not commit a slow orbit after a newer gesture, including a return to the saved view', async () => {
    vi.useFakeTimers();
    try {
      const stepId = await linkedStep();
      const controller = createPoseController(stepId, listener());
      const commit = state().commitDiagramCapture;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const commits = vi.fn(async (...args: Parameters<typeof commit>) => { await gate; return commit(...args); });
      useWorkspaceStore.setState({ commitDiagramCapture: commits });
      const saved = state().diagram;
      const history = state().diagramHistory;
      const stored = { yaw: 0, pitch: 0, zoom: 1 };
      controller.orbit({ ...stored, yaw: 0.4 }, stored);
      await vi.advanceTimersByTimeAsync(450);
      expect(commits).toHaveBeenCalledOnce();
      controller.orbit(stored, stored);
      release();
      await vi.advanceTimersByTimeAsync(1000);
      expect(state().diagram).toBe(saved);
      expect(state().diagramHistory).toBe(history);
      controller.dispose();
    } finally { vi.useRealTimers(); }
  });

  it('captures a rest of Pose’s simulator only when it is not the step’s picture already (D19)', async () => {
    const stepId = await linkedStep();
    const controller = createPoseController(stepId, listener());
    const still = vi.fn(async () => sheetWithCrease());
    const view = { yaw: 0.3, pitch: -0.8, zoom: 1.4 };
    // Shown as its crease pattern: a rest of a simulator it left is nothing.
    await controller.simulate({ foldPercent: 40, view, still });
    expect(still).not.toHaveBeenCalled();

    // Shown Simulated: folded to 40% and captured, one undo step.
    useWorkspaceStore.setState({
      diagram: {
        ...state().diagram!,
        steps: stepsIn(state().diagram!).map((step) =>
          step.id === stepId && step.source?.kind === 'cp'
            ? { ...step, source: { ...step.source, render: { mode: 'simulated', foldPercent: 0, view } } }
            : step
        ),
      },
    });
    const past = state().diagramHistory.past.length;
    await controller.simulate({ foldPercent: 40, view, still });
    expect(render(stepId)).toMatchObject({ render: { mode: 'simulated', foldPercent: 40, view } });
    expect(state().diagramHistory.past.length).toBe(past + 1);
    expect(still).toHaveBeenCalledOnce();

    // Resting where it is captured: nothing, so opening Pose writes nothing.
    await controller.simulate({ foldPercent: 40.02, view, still });
    expect(still).toHaveBeenCalledOnce();
    expect(state().diagramHistory.past.length).toBe(past + 1);

    // Its pattern changed since: the same rest is captured again (Pose again).
    useWorkspaceStore.setState({
      diagram: {
        ...state().diagram!,
        steps: stepsIn(state().diagram!).map((step) =>
          step.id === stepId && step.source?.kind === 'cp' ? { ...step, source: { ...step.source, fingerprint: 'before' } } : step
        ),
      },
    });
    await controller.simulate({ foldPercent: 40, view, still });
    expect(still).toHaveBeenCalledTimes(2);
    expect(render(stepId)).toMatchObject({ fingerprint: expect.not.stringMatching(/^before$/) });
    controller.dispose();
  });

  it('captures the newest rest that came while one was captured, not refused as busy', async () => {
    const stepId = await linkedStep();
    const view = { yaw: 0.3, pitch: -0.8, zoom: 1.4 };
    useWorkspaceStore.setState({
      diagram: {
        ...state().diagram!,
        steps: stepsIn(state().diagram!).map((step) =>
          step.id === stepId && step.source?.kind === 'cp'
            ? { ...step, source: { ...step.source, render: { mode: 'simulated', foldPercent: 0, view } } }
            : step
        ),
      },
    });
    const controller = createPoseController(stepId, listener());
    let release = () => {};
    const slow = vi.fn(() => new Promise<ReturnType<typeof sheetWithCrease>>((resolve) => (release = () => resolve(sheetWithCrease()))));
    const still = vi.fn(async () => sheetWithCrease());
    const first = controller.simulate({ foldPercent: 20, view, still: slow });
    await vi.waitFor(() => expect(slow).toHaveBeenCalled());
    // Two more while the first is captured: only the newest is.
    void controller.simulate({ foldPercent: 30, view, still });
    const last = controller.simulate({ foldPercent: 40, view, still });
    release();
    await first;
    await last;
    expect(still).toHaveBeenCalledOnce();
    expect(render(stepId)).toMatchObject({ render: { foldPercent: 40 } });
    controller.dispose();
  });

  it('drops a rest still waiting when an undo comes, so the undo stands and redo is kept', async () => {
    const stepId = await linkedStep();
    const view = { yaw: 0.3, pitch: -0.8, zoom: 1.4 };
    const simulated = (foldPercent: number) =>
      useWorkspaceStore.setState({
        diagram: {
          ...state().diagram!,
          steps: stepsIn(state().diagram!).map((step) =>
            step.id === stepId && step.source?.kind === 'cp'
              ? { ...step, source: { ...step.source, render: { mode: 'simulated', foldPercent, view } } }
              : step
          ),
        },
      });
    simulated(0);
    const controller = createPoseController(stepId, listener());
    const still = vi.fn(async () => sheetWithCrease());
    await controller.simulate({ foldPercent: 40, view, still });
    expect(render(stepId)).toMatchObject({ render: { foldPercent: 40 } });

    let release = () => {};
    const slow = vi.fn(() => new Promise<ReturnType<typeof sheetWithCrease>>((resolve) => (release = () => resolve(sheetWithCrease()))));
    const first = controller.simulate({ foldPercent: 50, view, still: slow });
    await vi.waitFor(() => expect(slow).toHaveBeenCalled());
    void controller.simulate({ foldPercent: 70, view, still });
    // Undo, as Pose's key does it: the sessions hear of it first.
    controller.historyMoved();
    act(() => state().undoDiagram());
    release();
    await first;
    expect(render(stepId)).toMatchObject({ render: { foldPercent: 0 } });
    expect(state().diagramHistory.future.length).toBeGreaterThan(0);
    controller.dispose();
  });

  // Done, or Next step, while a verb folded: the fold landed into a session
  // nothing referenced and was held for the life of the document.
  it('stops its own fold when the detail closes, frees what lands, and says nothing', async () => {
    const stepId = await linkedStep();
    let land!: () => void;
    let started!: () => void;
    const folding = new Promise<void>((resolve) => (started = resolve));
    const fake = fakeCaptureRuntime();
    const fold = fake.fold;
    bindings.runtime = fakeCaptureRuntime({
      fold: vi.fn(async (...args: Parameters<typeof fold>) => {
        started();
        await new Promise<void>((resolve) => (land = resolve));
        return fold(...args);
      }) as typeof fold,
    });
    const stop = vi.fn(state().stopDiagramCapture);
    useWorkspaceStore.setState({ stopDiagramCapture: stop });
    const controller = createPoseController(stepId, listener());
    const running = controller.run({ verb: 'show-folded' });
    await folding;
    controller.dispose();
    expect(stop).toHaveBeenCalledWith(stepId);
    land();
    await running;
    expect(foldedFigureHandleRefCount(7)).toBe(0);
    expect(toasts.error).not.toHaveBeenCalled();
    expect(render(stepId)).toMatchObject({ render: { mode: 'crease-pattern' } });
    expect(state().diagramCaptures).toEqual({});
  });

  it('stops no capture it did not start when the detail closes', async () => {
    const stepId = await linkedStep();
    const stop = vi.fn();
    useWorkspaceStore.setState({ stopDiagramCapture: stop });
    createPoseController(stepId, listener()).dispose();
    expect(stop).not.toHaveBeenCalled();
  });

  it('gives up on a fold the engine was lost under, and says so', async () => {
    const stepId = await linkedStep();
    let started!: () => void;
    const folding = new Promise<void>((resolve) => {
      started = resolve;
    });
    bindings.runtime = fakeCaptureRuntime({
      fold: vi.fn(async () => {
        started();
        return new Promise<never>(() => {});
      }),
    });
    const controller = createPoseController(stepId, listener());
    const running = controller.run({ verb: 'show-folded' });
    await folding;
    for (const lost of [...engines.listeners]) lost({ engine: 'oristudio-cp' });
    await running;
    expect(state().diagramCaptures).toEqual({});
    expect(toasts.error).toHaveBeenCalledWith('The picture couldn’t be captured', expect.anything());
    expect(render(stepId)).toMatchObject({ render: { mode: 'crease-pattern' } });
    controller.engineLost();
    controller.dispose();
  });
});

describe('spreading a flat fold’s layers (Phase 13)', () => {
  const spreadOf = (stepId: string) => {
    const source = render(stepId);
    return source?.kind === 'cp' && source.render.mode === 'folded-flat' ? (source.render.spread ?? null) : undefined;
  };

  /** Depth, 2.5%, deeper layers down: what Depth starts with when no step before has a depth spread (13g). */
  const DEPTH = { kind: 'depth' as const, amount: 0.025, toward: 'down' as const };
  /**
   * The playground's bird base: what a new flat pose starts with when no step
   * before has a spread (Zach, 2026-10-05), and Affine when none has an affine one.
   */
  const AFFINE = { kind: 'affine' as const, amount: 0.03, keep: 'top' as const, skew: 1, axisDeg: 81 };

  /** A linked step shown flat, spread or not, as a file would hold it, and no fold held yet. */
  function flatInTheFile(stepId: string, spread?: DiagramLayerSpread) {
    useWorkspaceStore.setState({
      diagram: {
        ...state().diagram!,
        steps: stepsIn(state().diagram!).map((step) =>
          step.id === stepId && step.source?.kind === 'cp'
            ? {
                ...step,
                source: {
                  ...step.source,
                  render: { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1, ...(spread ? { spread } : {}) },
                },
              }
            : step
        ),
      },
    });
  }

  it('previews both reveal coordinates and commits one capture and undo per gesture', async () => {
    const stepId = await linkedStep();
    flatInTheFile(stepId, DEFAULT_CONNECTED_SPREAD);
    const heard = listener();
    const controller = createPoseController(stepId, heard);
    const before = state().diagramHistory.past.length;
    controller.previewSpread({ slider: 'reveal', value: [1, 0.2] });
    controller.previewSpread({ slider: 'reveal', value: [0.4, -0.8] });
    expect(heard.preview).toHaveBeenLastCalledWith(expect.objectContaining({
      spread: { ...DEFAULT_CONNECTED_SPREAD, reveal: [0.4, -0.8] },
    }), expect.any(String));
    expect(state().diagramHistory.past.length).toBe(before);
    await controller.commitSpread();
    expect(spreadOf(stepId)).toEqual({ ...DEFAULT_CONNECTED_SPREAD, reveal: [0.4, -0.8] });
    expect(state().diagramHistory.past.length).toBe(before + 1);
    state().undoDiagram();
    expect(spreadOf(stepId)).toEqual(DEFAULT_CONNECTED_SPREAD);
    controller.dispose();
  });

  it('starts a new flat pose spread — the nearest step before’s, else connected — and turns it off and on, counted with how', async () => {
    const first = await linkedStep();
    const second = await linkedStep();
    expect(stepsIn(state().diagram!).map((step) => step.id)).toEqual([first, second]);
    const one = createPoseController(first, listener());
    await one.run({ verb: 'show-folded' });
    // New steps use connected; an explicitly selected legacy spread still inherits.
    expect(spreadOf(first)).toEqual(DEFAULT_CONNECTED_SPREAD);
    await one.run({verb: 'spread-kind',kind:'affine'});
    await one.run({ verb: 'spread-keep', keep: 'bottom' });
    expect(spreadOf(first)).toEqual({ ...AFFINE, keep: 'bottom' });
    one.dispose();

    const two = createPoseController(second, listener());
    await two.run({ verb: 'show-folded' });
    // The step before's.
    expect(spreadOf(second)).toEqual({ ...AFFINE, keep: 'bottom' });
    const past = state().diagramHistory.past.length;
    await two.run({ verb: 'spread-layers' });
    expect(spreadOf(second)).toBeNull();
    await two.run({ verb: 'spread-layers' });
    expect(spreadOf(second)).toEqual({ ...AFFINE, keep: 'bottom' });
    expect(state().diagramHistory.past.length).toBe(past + 2);
    two.dispose();

    expect(analytics.trackDiagramPicturePosed.mock.calls.slice(-4)).toEqual([
      ['spread_keep', 'flat', { spread: { kind: 'affine', amount: 0.03, keep: 'bottom', skew: 1, axisDeg: 81 } }],
      ['show_folded', 'flat', {}],
      ['spread_off', 'flat', {}],
      ['spread_on', 'flat', { spread: { kind: 'affine', amount: 0.03, keep: 'bottom', skew: 1, axisDeg: 81 } }],
    ]);
  });

  it('keeps a flat fold that has a pose with no spread unspread, through its verbs and Show as and back', async () => {
    const stepId = await linkedStep();
    flatInTheFile(stepId);
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'rotate-right' });
    expect(spreadOf(stepId)).toBeNull();
    await controller.run({ verb: 'show-crease-pattern' });
    await controller.run({ verb: 'show-folded' });
    expect(render(stepId)).toMatchObject({ render: { mode: 'folded-flat', rotationDeg: 15 } });
    expect(spreadOf(stepId)).toBeNull();
    controller.dispose();
  });

  it('switches kind from the nearest step before’s of that kind, else its default, and each kind keeps to its own settings', async () => {
    const first = await linkedStep();
    const second = await linkedStep();
    const one = createPoseController(first, listener());
    await one.run({ verb: 'show-folded' });
    const past = state().diagramHistory.past.length;
    // To depth, which no step before has: its default; and back to affine, which this one had.
    await one.run({ verb: 'spread-kind', kind: 'depth' });
    expect(spreadOf(first)).toEqual(DEPTH);
    await one.run({ verb: 'spread-kind', kind: 'affine' });
    expect(spreadOf(first)).toEqual(AFFINE);
    await one.run({ verb: 'spread-keep', keep: 'bottom' });
    await one.run({ verb: 'spread-skew', skew: 0.456 });
    await one.run({ verb: 'spread-axis', axisDeg: 99.4 });
    await one.run({ verb: 'spread-amount', amount: 0.3 });
    const opened = { ...AFFINE, keep: 'bottom' as const, skew: 0.46, axisDeg: 99, amount: 0.25 };
    expect(spreadOf(first)).toEqual(opened);
    expect(state().diagramHistory.past.length).toBe(past + 6);
    // A depth verb on an affine spread, and the kind it has, change nothing.
    await one.run({ verb: 'spread-direction', toward: 'left' });
    await one.run({ verb: 'spread-kind', kind: 'affine' });
    expect(spreadOf(first)).toEqual(opened);
    expect(state().diagramHistory.past.length).toBe(past + 6);
    expect(analytics.trackDiagramPicturePosed.mock.calls.slice(-6)).toEqual([
      ['spread_kind', 'flat', { spread: { kind: 'depth', direction: 'down', amount: 0.025 } }],
      ['spread_kind', 'flat', { spread: { kind: 'affine', amount: 0.03, keep: 'top', skew: 1, axisDeg: 81 } }],
      ['spread_keep', 'flat', { spread: { kind: 'affine', amount: 0.03, keep: 'bottom', skew: 1, axisDeg: 81 } }],
      ['spread_skew', 'flat', { spread: { kind: 'affine', amount: 0.03, keep: 'bottom', skew: 0.46, axisDeg: 81 } }],
      ['spread_axis', 'flat', { spread: { kind: 'affine', amount: 0.03, keep: 'bottom', skew: 0.46, axisDeg: 99 } }],
      ['spread_amount', 'flat', { spread: { kind: 'affine', amount: 0.25, keep: 'bottom', skew: 0.46, axisDeg: 99 } }],
    ]);
    one.dispose();

    const two = createPoseController(second, listener());
    await two.run({ verb: 'show-folded' });
    // A new pose starts as the step before is spread, of either kind.
    expect(spreadOf(second)).toEqual(opened);
    // No step before has a depth spread: the default; and back to the affine one before.
    await two.run({ verb: 'spread-kind', kind: 'depth' });
    expect(spreadOf(second)).toEqual(DEPTH);
    await two.run({ verb: 'spread-kind', kind: 'affine' });
    expect(spreadOf(second)).toEqual(opened);
    two.dispose();
  });

  it('previews a drag from the held fold with no call to the kernel, then commits it as one undo step', async () => {
    const stepId = await linkedStep();
    const heard = listener();
    const controller = createPoseController(stepId, heard);
    await controller.run({ verb: 'show-folded' });
    await controller.run({verb:'spread-kind',kind:'affine'});
    const reads = vi.mocked(bindings.runtime!.paperScene).mock.calls.length;
    const past = state().diagramHistory.past.length;
    const posed = analytics.trackDiagramPicturePosed.mock.calls.length;
    const source = render(stepId)!;
    if (source.kind !== 'cp') throw new Error('linked');

    for (const value of [0.1, 0.12, 0.15]) controller.previewSpread({ slider: 'amount', kind: 'affine', value });
    expect(heard.preview).toHaveBeenCalledTimes(3);
    expect(heard.preview).toHaveBeenLastCalledWith(
      {
        slide: { slider: 'amount', kind: 'affine', value: 0.15 },
        slides: [{ slider: 'amount', kind: 'affine', value: 0.15 }],
        spread: { ...AFFINE, amount: 0.15 },
        picture: expect.objectContaining({ kind: 'scene' }),
      },
      linkedFoldKey(stepId, source)
    );
    // Previewed, not committed, and drawn from what the session read.
    expect(state().diagramHistory.past.length).toBe(past);
    expect(bindings.runtime!.paperScene).toHaveBeenCalledTimes(reads);

    await controller.commitSpread();
    expect(spreadOf(stepId)).toEqual({ ...AFFINE, amount: 0.15 });
    expect(state().diagramHistory.past.length).toBe(past + 1);
    expect(bindings.runtime!.paperScene).toHaveBeenCalledTimes(reads);
    expect(heard.preview).toHaveBeenLastCalledWith(null, null);
    // One drag, one event.
    expect(analytics.trackDiagramPicturePosed.mock.calls.slice(posed)).toEqual([
      ['spread_amount', 'flat', { spread: { kind: 'affine', amount: 0.15, keep: 'top', skew: 1, axisDeg: 81 } }],
    ]);
    controller.dispose();
  });

  it('previews and commits an affine spread’s skew and axis as its amount, one undo step a drag', async () => {
    const stepId = await linkedStep();
    const heard = listener();
    const controller = createPoseController(stepId, heard);
    await controller.run({ verb: 'show-folded' });
    await controller.run({ verb: 'spread-kind', kind: 'affine' });
    const reads = vi.mocked(bindings.runtime!.paperScene).mock.calls.length;
    const past = state().diagramHistory.past.length;
    const pictureOf = () => stepsIn(state().diagram!).find((step) => step.id === stepId)!.picture;
    const unskewed = pictureOf();
    controller.previewSpread({ slider: 'skew', value: 0.4 });
    expect(heard.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({ slide: { slider: 'skew', value: 0.4 }, spread: { ...AFFINE, skew: 0.4 } }),
      expect.any(String)
    );
    await controller.commitSpread();
    const skewed = pictureOf();
    controller.previewSpread({ slider: 'axis', value: 30 });
    expect(heard.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({ spread: { ...AFFINE, skew: 0.4, axisDeg: 30 } }),
      expect.any(String)
    );
    await controller.commitSpread();
    expect(spreadOf(stepId)).toEqual({ ...AFFINE, skew: 0.4, axisDeg: 30 });
    expect(state().diagramHistory.past.length).toBe(past + 2);
    expect(bindings.runtime!.paperScene).toHaveBeenCalledTimes(reads);
    const turned = pictureOf();
    expect(new Set([unskewed, skewed, turned]).size).toBe(3);
    // Each drag undoes on its own, the setting and the picture with it, and redoes.
    state().undoDiagram();
    expect(spreadOf(stepId)).toEqual({ ...AFFINE, skew: 0.4 });
    expect(pictureOf()).toBe(skewed);
    state().undoDiagram();
    expect(spreadOf(stepId)).toEqual(AFFINE);
    expect(pictureOf()).toBe(unskewed);
    state().redoDiagram();
    state().redoDiagram();
    expect(spreadOf(stepId)).toEqual({ ...AFFINE, skew: 0.4, axisDeg: 30 });
    expect(pictureOf()).toBe(turned);
    controller.dispose();
  });

  it('folds for a preview when it holds nothing yet, and commits after that fold rather than refused as busy', async () => {
    const stepId = await linkedStep();
    flatInTheFile(stepId, { kind: 'depth', amount: 0.05, toward: 'down' });
    const heard = listener();
    const controller = createPoseController(stepId, heard);
    controller.previewSpread({ slider: 'amount', kind: 'depth', value: 0.08 });
    // Nothing held: the spread now, the picture once the fold is.
    expect(heard.preview).toHaveBeenNthCalledWith(
      1,
      {
        slide: { slider: 'amount', kind: 'depth', value: 0.08 },
        slides: [{ slider: 'amount', kind: 'depth', value: 0.08 }],
        spread: { kind: 'depth', amount: 0.08, toward: 'down' },
        picture: null,
      },
      expect.any(String)
    );
    const committing = controller.commitSpread();
    await committing;
    expect(heard.preview).toHaveBeenCalledWith(
      expect.objectContaining({
        spread: { kind: 'depth', amount: 0.08, toward: 'down' },
        picture: expect.objectContaining({ kind: 'scene' }),
      }),
      expect.any(String)
    );
    expect(spreadOf(stepId)).toEqual({ kind: 'depth', amount: 0.08, toward: 'down' });
    expect(bindings.runtime!.fold).toHaveBeenCalledOnce();
    expect(heard.preview).toHaveBeenLastCalledWith(null, null);
    controller.dispose();
  });

  it('commits the newest amount when commits race, as one undo step', async () => {
    const stepId = await linkedStep();
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    await controller.run({verb:'spread-kind',kind:'affine'});
    const past = state().diagramHistory.past.length;
    const commits = [0.1, 0.12, 0.14].map((value) => {
      controller.previewSpread({ slider: 'amount', kind: 'affine', value });
      return controller.commitSpread();
    });
    await Promise.all(commits);
    expect(spreadOf(stepId)).toEqual({ ...AFFINE, amount: 0.14 });
    expect(state().diagramHistory.past.length).toBe(past + 1);
    controller.dispose();
  });

  /** The next fold waits until the returned function is called. */
  function holdTheFold(): () => void {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const folded = vi.mocked(bindings.runtime!.fold).getMockImplementation()!;
    vi.mocked(bindings.runtime!.fold).mockImplementationOnce(async (...args) => {
      await gate;
      return folded(...args);
    });
    return open;
  }

  it('commits one slider and then another while a fold runs, neither taking the other’s place', async () => {
    const stepId = await linkedStep();
    flatInTheFile(stepId, AFFINE);
    const controller = createPoseController(stepId, listener());
    const open = holdTheFold();
    const past = state().diagramHistory.past.length;
    controller.previewSpread({ slider: 'amount', kind: 'affine', value: 0.05 });
    const amount = controller.commitSpread();
    controller.previewSpread({ slider: 'skew', value: 0.5 });
    const skew = controller.commitSpread();
    open();
    await Promise.all([amount, skew]);
    expect(spreadOf(stepId)).toEqual({ ...AFFINE, amount: 0.05, skew: 0.5 });
    expect(state().diagramHistory.past.length).toBe(past + 2);
    controller.dispose();
  });

  it.each([
    ['affine', 'depth', AFFINE, 0.24],
    ['depth', 'affine', { ...DEPTH, amount: 0.15 }, 0.18],
  ] as const)(
    'drops an amount dragged on %s while the step switches to %s, rather than read it as the other kind’s (review)',
    async (_from, to, spread, dragged) => {
      const stepId = await linkedStep();
      flatInTheFile(stepId, spread);
      const controller = createPoseController(stepId, listener());
      const open = holdTheFold();
      const past = state().diagramHistory.past.length;
      const switched = controller.run({ verb: 'spread-kind', kind: to });
      // The switch folding, the old kind's slider still under the pointer.
      await null;
      expect(spreadOf(stepId)).toEqual(spread);
      controller.previewSpread({ slider: 'amount', kind: spread.kind, value: dragged });
      const committed = controller.commitSpread();
      open();
      await Promise.all([switched, committed]);
      expect(spreadOf(stepId)).toEqual(to === 'depth' ? DEPTH : AFFINE);
      expect(state().diagramHistory.past.length).toBe(past + 1);
      controller.dispose();
    }
  );

  it('keeps a slider let go at its value while another is dragged, and draws again when it lands (review)', async () => {
    const stepId = await linkedStep();
    flatInTheFile(stepId, AFFINE);
    const heard = listener();
    const controller = createPoseController(stepId, heard);
    const open = holdTheFold();
    controller.previewSpread({ slider: 'skew', value: 0.3 });
    const skew = controller.commitSpread();
    controller.previewSpread({ slider: 'axis', value: 50 });
    // The skew waits for the fold, the axis is dragged: both shown.
    expect(heard.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({ spread: { ...AFFINE, skew: 0.3, axisDeg: 50 } }),
      expect.any(String)
    );
    open();
    await skew;
    expect(spreadOf(stepId)).toEqual({ ...AFFINE, skew: 0.3 });
    // Landed under the axis still held: drawn again, from the fold now held.
    expect(heard.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({
        slides: [{ slider: 'axis', value: 50 }],
        spread: { ...AFFINE, skew: 0.3, axisDeg: 50 },
        picture: expect.objectContaining({ kind: 'scene' }),
      }),
      expect.any(String)
    );
    await controller.commitSpread();
    expect(spreadOf(stepId)).toEqual({ ...AFFINE, skew: 0.3, axisDeg: 50 });
    controller.dispose();
  });

  /** Stop the next creases lookup — a commit's, under a fold held — until opened: whether it has begun, and the key. */
  function holdTheLookup(): { begun: () => boolean; open: () => void } {
    let begun = false;
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    vi.mocked(ensureCpSheetIndex).mockImplementationOnce(async () => {
      begun = true;
      await gate;
      return sheets;
    });
    return { begun: () => begun, open };
  }

  /** A preview drawn from the fold held: what every drag draws from once one is. */
  async function holdAFold(controller: ReturnType<typeof createPoseController>, heard: ReturnType<typeof listener>) {
    controller.previewSpread({ slider: 'skew', value: 1 });
    await vi.waitFor(() =>
      expect(heard.preview).toHaveBeenLastCalledWith(
        expect.objectContaining({ picture: expect.objectContaining({ kind: 'scene' }) }),
        expect.any(String)
      )
    );
  }

  it('keeps a slider being committed at its value while another is dragged, from the fold held (third review)', async () => {
    const stepId = await linkedStep();
    flatInTheFile(stepId, AFFINE);
    const heard = listener();
    const controller = createPoseController(stepId, heard);
    await holdAFold(controller, heard);
    const lookup = holdTheLookup();
    controller.previewSpread({ slider: 'skew', value: 0.3 });
    const skew = controller.commitSpread();
    await vi.waitFor(() => expect(lookup.begun()).toBe(true));
    // The skew is being committed, the axis dragged: both shown, drawn from the fold held.
    controller.previewSpread({ slider: 'axis', value: 50 });
    expect(heard.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({
        slides: [
          { slider: 'skew', value: 0.3 },
          { slider: 'axis', value: 50 },
        ],
        spread: { ...AFFINE, skew: 0.3, axisDeg: 50 },
        picture: expect.objectContaining({ kind: 'scene' }),
      }),
      expect.any(String)
    );
    lookup.open();
    await skew;
    controller.dispose();
  });

  it('drags without a slider being committed once an undo has taken back the step it was committed on (third review)', async () => {
    const stepId = await linkedStep();
    flatInTheFile(stepId, AFFINE);
    const heard = listener();
    const controller = createPoseController(stepId, heard);
    await holdAFold(controller, heard);
    controller.previewSpread({ slider: 'axis', value: 70 });
    await controller.commitSpread();
    expect(spreadOf(stepId)).toEqual({ ...AFFINE, axisDeg: 70 });
    const lookup = holdTheLookup();
    controller.previewSpread({ slider: 'skew', value: 0.3 });
    const skew = controller.commitSpread();
    await vi.waitFor(() => expect(lookup.begun()).toBe(true));
    // Undone as the menu undoes: the controller told first. The axis is taken back, and the skew cannot land.
    controller.historyMoved();
    act(() => {
      state().undoDiagram();
    });
    expect(spreadOf(stepId)).toEqual(AFFINE);
    controller.previewSpread({ slider: 'axis', value: 50 });
    expect(heard.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({ spread: { ...AFFINE, axisDeg: 50 } }),
      expect.any(String)
    );
    lookup.open();
    await skew;
    expect(spreadOf(stepId)).toEqual(AFFINE);
    controller.dispose();
  });

  it('ends a preview when an undo comes, and keeps its spread through Reset Pose', async () => {
    const stepId = await linkedStep();
    const heard = listener();
    const controller = createPoseController(stepId, heard);
    await controller.run({ verb: 'show-folded' });
    await controller.run({verb:'spread-kind',kind:'affine'});
    await controller.run({ verb: 'turn-over' });
    controller.previewSpread({ slider: 'amount', kind: 'affine', value: 0.1 });
    // Heard before the undo, which takes back this step's turn.
    controller.historyMoved();
    state().undoDiagram();
    await Promise.resolve();
    expect(heard.preview).toHaveBeenLastCalledWith(null, null);
    await controller.run({ verb: 'reset' });
    expect(render(stepId)).toMatchObject({ render: { side: 'front', rotationDeg: 0, foldCase: 1, spread: AFFINE } });
    controller.dispose();
  });

  it('commits nothing for an amount an undo took back while it waited for a fold', async () => {
    const stepId = await linkedStep();
    flatInTheFile(stepId, { kind: 'depth', amount: 0.1, toward: 'down' });
    const controller = createPoseController(stepId, listener());
    const open = holdTheFold();
    const past = state().diagramHistory.past.length;
    controller.previewSpread({ slider: 'amount', kind: 'depth', value: 0.15 });
    const committing = controller.commitSpread();
    // The commit is waiting for the fold the preview asked for.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Heard before the undo, which takes back this step's link.
    controller.historyMoved();
    state().undoDiagram();
    open();
    await committing;
    // Nothing recorded since: redone, the step is as it was, the amount let go never landed.
    expect(state().diagramHistory.past.length).toBe(past - 1);
    expect(state().diagramHistory.future).toHaveLength(1);
    state().redoDiagram();
    expect(spreadOf(stepId)).toEqual({ kind: 'depth', amount: 0.1, toward: 'down' });
    controller.dispose();
  });

  it('keeps the amounts waiting and the drag shown through an undo of another step, and commits them (review 4)', async () => {
    const stepId = await linkedStep();
    flatInTheFile(stepId, { kind: 'depth', amount: 0.1, toward: 'down' });
    // The newest history: another step's instruction.
    const other = state().addDiagramStep()!;
    state().setDiagramStepText(other, 'Fold in half');
    const heard = listener();
    const controller = createPoseController(stepId, heard);
    const open = holdTheFold();
    controller.previewSpread({ slider: 'amount', kind: 'depth', value: 0.15 });
    const committing = controller.commitSpread();
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.historyMoved();
    expect(state().undoDiagram()).toBe(true);
    await Promise.resolve();
    // Only the other step's words went back: this one's drag is still shown, its amount still waiting.
    expect(stepsIn(state().diagram!).find((step) => step.id === other)?.text).toBe('');
    expect(heard.preview).not.toHaveBeenLastCalledWith(null, null);
    open();
    await committing;
    expect(spreadOf(stepId)).toEqual({ kind: 'depth', amount: 0.15, toward: 'down' });
    controller.dispose();
  });

  it('neither folds nor commits again once its detail closed, and keeps no fold', async () => {
    const stepId = await linkedStep();
    flatInTheFile(stepId, { kind: 'depth', amount: 0.1, toward: 'down' });
    const controller = createPoseController(stepId, listener());
    const open = holdTheFold();
    const past = state().diagramHistory.past.length;
    controller.previewSpread({ slider: 'amount', kind: 'depth', value: 0.15 });
    const committing = controller.commitSpread();
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.dispose();
    open();
    await committing;
    expect(spreadOf(stepId)).toEqual({ kind: 'depth', amount: 0.1, toward: 'down' });
    expect(state().diagramHistory.past.length).toBe(past);
    expect(bindings.runtime!.fold).toHaveBeenCalledOnce();
    expect(foldedFigureHandleRefCount(7)).toBe(0);
  });

  it('waits for the verb it is folding, not a preview refused as busy, and then commits', async () => {
    const stepId = await linkedStep();
    flatInTheFile(stepId, { kind: 'depth', amount: 0.1, toward: 'down' });
    const controller = createPoseController(stepId, listener());
    const open = holdTheFold();
    const turning = controller.run({ verb: 'rotate-right' });
    // Nothing is held, so the preview asks to fold — and is refused: the turn is folding.
    controller.previewSpread({ slider: 'amount', kind: 'depth', value: 0.15 });
    const committing = controller.commitSpread();
    open();
    await Promise.all([turning, committing]);
    expect(render(stepId)).toMatchObject({
      render: { rotationDeg: 15, spread: { kind: 'depth', amount: 0.15, toward: 'down' } },
    });
    expect(toasts.message).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('takes its preview back when its detail closes', async () => {
    const stepId = await linkedStep();
    const heard = listener();
    const controller = createPoseController(stepId, heard);
    await controller.run({ verb: 'show-folded' });
    await controller.run({verb:'spread-kind',kind:'affine'});
    controller.previewSpread({ slider: 'amount', kind: 'affine', value: 0.1 });
    expect(heard.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({ spread: { ...AFFINE, amount: 0.1 } }),
      expect.any(String)
    );
    controller.dispose();
    expect(heard.preview).toHaveBeenLastCalledWith(null, null);
  });

  it('ends a preview when another verb lands, and previews in the direction the step has now', async () => {
    const stepId = await linkedStep();
    const heard = listener();
    const controller = createPoseController(stepId, heard);
    await controller.run({ verb: 'show-folded' });
    // A direction is a depth spread's.
    await controller.run({ verb: 'spread-kind', kind: 'depth' });
    // A drag back to where it began commits nothing; the preview stays up.
    controller.previewSpread({ slider: 'amount', kind: 'depth', value: 0.025 });
    await controller.run({ verb: 'spread-direction', toward: 'up-left' });
    expect(heard.preview).toHaveBeenLastCalledWith(null, null);
    controller.previewSpread({ slider: 'amount', kind: 'depth', value: 0.12 });
    expect(heard.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({ spread: { ...DEPTH, amount: 0.12, toward: 'up-left' } }),
      expect.any(String)
    );
    // Its spread turned off: nothing left to preview.
    await controller.run({ verb: 'spread-layers' });
    controller.previewSpread({ slider: 'amount', kind: 'depth', value: 0.14 });
    expect(heard.preview).toHaveBeenLastCalledWith(null, null);
    controller.dispose();
  });
});

describe('a step with a layer order, posed (H7)', () => {
  const json = stepLayerOrderJson();
  const inSource = STEP_LAYER_ORDER_IN_SOURCE;

  /** The linked step, its record put on as an Apply leaves it. */
  async function constrainedStep(): Promise<string> {
    const stepId = await linkedStep();
    useWorkspaceStore.setState({ diagram: setLinkedLayerOrder(state().diagram!, stepId, json) });
    return stepId;
  }
  const layerOrderOf = (stepId: string) => {
    const source = render(stepId);
    return source?.kind === 'cp' ? source.layerOrder : undefined;
  };

  beforeEach(() => {
    hostEngine.resolveLayerOrder.mockImplementation(async (source: LayerOrderSource) =>
      fakeLayerOrderResolutions.applied(inSource, source)
    );
  });

  it('holds its flat fold in the record’s order: restored once, and every verb drawn from it', async () => {
    const stepId = await constrainedStep();
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    await controller.run({ verb: 'rotate-right' });
    await controller.run({ verb: 'turn-over' });
    expect(hostEngine.resolveLayerOrder).toHaveBeenCalledOnce();
    expect(bindings.runtime!.foldWithOrder).toHaveBeenCalledOnce();
    // The turn-over is a model change on the held figure, which keeps its order.
    expect(bindings.runtime!.setModel).toHaveBeenCalledWith(ORDERED_HANDLE, expect.objectContaining({ state: 'Back1' }));
    expect(bindings.runtime!.foldToCase).not.toHaveBeenCalled();
    expect(foldedFigureHandleRefCount(ORDERED_HANDLE)).toBe(1);
    expect(render(stepId)).toMatchObject({ render: { mode: 'folded-flat', side: 'back' } });
    expect(stepLayerOrderOf(layerOrderOf(stepId))?.record.constraints).toEqual(STEP_LAYER_ORDER.constraints);
    // Its record goes back to the crease pattern with it, and Reset Pose keeps it.
    await controller.run({ verb: 'reset' });
    expect(layerOrderOf(stepId)).toBeDefined();
    await controller.run({ verb: 'show-crease-pattern' });
    expect(render(stepId)).toMatchObject({ render: { mode: 'crease-pattern' } });
    expect(layerOrderOf(stepId)).toBeDefined();
    controller.dispose();
    expect(foldedFigureHandleRefCount(ORDERED_HANDLE)).toBe(0);
  });

  it('prepares connected spread in the saved layer order when reopening Pose', async () => {
    const stepId = await constrainedStep();
    const first = createPoseController(stepId, listener());
    await first.run({ verb: 'show-folded' });
    first.dispose();
    vi.clearAllMocks();
    const heard = { ...listener(), connected: vi.fn() };
    const reopened = createPoseController(stepId, heard);
    await reopened.prepareConnected();
    expect(hostEngine.resolveLayerOrder).toHaveBeenCalledOnce();
    expect(bindings.runtime!.foldWithOrder).toHaveBeenCalledOnce();
    expect(bindings.runtime!.paperScene).toHaveBeenLastCalledWith(ORDERED_HANDLE);
    expect(heard.connected).toHaveBeenCalledOnce();
    expect(foldedFigureHandleRefCount(ORDERED_HANDLE)).toBe(1);
    reopened.dispose();
  });

  it('keeps the picture and flags the record when the order cannot be drawn, as one undo step (D10)', async () => {
    const stepId = await constrainedStep();
    hostEngine.resolveLayerOrder.mockImplementation(async () => fakeLayerOrderResolutions.kept('clash', inSource));
    const controller = createPoseController(stepId, listener());
    const before = stepsIn(state().diagram!).find((step) => step.id === stepId)!;
    const entries = state().diagramHistory.past.length;
    await controller.run({ verb: 'show-folded' });
    const after = stepsIn(state().diagram!).find((step) => step.id === stepId)!;
    expect(after.picture).toEqual(before.picture);
    expect(render(stepId)).toMatchObject({ render: { mode: 'crease-pattern' } });
    expect(stepLayerOrderOf(layerOrderOf(stepId))?.record.attention).toEqual({ reason: 'conflict', count: 1 });
    expect(state().diagramHistory.past.slice(entries).map((entry) => entry.label)).toEqual(['Adjust pose']);
    expect(toasts.message).toHaveBeenCalledWith('This step’s layer constraints need attention, so it keeps its picture.');
    expect(analytics.trackLayerConstraintsNeedAttention).toHaveBeenCalledOnce();
    // Nothing held for it.
    expect(foldedFigureHandleRefCount(ORDERED_HANDLE)).toBe(0);
    // Asked again, flagged as it was: no new undo step, nothing new to count.
    await controller.run({ verb: 'show-folded' });
    expect(state().diagramHistory.past.slice(entries)).toHaveLength(1);
    expect(analytics.trackLayerConstraintsNeedAttention).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it.each([
    // Only a reload retries a load that failed: Reload, the toast's one action.
    ['load', 'Layer order couldn’t load, so this step wasn’t changed. Reload Ori Studio to try again.', 'Reload'],
    ['crashed', 'Layer order stopped unexpectedly, so this step wasn’t changed.', undefined],
    // The engine's own "did not start" may be a defect: nothing to reload for.
    ['unavailable', 'Layer order stopped unexpectedly, so this step wasn’t changed.', undefined],
  ] as const)('writes nothing when the host engine is lost (%s): no undo step, not dirty, said', async (cause, said, action) => {
    const stepId = await constrainedStep();
    hostEngine.resolveLayerOrder.mockImplementation(async () => fakeLayerOrderResolutions.lost(inSource, cause));
    const controller = createPoseController(stepId, listener());
    const before = stepsIn(state().diagram!).find((step) => step.id === stepId)!;
    useWorkspaceStore.setState({ dirty: false });
    const entries = state().diagramHistory.past.length;
    await controller.run({ verb: 'show-folded' });
    expect(stepsIn(state().diagram!).find((step) => step.id === stepId)).toEqual(before);
    expect(state().diagramHistory.past).toHaveLength(entries);
    expect(state().dirty).toBe(false);
    expect(toasts.error).toHaveBeenCalledOnce();
    const [text, options] = toasts.error.mock.calls[0]! as [string, { action?: { label: string } } | undefined];
    expect(text).toBe(said);
    expect(options?.action?.label).toBe(action);
    expect(analytics.trackLayerConstraintsNeedAttention).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('flags the record waiting when a pose finds its creases fold in 3D (D13)', async () => {
    const stepId = await constrainedStep();
    bindings.runtime = fakeCaptureRuntime({
      fold3d: vi.fn(async () => ({
        status: 'placed' as const,
        handle: 11,
        snapshot: {} as never,
        render: { cell_points: [0, 0, 0, 1, 0, 0, 0, 1, 0], span: 1 } as never,
      })),
    });
    useWorkspaceStore.setState({
      oristudioCpDocument: {
        handle: 1,
        document: cpDocument(undefined, (cp, id) => (id === 8 ? { ...cp, fold_magnitude: 90 } : cp)),
        geometry: null,
      } as unknown as OristudioCpDocumentState,
    });
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    expect(render(stepId)).toMatchObject({ render: { mode: 'folded-3d' } });
    expect(stepLayerOrderOf(layerOrderOf(stepId))?.record.attention).toEqual({ reason: 'route-3d', count: 1 });
    expect(hostEngine.resolveLayerOrder).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('folds again in the new order once the step’s record changes, and never in the kernel’s first', async () => {
    const stepId = await constrainedStep();
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    const other = stepLayerOrderJson({ ...STEP_LAYER_ORDER, constraints: [[1, 0, 1]] });
    useWorkspaceStore.setState({ diagram: setLinkedLayerOrder(state().diagram!, stepId, other) });
    await controller.run({ verb: 'rotate-right' });
    expect(hostEngine.resolveLayerOrder).toHaveBeenCalledTimes(2);
    controller.dispose();
  });
});

/**
 * Every kernel call the fake runtime saw, in order, by name and the handle it
 * was given (none for a fold): what the parity guard compares.
 */
function kernelCalls(runtime: CpCaptureRuntime): string[] {
  const calls: [number, string][] = [];
  for (const [name, spy] of Object.entries(runtime)) {
    const mock = (spy as { mock?: { invocationCallOrder: number[]; calls: unknown[][] } }).mock;
    mock?.invocationCallOrder.forEach((order, index) => {
      // A fold's first argument is its starting face, not a handle.
      const first = name === 'fold' ? undefined : mock.calls[index]?.[0];
      calls.push([order, typeof first === 'number' ? `${name}(${first})` : name]);
    });
  }
  return calls.sort(([a], [b]) => a - b).map(([, call]) => call);
}

describe('the Layer order dialog from Pose (H8)', () => {
  const inSource = STEP_LAYER_ORDER_IN_SOURCE;
  /** The record the dialog's Apply hands back, and how it orders the faces: not the host engine's [1, 0]. */
  const CHOSEN: LayerOrderRecord = { ...inSource, constraints: [[1, 0, 1]], order: [[1, 0, 1]] };
  const CHOSEN_RELATIONS = Uint32Array.of(0, 1);
  const apply = () => {
    dialog.outcome = (request) => ({
      kind: 'applied',
      applied: { record: CHOSEN, relations: CHOSEN_RELATIONS, source: request.source },
    });
  };
  const asked = () => dialog.openLayerOrderDialog.mock.calls.at(-1)![0] as LayerOrderRequest;
  const layerOrderOf = (stepId: string) => {
    const source = render(stepId);
    return source?.kind === 'cp' ? source.layerOrder : undefined;
  };
  const labelsSince = (entries: number) => state().diagramHistory.past.slice(entries).map((entry) => entry.label);
  /** An undo or redo as the history runs one: the canvas sessions hear it first, then it lands. */
  const historyStep = async (controller: ReturnType<typeof createPoseController>, run: () => boolean) => {
    controller.historyMoved();
    expect(run()).toBe(true);
    await Promise.resolve();
  };
  /** The handle the last picture was read from. */
  const pictured = () => vi.mocked(bindings.runtime!.paperScene).mock.calls.at(-1)?.[0];
  /** The step's source shown as `shown`, as a file opened or another surface leaves it: nothing folded here. */
  const shownAs = (stepId: string, shown: DiagramCpRender) =>
    useWorkspaceStore.setState({
      diagram: {
        ...state().diagram!,
        steps: stepsIn(state().diagram!).map((step) =>
          step.id === stepId && step.source?.kind === 'cp' ? { ...step, source: { ...step.source, render: shown } } : step
        ),
      },
    });
  /** The relations the last fold with a given order was folded with. */
  const orderedWith = () => vi.mocked(bindings.runtime!.foldWithOrder!).mock.calls.at(-1)?.[1];

  beforeEach(() => {
    hostEngine.resolveLayerOrder.mockImplementation(async (source: LayerOrderSource) =>
      fakeLayerOrderResolutions.applied(inSource, source)
    );
  });

  it('opens on the fold Pose holds, read with no fold of its own; Cancel writes nothing', async () => {
    const stepId = await linkedStep();
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    await controller.run({ verb: 'rotate-right' });
    vi.mocked(bindings.runtime!.fold).mockClear();
    vi.mocked(bindings.runtime!.paperScene).mockClear();
    const entries = state().diagramHistory.past.length;
    expect(await controller.editLayerOrder()).toBe(false);
    const request = asked();
    // The held fold's source and the paper it shows, at the order the step draws.
    expect(bindings.runtime!.fold).not.toHaveBeenCalled();
    expect(bindings.runtime!.paperScene).not.toHaveBeenCalled();
    expect(bindings.runtime!.source).toHaveBeenCalledWith(7);
    expect(request.source).toMatchObject({ segments: fakeFoldSource().segments, digest: 'fixture-digest' });
    expect(request.record).toBeNull();
    expect(request.shown).toEqual(halfFoldKernelScene());
    // The Diagram's look, as the Step pane's Edit… asks: the step's turn and side, the crease
    // pattern's lines as Edit's view draws them, no spread, no X-ray.
    const flat = render(stepId);
    if (flat?.kind !== 'cp' || flat.render.mode !== 'folded-flat') throw new Error('folded flat');
    expect(request.look).toEqual(
      diagramStepLayerOrderLook(DEFAULT_DIAGRAM_STYLE, flat.render, state().oristudioCpViewport)
    );
    expect(request.look).toMatchObject({ turnDeg: 15, side: 'front' });
    expect(request.name).toBe('Step 1');
    // Pose asked, for the dialog's events (H3's `surface`).
    expect(request.surface).toBe('pose');
    // The step's sheet alone: the left square's paper and its aux line (10), nothing of the right square.
    expect(ringsBounds(request.region!.paper)).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(request.region!.auxSegments).toEqual([document.crease_pattern.line_segments[9]]);
    expect(state().diagramHistory.past).toHaveLength(entries);
    expect(state().diagramCaptures).toEqual({});
    expect(foldedFigureHandleRefCount(7)).toBe(1);
    controller.dispose();
    expect(foldedFigureHandleRefCount(7)).toBe(0);
  });

  // The Step pane's Edit… and Review… on the step open in Pose go through Pose, and are still the Step pane's.
  it('says which surface asked: Pose’s own Edit order…, or the Step pane beside it', async () => {
    const stepId = await linkedStep();
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    await controller.editLayerOrder();
    expect(asked().surface).toBe('pose');
    await controller.editLayerOrder('edit', 'diagram_step');
    expect(asked().surface).toBe('diagram_step');
    controller.dispose();
  });

  it.each([
    ['unchanged', { kind: 'unchanged' }],
    ['busy', { kind: 'busy' }],
    ['unavailable', { kind: 'unavailable' }],
  ] as const)('writes nothing when the dialog answers %s', async (_kind, outcome) => {
    const stepId = await linkedStep();
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    dialog.outcome = () => outcome;
    const before = render(stepId);
    const entries = state().diagramHistory.past.length;
    expect(await controller.editLayerOrder()).toBe(false);
    expect(render(stepId)).toBe(before);
    expect(state().diagramHistory.past).toHaveLength(entries);
    expect(bindings.runtime!.foldWithOrder).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('folds once for the dialog when it holds nothing yet, and the next verb draws from that fold', async () => {
    const stepId = await linkedStep();
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    controller.documentReplaced();
    expect(foldedFigureHandleRefCount(7)).toBe(0);
    await controller.editLayerOrder();
    expect(bindings.runtime!.fold).toHaveBeenCalledTimes(2);
    expect(foldedFigureHandleRefCount(7)).toBe(1);
    await controller.run({ verb: 'turn-over' });
    expect(bindings.runtime!.fold).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  // The dialog restores a record itself: Pose restoring it first would ask the host engine twice before the
  // dialog opened, and fold a third time on a clash (#523 review).
  it.each([
    ['holds a fold of the kernel’s order', true],
    ['holds nothing', false],
  ])(
    'opens a constrained step that %s on the creases at the first case, freed: no restore before the dialog',
    async (_case, folded) => {
      const stepId = await linkedStep();
      const controller = createPoseController(stepId, listener());
      // Folded flat by Pose, or as a file opened leaves it: shown flat, nothing held.
      if (folded) await controller.run({ verb: 'show-folded' });
      else shownAs(stepId, { mode: 'folded-flat', side: 'back', rotationDeg: 0, foldCase: 2 });
      useWorkspaceStore.setState({ diagram: setLinkedLayerOrder(state().diagram!, stepId, stepLayerOrderJson()) });
      const entries = state().diagramHistory.past.length;
      const before = layerOrderOf(stepId);
      vi.mocked(bindings.runtime!.fold).mockClear();
      vi.mocked(bindings.runtime!.free).mockClear();
      vi.mocked(bindings.runtime!.foldToCase).mockClear();
      expect(await controller.editLayerOrder()).toBe(false);
      expect(hostEngine.resolveLayerOrder).not.toHaveBeenCalled();
      expect(bindings.runtime!.foldWithOrder).not.toHaveBeenCalled();
      // One fold of the creases, at the first case, on the step's side, read and freed.
      expect(bindings.runtime!.fold).toHaveBeenCalledOnce();
      expect(bindings.runtime!.foldToCase).not.toHaveBeenCalled();
      expect(bindings.runtime!.free).toHaveBeenCalledOnce();
      const request = asked();
      // The record as the dialog takes it, for it to restore; no scene of an order it isn't.
      expect(request.record?.constraints).toEqual(STEP_LAYER_ORDER.constraints);
      expect(request.record?.faces).toEqual(inSource.faces);
      expect(request.shown).toBeUndefined();
      // Opening wrote nothing, flag included.
      expect(layerOrderOf(stepId)).toBe(before);
      expect(state().diagramHistory.past).toHaveLength(entries);
      expect(analytics.trackLayerConstraintsNeedAttention).not.toHaveBeenCalled();
      controller.dispose();
    }
  );

  it('opens a constrained step whose fold it holds in the record’s order on that fold: no restore, no fold', async () => {
    const stepId = await linkedStep();
    useWorkspaceStore.setState({ diagram: setLinkedLayerOrder(state().diagram!, stepId, stepLayerOrderJson()) });
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    expect(hostEngine.resolveLayerOrder).toHaveBeenCalledOnce();
    vi.mocked(bindings.runtime!.fold).mockClear();
    await controller.editLayerOrder();
    expect(hostEngine.resolveLayerOrder).toHaveBeenCalledOnce();
    expect(bindings.runtime!.fold).not.toHaveBeenCalled();
    expect(bindings.runtime!.source).toHaveBeenLastCalledWith(ORDERED_HANDLE);
    controller.dispose();
  });

  it('replaces the held fold on Apply, in the pose it has, and writes the record as one undo step', async () => {
    const stepId = await linkedStep();
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    await controller.run({ verb: 'turn-over' });
    await controller.run({ verb: 'rotate-right' });
    analytics.trackDiagramPicturePosed.mockClear();
    apply();
    const entries = state().diagramHistory.past.length;
    expect(await controller.editLayerOrder()).toBe(true);
    // Named as the Step pane's Apply names it: one name for one Apply, wherever it was pressed.
    expect(labelsSince(entries)).toEqual(['Change layer order']);
    // Folded as the dialog analysed it, on the side the step shows.
    expect(bindings.runtime!.foldWithOrder).toHaveBeenCalledOnce();
    expect(bindings.runtime!.foldWithOrder).toHaveBeenCalledWith(
      expect.objectContaining({ digest: 'fixture-digest' }),
      CHOSEN_RELATIONS,
      expect.objectContaining({ state: 'Back1' })
    );
    // The held fold replaced: the new one held, the old one let go, the picture the new one's.
    expect(foldedFigureHandleRefCount(7)).toBe(0);
    expect(foldedFigureHandleRefCount(ORDERED_HANDLE)).toBe(1);
    expect(pictured()).toBe(ORDERED_HANDLE);
    // The pose it had; the record in the step's paper frame.
    expect(render(stepId)).toMatchObject({ render: { mode: 'folded-flat', side: 'back', rotationDeg: 15 } });
    expect(stepLayerOrderOf(layerOrderOf(stepId))?.record).toMatchObject({
      faces: STEP_LAYER_ORDER.faces,
      constraints: [[1, 0, 1]],
      order: [[1, 0, 1]],
    });
    // Counted by the dialog, not as a pose; and nothing restored: the order was the dialog's.
    expect(analytics.trackDiagramPicturePosed).not.toHaveBeenCalled();
    expect(hostEngine.resolveLayerOrder).not.toHaveBeenCalled();
    // A verb after it draws from the new fold, in its order.
    await controller.run({ verb: 'rotate-left' });
    expect(hostEngine.resolveLayerOrder).not.toHaveBeenCalled();
    expect(bindings.runtime!.foldWithOrder).toHaveBeenCalledOnce();
    controller.dispose();
    expect(foldedFigureHandleRefCount(ORDERED_HANDLE)).toBe(0);
  });

  it('an Apply the dialog’s Rotate turned lands at the turn, in its one undo step', async () => {
    const stepId = await linkedStep();
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    dialog.outcome = (request) => ({
      kind: 'applied',
      applied: { record: CHOSEN, relations: CHOSEN_RELATIONS, source: request.source },
      turnDeg: 330,
    });
    const entries = state().diagramHistory.past.length;
    expect(await controller.editLayerOrder()).toBe(true);
    expect(labelsSince(entries)).toEqual(['Change layer order']);
    expect(render(stepId)).toMatchObject({ render: { mode: 'folded-flat', rotationDeg: 330 } });
    expect(asked().look.turnDeg).toBe(0);
    controller.dispose();
  });

  it('an Apply that only turned the step turns it with Rotate’s own verb, counted by the dialog', async () => {
    const stepId = await linkedStep();
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    await controller.run({ verb: 'rotate-right' });
    analytics.trackDiagramPicturePosed.mockClear();
    dialog.outcome = () => ({ kind: 'unchanged', turnDeg: 45 });
    const entries = state().diagramHistory.past.length;
    expect(await controller.editLayerOrder()).toBe(false);
    expect(asked().look.turnDeg).toBe(15);
    expect(render(stepId)).toMatchObject({ render: { mode: 'folded-flat', rotationDeg: 45 } });
    expect(labelsSince(entries)).toEqual(['Adjust pose']);
    expect(layerOrderOf(stepId)).toBeUndefined();
    expect(analytics.trackDiagramPicturePosed).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('Apply → undo → Turn Over draws the order before Apply; redo brings the applied one back', async () => {
    const stepId = await linkedStep();
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    apply();
    await controller.editLayerOrder();
    const applied = layerOrderOf(stepId);
    expect(applied).toBeDefined();
    expect(foldedFigureHandleRefCount(ORDERED_HANDLE)).toBe(1);

    // Undo: the step has no record again, and the fold in the applied order is let go at once.
    await historyStep(controller, () => state().undoDiagram());
    expect(layerOrderOf(stepId)).toBeUndefined();
    expect(foldedFigureHandleRefCount(ORDERED_HANDLE)).toBe(0);
    vi.mocked(bindings.runtime!.fold).mockClear();
    await controller.run({ verb: 'turn-over' });
    // The kernel's own order, folded again: never the undone one.
    expect(bindings.runtime!.fold).toHaveBeenCalledOnce();
    expect(bindings.runtime!.foldWithOrder).toHaveBeenCalledOnce();
    expect(pictured()).toBe(7);
    expect(render(stepId)).toMatchObject({ render: { mode: 'folded-flat', side: 'back' } });
    expect(layerOrderOf(stepId)).toBeUndefined();
    expect(applied).not.toBe(layerOrderOf(stepId));
    controller.dispose();
  });

  it('redo of an Apply lets the kernel’s fold go, and the next verb draws the applied order', async () => {
    const stepId = await linkedStep();
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    apply();
    await controller.editLayerOrder();
    const applied = layerOrderOf(stepId)!;
    await historyStep(controller, () => state().undoDiagram());
    await controller.run({ verb: 'show-folded' });
    expect(foldedFigureHandleRefCount(7)).toBe(1);
    // `show-folded` on a flat step changes nothing to undo, so the redo is the Apply's.
    await historyStep(controller, () => state().redoDiagram());
    expect(layerOrderOf(stepId)).toBe(applied);
    expect(foldedFigureHandleRefCount(7)).toBe(0);
    await controller.run({ verb: 'turn-over' });
    // Restored from the record by the host engine, then folded in its order.
    expect(hostEngine.resolveLayerOrder).toHaveBeenCalledOnce();
    expect(orderedWith()).toEqual(Uint32Array.of(1, 0));
    expect(pictured()).toBe(ORDERED_HANDLE);
    controller.dispose();
  });

  it('Apply onto a constrained step, then undo: Turn Over draws the record before Apply, not the dialog’s', async () => {
    const stepId = await linkedStep();
    useWorkspaceStore.setState({ diagram: setLinkedLayerOrder(state().diagram!, stepId, stepLayerOrderJson()) });
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    const before = layerOrderOf(stepId)!;
    expect(hostEngine.resolveLayerOrder).toHaveBeenCalledOnce();
    // With a record, the dialog restores it itself: no scene of the order shown.
    apply();
    await controller.editLayerOrder();
    expect(asked().record?.constraints).toEqual(STEP_LAYER_ORDER.constraints);
    expect(asked().shown).toBeUndefined();
    expect(stepLayerOrderOf(layerOrderOf(stepId))?.record.constraints).toEqual([[1, 0, 1]]);
    expect(orderedWith()).toEqual(CHOSEN_RELATIONS);
    expect(foldedFigureHandleRefCount(ORDERED_HANDLE)).toBe(1);

    await historyStep(controller, () => state().undoDiagram());
    expect(layerOrderOf(stepId)).toBe(before);
    expect(foldedFigureHandleRefCount(ORDERED_HANDLE)).toBe(0);
    await controller.run({ verb: 'turn-over' });
    // The record before Apply, restored again: the host engine's relations, not the dialog's.
    expect(hostEngine.resolveLayerOrder).toHaveBeenCalledTimes(2);
    expect(orderedWith()).toEqual(Uint32Array.of(1, 0));
    expect(stepLayerOrderOf(layerOrderOf(stepId))?.record.constraints).toEqual(STEP_LAYER_ORDER.constraints);
    expect(render(stepId)).toMatchObject({ render: { side: 'back' } });
    controller.dispose();
  });

  it('keeps a held fold through an undo that leaves its record as it was', async () => {
    const stepId = await linkedStep();
    useWorkspaceStore.setState({ diagram: setLinkedLayerOrder(state().diagram!, stepId, stepLayerOrderJson()) });
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    await controller.run({ verb: 'rotate-right' });
    await historyStep(controller, () => state().undoDiagram());
    expect(foldedFigureHandleRefCount(ORDERED_HANDLE)).toBe(1);
    await controller.run({ verb: 'turn-over' });
    expect(hostEngine.resolveLayerOrder).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it('keeps the record through Reset Pose: the same text, drawn from the fold it holds', async () => {
    const stepId = await linkedStep();
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    apply();
    await controller.editLayerOrder();
    await controller.run({ verb: 'turn-over' });
    await controller.run({ verb: 'rotate-right' });
    const kept = layerOrderOf(stepId);
    await controller.run({ verb: 'reset' });
    expect(render(stepId)).toMatchObject({ render: { mode: 'folded-flat', side: 'front', rotationDeg: 0 } });
    expect(layerOrderOf(stepId)).toBe(kept);
    // No restore, no new fold, no step of the kernel's enumeration.
    expect(hostEngine.resolveLayerOrder).not.toHaveBeenCalled();
    expect(bindings.runtime!.foldWithOrder).toHaveBeenCalledOnce();
    expect(bindings.runtime!.foldToCase).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('writes nothing for an Apply onto a step that changed while the dialog was open', async () => {
    const stepId = await linkedStep();
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    dialog.outcome = (request) => {
      // Something else changed the step meanwhile.
      useWorkspaceStore.setState({ diagram: setLinkedLayerOrder(state().diagram!, stepId, stepLayerOrderJson()) });
      return { kind: 'applied', applied: { record: CHOSEN, relations: CHOSEN_RELATIONS, source: request.source } };
    };
    const entries = state().diagramHistory.past.length;
    expect(await controller.editLayerOrder()).toBe(false);
    expect(state().diagramHistory.past).toHaveLength(entries);
    expect(layerOrderOf(stepId)).toBe(stepLayerOrderJson());
    expect(bindings.runtime!.foldWithOrder).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('writes nothing, keeps its fold and says so when the kernel cannot draw the order applied (D3)', async () => {
    const stepId = await linkedStep();
    bindings.runtime = fakeCaptureRuntime({
      foldWithOrder: vi.fn(async () => ({ status: 'refused' as const, refusal: { code: 'digest_mismatch' } as never })),
    });
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    apply();
    const entries = state().diagramHistory.past.length;
    expect(await controller.editLayerOrder()).toBe(false);
    expect(state().diagramHistory.past).toHaveLength(entries);
    expect(layerOrderOf(stepId)).toBeUndefined();
    expect(foldedFigureHandleRefCount(7)).toBe(1);
    expect(toasts.error).toHaveBeenCalledWith('This layer order couldn’t be drawn, so nothing was changed.');
    controller.dispose();
  });

  it('holds no fold for an Apply that lands after the detail closed', async () => {
    const stepId = await linkedStep();
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    dialog.outcome = (request) => {
      controller.dispose();
      return { kind: 'applied', applied: { record: CHOSEN, relations: CHOSEN_RELATIONS, source: request.source } };
    };
    expect(await controller.editLayerOrder()).toBe(false);
    expect(bindings.runtime!.foldWithOrder).not.toHaveBeenCalled();
    expect(foldedFigureHandleRefCount(7)).toBe(0);
    expect(foldedFigureHandleRefCount(ORDERED_HANDLE)).toBe(0);
  });

  it('holds only the new fold for an Apply after the engine was lost while the dialog was open', async () => {
    const stepId = await linkedStep();
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    dialog.outcome = async (request) => {
      // The CP engine restarts under the dialog: its handles are gone, the registry reset with them.
      controller.engineLost();
      await resetFoldedFigureHandles();
      return { kind: 'applied', applied: { record: CHOSEN, relations: CHOSEN_RELATIONS, source: request.source } };
    };
    expect(await controller.editLayerOrder()).toBe(true);
    // The old fold forgotten with the engine that held it; the applied one held in the new one.
    expect(foldedFigureHandleRefCount(7)).toBe(0);
    expect(foldedFigureHandleRefCount(ORDERED_HANDLE)).toBe(1);
    controller.dispose();
    expect(foldedFigureHandleRefCount(ORDERED_HANDLE)).toBe(0);
  });

  it('opens nothing on a step whose creases fold in 3D now, and says so', async () => {
    const stepId = await linkedStep();
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    useWorkspaceStore.setState({
      oristudioCpDocument: {
        handle: 1,
        document: cpDocument(undefined, (cp, id) => (id === 8 ? { ...cp, fold_magnitude: 90 } : cp)),
        geometry: null,
      } as unknown as OristudioCpDocumentState,
    });
    expect(await controller.editLayerOrder()).toBe(false);
    expect(dialog.openLayerOrderDialog).not.toHaveBeenCalled();
    expect(toasts.message).toHaveBeenCalledWith(
      'This step’s creases fold in 3D now, and layer order works on flat folds. Refresh the step to see it.'
    );
    controller.dispose();
  });

  // The parity guard: with no record, a pose's kernel calls are exactly those before H7 and H8, in order.
  it('makes exactly the kernel calls it always did for a step with no record', async () => {
    const stepId = await linkedStep();
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    await controller.run({ verb: 'rotate-right' });
    await controller.run({ verb: 'turn-over' });
    await controller.run({ verb: 'next-solution' });
    await controller.run({ verb: 'previous-solution' });
    await controller.run({ verb: 'reset' });
    await controller.run({ verb: 'show-crease-pattern' });
    expect(kernelCalls(bindings.runtime!)).toEqual([
      // Show Folded: one fold, read once.
      'fold',
      'renderSnapshot(7)',
      'paperScene(7)',
      // Rotate Right draws again from what was read: no call.
      // Turn Over: a model change on the held fold.
      'setModel(7)',
      'renderSnapshot(7)',
      'paperScene(7)',
      // Next Layer Order: the search's next, on the same handle.
      'foldAnother(7)',
      'renderSnapshot(7)',
      'paperScene(7)',
      // Previous: a jump back.
      'foldToCase(7)',
      'renderSnapshot(7)',
      'paperScene(7)',
      // Reset Pose: back to the front.
      'setModel(7)',
      'renderSnapshot(7)',
      'paperScene(7)',
      // Show Crease Pattern folds nothing; the fold is let go through the registry.
    ]);
    expect(bindings.runtime!.source).not.toHaveBeenCalled();
    expect(bindings.runtime!.foldWithOrder).not.toHaveBeenCalled();
    expect(hostEngine.resolveLayerOrder).not.toHaveBeenCalled();
    controller.dispose();
  });

  // Review… is the Step pane's flag's (D14): through Pose too while the step is open there, one session per step.
  it('reviews a flagged step shown as its crease pattern: opens on its record, and Apply folds it flat', async () => {
    const stepId = await linkedStep();
    const flagged = stepLayerOrderJson({ ...STEP_LAYER_ORDER, attention: { reason: 'conflict', count: 1 } });
    useWorkspaceStore.setState({ diagram: setLinkedLayerOrder(state().diagram!, stepId, flagged) });
    const controller = createPoseController(stepId, listener());
    // Edit… is a flat fold's: nothing opens from a crease pattern.
    expect(await controller.editLayerOrder('edit')).toBe(false);
    expect(dialog.openLayerOrderDialog).not.toHaveBeenCalled();
    apply();
    const entries = state().diagramHistory.past.length;
    expect(await controller.editLayerOrder('review')).toBe(true);
    // On its record, for the dialog to restore and mark; nothing restored here.
    expect(asked().record?.attention).toEqual({ reason: 'conflict', count: 1 });
    expect(asked().shown).toBeUndefined();
    expect(hostEngine.resolveLayerOrder).not.toHaveBeenCalled();
    // Applied: folded flat in the pose it would show, the dialog's record, one undo step.
    expect(render(stepId)).toMatchObject({ render: { mode: 'folded-flat' } });
    expect(stepLayerOrderOf(layerOrderOf(stepId))?.record.constraints).toEqual([[1, 0, 1]]);
    expect(labelsSince(entries)).toEqual(['Change layer order']);
    expect(foldedFigureHandleRefCount(ORDERED_HANDLE)).toBe(1);
    controller.dispose();
  });
});

/**
 * A kernel that hands out a new handle per figure, and says what was used
 * after it was freed (`strict`: answering as the kernel's arena answers a
 * freed slot, "invalid folded figure handle"); a call of a name can be held
 * until let through. From the #523 review's ledger.
 */
function trackingKernel({ strict = true }: { strict?: boolean } = {}) {
  let next = 100;
  const live = new Set<number>();
  const freed = new Set<number>();
  const usedAfterFree: string[] = [];
  const gates = new Map<string, { reach: () => void; wait: Promise<void> }>();
  const gated = async (name: string) => {
    const gate = gates.get(name);
    if (!gate) return;
    gates.delete(name);
    gate.reach();
    await gate.wait;
  };
  const use = async (name: string, handle: number) => {
    await gated(name);
    if (freed.has(handle) || !live.has(handle)) {
      usedAfterFree.push(`${name}(${handle})`);
      if (strict) throw new Error('invalid folded figure handle');
    }
  };
  const free = (handle: number) => {
    freed.add(handle);
    live.delete(handle);
  };
  setFoldedFigureHandleFree(free);
  const folded = () => {
    const handle = next++;
    live.add(handle);
    return handle;
  };
  const runtime = fakeCaptureRuntime({
    fold: vi.fn(async () => ({ handle: folded(), discoveredCases: 1, displayStyle: 'Paper5' as const, outcome: 'Solved' as const })),
    foldWithOrder: vi.fn(async () => ({
      status: 'folded' as const,
      handle: folded(),
      discoveredCases: 1,
      displayStyle: 'Paper5' as const,
      outcome: 'Solved' as const,
      currentCase: 1,
      hasNext: false,
    })),
    source: vi.fn(async (handle: number) => {
      await use('source', handle);
      return fakeFoldSource();
    }),
    setModel: vi.fn(async (handle: number) => {
      await use('setModel', handle);
      return { discoveredCases: 1, displayStyle: 'Paper5' as const };
    }),
    renderSnapshot: vi.fn(async (handle: number) => {
      await use('renderSnapshot', handle);
      return squareRenderSnapshot();
    }),
    paperScene: vi.fn(async (handle: number) => {
      await use('paperScene', handle);
      return halfFoldKernelScene();
    }),
    free: vi.fn(async (handle: number) => free(handle)),
  });
  return {
    runtime,
    live,
    usedAfterFree,
    /** Hold the next call of `name` until `release`; `reached` once it is held. */
    gate(name: string) {
      let reach!: () => void;
      let release!: () => void;
      const reached = new Promise<void>((resolve) => (reach = resolve));
      const wait = new Promise<void>((resolve) => (release = resolve));
      gates.set(name, { reach, wait });
      return { reached, release };
    },
  };
}

// An undo heard while a verb of this step reads the fold Pose holds — Apply, Turn Over, ⌘Z some milliseconds
// later on kabuto (#523 review): the fold in the undone order is let go only once that read is over.
describe('an undo that lands while Pose reads its held fold (#523 review)', () => {
  const CHOSEN: LayerOrderRecord = { ...STEP_LAYER_ORDER_IN_SOURCE, constraints: [[1, 0, 1]], order: [[1, 0, 1]] };
  const applied = (request: LayerOrderRequest): LayerOrderDialogOutcome => ({
    kind: 'applied',
    applied: { record: CHOSEN, relations: Uint32Array.of(0, 1), source: request.source },
  });
  const layerOrderOf = (stepId: string) => {
    const source = render(stepId);
    return source?.kind === 'cp' ? source.layerOrder : undefined;
  };
  const settled = async () => {
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  };

  it('lets a turn-over read the fold it began on, then lets that fold go', async () => {
    const kernel = trackingKernel();
    bindings.runtime = kernel.runtime;
    const stepId = await linkedStep();
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    dialog.outcome = applied;
    expect(await controller.editLayerOrder()).toBe(true);
    const [ordered] = [...kernel.live];
    const gate = kernel.gate('paperScene');
    const turning = controller.run({ verb: 'turn-over' });
    await gate.reached;
    // ⌘Z: the canvas sessions hear it, then the Apply is undone, while the turn reads its picture.
    controller.historyMoved();
    expect(state().undoDiagram()).toBe(true);
    await settled();
    expect(kernel.live.has(ordered!)).toBe(true);
    gate.release();
    await turning;
    await settled();
    expect(kernel.usedAfterFree).toEqual([]);
    expect(toasts.error).not.toHaveBeenCalled();
    // The turn landed on the step it began on, not the undone one, and wrote nothing.
    expect(layerOrderOf(stepId)).toBeUndefined();
    // Then the fold in the undone order is let go.
    expect(kernel.live.size).toBe(0);
    controller.dispose();
  });

  it('lets Edit order… read its source from the fold it held, opens nothing on the step it no longer is, then lets that fold go', async () => {
    const kernel = trackingKernel();
    bindings.runtime = kernel.runtime;
    const stepId = await linkedStep();
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    dialog.outcome = applied;
    expect(await controller.editLayerOrder()).toBe(true);
    const [ordered] = [...kernel.live];
    dialog.openLayerOrderDialog.mockClear();
    const gate = kernel.gate('source');
    const opening = controller.editLayerOrder();
    await gate.reached;
    controller.historyMoved();
    expect(state().undoDiagram()).toBe(true);
    await settled();
    expect(kernel.live.has(ordered!)).toBe(true);
    gate.release();
    expect(await opening).toBe(false);
    await settled();
    expect(kernel.usedAfterFree).toEqual([]);
    expect(toasts.error).not.toHaveBeenCalled();
    // Read for a step the undo has taken back: the dialog would open on what the step no longer is.
    expect(dialog.openLayerOrderDialog).not.toHaveBeenCalled();
    expect(kernel.live.size).toBe(0);
    controller.dispose();
  });

  it('still lets a stale fold go at once when nothing of the step is being read', async () => {
    const kernel = trackingKernel();
    bindings.runtime = kernel.runtime;
    const stepId = await linkedStep();
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    dialog.outcome = applied;
    await controller.editLayerOrder();
    expect(kernel.live.size).toBe(1);
    controller.historyMoved();
    expect(state().undoDiagram()).toBe(true);
    await settled();
    expect(kernel.live.size).toBe(0);
    expect(layerOrderOf(stepId)).toBeUndefined();
    controller.dispose();
    expect(kernel.usedAfterFree).toEqual([]);
  });
});
