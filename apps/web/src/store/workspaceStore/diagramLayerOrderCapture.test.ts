/**
 * A Diagram step's layer order through the store's capture (layer order H7):
 * Refresh draws the record's order and commits it with the picture; a record
 * that cannot be drawn keeps the picture and is flagged, one undo step; a
 * Stop ends the restore; Refresh All shares one host engine batch; Show as,
 * Duplicate and Duplicate as keep the record; a locked step is never touched.
 * The kernel is the fixture's fake, the host engine a stand-in.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { sheetRegions } from '../../cp-workspace/sheets/cpSheetRegions';
import {
  cpDocument,
  fakeCaptureRuntime,
  fakeLayerOrderResolutions,
  STEP_LAYER_ORDER,
  STEP_LAYER_ORDER_IN_SOURCE,
  stepLayerOrderJson,
  TWO_SQUARES,
  twoSquaresIndex,
  type FixtureLine,
} from '../../diagram/capture/capture.fixtures';
import type { CpCaptureRuntime } from '../../diagram/capture/captureFolded';
import { stepLayerOrderOf } from '../../diagram/capture/captureLayerOrder';
import { refreshAllDiagramSteps } from '../../diagram/capture/captureQueue';
import {
  duplicateLinkedStepAs,
  linkDiagramStep,
  refreshDiagramStep,
  showLinkedStepAs,
} from '../../diagram/capture/stepCaptureActions';
import { setLinkedLayerOrder, stepById, type DiagramCpSource } from '../../diagram/document/diagramDocument';
import { stepsIn } from '../../diagram/document/diagramSteps.fixtures';
import type { LayerOrderResolution, LayerOrderResolveBatch } from '../../layer-order/host/hostEngineGateway';
import { encodeLayerOrderRecord, type LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import type { LayerOrderSource } from '../../lib/layerOrder/layerOrderRequest';
import { useLayoutStore } from '../layoutStore';
import { useWorkspaceStore } from '../workspaceStore';

const bindings = vi.hoisted(() => ({ runtime: null as CpCaptureRuntime | null }));
vi.mock('./cpFoldRuntimeBindings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./cpFoldRuntimeBindings')>()),
  createCpCaptureRuntime: () => bindings.runtime,
}));
vi.mock('../../cp-workspace/sheets/cpSheetIndex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cp-workspace/sheets/cpSheetIndex')>()),
  ensureCpSheetIndex: vi.fn(async () => sheets),
  peekCpSheetIndex: vi.fn(() => sheets),
}));
vi.mock('../../lib/foldCancellation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/foldCancellation')>()),
  foldCancellationAvailable: () => true,
  cancelFoldRun: vi.fn(),
}));
type Answer = (source: LayerOrderSource, record: LayerOrderRecord, signal?: AbortSignal) => Promise<LayerOrderResolution>;
const hostEngine = vi.hoisted(() => ({
  answer: null as null | Answer,
  resolveLayerOrder: vi.fn(),
  batches: [] as { resolve: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[],
  openLayerOrderResolveBatch: vi.fn(),
}));
vi.mock('../../layer-order/host/hostEngineGateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../layer-order/host/hostEngineGateway')>()),
  resolveLayerOrder: hostEngine.resolveLayerOrder,
  openLayerOrderResolveBatch: hostEngine.openLayerOrderResolveBatch,
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));
const analytics = vi.hoisted(() => ({
  trackDiagramPictureCaptured: vi.fn(),
  trackDiagramStepShownAs: vi.fn(),
  trackLayerConstraintsNeedAttention: vi.fn(),
}));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...analytics,
}));

const sheets = twoSquaresIndex();
const [left, right] = sheetRegions(sheets);
const initialState = useWorkspaceStore.getInitialState();
const state = () => useWorkspaceStore.getState();
const json = stepLayerOrderJson();
/** The record as the host engine takes it: about the crease pattern's origin. */
const inSource = STEP_LAYER_ORDER_IN_SOURCE;
const FLAT = { mode: 'folded-flat' as const, side: 'front' as const, rotationDeg: 0, foldCase: 1 };

const useDocument = (document = cpDocument()) =>
  useWorkspaceStore.setState({
    oristudioCpDocument: { handle: 1, document, geometry: null } as unknown as OristudioCpDocumentState,
  });

