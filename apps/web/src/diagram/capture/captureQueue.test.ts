// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { sheetRegions } from '../../cp-workspace/sheets/cpSheetRegions';
import { createFakeLayerOrderBackend, FakeLayerOrderWorker } from '../../layer-order/engine/layerOrderEngine.fixtures';
import { registerWorkerFailureSink } from '../../lib/workerDiagnostics';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  cpDocument,
  fakeCaptureRuntime,
  stepLayerOrderJson,
  TWO_SQUARES,
  twoSquaresIndex,
  type FixtureLine,
} from './capture.fixtures';
import type { CpCaptureRuntime } from './captureFolded';
import { refreshAllDiagramSteps, stopRefreshAll } from './captureQueue';
import { setLinkedLayerOrder, type DiagramCpRender } from '../document/diagramDocument';
import { stepsIn } from '../document/diagramSteps.fixtures';

const bindings = vi.hoisted(() => ({ runtime: null as CpCaptureRuntime | null }));
vi.mock('../../store/workspaceStore/cpFoldRuntimeBindings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/workspaceStore/cpFoldRuntimeBindings')>()),
  createCpCaptureRuntime: () => bindings.runtime,
}));
vi.mock('../../cp-workspace/sheets/cpSheetIndex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cp-workspace/sheets/cpSheetIndex')>()),
  ensureCpSheetIndex: vi.fn(async () => sheets),
  peekCpSheetIndex: vi.fn(() => sheets),
}));
const dialogs = vi.hoisted(() => ({ requestConfirmation: vi.fn(async () => true) }));
vi.mock('../../store/commandDialogStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/commandDialogStore')>()),
  ...dialogs,
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));
const analytics = vi.hoisted(() => ({ trackDiagramPictureCaptured: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...analytics,
}));

const sheets = twoSquaresIndex();
const [left, right] = sheetRegions(sheets);
const initialState = useWorkspaceStore.getInitialState();
const state = () => useWorkspaceStore.getState();

const useDocument = (document = cpDocument()) =>
  useWorkspaceStore.setState({
    oristudioCpDocument: { handle: 1, document, geometry: null } as unknown as OristudioCpDocumentState,
  });

/** Both diagonals turned the other way: both squares' links go out of date. */
const edited = () =>
  cpDocument(
    TWO_SQUARES.map((line, i): FixtureLine =>
      i === 7 ? [...line.slice(0, 4), 'Blue2'] as FixtureLine : i === 8 ? [...line.slice(0, 4), 'Red1'] as FixtureLine : line
    )
  );

const FLAT: DiagramCpRender = { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 };

async function link(segment: typeof left, render: DiagramCpRender = { mode: 'crease-pattern', rotationDeg: 0 }) {
  const stepId = state().addDiagramStep()!;
  await state().captureDiagramStep(stepId, {
    scope: { kind: 'segment', region: regionReferenceFor(segment!) },
    render,
    kind: 'diagram-capture',
    label: 'Link pattern',
  });
  return stepId;
}

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(initialState, true);
  useLayoutStore.setState({ activeWorkspace: 'diagram' });
  useDocument();
  bindings.runtime = fakeCaptureRuntime();
});

