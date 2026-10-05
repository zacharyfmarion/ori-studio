import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoldDocument, RenderSettings } from '@treemaker/origami-simulator';
import type { PaperScene } from '../lib/paper/paperScene';
import { DEFAULT_PAPER_STYLE } from '../lib/paper/paperStyle';
import type {
  SimulatorBackendId,
  SimulatorExportSceneOptions,
  SimulatorExportSnapshotOptions,
  SimulatorFramePayload,
} from './simulatorSession';
import type { SimulatorExportSnapshot } from './useSimulatorRuntime';

/**
 * The worker, as far as the hook can tell. `load` resolves only when the test
 * says so, which is what lets a mount be torn down mid-load — the case that
 * leaked.
 */
const released: number[] = [];
let nextToken = 0;
let pendingLoads: Array<() => void> = [];

/**
 * A tick reply that says the worker still has our session.
 *
 * This is the default because `null` is not an inert stand-in here — it is the
 * eviction signal, and the runtime answers it by reloading. A `null` default
 * armed that path from the moment an unpaused probe mounted, so
 * "reloads when the worker no longer has the session it holds" was racing the
 * loop it had not simulated the eviction for yet: any frame that landed during
 * `settleLoads` made `load` fire twice before the test's own arrange step. It
 * passed when frames were slow and failed when they were not, which is why it
 * only surfaced under CI load and once locally.
 */
function liveFrame(): SimulatorFramePayload | null {
  return {
    positions: null,
    colors: null,
    renderedInWorker: false,
    bitmap: null,
    step: 0,
    stepsThisTick: 1,
    elapsedMs: 0,
    // Not converged: a converged frame idles the loop, and these tests want it
    // running so an eviction has something to be noticed by.
    converged: false,
    framed: true,
    maxVelocity: 0,
    foldPercent: 0,
    maxStrain: 0,
    recovered: null,
    posed: false,
    poseEnded: null,
    framingHeld: false,
  };
}

/**
 * A load that lands on the CPU solver, held open until the test releases it.
 *
 * Named rather than inlined so `beforeEach` can put it *back*. `mockClear` does
 * not touch implementations, so a describe block that installs its own `load`
 * with `mockImplementation` silently keeps it for every test that runs after —
 * which is how a test asserting the CPU fallback passed alone and failed in the
 * suite, having been handed a GPU backend by an earlier block.
 */
async function defaultLoad() {
  const token = ++nextToken;
  await new Promise<void>((resolve) => pendingLoads.push(resolve));
  return {
    token,
    // Widened deliberately: `load` really can answer either backend, and
    // pinning the mock to one made the GPU path untestable — a test that
    // overrides it could not be assigned to the mock's own inferred type.
    backend: 'reference' as SimulatorBackendId,
    edgeCount: 0,
    creaseCount: 0,
    diagnostics: null,
    positions: null,
    indices: new Int32Array(0),
    vertexCount: 0,
  };
}

/** The id the worker hands out for a frozen frame; not a session token. */
const EXPORT_SNAPSHOT_ID = 41;

const client = {
  load: vi.fn(defaultLoad),
  release: vi.fn(async (token: number) => {
    released.push(token);
  }),
  settle: vi.fn(async () => null),
  // Defaults to a GPU-capable worker. The runtime now asks *this* rather than
  // probing the main thread, so a test wanting the CPU path says so here.
  probeGpuRender: vi.fn(async () => true),
  attachBitmapOutput: vi.fn(async () => undefined),
  attachCanvas: vi.fn(async () => undefined),
  tick: vi.fn(async () => liveFrame()),
  // Typed to the real signature so `mock.calls` carries the camera through and
  // a test can assert *which* view was sent, not merely how many were.
  setCamera: vi.fn(
    async (
      _camera: { view: { yaw: number; pitch: number; zoom: number }; width: number; height: number },
      _token?: number
    ): Promise<undefined> => undefined
  ),
  setRenderSettings: vi.fn(async () => undefined),
  setFoldPercent: vi.fn(async () => undefined),
  reset: vi.fn(async () => undefined),
  // Typed for the same reason as `setCamera`: the export tests assert what view
  // travelled with the request, and which frozen frame a scene was asked of.
  beginExportSnapshot: vi.fn(
    async (_options: SimulatorExportSnapshotOptions): Promise<number | null> => EXPORT_SNAPSHOT_ID
  ),
  exportScene: vi.fn(
    async (_id: number, _options: SimulatorExportSceneOptions): Promise<PaperScene | null> => null
  ),
  endExportSnapshot: vi.fn(async (_id: number): Promise<void> => undefined),
  setPinnedFaces: vi.fn(
    async (
      faces: number[],
      _token?: number
    ): Promise<{ applied: number; dropped: number; bitmap: ImageBitmap | null } | null> => ({
      applied: faces.length,
      dropped: 0,
      bitmap: null,
    })
  ),
  pickFaces: vi.fn(async (): Promise<number[] | null> => [1]),
  beginPull: vi.fn(
    async (
      _at: unknown,
      _drawn?: unknown,
      _token?: number
    ): Promise<{ outcome: 'pulling' | 'missed' | 'pinned-face' | 'no-pins' } | null> => ({ outcome: 'pulling' })
  ),
  movePull: vi.fn(async (_at: { x: number }, _drawn?: unknown, _token?: number): Promise<boolean | null> => true),
  endPull: vi.fn(
    async (_outcome: 'keep' | 'cancel', _token?: number): Promise<{ movedCreases: number } | null> => ({
      movedCreases: 3,
    })
  ),
  releasePose: vi.fn(async (_token?: number): Promise<boolean | null> => true),
};

