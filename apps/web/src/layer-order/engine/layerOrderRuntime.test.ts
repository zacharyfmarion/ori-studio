// @vitest-environment jsdom
/**
 * The Layer order engine's worker lifetime, against a fake worker that runs
 * the real worker shell over a fake backend through comlink
 * (`layerOrderEngine.fixtures.ts`): everything but the bridge. The fake
 * answers one call at a time, as a worker's synchronous bridge calls are, so
 * a held call keeps every call behind it waiting, as a long one does.
 *
 * `terminate()` settles nothing comlink has in flight, so every way a worker
 * goes away (the dialog's Cancel, its close, a crash) must reject what is
 * waiting on it, as a typed loss, before the worker goes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FAKE_LAYER_ORDER_SOURCE,
  FAKE_LIMITS,
  FAKE_ONE_ORDER_SLICE,
  createFakeLayerOrderBackend,
  fakeLayerOrderWorkers,
  inProcessLayerOrderWorkers,
  type FakeLayerOrderWorker,
} from './layerOrderEngine.fixtures';
import type { LayerOrderLimits, LayerSolutionCount } from './layerOrderEngine';
import { createLayerOrderRuntime, isLayerOrderEngineLost, type LayerOrderRuntime } from './layerOrderRuntime';
import { registerWorkerFailureSink } from '../../lib/workerDiagnostics';

const monitoring = vi.hoisted(() => ({ reportError: vi.fn() }));

vi.mock('../../monitoring', () => ({ reportError: monitoring.reportError }));

beforeEach(() => {
  monitoring.reportError.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Let the fake worker's messages, a task each way, arrive. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

function opened() {
  const fake = fakeLayerOrderWorkers();
  const runtime = createLayerOrderRuntime({ role: 'dialog', spawn: fake.spawn });
  const worker = (index = 0): FakeLayerOrderWorker => fake.workers[index]!;
  return { fake, runtime, worker };
}

describe('spawning', () => {
  it('spawns nothing until the first call, then answers every call from one worker', async () => {
    const { fake, runtime, worker } = opened();
    expect(fake.workers).toHaveLength(0);
    expect(runtime.running()).toBe(false);

    const open = await runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    const preview = await runtime.engine.preview([2, 3, 1], FAKE_LIMITS);

    expect(open).toMatchObject({ status: 'ok', faces: 4, spots: 1, opened_on: { kind: 'first', timed_out: null } });
    expect(preview).toMatchObject({ verdict: 'fits', token: 1 });
    expect(fake.workers).toHaveLength(1);
    expect(runtime.running()).toBe(true);
    // Without a count, nothing but what was asked.
    await settle();
    expect(worker().backend.calls).toEqual(['open', 'preview']);
  });

  it('typed arrays cross the worker as typed arrays', async () => {
    const { runtime } = opened();
    const open = await runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    if (open.status !== 'ok') throw new Error('expected an open session');
    // By tag: under jsdom the clone's typed arrays are of another realm than the test's.
    const tag = (value: unknown) => Object.prototype.toString.call(value);
    expect(tag(open.open_pairs)).toBe('[object Uint32Array]');
    expect([...open.open_pairs]).toEqual([0, 2, 0, 3, 1, 2, 1, 3, 2, 3]);
    expect(tag(open.front_up)).toBe('[object Uint8Array]');
    const back = await runtime.engine.stacks('back');
    expect(tag(back.faces)).toBe('[object Uint32Array]');
    expect([...back.faces]).toEqual([3, 2, 1, 0]);
  });
});

describe('dispose', () => {
  it('rejects every call in flight as closed, then terminates the worker; later calls reject without spawning', async () => {
    const { fake, runtime, worker } = opened();
    const heard: string[] = [];
    runtime.onLost((reason) => heard.push(reason));
    const pending = runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    worker().backend.hold('open');

    runtime.dispose();

    await expect(pending).rejects.toEqual({
      code: 'layer_order_engine_lost',
      reason: 'closed',
      message: 'The layer order engine was closed while it was running.',
    });
    expect(worker().terminated).toBe(true);
    expect(runtime.running()).toBe(false);
    expect(runtime.generation()).toBe(1);
    expect(heard).toEqual(['closed']);

    await expect(runtime.engine.openPairs()).rejects.toMatchObject({ reason: 'closed' });
    await expect(runtime.ask(async () => 1)).rejects.toMatchObject({ reason: 'closed' });
    expect(fake.workers).toHaveLength(1);

    // Again: nothing more happens.
    runtime.dispose();
    expect(heard).toEqual(['closed']);
    expect(monitoring.reportError).not.toHaveBeenCalled();
  });

  it('disposing a runtime that never spawned spawns nothing', async () => {
    const { fake, runtime } = opened();
    runtime.dispose();
    await expect(runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS)).rejects.toMatchObject({ reason: 'closed' });
    expect(fake.workers).toHaveLength(0);
    expect(runtime.generation()).toBe(0);
  });
});

describe('cancel', () => {
  it('terminates the worker, rejects what is in flight as cancelled, and the next call reaches a fresh worker with no session', async () => {
    const { fake, runtime, worker } = opened();
    await runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    const held = worker().backend.hold('commit');
    const pending = runtime.engine.commit([[2, 3, 1]], FAKE_LIMITS).catch((error: unknown) => error);
    await settle();

    expect(runtime.cancel()).toBe(true);

    const failure = await pending;
    expect(isLayerOrderEngineLost(failure)).toBe(true);
    expect(failure).toMatchObject({ reason: 'cancelled' });
    expect(worker().terminated).toBe(true);
    expect(runtime.generation()).toBe(1);
    // The commit the worker was holding never answers: the worker is gone.
    held.release();
    await settle();

    // The runtime is still usable; the session went with the worker.
    await expect(runtime.engine.openPairs()).rejects.toMatchObject({ code: 'layer_order_session_not_open' });
    expect(fake.workers).toHaveLength(2);
    expect(worker(1).terminated).toBe(false);
    expect(worker(1).backend.calls).toEqual(['openPairs']);
    expect(monitoring.reportError).not.toHaveBeenCalled();
  });

  it('with nothing running, cancels nothing and keeps the generation', () => {
    const { runtime } = opened();
    expect(runtime.cancel()).toBe(false);
    expect(runtime.generation()).toBe(0);
  });
});

describe('stale results', () => {
  it('drops an answer asked before the generation moved, and answers one asked after', async () => {
    const { runtime, worker } = opened();
    await runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    const held = worker().backend.hold('relations');
    const asked = runtime.askCurrent((client) => client.relations());
    await settle();

    runtime.invalidate();
    held.release();

    await expect(asked).resolves.toEqual({ status: 'stale' });
    await expect(runtime.askCurrent((client) => client.relations())).resolves.toMatchObject({ status: 'answered' });
    // The worker never went away for it.
    expect(worker().terminated).toBe(false);
  });

  it('a call asked under a worker that went away rejects as its loss rather than coming back stale', async () => {
    const { runtime, worker } = opened();
    await runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    worker().backend.hold('relations');
    const asked = runtime.askCurrent((client) => client.relations());
    runtime.cancel();
    await expect(asked).rejects.toMatchObject({ code: 'layer_order_engine_lost', reason: 'cancelled' });
  });
});

describe('previews: latest wins', () => {
  it('keeps one preview in flight and the newest waiting; those between never reach the worker', async () => {
    const { runtime, worker } = opened();
    await runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    const channel = runtime.channel();
    const held = worker().backend.hold('preview');

    const a = channel.request((client) => client.preview([2, 3, 1], FAKE_LIMITS));
    const b = channel.request((client) => client.preview([3, 2, 1], FAKE_LIMITS));
    const c = channel.request((client) => client.preview([1, 3, -1], FAKE_LIMITS));

    await expect(b).resolves.toEqual({ status: 'superseded' });
    held.release();
    await expect(a).resolves.toEqual({ status: 'superseded' });
    await expect(c).resolves.toMatchObject({ status: 'answered', value: { verdict: 'fits' } });
    expect(worker().backend.calls).toEqual(['open', 'preview', 'preview']);
  });

  it('the newest preview rejects as cancelled when the worker is stopped under it', async () => {
    const { runtime, worker } = opened();
    await runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    const channel = runtime.channel();
    worker().backend.hold('preview');
    const pending = channel.request((client) => client.preview([2, 3, 1], FAKE_LIMITS)).catch((e: unknown) => e);
    await settle();

    runtime.cancel();

    await expect(pending).resolves.toMatchObject({ code: 'layer_order_engine_lost', reason: 'cancelled' });
  });
});

describe('the count, between calls', () => {
  /** A dialog's runtime that counts a slice of `slice` at a time; the fake reads `maxNodes` orders a slice. */
  function counting(slice: LayerOrderLimits = FAKE_ONE_ORDER_SLICE) {
    const fake = fakeLayerOrderWorkers();
    const runtime = createLayerOrderRuntime({ role: 'dialog', spawn: fake.spawn, count: slice });
    runtime.setCounting(true);
    const heard: (LayerSolutionCount | null)[] = [];
    runtime.onCount((count) => heard.push(count));
    const worker = (index = 0): FakeLayerOrderWorker => fake.workers[index]!;
    return { fake, runtime, heard, worker };
  }

  const counted = (runtime: LayerOrderRuntime) =>
    vi.waitFor(() => expect(runtime.count()?.done).toBe(true), { timeout: 2_000, interval: 2 });

  /** How many slices lie between each two `call`s in a log, and before the first. */
  function slicesBefore(calls: readonly string[], call: string): number[] {
    const gaps: number[] = [];
    let slices = 0;
    for (const name of calls) {
      if (name === 'countSlice') slices += 1;
      else if (name === call) {
        gaps.push(slices);
        slices = 0;
      }
    }
    return gaps;
  }

  const FULL_COUNT: LayerSolutionCount = {
    front: { n: 3, exact: true },
    back: { n: 3, exact: true },
    orders: { n: 12, exact: true },
    done: true,
  };

  it('counts after the open, a slice at a time, publishing each, until done; then asks for nothing', async () => {
    const { runtime, heard, worker } = counting();
    expect(runtime.count()).toBeNull();
    await runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);

    await counted(runtime);

    expect(runtime.count()).toEqual(FULL_COUNT);
    // The toy figure's 24 orders, one a slice; each slice that found something is published.
    expect(worker().backend.calls).toEqual(['open', ...Array<string>(24).fill('countSlice')]);
    expect(heard.length).toBeGreaterThan(10);
    expect(heard.slice(0, -1).every((count) => count !== null && !count.done)).toBe(true);
    const orders = heard.map((count) => count!.orders.n);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(orders.at(-1)).toBe(12);
    await settle();
    expect(worker().backend.calls).toHaveLength(25);
  });

  it('a preview asked while a slice runs waits for that slice only, not for the count', async () => {
    const { runtime, worker } = counting();
    const opening = runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    const slice = worker().backend.hold('countSlice');
    await opening;
    await vi.waitFor(() => expect(worker().backend.calls).toEqual(['open', 'countSlice']), { interval: 2 });

    // The first slice is running: the preview is behind it.
    const preview = runtime.engine.preview([2, 3, 1], FAKE_LIMITS);
    await settle();
    expect(worker().backend.calls).toEqual(['open', 'countSlice']);
    slice.release();

    await expect(preview).resolves.toMatchObject({ verdict: 'fits' });
    // Answered next: no second slice went ahead of it.
    expect(worker().backend.calls.slice(0, 3)).toEqual(['open', 'countSlice', 'preview']);
    await counted(runtime);
    expect(runtime.count()).toEqual(FULL_COUNT);
  });

  it('a stream of previews waits behind one slice at most each, and still moves the count on', async () => {
    const { runtime, worker } = counting();
    await runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    const candidates = [
      [2, 3, 1],
      [3, 2, 1],
      [0, 2, 1],
      [2, 0, 1],
      [3, 0, 1],
      [0, 3, -1],
    ] as const;
    for (const candidate of candidates) {
      await expect(runtime.engine.preview(candidate, FAKE_LIMITS)).resolves.toMatchObject({ verdict: 'fits' });
    }

    const gaps = slicesBefore(worker().backend.calls, 'preview');
    expect(gaps).toHaveLength(candidates.length);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(1);
    // Every answer earns a slice: the count went on between the previews, not after them.
    expect(gaps.slice(1).reduce((sum, gap) => sum + gap, 0)).toBeGreaterThanOrEqual(candidates.length - 2);
    expect(runtime.count()?.done).toBe(false);
    await counted(runtime);
  });

  it('a commit restarts the count from nothing on a new cursor; a step and a commit that did not land keep it', async () => {
    const { runtime, heard } = counting(FAKE_LIMITS);
    await runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    await counted(runtime);
    expect(runtime.count()).toEqual(FULL_COUNT);

    // 3 above 2: the cursor counted other constraints, so the count starts again.
    await expect(runtime.engine.commit([[2, 3, 1]], FAKE_LIMITS)).resolves.toMatchObject({ verdict: 'committed' });
    expect(runtime.count()).toBeNull();
    await counted(runtime);
    // 0 above 1 (the creases) and 3 above 2: 6 of the 24 orders.
    expect(runtime.count()).toMatchObject({ orders: { n: 6, exact: true } });
    expect(heard.map((count) => count?.orders.n ?? null)).toEqual([12, null, 6]);
    await expect(runtime.engine.countSlice(FAKE_LIMITS)).resolves.toMatchObject({ epoch: 2 });

    // A step moves the order on screen and keeps the cursor and its count.
    await expect(runtime.engine.step({ picture: 'front' }, 'next', FAKE_LIMITS)).resolves.toMatchObject({
      verdict: 'moved',
      position: { index: 2, total: { n: 2, exact: true } },
    });
    // 1 in front of 0, against the creases: nothing committed, nothing restarted.
    await expect(runtime.engine.commit([[2, 3, 1], [1, 0, 1]], FAKE_LIMITS)).resolves.toMatchObject({
      verdict: 'cant_fit',
    });
    await settle();
    expect(heard.map((count) => count?.orders.n ?? null)).toEqual([12, null, 6]);
    await expect(runtime.engine.countSlice(FAKE_LIMITS)).resolves.toMatchObject({ epoch: 2 });
  });

  it('Cancel terminates the worker mid-slice; the next worker counts again from its own first cursor', async () => {
    const { fake, runtime, heard, worker } = counting();
    const opening = runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    // Two slices run; the third is held, mid-count.
    const holds = [0, 1, 2].map(() => worker().backend.hold('countSlice'));
    holds[0]!.release();
    holds[1]!.release();
    await opening;
    await vi.waitFor(() => expect(heard).toHaveLength(2), { interval: 2 });
    await vi.waitFor(() => expect(worker().backend.calls).toHaveLength(4), { interval: 2 });

    expect(runtime.cancel()).toBe(true);

    expect(worker().terminated).toBe(true);
    expect(runtime.running()).toBe(false);
    expect(runtime.count()).toBeNull();
    // [0, 1, 2, 3] and [0, 1, 3, 2] fit, then the third slice was stopped.
    expect(heard.map((count) => count?.orders.n ?? null)).toEqual([1, 2, null]);
    // A slice never spawns a worker; the cancelled one is no failure to report.
    holds[2]!.release();
    await settle();
    expect(fake.workers).toHaveLength(1);
    expect(monitoring.reportError).not.toHaveBeenCalled();

    await runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    await counted(runtime);
    expect(fake.workers).toHaveLength(2);
    expect(runtime.count()).toEqual(FULL_COUNT);
  });

  it('a close stops the count, and a slice that finds no session is nothing to report', async () => {
    const { runtime, heard, worker } = counting(FAKE_LIMITS);
    await runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    await counted(runtime);
    await runtime.engine.close();
    expect(runtime.count()).toBeNull();
    await settle();
    await settle();
    expect(worker().backend.calls).toEqual(['open', 'countSlice', 'close', 'countSlice']);
    expect(heard.map((count) => count?.done ?? null)).toEqual([true, null]);
    expect(monitoring.reportError).not.toHaveBeenCalled();
  });

  it('a slice that fails for a defect is reported once, and the count waits for its next restart', async () => {
    let slices = 0;
    const fake = inProcessLayerOrderWorkers(() => ({
      ...createFakeLayerOrderBackend(),
      countSlice: () => {
        slices += 1;
        throw { code: 'session_internal', message: 'a count that broke' };
      },
    }));
    const runtime = createLayerOrderRuntime({ role: 'dialog', spawn: fake.spawn, count: FAKE_LIMITS });
    runtime.setCounting(true);
    await runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    await vi.waitFor(() => expect(monitoring.reportError).toHaveBeenCalledTimes(1), { interval: 2 });
    await settle();
    expect(slices).toBe(1);
    expect(runtime.count()).toBeNull();
    expect(monitoring.reportError.mock.calls[0]).toEqual([
      { code: 'session_internal', message: 'a count that broke' },
      { surface: 'layer-order:count', tags: { role: 'dialog' } },
    ]);
    // The worker is fine and answers on; the count asks nothing more until it starts again.
    await expect(runtime.engine.openPairs()).resolves.toHaveLength(10);
    await settle();
    expect(slices).toBe(1);
    expect(fake.workers[0]!.terminated).toBe(false);
    await runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    await vi.waitFor(() => expect(monitoring.reportError).toHaveBeenCalledTimes(2), { interval: 2 });
    expect(slices).toBe(2);
  });

  it('the hosts’ engine counts nothing unless asked', async () => {
    const fake = fakeLayerOrderWorkers();
    const runtime = createLayerOrderRuntime({ role: 'host', spawn: fake.spawn });
    await runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    await runtime.engine.preview([2, 3, 1], FAKE_LIMITS);
    await settle();
    expect(fake.workers[0]!.backend.calls).toEqual(['open', 'preview']);
    expect(runtime.count()).toBeNull();
  });
});

