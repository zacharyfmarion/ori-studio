import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachWorkerDiagnostics,
  registerWorkerFailureSink,
  workerErrorCode,
  type WorkerFailure,
} from './workerDiagnostics';

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
      },
    ]);
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
