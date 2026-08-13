import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { OristudioCpFoldRun } from '../store/workspaceStore/types';
import { GlobalToasts } from './GlobalToasts';

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
    closeButton?: boolean;
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
    expect(toast?.options.action?.label).toBe('Stop');
    // Persistent while there is a way out of it: `App.tsx` sets `closeButton`
    // globally, and the only indicator of an hour-long run must not be
    // dismissable out from under the button that ends it.
    expect(toast?.options.dismissible).toBe(false);
    expect(toast?.options.closeButton).toBe(false);

    act(() => toast?.options.action?.onClick());
    expect(stop).toHaveBeenCalled();
  });

  it('acknowledges the press, then says so once the run is gone', () => {
    setRuns(run());
    act(() => vi.advanceTimersByTime(600));

    setRuns(run({ stopping: true }));
    // No second Stop: the run is already unwinding, and a button that repeats is
    // a button that looks like it did nothing.
    expect(latestToast()?.message).toBe('Stopping…');
    expect(latestToast()?.options.action).toBeUndefined();

    setRuns();
    expect(messageToasts).toContain('Folding stopped');
  });

  it('says nothing when a fold simply finishes', () => {
    setRuns(run());
    act(() => vi.advanceTimersByTime(600));
    setRuns();

    expect(messageToasts).not.toContain('Folding stopped');
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
    expect(latestToast()?.options.closeButton).toBe(true);
  });
});
