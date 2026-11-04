/**
 * The worker shell over a backend, called directly: what it adds to any
 * backend (a lazy start that forgets a failure, envelopes, a trap that ends
 * the engine, E6's calls refused by name).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FAKE_LAYER_ORDER_SOURCE,
  FAKE_LIMITS,
  createFakeLayerOrderBackend,
} from '../layer-order/engine/layerOrderEngine.fixtures';
import { createLayerOrderWorkerApi, type LayerOrderBackend } from './layerOrderWorkerApi';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createLayerOrderWorkerApi', () => {
  it('answers through the backend, loaded once, on the first call', async () => {
    const backend = createFakeLayerOrderBackend();
    const load = vi.fn(() => backend);
    const api = createLayerOrderWorkerApi(load);
    expect(load).not.toHaveBeenCalled();

    await expect(api.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS)).resolves.toMatchObject({ status: 'ok' });
    await expect(api.preview([2, 3, 1], FAKE_LIMITS)).resolves.toMatchObject({ verdict: 'fits' });
    expect(load).toHaveBeenCalledTimes(1);
    expect(backend.calls).toEqual(['open', 'preview']);
  });

  it('forgets a start that failed, so the next call starts again', async () => {
    const backend = createFakeLayerOrderBackend();
    const load = vi
      .fn<() => LayerOrderBackend>()
      .mockImplementationOnce(() => {
        throw new Error('the .wasm did not arrive');
      })
      .mockImplementation(() => backend);
    const api = createLayerOrderWorkerApi(load);

    await expect(api.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS)).rejects.toEqual({
      code: 'layer_order_engine_unavailable',
      message: 'the .wasm did not arrive',
    });
    await expect(api.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS)).resolves.toMatchObject({ status: 'ok' });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('passes the backend’s own envelopes through and keeps answering', async () => {
    const api = createLayerOrderWorkerApi(() => createFakeLayerOrderBackend());
    await expect(api.stacks('front')).rejects.toEqual({
      code: 'layer_order_session_not_open',
      message: 'No layer order session is open.',
    });
    await expect(api.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS)).resolves.toMatchObject({ status: 'ok' });
  });

  it('a trap ends the engine: this call and every later one answer trapped, without asking the backend again', async () => {
    const backend = createFakeLayerOrderBackend();
    const api = createLayerOrderWorkerApi(() => backend);
    await api.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    backend.trapNext('commit');

    const trapped = await api.commit([[2, 3, 1]], FAKE_LIMITS).catch((error: unknown) => error);
    expect(trapped).toMatchObject({ code: 'layer_order_engine_trapped', trap: 'wasm_trap', message: 'unreachable' });
    expect((trapped as { stack?: string }).stack).toMatch(/RuntimeError: unreachable/);

    await expect(api.openPairs()).rejects.toBe(trapped);
    expect(backend.calls).toEqual(['open', 'commit']);
  });

  it('answers E6’s calls through the backend: explain, the count, the position and a step', async () => {
    const api = createLayerOrderWorkerApi(() => createFakeLayerOrderBackend());
    await api.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    await expect(api.explain([1, 0, 1], FAKE_LIMITS)).resolves.toMatchObject({
      verdict: 'clash',
      proof: { kind: 'forced' },
    });
    await expect(api.countSlice(FAKE_LIMITS)).resolves.toEqual({
      epoch: 1,
      count: {
        front: { n: 3, exact: true },
        back: { n: 3, exact: true },
        orders: { n: 12, exact: true },
        done: true,
      },
    });
    await expect(api.position({ picture: 'front' })).resolves.toEqual({ index: 1, total: { n: 3, exact: true } });
    await expect(api.step({ picture: 'front' }, 'next', FAKE_LIMITS)).resolves.toMatchObject({
      verdict: 'moved',
      position: { index: 2 },
    });
  });
});