vi.mock('../store/workspaceStore/simulatorRuntime', () => ({
  retainSimulatorClient: () => client,
  releaseSimulatorClient: () => undefined,
}));

vi.mock('./renderModel', () => ({
  inflateRenderModel: () => ({ positions: null, indices: new Int32Array(0) }),
}));

const { useSimulatorRuntime } = await import('./useSimulatorRuntime');
const { resetWorkerGpuSupportForTests } = await import('./workerGpuSupport');

const FOLD = {
  vertices_coords: [[0, 0], [1, 0], [0, 1]],
  edges_vertices: [[0, 1], [1, 2], [2, 0]],
  edges_assignment: ['B', 'B', 'B'],
  faces_vertices: [[0, 1, 2]],
} as unknown as FoldDocument;

function Probe({ fold, paused = true }: { fold: FoldDocument | null; paused?: boolean }) {
  const runtime = useSimulatorRuntime({
    fold,
    solverOptions: {},
    triangulate: false,
    canvas: null,
    bitmapOutput: null,
    paused,
  });
  // The loop idles on a converged, not-playing model, so playing is what makes
  // it actually tick.
  const { status, setPlaying } = runtime;
  useEffect(() => {
    if (status === 'ready') setPlaying(true);
  }, [status, setPlaying]);
  return null;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  released.length = 0;
  nextToken = 0;
  pendingLoads = [];
  // Reset, not cleared: `camera coalescing` installs a webgl2-returning `load`
  // with `mockImplementation`, which outlives its own block otherwise.
  client.load.mockReset();
  client.load.mockImplementation(defaultLoad);
  client.release.mockClear();
  // Restored, not just cleared: the eviction tests replace this with `null` and
  // nothing put it back, so the override outlived the test that set it.
  client.tick.mockReset();
  client.tick.mockImplementation(async () => liveFrame());
  // Cached for the life of the module, so without this the first test to probe
  // decides the render path for every test after it.
  resetWorkerGpuSupportForTests();
  client.probeGpuRender.mockClear();
  client.probeGpuRender.mockImplementation(async () => true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  host?.remove();
  root = null;
  host = null;
});

/** Let every queued `load` resolve, then flush the continuations. */
async function settleLoads() {
  await act(async () => {
    for (const resolve of pendingLoads.splice(0)) resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useSimulatorRuntime session ownership', () => {
  it('hands back a session whose load was cancelled before it landed', async () => {
    // `load` registers the session in the worker before it returns, so a load
    // that is abandoned mid-flight still made one. Dropping the token leaked it:
    // nothing held a reference, so it stayed resident until the cap evicted it —
    // taking a *live* window's session with it. StrictMode made that one leak
    // per mount, halving the effective cap.
    await act(async () => root?.render(<Probe fold={FOLD} />));
    expect(client.load).toHaveBeenCalledTimes(1);

    // Torn down while the load is still in flight.
    await act(async () => root?.unmount());
    await settleLoads();

    expect(released).toEqual([1]);
  });

  it('hands back a session that a newer load superseded', async () => {
    await act(async () => root?.render(<Probe fold={FOLD} />));
    // A second load starts before the first resolves; the first is now nobody's.
    const other = { ...FOLD } as FoldDocument;
    await act(async () => root?.render(<Probe fold={other} />));
    expect(client.load).toHaveBeenCalledTimes(2);

    await settleLoads();

    expect(released).toContain(1);
    expect(released).not.toContain(2);
  });

  it('keeps the session of a load that landed', async () => {
    await act(async () => root?.render(<Probe fold={FOLD} />));
    await settleLoads();
    expect(released).toEqual([]);
  });
});

describe('recovering from an eviction', () => {
  /** Run animation frames until `done`, or give up. */
  async function pump(done: () => boolean, frames = 20) {
    for (let i = 0; i < frames && !done(); i += 1) {
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await Promise.resolve();
      });
    }
  }

  it('reloads when the worker no longer has the session it holds', async () => {
    // The cap should make this unreachable, but when it is not, a window must not
    // sit on a dead token reporting 'ready' while every frame it asks for is
    // discarded. That is a silent freeze with no error anywhere — how the session
    // leak presented, and why it took so long to find.
    await act(async () => root?.render(<Probe fold={FOLD} paused={false} />));
    await settleLoads();
    expect(client.load).toHaveBeenCalledTimes(1);

    // The worker has dropped our model: it answers our token with null.
    client.tick.mockResolvedValue(null);
    await pump(() => client.load.mock.calls.length > 1);

    expect(client.load).toHaveBeenCalledTimes(2);
  });

  it('does not spin: one eviction costs one reload', async () => {
    await act(async () => root?.render(<Probe fold={FOLD} paused={false} />));
    await settleLoads();
    client.tick.mockResolvedValue(null);
    await pump(() => client.load.mock.calls.length > 1);

    // The reload is still in flight, so the loop is not ticking and cannot ask
    // again. Without the status change it would re-fire every frame.
    const afterFirstRecovery = client.load.mock.calls.length;
    await pump(() => false, 5);
    expect(client.load.mock.calls.length).toBe(afterFirstRecovery);
  });
});

