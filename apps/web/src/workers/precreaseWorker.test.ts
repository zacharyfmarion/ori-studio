/**
 * The precrease worker's bridge start, over a mocked bridge (ORI-STUDIO-1B).
 *
 * The bridge's wasm is fetched inside the worker the first time a call needs
 * it, and the References workspace keeps the worker for as long as it is open.
 * A start that failed used to cross comlink as the browser's bare TypeError
 * ("Load failed"), and was kept: every later call answered the same failure
 * without asking the network again, until the user left References.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrecreaseWorkerApi } from './precreaseWorker';

const worker = vi.hoisted(() => ({
  api: null as unknown,
  inits: 0,
  /** Whether the next start fails, as a download the network refused does. */
  failNextInit: false,
  disposed: 0,
}));

vi.mock('comlink', () => ({
  expose: (api: unknown) => {
    worker.api = api;
  },
}));

vi.mock('../generated/oristudio-precrease-wasm/oristudio_precrease_wasm', () => ({
  default: async () => {
    worker.inits += 1;
    if (worker.failNextInit) {
      worker.failNextInit = false;
      throw new TypeError('Load failed');
    }
  },
  precrease_tolerances: () => ({ tol: 1e-9, snap_radius: 1e-6 }),
  outline_components: () => [],
  model_to_rf: () => [0, 0],
  rf_to_model: () => [0, 0],
  sheet_component: () => ({ components: [] }),
  PrecreasePlanner: class {
    static for_sheet() {
      return new this();
    }
    info() {
      return { status: 'open' };
    }
    free() {
      worker.disposed += 1;
    }
  },
}));

/** A worker module of its own, as each spawned worker has. */
async function freshWorker(): Promise<PrecreaseWorkerApi> {
  vi.resetModules();
  worker.api = null;
  await import('./precreaseWorker');
  return worker.api as PrecreaseWorkerApi;
}

beforeEach(() => {
  worker.inits = 0;
  worker.failNextInit = false;
  worker.disposed = 0;
});

describe('the precrease worker’s bridge start', () => {
  it('answers a start that failed with its own code and the browser’s words', async () => {
    worker.failNextInit = true;
    const api = await freshWorker();

    await expect(api.tolerances()).rejects.toEqual({ code: 'precrease_unavailable', message: 'Load failed' });
  });

  it('starts the bridge again on the next call after a start that failed', async () => {
    worker.failNextInit = true;
    const api = await freshWorker();

    await expect(api.tolerances()).rejects.toMatchObject({ code: 'precrease_unavailable' });
    await expect(api.tolerances()).resolves.toEqual({ tol: 1e-9, snap_radius: 1e-6 });
    expect(worker.inits).toBe(2);
  });

  it('starts the bridge once while it works, and keeps a call’s own failure apart', async () => {
    const api = await freshWorker();
    await api.tolerances();
    await expect(api.plannerInfo(7)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(worker.inits).toBe(1);
  });

  it('disposes nothing, and throws nothing, when the bridge never started', async () => {
    worker.failNextInit = true;
    const api = await freshWorker();

    await expect(api.plannerDispose()).resolves.toBeUndefined();
    expect(worker.disposed).toBe(0);
  });
});
