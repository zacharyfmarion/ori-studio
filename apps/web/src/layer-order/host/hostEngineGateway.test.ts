/**
 * The host engine's door (`hostEngineGateway.ts`), with the global `Worker`
 * replaced by a spy that runs the real worker shell over the fake backend:
 * importing the gateway or the engine spawns nothing, and neither does a
 * prefetch or opening a batch; only a resolve does, the dialog's own worker
 * file, terminated when it answers. A load that fails is a `lost` engine,
 * reported once, never thrown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import {
  FAKE_LAYER_ORDER_FIGURE,
  FAKE_LAYER_ORDER_SOURCE,
  FAKE_LIMITS,
  FakeLayerOrderWorker,
  createFakeLayerOrderBackend,
} from '../engine/layerOrderEngine.fixtures';
import { LAYER_ORDER_WORKER_NAMES } from '../engine/layerOrderEngine';

const monitoring = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('../../monitoring', () => ({ reportError: monitoring.reportError }));

/** Every `new Worker(…)`, with what it was asked to run. */
const spawned: { url: string; options: unknown; worker: FakeLayerOrderWorker }[] = [];

class SpyWorker extends FakeLayerOrderWorker {
  constructor(url: URL | string, options?: unknown) {
    super(createFakeLayerOrderBackend());
    spawned.push({ url: String(url), options, worker: this });
  }
}

const face = (k: number) => ({ at: FAKE_LAYER_ORDER_FIGURE.facePoints[k]!, area: 100 });
const RECORD: LayerOrderRecord = { faces: [face(3), face(0)], constraints: [[0, 1, 1]], order: [] };

beforeEach(() => {
  spawned.length = 0;
  monitoring.reportError.mockClear();
  vi.resetModules();
  vi.stubGlobal('Worker', SpyWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('./layerOrderHostEngine');
});

describe('the host engine’s gateway', () => {
  it('spawns no worker on import, on a prefetch or on opening a batch; a resolve spawns one and ends it', async () => {
    const gateway = await import('./hostEngineGateway');
    await import('./layerOrderHostEngine');
    gateway.prefetchLayerOrderHostEngine();
    await gateway.loadLayerOrderHostEngine();
    const batch = gateway.openLayerOrderResolveBatch();
    expect(spawned).toHaveLength(0);
    batch.close();

    const resolved = await gateway.resolveLayerOrder(FAKE_LAYER_ORDER_SOURCE, RECORD, FAKE_LIMITS);
    expect(resolved.outcome).toBe('applied');
    expect(spawned).toHaveLength(1);
    // The dialog's own worker file, as Vite names a worker it bundles.
    expect(new URL(spawned[0]!.url).pathname).toMatch(/\/src\/workers\/layerOrderWorker\.ts$/);
    // Named for its role: the worker reads from it whether its steps count on (E9).
    expect(spawned[0]!.options).toEqual({ type: 'module', name: LAYER_ORDER_WORKER_NAMES.host });
    // Short-lived: gone once it answered.
    expect(spawned[0]!.worker.terminated).toBe(true);
    expect(spawned[0]!.worker.backend.calls).toEqual(['restore', 'relations', 'save']);
  });

  it('a batch spawns one worker on its first resolve and ends it when closed', async () => {
    const gateway = await import('./hostEngineGateway');
    const batch = gateway.openLayerOrderResolveBatch();
    const answers = await Promise.all([
      batch.resolve(FAKE_LAYER_ORDER_SOURCE, RECORD, FAKE_LIMITS),
      batch.resolve(FAKE_LAYER_ORDER_SOURCE, RECORD, FAKE_LIMITS),
    ]);
    expect(answers.map((answer) => answer.outcome)).toEqual(['applied', 'applied']);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.worker.terminated).toBe(false);
    batch.close();
    expect(spawned[0]!.worker.terminated).toBe(true);
  });

  it('a Stop before the code has loaded answers cancelled and spawns nothing', async () => {
    const gateway = await import('./hostEngineGateway');
    const stop = new AbortController();
    const running = gateway.resolveLayerOrder(FAKE_LAYER_ORDER_SOURCE, RECORD, FAKE_LIMITS, { signal: stop.signal });
    stop.abort();
    await expect(running).resolves.toEqual({ outcome: 'cancelled' });
    expect(spawned).toHaveLength(0);
  });

  it('a load that fails while the browser is offline answers lost, reported to no one', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    vi.doMock('./layerOrderHostEngine', () => {
      throw new TypeError('Failed to fetch dynamically imported module');
    });
    const gateway = await import('./hostEngineGateway');
    const resolved = await gateway.resolveLayerOrder(FAKE_LAYER_ORDER_SOURCE, RECORD, FAKE_LIMITS);
    expect(resolved).toMatchObject({ outcome: 'lost', cause: 'load' });
    expect(monitoring.reportError).not.toHaveBeenCalled();
    expect(spawned).toHaveLength(0);
  });

  it('a load that fails answers lost, reported once, and the next resolve loads again', async () => {
    vi.doMock('./layerOrderHostEngine', () => {
      throw new Error('Offline.');
    });
    const gateway = await import('./hostEngineGateway');
    const resolved = await gateway.resolveLayerOrder(FAKE_LAYER_ORDER_SOURCE, RECORD, FAKE_LIMITS);
    expect(resolved).toEqual({
      outcome: 'lost',
      cause: 'unavailable',
      record: { ...RECORD, attention: { reason: 'timeout', count: 1 } },
      attention: { reason: 'timeout', count: 1 },
    });
    expect(monitoring.reportError).toHaveBeenCalledTimes(1);
    expect(monitoring.reportError.mock.calls[0]![1]).toEqual({
      surface: 'layer-order:host',
      tags: { cause: 'unavailable' },
    });
    expect(spawned).toHaveLength(0);

    vi.doUnmock('./layerOrderHostEngine');
    const again = await gateway.resolveLayerOrder(FAKE_LAYER_ORDER_SOURCE, RECORD, FAKE_LIMITS);
    expect(again.outcome).toBe('applied');
    expect(spawned).toHaveLength(1);
  });
});

