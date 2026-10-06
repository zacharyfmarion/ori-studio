import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { SimulatorPullStart } from './pickQuery';
import { EMPTY_PIN_SET, type PinSet } from './tools/pinSet';
import type { SimulatorHandChange, SimulatorToolSnapshot, SimulatorToolState } from './tools/toolState';
import type { SimulatorGesture } from './tools/types';
import type { SimulatorFrameView, SimulatorModelView, SimulatorPinOutcome } from './useSimulatorRuntime';
import {
  useSimulatorToolBinding,
  useSimulatorTools,
  type SimulatorTools,
  type SimulatorToolsRuntime,
  type UseSimulatorToolBindingOptions,
} from './useSimulatorTools';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tracked: { event: string; properties?: Record<string, unknown> }[] = [];
vi.mock('../analytics/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../analytics/runtime')>();
  return {
    ...actual,
    track: (event: string, properties?: Record<string, unknown>) => {
      tracked.push(properties ? { event, properties } : { event });
    },
  };
});

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));
vi.mock('../monitoring', () => ({ reportError: () => undefined }));

const SURFACE = { width: 400, height: 300 };
const BOX: SimulatorGesture = {
  kind: 'box',
  rect: { left: 0, top: 0, right: 100, bottom: 100 },
  shift: false,
  touch: false,
};
const CLICK: SimulatorGesture = { kind: 'click', point: { x: 5, y: 5 }, shift: false, touch: false };
const SHIFT_CLICK: SimulatorGesture = { ...CLICK, shift: true };

/** What a Diagram step would scope its pins by. */
interface StepScope {
  stepId: string;
}

