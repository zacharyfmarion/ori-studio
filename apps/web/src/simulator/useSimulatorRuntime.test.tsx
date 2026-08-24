import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoldDocument } from '@treemaker/origami-simulator';
import type { SimulatorBackendId, SimulatorFramePayload } from './simulatorSession';

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
    maxVelocity: 0,
    foldPercent: 0,
    maxStrain: 0,
  };
}

const client = {
  load: vi.fn(async () => {
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
  }),
  release: vi.fn(async (token: number) => {
    released.push(token);
  }),
  settle: vi.fn(async () => null),
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
};

vi.mock('../store/workspaceStore/simulatorRuntime', () => ({
  retainSimulatorClient: () => client,
  releaseSimulatorClient: () => undefined,
}));

vi.mock('./renderModel', () => ({
  inflateRenderModel: () => ({ positions: null, indices: new Int32Array(0) }),
}));

const { useSimulatorRuntime } = await import('./useSimulatorRuntime');

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
  client.load.mockClear();
  client.release.mockClear();
  // Restored, not just cleared: the eviction tests replace this with `null` and
  // nothing put it back, so the override outlived the test that set it.
  client.tick.mockReset();
  client.tick.mockImplementation(async () => liveFrame());
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
