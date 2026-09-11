import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExploriDocument, type ExploriDocument } from '../../../explori/document';

/**
 * The ExplOri tree's pairing verbs — Pair with mirror, Pair all mirrored,
 * Unpair from mirror — over the document rather than an engine snapshot.
 *
 * The matching is unit-tested in `explori/symmetry.test.ts`; this covers the
 * wiring: each verb is one undo entry that leaves unsaved work and reports
 * itself, and each is a refused no-op when it has nothing to do.
 */

const analytics = vi.hoisted(() => ({ trackSymmetryPairChanged: vi.fn() }));

vi.mock('../../../analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../analytics')>();
  return { ...actual, trackSymmetryPairChanged: analytics.trackSymmetryPairChanged };
});

// The slice reads the document through a design handle; with none registered it
// falls back to the design's own document, which is all these need.
vi.mock('../../../engines/designHandles', () => ({
  acquireDesignHandle: vi.fn(async () => 1),
  adoptDesignHandle: vi.fn(async () => true),
  withDesignHandle: vi.fn(),
  serializeDesign: vi.fn(async () => 'serialized'),
  parkDesign: vi.fn(async () => undefined),
  forgetDesign: vi.fn(async () => undefined),
  adoptDesign: vi.fn(),
  isDesignHot: vi.fn(() => false),
  hotDesignIds: vi.fn(() => []),
  subscribeToDesignHandles: vi.fn(() => () => undefined),
}));

const { useWorkspaceStore } = await import('../store');
const { patchExploriDesign, selectExploriDesign, singleDesignTab } = await import('../designTabs');

//   0 (root, on the axis)
//   ├─ 1 (left)   ── reflection of 2
//   ├─ 2 (right)  ── reflection of 1
//   └─ 3 (left, nothing opposite)
function drawing(pairs: { v1: number; v2: number }[] = []): ExploriDocument {
  return {
    ...createExploriDocument(),
    nodes: [
      { id: 0, loc: { x: 0, y: 0 }, name: '' },
      { id: 1, loc: { x: -2, y: 1 }, name: '' },
      { id: 2, loc: { x: 2, y: 1 }, name: '' },
      { id: 3, loc: { x: -1, y: 3 }, name: '' },
    ],
    edges: [
      { id: 10, vertices: [0, 1], length: 1 },
      { id: 11, vertices: [0, 2], length: 1 },
      { id: 12, vertices: [0, 3], length: 1 },
    ],
    nextNodeId: 4,
    nextEdgeId: 13,
    symmetry: { enabled: true, pairs },
  };
}

function setUp(pairs: { v1: number; v2: number }[] = []) {
  const seeded = singleDesignTab('explori', 'Search');
  useWorkspaceStore.setState({ ...useWorkspaceStore.getInitialState(), ...seeded, dirty: false }, true);
  const state = useWorkspaceStore.getState();
  useWorkspaceStore.setState(
    patchExploriDesign(state, seeded.activeDesignId, { document: drawing(pairs) })
  );
}

const state = () => useWorkspaceStore.getState();
const design = () => {
  const found = selectExploriDesign(state(), state().activeDesignId);
  if (!found) throw new Error('expected an explori design');
  return found;
};
const pairs = () => design().document.symmetry.pairs;

beforeEach(() => {
  analytics.trackSymmetryPairChanged.mockClear();
});

afterEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('pairExploriNode', () => {
  it('pairs the node with the one at its reflection, as one dirtying undo entry', async () => {
    setUp();
    await expect(state().pairExploriNode(1)).resolves.toBe(true);
    expect(pairs()).toEqual([{ v1: 1, v2: 2 }]);
    expect(state().dirty).toBe(true);
    expect(design().historyPast).toHaveLength(1);
    expect(analytics.trackSymmetryPairChanged).toHaveBeenCalledWith({
      designKind: 'explori',
      action: 'pair',
      pairCount: 1,
    });
  });

  it('refuses a node with nothing opposite, recording nothing', async () => {
    setUp();
    await expect(state().pairExploriNode(3)).resolves.toBe(false);
    expect(pairs()).toEqual([]);
    expect(design().historyPast).toHaveLength(0);
    expect(analytics.trackSymmetryPairChanged).not.toHaveBeenCalled();
  });
});

describe('pairAllExploriNodes', () => {
  it('pairs everything mirrored at once', async () => {
    setUp();
    await expect(state().pairAllExploriNodes()).resolves.toBe(true);
    expect(pairs()).toEqual([{ v1: 1, v2: 2 }]);
    expect(analytics.trackSymmetryPairChanged).toHaveBeenCalledWith({
      designKind: 'explori',
      action: 'pair_all',
      pairCount: 1,
    });
  });

  it('refuses when nothing new pairs', async () => {
    setUp([{ v1: 1, v2: 2 }]);
    await expect(state().pairAllExploriNodes()).resolves.toBe(false);
    expect(design().historyPast).toHaveLength(0);
    expect(analytics.trackSymmetryPairChanged).not.toHaveBeenCalled();
  });
});

describe('unpairExploriNode', () => {
  it('breaks the pair and reports it', async () => {
    setUp([{ v1: 1, v2: 2 }]);
    await expect(state().unpairExploriNode(2)).resolves.toBe(true);
    expect(pairs()).toEqual([]);
    expect(analytics.trackSymmetryPairChanged).toHaveBeenCalledWith({
      designKind: 'explori',
      action: 'unpair',
      pairCount: 1,
    });
  });

  it('refuses a node that was not paired, recording nothing', async () => {
    setUp();
    await expect(state().unpairExploriNode(1)).resolves.toBe(false);
    expect(design().historyPast).toHaveLength(0);
    expect(analytics.trackSymmetryPairChanged).not.toHaveBeenCalled();
  });
});
