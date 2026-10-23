import { describe, expect, it } from 'vitest';
import {
  createFoldEngineTurns,
  createFoldSearchRunner,
  FOLD_SEARCH_CANCELLED,
  foldSearchTicket,
  FoldSearchStopped,
  isFoldSearchCancelled,
  runFoldSearch,
  type FoldSearch,
} from './foldSearch';

/** A clock the test moves. */
function clock() {
  let now = 0;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

/** A gate the runner waits on between slices, opened by the test. */
function gate() {
  let open: () => void = () => {};
  let waiting = 0;
  return {
    yieldTask: () => {
      waiting += 1;
      return new Promise<void>((resolve) => (open = resolve));
    },
    open: () => open(),
    waiting: () => waiting,
  };
}

/**
 * A search of `steps` engine calls, each of `cost` ms on the clock, holding a
 * handle per call and letting every one go however it ends — as the Pleat and
 * Repeat searches do. Out of budget it answers `limit`.
 */
function* counting(
  steps: number,
  time: ReturnType<typeof clock>,
  held: Set<number>,
  cost = 10
): FoldSearch<string> {
  const mine: number[] = [];
  try {
    for (let i = 0; i < steps; i++) {
      time.advance(cost);
      mine.push(i);
      held.add(i);
      yield;
    }
    return `done ${steps}`;
  } catch (error) {
    if (error instanceof FoldSearchStopped && error.reason === 'budget') return `limit after ${mine.length}`;
    throw error;
  } finally {
    for (const handle of mine) held.delete(handle);
  }
}

describe('runFoldSearch', () => {
  it('runs a search that fits its budget to the end', () => {
    const time = clock(), held = new Set<number>();
    expect(runFoldSearch(counting(5, time, held), 1000, time)).toBe('done 5');
    expect(held.size).toBe(0);
  });

  it('stops a search at the first yield past its budget, which answers its own limit and lets go of what it held', () => {
    const time = clock(), held = new Set<number>();
    expect(runFoldSearch(counting(100, time, held), 35, time)).toBe('limit after 4');
    expect(held.size).toBe(0);
  });
});

describe('createFoldSearchRunner', () => {
  it('answers as the synchronous run does when nothing stops it', async () => {
    const time = clock(), held = new Set<number>();
    const runner = createFoldSearchRunner({ clock: time, sliceMs: 0, yieldTask: () => Promise.resolve() });
    await expect(runner.run(counting(5, time, held), 1000, foldSearchTicket())).resolves.toBe('done 5');
    await expect(runner.run(counting(100, time, held), 35, foldSearchTicket())).resolves.toBe('limit after 4');
    expect(held.size).toBe(0);
    expect(runner.running()).toBe(false);
  });

  it('stops a cancelled search at its next slice: it rejects as cancelled, holding nothing', async () => {
    const time = clock(), held = new Set<number>(), between = gate();
    const runner = createFoldSearchRunner({ clock: time, sliceMs: 0, yieldTask: between.yieldTask });
    const ticket = foldSearchTicket();
    const running = runner.run(counting(100, time, held), 60_000, ticket);
    // Paused between two engine calls, holding what it has landed so far.
    expect(between.waiting()).toBe(1);
    expect(held.size).toBe(1);
    expect(runner.running()).toBe(true);
    runner.cancel(ticket.id);
    between.open();
    const error = await running.catch((reason: unknown) => reason);
    expect(isFoldSearchCancelled(error)).toBe(true);
    expect(error).toMatchObject({ code: FOLD_SEARCH_CANCELLED });
    expect(held.size).toBe(0);
    expect(runner.running()).toBe(false);
  });

  it('never starts a search cancelled while it waited its turn', async () => {
    const time = clock(), held = new Set<number>();
    const runner = createFoldSearchRunner({ clock: time, sliceMs: 0, yieldTask: () => Promise.resolve() });
    const ticket = foldSearchTicket();
    runner.cancel(ticket.id);
    await expect(runner.run(counting(5, time, held), 1000, ticket)).rejects.toMatchObject({ code: FOLD_SEARCH_CANCELLED });
    expect(held.size).toBe(0);
  });

  it('forgets a cancel that comes after its search finished, so no later search is stopped by it', async () => {
    const time = clock(), held = new Set<number>();
    const runner = createFoldSearchRunner({ clock: time, sliceMs: 0, yieldTask: () => Promise.resolve() });
    const first = foldSearchTicket();
    await expect(runner.run(counting(2, time, held), 1000, first)).resolves.toBe('done 2');
    runner.cancel(first.id);
    await expect(runner.run(counting(2, time, held), 1000, foldSearchTicket())).resolves.toBe('done 2');
  });

  it('gives the thread back only once a slice has run', async () => {
    const time = clock(), held = new Set<number>();
    let given = 0;
    const runner = createFoldSearchRunner({ clock: time, sliceMs: 25, yieldTask: async () => void (given += 1) });
    // Ten calls of 10 ms: the thread goes back after every third.
    await runner.run(counting(10, time, held), 60_000);
    expect(given).toBe(3);
  });
});

describe('createFoldEngineTurns', () => {
  it('holds a call that changes the engine behind a search, while a reading call is answered between its slices', async () => {
    const time = clock(), held = new Set<number>(), between = gate();
    const runner = createFoldSearchRunner({ clock: time, sliceMs: 0, yieldTask: between.yieldTask });
    const turns = createFoldEngineTurns();
    const order: string[] = [];
    const ticket = foldSearchTicket();
    const search = turns(() => runner.run(counting(100, time, held), 60_000, ticket)).catch(() => order.push('search stopped'));
    const change = turns(async () => order.push('change'));
    // Let the search reach its first slice.
    await Promise.resolve();
    await Promise.resolve();
    expect(between.waiting()).toBe(1);
    // A read is not queued: it runs now, while the search is paused.
    order.push('read');
    expect(order).toEqual(['read']);
    runner.cancel(ticket.id);
    between.open();
    await Promise.all([search, change]);
    expect(order).toEqual(['read', 'search stopped', 'change']);
  });

  it('keeps the queue going after a call that failed', async () => {
    const turns = createFoldEngineTurns();
    await expect(turns(() => Promise.reject(new Error('refused')))).rejects.toThrow('refused');
    await expect(turns(async () => 'next')).resolves.toBe('next');
  });
});
