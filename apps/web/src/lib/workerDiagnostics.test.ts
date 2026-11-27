// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachWorkerDiagnostics,
  registerWorkerFailureSink,
  workerErrorCode,
  type WorkerFailure,
} from './workerDiagnostics';

const reporting = vi.hoisted(() => ({ reportError: vi.fn(), trackAnalyticsError: vi.fn() }));

vi.mock('../monitoring', () => ({ reportError: reporting.reportError }));
vi.mock('../analytics', () => ({ trackAnalyticsError: reporting.trackAnalyticsError }));

/** A worker as the browser's error reporting sees it: an event target whose `dispatchEvent` says whether a listener cancelled. */
class FakeWorker extends EventTarget {}

/**
 * What a browser fires at a `Worker` when the worker throws and does not catch
 * it: a cancelable `ErrorEvent` with the worker's message and where it threw,
 * and no `error` (ORI-STUDIO-1S's, from onnxruntime-web's thread glue).
 */
function thrown(filename = 'https://oristudio.test/assets/ort-wasm-simd-threaded.mjs?v=1#x') {
  return new ErrorEvent('error', {
    message: 'Uncaught [object Event]',
    filename,
    lineno: 22,
    colno: 182,
    cancelable: true,
  });
}

function fakeWorker() {
  const listeners = new Map<string, EventListener[]>();
  return {
    addEventListener(type: string, listener: EventListener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== listener));
    },
    dispatch(type: string, event: unknown) {
      for (const listener of listeners.get(type) ?? []) listener(event as Event);
    },
    count(type: string) {
      return (listeners.get(type) ?? []).length;
    },
  };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  reporting.reportError.mockClear();
  reporting.trackAnalyticsError.mockClear();
});

afterEach(() => {
  registerWorkerFailureSink(null);
  vi.restoreAllMocks();
});

describe('workerErrorCode', () => {
  it('produces the codes humanizeError translates', () => {
    expect(workerErrorCode('oristudio-cp')).toBe('worker_oristudio_cp');
    expect(workerErrorCode('oristudio-bp-optimizer')).toBe('worker_oristudio_bp_optimizer');
    expect(workerErrorCode('simulator')).toBe('worker_simulator');
  });
});