describe('a solutions cursor through the gateway (H6)', () => {
  it('spawns nothing when opened; its first step spawns the worker, which it keeps until closed', async () => {
    const gateway = await import('./hostEngineGateway');
    const cursor = gateway.openLayerOrderSolutionCursor(FAKE_LAYER_ORDER_SOURCE, RECORD);
    await expect(cursor.place({ picture: 'front' })).resolves.toBeNull();
    expect(cursor.alive()).toBe(true);
    expect(spawned).toHaveLength(0);

    await expect(cursor.step('previous', { picture: 'front' })).resolves.toMatchObject({ outcome: 'moved' });
    await expect(cursor.step('next', { picture: 'front' })).resolves.toMatchObject({ outcome: 'moved' });
    expect(spawned).toHaveLength(1);
    expect(new URL(spawned[0]!.url).pathname).toMatch(/\/src\/workers\/layerOrderWorker\.ts$/);
    expect(spawned[0]!.worker.backend.calls).toEqual(['restore', 'step', 'relations', 'save', 'step', 'relations', 'save']);
    expect(spawned[0]!.worker.terminated).toBe(false);

    cursor.close();
    expect(spawned[0]!.worker.terminated).toBe(true);
    expect(cursor.alive()).toBe(false);
    await expect(cursor.step('next', { picture: 'front' })).resolves.toEqual({ outcome: 'cancelled' });
  });

  it('a load that fails while the browser is offline is a lost step, reported to no one; the next loads again', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    vi.doMock('./layerOrderHostEngine', () => {
      throw new TypeError('Failed to fetch dynamically imported module');
    });
    const gateway = await import('./hostEngineGateway');
    const cursor = gateway.openLayerOrderSolutionCursor(FAKE_LAYER_ORDER_SOURCE, RECORD);
    await expect(cursor.step('next', { picture: 'front' })).resolves.toEqual({ outcome: 'lost', cause: 'load' });
    expect(monitoring.reportError).not.toHaveBeenCalled();
    expect(spawned).toHaveLength(0);

    vi.doUnmock('./layerOrderHostEngine');
    vi.unstubAllGlobals();
    vi.stubGlobal('Worker', SpyWorker);
    await expect(cursor.step('previous', { picture: 'front' })).resolves.toMatchObject({ outcome: 'moved' });
    expect(spawned).toHaveLength(1);
    cursor.close();
  });
});
