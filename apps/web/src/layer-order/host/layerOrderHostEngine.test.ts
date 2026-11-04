// @vitest-environment jsdom
/**
 * The host engine against fake workers that run the real worker shell over
 * the fake backend through comlink (`engine/layerOrderEngine.fixtures.ts`):
 * everything but the bridge and the `Worker` itself. Row H2's gates: a Stop
 * terminates a running resolve, which answers `cancelled`; engine loss is
 * `lost`, reported once, never thrown; a batch reuses one worker and closes
 * it; a timed-out restore retried with a later deadline succeeds on the same
 * worker.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import { stopFoldRun, withFoldInFlight, type FoldRunStore } from '../../store/workspaceStore/foldRuns';
import type { OristudioCpFoldRun } from '../../store/workspaceStore/types';
import {
  FAKE_LAYER_ORDER_FIGURE,
  FAKE_LAYER_ORDER_SOURCE,
  FAKE_LIMITS,
  FAKE_NO_NODES,
  createFakeLayerOrderBackend,
  fakeLayerOrderWorkers,
  inProcessLayerOrderWorkers,
  type FakeLayerOrderBackend,
  type FakeLayerOrderWorker,
} from '../engine/layerOrderEngine.fixtures';
import type { LayerOrderLimits } from '../engine/layerOrderEngine';
import { registerWorkerFailureSink } from '../../lib/workerDiagnostics';
import { createLayerOrderResolveBatch } from './layerOrderHostEngine';
import type { LayerOrderResolution } from './layerOrderResolution';

const monitoring = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('../../monitoring', () => ({ reportError: monitoring.reportError }));

const cancellation = vi.hoisted(() => ({
  next: 0,
  beginFoldRun: vi.fn(() => ++cancellation.next),
  cancelFoldRun: vi.fn(),
  foldCancellationAvailable: vi.fn(() => true),
}));
vi.mock('../../lib/foldCancellation', () => cancellation);

beforeEach(() => {
  monitoring.reportError.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A face of the toy figure, as a record saves it: its point on the crease pattern. */
const face = (k: number) => ({ at: FAKE_LAYER_ORDER_FIGURE.facePoints[k]!, area: 100 });

/** "D in front of A" (faces 3 and 0), which moves D above A: a check with no nodes runs out on it. */
const D_ABOVE_A: LayerOrderRecord = { faces: [face(3), face(0)], constraints: [[0, 1, 1]], order: [] };

/** That, and a constraint on a face no longer there. */
const WITH_A_GONE_FACE: LayerOrderRecord = {
  faces: [face(3), face(0), { at: [99, 99], area: 100 }, face(2)],
  constraints: [
    [0, 1, 1],
    [2, 3, 1],
  ],
  order: [],
};

/** D above A, and A above D: a clash. */
const CLASHING: LayerOrderRecord = {
  faces: [face(3), face(0)],
  constraints: [
    [0, 1, 1],
    [1, 0, -1],
  ],
  order: [],
};

/** An open with no time at all: the open itself runs out. */
const NO_TIME: LayerOrderLimits = { ...FAKE_LIMITS, deadlineMs: 0 };

const tag = (value: unknown) => Object.prototype.toString.call(value);
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

/**
 * A batch over fake workers, each with a fresh backend. `prepare` readies the
 * first worker's before it is spawned (a hold, a trap), since a resolve's
 * first call reaches it a task after the spawn.
 */
function batchOverFakes(prepare?: (backend: FakeLayerOrderBackend) => void) {
  let made = 0;
  const fake = fakeLayerOrderWorkers(() => {
    const backend = createFakeLayerOrderBackend();
    if (made++ === 0) prepare?.(backend);
    return backend;
  });
  const batch = createLayerOrderResolveBatch({ spawn: fake.spawn });
  const worker = (index = 0): FakeLayerOrderWorker => fake.workers[index]!;
  return { fake, batch, worker };
}

