import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { foldEngineTrapOf } from '../fold/engine/foldEngineTrap';

/**
 * A Fold engine that fails mid-call, on the real bridge.
 *
 * Neither failure here is a bug in the engine, and neither can reach the
 * shipped worker as written — a structured clone carries no getter, and the
 * calls never hand the bridge an array-like — but both are the module's own
 * behaviour, with no hook added for the test:
 *
 * - A JS exception thrown while the bridge reads its argument unwinds through
 *   the Rust frames mid-call, as a trap does. No destructor runs, so the
 *   instance's borrow stays taken, and wasm-bindgen answers every later call
 *   on it "recursive use of an object detected": the poisoning the worker
 *   must not keep calling into.
 * - An allocation the module cannot make aborts it: a real
 *   `WebAssembly.RuntimeError: unreachable`, as a panic or an out-of-memory
 *   would be.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const WASM = resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(WASM);

type Api = Record<string, (...args: unknown[]) => Promise<unknown>>;

const worker = vi.hoisted(() => ({ api: null as Api | null }));

vi.mock('comlink', () => ({
  expose: (api: Api) => {
    worker.api = api;
  },
}));

// The real module, started from the file as the other wasm tests start it.
vi.mock('../generated/oristudio-fold-wasm/oristudio_fold_wasm', async (importOriginal) => {
  const real = await importOriginal<typeof import('../generated/oristudio-fold-wasm/oristudio_fold_wasm')>();
  const { readFileSync } = await import('node:fs');
  const { resolve: resolvePath } = await import('node:path');
  const bytes = readFileSync(resolvePath(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm'));
  return { ...real, default: async () => real.initSync({ module: bytes }) };
});

async function bridge() {
  const wasm = await import('../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  await wasm.default();
  return wasm;
}

const SQUARE = { shape: { kind: 'square' }, startSide: 'front' };

/** A paper whose shape throws as the bridge reads it, mid-call. */
function throwingPaper() {
  return {
    get shape(): never {
      throw new Error('getter threw');
    },
    startSide: 'front',
  };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe.skipIf(!available)('a Fold engine that fails mid-call, on the real bridge', () => {
  it('answers every later call on the instance "recursive use", while a new instance is sound', async () => {
    const wasm = await bridge();
    const engine = new wasm.FoldEngine();
    expect(engine.live()).toBe(0);

    const unwound = (() => {
      try {
        engine.sheet(throwingPaper());
      } catch (error) {
        return error;
      }
      return null;
    })();
    expect(unwound).toMatchObject({ message: 'getter threw' });

    let poisoned: unknown = null;
    try {
      engine.live();
    } catch (error) {
      poisoned = error;
    }
    expect(poisoned).toBeInstanceOf(Error);
    expect((poisoned as Error).message).toMatch(/^recursive use of an object detected/);
    expect(foldEngineTrapOf(poisoned)).toMatchObject({ code: 'fold_engine_trapped', trap: 'engine_poisoned' });
    expect(() => engine.clear()).toThrow(/recursive use/);

    const fresh = new wasm.FoldEngine();
    expect(fresh.sheet(SQUARE)).toMatchObject({ status: 'ok' });
  });

  it('traps with a WebAssembly.RuntimeError when the module aborts', async () => {
    const wasm = await bridge();
    const engine = new wasm.FoldEngine();
    let trapped: unknown = null;
    try {
      // 2^29 handles is 2^31 bytes, past what the module can lay out: its allocator aborts.
      engine.release({ length: 2 ** 29 } as unknown as Uint32Array);
    } catch (error) {
      trapped = error;
    }
    expect(trapped).toBeInstanceOf(WebAssembly.RuntimeError);
    expect(foldEngineTrapOf(trapped)).toMatchObject({ code: 'fold_engine_trapped', trap: 'wasm_trap', message: 'unreachable' });
  });

  it('the worker answers the call that broke the engine, and every call after it, without asking the instance again', async () => {
    worker.api = null;
    await import('./foldSequenceWorker');
    const api = worker.api!;
    await expect(api.sheet!(SQUARE)).resolves.toMatchObject({ status: 'ok' });
    await expect(api.live!()).resolves.toBe(1);

    const trapped = await api.sheet!(throwingPaper()).catch((error: unknown) => error);
    expect(trapped).toMatchObject({ code: 'fold_engine_trapped', trap: 'unexpected_error', message: 'getter threw' });
    // The instance would answer "recursive use"; it is not asked, so the answer is still the first failure.
    await expect(api.live!()).rejects.toBe(trapped);
    await expect(api.engineVersion!()).rejects.toBe(trapped);
  });
});
