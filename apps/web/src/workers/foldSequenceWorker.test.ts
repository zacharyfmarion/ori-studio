/**
 * The Fold worker over a mocked bridge.
 *
 * Its start: a wasm module that failed to arrive or compile is asked for
 * again by the next call, so the session's "Try again" — which calls the same
 * live worker — can succeed without the worker being replaced.
 *
 * Its traps: a call the engine failed halfway — a `WebAssembly.RuntimeError`,
 * wasm-bindgen's "recursive use" from an instance something already broke,
 * any other throw that is not an envelope — kills the engine. That call and
 * every later one answer `fold_engine_trapped` without touching the instance
 * again, for the runtime to replace the worker; an envelope leaves it sound.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Api = Record<string, (...args: unknown[]) => Promise<unknown>>;

const worker = vi.hoisted(() => ({
  api: null as Api | null,
  inits: 0,
  /** Whether the first start fails, as a fetch offline does. */
  failFirstInit: false,
  /** What the engine's next `live()` calls throw, in turn; it answers once they run out. */
  throwOnLive: [] as unknown[],
  /** Calls that reached the engine. */
  engineCalls: [] as string[],
}));

vi.mock('comlink', () => ({
  expose: (api: Api) => {
    worker.api = api;
  },
}));

vi.mock('../generated/oristudio-fold-wasm/oristudio_fold_wasm', () => ({
  default: () => {
    worker.inits += 1;
    return worker.failFirstInit && worker.inits === 1 ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve();
  },
  FoldEngine: class {
    live() {
      worker.engineCalls.push('live');
      const thrown = worker.throwOnLive.shift();
      if (thrown !== undefined) throw thrown;
      return 3;
    }
    summary() {
      worker.engineCalls.push('summary');
      throw { code: 'unknown_state', message: 'no state 9' };
    }
  },
  fold_engine_version: () => 7,
}));

/** A worker module of its own, as each spawned worker has. */
async function freshWorker(): Promise<Api> {
  vi.resetModules();
  worker.api = null;
  await import('./foldSequenceWorker');
  return worker.api!;
}

beforeEach(() => {
  worker.inits = 0;
  worker.failFirstInit = false;
  worker.throwOnLive = [];
  worker.engineCalls = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the Fold worker', () => {
  it('starts the module again on the next call after a start that failed', async () => {
    worker.failFirstInit = true;
    const api = await freshWorker();

    await expect(api.engineVersion!()).rejects.toEqual({
      code: 'oristudio_fold_wasm_error',
      message: 'Failed to fetch',
    });
    await expect(api.engineVersion!()).resolves.toBe(7);
    await expect(api.engineVersion!()).resolves.toBe(7);
    // Started once more, then kept.
    expect(worker.inits).toBe(2);
  });

  it('answers a trap mid-call as fold_engine_trapped, and never calls the dead instance again', async () => {
    const api = await freshWorker();
    await expect(api.live!()).resolves.toBe(3);
    const trap = new WebAssembly.RuntimeError('unreachable');
    worker.throwOnLive.push(trap);

    const trapped = await api.live!().catch((error: unknown) => error);
    expect(trapped).toMatchObject({ code: 'fold_engine_trapped', trap: 'wasm_trap', message: 'unreachable' });
    // Its own stack, for Sentry: the module's frames, not the runtime's.
    expect((trapped as { stack?: string }).stack).toBe(trap.stack);

    // The instance would answer now; it is not asked.
    const reached = worker.engineCalls.length;
    await expect(api.live!()).rejects.toBe(trapped);
    await expect(api.summary!(1)).rejects.toBe(trapped);
    await expect(api.engineVersion!()).rejects.toBe(trapped);
    expect(worker.engineCalls).toHaveLength(reached);
  });

  it('calls an instance already broken, which answers "recursive use", poisoned', async () => {
    const api = await freshWorker();
    worker.throwOnLive.push(
      new Error('recursive use of an object detected which would lead to unsafe aliasing in rust')
    );
    await expect(api.live!()).rejects.toMatchObject({ code: 'fold_engine_trapped', trap: 'engine_poisoned' });
  });

  it('calls any other throw that is not an envelope a trap', async () => {
    const api = await freshWorker();
    worker.throwOnLive.push(new RangeError('Maximum call stack size exceeded'));
    await expect(api.live!()).rejects.toMatchObject({
      code: 'fold_engine_trapped',
      trap: 'unexpected_error',
      message: 'Maximum call stack size exceeded',
    });
  });

  it('passes an envelope through and keeps the engine', async () => {
    const api = await freshWorker();
    await expect(api.summary!(9)).rejects.toEqual({ code: 'unknown_state', message: 'no state 9' });
    await expect(api.live!()).resolves.toBe(3);
  });
});
