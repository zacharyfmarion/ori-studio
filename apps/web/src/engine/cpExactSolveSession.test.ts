/**
 * The transport contract Stop rests on: a session that ends **settles what is in
 * flight**.
 *
 * This is the defect being designed around, not a hypothetical —
 * `bp-optimizer-cancellation.md:29-38` records a Comlink promise still pending
 * ten seconds after a 2.6 s run's worker was terminated, because `terminate()`
 * fires no event and rejects nothing. Every test here is that failure, in one of
 * the three ways a session can end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const wrap = vi.hoisted(() => vi.fn());
vi.mock('comlink', () => ({ wrap }));

import {
  cpExactSolveCancellationAvailable,
  isCpExactSolveCancelledError,
  openCpExactSolveSession,
} from './cpExactSolveSession';

type Listener = (event: Event) => void;

class FakeWorker {
  static latest: FakeWorker | null = null;
  readonly terminate = vi.fn();
  readonly listeners = new Map<string, Set<Listener>>();

  constructor() {
    FakeWorker.latest = this;
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  fail(): void {
    for (const listener of [...(this.listeners.get('error') ?? [])]) {
      listener(new Event('error'));
    }
  }
}

/** A client whose calls hang until the test resolves them, as a real solve does. */
function hangingClient() {
  return {
    solveExact: vi.fn(() => new Promise(() => {})),
    solveExactToFold: vi.fn(() => new Promise(() => {})),
  };
}

const originalWorker = globalThis.Worker;

beforeEach(() => {
  FakeWorker.latest = null;
  vi.stubGlobal('Worker', FakeWorker);
  wrap.mockReturnValue(hangingClient());
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalWorker === undefined) {
    Reflect.deleteProperty(globalThis, 'Worker');
  }
  wrap.mockReset();
});

describe('openCpExactSolveSession', () => {
  it('settles the in-flight call when stopped, then terminates', async () => {
    const session = openCpExactSolveSession();
    const solver = await session.solver;
    const pending = solver.solveExact('{}').catch((error: unknown) => error);

    session.stop?.();

    expect(isCpExactSolveCancelledError(await pending)).toBe(true);
    expect(FakeWorker.latest?.terminate).toHaveBeenCalledTimes(1);
  });

  it('settles the in-flight call when the worker dies on its own', async () => {
    // The same hang from the other direction: a wasm trap leaves comlink with
    // nothing to answer it either, and the surface sits on "Refining…" forever.
    const session = openCpExactSolveSession();
    const solver = await session.solver;
    const pending = solver.solveExactToFold('{}').catch((error: unknown) => error);

    FakeWorker.latest?.fail();

    await expect(pending).resolves.toMatchObject({ code: 'cp_exact_solve' });
  });

  it('settles the in-flight call when disposed with one outstanding', async () => {
    const session = openCpExactSolveSession();
    const solver = await session.solver;
    const pending = solver.solveExact('{}').catch((error: unknown) => error);

    session.dispose();

    await expect(pending).resolves.toMatchObject({ code: 'cp_exact_solve' });
  });

  it('rejects a call made after the session ended, rather than reaching a dead worker', async () => {
    const session = openCpExactSolveSession();
    const solver = await session.solver;
    session.stop?.();

    await expect(solver.solveExact('{}')).rejects.toBeDefined();
  });

  it('terminates once however many times it is ended', async () => {
    // `dispose` runs in a `finally` on every exit, including the cancel path, so
    // stop-then-dispose is the *normal* ordering rather than an edge case.
    const session = openCpExactSolveSession();
    await session.solver;

    session.stop?.();
    session.stop?.();
    session.dispose();

    expect(FakeWorker.latest?.terminate).toHaveBeenCalledTimes(1);
  });

  it('stops listening to the worker it terminated', async () => {
    const session = openCpExactSolveSession();
    await session.solver;
    session.dispose();

    expect([...(FakeWorker.latest?.listeners.get('error') ?? [])]).toHaveLength(0);
  });
});

describe('cpExactSolveCancellationAvailable', () => {
  it('is true wherever a worker can be spawned — no shared memory needed', () => {
    // The property that decided the mechanism: unlike the fold path's
    // `SharedArrayBuffer` flag, this needs no cross-origin isolation, so it is
    // available on the deployed origin and inside the packaged desktop shell.
    expect(cpExactSolveCancellationAvailable()).toBe(true);
  });

  it('is false where there is no worker at all', () => {
    vi.stubGlobal('Worker', undefined);
    expect(cpExactSolveCancellationAvailable()).toBe(false);
  });
});
