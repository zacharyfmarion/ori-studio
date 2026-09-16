import { singleBoxPleatDesignTab } from '../designTabs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioBpDocumentState, OristudioBpTreeView } from '../../../engine/oristudioBpTypes';

/**
 * Moving a tree vertex, or setting an edge length, under symmetry carries the
 * mirror partner — and only a partner the user actually paired.
 *
 * The geometry is unit-tested in `lib/bpTreeSymmetry.test.ts`; these cover the
 * wiring, and above all the one rule that used to be false: once a pair is
 * broken with Unpair, nothing about where the two vertices sit may pair them
 * again. Unpair moves nothing, so they are still reflections of each other at
 * the moment of the next drag.
 */

const runtimeMocks = vi.hoisted(() => ({
  moveOristudioBpTreeVertex: vi.fn(),
  updateOristudioBpTreeEdgeLength: vi.fn(),
  exportOristudioBpProjectAsBps: vi.fn(async () => '<bps/>'),
  exportOristudioBpProjectAsSessionBps: vi.fn(async () => '<bps/>'),
}));

vi.mock('../oristudioBpRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../oristudioBpRuntime')>();
  return {
    ...actual,
    moveOristudioBpTreeVertex: runtimeMocks.moveOristudioBpTreeVertex,
    updateOristudioBpTreeEdgeLength: runtimeMocks.updateOristudioBpTreeEdgeLength,
    exportOristudioBpProjectAsBps: runtimeMocks.exportOristudioBpProjectAsBps,
    exportOristudioBpProjectAsSessionBps: runtimeMocks.exportOristudioBpProjectAsSessionBps,
  };
});

const { useWorkspaceStore } = await import('../store');

// A vertical axis through x = 4, matching the fixture in bpTreeSymmetry.test.ts.
const AXIS = { angle: 90, loc: { x: 4, y: 4 } };

//   0 (root, on the axis)
//   ├─ 1 (left)   ── reflection of 2
//   ├─ 2 (right)  ── reflection of 1
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
  const edge = (id: number, from: number, to: number) => ({
    id,
    vertices: [from, to] as [number, number],
    length: 2,
    maxLength: null,
    isLeafEdge: true,
    dualRiverId: null,
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
    edges: [edge(10, 0, 1), edge(11, 0, 2), edge(12, 0, 3)],
    maxTreeHeight: null,
  };
}

/** Only the fields the tree-edit paths read; the rest of the document is inert here. */
function bpDocument(): OristudioBpDocumentState {
  return {
    activeSurface: 'tree',
    snapshot: { tree: tree() },
  } as unknown as OristudioBpDocumentState;
}

function setUp(symmetry: { enabled?: boolean; pairs?: { v1: number; v2: number }[] } = {}) {
  useWorkspaceStore.setState(
    {
      ...useWorkspaceStore.getInitialState(),
      ...singleBoxPleatDesignTab({
        document: bpDocument(),
        symmetry: {
          ...AXIS,
          enabled: symmetry.enabled ?? true,
          fold: 'book',
          quarterTurn: false,
          sidesSwapped: false,
          pairs: symmetry.pairs ?? [],
        },
      }),
    },
    true
  );
}

/** `[id, loc]` for every vertex move the engine was asked to make. */
function moves(): [number, { x: number; y: number }][] {
  return runtimeMocks.moveOristudioBpTreeVertex.mock.calls.map((call) => [call[0], call[1]]);
}

/** `[vertices, length]` for every edge-length edit the engine was asked to make. */
function lengthEdits(): [[number, number], number][] {
  return runtimeMocks.updateOristudioBpTreeEdgeLength.mock.calls.map((call) => [
    [...call[0]] as [number, number],
    call[1],
  ]);
}

beforeEach(() => {
  runtimeMocks.moveOristudioBpTreeVertex.mockReset();
  runtimeMocks.updateOristudioBpTreeEdgeLength.mockReset();
  runtimeMocks.moveOristudioBpTreeVertex.mockImplementation(async () => bpDocument());
  runtimeMocks.updateOristudioBpTreeEdgeLength.mockImplementation(async () => bpDocument());
  runtimeMocks.exportOristudioBpProjectAsBps.mockClear();
});

afterEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('moveOristudioBpTreeVerticesWithSymmetry', () => {
  it('carries an explicitly paired partner to the reflected position', async () => {
    setUp({ pairs: [{ v1: 1, v2: 2 }] });
    await expect(
      useWorkspaceStore
        .getState()
        .moveOristudioBpTreeVerticesWithSymmetry([{ id: 1, loc: { x: 1, y: 7 } }])
    ).resolves.toBe(true);
    expect(moves()).toEqual([
      [1, { x: 1, y: 7 }],
      [2, { x: 7, y: 7 }],
    ]);
  });

  it('moves one vertex once the pair is broken', async () => {
    setUp({ pairs: [{ v1: 1, v2: 2 }] });
    useWorkspaceStore.getState().unpairOristudioBpTreeSymmetry(1);
    await useWorkspaceStore
      .getState()
      .moveOristudioBpTreeVerticesWithSymmetry([{ id: 1, loc: { x: 1, y: 7 } }]);
    expect(moves()).toEqual([[1, { x: 1, y: 7 }]]);
  });

  it('moves a vertex with no partner alone', async () => {
    setUp();
    await useWorkspaceStore
      .getState()
      .moveOristudioBpTreeVerticesWithSymmetry([{ id: 3, loc: { x: 1, y: 2 } }]);
    expect(moves()).toEqual([[3, { x: 1, y: 2 }]]);
  });
});

describe('setOristudioBpTreeEdgeLength', () => {
  it('applies the length to the paired edge too', async () => {
    setUp({ pairs: [{ v1: 1, v2: 2 }] });
    await useWorkspaceStore.getState().setOristudioBpTreeEdgeLength([0, 1], 3);
    expect(lengthEdits()).toEqual([
      [[0, 1], 3],
      [[0, 2], 3],
    ]);
  });

  it('touches one edge once the pair is broken', async () => {
    setUp({ pairs: [{ v1: 1, v2: 2 }] });
    useWorkspaceStore.getState().unpairOristudioBpTreeSymmetry(1);
    await useWorkspaceStore.getState().setOristudioBpTreeEdgeLength([0, 1], 3);
    expect(lengthEdits()).toEqual([[[0, 1], 3]]);
  });
});
