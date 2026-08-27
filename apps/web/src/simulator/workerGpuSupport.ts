import { useEffect, useSyncExternalStore } from 'react';
import {
  releaseSimulatorClient,
  retainSimulatorClient,
} from '../store/workspaceStore/simulatorRuntime';

/**
 * Whether the simulator worker can render on the GPU — the one predicate every
 * surface that commits a canvas has to consult first.
 *
 * Three surfaces take an *exclusive and irreversible* context on their visible
 * canvas before a frame exists: the Simulate panel transfers it
 * (`transferControlToOffscreen`), and inline simulation and folded 3D windows
 * take a `bitmaprenderer` context. Each has a correct fallback for a machine
 * without GPU rendering — canvas-2D, an explanatory badge, 2D reprojection — but
 * a fallback is unreachable once the canvas is committed: `getContext('2d')`
 * throws `InvalidStateError` on a transferred canvas and returns null on a
 * `bitmaprenderer` one.
 *
 * They used to arm those fallbacks with `webglRenderSupported()`, which probes
 * the **main thread**. That is a different question, and on WebKitGTK (every
 * Linux desktop build) it has a different answer: main-thread WebGL2 works while
 * the worker's OffscreenCanvas has no WebGL2 at all. So the fallbacks never
 * fired on the one platform that needed them, and the Simulate tab failed with a
 * bare `InvalidStateError` while inline windows rendered blank.
 *
 * The answer cannot change within a session, so it is probed once and cached.
 */

let cached: boolean | null = null;
let inFlight: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function publish(value: boolean): boolean {
  if (cached === value) return value;
  cached = value;
  for (const listener of listeners) listener();
  return value;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The cached answer, or null while it is still unknown. */
export function workerGpuSupport(): boolean | null {
  return cached;
}

/**
 * Probe the worker once and cache the result.
 *
 * Holds its own reference to the worker for exactly the duration of the probe,
 * rather than borrowing a caller's. A caller-scoped reference would be released
 * when that caller unmounted, and if that happened mid-probe the worker would be
 * terminated under an outstanding comlink call — which never rejects, so the
 * cached promise would stay pending for the life of the page and every later
 * caller would await it forever.
 */
export function ensureWorkerGpuSupport(): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  inFlight = (async () => {
    let retained = false;
    try {
      const client = retainSimulatorClient();
      retained = true;
      return publish(await client.probeGpuRender());
    } catch {
      // An unreachable worker is not a GPU-capable one. Failing closed costs a
      // slower render path; failing open costs the committed canvas this whole
      // module exists to protect.
      //
      // Starting the worker is inside the try for the same reason: an
      // environment with no `Worker` at all (jsdom, SSR) has no GPU rendering
      // either, and letting that throw would surface as an unhandled error from
      // whichever effect happened to ask first.
      return publish(false);
    } finally {
      inFlight = null;
      if (retained) releaseSimulatorClient();
    }
  })();
  return inFlight;
}

/**
 * Record that the worker cannot render on the GPU, whatever the probe said.
 *
 * A load made with `preferGpu` that returns `backend: 'reference'` is the worker
 * *demonstrating* it cannot, which outranks a prediction — and covers the causes
 * a probe cannot see ahead of time, like context-cap eviction or a driver losing
 * the context between the probe and the load.
 *
 * This is also what keeps canvas recovery loop-free: the retry after a remount
 * reads a cache that is already false, so it takes the fallback instead of
 * committing a second canvas the same way.
 */
export function markWorkerGpuUnsupported(): void {
  publish(false);
}

/**
 * Subscribe to the cached answer, kicking off the probe when it is unknown.
 *
 * Returns null until the worker replies. Callers must treat that as "not yet
 * known" rather than as false: rendering the no-GPU state on null would flash an
 * explanatory badge at every user on every machine before the real answer lands.
 */
export function useWorkerGpuSupport(): boolean | null {
  const support = useSyncExternalStore(subscribe, workerGpuSupport, () => null);
  useEffect(() => {
    if (support === null) void ensureWorkerGpuSupport();
  }, [support]);
  return support;
}

/** Drop the cached answer so each test starts from an unprobed worker. */
export function resetWorkerGpuSupportForTests(): void {
  cached = null;
  inFlight = null;
  listeners.clear();
}