describe('Refresh all out-of-date steps', () => {
  it('refreshes every step whose pattern changed, as one undo step', async () => {
    await link(left);
    await link(right);
    state().addDiagramStep();
    const before = state().diagramHistory.past.length;
    useDocument(edited());
    const fingerprints = () => stepsIn(state().diagram!).map((step) => (step.source?.kind === 'cp' ? step.source.fingerprint : null));
    const stale = fingerprints();
    expect(await refreshAllDiagramSteps()).toBe(2);
    const fresh = fingerprints();
    expect(fresh[0]).not.toBe(stale[0]);
    expect(fresh[1]).not.toBe(stale[1]);
    expect(state().diagramHistory.past).toHaveLength(before + 1);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Refresh out-of-date steps');
    expect(state().diagramRefreshAll).toBeNull();
    expect(toasts.success).toHaveBeenCalledWith('Refreshed 2 steps');
    // Counted step by step, as a refresh of one step is.
    expect(analytics.trackDiagramPictureCaptured).toHaveBeenCalledTimes(2);
    expect(analytics.trackDiagramPictureCaptured).toHaveBeenCalledWith('crease_pattern', 'ok', 'refresh_all');
    // One undo takes the whole run back.
    state().undoDiagram();
    expect(fingerprints()).toEqual(stale);
  });

  // Its Stop went through every capture in flight, so a Pose verb or a link
  // the user started meanwhile was cancelled with it, and said nothing.
  it('stops only its own capture, and the steps after it', async () => {
    await link(left);
    await link(right);
    useDocument(edited());
    let finish!: () => void;
    const capture = vi.fn(
      () =>
        new Promise<{ status: 'stopped' }>((resolve) => {
          finish = () => resolve({ status: 'stopped' });
        })
    );
    const stop = vi.fn();
    useWorkspaceStore.setState({ captureDiagramStep: capture, stopDiagramCapture: stop });
    const running = refreshAllDiagramSteps();
    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(1));
    const [refreshingId] = capture.mock.calls[0] as unknown as [string];
    // Another step's capture, the user's, is running too.
    useWorkspaceStore.setState({
      diagramCaptures: { [refreshingId]: { runId: 1 }, 'step-users': { runId: 2 } },
    });
    stopRefreshAll();
    expect(stop.mock.calls).toEqual([[refreshingId]]);
    finish();
    expect(await running).toBe(0);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('does nothing when nothing is out of date', async () => {
    await link(left);
    expect(await refreshAllDiagramSteps()).toBe(0);
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it('asks first when it would lose a redo branch, and keeps it when told no', async () => {
    await link(left);
    state().setDiagramTitle('Crane');
    state().undoDiagram();
    useDocument(edited());
    dialogs.requestConfirmation.mockResolvedValueOnce(false);
    expect(await refreshAllDiagramSteps()).toBe(0);
    expect(state().diagramHistory.future).toHaveLength(1);
  });

  it('waits while Edit is the active workspace', async () => {
    await link(left);
    useDocument(edited());
    useLayoutStore.setState({ activeWorkspace: 'edit' });
    let settled = false;
    const running = refreshAllDiagramSteps().then((count) => {
      settled = true;
      return count;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(settled).toBe(false);
    useLayoutStore.setState({ activeWorkspace: 'diagram' });
    expect(await running).toBe(1);
  });
});

describe('Refresh all, offline (layer order H7)', () => {
  /** The host engine's workers, each a worker whose script never arrives. */
  const spawned: OfflineWorker[] = [];

  class OfflineWorker extends FakeLayerOrderWorker {
    constructor() {
      super(createFakeLayerOrderBackend());
      spawned.push(this);
    }

    /** Nothing it is sent runs: it fails as a worker the browser never loaded. */
    override postMessage(): void {
      setTimeout(() => this.failToLoad(), 0);
    }
  }

  afterEach(() => {
    spawned.length = 0;
    registerWorkerFailureSink(null);
    vi.unstubAllGlobals();
  });

  it('spawns one host engine worker for five constrained steps, counts the rest, and refreshes the others', async () => {
    vi.stubGlobal('Worker', OfflineWorker);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sink = vi.fn();
    registerWorkerFailureSink(sink);
    for (let i = 0; i < 5; i += 1) {
      const stepId = await link(left, FLAT);
      useWorkspaceStore.setState({ diagram: setLinkedLayerOrder(state().diagram!, stepId, stepLayerOrderJson()) });
    }
    await link(right, FLAT);
    useDocument(edited());

    expect(await refreshAllDiagramSteps()).toBe(1);
    expect(spawned).toHaveLength(1);
    expect(toasts.error).toHaveBeenCalledOnce();
    // Only a reload retries a load that failed: Reload, the toast's one action.
    expect(toasts.error).toHaveBeenCalledWith(
      'Layer order couldn’t load, so 5 steps weren’t changed. Reload Ori Studio to try again.',
      { action: expect.objectContaining({ label: 'Reload' }) }
    );
    // The host engine's toast says it: not the app's "The worker stopped unexpectedly." as well.
    expect(sink).not.toHaveBeenCalled();
    // Nothing checked, so nothing saved as "couldn't be checked in time".
    const flagged = stepsIn(state().diagram!).filter(
      (step) => step.source?.kind === 'cp' && step.source.layerOrder?.includes('attention')
    );
    expect(flagged).toHaveLength(0);
  });
});
