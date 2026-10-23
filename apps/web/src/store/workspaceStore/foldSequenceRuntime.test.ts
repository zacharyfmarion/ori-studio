/**
 * The Fold engine worker's lifetime and the preview channel, against a fake
 * Worker.
 *
 * `terminate()` does not settle comlink's outstanding promises, so a caller
 * awaiting one when the worker goes away waits forever; the runtime turns
 * that into a rejection (`precreaseRuntime`'s contract). Stopping work is a
 * terminate, so it must reject the same way, and move the generation so no
 * handle of the stopped worker reaches the next one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const monitoring = vi.hoisted(() => ({ reportError: vi.fn() }));

vi.mock('../../monitoring', () => ({ reportError: monitoring.reportError }));

async function freshRuntime() {
  vi.resetModules();
  return import('./foldSequenceRuntime');
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
  monitoring.reportError.mockClear();
  vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A promise and its settlers, for an answer the test gives by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let every queued promise reaction run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('fold engine client lifetime', () => {
  it('rejects a guarded call when the last reference is released', async () => {
    const runtime = await freshRuntime();
    runtime.retainFoldSequenceClient();
    // comlink never answers a fake worker: this is the orphaned promise.
    const guarded = runtime
      .whileFoldSequenceClientAlive(new Promise<string>(() => {}))
      .catch((e: unknown) => e);

    runtime.releaseFoldSequenceClient();

    await expect(guarded).resolves.toMatchObject({ code: 'fold_sequence_client_lost' });
    expect(FakeWorker.instances[0].terminated).toBe(true);
    expect(runtime.foldSequenceClientGeneration()).toBe(1);
  });

  it('rejects a guarded call when the worker dies, and respawns on the next request', async () => {
    const runtime = await freshRuntime();
    runtime.retainFoldSequenceClient();
    const guarded = runtime
      .whileFoldSequenceClientAlive(new Promise<string>(() => {}))
      .catch((e: unknown) => e);

    FakeWorker.instances[0].dispatchEvent(new Event('error'));

    await expect(guarded).resolves.toMatchObject({
      code: 'fold_sequence_client_lost',
      message: 'The fold engine stopped while it was running.',
    });
    expect(runtime.peekFoldSequenceClient()).toBeNull();
    expect(runtime.foldSequenceClientGeneration()).toBe(1);
    runtime.getFoldSequenceClient();
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it('stops work by terminating, then spawns a fresh worker for the next request', async () => {
    const runtime = await freshRuntime();
    runtime.retainFoldSequenceClient();
    const reasons: string[] = [];
    runtime.onFoldSequenceClientLost((reason) => reasons.push(reason));
    const guarded = runtime
      .whileFoldSequenceClientAlive(new Promise<string>(() => {}))
      .catch((e: unknown) => e);

    expect(runtime.stopFoldSequenceWork()).toBe(true);

    await expect(guarded).resolves.toMatchObject({
      code: 'fold_sequence_client_lost',
      message: 'The fold engine was stopped while it was running.',
    });
    expect(reasons).toEqual(['stopped']);
    expect(FakeWorker.instances[0].terminated).toBe(true);
    // The holder still holds it: the next request spawns, in a new generation.
    expect(runtime.foldSequenceClientRefCount()).toBe(1);
    expect(runtime.foldSequenceClientGeneration()).toBe(1);
    runtime.getFoldSequenceClient();
    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[1].terminated).toBe(false);
    // Nothing running: nothing to stop, and the generation stays.
    runtime.releaseFoldSequenceClient();
    expect(runtime.stopFoldSequenceWork()).toBe(false);
    expect(runtime.foldSequenceClientGeneration()).toBe(2);
  });

  it('does not disturb a guarded call while another holder keeps the worker', async () => {
    const runtime = await freshRuntime();
    runtime.retainFoldSequenceClient();
    runtime.retainFoldSequenceClient();
    let settled: unknown = 'pending';
    void runtime
      .whileFoldSequenceClientAlive(new Promise<string>(() => {}))
      .catch((e: unknown) => {
        settled = e;
      });

    runtime.releaseFoldSequenceClient();
    await Promise.resolve();

    expect(runtime.foldSequenceClientRefCount()).toBe(1);
    expect(FakeWorker.instances[0].terminated).toBe(false);
    expect(settled).toBe('pending');
    expect(runtime.foldSequenceClientGeneration()).toBe(0);
  });

  it('asking without a reference rejects rather than throws', async () => {
    const runtime = await freshRuntime();
    await expect(runtime.askFoldSequenceClient(async () => 1)).rejects.toThrow(/retain/);
    await expect(runtime.foldSequenceEngineSource.release([3])).rejects.toThrow(/retain/);
  });

  it('reports nothing for a release or a stop', async () => {
    const runtime = await freshRuntime();
    runtime.retainFoldSequenceClient();
    runtime.stopFoldSequenceWork();
    runtime.getFoldSequenceClient();
    runtime.releaseFoldSequenceClient();
    expect(monitoring.reportError).not.toHaveBeenCalled();
  });
});

describe('a fold engine that crashed', () => {
  /** What the worker answers once its engine trapped (`fold/engine/foldEngineTrap.ts`). */
  const TRAPPED = {
    code: 'fold_engine_trapped',
    trap: 'wasm_trap',
    message: 'unreachable',
    stack: 'RuntimeError: unreachable\n    at wasm://wasm/0a1b2c3d:wasm-function[812]:0x5f1e2',
  } as const;

  it('drops the worker whose engine trapped, rejects every call on it as its loss, and reports the crash once', async () => {
    const runtime = await freshRuntime();
    runtime.retainFoldSequenceClient();
    const heard: unknown[][] = [];
    runtime.onFoldSequenceClientLost((...args) => heard.push(args));
    // Another call to the same worker, whose answer comes after the trap.
    const late = deferred<number>();
    const other = runtime.askFoldSequenceClient(() => late.promise).catch((e: unknown) => e);

    const trapped = runtime.askFoldSequenceClient(() => Promise.reject({ ...TRAPPED })).catch((e: unknown) => e);

    await expect(trapped).resolves.toEqual({
      code: 'fold_sequence_client_lost',
      message: 'The fold engine stopped while it was running.',
    });
    await expect(other).resolves.toMatchObject({ code: 'fold_sequence_client_lost' });
    expect(FakeWorker.instances[0].terminated).toBe(true);
    expect(runtime.peekFoldSequenceClient()).toBeNull();
    expect(runtime.foldSequenceClientGeneration()).toBe(1);
    expect(heard).toEqual([['crashed', 'wasm_trap']]);

    expect(monitoring.reportError).toHaveBeenCalledTimes(1);
    const [error, context] = monitoring.reportError.mock.calls[0]!;
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'FoldEngineCrash', message: 'wasm_trap: unreachable', stack: TRAPPED.stack });
    expect(context).toEqual({ surface: 'fold:engine', tags: { reason: 'wasm_trap' } });

    // The next request spawns a fresh worker; the dead one's late trap drops nothing more.
    runtime.getFoldSequenceClient();
    late.reject({ ...TRAPPED });
    await settle();
    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[1].terminated).toBe(false);
    expect(runtime.foldSequenceClientGeneration()).toBe(1);
    expect(monitoring.reportError).toHaveBeenCalledTimes(1);
    expect(heard).toHaveLength(1);
  });

  it('reports a worker that died by itself as a worker_error crash', async () => {
    const runtime = await freshRuntime();
    runtime.retainFoldSequenceClient();
    const heard: unknown[][] = [];
    runtime.onFoldSequenceClientLost((...args) => heard.push(args));

    FakeWorker.instances[0].dispatchEvent(new Event('error'));

    expect(heard).toEqual([['crashed', 'worker_error']]);
    expect(monitoring.reportError).toHaveBeenCalledTimes(1);
    expect(monitoring.reportError.mock.calls[0]![0]).toMatchObject({
      name: 'FoldEngineCrash',
      message: 'worker_error: The worker stopped unexpectedly.',
    });
    expect(monitoring.reportError.mock.calls[0]![1]).toEqual({ surface: 'fold:engine', tags: { reason: 'worker_error' } });
  });

  it('passes an engine’s own error through, keeping the worker', async () => {
    const runtime = await freshRuntime();
    runtime.retainFoldSequenceClient();
    const unknownState = { code: 'unknown_state', message: 'no state 4' };
    await expect(runtime.askFoldSequenceClient(() => Promise.reject(unknownState))).rejects.toBe(unknownState);
    expect(FakeWorker.instances[0].terminated).toBe(false);
    expect(runtime.foldSequenceClientGeneration()).toBe(0);
    expect(monitoring.reportError).not.toHaveBeenCalled();
  });
});

