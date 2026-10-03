import { describe, expect, it, vi } from 'vitest';

const cancel = vi.hoisted(() => ({
  next: 100,
  beginFoldRun: vi.fn(() => ++cancel.next),
  cancelFoldRun: vi.fn(),
  foldCancellationAvailable: vi.fn(() => true),
}));
vi.mock('../../lib/foldCancellation', () => cancel);

import { aimFoldStopAtOldestPending, withFoldInFlight, type FoldRunStore } from './foldRuns';
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

  it('lets go of a run that fails or is stopped', async () => {
    const store = memoryStore();
    await expect(
      withFoldInFlight(store, 'fold', async () => {
        throw new Error('fold_cancelled');
      })
    ).rejects.toThrow('fold_cancelled');
    expect(store.runs()).toEqual({});
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
