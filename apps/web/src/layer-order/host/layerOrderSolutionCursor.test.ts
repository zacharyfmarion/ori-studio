// @vitest-environment jsdom
/**
 * A host's solutions cursor (row H6) against fake workers that run the real
 * worker shell over the fake backend (`engine/layerOrderEngine.fixtures.ts`):
 * its first step restores the record and keeps the session, later steps
 * only step, in the stepper's fixed order; each step that moved answers what
 * the host folds; a record that doesn't restore, a Stop and a lost engine
 * each spend it, its worker terminated; and the count is skipped on a figure
 * too large for it (D7).
 *
 * The toy figure stacks four faces on one spot, its creases forcing 0 above
 * 1. "D in front of A" (3 above 0) leaves four orders: 2 at any height
 * above 3, between 3 and 0, between 0 and 1, or at the bottom. From the
 * front that is two pictures (2 or 3 on top), and the restore opens on 3 on
 * top, 2 at the bottom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
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
import { KEEP_TRYING_FACTOR } from '../engine/layerOrderEngine';
import {
  createLayerOrderSolutionCursor,
  type LayerOrderSolutionCursorOptions,
  type LayerOrderSolutionStep,
} from './layerOrderSolutionCursor';

const monitoring = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('../../monitoring', () => ({ reportError: monitoring.reportError }));

/** Whether the count runs at all (D7): the figure's size, which the toy figure is never. */
const budgets = vi.hoisted(() => ({ counts: true }));
vi.mock('../layerOrderBudgets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../layerOrderBudgets')>()),
  layerOrderCountStarts: () => budgets.counts,
}));

