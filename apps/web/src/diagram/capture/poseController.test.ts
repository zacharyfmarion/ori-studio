import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import {
  foldedFigureHandleRefCount,
  resetFoldedFigureHandles,
  setFoldedFigureHandleFree,
} from '../../cp-workspace/folded/foldedFigureHandles';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cpDocument, fakeCaptureRuntime, twoSquaresSegmentation } from './capture.fixtures';
import type { CpCaptureRuntime } from './captureFolded';
import { createPoseController } from './poseController';

const bindings = vi.hoisted(() => ({ runtime: null as CpCaptureRuntime | null }));
vi.mock('../../store/workspaceStore/cpFoldRuntimeBindings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/workspaceStore/cpFoldRuntimeBindings')>()),
  createCpCaptureRuntime: () => bindings.runtime,
}));
vi.mock('../../cp-workspace/cpSegmentationArtifacts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cp-workspace/cpSegmentationArtifacts')>()),
  ensureCpSegmentationArtifacts: vi.fn(async () => segmentation),
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

const segmentation = twoSquaresSegmentation();
const [left] = resolveCpSegments(segmentation);
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

const listener = () => ({ spatial: vi.fn(), hasNextSolution: vi.fn() });
const render = (stepId: string) => state().diagram!.steps.find((step) => step.id === stepId)!.source;

beforeEach(async () => {
  vi.clearAllMocks();
  // The registry frees through the kernel; here there is none.
  setFoldedFigureHandleFree(() => {});
  await resetFoldedFigureHandles();
  useWorkspaceStore.setState(initialState, true);
  useWorkspaceStore.setState({
    oristudioCpDocument: { handle: 1, document, geometry: null } as unknown as OristudioCpDocumentState,
  });
  bindings.runtime = fakeCaptureRuntime();
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
