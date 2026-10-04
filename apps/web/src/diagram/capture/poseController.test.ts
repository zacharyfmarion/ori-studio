import { act } from 'react';
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
import { sheetWithCrease } from '../../lib/paper/paperScene.fixtures';
import { cpDocument, fakeCaptureRuntime, movedLines, TWO_SQUARES, twoSquaresSegmentation } from './capture.fixtures';
import type { CpCaptureRuntime } from './captureFolded';
import { createPoseController, linkedFoldKey } from './poseController';
import { stepsIn } from '../document/diagramSteps.fixtures';

const bindings = vi.hoisted(() => ({ runtime: null as CpCaptureRuntime | null }));
vi.mock('../../store/workspaceStore/cpFoldRuntimeBindings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/workspaceStore/cpFoldRuntimeBindings')>()),
  createCpCaptureRuntime: () => bindings.runtime,
}));
/** The pattern's segmentation once it has moved; the fixture's until then. */
const pattern = vi.hoisted(() => ({ moved: null as unknown }));
vi.mock('../../cp-workspace/cpSegmentationArtifacts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cp-workspace/cpSegmentationArtifacts')>()),
  ensureCpSegmentationArtifacts: vi.fn(async () => pattern.moved ?? segmentation),
  peekCpSegmentationArtifacts: vi.fn(() => pattern.moved ?? segmentation),
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
const analytics = vi.hoisted(() => ({ trackDiagramPicturePosed: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...analytics,
}));

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

