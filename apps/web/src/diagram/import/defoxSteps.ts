import * as Comlink from 'comlink';
import { attachWorkerDiagnostics } from '../../lib/workerDiagnostics';
import type { DefoxImportWorkerApi } from '../../workers/defoxImportWorker';
import type { DefoxEntry, DrawnDefoxStep } from './defoxRenderer';

/** A worker that opens a Defox project and draws its steps one at a time. */
export interface DefoxWorker {
  /** Moves `bytes` to the worker and opens the project in them; resolves to how many steps it holds. */
  open(bytes: Uint8Array, spent: number): Promise<number>;
  draw(index: number): Promise<DrawnDefoxStep>;
  /** Rejects when the worker dies. */
  readonly died: Promise<never>;
  terminate(): void;
}

/** A step's entry, or a step that took longer than its budget to draw. */
export type DefoxStep = DefoxEntry | { ok: false; index: number; overBudget: true };

/** The Defox import worker, in this browser. */
export function startDefoxWorker(): DefoxWorker {
  const worker = new Worker(new URL('../../workers/defoxImportWorker.ts', import.meta.url), { type: 'module' });
  let fail: (error: Error) => void = () => undefined;
  const died = new Promise<never>((_, reject) => {
    fail = reject;
  });
  // Raced against each call; a death after the last one has no one to tell.
  died.catch(() => undefined);
  const detach = attachWorkerDiagnostics(worker, 'defox-import', (info) => fail(new Error(info.message)));
  const api = Comlink.wrap<DefoxImportWorkerApi>(worker);
  return {
    // Moved, not copied: the worker reads the file where it lies.
    open: (bytes, spent) => api.openDefox(Comlink.transfer(bytes, [bytes.buffer as ArrayBuffer]), spent),
    draw: (index) => api.drawDefoxStep(index),
    died,
    terminate: () => {
      detach();
      worker.terminate();
    },
  };
}

/** How a call to a worker ended: with its result, past its budget, or with the worker dead. */
type Outcome<T> = { done: T } | { over: true } | { died: string };

/** `work`, raced against its budget and its worker's death; cancelling the import rejects it. */
async function within<T>(worker: DefoxWorker, work: Promise<T>, budgetMs: number, signal: AbortSignal): Promise<Outcome<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: () => void = () => undefined;
  const outcomes: Promise<Outcome<T>>[] = [
    work.then((done) => ({ done })),
    worker.died.catch((error: unknown) => ({ died: error instanceof Error ? error.message : String(error) })),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ over: true }), budgetMs);
    }),
    new Promise((_, reject) => {
      cancel = () => reject(new DOMException('Import cancelled', 'AbortError'));
      if (signal.aborted) cancel();
      else signal.addEventListener('abort', cancel, { once: true });
    }),
  ];
  try {
    return await Promise.race(outcomes);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}

/**
 * Every step of a Defox project, each drawn within `budgetMs`. A step is drawn
 * in one call its worker cannot be asked to leave, so a step over its budget,
 * or one its worker dies on, ends that worker: the step fails alone, and a new
 * worker opens the file again for the steps after it, counting their output
 * from where the last one left it. Opening has the same budget, and a project
 * that cannot be opened within it fails whole.
 */
export async function drawDefoxSteps({
  bytes,
  reread,
  start,
  budgetMs,
  signal,
  openTimeout,
}: {
  /** The file's bytes, which move to the first worker. */
  bytes: Uint8Array;
  /** The file read again, for each worker after the first. */
  reread: () => Promise<Uint8Array>;
  start: () => DefoxWorker;
  budgetMs: number;
  signal: AbortSignal;
  /** What a project that takes longer than the budget to open fails with. */
  openTimeout: string;
}): Promise<DefoxStep[]> {
  const steps: DefoxStep[] = [];
  // Not known until a worker opens the project, which holds at least one.
  let count = 1;
  let spent = 0;
  let first: Uint8Array | null = bytes;
  while (steps.length < count) {
    const file = first ?? (await reread());
    first = null;
    const worker = start();
    try {
      const opened = await within(worker, worker.open(file, spent), budgetMs, signal);
      if ('over' in opened) throw new Error(openTimeout);
      if ('died' in opened) throw new Error(opened.died);
      count = opened.done;
      for (let index = steps.length; index < count; index++) {
        const drawn = await within(worker, worker.draw(index), budgetMs, signal);
        if ('done' in drawn) {
          steps.push(drawn.done.entry);
          spent = drawn.done.spent;
          continue;
        }
        steps.push('over' in drawn ? { ok: false, index, overBudget: true } : { ok: false, index, error: drawn.died });
        break;
      }
    } finally {
      worker.terminate();
    }
  }
  return steps;
}
