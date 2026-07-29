import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoldDocument } from '@treemaker/origami-simulator';

/**
 * The worker, as far as the hook can tell. `load` resolves only when the test
 * says so, which is what lets a mount be torn down mid-load — the case that
 * leaked.
 */
const released: number[] = [];
let nextToken = 0;
let pendingLoads: Array<() => void> = [];

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
  tick: vi.fn(async () => null),
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
  vertices_coords: [[0, 0], [1, 0], [0, 1]],
  edges_vertices: [[0, 1], [1, 2], [2, 0]],
  edges_assignment: ['B', 'B', 'B'],
  faces_vertices: [[0, 1, 2]],
} as unknown as FoldDocument;

function Probe({ fold }: { fold: FoldDocument | null }) {
  useSimulatorRuntime({
    fold,
    solverOptions: {},
    triangulate: false,
    canvas: null,
    bitmapOutput: null,
    paused: true,
  });
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
