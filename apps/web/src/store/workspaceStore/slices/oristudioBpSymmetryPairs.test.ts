import {
  selectOristudioBpHistoryPast,
  selectOristudioBpSymmetry,
  singleBoxPleatDesignTab,
} from '../designTabs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioBpDocumentState, OristudioBpTreeView } from '../../../engine/oristudioBpTypes';

/**
 * The three verbs that change the pairing by hand: Pair with mirror, Pair all
 * mirrored, Unpair from mirror.
 *
 * The matching itself is unit-tested in `lib/bpTreeSymmetry.test.ts`; what these
 * cover is the wiring — each verb records one undo entry named for what it did,
 * leaves unsaved work, reports itself, and does none of those things when it
 * has nothing to do.
 */

const runtimeMocks = vi.hoisted(() => ({
  exportOristudioBpProjectAsBps: vi.fn(async () => '<bps/>'),
  exportOristudioBpProjectAsSessionBps: vi.fn(async () => '<bps/>'),
  restoreOristudioBpProjectSnapshot: vi.fn(),
}));

vi.mock('../oristudioBpRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../oristudioBpRuntime')>();
  return {
    ...actual,
    exportOristudioBpProjectAsBps: runtimeMocks.exportOristudioBpProjectAsBps,
    exportOristudioBpProjectAsSessionBps: runtimeMocks.exportOristudioBpProjectAsSessionBps,
    restoreOristudioBpProjectSnapshot: runtimeMocks.restoreOristudioBpProjectSnapshot,
  };
});

const analytics = vi.hoisted(() => ({ trackSymmetryPairChanged: vi.fn() }));

vi.mock('../../../analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../analytics')>();
  return { ...actual, trackSymmetryPairChanged: analytics.trackSymmetryPairChanged };
});

const { useWorkspaceStore } = await import('../store');

// A vertical axis through x = 4, the 8×8 tree sheet's centre.
const AXIS = { angle: 90, loc: { x: 4, y: 4 } };

//   0 (root, on the axis)
//   ├─ 1 (left)  ── reflection of 2
//   ├─ 2 (right) ── reflection of 1
//   ├─ 3 (left)  ── reflection of 4
//   ├─ 4 (right) ── reflection of 3
//   └─ 5 (left, nothing opposite)
function tree(): OristudioBpTreeView {
  const vertex = (id: number, x: number, y: number) => ({
    id,
    name: `v${id}`,
    loc: { x, y },
    isRoot: id === 0,
    isLeaf: id !== 0,
    degree: id === 0 ? 5 : 1,
    dist: id === 0 ? 0 : 1,
    height: id === 0 ? 1 : 0,
    maxHeight: null,
    maxNewLeafLength: null,
    dualFlapId: null,
  });
  return {
    rootVertexId: 0,
    sheet: {
      kind: 'rectangular',
      width: 8,
      height: 8,
      grid: { kind: 'rectangular', interval: 1, snap: true },
    },
    vertices: [
      vertex(0, 4, 4),
      vertex(1, 2, 6),
      vertex(2, 6, 6),
      vertex(3, 1, 3),
      vertex(4, 7, 3),
      vertex(5, 2, 2),
    ],
    edges: [],
    maxTreeHeight: null,
  };
}

/** Only the fields the pairing verbs and the undo path read. */
function bpDocument(): OristudioBpDocumentState {
  return {
    activeSurface: 'tree',
    // Undo labels the redo entry from here; without it the restore throws.
    history: { activeLabel: 'edit' },
    snapshot: { tree: tree() },
  } as unknown as OristudioBpDocumentState;
}

function setUp(pairs: { v1: number; v2: number }[] = []) {
  useWorkspaceStore.setState(
    {
      ...useWorkspaceStore.getInitialState(),
      ...singleBoxPleatDesignTab({
        document: bpDocument(),
        symmetry: {
          ...AXIS,
          enabled: true,
          fold: 'book',
          quarterTurn: false,
          sidesSwapped: false,
          pairs,
        },
      }),
      dirty: false,
    },
    true
  );
}