const listener = () => ({ spatial: vi.fn(), solutions: vi.fn(), preview: vi.fn() });
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
    const moved = twoSquaresSegmentation({ dx, dy });
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
    expect(after.scope.region).toEqual(regionReferenceFor(resolveCpSegments(moved)[0]!));
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

  /** A linked step shown flat with a spread, as a file would hold it, and no fold held yet. */
  function spreadInTheFile(stepId: string, spread: { amount: number; toward: 'up-left' | 'down' }) {
    useWorkspaceStore.setState({
      diagram: {
        ...state().diagram!,
        steps: stepsIn(state().diagram!).map((step) =>
          step.id === stepId && step.source?.kind === 'cp'
            ? {
                ...step,
                source: {
                  ...step.source,
                  render: { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1, spread },
                },
              }
            : step
        ),
      },
    });
  }

  it('turns it on from the nearest step before with one, and off, an undo step each, counted with how', async () => {
    const first = await linkedStep();
    const second = await linkedStep();
    expect(stepsIn(state().diagram!).map((step) => step.id)).toEqual([first, second]);
    const one = createPoseController(first, listener());
    await one.run({ verb: 'show-folded' });
    await one.run({ verb: 'spread-layers' });
    // No step before it has one: the default.
    expect(spreadOf(first)).toEqual({ amount: 0.05, toward: 'up-left' });
    await one.run({ verb: 'spread-direction', toward: 'down' });
    expect(spreadOf(first)).toEqual({ amount: 0.05, toward: 'down' });
    one.dispose();

    const two = createPoseController(second, listener());
    await two.run({ verb: 'show-folded' });
    const past = state().diagramHistory.past.length;
    await two.run({ verb: 'spread-layers' });
    expect(spreadOf(second)).toEqual({ amount: 0.05, toward: 'down' });
    await two.run({ verb: 'spread-layers' });
    expect(spreadOf(second)).toBeNull();
    expect(state().diagramHistory.past.length).toBe(past + 2);
    two.dispose();

    expect(analytics.trackDiagramPicturePosed.mock.calls.slice(-5)).toEqual([
      ['spread_on', 'flat', { direction: 'up_left', amount: 0.05 }],
      ['spread_direction', 'flat', { direction: 'down', amount: 0.05 }],
      ['show_folded', 'flat', undefined],
      ['spread_on', 'flat', { direction: 'down', amount: 0.05 }],
      ['spread_off', 'flat', undefined],
    ]);
  });

  it('previews a drag from the held fold with no call to the kernel, then commits it as one undo step', async () => {
    const stepId = await linkedStep();
    const heard = listener();
    const controller = createPoseController(stepId, heard);
    await controller.run({ verb: 'show-folded' });
    await controller.run({ verb: 'spread-layers' });
    const reads = vi.mocked(bindings.runtime!.paperScene).mock.calls.length;
    const past = state().diagramHistory.past.length;
    const posed = analytics.trackDiagramPicturePosed.mock.calls.length;
    const source = render(stepId)!;
    if (source.kind !== 'cp') throw new Error('linked');

    for (const amount of [0.1, 0.12, 0.15]) controller.previewSpread(amount);
    expect(heard.preview).toHaveBeenCalledTimes(3);
    expect(heard.preview).toHaveBeenLastCalledWith(
      { spread: { amount: 0.15, toward: 'up-left' }, picture: expect.objectContaining({ kind: 'scene' }) },
      linkedFoldKey(stepId, source)
    );
    // Previewed, not committed, and drawn from what the session read.
    expect(state().diagramHistory.past.length).toBe(past);
    expect(bindings.runtime!.paperScene).toHaveBeenCalledTimes(reads);

    await controller.commitSpread();
    expect(spreadOf(stepId)).toEqual({ amount: 0.15, toward: 'up-left' });
    expect(state().diagramHistory.past.length).toBe(past + 1);
    expect(bindings.runtime!.paperScene).toHaveBeenCalledTimes(reads);
    expect(heard.preview).toHaveBeenLastCalledWith(null, null);
    // One drag, one event.
    expect(analytics.trackDiagramPicturePosed.mock.calls.slice(posed)).toEqual([
      ['spread_amount', 'flat', { direction: 'up_left', amount: 0.15 }],
    ]);
    controller.dispose();
  });

  it('folds for a preview when it holds nothing yet, and commits after that fold rather than refused as busy', async () => {
    const stepId = await linkedStep();
    spreadInTheFile(stepId, { amount: 0.05, toward: 'down' });
    const heard = listener();
    const controller = createPoseController(stepId, heard);
    controller.previewSpread(0.08);
    // Nothing held: the spread now, the picture once the fold is.
    expect(heard.preview).toHaveBeenNthCalledWith(1, { spread: { amount: 0.08, toward: 'down' }, picture: null }, expect.any(String));
    const committing = controller.commitSpread();
    await committing;
    expect(heard.preview).toHaveBeenCalledWith(
      { spread: { amount: 0.08, toward: 'down' }, picture: expect.objectContaining({ kind: 'scene' }) },
      expect.any(String)
    );
    expect(spreadOf(stepId)).toEqual({ amount: 0.08, toward: 'down' });
    expect(bindings.runtime!.fold).toHaveBeenCalledOnce();
    expect(heard.preview).toHaveBeenLastCalledWith(null, null);
    controller.dispose();
  });

  it('commits the newest amount when commits race, as one undo step', async () => {
    const stepId = await linkedStep();
    const controller = createPoseController(stepId, listener());
    await controller.run({ verb: 'show-folded' });
    await controller.run({ verb: 'spread-layers' });
    const past = state().diagramHistory.past.length;
    const commits = [0.1, 0.12, 0.14].map((amount) => {
      controller.previewSpread(amount);
      return controller.commitSpread();
    });
    await Promise.all(commits);
    expect(spreadOf(stepId)).toEqual({ amount: 0.14, toward: 'up-left' });
    expect(state().diagramHistory.past.length).toBe(past + 1);
    controller.dispose();
  });

  it('ends a preview when an undo comes, and keeps its spread through Reset Pose', async () => {
    const stepId = await linkedStep();
    const heard = listener();
    const controller = createPoseController(stepId, heard);
    await controller.run({ verb: 'show-folded' });
    await controller.run({ verb: 'turn-over' });
    await controller.run({ verb: 'spread-layers' });
    controller.previewSpread(0.1);
    controller.historyMoved();
    expect(heard.preview).toHaveBeenLastCalledWith(null, null);
    await controller.run({ verb: 'reset' });
    expect(render(stepId)).toMatchObject({
      render: { side: 'front', rotationDeg: 0, foldCase: 1, spread: { amount: 0.05, toward: 'up-left' } },
    });
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

  it('commits nothing for an amount an undo took back while it waited for a fold', async () => {
    const stepId = await linkedStep();
    spreadInTheFile(stepId, { amount: 0.1, toward: 'down' });
    const controller = createPoseController(stepId, listener());
    const open = holdTheFold();
    const past = state().diagramHistory.past.length;
    controller.previewSpread(0.15);
    const committing = controller.commitSpread();
    // The commit is waiting for the fold the preview asked for.
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.historyMoved();
    open();
    await committing;
    expect(spreadOf(stepId)).toEqual({ amount: 0.1, toward: 'down' });
    expect(state().diagramHistory.past.length).toBe(past);
    controller.dispose();
  });

  it('neither folds nor commits again once its detail closed, and keeps no fold', async () => {
    const stepId = await linkedStep();
    spreadInTheFile(stepId, { amount: 0.1, toward: 'down' });
    const controller = createPoseController(stepId, listener());
    const open = holdTheFold();
    const past = state().diagramHistory.past.length;
    controller.previewSpread(0.15);
    const committing = controller.commitSpread();
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.dispose();
    open();
    await committing;
    expect(spreadOf(stepId)).toEqual({ amount: 0.1, toward: 'down' });
    expect(state().diagramHistory.past.length).toBe(past);
    expect(bindings.runtime!.fold).toHaveBeenCalledOnce();
    expect(foldedFigureHandleRefCount(7)).toBe(0);
  });

  it('waits for the verb it is folding, not a preview refused as busy, and then commits', async () => {
    const stepId = await linkedStep();
    spreadInTheFile(stepId, { amount: 0.1, toward: 'down' });
    const controller = createPoseController(stepId, listener());
    const open = holdTheFold();
    const turning = controller.run({ verb: 'rotate-right' });
    // Nothing is held, so the preview asks to fold — and is refused: the turn is folding.
    controller.previewSpread(0.15);
    const committing = controller.commitSpread();
    open();
    await Promise.all([turning, committing]);
    expect(render(stepId)).toMatchObject({ render: { rotationDeg: 15, spread: { amount: 0.15, toward: 'down' } } });
    expect(toasts.message).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('takes its preview back when its detail closes', async () => {
    const stepId = await linkedStep();
    const heard = listener();
    const controller = createPoseController(stepId, heard);
    await controller.run({ verb: 'show-folded' });
    await controller.run({ verb: 'spread-layers' });
    controller.previewSpread(0.1);
    expect(heard.preview).toHaveBeenLastCalledWith(expect.objectContaining({ spread: { amount: 0.1, toward: 'up-left' } }), expect.any(String));
    controller.dispose();
    expect(heard.preview).toHaveBeenLastCalledWith(null, null);
  });

  it('ends a preview when another verb lands, and previews in the direction the step has now', async () => {
    const stepId = await linkedStep();
    const heard = listener();
    const controller = createPoseController(stepId, heard);
    await controller.run({ verb: 'show-folded' });
    await controller.run({ verb: 'spread-layers' });
    // A drag back to where it began commits nothing; the preview stays up.
    controller.previewSpread(0.05);
    await controller.run({ verb: 'spread-direction', toward: 'down' });
    expect(heard.preview).toHaveBeenLastCalledWith(null, null);
    controller.previewSpread(0.12);
    expect(heard.preview).toHaveBeenLastCalledWith(expect.objectContaining({ spread: { amount: 0.12, toward: 'down' } }), expect.any(String));
    // Its spread turned off: nothing left to preview.
    await controller.run({ verb: 'spread-layers' });
    controller.previewSpread(0.14);
    expect(heard.preview).toHaveBeenLastCalledWith(null, null);
    controller.dispose();
  });
});
