/**
 * The detect worker's lifetime, and the hang it used to guarantee.
 *
 * Before this, `attachWorkerDiagnostics` was called here without the `observe`
 * callback every other engine passes, and `releaseCpDetectClient` was called by
 * nothing. So a worker that died stayed memoized: `getCpDetectClient()` kept
 * handing back the corpse, and because a comlink proxy settles only when the
 * worker answers, every call on it hung forever rather than throwing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module holds process-wide state, so each case gets a fresh copy.
async function freshRuntime() {
  vi.resetModules();
  return import('./cpDetectRuntime');
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

describe('cp-detect worker lifetime', () => {
  it('memoizes one client across callers', async () => {
    const runtime = await freshRuntime();
    const first = await runtime.getCpDetectClient();
    const second = await runtime.getCpDetectClient();

    expect(second).toBe(first);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('drops a dead client so the next call spawns a replacement', async () => {
    const runtime = await freshRuntime();
    const dead = await runtime.getCpDetectClient();
    FakeWorker.instances[0].dispatchEvent(new Event('error'));

    expect(runtime.isCpDetectClientConnected()).toBe(false);
    const replacement = await runtime.getCpDetectClient();
    expect(replacement).not.toBe(dead);
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it('terminates the crashed worker rather than leaving it beside its replacement', async () => {
    // An `error` event does not prove the worker is gone, and this one holds a
    // compiled ONNX session over a 43 MiB model — two of those in memory is the
    // failure mode that makes this worker different from the others.
    const runtime = await freshRuntime();
    await runtime.getCpDetectClient();
    FakeWorker.instances[0].dispatchEvent(new Event('error'));

    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  it('announces the loss, so a call already in flight can stop waiting', async () => {
    // Dropping the client only fixes the *next* call. comlink cannot know the
    // other end is gone, so without this signal the solve in progress keeps its
    // spinner forever.
    const runtime = await freshRuntime();
    const lost = vi.fn();
    runtime.onCpDetectClientLost(lost);
    await runtime.getCpDetectClient();
    FakeWorker.instances[0].dispatchEvent(new Event('error'));

    expect(lost).toHaveBeenCalledOnce();
    expect(lost.mock.calls[0][0]).toMatchObject({
      failure: { worker: 'cp-detect', kind: 'error' },
    });
  });

  it('announces a deliberate release the same way, with no failure', async () => {
    // A caller waiting on a request should not have to tell "the worker died"
    // from "we killed it" to know its answer is never coming.
    const runtime = await freshRuntime();
    const lost = vi.fn();
    runtime.onCpDetectClientLost(lost);
    await runtime.getCpDetectClient();
    runtime.releaseCpDetectClient();

    expect(FakeWorker.instances[0].terminated).toBe(true);
    expect(lost).toHaveBeenCalledOnce();
    expect(lost.mock.calls[0][0]).toEqual({});
    expect(runtime.isCpDetectClientConnected()).toBe(false);
  });

  it('releasing when nothing is live is a no-op', async () => {
    const runtime = await freshRuntime();
    const lost = vi.fn();
    runtime.onCpDetectClientLost(lost);
    runtime.releaseCpDetectClient();

    expect(lost).not.toHaveBeenCalled();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('a failure from a replaced worker does not drop the replacement', async () => {
    const runtime = await freshRuntime();
    await runtime.getCpDetectClient();
    runtime.releaseCpDetectClient();
    const replacement = await runtime.getCpDetectClient();

    // The old worker's listeners were detached on release; dispatching anyway is
    // the belt to that braces, because the identity guard is what makes a late
    // event from a dead worker harmless.
    FakeWorker.instances[0].dispatchEvent(new Event('error'));

    expect(runtime.isCpDetectClientConnected()).toBe(true);
    expect(await runtime.getCpDetectClient()).toBe(replacement);
  });

  it('an unsubscribed listener stops hearing about losses', async () => {
    const runtime = await freshRuntime();
    const lost = vi.fn();
    runtime.onCpDetectClientLost(lost)();
    await runtime.getCpDetectClient();
    runtime.releaseCpDetectClient();

    expect(lost).not.toHaveBeenCalled();
  });

  it('a listener that throws does not stop the others', async () => {
    const runtime = await freshRuntime();
    const second = vi.fn();
    runtime.onCpDetectClientLost(() => {
      throw new Error('listener blew up');
    });
    runtime.onCpDetectClientLost(second);
    await runtime.getCpDetectClient();
    runtime.releaseCpDetectClient();

    expect(second).toHaveBeenCalledOnce();
  });
});
