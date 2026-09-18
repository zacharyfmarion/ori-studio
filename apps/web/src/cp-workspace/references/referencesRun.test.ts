import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const releaseReferenceFinderClient = vi.fn();
vi.mock('../../store/workspaceStore/referenceFinderRuntime', () => ({
  releaseReferenceFinderClient: (instance: string) => releaseReferenceFinderClient(instance),
}));

const {
  beginReferencesRun,
  endReferencesRun,
  referencesRunSnapshot,
  requestReferencesStop,
  resetReferencesRun,
  stopWindowQuery,
} = await import('./referencesRun');

beforeEach(() => {
  resetReferencesRun();
  releaseReferenceFinderClient.mockClear();
});

afterEach(() => {
  resetReferencesRun();
});

describe('requestReferencesStop', () => {
  /**
   * The registry used to kill the Find tab's window worker for every run. A
   * whole-pattern plan does not run there — it ends through its own
   * AbortController — so a Stop during a plan changed nothing, and with no
   * time ceiling "Cancelling…" held forever.
   */
  it('stops the running run the way that run said it is stopped', () => {
    const abort = vi.fn();
    const runId = beginReferencesRun(abort);
    expect(requestReferencesStop()).toBe(true);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(releaseReferenceFinderClient).not.toHaveBeenCalled();
    expect(referencesRunSnapshot()).toMatchObject({ running: true, stopping: true, runId });
  });

  it('is written once: a second press does nothing until the run ends', () => {
    const abort = vi.fn();
    beginReferencesRun(abort);
    requestReferencesStop();
    expect(requestReferencesStop()).toBe(false);
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('does nothing when nothing runs, and a run that ended cannot be stopped', () => {
    expect(requestReferencesStop()).toBe(false);
    const abort = vi.fn();
    const runId = beginReferencesRun(abort);
    endReferencesRun(runId);
    expect(referencesRunSnapshot().running).toBe(false);
    expect(requestReferencesStop()).toBe(false);
    expect(abort).not.toHaveBeenCalled();
  });

  it('stops the newest run only, even when an older one ends late', () => {
    const first = vi.fn();
    const staleId = beginReferencesRun(first);
    const second = vi.fn();
    beginReferencesRun(second);
    // A late completion of the superseded run is ignored, and does not
    // forget how the newer one is stopped.
    endReferencesRun(staleId);
    expect(referencesRunSnapshot().running).toBe(true);
    expect(requestReferencesStop()).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("a Find query's stop is losing the window worker", () => {
    beginReferencesRun(stopWindowQuery);
    requestReferencesStop();
    expect(releaseReferenceFinderClient).toHaveBeenCalledWith('window');
  });
});
