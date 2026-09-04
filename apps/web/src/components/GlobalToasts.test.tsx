import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { OristudioCpFoldRun } from '../store/workspaceStore/types';
import {
  bindCpExactSolveRunStop,
  resetCpExactSolveRuns,
  withCpExactSolveRun,
} from '../engine/cpExactSolveRuns';
import { CP_EXACT_SOLVE_LONG_RUN_MS } from '../cp-workspace/regions/useCpExactSolveRunIndicator';
import { GlobalToasts, SOLVE_TOAST_DELAY_MS } from './GlobalToasts';

/**
 * The Stop affordance, at the entry point.
 *
 * A store action nothing presses is a dead feature, and this repo has shipped
 * that before — the unit tests stayed green while the wiring was gone. So these
 * mount the real host against the real store and press what a user would press.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface LoadingToast {
  message: string;
  options: {
    dismissible?: boolean;
    action?: { label: string; onClick: () => void };
  };
}

const loadingToasts: LoadingToast[] = [];
const messageToasts: string[] = [];

vi.mock('sonner', () => ({
  toast: Object.assign(
    (message: string) => messageToasts.push(message),
    {
      loading: (message: string, options: LoadingToast['options']) => {
        loadingToasts.push({ message, options: options ?? {} });
      },
      message: (message: string) => messageToasts.push(message),
      error: () => undefined,
      dismiss: () => undefined,
    }
  ),
}));

function run(patch: Partial<OristudioCpFoldRun> = {}): OristudioCpFoldRun {
  return {
    runId: 5,
    kind: 'fold',
    startedAt: Date.now(),
    cancellable: true,
    stopping: false,
    ...patch,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** The toast as it stands now — the host re-issues it under one id. */
function latestToast(): LoadingToast | undefined {
  return loadingToasts[loadingToasts.length - 1];
}