function expectOutcome<K extends LayerOrderResolution['outcome']>(
  resolution: LayerOrderResolution,
  outcome: K
): asserts resolution is Extract<LayerOrderResolution, { outcome: K }> {
  expect(resolution.outcome).toBe(outcome);
}

describe('a resolve', () => {
  it('spawns nothing until it is asked, and applies a record whose constraints fit', async () => {
    const { fake, batch, worker } = batchOverFakes();
    expect(fake.workers).toHaveLength(0);

    const resolved = await batch.resolve(FAKE_LAYER_ORDER_SOURCE, D_ABOVE_A, FAKE_LIMITS);
    expectOutcome(resolved, 'applied');
    expect(resolved.found.saved_constraints).toEqual([{ status: 'intact' }]);
    expect(resolved.found.carried).toEqual([]);
    expect(resolved.found.opened_on).toEqual({ kind: 'first', timed_out: null });
    expect(resolved.attention).toBeNull();
    // The full order shown, D above A: what the host seeds its fold with.
    expect(tag(resolved.applied.relations)).toBe('[object Uint32Array]');
    expect(Array.from(resolved.applied.relations)).toEqual([0, 1, 0, 2, 1, 2, 3, 0, 3, 1, 3, 2]);
    expect(resolved.applied.source).toEqual(FAKE_LAYER_ORDER_SOURCE);
    // The record of the order now shown, the same one the host stores.
    expect(resolved.applied.record).toBe(resolved.record);
    expect(resolved.record.constraints).toHaveLength(1);
    expect(resolved.record).not.toHaveProperty('attention');
    expect(worker().backend.calls).toEqual(['restore', 'relations', 'save']);

    batch.close();
    expect(worker().terminated).toBe(true);
    expect(monitoring.reportError).not.toHaveBeenCalled();
  });

  it('applies what is intact, carries the rest, and flags it unresolved', async () => {
    const { batch } = batchOverFakes();
    const resolved = await batch.resolve(FAKE_LAYER_ORDER_SOURCE, WITH_A_GONE_FACE, FAKE_LIMITS);
    expectOutcome(resolved, 'applied');
    expect(resolved.found.saved_constraints).toEqual([{ status: 'intact' }, { status: 'gone', cause: 'face_gone' }]);
    expect(resolved.found.carried.map((row) => row.index)).toEqual([1]);
    expect(resolved.attention).toEqual({ reason: 'unresolved', count: 1 });
    // Nothing dropped: the save writes the carried row back, and the summary goes with it.
    expect(resolved.record.constraints).toHaveLength(2);
    expect(resolved.record.attention).toEqual({ reason: 'unresolved', count: 1 });
    batch.close();
  });

  it('keeps the record on a clash, flagged, and folds nothing', async () => {
    const { batch, worker } = batchOverFakes();
    const resolved = await batch.resolve(FAKE_LAYER_ORDER_SOURCE, CLASHING, FAKE_LIMITS);
    expectOutcome(resolved, 'clash');
    expect(resolved.clashing).toEqual([0, 1]);
    expect(resolved.found.saved_constraints).toEqual([{ status: 'clashing' }, { status: 'clashing' }]);
    expect(resolved.attention).toEqual({ reason: 'conflict', count: 2 });
    expect(resolved.record).toEqual({ ...CLASHING, attention: { reason: 'conflict', count: 2 } });
    expect(worker().backend.calls).toEqual(['restore']);
    batch.close();
  });

  it('clears a summary the record carried once it applies', async () => {
    const { batch } = batchOverFakes();
    const flagged = { ...D_ABOVE_A, attention: { reason: 'timeout', count: 1 } } as const;
    const resolved = await batch.resolve(FAKE_LAYER_ORDER_SOURCE, flagged, FAKE_LIMITS);
    expectOutcome(resolved, 'applied');
    expect(resolved.attention).toBeNull();
    expect(resolved.record).not.toHaveProperty('attention');
    batch.close();
  });
});

