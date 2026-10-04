import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../store/workspaceStore';
import { simulatorPinsFor } from '../store/workspaceStore/slices/simulatorSlice';
import type { SimulatorGesture } from './tools/types';
import type { SimulatorModelView, SimulatorPinOutcome } from './useSimulatorRuntime';
import {
  classifySimulatorCallFailure,
  nextPinNotices,
  PIN_STRAIN_NOTICE_THRESHOLD,
  useSimulatorTools,
  type SimulatorTools,
  type SimulatorToolsRuntime,
  type UseSimulatorToolsOptions,
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
const reported: { error: unknown; context: unknown }[] = [];
vi.mock('../monitoring', () => ({
  reportError: (error: unknown, context: unknown) => reported.push({ error, context }),
}));

const SURFACE = { width: 400, height: 300 };
const BOX: SimulatorGesture = {
  kind: 'box',
  rect: { left: 0, top: 0, right: 100, bottom: 100 },
  shift: false,
  touch: false,
};
const CLICK: SimulatorGesture = { kind: 'click', point: { x: 5, y: 5 }, shift: false, touch: false };
const SHIFT_CLICK: SimulatorGesture = { ...CLICK, shift: true };

/** A model with ten triangles, each its own crease-pattern face. */
function model(): SimulatorModelView {
  return { faceGroups: Int32Array.from({ length: 10 }, (_, face) => face) } as SimulatorModelView;
}

/** A promise and the means to settle it, for answers that should arrive late. */
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
    ...extra,
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let latest: SimulatorTools | null = null;

function Probe(props: UseSimulatorToolsOptions) {
  const tools = useSimulatorTools(props);
  useEffect(() => {
    latest = tools;
  });
  return null;
}

function options(extra: Partial<UseSimulatorToolsOptions> = {}): UseSimulatorToolsOptions {
  return {
    runtime: fakeRuntime(),
    ready: true,
    revision: 1,
    sourceKey: 'whole:1:all',
    pickDrawn: vi.fn(() => null),
    cancelGesture: vi.fn(() => false),
    ...extra,
  };
}

function render(props: UseSimulatorToolsOptions) {
  act(() => root?.render(<Probe {...props} />));
}

function tools(): SimulatorTools {
  if (!latest) throw new Error('the hook has not rendered');
  return latest;
}

/** Let queued picks and pushes run, and React take what they set. */
async function settle() {
  for (let round = 0; round < 5; round += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function storedPins(revision = 1, sourceKey = 'whole:1:all') {
  return simulatorPinsFor(useWorkspaceStore.getState().simulatorPins, revision, sourceKey);
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  useWorkspaceStore.setState({
    simulatorActiveToolId: 'pin',
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
  reported.length = 0;
  tracked.length = 0;
});

describe('useSimulatorTools', () => {
  it('pins what a box picks on the GPU path, and sends it to the model on screen', async () => {
    const runtime = fakeRuntime({ pickFaces: vi.fn(async () => [7, 2]) });
    render(options({ runtime }));

    act(() => tools().runGesture(BOX, SURFACE));
    await settle();

    expect(runtime.pickFaces).toHaveBeenCalledWith({
      region: { kind: 'box', left: 0, top: 0, right: 100, bottom: 100 },
      cssWidth: 400,
      cssHeight: 300,
      depth: 'all-layers',
    });
    expect(storedPins()).toEqual([2, 7]);
    expect(runtime.setPinnedFaces).toHaveBeenLastCalledWith([2, 7], runtime.model);
    expect(tools().pinned).toEqual([2, 7]);
    expect(tools().view.pinnedCount).toBe(2);
    // The canvas-2D tint: the triangles of the pinned faces.
    expect([...tools().highlights.pinned]).toEqual([2, 7]);
  });

  it('picks from the drawn frame on the canvas-2D path', async () => {
    const runtime = fakeRuntime({ gpuActive: false });
    const pickDrawn = vi.fn(() => [4]);
    render(options({ runtime, pickDrawn }));

    act(() => tools().runGesture(CLICK, SURFACE));
    await settle();

    expect(pickDrawn).toHaveBeenCalledTimes(1);
    expect(runtime.pickFaces).not.toHaveBeenCalled();
    expect(storedPins()).toEqual([4]);
  });

  it('reaches only what shows when the layers option is off', async () => {
    useWorkspaceStore.setState({ simulatorToolOptions: { pinThroughLayers: false } });
    const runtime = fakeRuntime({ pickFaces: vi.fn(async () => [1]) });
    render(options({ runtime }));

    act(() => tools().runGesture(BOX, SURFACE));
    await settle();

    expect(vi.mocked(runtime.pickFaces).mock.calls[0]?.[0].depth).toBe('visible');
  });

  it('changes nothing when a pick has no frame to answer from', async () => {
    const runtime = fakeRuntime({ pickFaces: vi.fn(async () => null) });
    render(options({ runtime }));

    act(() => tools().runGesture(BOX, SURFACE));
    await settle();

    expect(storedPins()).toEqual([]);
    expect(runtime.setPinnedFaces).not.toHaveBeenCalled();
  });

  it('empties the pins when a plain click finds nothing, as Box Select does', async () => {
    useWorkspaceStore.getState().setSimulatorPins(1, 'whole:1:all', [3]);
    const runtime = fakeRuntime({ pickFaces: vi.fn(async () => []) });
    render(options({ runtime }));
    await settle();

    act(() => tools().runGesture(CLICK, SURFACE));
    await settle();

    expect(storedPins()).toEqual([]);
  });

  it('drops a pick answered after the model was replaced', async () => {
    const answer = deferred<number[] | null>();
    const first = fakeRuntime({ pickFaces: vi.fn(() => answer.promise) });
    render(options({ runtime: first }));

    act(() => tools().runGesture(BOX, SURFACE));
    // A reload lands while the worker is still answering.
    render(options({ runtime: { ...first, model: model() } }));
    answer.resolve([9]);
    await settle();

    expect(storedPins()).toEqual([]);
  });

  it('applies picks in the order they were made, however slowly each is answered', async () => {
    const slow = deferred<number[] | null>();
    const pickFaces = vi
      .fn<SimulatorToolsRuntime['pickFaces']>()
      .mockImplementationOnce(() => slow.promise)
      .mockImplementationOnce(async () => [5]);
    render(options({ runtime: fakeRuntime({ pickFaces }) }));

    // Click pins face 5 alone; Shift-click then toggles it off again.
    act(() => tools().runGesture(CLICK, SURFACE));
    act(() => tools().runGesture(SHIFT_CLICK, SURFACE));
    slow.resolve([5]);
    await settle();

    expect(pickFaces).toHaveBeenCalledTimes(2);
    expect(storedPins()).toEqual([]);
  });

  it('rolls back to what the worker holds when it rejects a set, and says so once', async () => {
    const setPinnedFaces = vi
      .fn<SimulatorToolsRuntime['setPinnedFaces']>()
      .mockResolvedValueOnce({ applied: 1, dropped: 0 })
      .mockRejectedValueOnce(new Error('texture upload failed'));
    const pickFaces = vi
      .fn<SimulatorToolsRuntime['pickFaces']>()
      .mockResolvedValueOnce([1])
      .mockResolvedValueOnce([2]);
    render(options({ runtime: fakeRuntime({ pickFaces, setPinnedFaces }) }));

    act(() => tools().runGesture(CLICK, SURFACE));
    await settle();
    expect(storedPins()).toEqual([1]);

    act(() => tools().runGesture(SHIFT_CLICK, SURFACE));
    await settle();

    expect(setPinnedFaces).toHaveBeenNthCalledWith(2, [1, 2], expect.anything());
    expect(storedPins()).toEqual([1]);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(reported).toEqual([
      {
        error: expect.any(Error),
        context: { surface: 'simulator:pins', tags: { backend: 'gpu' } },
      },
    ]);
    // Back in step with the worker, so nothing is sent again.
    expect(setPinnedFaces).toHaveBeenCalledTimes(2);
  });

  it('reports ids the model does not have once per model, and keeps the rest', async () => {
    const setPinnedFaces = vi.fn(async () => ({ applied: 1, dropped: 1 }));
    const runtime = fakeRuntime({ setPinnedFaces, pickFaces: vi.fn(async () => [1]) });
    render(options({ runtime }));

    act(() => tools().runGesture(BOX, SURFACE));
    await settle();
    act(() => tools().runGesture({ ...BOX, shift: true }, SURFACE));
    vi.mocked(runtime.pickFaces).mockResolvedValueOnce([2]);
    act(() => tools().runGesture({ ...BOX, shift: true }, SURFACE));
    await settle();

    expect(reported).toEqual([
      {
        error: expect.any(Error),
        context: {
          surface: 'simulator:pins',
          handled: true,
          tags: { backend: 'gpu', reason: 'unknown_face' },
        },
      },
    ]);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('leaves a lost worker to the app’s own report', async () => {
    const pickFaces = vi.fn(async () => {
      throw { code: 'worker_simulator', message: 'gone' };
    });
    render(options({ runtime: fakeRuntime({ pickFaces }) }));

    act(() => tools().runGesture(BOX, SURFACE));
    await settle();

    expect(toastError).not.toHaveBeenCalled();
    expect(reported).toEqual([]);
  });

  it('toasts and reports a pick that fails for any other reason', async () => {
    const pickFaces = vi.fn(async () => {
      throw new Error('readPixels failed');
    });
    render(options({ runtime: fakeRuntime({ pickFaces }) }));

    act(() => tools().runGesture(BOX, SURFACE));
    await settle();

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(reported[0]?.context).toEqual({ surface: 'simulator:pick', tags: { backend: 'gpu' } });
  });

  it('sends a reloaded model its source’s pins', async () => {
    useWorkspaceStore.getState().setSimulatorPins(1, 'whole:1:all', [3, 4]);
    const runtime = fakeRuntime();
    render(options({ runtime }));
    await settle();
    expect(runtime.setPinnedFaces).toHaveBeenLastCalledWith([3, 4], runtime.model);

    const reloaded = { ...runtime, model: model() };
    render(options({ runtime: reloaded }));
    await settle();

    expect(runtime.setPinnedFaces).toHaveBeenLastCalledWith([3, 4], reloaded.model);
  });

  it('sends a fresh model nothing when its source has no pins', async () => {
    const runtime = fakeRuntime();
    render(options({ runtime }));
    await settle();

    expect(runtime.setPinnedFaces).not.toHaveBeenCalled();
  });

  it('keeps a segment’s pins off the model still on screen until that segment’s own loads', async () => {
    const store = useWorkspaceStore.getState();
    store.setSimulatorPins(1, 'whole:1:a', [1]);
    store.setSimulatorPins(1, 'whole:1:b', [8]);
    const runtime = fakeRuntime();
    render(options({ runtime, sourceKey: 'whole:1:a' }));
    await settle();

    // The segment changes at once; its model lands later.
    render(options({ runtime, sourceKey: 'whole:1:b' }));
    await settle();
    expect(runtime.setPinnedFaces).not.toHaveBeenCalledWith([8], runtime.model);
    expect(tools().pinned).toEqual([1]);

    const loaded = { ...runtime, model: model() };
    render(options({ runtime: loaded, sourceKey: 'whole:1:b' }));
    await settle();
    expect(runtime.setPinnedFaces).toHaveBeenLastCalledWith([8], loaded.model);
    expect(tools().pinned).toEqual([8]);
  });

  it('forgets every source’s pins when the fold revision moves on', async () => {
    useWorkspaceStore.getState().setSimulatorPins(1, 'whole:1:all', [3]);
    useWorkspaceStore.getState().setSimulatorPins(2, 'whole:2:all', [6]);

    expect(storedPins(1, 'whole:1:all')).toEqual([]);
    expect(storedPins(2, 'whole:2:all')).toEqual([6]);
  });

  it('cancels a gesture on Escape, then leaves Pin for Orbit, then hands Escape on', () => {
    const cancelGesture = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    render(options({ cancelGesture }));

    act(() => {
      expect(tools().shortcuts.exitTool()).toBe(true);
    });
    expect(useWorkspaceStore.getState().simulatorActiveToolId).toBe('pin');

    act(() => {
      expect(tools().shortcuts.exitTool()).toBe(true);
    });
    expect(useWorkspaceStore.getState().simulatorActiveToolId).toBe('orbit');

    act(() => {
      expect(tools().shortcuts.exitTool()).toBe(false);
    });
  });

  it('clears the pins, and switches the layers option', async () => {
    useWorkspaceStore.getState().setSimulatorPins(1, 'whole:1:all', [3]);
    render(options());
    await settle();

    act(() => tools().verbs.clearPins('tool-window'));
    expect(storedPins()).toEqual([]);

    act(() => tools().shortcuts.togglePinThroughLayers('shortcut'));
    expect(useWorkspaceStore.getState().simulatorToolOptions.pinThroughLayers).toBe(false);
    expect(tools().view.options.pinThroughLayers).toBe(false);
  });

  it('takes no gesture before the simulation is ready', async () => {
    const runtime = fakeRuntime({ pickFaces: vi.fn(async () => [1]) });
    render(options({ runtime, ready: false }));

    expect(tools().enabled).toBe(false);
    act(() => tools().runGesture(BOX, SURFACE));
    await settle();
    expect(runtime.pickFaces).not.toHaveBeenCalled();
  });

  it('raises a notice from a frame only while something is pinned', async () => {
    const frame = { recovered: 'reset' as const, maxStrain: 0 };
    render(options());
    act(() => tools().observeFrame({ ...frame } as never));
    expect(tools().view.notices).toEqual([]);

    act(() => useWorkspaceStore.getState().setSimulatorPins(1, 'whole:1:all', [2]));
    await settle();
    act(() => tools().observeFrame({ ...frame } as never));
    expect(tools().view.notices).toEqual(['recovered']);

    // A new set of pins starts without the old set's notices.
    act(() => useWorkspaceStore.getState().setSimulatorPins(1, 'whole:1:all', [2, 3]));
    await settle();
    expect(tools().view.notices).toEqual([]);
  });
});

describe('nextPinNotices', () => {
  const settled = (maxStrain: number) => ({ recovered: null, maxStrain, converged: true });
  const quiet = settled(0.01);

  it('keeps the same array when a frame changes nothing', () => {
    const current = ['strained'] as const;
    expect(nextPinNotices(current, settled(0.5))).toBe(current);
    expect(nextPinNotices([], quiet)).toEqual([]);
  });

  it('reports a reset, and not an arrest, settled or not', () => {
    expect(nextPinNotices([], { recovered: 'reset', maxStrain: 0, converged: false })).toEqual([
      'recovered',
    ]);
    expect(nextPinNotices([], { recovered: 'arrest', maxStrain: 0, converged: true })).toEqual([]);
  });

  it('raises the strain notice from a settled frame above the threshold and drops it only well below', () => {
    const raised = nextPinNotices([], settled(PIN_STRAIN_NOTICE_THRESHOLD + 0.01));
    expect(raised).toEqual(['strained']);
    // Just under the line it stays, so it cannot flicker there.
    expect(nextPinNotices(raised, settled(PIN_STRAIN_NOTICE_THRESHOLD - 0.01))).toBe(raised);
    expect(nextPinNotices(raised, quiet)).toEqual([]);
  });

  it('reads nothing into strain while the model is still moving', () => {
    // A fold's transients run past the threshold with nothing pinned at all.
    const moving = { recovered: null, maxStrain: 0.14, converged: false };
    expect(nextPinNotices([], moving)).toEqual([]);
    const raised = ['strained'] as const;
    expect(nextPinNotices(raised, { ...moving, maxStrain: 0 })).toBe(raised);
  });
});

describe('classifySimulatorCallFailure', () => {
  it('leaves a worker failure to the app, and calls anything else a bug', () => {
    expect(classifySimulatorCallFailure({ code: 'worker_simulator', message: 'x' })).toBe('worker-lost');
    expect(classifySimulatorCallFailure(new Error('x'))).toBe('unexpected');
    expect(classifySimulatorCallFailure({ code: 'webgl_context_lost' })).toBe('unexpected');
    expect(classifySimulatorCallFailure(null)).toBe('unexpected');
  });
});

describe('useSimulatorTools analytics', () => {
  function frame(extra: Partial<{ foldPercent: number; recovered: 'reset' | 'arrest' | null; maxStrain: number }>) {
    return { foldPercent: 0, recovered: null, maxStrain: 0, ...extra } as never;
  }

  it('reports a tool change once, and not a press on the tool in hand', () => {
    render(options());

    act(() => tools().verbs.selectTool('pin', 'rail'));
    act(() => tools().verbs.selectTool('orbit', 'picker'));
    act(() => tools().verbs.selectTool('orbit', 'rail'));

    expect(tracked).toEqual([
      { event: 'simulator tool selected', properties: { tool: 'orbit', source: 'picker' } },
    ]);
  });

  it('reports each pin gesture with what it found', async () => {
    const pickFaces = vi
      .fn<SimulatorToolsRuntime['pickFaces']>()
      .mockResolvedValueOnce([4, 2])
      .mockResolvedValueOnce([]);
    render(options({ runtime: fakeRuntime({ pickFaces }) }));

    act(() => tools().runGesture(BOX, SURFACE));
    await settle();
    act(() => tools().runGesture(CLICK, SURFACE));
    await settle();

    expect(tracked).toEqual([
      {
        event: 'simulator pins edited',
        properties: { gesture: 'box', mode: 'replace', depth: 'all-layers', outcome: 'changed', pinned_count_bucket: '<=5' },
      },
      {
        event: 'simulator pins edited',
        properties: { gesture: 'click', mode: 'replace', depth: 'front', outcome: 'empty', pinned_count_bucket: '<=0' },
      },
    ]);
  });

  it('reports a Clear that emptied something, and an option that changed', async () => {
    useWorkspaceStore.getState().setSimulatorPins(1, 'whole:1:all', [3, 5]);
    render(options());
    await settle();

    act(() => tools().verbs.clearPins('context-menu'));
    act(() => tools().verbs.clearPins('context-menu'));
    act(() => tools().verbs.setOption('pinThroughLayers', true, 'tool-window'));
    act(() => tools().verbs.setOption('pinThroughLayers', false, 'tool-window'));

    expect(tracked).toEqual([
      { event: 'simulator pins cleared', properties: { source: 'context-menu', pinned_count_bucket: '<=5' } },
      {
        event: 'simulator tool option changed',
        properties: { tool: 'pin', option: 'through-layers', value: 'off', source: 'tool-window' },
      },
    ]);
  });

  it('reports the fold first moving after a pin edit, once per pin set', async () => {
    render(options());
    act(() => tools().observeFrame(frame({ foldPercent: 20 })));
    act(() => useWorkspaceStore.getState().setSimulatorPins(1, 'whole:1:all', [2]));
    await settle();

    act(() => tools().observeFrame(frame({ foldPercent: 20.5 })));
    act(() => tools().observeFrame(frame({ foldPercent: 12 })));
    act(() => tools().observeFrame(frame({ foldPercent: 40 })));

    expect(tracked).toEqual([
      { event: 'simulator pinned fold moved', properties: { direction: 'unfold', pinned_count_bucket: '<=1' } },
    ]);
  });

  it('reports a solver recovery once per model and action', async () => {
    render(options());

    act(() => tools().observeFrame(frame({ recovered: 'arrest' })));
    act(() => tools().observeFrame(frame({ recovered: 'arrest' })));
    act(() => tools().observeFrame(frame({ recovered: 'reset' })));

    expect(tracked).toEqual([
      { event: 'simulator solver recovered', properties: { action: 'arrest', pinned: 'no' } },
      { event: 'simulator solver recovered', properties: { action: 'reset', pinned: 'no' } },
    ]);
  });
});