function setRuns(...runs: OristudioCpFoldRun[]): void {
  act(() => {
    useWorkspaceStore.setState({
      oristudioCpFoldRuns: Object.fromEntries(runs.map((entry) => [entry.runId, entry])),
    });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  resetCpExactSolveRuns();
  loadingToasts.length = 0;
  messageToasts.length = 0;
  useWorkspaceStore.setState({ oristudioCpFoldRuns: {}, error: null });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<GlobalToasts />));
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

describe('the folding toast', () => {
  it('offers Stop, and the press reaches the store', () => {
    const stop = vi.spyOn(useWorkspaceStore.getState(), 'stopOristudioCpFolds');
    setRuns(run());
    act(() => vi.advanceTimersByTime(600));

    const toast = latestToast();
    expect(toast?.message).toBe('Folding…');
    expect(toast?.options.action?.label).toBe('Cancel');
    // Persistent while there is a way out of it: the only indicator of an
    // hour-long run must not be dismissable out from under the button that ends
    // it. `dismissible` is the whole mechanism — sonner ignores `closeButton`
    // on a `loading` toast — so that is what is asserted.
    expect(toast?.options.dismissible).toBe(false);

    act(() => toast?.options.action?.onClick());
    expect(stop).toHaveBeenCalled();
  });

  it('acknowledges the press, then says so once the run is gone', () => {
    setRuns(run());
    act(() => vi.advanceTimersByTime(600));

    setRuns(run({ stopping: true }));
    // No second Stop: the run is already unwinding, and a button that repeats is
    // a button that looks like it did nothing.
    expect(latestToast()?.message).toBe('Cancelling…');
    expect(latestToast()?.options.action).toBeUndefined();

    setRuns();
    expect(messageToasts).toContain('Fold cancelled');
  });

  it('says nothing when a fold simply finishes', () => {
    setRuns(run());
    act(() => vi.advanceTimersByTime(600));
    setRuns();

    expect(messageToasts).not.toContain('Fold cancelled');
  });

  it('escalates its wording for a run that has outlasted reassurance', () => {
    setRuns(run());
    act(() => vi.advanceTimersByTime(600));
    expect(latestToast()?.message).toBe('Folding…');

    act(() => vi.advanceTimersByTime(10_000));
    expect(latestToast()?.message).toBe('Still folding — this can take a while');
  });

  it('shows no Stop, and stays dismissable, when the fold cannot be reached', () => {
    // The un-isolated browser. A disabled-looking button that does nothing is
    // worse than no button; an indicator you cannot act on is better dismissed.
    setRuns(run({ cancellable: false }));
    act(() => vi.advanceTimersByTime(600));

    expect(latestToast()?.options.action).toBeUndefined();
    expect(latestToast()?.options.dismissible).toBe(true);
    // And it must read as an ordinary fold. "Have all the stoppable runs been
    // stopped" is vacuously true when none of them can be stopped, which had
    // every un-isolated fold showing "Cancelling…" from the moment it appeared.
    expect(latestToast()?.message).toBe('Folding…');
  });

  it('says nothing when an unstoppable fold succeeds', () => {
    setRuns(run({ cancellable: false }));
    act(() => vi.advanceTimersByTime(600));
    setRuns();

    // The other half of the vacuous predicate: it latched `stopRequested`, so a
    // fold nobody stopped announced that it had been stopped.
    expect(messageToasts).not.toContain('Fold cancelled');
  });
});

describe('the solving toast', () => {
  /** A solve that ends only when told to: finished by the test, or stopped. */
  function liveSolve(cancellable = true): { finish: () => void; done: Promise<void> } {
    let finish: () => void = () => undefined;
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = withCpExactSolveRun({ kind: 'region', targetId: 'region-1', cancellable }, (live) => {
        return new Promise<void>((resolve, reject) => {
          finish = resolve;
          if (cancellable) bindCpExactSolveRunStop(live.runId, () => reject(new Error('stopped')));
        });
      }).catch(() => undefined);
    });
    return { finish: () => finish(), done };
  }

  it('waits before appearing, then offers Cancel, and the press stops the run', async () => {
    const live = liveSolve();
    act(() => {
      vi.advanceTimersByTime(SOLVE_TOAST_DELAY_MS - 1);
    });
    // The chip has its own spinner; the toast is for the solve that goes on.
    expect(latestToast()).toBeUndefined();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(latestToast()?.message).toBe('Solving…');
    expect(latestToast()?.options.dismissible).toBe(false);
    expect(latestToast()?.options.action?.label).toBe('Cancel');

    act(() => latestToast()?.options.action?.onClick());
    expect(latestToast()?.message).toBe('Cancelling…');
    expect(latestToast()?.options.action).toBeUndefined();

    await act(async () => {
      await live.done;
    });
    expect(messageToasts).toContain('Solve cancelled');
  });

  it('says nothing when a solve simply finishes', async () => {
    const live = liveSolve();
    act(() => {
      vi.advanceTimersByTime(SOLVE_TOAST_DELAY_MS);
    });
    expect(latestToast()?.message).toBe('Solving…');

    live.finish();
    await act(async () => {
      await live.done;
    });
    expect(messageToasts).toEqual([]);
  });

  it('escalates its wording for a run that has outlasted reassurance', () => {
    liveSolve();
    act(() => {
      vi.advanceTimersByTime(CP_EXACT_SOLVE_LONG_RUN_MS);
    });
    expect(latestToast()?.message).toBe('Still solving — this can take a while');
    expect(latestToast()?.options.action?.label).toBe('Cancel');
  });

  it('shows no Cancel, and stays dismissable, when the run cannot be reached', () => {
    liveSolve(false);
    act(() => {
      vi.advanceTimersByTime(SOLVE_TOAST_DELAY_MS);
    });
    expect(latestToast()?.message).toBe('Solving…');
    expect(latestToast()?.options.action).toBeUndefined();
    expect(latestToast()?.options.dismissible).toBe(true);
  });
});