describe('running out of time', () => {
  it('is an answer: the record kept, flagged as a timeout', async () => {
    const { batch, worker } = batchOverFakes();
    const resolved = await batch.resolve(FAKE_LAYER_ORDER_SOURCE, D_ABOVE_A, FAKE_NO_NODES);
    expectOutcome(resolved, 'timed_out');
    expect(resolved).toMatchObject({ limit: 'nodes', nodes: 0 });
    expect(resolved.found?.saved_constraints).toEqual([{ status: 'intact' }]);
    expect(resolved.attention).toEqual({ reason: 'timeout', count: 1 });
    expect(resolved.record).toEqual({ ...D_ABOVE_A, attention: { reason: 'timeout', count: 1 } });
    expect(worker().backend.calls).toEqual(['restore']);
    batch.close();
  });

  it('a restore that ran out, retried with later limits, succeeds on the same worker', async () => {
    const { fake, batch, worker } = batchOverFakes();
    const resolved = await batch.resolve(FAKE_LAYER_ORDER_SOURCE, D_ABOVE_A, FAKE_NO_NODES, {
      retries: [FAKE_NO_NODES, FAKE_LIMITS],
    });
    expectOutcome(resolved, 'applied');
    expect(resolved.found.saved_constraints).toEqual([{ status: 'intact' }]);
    // The session the first restore opened, restored again twice: no second open, no second worker.
    expect(worker().backend.calls).toEqual(['restore', 'restoreRecord', 'restoreRecord', 'relations', 'save']);
    expect(fake.workers).toHaveLength(1);
    batch.close();
  });

  it('an open that ran out is asked again from the open, and stops retrying once it answers', async () => {
    const { batch, worker } = batchOverFakes();
    const out = await batch.resolve(FAKE_LAYER_ORDER_SOURCE, D_ABOVE_A, NO_TIME);
    expectOutcome(out, 'timed_out');
    expect(out).toMatchObject({ limit: 'deadline', found: null, attention: { reason: 'timeout', count: 1 } });

    const resolved = await batch.resolve(FAKE_LAYER_ORDER_SOURCE, D_ABOVE_A, NO_TIME, {
      retries: [FAKE_LIMITS, FAKE_NO_NODES],
    });
    expectOutcome(resolved, 'applied');
    expect(worker().backend.calls).toEqual(['restore', 'restore', 'restore', 'relations', 'save']);
    batch.close();
  });
});

describe('a Stop', () => {
  it('terminates a running resolve, which answers cancelled', async () => {
    const { fake, batch, worker } = batchOverFakes((backend) => backend.hold('restore'));
    const stop = new AbortController();
    const running = batch.resolve(FAKE_LAYER_ORDER_SOURCE, D_ABOVE_A, FAKE_LIMITS, { signal: stop.signal });
    await vi.waitFor(() => expect(worker()?.backend.calls).toEqual(['restore']), { interval: 2 });

    stop.abort();
    await expect(running).resolves.toEqual({ outcome: 'cancelled' });
    expect(worker().terminated).toBe(true);
    // Nothing more is asked of a worker that is gone, and nothing is spawned for it.
    await settle();
    expect(fake.workers).toHaveLength(1);
    expect(monitoring.reportError).not.toHaveBeenCalled();

    // The batch goes on, on a fresh worker.
    const next = await batch.resolve(FAKE_LAYER_ORDER_SOURCE, D_ABOVE_A, FAKE_LIMITS);
    expect(next.outcome).toBe('applied');
    expect(fake.workers).toHaveLength(2);
    batch.close();
  });

  it('before the resolve starts spawns nothing', async () => {
    const { fake, batch } = batchOverFakes();
    const stop = new AbortController();
    stop.abort();
    await expect(
      batch.resolve(FAKE_LAYER_ORDER_SOURCE, D_ABOVE_A, FAKE_LIMITS, { signal: stop.signal })
    ).resolves.toEqual({ outcome: 'cancelled' });
    expect(fake.workers).toHaveLength(0);
  });

  it('of the fold run around it reaches it: the run’s stop signal', async () => {
    let state = { oristudioCpFoldRuns: {} as Record<number, OristudioCpFoldRun> };
    const store: FoldRunStore = {
      get: () => state,
      set: (partial) => {
        state = { ...state, ...partial };
      },
    };
    const { batch, worker } = batchOverFakes((backend) => backend.hold('restore'));
    let runId = 0;
    const refold = withFoldInFlight(store, 'refold', (id, stop) => {
      runId = id;
      return batch.resolve(FAKE_LAYER_ORDER_SOURCE, D_ABOVE_A, FAKE_LIMITS, { signal: stop });
    });
    await vi.waitFor(() => expect(worker()?.backend.calls).toEqual(['restore']), { interval: 2 });

    // The Diagram card's Stop of this run; the toast's Stop of every run goes the same way.
    expect(stopFoldRun(store, runId)).toBe(true);
    await expect(refold).resolves.toEqual({ outcome: 'cancelled' });
    expect(worker().terminated).toBe(true);
    expect(state.oristudioCpFoldRuns).toEqual({});
    expect(cancellation.cancelFoldRun).toHaveBeenCalledWith(runId);
    batch.close();
  });
});

