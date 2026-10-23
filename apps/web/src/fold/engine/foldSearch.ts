/**
 * The searches Fold runs in TypeScript over the engine's public calls — a
 * pleat's orders (`tools/pleat/pleatEngine.ts`), a repeat's preparation
 * (`repeat/repeatPreparation.ts`) — and the two ways they are run.
 *
 * Each search is a generator that yields between engine calls: a yield is a
 * point where it may be stopped, with everything it holds let go by its own
 * `finally`. Its bounds are counts (orders, attempts, steps); what bounds its
 * time is the budget its driver keeps, which these counts alone do not — a
 * pleat whose every leg runs the engine's placement search to its last batch
 * takes 1.35 s a leg, and sixty-five legs fit the counts.
 *
 * - {@link runFoldSearch} runs one to the end in one go, the budget checked at
 *   each yield: what the synchronous calls (`FoldEngineCalls`, a replay, the
 *   tests) take.
 * - {@link createFoldSearchRunner} runs one in the worker: it gives the thread
 *   back between engine calls, so a cancel and the reading calls the canvas
 *   keeps asking get through, and stops the search at its next yield when its
 *   ticket is cancelled.
 *
 * At a stop, {@link FoldSearchStopped} is thrown into the search at the yield.
 * A search answers `budget` with its own limit refusal, the one its tool
 * already words; `cancelled` it lets through, and the runner rejects with
 * {@link FOLD_SEARCH_CANCELLED}, which the asker — who cancelled it — drops.
 *
 * Pure: no React, no store, no wasm import.
 */
import type { WasmErrorEnvelope } from '../../engine/types';

/** A search: it yields between engine calls and returns its answer. */
export type FoldSearch<T> = Generator<void, T, void>;

/** Why a search was stopped at a yield. */
export type FoldSearchStop = 'budget' | 'cancelled';

export class FoldSearchStopped extends Error {
  constructor(readonly reason: FoldSearchStop) {
    super(`fold search stopped: ${reason}`);
  }
}

/** A search the main thread can cancel, by a number it chose (`foldSearchTicket`). */
export interface FoldSearchTicket {
  readonly id: number;
}

/** The code a cancelled search's call rejects with; its asker has already stopped listening. */
export const FOLD_SEARCH_CANCELLED = 'fold_search_cancelled';

export function isFoldSearchCancelled(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === FOLD_SEARCH_CANCELLED;
}

let nextTicket = 1;

/** A new ticket: unique for the life of the page, whichever worker it goes to. */
export function foldSearchTicket(): FoldSearchTicket {
  return { id: nextTicket++ };
}

export interface FoldSearchClock {
  /** Milliseconds, monotonic: `performance.now`. */
  now(): number;
}

const performanceClock: FoldSearchClock = { now: () => performance.now() };

/**
 * Run a search to its end without giving the thread back, stopping it with
 * `budget` at the first yield after `budgetMs`.
 */
export function runFoldSearch<T>(search: FoldSearch<T>, budgetMs: number, clock: FoldSearchClock = performanceClock): T {
  const deadline = clock.now() + budgetMs;
  let step = search.next();
  while (!step.done) step = clock.now() >= deadline ? search.throw(new FoldSearchStopped('budget')) : search.next();
  return step.value;
}

/**
 * The next task: what lets a worker's queued messages in. A message on a
 * fresh channel, not a timeout, which browsers clamp to 4 ms once nested.
 */
export function nextFoldTask(): Promise<void> {
  if (typeof MessageChannel !== 'function') return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      resolve();
    };
    port2.postMessage(null);
  });
}

export interface FoldSearchRunnerOptions {
  clock?: FoldSearchClock;
  /** Give the thread back at a yield once this long has passed since it last was. */
  sliceMs?: number;
  /** How the thread is given back; the next task by default. */
  yieldTask?: () => Promise<void>;
}

export interface FoldSearchRunner {
  /**
   * Run a search, giving the thread back between engine calls. Resolves with
   * its answer — its own refusal when the budget ran out — or rejects with
   * {@link FOLD_SEARCH_CANCELLED} once its ticket is cancelled.
   */
  run<T>(search: FoldSearch<T>, budgetMs: number, ticket?: FoldSearchTicket): Promise<T>;
  /**
   * Stop the ticket's search at its next yield, or before it starts. A ticket
   * whose search has already finished is forgotten.
   */
  cancel(id: number): void;
  /** Whether a search is running now. */
  running(): boolean;
}

/** How long a search runs between giving the thread back. */
export const FOLD_SEARCH_SLICE_MS = 16;

/**
 * One worker's searches. Tickets are numbered in the order they were made,
 * and a search's caller holds the worker's gate while it runs, so they run in
 * that order: a cancel for a ticket at or below the last one finished names
 * a search that is over, and is not kept.
 */
export function createFoldSearchRunner(options: FoldSearchRunnerOptions = {}): FoldSearchRunner {
  const clock = options.clock ?? performanceClock;
  const sliceMs = options.sliceMs ?? FOLD_SEARCH_SLICE_MS;
  const yieldTask = options.yieldTask ?? nextFoldTask;
  const cancelled = new Set<number>();
  let finished = 0;
  let active = 0;

  const stopped = (ticket: FoldSearchTicket | undefined) => ticket !== undefined && cancelled.has(ticket.id);
  const done = (ticket: FoldSearchTicket | undefined) => {
    if (!ticket) return;
    finished = Math.max(finished, ticket.id);
    for (const id of cancelled) if (id <= finished) cancelled.delete(id);
  };

  return {
    async run<T>(search: FoldSearch<T>, budgetMs: number, ticket?: FoldSearchTicket): Promise<T> {
      active += 1;
      try {
        if (stopped(ticket)) {
          search.return(undefined as T);
          throw cancelledError();
        }
        const deadline = clock.now() + budgetMs;
        let given = clock.now();
        let step = search.next();
        while (!step.done) {
          if (clock.now() - given >= sliceMs) {
            await yieldTask();
            given = clock.now();
          }
          const stop: FoldSearchStop | null = stopped(ticket) ? 'cancelled' : clock.now() >= deadline ? 'budget' : null;
          step = stop ? search.throw(new FoldSearchStopped(stop)) : search.next();
        }
        return step.value;
      } catch (error) {
        if (error instanceof FoldSearchStopped && error.reason === 'cancelled') throw cancelledError();
        throw error;
      } finally {
        active -= 1;
        done(ticket);
      }
    },

    cancel(id) {
      if (id > finished) cancelled.add(id);
    },

    running: () => active > 0,
  };
}

/**
 * The worker's queue of calls that change the engine: each runs once every
 * one before it has finished — a search through all its slices — in the
 * order they came. A call that only reads the engine is not queued, so it is
 * answered between a search's slices.
 */
export function createFoldEngineTurns(): <T>(run: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(run: () => Promise<T>) => {
    const next = last.then(run);
    last = next.catch(() => undefined);
    return next;
  };
}

function cancelledError(): WasmErrorEnvelope {
  return { code: FOLD_SEARCH_CANCELLED, message: 'The search was cancelled.' };
}
