/**
 * The precrease worker's lifetime, against a fake Worker.
 *
 * `terminate()` does not settle comlink's outstanding promises, so a caller
 * awaiting one when the worker goes away waits forever. The runtime has to turn
 * that into a rejection on its own — the same contract `referenceFinderRuntime`
 * already has, and the reason the References run could latch on "running".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function freshRuntime() {
  vi.resetModules();
  return import('./precreaseRuntime');
}

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  terminated = false;
  constructor() {
    super();
    FakeWorker.instances.push(this);
  }
  terminate() {
    this.terminated = true;
  }
  postMessage() {}
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('precrease client lifetime', () => {
  it('rejects a guarded call when the last reference is released', async () => {
    const runtime = await freshRuntime();
    runtime.retainPrecreaseClient();
    // comlink never answers a fake worker: this is the orphaned promise.
    const guarded = runtime
      .whilePrecreaseClientAlive(new Promise<string>(() => {}))
      .catch((e: unknown) => e);

    runtime.releasePrecreaseClient();

    await expect(guarded).resolves.toMatchObject({ code: 'precrease_client_lost' });
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  it('rejects a guarded call when the worker dies', async () => {
    const runtime = await freshRuntime();
    runtime.retainPrecreaseClient();
    const guarded = runtime
      .whilePrecreaseClientAlive(new Promise<string>(() => {}))
      .catch((e: unknown) => e);

    FakeWorker.instances[0].dispatchEvent(new Event('error'));

    await expect(guarded).resolves.toMatchObject({
      code: 'precrease_client_lost',
      message: 'The precrease planner stopped while it was running.',
    });
    expect(runtime.peekPrecreaseClient()).toBeNull();
  });

  it('does not disturb a guarded call while another holder keeps the worker', async () => {
    const runtime = await freshRuntime();
    runtime.retainPrecreaseClient();
    runtime.retainPrecreaseClient();
    let settled: unknown = 'pending';
    void runtime
      .whilePrecreaseClientAlive(new Promise<string>(() => {}))
      .catch((e: unknown) => {
        settled = e;
      });

    runtime.releasePrecreaseClient();
    await Promise.resolve();

    expect(runtime.precreaseClientRefCount()).toBe(1);
    expect(FakeWorker.instances[0].terminated).toBe(false);
    expect(settled).toBe('pending');
  });

  it('settles normally when the call answers first', async () => {
    const runtime = await freshRuntime();
    runtime.retainPrecreaseClient();
    await expect(runtime.whilePrecreaseClientAlive(Promise.resolve(7))).resolves.toBe(7);
    // The listener is dropped, so a later release cannot reject anything.
    runtime.releasePrecreaseClient();
    expect(runtime.peekPrecreaseClient()).toBeNull();
  });
});