/** Both diagonals turned the other way: both squares' links go out of date. */
const edited = () =>
  cpDocument(
    TWO_SQUARES.map((line, i): FixtureLine =>
      i === 7 ? ([...line.slice(0, 4), 'Blue2'] as FixtureLine) : i === 8 ? ([...line.slice(0, 4), 'Red1'] as FixtureLine) : line
    )
  );

/** A step linked to `region`, folded flat, with no layer order chosen. */
async function linkedStep(region = left): Promise<string> {
  const stepId = state().addDiagramStep()!;
  await state().captureDiagramStep(stepId, {
    scope: { kind: 'segment', region: regionReferenceFor(region!) },
    render: FLAT,
    kind: 'diagram-capture',
    label: 'Link pattern',
  });
  return stepId;
}

/** A step linked to `region`, folded flat, carrying the fixture's record (as an Apply would leave it). */
async function constrainedStep(region = left): Promise<string> {
  const stepId = await linkedStep(region);
  useWorkspaceStore.setState({ diagram: setLinkedLayerOrder(state().diagram!, stepId, json) });
  return stepId;
}

/** A record as a step's source keeps it. */
function encoded(record: LayerOrderRecord): string {
  const written = encodeLayerOrderRecord(record);
  if (!written.ok) throw new Error('the fixture record encodes');
  return written.json;
}

