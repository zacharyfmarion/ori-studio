import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A CP worker that dies mid-fold must not leave its run listed forever.
 *
 * The run is cleared by the `finally` of the call that started it, and a Comlink
 * call on a dead client never settles — `engineHost` says so in as many words —
 * so a crash during the large fold this feature exists for leaks the entry. That
 * is not cosmetic once a fold can be stopped: `stopOristudioCpFolds` answers
 * `true` while any cancellable run is listed, and Escape's first rung consults
 * it, so the whole Escape ladder below folding goes dead for the rest of the
 * session — under a non-dismissible "Folding…" toast whose Stop writes into a
 * buffer nothing is reading.
 */

const lossListeners = new Set<(loss: { engine: string }) => void>();

vi.mock('../../engines/engineHost', () => ({
  connectEngine: vi.fn(async () => ({})),
  resetEngine: vi.fn(),
  isEngineConnected: vi.fn(() => true),
  onEngineLost: (listener: (loss: { engine: string }) => void) => {
    lossListeners.add(listener);
    return () => lossListeners.delete(listener);
  },
  ENGINE_IDS: ['treemaker', 'oristudio-cp', 'oristudio-bp'],
}));

const { useWorkspaceStore } = await import('./store');

function announceLoss(engine: string): void {
  for (const listener of [...lossListeners]) listener({ engine });
}

function liveRun(runId: number) {
  return { runId, kind: 'fold' as const, startedAt: Date.now(), cancellable: true, stopping: false };
}

beforeEach(() => {
  useWorkspaceStore.setState({ oristudioCpFoldRuns: {} });
});

describe('a lost CP engine', () => {
  it('clears the fold runs it can no longer finish, so Escape falls through again', () => {
    useWorkspaceStore.setState({ oristudioCpFoldRuns: { 3: liveRun(3) } });
    expect(useWorkspaceStore.getState().stopOristudioCpFolds()).toBe(true);

    announceLoss('oristudio-cp');

    expect(useWorkspaceStore.getState().oristudioCpFoldRuns).toEqual({});
    // The rung Escape asks first. `false` is what lets the key reach the tool
    // and the selection again.
    expect(useWorkspaceStore.getState().stopOristudioCpFolds()).toBe(false);
  });

  it('leaves a fold alone when a different engine is the one that died', () => {
    useWorkspaceStore.setState({ oristudioCpFoldRuns: { 4: liveRun(4) } });

    announceLoss('oristudio-bp');

    expect(Object.keys(useWorkspaceStore.getState().oristudioCpFoldRuns)).toEqual(['4']);
  });
});
