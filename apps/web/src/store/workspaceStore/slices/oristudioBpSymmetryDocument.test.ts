import { afterEach, describe, expect, it } from 'vitest';
import { defaultBpDocumentSymmetry } from '../../../lib/bpTreeSymmetry';

/**
 * Mirror-draw state belongs to the design, not the session.
 *
 * What that has to mean, and what these cover: changing it leaves unsaved work;
 * the mirror axis is derived from the sheet rather than restored from anywhere;
 * and the fold is a property of the design, so it neither leaks between
 * documents nor lives in the browser's stored optimizer options.
 */

const { useWorkspaceStore } = await import('../store');

afterEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('symmetry is document state', () => {
  it('starts on, book-fold, with nothing paired', () => {
    expect(defaultBpDocumentSymmetry()).toEqual({ enabled: true, fold: 'book', pairs: [] });
    const initial = useWorkspaceStore.getInitialState().oristudioBpSymmetry;
    expect(initial.enabled).toBe(true);
    expect(initial.fold).toBe('book');
    expect(initial.pairs).toEqual([]);
  });

  it('marks the project dirty when mirror draw is toggled', () => {
    useWorkspaceStore.setState({ dirty: false });
    useWorkspaceStore.getState().setOristudioBpSymmetry({ enabled: false });
    expect(useWorkspaceStore.getState().dirty).toBe(true);
  });

  it('marks the project dirty when the fold changes', () => {
    useWorkspaceStore.setState({ dirty: false });
    useWorkspaceStore.getState().setOristudioBpSymmetry({ fold: 'diagonal' });
    expect(useWorkspaceStore.getState().oristudioBpSymmetry.fold).toBe('diagonal');
    expect(useWorkspaceStore.getState().dirty).toBe(true);
  });

  it('marks the project dirty when a pair is broken', () => {
    useWorkspaceStore.setState({
      dirty: false,
      oristudioBpSymmetry: {
        ...useWorkspaceStore.getState().oristudioBpSymmetry,
        pairs: [{ v1: 1, v2: 2 }],
      },
    });
    useWorkspaceStore.getState().unpairOristudioBpTreeSymmetry(1);
    expect(useWorkspaceStore.getState().oristudioBpSymmetry.pairs).toEqual([]);
    expect(useWorkspaceStore.getState().dirty).toBe(true);
  });

  it('leaves the project clean when unpairing a vertex that was not paired', () => {
    useWorkspaceStore.setState({
      dirty: false,
      oristudioBpSymmetry: {
        ...useWorkspaceStore.getState().oristudioBpSymmetry,
        pairs: [{ v1: 1, v2: 2 }],
      },
    });
    useWorkspaceStore.getState().unpairOristudioBpTreeSymmetry(9);
    expect(useWorkspaceStore.getState().dirty).toBe(false);
  });
});

describe('the fold is not a browser preference', () => {
  it('is absent from the stored optimizer options', async () => {
    const { DEFAULT_BP_OPTIMIZER_OPTIONS } = await import('../../bpOptimizerUiStore');
    expect(DEFAULT_BP_OPTIMIZER_OPTIONS).not.toHaveProperty('symmetryFold');
  });

  it('is dropped from options an older build had already stored', async () => {
    const { useBpOptimizerUiStore } = await import('../../bpOptimizerUiStore');
    // `sanitize` rebuilds from known keys, which is what makes the stale key a
    // no-op rather than something that has to be migrated away.
    useBpOptimizerUiStore
      .getState()
      .setOptions({ symmetryFold: 'diagonal' } as Record<string, unknown>);
    expect(useBpOptimizerUiStore.getState().options).not.toHaveProperty('symmetryFold');
  });
});
