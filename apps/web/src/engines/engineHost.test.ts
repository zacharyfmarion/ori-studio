import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachWorkerDiagnostics, registerWorkerFailureSink } from '../lib/workerDiagnostics';

/**
 * The host's own worker plumbing is not unit-testable without a bundler-emitted
 * worker, so what is asserted here is the contract it depends on:
 * `attachWorkerDiagnostics` must deliver a failure to the owning module *and* to
 * the app's reporting sink, independently.
 *
 * That independence is the whole reason the host can drop a dead client without
 * displacing the error toast — before this, one global sink was the only channel.
 */

class FakeWorker extends EventTarget {
  terminated = false;
  terminate() {
    this.terminated = true;
  }
}

const fakeWorker = () => new FakeWorker() as unknown as Worker;

afterEach(() => {
  registerWorkerFailureSink(null);
  vi.restoreAllMocks();
});

describe('worker failure fan-out', () => {
  it('notifies the owner and the app sink from one failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const owner = vi.fn();
    const app = vi.fn();
    registerWorkerFailureSink(app);

    const worker = fakeWorker();
    attachWorkerDiagnostics(worker, 'treemaker', owner);
    worker.dispatchEvent(new Event('error'));

    expect(owner).toHaveBeenCalledOnce();
    expect(app).toHaveBeenCalledOnce();
    expect(owner.mock.calls[0][0]).toMatchObject({ worker: 'treemaker', kind: 'error' });
  });

  it('still reports to the app when the owner throws', () => {
    // The owner dropping its client must never stop the user being told the
    // engine died — that was the whole point of the existing sink.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = vi.fn();
    registerWorkerFailureSink(app);

    const worker = fakeWorker();
    attachWorkerDiagnostics(worker, 'oristudio-bp', () => {
      throw new Error('owner blew up');
    });
    worker.dispatchEvent(new Event('error'));

    expect(app).toHaveBeenCalledOnce();
  });

  it('stops notifying once detached', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const owner = vi.fn();
    const worker = fakeWorker();
    const detach = attachWorkerDiagnostics(worker, 'oristudio-cp', owner);

    detach();
    worker.dispatchEvent(new Event('error'));

    // A replacement worker's listeners must be the only live ones.
    expect(owner).not.toHaveBeenCalled();
  });

  it('reports a messageerror distinctly from a dead worker', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const owner = vi.fn();
    const worker = fakeWorker();
    attachWorkerDiagnostics(worker, 'treemaker', owner);

    worker.dispatchEvent(new Event('messageerror'));
    expect(owner.mock.calls[0][0]).toMatchObject({ kind: 'messageerror' });
  });
});