/**
 * Orbit backpressure.
 *
 * `setCamera` used to dispatch once per pointermove with nothing bounding how
 * many could be outstanding. Measured on the desktop shell that was 108 moves/s
 * against ~40 renders/s: 164 messages in flight at the peak, and the fold went
 * on turning for 3.0s after the pointer came up. Every per-render average
 * stayed healthy throughout, which is why it survived a release — the cost was
 * never in a frame, it was in the queue.
 *
 * These assert the bound itself, because that is the part a future edit can
 * silently remove. A render test cannot see it: the picture is the same either
 * way, only *when* it arrives differs.
 */
describe('camera coalescing', () => {
  let cameraResolvers: Array<() => void> = [];
  let contextSpy: ReturnType<typeof vi.spyOn> | null = null;
  /** The mounted runtime, refreshed on every commit. Scope-local, not a prop. */
  let live: ReturnType<typeof useSimulatorRuntime> | null = null;

  beforeEach(() => {
    live = null;
    cameraResolvers = [];
    // The GPU path is the one that has a camera message at all, and
    // `webglRenderSupported` gates it on two things jsdom lacks: an
    // `OffscreenCanvas` global, which it refuses on *before* probing anything,
    // and a WebGL2 context with the float-render-target extension. Both have to
    // be answered rather than discovered.
    vi.stubGlobal('OffscreenCanvas', class {});
    contextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      getExtension: () => ({ loseContext: () => undefined }),
    } as unknown as RenderingContext);
    client.load.mockImplementation(async () => {
      const token = ++nextToken;
      await new Promise<void>((resolve) => pendingLoads.push(resolve));
      return {
        token,
        backend: 'webgl2' as const,
        edgeCount: 0,
        creaseCount: 0,
        diagnostics: null,
        positions: null,
        indices: new Int32Array(0),
        vertexCount: 0,
      };
    });
    client.setCamera.mockReset();
    // Held open, so a test can pile requests up behind one in-flight message —
    // which is the entire situation being tested.
    client.setCamera.mockImplementation(
      () => new Promise<undefined>((resolve) => cameraResolvers.push(() => resolve(undefined)))
    );
  });

  afterEach(() => {
    contextSpy?.mockRestore();
    vi.unstubAllGlobals();
    client.setCamera.mockReset();
    client.setCamera.mockImplementation(async () => undefined);
  });

  function GpuProbe() {
    const runtime = useSimulatorRuntime({
      fold: FOLD,
      solverOptions: {},
      triangulate: false,
      canvas: null,
      bitmapOutput: { width: 64, height: 64 },
      paused: true,
    });
    // In an effect, not during render: a write during render is a mutation React
    // may discard, the same rule this hook follows for `onFrameRef`. No dep
    // array, so it is current after every commit.
    useEffect(() => {
      live = runtime;
    });
    return null;
  }

  /** Flush the microtask queue so a settled camera promise runs its trailing send. */
  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function mounted() {
    await act(async () => root?.render(<GpuProbe />));
    await settleLoads();
  }

  const view = (yaw: number) => ({ yaw, pitch: 0, zoom: 1 });

  it('keeps at most one camera message in flight', async () => {
    await mounted();
    expect(live?.gpuActive).toBe(true);

    // Ten pointer samples arrive before the worker has answered the first.
    act(() => {
      for (let i = 0; i < 10; i += 1) live?.setCamera(view(i), 64, 64);
    });

    // Nine of them coalesced into one pending request rather than nine messages.
    expect(client.setCamera).toHaveBeenCalledTimes(1);
  });

  it('sends the newest view once the worker answers, and drops the rest', async () => {
    await mounted();
    act(() => {
      for (let i = 0; i < 10; i += 1) live?.setCamera(view(i), 64, 64);
    });
    expect(client.setCamera).toHaveBeenCalledTimes(1);

    await act(async () => {
      cameraResolvers.shift()?.();
    });
    await flush();

    // Exactly one follow-up, carrying the last view rather than the second —
    // a camera is absolute state, so the newest is the only one worth drawing.
    expect(client.setCamera).toHaveBeenCalledTimes(2);
    expect(client.setCamera.mock.calls[1]?.[0]).toMatchObject({ view: view(9) });
  });

  it('settles on the released view rather than the last one dispatched', async () => {
    // The reason for a *trailing* send. Without it the model stops a few degrees
    // from where the pointer let go, which reads as the drag not having taken.
    await mounted();
    act(() => {
      live?.setCamera(view(1), 64, 64);
      live?.setCamera(view(2), 64, 64);
    });
    await act(async () => cameraResolvers.shift()?.());
    await flush();
    await act(async () => cameraResolvers.shift()?.());
    await flush();

    expect(client.setCamera).toHaveBeenCalledTimes(2);
    expect(client.setCamera.mock.calls[1]?.[0]).toMatchObject({ view: view(2) });
    // And the queue is empty: nothing is still owed once the last view is drawn.
    expect(cameraResolvers).toHaveLength(0);
  });

  it('accepts a new gesture after an earlier one drained', async () => {
    // The busy flag has to be cleared on the reply, not just on the trailing
    // send — otherwise the first drag works and every later one is ignored.
    await mounted();
    act(() => live?.setCamera(view(1), 64, 64));
    await act(async () => cameraResolvers.shift()?.());
    await flush();

    act(() => live?.setCamera(view(5), 64, 64));
    expect(client.setCamera).toHaveBeenCalledTimes(2);
    expect(client.setCamera.mock.calls[1]?.[0]).toMatchObject({ view: view(5) });
  });
});