beforeEach(() => {
  monitoring.reportError.mockClear();
  budgets.counts = true;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const face = (k: number) => ({ at: FAKE_LAYER_ORDER_FIGURE.facePoints[k]!, area: 100 });

/** "D in front of A" (faces 3 and 0): 3 above 0. */
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

const FRONT = { picture: 'front' } as const;
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

/** A cursor over fake workers, each with a fresh backend; `prepare` readies the first one's. */
function cursorOverFakes(
  record: LayerOrderRecord = D_ABOVE_A,
  prepare?: (backend: FakeLayerOrderBackend) => void,
  limits?: LayerOrderSolutionCursorOptions['limits']
) {
  let made = 0;
  const fake = fakeLayerOrderWorkers(() => {
    const backend = createFakeLayerOrderBackend();
    if (made++ === 0) prepare?.(backend);
    return backend;
  });
  const cursor = createLayerOrderSolutionCursor(FAKE_LAYER_ORDER_SOURCE, record, {
    spawn: fake.spawn,
    ...(limits ? { limits } : {}),
  });
  const worker = (index = 0): FakeLayerOrderWorker => fake.workers[index]!;
  return { fake, cursor, worker };
}

function expectStep<K extends LayerOrderSolutionStep['outcome']>(
  step: LayerOrderSolutionStep,
  outcome: K
): asserts step is Extract<LayerOrderSolutionStep, { outcome: K }> {
  expect(step.outcome).toBe(outcome);
}

describe('a solutions cursor', () => {
  it('spawns nothing until its first step, which restores the record; later steps only step, on the same worker', async () => {
    const { fake, cursor, worker } = cursorOverFakes();
    expect(fake.workers).toHaveLength(0);
    await expect(cursor.place(FRONT)).resolves.toBeNull();
    expect(fake.workers).toHaveLength(0);

    // Back from 3 on top (2 of 2) to 2 on top: the first picture in the fixed order.
    const back = await cursor.step('previous', FRONT);
    expectStep(back, 'moved');
    expect(back.position).toEqual({ index: 1, total: { n: 2, exact: true } });
    expect(back.counted).toBe(true);
    // What the host folds: the order now shown, whole, and its record, on the source it was given.
    expect(Object.prototype.toString.call(back.applied.relations)).toBe('[object Uint32Array]');
    // 2, 3, 0, 1 from the top, as `[upper, lower, …]` pairs.
    expect(Array.from(back.applied.relations)).toEqual([0, 1, 2, 0, 2, 1, 2, 3, 3, 0, 3, 1]);
    expect(back.applied.source).toEqual(FAKE_LAYER_ORDER_SOURCE);
    expect(back.applied.record.constraints).toHaveLength(1);
    expect(back.applied.record).not.toHaveProperty('attention');
    expect(worker().backend.calls).toEqual(['restore', 'step', 'relations', 'save']);

    const on = await cursor.step('next', FRONT);
    expectStep(on, 'moved');
    expect(on.position).toEqual({ index: 2, total: { n: 2, exact: true } });
    expect(on.applied.record.order).not.toEqual(back.applied.record.order);
    expect(worker().backend.calls).toEqual(['restore', 'step', 'relations', 'save', 'step', 'relations', 'save']);
    expect(fake.workers).toHaveLength(1);
    expect(worker().terminated).toBe(false);
    expect(cursor.alive()).toBe(true);

    cursor.close();
    expect(worker().terminated).toBe(true);
    expect(cursor.alive()).toBe(false);
    await expect(cursor.step('next', FRONT)).resolves.toEqual({ outcome: 'cancelled' });
    expect(fake.workers).toHaveLength(1);
  });

  it('steps through every layer order with X-ray on (D5), and answers its end with where it stands, writing nothing', async () => {
    const { cursor, worker } = cursorOverFakes();
    const indices: number[] = [];
    for (let step = await cursor.step('next', 'layer_order'); step.outcome === 'moved'; step = await cursor.step('next', 'layer_order')) {
      indices.push(step.position.index);
      expect(step.position.total).toEqual({ n: 4, exact: true });
    }
    expect(indices).toEqual([3, 4]);
    const end = await cursor.step('next', 'layer_order');
    expect(end).toEqual({ outcome: 'end', position: { index: 4, total: { n: 4, exact: true } }, counted: true });
    // An end asks where it stands, and saves nothing.
    expect(worker().backend.calls.slice(-2)).toEqual(['step', 'position']);
    // Where it stands from either side, as a host turned over asks.
    await expect(cursor.place(FRONT)).resolves.toEqual({ position: { index: 2, total: { n: 2, exact: true } }, counted: true });
    await expect(cursor.place({ picture: 'back' })).resolves.toMatchObject({ position: { total: { n: 2 } } });
    cursor.close();
  });

  it('keeps the restore’s summary on every record a step saves', async () => {
    const { cursor } = cursorOverFakes(WITH_A_GONE_FACE);
    const step = await cursor.step('previous', FRONT);
    expectStep(step, 'moved');
    expect(step.applied.record.constraints).toHaveLength(2);
    expect(step.applied.record.attention).toEqual({ reason: 'unresolved', count: 1 });
    cursor.close();
  });

  it('says only how many it counts are known on a figure too large to count (D7)', async () => {
    budgets.counts = false;
    const { cursor } = cursorOverFakes();
    const step = await cursor.step('previous', FRONT);
    expectStep(step, 'moved');
    expect(step.counted).toBe(false);
    cursor.close();
  });

  it('answers a restore out of time and stays; Keep trying restores the record again on the session open, longer', async () => {
    const asked: [string, number][] = [];
    const { cursor, worker } = cursorOverFakes(D_ABOVE_A, (backend) => {
      for (const call of ['restore', 'restoreRecord'] as const) {
        const answer = backend[call] as (...args: never[]) => Promise<unknown>;
        (backend as unknown as Record<string, unknown>)[call] = (...args: never[]) => {
          asked.push([call, (args.at(-1) as unknown as { deadlineMs: number }).deadlineMs]);
          return answer(...args);
        };
      }
    }, { restore: FAKE_NO_NODES, step: FAKE_LIMITS });
    await expect(cursor.step('next', FRONT)).resolves.toEqual({ outcome: 'timed_out', stage: 'restore' });
    expect(cursor.alive()).toBe(true);
    await expect(cursor.step('next', FRONT, { tries: 1 })).resolves.toEqual({ outcome: 'timed_out', stage: 'restore' });
    await expect(cursor.step('next', FRONT, { tries: 2 })).resolves.toEqual({ outcome: 'timed_out', stage: 'restore' });
    // The open held: the record again on it, a longer deadline each time, on the one worker.
    expect(asked).toEqual([
      ['restore', FAKE_NO_NODES.deadlineMs],
      ['restoreRecord', FAKE_NO_NODES.deadlineMs * KEEP_TRYING_FACTOR],
      ['restoreRecord', FAKE_NO_NODES.deadlineMs * KEEP_TRYING_FACTOR ** 2],
    ]);
    expect(worker().terminated).toBe(false);
    cursor.close();
  });

  it('opens again on Keep trying when the open itself ran out', async () => {
    const { cursor, worker } = cursorOverFakes(D_ABOVE_A, undefined, {
      restore: { ...FAKE_LIMITS, deadlineMs: 0 },
      step: FAKE_LIMITS,
    });
    await expect(cursor.step('next', FRONT)).resolves.toEqual({ outcome: 'timed_out', stage: 'restore' });
    await cursor.step('next', FRONT, { tries: 1 });
    expect(worker().backend.calls).toEqual(['restore', 'restore']);
    cursor.close();
  });

  it('answers a next solution too large to save on its own, and is spent', async () => {
    const { cursor, worker } = cursorOverFakes(D_ABOVE_A, (backend) => {
      (backend as unknown as Record<string, unknown>).save = async () => ({
        status: 'refused',
        refusal: { code: 'record_over_budget', bytes: 2_000_000, budget: 1_048_576 },
      });
    });
    await expect(cursor.step('previous', FRONT)).resolves.toEqual({ outcome: 'too_large' });
    expect(cursor.alive()).toBe(false);
    expect(worker().terminated).toBe(true);
  });

  it('has nothing to step from on a record whose constraints clash: unrestored, and spent', async () => {
    const { fake, cursor, worker } = cursorOverFakes(CLASHING);
    await expect(cursor.step('next', FRONT)).resolves.toEqual({ outcome: 'unrestored', why: 'clash' });
    expect(worker().backend.calls).toEqual(['restore']);
    expect(worker().terminated).toBe(true);
    expect(cursor.alive()).toBe(false);
    await expect(cursor.step('next', FRONT)).resolves.toEqual({ outcome: 'cancelled' });
    expect(fake.workers).toHaveLength(1);
  });
});

describe('a Stop', () => {
  it('terminates the step’s worker, which answers cancelled, and spends the cursor', async () => {
    const { fake, cursor, worker } = cursorOverFakes(D_ABOVE_A, (backend) => backend.hold('step'));
    const stop = new AbortController();
    const running = cursor.step('next', FRONT, { signal: stop.signal });
    await vi.waitFor(() => expect(worker()?.backend.calls).toEqual(['restore', 'step']), { interval: 2 });

    stop.abort();
    await expect(running).resolves.toEqual({ outcome: 'cancelled' });
    expect(worker().terminated).toBe(true);
    expect(cursor.alive()).toBe(false);
    await settle();
    expect(fake.workers).toHaveLength(1);
    expect(monitoring.reportError).not.toHaveBeenCalled();
  });

  it('before the step starts spawns nothing', async () => {
    const { fake, cursor } = cursorOverFakes();
    const stop = new AbortController();
    stop.abort();
    await expect(cursor.step('next', FRONT, { signal: stop.signal })).resolves.toEqual({ outcome: 'cancelled' });
    expect(fake.workers).toHaveLength(0);
  });
});

describe('engine loss', () => {
  it('a worker that dies mid-step answers lost, reported once by the runtime, and spends the cursor', async () => {
    const { cursor, worker } = cursorOverFakes(D_ABOVE_A, (backend) => backend.hold('step'));
    const running = cursor.step('next', FRONT);
    await vi.waitFor(() => expect(worker()?.backend.calls).toEqual(['restore', 'step']), { interval: 2 });
    worker().crash('out of memory');
    await expect(running).resolves.toEqual({ outcome: 'lost', cause: 'crashed' });
    expect(cursor.alive()).toBe(false);
    expect(monitoring.reportError).toHaveBeenCalledTimes(1);
    expect(monitoring.reportError.mock.calls[0]![1]).toEqual({
      surface: 'layer-order:engine',
      tags: { reason: 'worker_error', role: 'host' },
    });
  });

  it('a worker that dies between presses takes the cursor with it', async () => {
    const { cursor, worker } = cursorOverFakes();
    expect((await cursor.step('previous', FRONT)).outcome).toBe('moved');
    worker().crash('out of memory');
    await settle();
    expect(cursor.alive()).toBe(false);
    await expect(cursor.place(FRONT)).resolves.toBeNull();
  });

  it('a worker the browser never loaded (offline) answers lost as a load, reported to no one', async () => {
    const { cursor, worker } = cursorOverFakes(D_ABOVE_A, (backend) => backend.hold('restore'));
    const running = cursor.step('next', FRONT);
    await vi.waitFor(() => expect(worker()?.backend.calls).toEqual(['restore']), { interval: 2 });
    worker().failToLoad();
    await expect(running).resolves.toEqual({ outcome: 'lost', cause: 'load' });
    expect(monitoring.reportError).not.toHaveBeenCalled();
  });

  it('an engine whose wasm did not arrive answers lost as a load, reported to no one', async () => {
    const workers = inProcessLayerOrderWorkers(() => {
      throw new TypeError('Failed to fetch');
    });
    const cursor = createLayerOrderSolutionCursor(FAKE_LAYER_ORDER_SOURCE, D_ABOVE_A, { spawn: workers.spawn });
    await expect(cursor.step('next', FRONT)).resolves.toEqual({ outcome: 'lost', cause: 'load' });
    expect(monitoring.reportError).not.toHaveBeenCalled();
  });

  it('an engine that traps answers lost, reported once', async () => {
    const { cursor } = cursorOverFakes(D_ABOVE_A, (backend) => backend.trapNext('relations'));
    await expect(cursor.step('previous', FRONT)).resolves.toEqual({ outcome: 'lost', cause: 'crashed' });
    expect(monitoring.reportError).toHaveBeenCalledTimes(1);
    expect(monitoring.reportError.mock.calls[0]![1]).toEqual({
      surface: 'layer-order:engine',
      tags: { reason: 'wasm_trap', role: 'host' },
    });
  });
});