/** Let a run reach what it waits on. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const step = (stepId: string) => stepById(state().diagram!, stepId)!;
const source = (stepId: string) => step(stepId).source as DiagramCpSource;

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(initialState, true);
  useLayoutStore.setState({ activeWorkspace: 'diagram' });
  useDocument();
  bindings.runtime = fakeCaptureRuntime();
  hostEngine.answer = async (source) => fakeLayerOrderResolutions.applied(inSource, source);
  hostEngine.resolveLayerOrder.mockImplementation((source: LayerOrderSource, record: LayerOrderRecord, _limits: unknown, options?: { signal?: AbortSignal }) =>
    hostEngine.answer!(source, record, options?.signal)
  );
  hostEngine.batches.length = 0;
  hostEngine.openLayerOrderResolveBatch.mockImplementation((): LayerOrderResolveBatch => {
    const batch = {
      resolve: vi.fn((source: LayerOrderSource, record: LayerOrderRecord, _limits?: unknown, options?: { signal?: AbortSignal }) =>
        hostEngine.answer!(source, record, options?.signal)
      ),
      close: vi.fn(),
    };
    hostEngine.batches.push(batch);
    return batch;
  });
});

describe('a step’s layer order, captured', () => {
  it('Refresh draws the record’s order and commits it with the picture, one undo step', async () => {
    const stepId = await constrainedStep();
    const pictureBefore = step(stepId).picture?.key;
    const entries = state().diagramHistory.past.length;
    expect(await refreshDiagramStep(stepId)).toBe(true);
    expect(hostEngine.resolveLayerOrder).toHaveBeenCalledOnce();
    expect(hostEngine.resolveLayerOrder.mock.calls[0]![1]).toEqual(inSource);
    expect(bindings.runtime!.foldWithOrder).toHaveBeenCalledOnce();
    expect(step(stepId).picture?.key).not.toBe(pictureBefore);
    expect(stepLayerOrderOf(source(stepId).layerOrder)?.record.constraints).toEqual(STEP_LAYER_ORDER.constraints);
    expect(state().diagramHistory.past).toHaveLength(entries + 1);
    expect(analytics.trackLayerConstraintsNeedAttention).not.toHaveBeenCalled();
  });

  it.each([
    // Only a reload retries a load that failed: Reload, the toast's one action.
    ['load', 'Layer order couldn’t load, so this step wasn’t changed. Reload Ori Studio to try again.', 'Reload'],
    ['crashed', 'Layer order stopped unexpectedly, so this step wasn’t changed.', undefined],
    // The engine's own "did not start" may be a defect: nothing to reload for.
    ['unavailable', 'Layer order stopped unexpectedly, so this step wasn’t changed.', undefined],
  ] as const)(
    'with no host engine (%s) writes nothing: no undo step, not dirty, never saved as couldn’t be checked',
    async (cause, said, action) => {
      const stepId = await constrainedStep();
      const before = step(stepId);
      useWorkspaceStore.setState({ dirty: false });
      hostEngine.answer = async () => fakeLayerOrderResolutions.lost(inSource, cause);
      const entries = state().diagramHistory.past.length;
      expect(await refreshDiagramStep(stepId)).toBe(false);
      expect(step(stepId)).toEqual(before);
      expect(stepLayerOrderOf(source(stepId).layerOrder)?.record.attention).toBeUndefined();
      expect(state().diagramHistory.past).toHaveLength(entries);
      expect(state().dirty).toBe(false);
      expect(toasts.error).toHaveBeenCalledOnce();
      const [text, options] = toasts.error.mock.calls[0]! as [string, { action?: { label: string } } | undefined];
      expect(text).toBe(said);
      expect(options?.action?.label).toBe(action);
      expect(analytics.trackLayerConstraintsNeedAttention).not.toHaveBeenCalled();
    }
  );

  it.each(['clash', 'timed_out', 'refused'] as const)(
    'on %s keeps the step’s picture and flags its record, one undo step, and says so (D10)',
    async (outcome) => {
      const stepId = await constrainedStep();
      const before = step(stepId);
      hostEngine.answer = async () => fakeLayerOrderResolutions.kept(outcome, inSource);
      const entries = state().diagramHistory.past.length;
      const captured = await state().captureDiagramStep(stepId, {
        scope: source(stepId).scope,
        render: source(stepId).render,
        kind: 'diagram-refresh',
        label: 'Refresh picture',
        layerOrder: json,
      });
      expect(captured).toMatchObject({ status: 'needs-attention', changed: true });
      const after = step(stepId);
      expect(after.picture).toEqual(before.picture);
      expect(source(stepId).fingerprint).toBe((before.source as DiagramCpSource).fingerprint);
      const flagged = stepLayerOrderOf(source(stepId).layerOrder)!.record;
      expect(flagged.faces).toEqual(STEP_LAYER_ORDER.faces);
      expect(flagged.attention).toBeDefined();
      expect(state().diagramHistory.past).toHaveLength(entries + 1);
      // Flagged so already: nothing new to record.
      const again = await state().captureDiagramStep(stepId, {
        scope: source(stepId).scope,
        render: source(stepId).render,
        kind: 'diagram-refresh',
        label: 'Refresh picture',
        layerOrder: source(stepId).layerOrder,
      });
      expect(again).toMatchObject({ status: 'needs-attention', changed: false });
      expect(state().diagramHistory.past).toHaveLength(entries + 1);
    }
  );

  it('fires `layer constraints need attention` with enums only, once, as the stored summary changes', async () => {
    const stepId = await constrainedStep();
    hostEngine.answer = async () => fakeLayerOrderResolutions.kept('clash', inSource);
    await refreshDiagramStep(stepId);
    expect(analytics.trackLayerConstraintsNeedAttention).toHaveBeenCalledOnce();
    expect(analytics.trackLayerConstraintsNeedAttention).toHaveBeenCalledWith({
      surface: 'diagram_step',
      broken_count_bucket: '<=1',
    });
    // A single Refresh says why it kept its picture.
    expect(toasts.message).toHaveBeenCalledWith('This step’s layer constraints need attention, so it keeps its picture.');
    // Not a capture: no picture was taken.
    expect(analytics.trackDiagramPictureCaptured).not.toHaveBeenCalled();
    // Refreshed again, flagged as it was: nothing new to count.
    await refreshDiagramStep(stepId);
    expect(analytics.trackLayerConstraintsNeedAttention).toHaveBeenCalledOnce();
  });

  it('draws a step with some constraints left out with no toast, and counts it once (D10, D14)', async () => {
    const stepId = await constrainedStep();
    const attention = { reason: 'unresolved' as const, count: 1 };
    hostEngine.answer = async (source) => fakeLayerOrderResolutions.applied(inSource, source, attention);
    expect(await refreshDiagramStep(stepId)).toBe(true);
    expect(stepLayerOrderOf(source(stepId).layerOrder)?.record.attention).toEqual(attention);
    expect(toasts.message).not.toHaveBeenCalled();
    expect(analytics.trackLayerConstraintsNeedAttention).toHaveBeenCalledOnce();
    await refreshDiagramStep(stepId);
    expect(analytics.trackLayerConstraintsNeedAttention).toHaveBeenCalledOnce();
  });

  it('a chosen order with no constraints (D16) says so in its own words, and counts nothing broken', async () => {
    const stepId = await constrainedStep();
    const chosen = { ...STEP_LAYER_ORDER, constraints: [] };
    useWorkspaceStore.setState({ diagram: setLinkedLayerOrder(state().diagram!, stepId, encoded(chosen)) });
    hostEngine.answer = async () => fakeLayerOrderResolutions.kept('timed_out', { ...inSource, constraints: [] });
    await refreshDiagramStep(stepId);
    expect(stepLayerOrderOf(source(stepId).layerOrder)?.record.attention).toEqual({ reason: 'timeout', count: 0 });
    expect(toasts.message).toHaveBeenCalledWith('This step’s chosen layer order needs attention, so it keeps its picture.');
    expect(analytics.trackLayerConstraintsNeedAttention).not.toHaveBeenCalled();
  });

  it('a Stop on the step ends its restore: nothing is committed', async () => {
    const stepId = await constrainedStep();
    let asked!: () => void;
    const restoring = new Promise<void>((resolve) => {
      asked = resolve;
    });
    hostEngine.answer = (_source, _record, signal) => {
      asked();
      return new Promise((resolve) => signal?.addEventListener('abort', () => resolve({ outcome: 'cancelled' })));
    };
    const before = step(stepId);
    const entries = state().diagramHistory.past.length;
    const refreshing = state().captureDiagramStep(stepId, {
      scope: source(stepId).scope,
      render: source(stepId).render,
      kind: 'diagram-refresh',
      label: 'Refresh picture',
      layerOrder: json,
    });
    await restoring;
    expect(state().stopDiagramCapture(stepId)).toBe(true);
    expect(await refreshing).toEqual({ status: 'stopped' });
    expect(step(stepId)).toEqual(before);
    expect(state().diagramHistory.past).toHaveLength(entries);
    expect(state().oristudioCpFoldRuns).toEqual({});
  });

  it('Refresh All restores every constrained step on one host engine batch, closed with the run', async () => {
    const first = await constrainedStep(left);
    const second = await constrainedStep(right);
    useDocument(edited());
    expect(await refreshAllDiagramSteps()).toBe(2);
    expect(hostEngine.openLayerOrderResolveBatch).toHaveBeenCalledOnce();
    expect(hostEngine.resolveLayerOrder).not.toHaveBeenCalled();
    const [batch] = hostEngine.batches;
    expect(batch!.resolve).toHaveBeenCalledTimes(2);
    expect(batch!.close).toHaveBeenCalledOnce();
    expect(stepLayerOrderOf(source(first).layerOrder)).not.toBeNull();
    expect(stepLayerOrderOf(source(second).layerOrder)).not.toBeNull();
  });

  it('Refresh All says the steps that kept their pictures in one toast, and counts each once', async () => {
    await constrainedStep(left);
    await constrainedStep(right);
    useDocument(edited());
    hostEngine.answer = async () => fakeLayerOrderResolutions.kept('clash', inSource);
    expect(await refreshAllDiagramSteps()).toBe(0);
    expect(toasts.message).toHaveBeenCalledOnce();
    expect(toasts.message).toHaveBeenCalledWith('2 steps’ layer constraints need attention, so they keep their pictures.');
    expect(analytics.trackLayerConstraintsNeedAttention).toHaveBeenCalledTimes(2);
    // Run again, both flagged as they were: the run says so again, and counts nothing new.
    expect(await refreshAllDiagramSteps()).toBe(0);
    expect(toasts.message).toHaveBeenCalledTimes(2);
    expect(analytics.trackLayerConstraintsNeedAttention).toHaveBeenCalledTimes(2);
  });

  it('Refresh All offline asks the host engine once: the constrained steps after it are counted, the rest refreshed', async () => {
    for (let i = 0; i < 5; i += 1) await constrainedStep(left);
    await linkedStep(right);
    useDocument(edited());
    hostEngine.answer = async () => fakeLayerOrderResolutions.lost(inSource, 'load');
    vi.mocked(bindings.runtime!.source!).mockClear();
    const entries = state().diagramHistory.past.length;
    expect(await refreshAllDiagramSteps()).toBe(1);
    expect(hostEngine.batches).toHaveLength(1);
    expect(hostEngine.batches[0]!.resolve).toHaveBeenCalledOnce();
    // Folded for the step that asked, not for those counted after it.
    expect(bindings.runtime!.source).toHaveBeenCalledOnce();
    expect(toasts.error).toHaveBeenCalledOnce();
    expect(toasts.error).toHaveBeenCalledWith(
      'Layer order couldn’t load, so 5 steps weren’t changed. Reload Ori Studio to try again.',
      { action: expect.objectContaining({ label: 'Reload' }) }
    );
    expect(toasts.success).toHaveBeenCalledWith('Refreshed 1 step');
    // The unconstrained step's picture, one entry; no record flagged.
    expect(state().diagramHistory.past).toHaveLength(entries + 1);
    const flagged = stepsIn(state().diagram!).filter(
      (entry) => entry.source?.kind === 'cp' && stepLayerOrderOf(entry.source.layerOrder)?.record.attention
    );
    expect(flagged).toHaveLength(0);
  });

  it('Refresh All goes on after a crash, which may be one record’s, and counts what it left', async () => {
    for (let i = 0; i < 3; i += 1) await constrainedStep(left);
    useDocument(edited());
    let asked = 0;
    hostEngine.answer = async (source) =>
      asked++ === 0 ? fakeLayerOrderResolutions.lost(inSource, 'crashed') : fakeLayerOrderResolutions.applied(inSource, source);
    expect(await refreshAllDiagramSteps()).toBe(2);
    expect(hostEngine.batches[0]!.resolve).toHaveBeenCalledTimes(3);
    expect(toasts.error).toHaveBeenCalledOnce();
    expect(toasts.error).toHaveBeenCalledWith('Layer order stopped unexpectedly, so 1 step wasn’t changed.');
  });

  it('Refresh All says what it refreshed and what kept its picture together', async () => {
    await constrainedStep(left);
    await linkedStep(right);
    useDocument(edited());
    hostEngine.answer = async () => fakeLayerOrderResolutions.kept('clash', inSource);
    expect(await refreshAllDiagramSteps()).toBe(1);
    expect(toasts.success).toHaveBeenCalledOnce();
    expect(toasts.success).toHaveBeenCalledWith('Refreshed 1 step', {
      description: '1 step’s layer constraints need attention, so it keeps its picture.',
    });
    expect(toasts.message).not.toHaveBeenCalled();
  });

  it('Refresh All opens a host engine only for a constrained step, and only once it has done waiting for Edit', async () => {
    await linkedStep(right);
    useDocument(edited());
    await refreshAllDiagramSteps();
    expect(hostEngine.openLayerOrderResolveBatch).not.toHaveBeenCalled();

    await constrainedStep(left);
    useDocument(cpDocument());
    useLayoutStore.setState({ activeWorkspace: 'edit' });
    const run = refreshAllDiagramSteps();
    await settle();
    expect(hostEngine.openLayerOrderResolveBatch).not.toHaveBeenCalled();
    useLayoutStore.setState({ activeWorkspace: 'diagram' });
    await run;
    expect(hostEngine.openLayerOrderResolveBatch).toHaveBeenCalledOnce();
    expect(hostEngine.batches[0]!.close).toHaveBeenCalledOnce();
  });

  it('a relink to the step’s own sheet keeps its record and restores it', async () => {
    const stepId = await constrainedStep(left);
    expect(await linkDiagramStep(stepId, left!)).toBe(true);
    expect(hostEngine.resolveLayerOrder).toHaveBeenCalledOnce();
    expect(stepLayerOrderOf(source(stepId).layerOrder)?.record.constraints).toEqual(STEP_LAYER_ORDER.constraints);
    expect(toasts.message).not.toHaveBeenCalled();
  });

  it('a relink to another sheet leaves its record behind and says so; Undo brings it back', async () => {
    const stepId = await constrainedStep(left);
    expect(await linkDiagramStep(stepId, right!)).toBe(true);
    expect(hostEngine.resolveLayerOrder).not.toHaveBeenCalled();
    expect(source(stepId).layerOrder).toBeUndefined();
    expect(toasts.message).toHaveBeenCalledWith(
      'The step’s layer constraint was for its old pattern, so it was removed. Undo brings it back.'
    );
    expect(state().undoDiagram()).toBe(true);
    expect(source(stepId).layerOrder).toBe(json);
  });

  it('a first link starts with no record, and asks the host engine nothing', async () => {
    const stepId = state().addDiagramStep()!;
    expect(await linkDiagramStep(stepId, left!, 'folded')).toBe(true);
    expect(source(stepId).layerOrder).toBeUndefined();
    expect(hostEngine.resolveLayerOrder).not.toHaveBeenCalled();
    expect(toasts.message).not.toHaveBeenCalled();
  });

  it('Show as Crease Pattern and back keeps the record, restored as it is drawn again', async () => {
    const stepId = await constrainedStep();
    expect(await showLinkedStepAs(stepId, 'crease-pattern', 'pane')).toBe(true);
    expect(source(stepId).render.mode).toBe('crease-pattern');
    expect(source(stepId).layerOrder).toBe(json);
    expect(hostEngine.resolveLayerOrder).not.toHaveBeenCalled();
    expect(await showLinkedStepAs(stepId, 'folded', 'pane')).toBe(true);
    expect(source(stepId).render.mode).toBe('folded-flat');
    expect(hostEngine.resolveLayerOrder).toHaveBeenCalledOnce();
    expect(stepLayerOrderOf(source(stepId).layerOrder)?.record.constraints).toEqual(STEP_LAYER_ORDER.constraints);
  });

  it('Duplicate copies the record, and Duplicate as keeps it on the copy', async () => {
    const stepId = await constrainedStep();
    const copyId = state().duplicateDiagramStep(stepId)!;
    expect(source(copyId).layerOrder).toBe(json);
    const shownAs = await duplicateLinkedStepAs(stepId, 'crease-pattern');
    expect(shownAs).not.toBeNull();
    expect(source(shownAs!).layerOrder).toBe(json);
    expect(source(shownAs!).render.mode).toBe('crease-pattern');
  });

  it('Duplicate as Folded onto a record that clashes makes no copy, says so of the copy, and counts nothing', async () => {
    const stepId = await constrainedStep();
    expect(await showLinkedStepAs(stepId, 'crease-pattern', 'pane')).toBe(true);
    vi.clearAllMocks();
    hostEngine.answer = async () => fakeLayerOrderResolutions.kept('clash', inSource);
    const steps = stepsIn(state().diagram!).length;
    const entries = state().diagramHistory.past.length;
    expect(await duplicateLinkedStepAs(stepId, 'folded')).toBeNull();
    expect(stepsIn(state().diagram!)).toHaveLength(steps);
    expect(state().diagramHistory.past).toHaveLength(entries);
    expect(toasts.message).toHaveBeenCalledOnce();
    expect(toasts.message).toHaveBeenCalledWith(
      'The copy couldn’t be shown folded, because this step’s layer constraints need attention.'
    );
    expect(analytics.trackLayerConstraintsNeedAttention).not.toHaveBeenCalled();
    // The original as it was: its record unflagged.
    expect(stepLayerOrderOf(source(stepId).layerOrder)?.record.attention).toBeUndefined();
  });

  it('never captures a step whose record is a newer build’s: it is locked, and carried as it came', async () => {
    const stepId = await constrainedStep();
    const locked = { ...step(stepId), unknown: { raw: {} } } as unknown as ReturnType<typeof step>;
    useWorkspaceStore.setState({
      diagram: { ...state().diagram!, steps: state().diagram!.steps.map((entry) => (entry.id === stepId ? locked : entry)) },
    });
    expect(await refreshDiagramStep(stepId)).toBe(false);
    expect(hostEngine.resolveLayerOrder).not.toHaveBeenCalled();
    expect(stepsIn(state().diagram!).find((entry) => entry.id === stepId)).toBe(locked);
  });
});