/**
 * The canvas commitment, and what decides it.
 *
 * `transferControlToOffscreen` is irreversible: the element is in placeholder
 * mode for good, and `getContext('2d')` on it throws `InvalidStateError` rather
 * than returning null. So committing on a wrong prediction does not cost a
 * slower render path, it costs the canvas — the canvas-2D fallback can no longer
 * draw on the surface it was supposed to fall back to.
 *
 * That is the Linux bug these cover: WebKitGTK reports main-thread WebGL2 while
 * its workers have none, so the old main-thread probe said yes, the canvas was
 * transferred, the worker fell back to the reference solver, and the first frame
 * threw on a canvas nobody could draw on.
 */
describe('canvas commitment follows the worker, not the main thread', () => {
  let canvas: HTMLCanvasElement | null = null;
  let transferred = 0;

  function CanvasProbe() {
    const runtime = useSimulatorRuntime({
      fold: FOLD,
      solverOptions: {},
      triangulate: false,
      canvas,
      paused: true,
    });
    // In an effect rather than during render, like `GpuProbe` above: a write
    // during render is a mutation React may discard.
    useEffect(() => {
      generation = runtime.canvasGeneration;
    });
    return null;
  }

  let generation = 0;

  /**
   * Drain repeatedly rather than once.
   *
   * The probe puts an extra `await` in front of `load`, so a single flush can
   * splice an empty queue and then leave the resolver `load` pushes *after* it
   * pending for good. Several rounds let each hop reach the next one, and the
   * recovery this covers lands a state update two hops past the load.
   */
  async function drainLoads(rounds = 6) {
    for (let i = 0; i < rounds; i += 1) {
      await settleLoads();
    }
  }

  beforeEach(() => {
    generation = 0;
    transferred = 0;
    canvas = document.createElement('canvas');
    // jsdom has neither, and both are load-bearing: the runtime refuses the GPU
    // path outright without an `OffscreenCanvas` global.
    vi.stubGlobal('OffscreenCanvas', class {});
    canvas.transferControlToOffscreen = (() => {
      transferred += 1;
      return {} as OffscreenCanvas;
    }) as HTMLCanvasElement['transferControlToOffscreen'];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    canvas = null;
  });

  it('transfers the canvas when the worker reports GPU rendering', async () => {
    client.load.mockImplementationOnce(async () => {
      const token = ++nextToken;
      await new Promise<void>((resolve) => pendingLoads.push(resolve));
      return {
        token,
        backend: 'webgl2' as SimulatorBackendId,
        edgeCount: 0,
        creaseCount: 0,
        diagnostics: null,
        positions: null,
        indices: new Int32Array(0),
        vertexCount: 0,
      };
    });

    await act(async () => root?.render(<CanvasProbe />));
    await drainLoads();

    expect(client.probeGpuRender).toHaveBeenCalled();
    expect(transferred).toBe(1);
    expect(client.attachCanvas).toHaveBeenCalled();
  });

  it('never transfers the canvas when the worker has no GPU rendering', async () => {
    client.probeGpuRender.mockImplementation(async () => false);
    client.attachCanvas.mockClear();

    await act(async () => root?.render(<CanvasProbe />));
    await drainLoads();

    // The whole fix: an untransferred canvas is one canvas-2D can still draw on.
    expect(transferred).toBe(0);
    expect(client.attachCanvas).not.toHaveBeenCalled();
    // And the worker was still asked to load — the CPU path is a working
    // simulator, not a refusal to run one.
    expect(client.load).toHaveBeenCalled();
  });

  it('asks a worker that cannot answer for nothing, and fails closed', async () => {
    // A dead or mid-terminate worker is not a GPU-capable one. Failing open here
    // is what commits a canvas that can never be drawn on.
    client.probeGpuRender.mockImplementation(async () => {
      throw new Error('worker gone');
    });

    await act(async () => root?.render(<CanvasProbe />));
    await drainLoads();

    expect(transferred).toBe(0);
  });

  it('recovers when the backend contradicts the probe', async () => {
    // The probe says yes, the load comes back on the reference solver anyway —
    // a context-cap eviction or a driver losing the context in between. The
    // canvas is already committed, so the only way back to a drawable surface is
    // a new element, which is what the generation bump asks the panel for.
    client.attachCanvas.mockClear();

    await act(async () => root?.render(<CanvasProbe />));
    await drainLoads();

    expect(transferred).toBe(1);
    expect(generation).toBe(1);

    // And the retry does not commit a second canvas the same way: the load
    // result has already marked the worker unsupported, so it cannot loop.
    canvas = document.createElement('canvas');
    canvas.transferControlToOffscreen = (() => {
      transferred += 1;
      return {} as OffscreenCanvas;
    }) as HTMLCanvasElement['transferControlToOffscreen'];
    await act(async () => root?.render(<CanvasProbe />));
    await drainLoads();

    expect(transferred).toBe(1);
    expect(generation).toBe(1);
  });
});