describe('turning the count on and off', () => {
  const slicesOf = (worker: FakeLayerOrderWorker) =>
    worker.backend.calls.filter((call) => call === 'countSlice').length;

  it('never counts until its owner turns it on, slice limits given or not', async () => {
    for (const count of [undefined, FAKE_ONE_ORDER_SLICE]) {
      const fake = fakeLayerOrderWorkers();
      const runtime = createLayerOrderRuntime({ role: 'dialog', spawn: fake.spawn, ...(count ? { count } : {}) });
      await runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
      await runtime.engine.stacks('front');
      await settle();
      expect(runtime.counting()).toBe(false);
      expect(fake.workers[0]!.backend.calls).toEqual(['open', 'stacks']);
      expect(runtime.count()).toBeNull();
      runtime.dispose();
    }
  });

  it('counts between calls once on, stops and reads null when off, and goes on from the cursor when on again', async () => {
    const fake = fakeLayerOrderWorkers();
    const runtime = createLayerOrderRuntime({ role: 'dialog', spawn: fake.spawn, count: FAKE_ONE_ORDER_SLICE });
    const heard: (LayerSolutionCount | null)[] = [];
    runtime.onCount((count) => heard.push(count));
    await runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    await settle();
    expect(slicesOf(fake.workers[0]!)).toBe(0);

    // On after the open, with nothing else asked: the count starts by itself.
    runtime.setCounting(true);
    expect(runtime.counting()).toBe(true);
    await vi.waitFor(() => expect(slicesOf(fake.workers[0]!)).toBeGreaterThanOrEqual(3), { interval: 2 });

    runtime.setCounting(false);
    expect(runtime.count()).toBeNull();
    expect(heard.at(-1)).toBeNull();
    // At most the slice already in the worker answers, and it is not published.
    await settle();
    const stopped = slicesOf(fake.workers[0]!);
    await runtime.engine.stacks('front');
    await settle();
    expect(slicesOf(fake.workers[0]!)).toBe(stopped);
    expect(runtime.count()).toBeNull();

    // On again: the same cursor goes on to the end, from where it was, not from the start.
    runtime.setCounting(true);
    await vi.waitFor(() => expect(runtime.count()?.done).toBe(true), { timeout: 2_000, interval: 2 });
    // The toy figure has 24 orders, read one a slice: one cursor for the whole count.
    expect(slicesOf(fake.workers[0]!)).toBeLessThanOrEqual(25);
    expect(runtime.count()?.orders.n).toBe(12);
    runtime.dispose();
  });

  it('stays as it was across an open and a loss', async () => {
    const fake = fakeLayerOrderWorkers();
    const runtime = createLayerOrderRuntime({ role: 'dialog', spawn: fake.spawn, count: FAKE_LIMITS });
    runtime.setCounting(true);
    await runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    await vi.waitFor(() => expect(runtime.count()?.done).toBe(true), { interval: 2 });
    runtime.cancel();
    expect(runtime.counting()).toBe(true);
    expect(runtime.count()).toBeNull();
    await runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    await vi.waitFor(() => expect(runtime.count()?.done).toBe(true), { interval: 2 });
    expect(slicesOf(fake.workers[1]!)).toBeGreaterThan(0);
    runtime.dispose();
  });
});