describe('engine loss', () => {
  it('a worker that dies mid-resolve answers lost, reported once by the runtime', async () => {
    const { batch, worker } = batchOverFakes((backend) => backend.hold('restore'));
    const running = batch.resolve(FAKE_LAYER_ORDER_SOURCE, D_ABOVE_A, FAKE_LIMITS);
    await vi.waitFor(() => expect(worker()?.backend.calls).toEqual(['restore']), { interval: 2 });
    worker().crash('out of memory');

    const resolved = await running;
    expect(resolved).toEqual({
      outcome: 'lost',
      cause: 'crashed',
      record: { ...D_ABOVE_A, attention: { reason: 'timeout', count: 1 } },
      attention: { reason: 'timeout', count: 1 },
    });
    expect(monitoring.reportError).toHaveBeenCalledTimes(1);
    expect(monitoring.reportError.mock.calls[0]![1]).toEqual({
      surface: 'layer-order:engine',
      tags: { reason: 'worker_error', role: 'host' },
    });
    batch.close();
  });

  it('an engine that traps answers lost, reported once', async () => {
    const { batch, worker } = batchOverFakes((backend) => backend.trapNext('relations'));
    const resolved = await batch.resolve(FAKE_LAYER_ORDER_SOURCE, D_ABOVE_A, FAKE_LIMITS);
    expectOutcome(resolved, 'lost');
    expect(resolved.cause).toBe('crashed');
    expect(monitoring.reportError).toHaveBeenCalledTimes(1);
    expect(monitoring.reportError.mock.calls[0]![1]).toEqual({
      surface: 'layer-order:engine',
      tags: { reason: 'wasm_trap', role: 'host' },
    });
    expect(worker().terminated).toBe(true);
    batch.close();
  });

  it('a worker the browser never loaded answers lost as a load failure, reported to no one, the app’s error toast told nothing', async () => {
    const sink = vi.fn();
    registerWorkerFailureSink(sink);
    const { batch, worker } = batchOverFakes((backend) => backend.hold('restore'));
    const running = batch.resolve(FAKE_LAYER_ORDER_SOURCE, D_ABOVE_A, FAKE_LIMITS);
    await vi.waitFor(() => expect(worker()?.backend.calls).toEqual(['restore']), { interval: 2 });
    worker().failToLoad();
    const resolved = await running;
    expectOutcome(resolved, 'lost');
    expect(resolved.cause).toBe('load');
    expect(monitoring.reportError).not.toHaveBeenCalled();
    expect(sink).not.toHaveBeenCalled();
    registerWorkerFailureSink(null);
    batch.close();
  });

  it('an engine whose wasm did not arrive answers lost as a load failure, reported to no one', async () => {
    const workers = inProcessLayerOrderWorkers(() => {
      throw new TypeError('Failed to fetch');
    });
    const batch = createLayerOrderResolveBatch({ spawn: workers.spawn });
    const resolved = await batch.resolve(FAKE_LAYER_ORDER_SOURCE, D_ABOVE_A, FAKE_LIMITS);
    expectOutcome(resolved, 'lost');
    expect(resolved.cause).toBe('load');
    expect(monitoring.reportError).not.toHaveBeenCalled();
    batch.close();
  });

  it('an engine that never starts answers lost as unavailable, reported once here', async () => {
    const workers = inProcessLayerOrderWorkers(() => {
      throw new Error('The wasm did not arrive.');
    });
    const batch = createLayerOrderResolveBatch({ spawn: workers.spawn });
    const resolved = await batch.resolve(FAKE_LAYER_ORDER_SOURCE, D_ABOVE_A, FAKE_LIMITS);
    expectOutcome(resolved, 'lost');
    expect(resolved.cause).toBe('unavailable');
    expect(resolved.record.attention).toEqual({ reason: 'timeout', count: 1 });
    expect(monitoring.reportError).toHaveBeenCalledTimes(1);
    expect(monitoring.reportError.mock.calls[0]![0]).toMatchObject({ code: 'layer_order_engine_unavailable' });
    expect(monitoring.reportError.mock.calls[0]![1]).toEqual({
      surface: 'layer-order:host',
      tags: { cause: 'unavailable' },
    });
    batch.close();
  });
});

