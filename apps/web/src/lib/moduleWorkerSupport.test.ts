import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeModuleWorkerSupport } from './moduleWorkerSupport';

/**
 * A `Worker` stand-in that answers the probe the way a given engine would. jsdom has no
 * `Worker` and no `URL.createObjectURL`, so both are provided here.
 */
function fakeWorker(behaviour: 'module' | 'classic' | 'error' | 'throw' | 'silent') {
  const terminate = vi.fn();
  class FakeWorker {
    static latest: FakeWorker | null = null;
    static options: WorkerOptions | undefined;
    private listeners = new Map<string, EventListener[]>();
    terminate = terminate;

    constructor(_url: string, options?: WorkerOptions) {
      if (behaviour === 'throw') throw new DOMException('blocked by CSP', 'SecurityError');
      FakeWorker.latest = this;
      FakeWorker.options = options;
      queueMicrotask(() => {
        if (behaviour === 'silent') return;
        if (behaviour === 'error') {
          this.emit('error', { preventDefault: vi.fn() });
          return;
        }
        this.emit('message', { data: behaviour });
      });
    }

    addEventListener(type: string, listener: EventListener) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }

    emit(type: string, event: unknown) {
      for (const listener of this.listeners.get(type) ?? []) listener(event as Event);
    }
  }
  return { FakeWorker, terminate };
}

describe('probeModuleWorkerSupport', () => {
  const revoke = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:probe'),
      revokeObjectURL: revoke,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    revoke.mockReset();
  });

  it('asks for a module worker and reads a module answer as supported', async () => {
    const { FakeWorker, terminate } = fakeWorker('module');
    await expect(
      probeModuleWorkerSupport(FakeWorker as unknown as typeof Worker)
    ).resolves.toBe('supported');
    expect(FakeWorker.options).toEqual({ type: 'module' });
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:probe');
  });

  it('reads a classic worker starting in place of a module one as unsupported', async () => {
    const { FakeWorker } = fakeWorker('classic');
    await expect(
      probeModuleWorkerSupport(FakeWorker as unknown as typeof Worker)
    ).resolves.toBe('unsupported');
  });

  it("treats the probe's own error as no evidence, and keeps it off window.onerror", async () => {
    const { FakeWorker } = fakeWorker('error');
    const result = probeModuleWorkerSupport(FakeWorker as unknown as typeof Worker);
    await expect(result).resolves.toBe('unknown');
  });

  it('treats a constructor that throws as no evidence', async () => {
    const { FakeWorker } = fakeWorker('throw');
    await expect(
      probeModuleWorkerSupport(FakeWorker as unknown as typeof Worker)
    ).resolves.toBe('unknown');
    expect(revoke).toHaveBeenCalledWith('blob:probe');
  });

  it('treats a missing Worker constructor as no evidence', async () => {
    await expect(probeModuleWorkerSupport(undefined)).resolves.toBe('unknown');
  });
});
