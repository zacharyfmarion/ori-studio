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
    action?: { label: string; onClick: () => void };
  };
}

const loadingToasts: LoadingToast[] = [];
const messageToasts: string[] = [];
const successToasts: string[] = [];

vi.mock('sonner', () => ({
  toast: Object.assign(
    (message: string) => messageToasts.push(message),
    {
      loading: (message: string, options: LoadingToast['options']) => {
        loadingToasts.push({ message, options: options ?? {} });
      },
      message: (message: string) => messageToasts.push(message),
      success: (message: string) => successToasts.push(message),
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
  successToasts.length = 0;
  useWorkspaceStore.setState({
    oristudioCpFoldRuns: {},
    error: null,
    savedNotice: null,
    saveRun: null,
  });
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

/**
 * A browser save that writes through its handle shows the user nothing at all —
 * no dialog on the repeat, no download for the browser to announce — so this
 * toast is the only confirmation the save happened. Mounted against the real
 * store for the reason the folding tests are: a store field nobody reads is a
 * dead feature, and the store-level tests only assert that `savedNotice` is set.
 */
describe('the saved toast', () => {
  it('announces the filename, and clears the notice so the next save can announce too', () => {
    act(() => useWorkspaceStore.setState({ savedNotice: 'project.osf' }));

    expect(successToasts).toEqual(['project.osf saved']);
    // Cleared, or a second save of the same file would set an unchanged value
    // and never re-render.
    expect(useWorkspaceStore.getState().savedNotice).toBeNull();

    act(() => useWorkspaceStore.setState({ savedNotice: 'project.osf' }));
    expect(successToasts).toEqual(['project.osf saved', 'project.osf saved']);
  });

  it('says nothing until a save sets one', () => {
    expect(successToasts).toEqual([]);
  });
});

/**
 * Pressing ⌘S on a project carrying megabytes of embedded images used to be
 * seconds of silence. `saveRun` is set only once the save target is settled, so
 * this indicator can never appear underneath the OS save dialog — which is the
 * whole reason the serialization moved after the picker.
 */
describe('the saving toast', () => {
  const startSave = (name = 'project.osf') =>
    act(() => useWorkspaceStore.setState({ saveRun: { name, startedAt: Date.now() } }));

  it('says nothing about a save that finishes quickly', () => {
    startSave();
    act(() => vi.advanceTimersByTime(200));
    act(() => useWorkspaceStore.setState({ saveRun: null }));
    act(() => vi.advanceTimersByTime(2000));

    expect(loadingToasts).toEqual([]);
  });

  it('names the file once the save has run long enough to notice', () => {
    startSave('crane.osf');
    act(() => vi.advanceTimersByTime(600));

    expect(latestToast()?.message).toBe('Saving crane.osf…');
    // No Cancel: by now the file is chosen and being written, and a
    // half-written document is not an out worth offering.
    expect(latestToast()?.options.action).toBeUndefined();
  });

  it('explains itself when the save outlasts reassurance', () => {
    startSave('crane.osf');
    act(() => vi.advanceTimersByTime(600));
    expect(latestToast()?.message).toBe('Saving crane.osf…');

    act(() => vi.advanceTimersByTime(5000));
    expect(latestToast()?.message).toBe('Still saving crane.osf — large projects take a moment');
  });

  it('is replaced by the confirmation rather than stacking under it', () => {
    startSave('crane.osf');
    act(() => vi.advanceTimersByTime(600));
    act(() =>
      useWorkspaceStore.setState({ saveRun: null, savedNotice: 'crane.osf' })
    );

    expect(successToasts).toEqual(['crane.osf saved']);
    // Same id, so sonner swaps the spinner for the confirmation in place.
    expect(latestToast()?.message).toBe('Saving crane.osf…');
  });
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