describe('engine loss', () => {
  it('a worker that never loads rejects every call on it as unloaded, and is reported to no one', async () => {
    const { fake, runtime, worker } = opened();
    const heard: unknown[][] = [];
    runtime.onLost((...args) => heard.push(args));
    const opening = runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS).catch((e: unknown) => e);
    worker().backend.hold('open');
    worker().failToLoad();

    await expect(opening).resolves.toEqual({
      code: 'layer_order_engine_lost',
      reason: 'unloaded',
      message: 'The layer order engine did not load.',
      loadFailed: true,
    });
    expect(worker().terminated).toBe(true);
    expect(heard).toEqual([['unloaded', undefined]]);
    expect(monitoring.reportError).not.toHaveBeenCalled();
    // Try again: a fresh worker.
    await expect(runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS)).resolves.toMatchObject({ status: 'ok' });
    expect(fake.workers).toHaveLength(2);
  });

  it.each(['dialog', 'host'] as const)(
    'the %s’s worker the browser never loaded is its owner’s to say: the app’s error toast hears nothing of it, but of a crash',
    async (role) => {
      const sink = vi.fn();
      registerWorkerFailureSink(sink);
      try {
        const fake = fakeLayerOrderWorkers();
        const runtime = createLayerOrderRuntime({ role, spawn: fake.spawn });
        const opening = runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS).catch((e: unknown) => e);
        fake.workers[0]!.backend.hold('open');
        fake.workers[0]!.failToLoad();
        await expect(opening).resolves.toMatchObject({ reason: 'unloaded', loadFailed: true });
        expect(sink).not.toHaveBeenCalled();

        const again = runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS).catch((e: unknown) => e);
        fake.workers[1]!.backend.hold('open');
        fake.workers[1]!.crash();
        await expect(again).resolves.toMatchObject({ reason: 'crashed' });
        expect(sink).toHaveBeenCalledOnce();
        expect(sink.mock.calls[0]![0]).toMatchObject({ worker: 'layer-order', loadFailed: false });
      } finally {
        registerWorkerFailureSink(null);
      }
    }
  );

  it('a worker that dies rejects every call on it as crashed, and is reported once', async () => {
    const { fake, runtime, worker } = opened();
    const heard: unknown[][] = [];
    runtime.onLost((...args) => heard.push(args));
    await runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    worker().backend.hold('commit');
    worker().backend.hold('openPairs');
    const commit = runtime.engine.commit([[2, 3, 1]], FAKE_LIMITS).catch((e: unknown) => e);
    const pairs = runtime.engine.openPairs().catch((e: unknown) => e);
    await settle();

    worker().crash();

    await expect(commit).resolves.toEqual({
      code: 'layer_order_engine_lost',
      reason: 'crashed',
      message: 'The layer order engine stopped while it was running.',
    });
    await expect(pairs).resolves.toMatchObject({ reason: 'crashed' });
    expect(worker().terminated).toBe(true);
    expect(runtime.generation()).toBe(1);
    expect(heard).toEqual([['crashed', 'worker_error']]);
    expect(monitoring.reportError).toHaveBeenCalledTimes(1);
    const [error, context] = monitoring.reportError.mock.calls[0]!;
    expect(error).toMatchObject({
      name: 'LayerOrderEngineCrash',
      reason: 'worker_error',
      message: 'worker_error: The worker stopped unexpectedly.',
    });
    expect(context).toEqual({ surface: 'layer-order:engine', tags: { reason: 'worker_error', role: 'dialog' } });

    // The next call spawns a fresh worker; the dead one's late events change nothing.
    await expect(runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS)).resolves.toMatchObject({ status: 'ok' });
    worker(0).crash();
    expect(fake.workers).toHaveLength(2);
    expect(worker(1).terminated).toBe(false);
    expect(monitoring.reportError).toHaveBeenCalledTimes(1);
  });

  it('an engine that trapped drops its worker: the call rejects as crashed and the trap’s stack reaches Sentry', async () => {
    const { fake, runtime, worker } = opened();
    await runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    worker().backend.trapNext('preview');

    await expect(runtime.engine.preview([2, 3, 1], FAKE_LIMITS)).rejects.toMatchObject({
      code: 'layer_order_engine_lost',
      reason: 'crashed',
    });

    expect(worker().terminated).toBe(true);
    expect(runtime.generation()).toBe(1);
    expect(monitoring.reportError).toHaveBeenCalledTimes(1);
    const [error, context] = monitoring.reportError.mock.calls[0]!;
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'LayerOrderEngineCrash', message: 'wasm_trap: unreachable' });
    expect((error as Error).stack).toMatch(/RuntimeError/);
    expect(context).toEqual({ surface: 'layer-order:engine', tags: { reason: 'wasm_trap', role: 'dialog' } });
    expect(fake.workers).toHaveLength(1);
  });

  it('a slice that traps drops the worker as any call does, and the count with it', async () => {
    const fake = fakeLayerOrderWorkers();
    const runtime = createLayerOrderRuntime({ role: 'dialog', spawn: fake.spawn, count: FAKE_LIMITS });
    runtime.setCounting(true);
    const opening = runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    fake.workers[0]!.backend.trapNext('countSlice');
    await opening;
    await vi.waitFor(() => expect(fake.workers[0]!.terminated).toBe(true), { interval: 2 });
    expect(runtime.count()).toBeNull();
    expect(monitoring.reportError).toHaveBeenCalledTimes(1);
    expect(monitoring.reportError.mock.calls[0]![1]).toEqual({
      surface: 'layer-order:engine',
      tags: { reason: 'wasm_trap', role: 'dialog' },
    });
  });

  it('a refusal is an answer, and an engine’s own envelope a rejection; neither is a loss', async () => {
    const { runtime, worker } = opened();
    await expect(runtime.engine.openPairs()).rejects.toMatchObject({ code: 'layer_order_session_not_open' });
    await expect(runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, { ...FAKE_LIMITS, maxNodes: 0 })).resolves.toEqual({
      status: 'refused',
      refusal: { code: 'session_timed_out', limit: 'nodes', nodes: 0 },
    });
    await runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    await expect(runtime.engine.preview([0, 9, 1], FAKE_LIMITS)).rejects.toMatchObject({
      code: 'session_bad_constraint',
    });
    expect(worker().terminated).toBe(false);
    expect(runtime.generation()).toBe(0);
    expect(monitoring.reportError).not.toHaveBeenCalled();
  });

  it('tags a crash with the role of the worker that crashed', async () => {
    const fake = fakeLayerOrderWorkers(() => createFakeLayerOrderBackend());
    const runtime = createLayerOrderRuntime({ role: 'host', spawn: fake.spawn });
    const pending = runtime.engine.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS).catch((e: unknown) => e);
    fake.workers[0]!.crash('out of memory');
    await pending;
    expect(monitoring.reportError.mock.calls[0]![1]).toEqual({
      surface: 'layer-order:engine',
      tags: { reason: 'worker_error', role: 'host' },
    });
  });
});