const state = () => useWorkspaceStore.getState();
const pairs = () => selectOristudioBpSymmetry(state()).pairs;
const lastLabel = () => selectOristudioBpHistoryPast(state()).at(-1)?.label;

beforeEach(() => {
  analytics.trackSymmetryPairChanged.mockClear();
});

afterEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('pairOristudioBpTreeSymmetry', () => {
  it('pairs the vertex with the one at its reflection, as one undoable, dirtying edit', async () => {
    setUp();
    state().pairOristudioBpTreeSymmetry(1);
    expect(pairs()).toEqual([{ v1: 1, v2: 2 }]);
    expect(state().dirty).toBe(true);
    expect(lastLabel()).toBe('Pair with mirror');
    expect(analytics.trackSymmetryPairChanged).toHaveBeenCalledWith({
      designKind: 'box-pleat',
      action: 'pair',
      pairCount: 1,
    });

    await state().undo();
    expect(pairs()).toEqual([]);
  });

  it('works from either side', () => {
    setUp();
    state().pairOristudioBpTreeSymmetry(2);
    expect(pairs()).toEqual([{ v1: 1, v2: 2 }]);
  });

  it('does nothing, and records nothing, for a vertex with nothing opposite', () => {
    setUp();
    state().pairOristudioBpTreeSymmetry(5);
    expect(pairs()).toEqual([]);
    expect(state().dirty).toBe(false);
    expect(selectOristudioBpHistoryPast(state())).toEqual([]);
    expect(analytics.trackSymmetryPairChanged).not.toHaveBeenCalled();
  });

  it('does nothing for a vertex that is already paired', () => {
    setUp([{ v1: 1, v2: 2 }]);
    state().pairOristudioBpTreeSymmetry(1);
    expect(pairs()).toEqual([{ v1: 1, v2: 2 }]);
    expect(state().dirty).toBe(false);
  });
});

describe('pairAllOristudioBpTreeSymmetry', () => {
  it('pairs every mirrored vertex at once, as one undo entry', async () => {
    setUp();
    state().pairAllOristudioBpTreeSymmetry();
    expect(pairs()).toEqual([
      { v1: 1, v2: 2 },
      { v1: 3, v2: 4 },
    ]);
    expect(state().dirty).toBe(true);
    expect(lastLabel()).toBe('Pair all mirrored');
    expect(analytics.trackSymmetryPairChanged).toHaveBeenCalledWith({
      designKind: 'box-pleat',
      action: 'pair_all',
      pairCount: 2,
    });

    await state().undo();
    expect(pairs()).toEqual([]);
  });

  it('keeps the pairs it finds and counts only the new ones', () => {
    setUp([{ v1: 1, v2: 2 }]);
    state().pairAllOristudioBpTreeSymmetry();
    expect(pairs()).toEqual([
      { v1: 1, v2: 2 },
      { v1: 3, v2: 4 },
    ]);
    expect(analytics.trackSymmetryPairChanged).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'pair_all', pairCount: 1 })
    );
  });

  it('does nothing, and records nothing, when nothing new pairs', () => {
    setUp([
      { v1: 1, v2: 2 },
      { v1: 3, v2: 4 },
    ]);
    state().pairAllOristudioBpTreeSymmetry();
    expect(state().dirty).toBe(false);
    expect(selectOristudioBpHistoryPast(state())).toEqual([]);
    expect(analytics.trackSymmetryPairChanged).not.toHaveBeenCalled();
  });
});

describe('unpairOristudioBpTreeSymmetry', () => {
  it('reports the verb', () => {
    setUp([{ v1: 1, v2: 2 }]);
    state().unpairOristudioBpTreeSymmetry(1);
    expect(pairs()).toEqual([]);
    expect(analytics.trackSymmetryPairChanged).toHaveBeenCalledWith({
      designKind: 'box-pleat',
      action: 'unpair',
      pairCount: 1,
    });
  });

  it('reports nothing when there was no pair to break', () => {
    setUp();
    state().unpairOristudioBpTreeSymmetry(1);
    expect(analytics.trackSymmetryPairChanged).not.toHaveBeenCalled();
  });
});