describe('attachWorkerDiagnostics', () => {
  it('reports a dead worker to the registered sink', () => {
    const failures: WorkerFailure[] = [];
    registerWorkerFailureSink((failure) => failures.push(failure));

    const worker = fakeWorker();
    attachWorkerDiagnostics(worker as unknown as Worker, 'oristudio-cp');
    worker.dispatch('error', { type: 'error' });

    expect(failures).toEqual([
      {
        worker: 'oristudio-cp',
        kind: 'error',
        message: 'The worker stopped unexpectedly.',
        loadFailed: true,
      },
    ]);
  });

  it('tells a worker that never loaded (a plain error event) from one that threw while running', () => {
    const failures: WorkerFailure[] = [];
    registerWorkerFailureSink((failure) => failures.push(failure));

    const worker = fakeWorker();
    attachWorkerDiagnostics(worker as unknown as Worker, 'layer-order');
    worker.dispatch('error', new Event('error'));
    worker.dispatch('error', new ErrorEvent('error', { message: 'Uncaught RuntimeError: unreachable' }));
    worker.dispatch('messageerror', new MessageEvent('messageerror'));

    expect(failures.map((failure) => [failure.kind, failure.loadFailed])).toEqual([
      ['error', true],
      ['error', false],
      ['messageerror', false],
    ]);
    expect(failures[1]!.message).toBe('Uncaught RuntimeError: unreachable');
  });

  it('tells the sink nothing of a failure the owner says it handled, and everything else', () => {
    const failures: WorkerFailure[] = [];
    registerWorkerFailureSink((failure) => failures.push(failure));
    const observed: WorkerFailure[] = [];

    const worker = fakeWorker();
    attachWorkerDiagnostics(worker as unknown as Worker, 'layer-order', (failure) => {
      observed.push(failure);
      return failure.loadFailed ? 'handled' : undefined;
    });
    worker.dispatch('error', new Event('error'));
    worker.dispatch('error', new ErrorEvent('error', { message: 'Uncaught RuntimeError: unreachable' }));

    expect(observed).toHaveLength(2);
    expect(failures.map((failure) => failure.message)).toEqual(['Uncaught RuntimeError: unreachable']);
    // Still in the console, for whoever is looking.
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it('distinguishes a deserialization failure from a dead worker', () => {
    const failures: WorkerFailure[] = [];
    registerWorkerFailureSink((failure) => failures.push(failure));

    const worker = fakeWorker();
    attachWorkerDiagnostics(worker as unknown as Worker, 'simulator');
    worker.dispatch('messageerror', { type: 'messageerror' });

    expect(failures[0].kind).toBe('messageerror');
    expect(failures[0].message).toContain('deserialized');
  });

  // Without a sink the app has not started yet (or has torn down); the console
  // is still better than silence.
  it('logs even with no sink registered', () => {
    const worker = fakeWorker();
    attachWorkerDiagnostics(worker as unknown as Worker, 'treemaker');

    expect(() => worker.dispatch('error', { type: 'error' })).not.toThrow();
    expect(console.error).toHaveBeenCalled();
  });

  it('does not let a throwing sink mask the failure it was reporting', () => {
    registerWorkerFailureSink(() => {
      throw new Error('sink is broken');
    });

    const worker = fakeWorker();
    attachWorkerDiagnostics(worker as unknown as Worker, 'cp-detect');

    expect(() => worker.dispatch('error', { type: 'error' })).not.toThrow();
  });

  it('detaches so a replacement worker is the only live listener', () => {
    const failures: WorkerFailure[] = [];
    registerWorkerFailureSink((failure) => failures.push(failure));

    const worker = fakeWorker();
    const detach = attachWorkerDiagnostics(worker as unknown as Worker, 'oristudio-bp');
    detach();

    expect(worker.count('error')).toBe(0);
    worker.dispatch('error', { type: 'error' });
    expect(failures).toHaveLength(0);
  });
});

// The browser reports a worker's uncaught exception again in the page, as an
// uncaught error at `window`, unless a listener at the `Worker` cancels it
// (HTML's "report an exception"; seen in Chromium and WebKit). Sentry's global
// handler and the app's own both listen there, so an uncancelled crash was
// filed a second time, or, where the owner files nothing, in place of a
// report of its own (ORI-STUDIO-1S).
describe('a worker that threw', () => {
  it('is cancelled, so the page does not report it again', () => {
    const worker = new FakeWorker();
    attachWorkerDiagnostics(worker as unknown as Worker, 'cp-detect');

    const event = thrown();
    // What the browser checks before it reports the error again at `window`.
    expect(worker.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('is reported once in its place, named for the worker and placed where it threw', () => {
    const failures: WorkerFailure[] = [];
    registerWorkerFailureSink((failure) => failures.push(failure));
    const worker = new FakeWorker();
    attachWorkerDiagnostics(worker as unknown as Worker, 'cp-detect');

    worker.dispatchEvent(thrown());

    expect(reporting.reportError).toHaveBeenCalledOnce();
    const [crash, context] = reporting.reportError.mock.calls[0]!;
    expect(crash).toBeInstanceOf(Error);
    expect(crash).toMatchObject({ name: 'WorkerCrash', worker: 'cp-detect', message: 'cp-detect: Uncaught [object Event]' });
    // The one frame the page gets, without its query or hash.
    expect((crash as Error).stack).toBe(
      'WorkerCrash: cp-detect: Uncaught [object Event]\n    at https://oristudio.test/assets/ort-wasm-simd-threaded.mjs:22:182'
    );
    expect(context).toEqual({ surface: 'worker:cp-detect' });
    // Counted as an error boundary's catch is, since the page's copy is no longer there to be.
    expect(reporting.trackAnalyticsError).toHaveBeenCalledOnce();
    expect(reporting.trackAnalyticsError).toHaveBeenCalledWith({
      error: crash,
      sourceComponent: 'worker:cp-detect',
      domain: 'runtime',
    });
    // The user is told as before.
    expect(failures).toEqual([
      { worker: 'cp-detect', kind: 'error', message: 'Uncaught [object Event]', loadFailed: false },
    ]);
  });

  it('is still reported when its owner told the user itself', () => {
    const sink = vi.fn();
    registerWorkerFailureSink(sink);
    const worker = new FakeWorker();
    attachWorkerDiagnostics(worker as unknown as Worker, 'cp-detect', () => 'handled');

    expect(worker.dispatchEvent(thrown())).toBe(false);

    expect(sink).not.toHaveBeenCalled();
    expect(reporting.reportError).toHaveBeenCalledOnce();
  });

  it('is not reported a second time for an owner that reports its own crashes', () => {
    const owner = vi.fn();
    const worker = new FakeWorker();
    attachWorkerDiagnostics(worker as unknown as Worker, 'fold-sequence', owner, { reportsCrashes: true });

    expect(worker.dispatchEvent(thrown())).toBe(false);

    expect(owner).toHaveBeenCalledOnce();
    expect(reporting.reportError).not.toHaveBeenCalled();
    expect(reporting.trackAnalyticsError).toHaveBeenCalledOnce();
  });

  it('is reported anyway when that owner threw before it could report', () => {
    const worker = new FakeWorker();
    attachWorkerDiagnostics(
      worker as unknown as Worker,
      'layer-order',
      () => {
        throw new Error('owner blew up');
      },
      { reportsCrashes: true }
    );

    expect(worker.dispatchEvent(thrown())).toBe(false);

    expect(reporting.reportError).toHaveBeenCalledOnce();
    expect(reporting.reportError.mock.calls[0]![0]).toMatchObject({ name: 'WorkerCrash', worker: 'layer-order' });
  });

  it('names the desktop shell’s scripts, and no frame for a script that is not one of ours', () => {
    const worker = new FakeWorker();
    attachWorkerDiagnostics(worker as unknown as Worker, 'simulator');

    worker.dispatchEvent(thrown('tauri://localhost/assets/simulatorWorker-3f2a.js'));
    worker.dispatchEvent(thrown('blob:https://oristudio.test/0b7c'));
    worker.dispatchEvent(thrown(''));

    expect(reporting.reportError.mock.calls.map(([crash]) => (crash as Error).stack)).toEqual([
      'WorkerCrash: simulator: Uncaught [object Event]\n    at tauri://localhost/assets/simulatorWorker-3f2a.js:22:182',
      'WorkerCrash: simulator: Uncaught [object Event]',
      'WorkerCrash: simulator: Uncaught [object Event]',
    ]);
  });

  it('is told to the sink even when reporting it fails', () => {
    reporting.reportError.mockImplementationOnce(() => {
      throw new Error('reporting is broken');
    });
    const sink = vi.fn();
    registerWorkerFailureSink(sink);
    const worker = new FakeWorker();
    attachWorkerDiagnostics(worker as unknown as Worker, 'treemaker');

    expect(() => worker.dispatchEvent(thrown())).not.toThrow();
    expect(sink).toHaveBeenCalledOnce();
  });
});

describe('a worker that never loaded, or a message it could not deserialize', () => {
  // The browser reports neither anywhere else, so there is nothing to cancel,
  // and a load failure is the network or a stale tab, which its owner decides about.
  it('is neither cancelled nor reported here', () => {
    const worker = new FakeWorker();
    attachWorkerDiagnostics(worker as unknown as Worker, 'fold-sequence');

    const unloaded = new Event('error', { cancelable: true });
    const undeserializable = new MessageEvent('messageerror', { cancelable: true });
    expect(worker.dispatchEvent(unloaded)).toBe(true);
    expect(worker.dispatchEvent(undeserializable)).toBe(true);

    expect(reporting.reportError).not.toHaveBeenCalled();
    expect(reporting.trackAnalyticsError).not.toHaveBeenCalled();
  });
});
