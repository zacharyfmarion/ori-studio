import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoldDocument } from '@treemaker/origami-simulator';
import type { SimulatorFramePayload } from './simulatorSession';

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
      backend: 'reference' as const,
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
  setCamera: vi.fn(async () => undefined),
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
  vertices_coords: [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
  edges_vertices: [
    [0, 1],
    [1, 2],
    [2, 0],
  ],
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
