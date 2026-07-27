import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module holds process-wide state, so each case gets a fresh copy.
async function freshRuntime() {
  vi.resetModules();
  return import('./simulatorRuntime');
}

class FakeWorker {
  static instances: FakeWorker[] = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  terminate() {
    this.terminated = true;
  }
  addEventListener() {}
  removeEventListener() {}
  postMessage() {}
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('simulator worker lifetime', () => {
  it('starts one worker however many consumers retain it', async () => {
    const runtime = await freshRuntime();
    const first = runtime.retainSimulatorClient();
    const second = runtime.retainSimulatorClient();

    expect(FakeWorker.instances).toHaveLength(1);
    expect(second).toBe(first);
    expect(runtime.simulatorClientRefCount()).toBe(2);
  });

  it('keeps the worker alive until the last consumer lets go', async () => {
    const runtime = await freshRuntime();
    runtime.retainSimulatorClient();
    runtime.retainSimulatorClient();

    runtime.releaseSimulatorClient();
    // This is the case a single-owner teardown gets wrong: the Simulate panel
    // unmounting must not kill a worker an inline window is still driving.
    expect(FakeWorker.instances[0]?.terminated).toBe(false);

    runtime.releaseSimulatorClient();
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
    expect(runtime.simulatorClientRefCount()).toBe(0);
  });

  it('starts a new worker after the previous one was released', async () => {
    const runtime = await freshRuntime();
    runtime.retainSimulatorClient();
    runtime.releaseSimulatorClient();
    runtime.retainSimulatorClient();

    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[1]?.terminated).toBe(false);
  });

  it('does not go negative when released more often than retained', async () => {
    const runtime = await freshRuntime();
    runtime.retainSimulatorClient();
    runtime.releaseSimulatorClient();
    runtime.releaseSimulatorClient();

    expect(runtime.simulatorClientRefCount()).toBe(0);
    // A stray release must not leave the count below zero, or the next retain
    // would hand out a client while believing nobody holds it.
    runtime.retainSimulatorClient();
    expect(runtime.simulatorClientRefCount()).toBe(1);
  });

  it('peeks without starting a worker', async () => {
    const runtime = await freshRuntime();
    expect(runtime.peekSimulatorClient()).toBeNull();
    expect(FakeWorker.instances).toHaveLength(0);

    const client = runtime.retainSimulatorClient();
    expect(runtime.peekSimulatorClient()).toBe(client);

    runtime.releaseSimulatorClient();
    expect(runtime.peekSimulatorClient()).toBeNull();
  });
});