describe('a batch', () => {
  it('reuses one worker across its resolves, one at a time, and closing it terminates the worker', async () => {
    const { fake, batch, worker } = batchOverFakes();
    // Asked all at once, as a Refresh All might: each resolve has the worker's one session to itself.
    const answers = await Promise.all([
      batch.resolve(FAKE_LAYER_ORDER_SOURCE, D_ABOVE_A, FAKE_LIMITS),
      batch.resolve(FAKE_LAYER_ORDER_SOURCE, CLASHING, FAKE_LIMITS),
      batch.resolve(FAKE_LAYER_ORDER_SOURCE, WITH_A_GONE_FACE, FAKE_LIMITS),
    ]);
    expect(answers.map((answer) => answer.outcome)).toEqual(['applied', 'clash', 'applied']);
    expect(fake.workers).toHaveLength(1);
    expect(worker().backend.calls).toEqual(['restore', 'relations', 'save', 'restore', 'restore', 'relations', 'save']);
    expect(worker().terminated).toBe(false);

    batch.close();
    expect(worker().terminated).toBe(true);
    batch.close();
    await expect(batch.resolve(FAKE_LAYER_ORDER_SOURCE, D_ABOVE_A, FAKE_LIMITS)).resolves.toEqual({
      outcome: 'cancelled',
    });
    expect(fake.workers).toHaveLength(1);
  });

  it('a Stop of the whole batch cancels what runs and what waits', async () => {
    const backend = createFakeLayerOrderBackend();
    backend.hold('restore');
    const fake = fakeLayerOrderWorkers(() => backend);
    const stop = new AbortController();
    const batch = createLayerOrderResolveBatch({ spawn: fake.spawn, signal: stop.signal });
    const first = batch.resolve(FAKE_LAYER_ORDER_SOURCE, D_ABOVE_A, FAKE_LIMITS);
    const second = batch.resolve(FAKE_LAYER_ORDER_SOURCE, CLASHING, FAKE_LIMITS);
    await vi.waitFor(() => expect(backend.calls).toEqual(['restore']), { interval: 2 });

    stop.abort();
    await expect(first).resolves.toEqual({ outcome: 'cancelled' });
    await expect(second).resolves.toEqual({ outcome: 'cancelled' });
    expect(fake.workers[0]!.terminated).toBe(true);
    expect(fake.workers).toHaveLength(1);
  });
});