/**
 * A session is made by `load`, and the worker's own carry-over of camera and
 * palette only reaches from a session it still has. A fold that goes null in
 * between — a rebuild re-deriving the artifacts — released the old session
 * first, so the new one opened on the worker's defaults: blue paper, default
 * orbit, and nothing on the main thread noticing because `gpuActive` never
 * flipped. The runtime remembers what it forwarded and opens every later
 * session on it.
 */
describe('a replacement session opens on the view in use', () => {
  let contextSpy: ReturnType<typeof vi.spyOn> | null = null;
  let live: ReturnType<typeof useSimulatorRuntime> | null = null;

  const SETTINGS: RenderSettings = {
    frontColor: [1, 1, 0.2],
    backColor: [0.95, 0.94, 0.9],
    mountainColor: [0.86, 0.12, 0.14],
    valleyColor: [0.11, 0.36, 0.85],
    borderColor: [0.16, 0.18, 0.2],
    lightDir: [-0.45, 0.58, 0.68],
    background: [0.05, 0.06, 0.07],
    showFaces: true,
    showEdges: true,
    lighting: true,
    edgeWidthPx: 3,
    mountainWidthPx: 3,
    valleyWidthPx: 3,
    faceAlpha: 1,
  };

  beforeEach(() => {
    live = null;
    // The GPU path, for the same two reasons as `camera coalescing`.
    vi.stubGlobal('OffscreenCanvas', class {});
    contextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      getExtension: () => ({ loseContext: () => undefined }),
    } as unknown as RenderingContext);
    client.load.mockImplementation(async () => {
      const token = ++nextToken;
      await new Promise<void>((resolve) => pendingLoads.push(resolve));
      return {
        token,
        backend: 'webgl2' as const,
        edgeCount: 0,
        creaseCount: 0,
        diagnostics: null,
        positions: null,
        indices: new Int32Array(0),
        vertexCount: 0,
      };
    });
    client.setCamera.mockClear();
    client.setRenderSettings.mockClear();
  });

  afterEach(() => {
    contextSpy?.mockRestore();
    vi.unstubAllGlobals();
  });

  function ViewProbe({ fold }: { fold: FoldDocument | null }) {
    const runtime = useSimulatorRuntime({
      fold,
      solverOptions: {},
      triangulate: false,
      canvas: null,
      bitmapOutput: { width: 64, height: 64 },
      paused: true,
    });
    useEffect(() => {
      live = runtime;
    });
    return null;
  }

  /**
   * The options the most recent `load` was given. `defaultLoad` takes no
   * parameters, so the mock's call tuple is typed empty; the real signature is
   * `(fold, options)`.
   */
  function lastLoadOptions(): { view?: unknown } | undefined {
    const calls = client.load.mock.calls as unknown as Array<[unknown, { view?: unknown }]>;
    return calls.at(-1)?.[1];
  }

  it('hands the last camera and render settings to a load after the fold went away', async () => {
    await act(async () => root?.render(<ViewProbe fold={FOLD} />));
    await settleLoads();
    // A first load has nothing to open on; the viewport pushes once the GPU
    // path turns on, and that is the first the runtime hears of either.
    expect(lastLoadOptions()?.view).toEqual({ camera: undefined, settings: undefined });

    await act(async () => {
      live?.setCamera({ yaw: 0.7, pitch: -0.2, zoom: 1.5 }, 300, 200);
      live?.setRenderSettings(SETTINGS);
    });

    // The fold goes away and comes back as a new document: the old session is
    // released in between, so the worker has nothing of its own to carry.
    await act(async () => root?.render(<ViewProbe fold={null} />));
    expect(client.release).toHaveBeenCalledTimes(1);
    await act(async () => root?.render(<ViewProbe fold={{ ...FOLD }} />));
    await settleLoads();

    expect(client.load).toHaveBeenCalledTimes(2);
    expect(lastLoadOptions()?.view).toEqual({
      camera: { view: { yaw: 0.7, pitch: -0.2, zoom: 1.5 }, width: 300, height: 200 },
      settings: SETTINGS,
    });
  });

  it('forgets a model’s error once the fold is gone', async () => {
    client.load.mockImplementationOnce(async () => {
      throw new Error('the worker refused it');
    });
    await act(async () => root?.render(<ViewProbe fold={FOLD} />));
    await settleLoads();
    expect(live?.status).toBe('error');
    expect(live?.error).toBe('the worker refused it');

    // A rebuild passes through null on its way to a new load. Reporting the old
    // model's failure across that gap would mislabel the rebuild as failed too.
    await act(async () => root?.render(<ViewProbe fold={null} />));
    expect(live?.status).toBe('idle');
    expect(live?.error).toBeNull();
  });
});

