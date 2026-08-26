import { beforeEach, describe, expect, it, vi } from 'vitest';

const probeGpuRender = vi.fn(async () => true);
const retain = vi.fn(() => ({ probeGpuRender }));
const release = vi.fn(() => undefined);

vi.mock('../store/workspaceStore/simulatorRuntime', () => ({
  retainSimulatorClient: retain,
  releaseSimulatorClient: release,
}));

const {
  ensureWorkerGpuSupport,
  markWorkerGpuUnsupported,
  resetWorkerGpuSupportForTests,
  workerGpuSupport,
} = await import('./workerGpuSupport');

beforeEach(() => {
  resetWorkerGpuSupportForTests();
  probeGpuRender.mockClear();
  probeGpuRender.mockImplementation(async () => true);
  retain.mockClear();
  release.mockClear();
});

describe('workerGpuSupport', () => {
  it('is unknown until the worker has answered', async () => {
    // Not false. Every consumer commits a canvas on this answer, and rendering
    // the no-GPU state on "not yet" would show the fallback to everyone for the
    // length of a round trip.
    expect(workerGpuSupport()).toBeNull();
    await ensureWorkerGpuSupport();
    expect(workerGpuSupport()).toBe(true);
  });

  it('asks the worker once however many callers want the answer', async () => {
    const [a, b, c] = await Promise.all([
      ensureWorkerGpuSupport(),
      ensureWorkerGpuSupport(),
      ensureWorkerGpuSupport(),
    ]);

    expect([a, b, c]).toEqual([true, true, true]);
    expect(probeGpuRender).toHaveBeenCalledTimes(1);
    // And a later caller reads the cache rather than the worker.
    await ensureWorkerGpuSupport();
    expect(probeGpuRender).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the worker cannot answer', async () => {
    probeGpuRender.mockImplementation(async () => {
      throw new Error('worker terminated');
    });

    await expect(ensureWorkerGpuSupport()).resolves.toBe(false);
    expect(workerGpuSupport()).toBe(false);
  });

  it('holds a worker reference for exactly the probe', async () => {
    // Borrowing a caller's reference would let that caller unmount mid-probe and
    // terminate the worker under an outstanding comlink call, which never
    // rejects — so the cached promise would stay pending for the life of the
    // page and every later caller would await it forever.
    await ensureWorkerGpuSupport();

    expect(retain).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('lets a demonstrated failure overrule a successful probe', async () => {
    await ensureWorkerGpuSupport();
    expect(workerGpuSupport()).toBe(true);

    // A load made with preferGpu that lands on the reference solver anyway: the
    // worker has shown it cannot render, whatever it predicted a moment ago.
    markWorkerGpuUnsupported();

    expect(workerGpuSupport()).toBe(false);
    // The overrule sticks, so the retry after a canvas remount cannot commit a
    // second canvas the same way and loop.
    await expect(ensureWorkerGpuSupport()).resolves.toBe(false);
    expect(probeGpuRender).toHaveBeenCalledTimes(1);
  });
});
