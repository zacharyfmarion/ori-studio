import { singleBoxPleatDesignTab } from '../designTabs';
import { selectOristudioBpHistoryPast } from '../designTabs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OristudioBpDocumentState,
  OristudioBpTreeView,
} from '../../../engine/oristudioBpTypes';

/**
 * Deleting under symmetry removes the mirror partner too, in one engine call and
 * one undo entry.
 *
 * The pair resolution itself is unit-tested in `lib/bpTreeSymmetry.test.ts`; what
 * these cover is the wiring — that the store actually asks for both ids, sends
 * them as a single batch (so the engine settles the cascade and the minimum-tree
 * floor across both rather than deleting one and refusing the other), and leaves
 * the behaviour alone when symmetry is off.
 */

const runtimeMocks = vi.hoisted(() => ({
  deleteOristudioBpTreeLeaves: vi.fn(),
  exportOristudioBpProjectAsBps: vi.fn(async () => '<bps/>'),
  exportOristudioBpProjectAsSessionBps: vi.fn(async () => '<bps/>'),
}));

vi.mock('../oristudioBpRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../oristudioBpRuntime')>();
  return {
    ...actual,
    deleteOristudioBpTreeLeaves: runtimeMocks.deleteOristudioBpTreeLeaves,
    exportOristudioBpProjectAsBps: runtimeMocks.exportOristudioBpProjectAsBps,
    exportOristudioBpProjectAsSessionBps: runtimeMocks.exportOristudioBpProjectAsSessionBps,
  };
});

const { useWorkspaceStore } = await import('../store');

// A vertical axis through x = 4, matching the fixture in bpTreeSymmetry.test.ts.
const AXIS = { angle: 90, loc: { x: 4, y: 4 } };

//   0 (root, on the axis)
//   ├─ 1 (left)   ── mirror of 2
//   ├─ 2 (right)  ── mirror of 1
//   └─ 3 (left, no counterpart)
function tree(): OristudioBpTreeView {
  const vertex = (id: number, x: number, y: number) => ({
    id,
    name: `v${id}`,
    loc: { x, y },
    isRoot: id === 0,
    isLeaf: id !== 0,
    degree: id === 0 ? 3 : 1,
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
    vertices: [vertex(0, 4, 4), vertex(1, 2, 6), vertex(2, 6, 6), vertex(3, 1, 3)],
    edges: [],
    maxTreeHeight: null,
  };
}

/** Only the fields the delete path reads; the rest of the document is inert here. */
function bpDocument(): OristudioBpDocumentState {
  return {
    activeSurface: 'tree',
    snapshot: { tree: tree() },
  } as unknown as OristudioBpDocumentState;
}

function setUp(symmetry: { enabled: boolean; pairs?: { v1: number; v2: number }[] }) {
  useWorkspaceStore.setState(
    {
      ...useWorkspaceStore.getInitialState(),
      ...singleBoxPleatDesignTab({
        document: bpDocument(),
        symmetry: {
          ...AXIS,
          enabled: symmetry.enabled,
          fold: 'book',
          quarterTurn: false,
          sidesSwapped: false,
          pairs: symmetry.pairs ?? [],
        },
      }),
    },
    true,
  );
}

/** Ids handed to the engine by the one delete call this action should make. */
function deletedIds(): number[] {
  expect(runtimeMocks.deleteOristudioBpTreeLeaves).toHaveBeenCalledTimes(1);
  return [...runtimeMocks.deleteOristudioBpTreeLeaves.mock.calls[0][0]];
}

beforeEach(() => {
  runtimeMocks.deleteOristudioBpTreeLeaves.mockReset();
  runtimeMocks.deleteOristudioBpTreeLeaves.mockImplementation(async () => bpDocument());
  runtimeMocks.exportOristudioBpProjectAsBps.mockClear();
});

afterEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('deleteOristudioBpTreeNode under symmetry', () => {
  it('deletes the mirror partner along with the selected node', async () => {
    setUp({ enabled: true });
    await expect(useWorkspaceStore.getState().deleteOristudioBpTreeNode(1)).resolves.toBe(true);
    expect(deletedIds()).toEqual([1, 2]);
  });

  it('works from either side of the axis', async () => {
    setUp({ enabled: true });
    await useWorkspaceStore.getState().deleteOristudioBpTreeNode(2);
    expect(deletedIds()).toEqual([2, 1]);
  });

  it('honours an explicit pair over the geometric guess', async () => {
    setUp({ enabled: true, pairs: [{ v1: 1, v2: 3 }] });
    await useWorkspaceStore.getState().deleteOristudioBpTreeNode(1);
    expect(deletedIds()).toEqual([1, 3]);
  });

  it('deletes an on-axis node once', async () => {
    setUp({ enabled: true });
    await useWorkspaceStore.getState().deleteOristudioBpTreeNode(0);
    expect(deletedIds()).toEqual([0]);
  });

  it('deletes an unpaired node alone', async () => {
    setUp({ enabled: true });
    await useWorkspaceStore.getState().deleteOristudioBpTreeNode(3);
    expect(deletedIds()).toEqual([3]);
  });

  /**
   * Mirror draw off does not mean symmetry off.
   *
   * The toggle decides whether a *new* node is drawn with a twin. A pair that
   * already exists is part of the design, so editing one member still carries the
   * other — otherwise the whole feature would vanish the moment the user stopped
   * drawing symmetrically.
   */
  it('still takes the partner after mirror draw is switched off', async () => {
    setUp({ enabled: false });
    await useWorkspaceStore.getState().deleteOristudioBpTreeNode(1);
    expect(deletedIds()).toEqual([1, 2]);
  });

  it('records one undo entry for the pair, not two', async () => {
    setUp({ enabled: true });
    await useWorkspaceStore.getState().deleteOristudioBpTreeNode(1);
    expect(selectOristudioBpHistoryPast(useWorkspaceStore.getState())).toHaveLength(1);
  });

  it('labels the mirrored delete distinctly, so undo reads correctly', async () => {
    setUp({ enabled: true });
    await useWorkspaceStore.getState().deleteOristudioBpTreeNode(1);
    expect(useWorkspaceStore.getState().projectMessage).toBe('Deleted mirrored BP nodes');

    // Node 3 has no counterpart, so this one really is a single delete — the
    // label follows what happened, not which mode the editor is in.
    setUp({ enabled: true });
    await useWorkspaceStore.getState().deleteOristudioBpTreeNode(3);
    expect(useWorkspaceStore.getState().projectMessage).toBe('Deleted BP node');
  });
});