describe('the preview channel: latest request wins', () => {
  it('answers a lone request', async () => {
    const runtime = await freshRuntime();
    runtime.retainFoldSequenceClient();
    const channel = runtime.createFoldPreviewChannel();
    await expect(channel.request(async () => 7)).resolves.toEqual({ status: 'answered', value: 7 });
  });

  it('keeps one request in flight and the newest waiting; everything between is superseded', async () => {
    const runtime = await freshRuntime();
    runtime.retainFoldSequenceClient();
    const channel = runtime.createFoldPreviewChannel();
    const first = deferred<string>();
    const asked: string[] = [];
    const discarded: string[] = [];
    const ask = (name: string, answer: Promise<string>) => () => {
      asked.push(name);
      return answer;
    };

    const a = channel.request(ask('a', first.promise), (value) => discarded.push(value));
    const b = channel.request(ask('b', Promise.resolve('b')));
    const c = channel.request(ask('c', Promise.resolve('c')));

    // B was replaced while waiting: it never reached the worker.
    await expect(b).resolves.toEqual({ status: 'superseded' });
    expect(asked).toEqual(['a']);

    // A's answer comes back stale: discarded (its handle released), and C goes.
    first.resolve('landed a');
    await expect(a).resolves.toEqual({ status: 'superseded' });
    expect(discarded).toEqual(['landed a']);
    await expect(c).resolves.toEqual({ status: 'answered', value: 'c' });
    expect(asked).toEqual(['a', 'c']);
  });

  it('cancel supersedes what is in flight and what waits', async () => {
    const runtime = await freshRuntime();
    runtime.retainFoldSequenceClient();
    const channel = runtime.createFoldPreviewChannel();
    const first = deferred<number>();
    const discarded: number[] = [];
    const a = channel.request(() => first.promise, (value) => discarded.push(value));
    const b = channel.request(async () => 2);

    channel.cancel();
    await expect(b).resolves.toEqual({ status: 'superseded' });
    first.resolve(1);
    await expect(a).resolves.toEqual({ status: 'superseded' });
    expect(discarded).toEqual([1]);
    // The channel is free again.
    await expect(channel.request(async () => 3)).resolves.toEqual({ status: 'answered', value: 3 });
  });

  it('rejects only while still the newest request', async () => {
    const runtime = await freshRuntime();
    runtime.retainFoldSequenceClient();
    const channel = runtime.createFoldPreviewChannel();
    const boom = { code: 'invalid_input', message: 'no' };
    await expect(channel.request(() => Promise.reject(boom))).rejects.toBe(boom);

    const stale = deferred<number>();
    const a = channel.request(() => stale.promise);
    const b = channel.request(async () => 2);
    stale.reject(boom);
    await expect(a).resolves.toEqual({ status: 'superseded' });
    await expect(b).resolves.toEqual({ status: 'answered', value: 2 });
  });

  it('rejects the newest request when the worker is stopped under it', async () => {
    const runtime = await freshRuntime();
    runtime.retainFoldSequenceClient();
    const channel = runtime.createFoldPreviewChannel();
    const pending = channel.request(() => new Promise<number>(() => {})).catch((e: unknown) => e);
    await settle();
    runtime.stopFoldSequenceWork();
    await expect(pending).resolves.toMatchObject({ code: 'fold_sequence_client_lost' });
    // And the next request asks a fresh worker.
    await expect(channel.request(async () => 5)).resolves.toEqual({ status: 'answered', value: 5 });
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it('two channels never supersede each other', async () => {
    const runtime = await freshRuntime();
    runtime.retainFoldSequenceClient();
    const fold = runtime.createFoldPreviewChannel();
    const analysis = runtime.createFoldPreviewChannel();
    const a = fold.request(async () => 'fold');
    const b = analysis.request(async () => 'analysis');
    await expect(a).resolves.toEqual({ status: 'answered', value: 'fold' });
    await expect(b).resolves.toEqual({ status: 'answered', value: 'analysis' });
  });
});