function model(): SimulatorModelView {
  return { faceGroups: Int32Array.from({ length: 10 }, (_, face) => face) } as SimulatorModelView;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeRuntime(extra: Partial<SimulatorToolsRuntime> = {}): SimulatorToolsRuntime {
  return {
    model: model(),
    gpuActive: true,
    pickFaces: vi.fn(async () => [] as number[]),
    setPinnedFaces: vi.fn(async (): Promise<SimulatorPinOutcome | null> => ({ applied: 1, dropped: 0 })),
    beginPull: vi.fn(async (): Promise<SimulatorPullStart | null> => 'pulling'),
    movePull: vi.fn(),
    endPull: vi.fn(async () => ({ movedCreases: 4 })),
    releasePose: vi.fn(async (): Promise<boolean | null> => true),
    ...extra,
  };
}

/**
 * A host's tool state that is not Simulate's: its own tool in hand and its own
 * pins, per step. Counts what the binding asks of it.
 */
function fakeToolState(initialTool: SimulatorToolSnapshot['activeToolId'] = 'pin') {
  let snapshot: SimulatorToolSnapshot = { activeToolId: initialTool, options: { pinThroughLayers: true } };
  const pins = new Map<string, PinSet>();
  const listeners = new Set<() => void>();
  const writes: { scope: string; faces: PinSet }[] = [];
  let subscriptions = 0;
  const emit = () => listeners.forEach((listener) => listener());
  const port: SimulatorToolState<StepScope> = {
    subscribe(listener) {
      subscriptions += 1;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    getPins: (scope) => pins.get(scope.stepId) ?? EMPTY_PIN_SET,
    setPins(scope, faces) {
      writes.push({ scope: scope.stepId, faces });
      pins.set(scope.stepId, faces);
      emit();
    },
    setActiveTool(id) {
      snapshot = { ...snapshot, activeToolId: id };
      emit();
    },
    setOption(id, value) {
      snapshot = { ...snapshot, options: { ...snapshot.options, [id]: value } };
      emit();
    },
  };
  return {
    port,
    writes,
    seed: (stepId: string, faces: PinSet) => pins.set(stepId, faces),
    pinsOf: (stepId: string) => pins.get(stepId) ?? EMPTY_PIN_SET,
    subscriptions: () => subscriptions,
    listening: () => listeners.size,
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let latest: SimulatorTools | null = null;
/** Renders the probe committed: one effect run each, so a render React bails out of is not one. */
const commits = { probe: 0 };

function Probe(props: UseSimulatorToolBindingOptions<StepScope>) {
  const tools = useSimulatorToolBinding(props);
  useEffect(() => {
    latest = tools;
    commits.probe += 1;
  });
  return null;
}

let hand: SimulatorHandChange[] = [];

function options(
  state: SimulatorToolState<StepScope>,
  extra: Partial<UseSimulatorToolBindingOptions<StepScope>> = {}
): UseSimulatorToolBindingOptions<StepScope> {
  return {
    runtime: fakeRuntime(),
    ready: true,
    pickDrawn: vi.fn(() => null),
    drawnCamera: vi.fn(() => null),
    cancelGesture: vi.fn(() => false),
    state,
    scope: { stepId: 'a' },
    onHandChange: (change) => hand.push(change),
    ...extra,
  };
}

function render(props: UseSimulatorToolBindingOptions<StepScope>) {
  act(() => root?.render(<Probe {...props} />));
}

function tools(): SimulatorTools {
  if (!latest) throw new Error('the hook has not rendered');
  return latest;
}

async function settle() {
  for (let round = 0; round < 5; round += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** A frame that changes nothing the tools show. */
function quietFrame(extra: Partial<SimulatorFrameView> = {}): SimulatorFrameView {
  return {
    positions: null,
    bitmap: null,
    step: 1,
    stepsThisTick: 1,
    elapsedMs: 1,
    converged: true,
    foldPercent: 40,
    maxStrain: 0.01,
    recovered: null,
    posed: false,
    poseEnded: null,
    framingHeld: false,
    ...extra,
  };
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  commits.probe = 0;
  hand = [];
  useWorkspaceStore.setState({
    simulatorActiveToolId: 'orbit',
    simulatorPins: { revision: null, bySource: {} },
    simulatorToolOptions: { pinThroughLayers: true },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  latest = null;
  toastError.mockReset();
  tracked.length = 0;
});

describe('useSimulatorToolBinding, through a host’s own port', () => {
  it('keeps its tool and pins in the port, and leaves Simulate’s slice alone', async () => {
    const state = fakeToolState('orbit');
    const runtime = fakeRuntime({ pickFaces: vi.fn(async () => [7, 2]) });
    render(options(state.port, { runtime }));

    act(() => tools().verbs.selectTool('pin', 'rail'));
    expect(tools().tool.id).toBe('pin');
    act(() => tools().runGesture(BOX, SURFACE));
    await settle();
    act(() => tools().verbs.setOption('pinThroughLayers', false, 'tool-window'));

    expect(state.pinsOf('a')).toEqual([2, 7]);
    expect(runtime.setPinnedFaces).toHaveBeenLastCalledWith([2, 7], runtime.model);
    expect(tools().view.options.pinThroughLayers).toBe(false);
    const store = useWorkspaceStore.getState();
    expect(store.simulatorActiveToolId).toBe('orbit');
    expect(store.simulatorPins).toEqual({ revision: null, bySource: {} });
    expect(store.simulatorToolOptions.pinThroughLayers).toBe(true);
  });

  it('applies two quick picks in the order they were made, however slowly each is answered', async () => {
    const state = fakeToolState();
    const slow = deferred<number[] | null>();
    const pickFaces = vi
      .fn<SimulatorToolsRuntime['pickFaces']>()
      .mockImplementationOnce(() => slow.promise)
      .mockImplementationOnce(async () => [5]);
    render(options(state.port, { runtime: fakeRuntime({ pickFaces }) }));

    // Click pins face 5 alone; Shift-click then toggles it off again.
    act(() => tools().runGesture(CLICK, SURFACE));
    act(() => tools().runGesture(SHIFT_CLICK, SURFACE));
    slow.resolve([5]);
    await settle();

    expect(state.writes).toEqual([
      { scope: 'a', faces: [5] },
      { scope: 'a', faces: [] },
    ]);
    expect(tools().pinned).toEqual([]);
  });

  it('rolls a rejected set back to what the worker holds, and reports no hand change for it', async () => {
    const state = fakeToolState();
    const setPinnedFaces = vi
      .fn<SimulatorToolsRuntime['setPinnedFaces']>()
      .mockResolvedValueOnce({ applied: 1, dropped: 0 })
      .mockRejectedValueOnce(new Error('texture upload failed'));
    const pickFaces = vi
      .fn<SimulatorToolsRuntime['pickFaces']>()
      .mockResolvedValueOnce([1])
      .mockResolvedValueOnce([2]);
    render(options(state.port, { runtime: fakeRuntime({ pickFaces, setPinnedFaces }) }));

    act(() => tools().runGesture(CLICK, SURFACE));
    await settle();
    act(() => tools().runGesture(SHIFT_CLICK, SURFACE));
    await settle();

    expect(setPinnedFaces).toHaveBeenNthCalledWith(2, [1, 2], expect.anything());
    expect(state.pinsOf('a')).toEqual([1]);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(hand).toEqual([{ kind: 'pins', faces: [1] }]);
    // Back in step with the worker, so nothing is sent again.
    expect(setPinnedFaces).toHaveBeenCalledTimes(2);
  });

  it('keeps a new scope’s pins off the model still on screen until that scope’s own lands', async () => {
    const state = fakeToolState();
    state.seed('a', [1]);
    state.seed('b', [8]);
    const runtime = fakeRuntime({ pickFaces: vi.fn(async () => [3]) });
    render(options(state.port, { runtime, scope: { stepId: 'a' } }));
    await settle();
    expect(runtime.setPinnedFaces).toHaveBeenLastCalledWith([1], runtime.model);

    // The scope changes at once; its model lands later.
    render(options(state.port, { runtime, scope: { stepId: 'b' } }));
    await settle();
    expect(runtime.setPinnedFaces).not.toHaveBeenCalledWith([8], runtime.model);
    expect(tools().pinned).toEqual([1]);

    // A pick made on the picture still on screen lands in that picture's scope.
    act(() => tools().runGesture({ ...CLICK, shift: true }, SURFACE));
    await settle();
    expect(state.pinsOf('a')).toEqual([1, 3]);
    expect(state.pinsOf('b')).toEqual([8]);

    const loaded = { ...runtime, model: model() };
    render(options(state.port, { runtime: loaded, scope: { stepId: 'b' } }));
    await settle();
    expect(runtime.setPinnedFaces).toHaveBeenLastCalledWith([8], loaded.model);
    expect(tools().pinned).toEqual([8]);
  });

  it('reports a hand change only once the worker has answered', async () => {
    const state = fakeToolState();
    const applied = deferred<SimulatorPinOutcome | null>();
    const runtime = fakeRuntime({
      pickFaces: vi.fn(async () => [7, 2]),
      setPinnedFaces: vi.fn(() => applied.promise),
    });
    render(options(state.port, { runtime }));

    act(() => tools().runGesture(BOX, SURFACE));
    await settle();
    // The port has the set, and the tint shows it; the paper does not yet.
    expect(state.pinsOf('a')).toEqual([2, 7]);
    expect(hand).toEqual([]);

    applied.resolve({ applied: 2, dropped: 0 });
    await settle();
    expect(hand).toEqual([{ kind: 'pins', faces: [2, 7] }]);
  });

  it('reports nothing for a pick with no frame to answer from, or a model that went', async () => {
    const state = fakeToolState();
    const runtime = fakeRuntime({ pickFaces: vi.fn(async () => null), setPinnedFaces: vi.fn(async () => null) });
    render(options(state.port, { runtime }));

    act(() => tools().runGesture(BOX, SURFACE));
    await settle();
    state.port.setPins({ stepId: 'a' }, [4]);
    await settle();

    expect(runtime.setPinnedFaces).toHaveBeenCalledWith([4], runtime.model);
    expect(hand).toEqual([]);
  });

  it('reports a kept pull after the worker lets go, and not an abandoned one', async () => {
    const state = fakeToolState('pull');
    state.seed('a', [3]);
    const ended = deferred<{ movedCreases: number } | null>();
    const endPull = vi
      .fn<SimulatorToolsRuntime['endPull']>()
      .mockImplementationOnce(async () => ({ movedCreases: 0 }))
      .mockImplementationOnce(() => ended.promise);
    render(options(state.port, { runtime: fakeRuntime({ endPull }) }));
    await settle();
    hand = [];
    const step = (phase: 'begin' | 'end' | 'cancel'): SimulatorGesture => ({
      kind: 'pull',
      phase,
      point: { x: 10, y: 20 },
      touch: false,
    });

    act(() => tools().runGesture(step('begin'), SURFACE));
    act(() => tools().runGesture(step('cancel'), SURFACE));
    await settle();
    expect(hand).toEqual([]);

    act(() => tools().runGesture(step('begin'), SURFACE));
    act(() => tools().runGesture(step('end'), SURFACE));
    await settle();
    expect(hand).toEqual([]);
    ended.resolve({ movedCreases: 6 });
    await settle();
    expect(hand).toEqual([{ kind: 'pull-kept' }]);
  });

  it('reports a Spring back once it is done, and a pose the fold or a reset took back', async () => {
    const state = fakeToolState('orbit');
    const released = deferred<boolean | null>();
    const runtime = fakeRuntime({ releasePose: vi.fn(() => released.promise) });
    render(options(state.port, { runtime }));

    act(() => tools().observeFrame(quietFrame({ posed: true })));
    act(() => tools().verbs.springBack('tool-window'));
    await settle();
    expect(hand).toEqual([]);
    released.resolve(true);
    await settle();
    expect(hand).toEqual([{ kind: 'spring-back' }]);

    // The frame after a Spring back says `request`: reported already, when asked.
    act(() => tools().observeFrame(quietFrame({ posed: false, poseEnded: 'request' })));
    act(() => tools().observeFrame(quietFrame({ posed: true })));
    act(() => tools().observeFrame(quietFrame({ posed: false, poseEnded: 'fold' })));
    act(() => tools().observeFrame(quietFrame({ posed: true })));
    act(() => tools().observeFrame(quietFrame({ posed: false, poseEnded: 'reset' })));
    expect(hand).toEqual([
      { kind: 'spring-back' },
      { kind: 'pose-ended', why: 'fold' },
      { kind: 'pose-ended', why: 'reset' },
    ]);
  });

  it('reports nothing for a Spring back the session no longer had', async () => {
    const state = fakeToolState('orbit');
    const runtime = fakeRuntime({ releasePose: vi.fn(async () => null) });
    render(options(state.port, { runtime }));

    act(() => tools().observeFrame(quietFrame({ posed: true })));
    act(() => tools().verbs.springBack('context-menu'));
    await settle();

    expect(runtime.releasePose).toHaveBeenCalledTimes(1);
    expect(hand).toEqual([]);
  });
});

describe('useSimulatorToolBinding renders', () => {
  it('subscribes once, however often it renders', async () => {
    const state = fakeToolState();
    const props = options(state.port);
    render(props);
    render({ ...props, scope: { stepId: 'a' } });
    render({ ...props, ready: false });
    await settle();

    // One subscription each for the tool and the pins, kept across renders.
    expect(state.subscriptions()).toBe(2);
    expect(state.listening()).toBe(2);
    act(() => root?.unmount());
    expect(state.listening()).toBe(0);
  });

  it('does not re-render its consumer for a frame that changes nothing it shows', async () => {
    const state = fakeToolState();
    state.seed('a', [2]);
    render(options(state.port));
    await settle();
    // A frame that raises a notice is news, so the run starts after one.
    act(() => tools().observeFrame(quietFrame({ maxStrain: 0.2 })));
    const before = commits.probe;

    act(() => {
      for (let tick = 0; tick < 120; tick += 1) {
        tools().observeFrame(quietFrame({ step: tick, foldPercent: 40, maxStrain: 0.2 }));
      }
    });

    expect(commits.probe).toBe(before);
    expect(tools().view.notices).toEqual(['strained']);
  });

  it('does not re-render Simulate’s consumer for frames, or for a store change that is not the tools’', async () => {
    const simulateCommits = { count: 0 };
    let simulate: SimulatorTools | null = null;
    function SimulateProbe() {
      const bound = useSimulatorTools({
        runtime: fakeRuntimeOnce,
        ready: true,
        revision: 1,
        sourceKey: 'whole:1:all',
        pickDrawn: () => null,
        drawnCamera: () => null,
        cancelGesture: () => false,
      });
      useEffect(() => {
        simulate = bound;
        simulateCommits.count += 1;
      });
      return null;
    }
    const fakeRuntimeOnce = fakeRuntime();
    act(() => root?.render(<SimulateProbe />));
    await settle();
    const before = simulateCommits.count;

    act(() => {
      for (let tick = 0; tick < 60; tick += 1) simulate!.observeFrame(quietFrame({ step: tick }));
    });
    act(() => useWorkspaceStore.setState({ selectedSegmentId: 2 }));
    act(() => useWorkspaceStore.getState().setSimulatorPins(1, 'whole:1:other', [4]));

    expect(simulateCommits.count).toBe(before);
    act(() => useWorkspaceStore.getState().setSimulatorActiveTool('pin'));
    expect(simulateCommits.count).toBe(before + 1);
    expect(simulate!.tool.id).toBe('pin');
  });
});