/**
 * On the canvas-2D path the main thread draws, so the runtime forwards neither
 * camera nor settings to the worker — a message per orbit frame would buy
 * nothing. But the worker still freezes the frame an export is built from, and
 * with nothing forwarded it froze its own defaults at the opening camera: blue
 * paper, 3 px creases, a view nobody was looking at. The runtime remembers both
 * and sends them with the request instead.
 */
describe('beginExport', () => {
  let live: ReturnType<typeof useSimulatorRuntime> | null = null;

  const SETTINGS: RenderSettings = {
    frontColor: [1, 1, 0.2],
    backColor: [0.95, 0.94, 0.9],
    mountainColor: [0.86, 0.12, 0.14],
    valleyColor: [0.11, 0.36, 0.85],
    borderColor: [0.16, 0.18, 0.2],
    lightDir: [-0.45, 0.58, 0.68],
    background: [0.05, 0.06, 0.07],
    showFaces: true,
    showEdges: true,
    lighting: true,
    edgeWidthPx: 3,
    mountainWidthPx: 3,
    valleyWidthPx: 3,
    faceAlpha: 1,
  };

  beforeEach(() => {
    live = null;
    client.setCamera.mockClear();
    client.setRenderSettings.mockClear();
    client.beginExportSnapshot.mockReset();
    client.beginExportSnapshot.mockImplementation(async () => EXPORT_SNAPSHOT_ID);
    client.exportScene.mockReset();
    client.exportScene.mockImplementation(async () => null);
    client.endExportSnapshot.mockReset();
    client.endExportSnapshot.mockImplementation(async () => undefined);
  });

  function CpuProbe({ fold }: { fold: FoldDocument | null }) {
    // No canvas and no bitmap output: nothing to render into, so the runtime
    // never asks for the GPU path and `defaultLoad` answers with the CPU solver.
    const runtime = useSimulatorRuntime({
      fold,
      solverOptions: {},
      triangulate: false,
      canvas: null,
      bitmapOutput: null,
      paused: true,
    });
    useEffect(() => {
      live = runtime;
    });
    return null;
  }

  async function mountLoaded() {
    await act(async () => root?.render(<CpuProbe fold={FOLD} />));
    await settleLoads();
  }

  async function beginExport(): Promise<SimulatorExportSnapshot | null | undefined> {
    let snapshot: SimulatorExportSnapshot | null | undefined;
    await act(async () => {
      snapshot = await live?.beginExport();
    });
    return snapshot;
  }

  it('remembers the camera and settings without sending them, and freezes the view with both', async () => {
    await mountLoaded();
    expect(live?.status).toBe('ready');
    expect(live?.gpuActive).toBe(false);

    await act(async () => {
      live?.setCamera({ yaw: 0.7, pitch: -0.2, zoom: 1.5 }, 300, 200);
      live?.setRenderSettings(SETTINGS);
    });
    // Recorded on the main thread only: the worker is not drawing this view.
    expect(client.setCamera).not.toHaveBeenCalled();
    expect(client.setRenderSettings).not.toHaveBeenCalled();

    await beginExport();
    expect(client.beginExportSnapshot).toHaveBeenCalledTimes(1);
    expect(client.beginExportSnapshot.mock.calls[0]?.[0]).toEqual({
      token: 1,
      devicePixelRatio: 1,
      camera: { view: { yaw: 0.7, pitch: -0.2, zoom: 1.5 }, width: 300, height: 200 },
      settings: SETTINGS,
    });
  });

  it('freezes the newest camera, not the one last drawn', async () => {
    await mountLoaded();
    await act(async () => {
      live?.setCamera({ yaw: 0.1, pitch: 0, zoom: 1 }, 300, 200);
      live?.setCamera({ yaw: 0.9, pitch: 0, zoom: 1 }, 300, 200);
    });
    await beginExport();
    expect(client.beginExportSnapshot.mock.calls[0]?.[0]).toMatchObject({
      camera: { view: { yaw: 0.9, pitch: 0, zoom: 1 } },
    });
  });

  it('sends nothing it was never told', async () => {
    await mountLoaded();
    await beginExport();
    // The worker's own view stands: an `undefined` here is "no opinion", not a
    // reset to defaults.
    expect(client.beginExportSnapshot.mock.calls[0]?.[0]).toMatchObject({
      camera: undefined,
      settings: undefined,
    });
  });

  it('measures the frame at the device pixel ratio the viewport draws at', async () => {
    vi.stubGlobal('devicePixelRatio', 2);
    try {
      await mountLoaded();
      await beginExport();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(client.beginExportSnapshot.mock.calls[0]?.[0]).toMatchObject({ devicePixelRatio: 2 });
  });

  it('answers null, asking the worker nothing, while it holds no model', async () => {
    await act(async () => root?.render(<CpuProbe fold={null} />));
    await expect(beginExport()).resolves.toBeNull();

    // A load in flight has no session to quote yet.
    await act(async () => root?.render(<CpuProbe fold={FOLD} />));
    expect(live?.status).toBe('loading');
    await expect(beginExport()).resolves.toBeNull();
    expect(client.beginExportSnapshot).not.toHaveBeenCalled();
  });

  it('answers null when the worker has no frame to freeze', async () => {
    await mountLoaded();
    client.beginExportSnapshot.mockResolvedValueOnce(null);
    await expect(beginExport()).resolves.toBeNull();
  });

  it('asks for scenes of the frozen frame, and lets it go, by the id the worker gave it', async () => {
    await mountLoaded();
    const snapshot = await beginExport();
    const scene = { bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, sheet: 1, items: [] };
    client.exportScene.mockResolvedValueOnce(scene);
    const options = { style: DEFAULT_PAPER_STYLE, markHidden: true };
    await expect(snapshot?.scene(options)).resolves.toBe(scene);
    expect(client.exportScene).toHaveBeenCalledWith(EXPORT_SNAPSHOT_ID, options);

    expect(client.endExportSnapshot).not.toHaveBeenCalled();
    snapshot?.release();
    expect(client.endExportSnapshot).toHaveBeenCalledWith(EXPORT_SNAPSHOT_ID);
  });

  it('lets a frame go quietly when the worker holding it is gone', async () => {
    await mountLoaded();
    const snapshot = await beginExport();
    // A plain function, not the mock: a vi.fn handles every promise it returns
    // itself, so a rejection from it could never go unhandled.
    const mocked = client.endExportSnapshot;
    const ended: number[] = [];
    client.endExportSnapshot = ((id: number) => {
      ended.push(id);
      return Promise.reject(new Error('worker terminated'));
    }) as unknown as typeof mocked;
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      expect(() => snapshot?.release()).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off('unhandledRejection', unhandled);
      client.endExportSnapshot = mocked;
    }
    expect(ended).toEqual([EXPORT_SNAPSHOT_ID]);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe('pins', () => {
  let live: ReturnType<typeof useSimulatorRuntime> | null = null;

  function CpuProbe({ fold }: { fold: FoldDocument | null }) {
    const runtime = useSimulatorRuntime({
      fold,
      solverOptions: {},
      triangulate: false,
      canvas: null,
      bitmapOutput: null,
      paused: true,
    });
    useEffect(() => {
      live = runtime;
    });
    return null;
  }

  beforeEach(() => {
    live = null;
    client.setPinnedFaces.mockClear();
    client.pickFaces.mockClear();
  });

  async function mountLoaded(fold: FoldDocument) {
    await act(async () => root?.render(<CpuProbe fold={fold} />));
    await settleLoads();
  }

  it('sends pins for the model it holds, quoting that model’s session', async () => {
    await mountLoaded(FOLD);
    const model = live?.model;
    expect(model).toBeTruthy();

    let outcome: unknown;
    await act(async () => {
      outcome = await live?.setPinnedFaces([3, 4], model!);
    });

    expect(client.setPinnedFaces).toHaveBeenCalledWith([3, 4], 1);
    expect(outcome).toEqual({ applied: 2, dropped: 0 });
  });

  it('drops pins read against a model it no longer holds, asking the worker nothing', async () => {
    await mountLoaded(FOLD);
    const stale = live?.model;
    await mountLoaded({ ...FOLD } as FoldDocument);
    expect(live?.model).not.toBe(stale);

    let outcome: unknown = 'unset';
    await act(async () => {
      outcome = await live?.setPinnedFaces([1], stale!);
    });

    expect(outcome).toBeNull();
    expect(client.setPinnedFaces).not.toHaveBeenCalled();
  });

  it('sends pin sets in the order they were made, so the newest is the one that stays', async () => {
    await mountLoaded(FOLD);
    const model = live!.model!;
    let releaseFirst: () => void = () => undefined;
    client.setPinnedFaces.mockImplementationOnce(
      (faces) =>
        new Promise((resolve) => {
          releaseFirst = () => resolve({ applied: faces.length, dropped: 0, bitmap: null });
        })
    );

    let first: Promise<unknown> | undefined;
    let second: Promise<unknown> | undefined;
    await act(async () => {
      first = live!.setPinnedFaces([1], model);
      second = live!.setPinnedFaces([1, 2], model);
      await Promise.resolve();
    });
    // The second waits for the first to land.
    expect(client.setPinnedFaces).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseFirst();
      await first;
      await second;
    });
    expect(client.setPinnedFaces.mock.calls.map((call) => call[0])).toEqual([[1], [1, 2]]);
  });

  it('asks the worker for no picks on the canvas-2D path, where the main thread draws', async () => {
    await mountLoaded(FOLD);
    let picked: unknown = 'unset';
    await act(async () => {
      picked = await live?.pickFaces({
        region: { kind: 'point', x: 1, y: 1 },
        cssWidth: 10,
        cssHeight: 10,
        depth: 'all-layers',
      });
    });
    expect(picked).toBeNull();
    expect(client.pickFaces).not.toHaveBeenCalled();
  });
});

describe('pulls', () => {
  let live: ReturnType<typeof useSimulatorRuntime> | null = null;

  function CpuProbe({ fold }: { fold: FoldDocument | null }) {
    const runtime = useSimulatorRuntime({
      fold,
      solverOptions: {},
      triangulate: false,
      canvas: null,
      bitmapOutput: null,
      paused: true,
    });
    useEffect(() => {
      live = runtime;
    });
    return null;
  }

  const at = (x: number) => ({ x, y: 5, cssWidth: 10, cssHeight: 10 });

  beforeEach(() => {
    live = null;
    for (const call of [client.beginPull, client.movePull, client.endPull, client.releasePose]) call.mockClear();
    client.beginPull.mockImplementation(async () => ({ outcome: 'pulling' }));
    client.movePull.mockImplementation(async () => true);
  });

  async function mountLoaded(fold: FoldDocument) {
    await act(async () => root?.render(<CpuProbe fold={fold} />));
    await settleLoads();
  }

  it('starts a pull on the model it holds, quoting its session, and says how the press went', async () => {
    await mountLoaded(FOLD);
    const drawn = { camera: {} as never, perspective: false };
    let outcome: unknown;
    await act(async () => {
      outcome = await live!.beginPull(at(1), live!.model!, drawn);
    });
    expect(client.beginPull).toHaveBeenCalledWith(at(1), drawn, 1);
    expect(outcome).toBe('pulling');
  });

  it('asks nothing for a press read against a model it no longer holds', async () => {
    await mountLoaded(FOLD);
    const stale = live!.model!;
    await mountLoaded({ ...FOLD } as FoldDocument);
    let outcome: unknown = 'unset';
    await act(async () => {
      outcome = await live!.beginPull(at(1), stale);
    });
    expect(outcome).toBeNull();
    expect(client.beginPull).not.toHaveBeenCalled();
  });

  it('keeps one move in flight and sends the newest once the worker answers', async () => {
    await mountLoaded(FOLD);
    const answers: Array<() => void> = [];
    client.movePull.mockImplementation(
      () => new Promise<boolean>((resolve) => answers.push(() => resolve(true)))
    );
    await act(async () => {
      await live!.beginPull(at(1), live!.model!);
      for (const x of [2, 3, 4]) live!.movePull(at(x));
    });
    expect(client.movePull.mock.calls.map((call) => call[0].x)).toEqual([2]);

    await act(async () => {
      answers.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(client.movePull.mock.calls.map((call) => call[0].x)).toEqual([2, 4]);
  });

  it('sends no moves after a refused press or once the pull has ended', async () => {
    await mountLoaded(FOLD);
    client.beginPull.mockImplementation(async () => ({ outcome: 'no-pins' }));
    await act(async () => {
      expect(await live!.beginPull(at(1), live!.model!)).toBe('no-pins');
      live!.movePull(at(2));
    });
    expect(client.movePull).not.toHaveBeenCalled();

    client.beginPull.mockImplementation(async () => ({ outcome: 'pulling' }));
    await act(async () => {
      await live!.beginPull(at(1), live!.model!);
      await live!.endPull('keep', live!.model!);
      live!.movePull(at(3));
    });
    expect(client.movePull).not.toHaveBeenCalled();
  });

  it('lets go of nothing for a pull pressed on a model it no longer holds', async () => {
    await mountLoaded(FOLD);
    const stale = live!.model!;
    await act(async () => {
      await live!.beginPull(at(1), stale);
    });
    await mountLoaded({ ...FOLD } as FoldDocument);
    let ended: unknown = 'unset';
    await act(async () => {
      ended = await live!.endPull('keep', stale);
      live!.movePull(at(2));
    });
    // The pull went with the session it was made in; the new one has none.
    expect(ended).toBeNull();
    expect(client.endPull).not.toHaveBeenCalled();
    expect(client.movePull).not.toHaveBeenCalled();
  });

  it('lets go and lets a pose spring back, quoting the session', async () => {
    await mountLoaded(FOLD);
    let ended: unknown;
    let released: unknown;
    await act(async () => {
      await live!.beginPull(at(1), live!.model!);
      ended = await live!.endPull('keep', live!.model!);
      released = await live!.releasePose();
    });
    expect(client.endPull).toHaveBeenCalledWith('keep', 1);
    expect(ended).toEqual({ movedCreases: 3 });
    expect(client.releasePose).toHaveBeenCalledWith(1);
    expect(released).toBe(true);
  });
});
