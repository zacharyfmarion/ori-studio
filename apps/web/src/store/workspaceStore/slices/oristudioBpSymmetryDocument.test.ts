import { patchBoxPleatDesign, selectOristudioBpHistoryPast, selectOristudioBpSymmetry, singleBoxPleatDesignTab } from '../designTabs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultBpDocumentSymmetry } from '../../../lib/bpTreeSymmetry';
import type { OristudioBpDocumentState } from '../../../engine/oristudioBpTypes';

/**
 * Mirror-draw state belongs to the design, not the session.
 *
 * What that has to mean, and what these cover: changing it leaves unsaved work;
 * the mirror axis is derived from the sheet rather than restored from anywhere;
 * and the fold is a property of the design, so it neither leaks between
 * documents nor lives in the browser's stored optimizer options.
 */

const runtimeMocks = vi.hoisted(() => ({
  exportOristudioBpProjectAsBps: vi.fn(async () => '<bps/>'),
  restoreOristudioBpProjectSnapshot: vi.fn(),
}));

vi.mock('../oristudioBpRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../oristudioBpRuntime')>();
  return {
    ...actual,
    exportOristudioBpProjectAsBps: runtimeMocks.exportOristudioBpProjectAsBps,
    restoreOristudioBpProjectSnapshot: runtimeMocks.restoreOristudioBpProjectSnapshot,
  };
});

const { useWorkspaceStore } = await import('../store');

/** Only the fields the history path reads. */
function bpDocument(): OristudioBpDocumentState {
  return {
    activeSurface: 'tree',
    history: { activeLabel: 'edit' },
    snapshot: { tree: { sheet: { width: 8, height: 8 }, vertices: [], edges: [] } },
  } as unknown as OristudioBpDocumentState;
}

beforeEach(() => {
  // Symmetry is per-design now, so these need a box-pleat design to be about.
  // A fresh store holds one chooser tab, and BP writes against that correctly
  // do nothing.
  useWorkspaceStore.setState({ ...singleBoxPleatDesignTab({ document: bpDocument() }) });
});

afterEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('symmetry is document state', () => {
  it('starts off, book-fold, with nothing paired', () => {
    expect(defaultBpDocumentSymmetry()).toEqual({ enabled: false, fold: 'book', pairs: [] });
    const initial = selectOristudioBpSymmetry(singleBoxPleatDesignTab());
    expect(initial.enabled).toBe(false);
    expect(initial.fold).toBe('book');
    expect(initial.pairs).toEqual([]);
  });

  it('marks the project dirty when mirror draw is toggled', () => {
    useWorkspaceStore.setState({ dirty: false });
    useWorkspaceStore.getState().setOristudioBpSymmetry({ enabled: true });
    expect(useWorkspaceStore.getState().dirty).toBe(true);
  });

  it('marks the project dirty when the fold changes', () => {
    useWorkspaceStore.setState({ dirty: false });
    useWorkspaceStore.getState().setOristudioBpSymmetry({ fold: 'diagonal' });
    expect(selectOristudioBpSymmetry(useWorkspaceStore.getState()).fold).toBe('diagonal');
    expect(useWorkspaceStore.getState().dirty).toBe(true);
  });

  it('marks the project dirty when a pair is broken', () => {
    useWorkspaceStore.setState({
      ...patchBoxPleatDesign(useWorkspaceStore.getState(), {
      symmetry: {
        ...selectOristudioBpSymmetry(useWorkspaceStore.getState()),
        pairs: [{ v1: 1, v2: 2 }],
      }
      }),
      dirty: false});
    useWorkspaceStore.getState().unpairOristudioBpTreeSymmetry(1);
    expect(selectOristudioBpSymmetry(useWorkspaceStore.getState()).pairs).toEqual([]);
    expect(useWorkspaceStore.getState().dirty).toBe(true);
  });

  it('leaves the project clean when unpairing a vertex that was not paired', () => {
    useWorkspaceStore.setState({
      ...patchBoxPleatDesign(useWorkspaceStore.getState(), {
      symmetry: {
        ...selectOristudioBpSymmetry(useWorkspaceStore.getState()),
        pairs: [{ v1: 1, v2: 2 }],
      }
      }),
      dirty: false});
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

describe('symmetry rides the undo stack', () => {
  beforeEach(() => {
    runtimeMocks.exportOristudioBpProjectAsBps.mockClear().mockResolvedValue('<bps/>');
    runtimeMocks.restoreOristudioBpProjectSnapshot.mockClear();
    // `activeEditingContext` is derived by a store subscriber, so it has to be
    // steered through its inputs rather than set.
    useWorkspaceStore.setState({
      // One writer: `singleBoxPleatDesignTab` claims the kind *and* the document.
      ...singleBoxPleatDesignTab({ document: bpDocument() }),
      activePanelId: 'design',
    });
    expect(useWorkspaceStore.getState().activeEditingContext).toBe('bp-tree');
  });

  it('undoes turning mirror draw on', async () => {
    useWorkspaceStore.getState().setOristudioBpSymmetry({ enabled: true });
    expect(selectOristudioBpSymmetry(useWorkspaceStore.getState()).enabled).toBe(true);

    await useWorkspaceStore.getState().undo();

    expect(selectOristudioBpSymmetry(useWorkspaceStore.getState()).enabled).toBe(false);
  });

  it('undoes a fold change, then redoes it', async () => {
    useWorkspaceStore.getState().setOristudioBpSymmetry({ fold: 'diagonal' });

    await useWorkspaceStore.getState().undo();
    expect(selectOristudioBpSymmetry(useWorkspaceStore.getState()).fold).toBe('book');

    await useWorkspaceStore.getState().redo();
    expect(selectOristudioBpSymmetry(useWorkspaceStore.getState()).fold).toBe('diagonal');
  });

  it('undoes an unpair, putting the pair back', async () => {
    useWorkspaceStore.setState({
      ...patchBoxPleatDesign(useWorkspaceStore.getState(), {
      symmetry: {
        ...selectOristudioBpSymmetry(useWorkspaceStore.getState()),
        pairs: [{ v1: 1, v2: 2 }],
      }
      }),});
    useWorkspaceStore.getState().unpairOristudioBpTreeSymmetry(1);
    expect(selectOristudioBpSymmetry(useWorkspaceStore.getState()).pairs).toEqual([]);

    await useWorkspaceStore.getState().undo();

    expect(selectOristudioBpSymmetry(useWorkspaceStore.getState()).pairs).toEqual([{ v1: 1, v2: 2 }]);
  });

  it('does not rebuild the design for a change that only touched symmetry', async () => {
    useWorkspaceStore.getState().setOristudioBpSymmetry({ fold: 'diagonal' });

    await useWorkspaceStore.getState().undo();

    // Restoring a design it never touched would be a wasted worker round-trip,
    // and would throw away the live handle.
    expect(runtimeMocks.restoreOristudioBpProjectSnapshot).not.toHaveBeenCalled();
  });

  it('leaves the derived axis alone when restoring', async () => {
    useWorkspaceStore.setState({
      ...patchBoxPleatDesign(useWorkspaceStore.getState(), {
      symmetry: {
        ...selectOristudioBpSymmetry(useWorkspaceStore.getState()),
        angle: 90,
        loc: { x: 4, y: 4 },
      }
      }),});
    useWorkspaceStore.getState().setOristudioBpSymmetry({ enabled: false });

    await useWorkspaceStore.getState().undo();

    const symmetry = selectOristudioBpSymmetry(useWorkspaceStore.getState());
    expect(symmetry.angle).toBe(90);
    expect(symmetry.loc).toEqual({ x: 4, y: 4 });
  });

  it('restores the pairing that went with a design edit, not just the design', async () => {
    // The case this exists for: deleting a flap under symmetry prunes its pair.
    // Undo has to bring back both, or the flap returns unpaired.
    runtimeMocks.restoreOristudioBpProjectSnapshot.mockResolvedValue(bpDocument());
    useWorkspaceStore.setState({
      ...patchBoxPleatDesign(useWorkspaceStore.getState(), {
      symmetry: {
        ...selectOristudioBpSymmetry(useWorkspaceStore.getState()),
        pairs: [],
      },
      historyPast: [
        {
          snapshot: {
            bps: '<before/>',
            selection: { kind: 'bp-none' },
            symmetry: { enabled: true, fold: 'book', pairs: [{ v1: 1, v2: 2 }] },
          },
          label: 'Delete flap',
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ]
      }),});

    await useWorkspaceStore.getState().undo();

    expect(runtimeMocks.restoreOristudioBpProjectSnapshot).toHaveBeenCalledWith('<before/>');
    expect(selectOristudioBpSymmetry(useWorkspaceStore.getState()).pairs).toEqual([{ v1: 1, v2: 2 }]);
  });

  it('records nothing when the update changes nothing', () => {
    useWorkspaceStore.setState({ dirty: false });
    const { enabled, fold } = defaultBpDocumentSymmetry();
    useWorkspaceStore.getState().setOristudioBpSymmetry({ enabled, fold });
    expect(selectOristudioBpHistoryPast(useWorkspaceStore.getState())).toEqual([]);
    expect(useWorkspaceStore.getState().dirty).toBe(false);
  });

  it('does not hand the live pairs array to a snapshot', () => {
    useWorkspaceStore.setState({
      ...patchBoxPleatDesign(useWorkspaceStore.getState(), {
      symmetry: {
        ...selectOristudioBpSymmetry(useWorkspaceStore.getState()),
        pairs: [{ v1: 1, v2: 2 }],
      }
      }),});
    useWorkspaceStore.getState().setOristudioBpSymmetry({ enabled: false });
    const recorded = selectOristudioBpHistoryPast(useWorkspaceStore.getState()).at(-1);
    expect(recorded?.snapshot.symmetry.pairs).not.toBe(
      selectOristudioBpSymmetry(useWorkspaceStore.getState()).pairs
    );
  });

  it('records nothing when unpairing a vertex that was not paired', () => {
    useWorkspaceStore.getState().unpairOristudioBpTreeSymmetry(9);
    expect(selectOristudioBpHistoryPast(useWorkspaceStore.getState())).toEqual([]);
  });

  it('records nothing with no design open', () => {
    useWorkspaceStore.setState({
      ...singleBoxPleatDesignTab({ document: null 
      }),});
    useWorkspaceStore.getState().setOristudioBpSymmetry({ enabled: false });
    expect(selectOristudioBpHistoryPast(useWorkspaceStore.getState())).toEqual([]);
  });
});
