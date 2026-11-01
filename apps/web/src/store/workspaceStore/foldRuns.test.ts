import { describe, expect, it, vi } from 'vitest';

const cancel = vi.hoisted(() => ({
  next: 100,
  beginFoldRun: vi.fn(() => ++cancel.next),
  cancelFoldRun: vi.fn(),
  foldCancellationAvailable: vi.fn(() => true),
}));
vi.mock('../../lib/foldCancellation', () => cancel);

import { aimFoldStopAtOldestPending, stopFoldRun, withFoldInFlight, type FoldRunStore } from './foldRuns';
import type { OristudioCpFoldRun } from './types';

function memoryStore(): FoldRunStore & { runs: () => Record<number, OristudioCpFoldRun> } {
  let state = { oristudioCpFoldRuns: {} as Record<number, OristudioCpFoldRun> };
  return {
    get: () => state,
    set: (partial) => {
      state = { ...state, ...partial };
    },
    runs: () => state.oristudioCpFoldRuns,
  };
}

describe('the fold-run registry', () => {
  it('holds a run exactly while it folds, under the id it hands the fold', async () => {
    const store = memoryStore();
    let seen: number | null = null;
    const result = await withFoldInFlight(store, 'fold', async (runId) => {
      seen = runId;
      expect(store.runs()[runId]).toMatchObject({ kind: 'fold', cancellable: true, stopping: false });
      return 'done';
    });
    expect(result).toBe('done');
    expect(seen).not.toBeNull();
    expect(store.runs()).toEqual({});
  });

  it('can be stoppable whatever the kernel’s transport says, and say otherwise once its work moves to the kernel', async () => {
    cancel.foldCancellationAvailable.mockReturnValue(false);
    try {
      const store = memoryStore();
      // A plain fold follows the transport: here none.
      await withFoldInFlight(store, 'fold', async (runId) => {
        expect(store.runs()[runId]?.cancellable).toBe(false);
      });
      // A Layer order step's run starts stoppable (terminating its engine's worker), then says what the kernel allows.
      let stoppedRun: number | null = null;
      await withFoldInFlight(
        store,
        'another',
        async (runId, stop, controls) => {
          expect(store.runs()[runId]?.cancellable).toBe(true);
          expect(stopFoldRun(store, runId)).toBe(true);
          expect(stop.aborted).toBe(true);
          stoppedRun = runId;
          controls.stoppable(false);
          expect(store.runs()[runId]?.cancellable).toBe(false);
        },
        { stoppable: true }
      );
      expect(stoppedRun).not.toBeNull();
      expect(store.runs()).toEqual({});
    } finally {
      cancel.foldCancellationAvailable.mockReturnValue(true);
    }
  });

  it('lets go of a run that fails or is stopped', async () => {
    const store = memoryStore();
    await expect(
      withFoldInFlight(store, 'fold', async () => {
        throw new Error('fold_cancelled');
      })
    ).rejects.toThrow('fold_cancelled');
    expect(store.runs()).toEqual({});
  });

  it('hands each run a stop signal that a Stop of that run aborts, and only that run', async () => {
    const store = memoryStore();
    const signals: Record<string, AbortSignal> = {};
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = (name: string) =>
      withFoldInFlight(store, 'fold', async (runId, stop) => {
        signals[name] = stop;
        await held;
        return runId;
      });
    const first = running('first');
    const second = running('second');
    await vi.waitFor(() => expect(Object.keys(signals)).toHaveLength(2));
    const [firstId] = Object.keys(store.runs()).map(Number).sort((a, b) => a - b);

    expect(stopFoldRun(store, firstId!)).toBe(true);
    expect(signals.first!.aborted).toBe(true);
    expect(signals.second!.aborted).toBe(false);

    // A Stop of everything, as the toast's: every stoppable run marked, every signal aborted.
    const marked = Object.fromEntries(Object.values(store.runs()).map((run) => [run.runId, { ...run, stopping: true }]));
    store.set({ oristudioCpFoldRuns: marked });
    aimFoldStopAtOldestPending(marked);
    expect(signals.second!.aborted).toBe(true);

    release();
    await Promise.all([first, second]);
    expect(store.runs()).toEqual({});
  });

  it('never aborts a run the transport cannot stop, and forgets a signal when its run ends', async () => {
    const store = memoryStore();
    cancel.foldCancellationAvailable.mockReturnValueOnce(false);
    let stop: AbortSignal | null = null;
    let id = 0;
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = withFoldInFlight(store, 'fold', async (runId, signal) => {
      id = runId;
      stop = signal;
      await held;
    });
    await vi.waitFor(() => expect(stop).not.toBeNull());
    expect(stopFoldRun(store, id)).toBe(false);
    aimFoldStopAtOldestPending({ [id]: { ...store.runs()[id]!, stopping: true } });
    expect(stop!.aborted).toBe(false);
    release();
    await run;

    // Ended: a late Stop naming it reaches nothing.
    aimFoldStopAtOldestPending({ [id]: { runId: id, kind: 'fold', startedAt: 0, cancellable: true, stopping: true } });
    expect(stop!.aborted).toBe(false);
  });

  it('aims a Stop at the oldest run still waiting to stop', () => {
    const runs: Record<number, OristudioCpFoldRun> = {
      7: { runId: 7, kind: 'fold', startedAt: 20, cancellable: true, stopping: true },
      5: { runId: 5, kind: 'fold', startedAt: 10, cancellable: true, stopping: true },
      9: { runId: 9, kind: 'fold', startedAt: 5, cancellable: true, stopping: false },
    };
    aimFoldStopAtOldestPending(runs);
    expect(cancel.cancelFoldRun).toHaveBeenLastCalledWith(5);
  });
});
