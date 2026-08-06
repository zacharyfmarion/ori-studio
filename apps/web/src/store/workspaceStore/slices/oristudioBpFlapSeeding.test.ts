import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectOristudioBpHistoryPast, singleBoxPleatDesignTab } from '../designTabs';
import type {
  OristudioBpDocumentState,
  OristudioBpFlap,
  OristudioBpSheet,
  OristudioBpTreeVertex,
} from '../../../engine/oristudioBpTypes';
import type { Point } from '../../../lib/geometry';

/**
 * A new leaf's flap starts where the leaf was drawn, and its partner's at the
 * reflection of that.
 *
 * The engine seeds a flap when `add_leaf` runs, from the spot it parked the new
 * vertex at — and because that spot is chosen against tree-node occupancy which
 * the caller's reposition then vacates, every leaf added to a design used to land
 * its flap on the same cell. The map and the mirror are unit-tested in
 * `lib/bpFlapSeeding.test.ts`; these cover the wiring.
 */

const runtimeMocks = vi.hoisted(() => ({
  addOristudioBpTreeLeaf: vi.fn(),
  moveOristudioBpTreeVertex: vi.fn(),
  moveOristudioBpLayoutFlap: vi.fn(),
  exportOristudioBpProjectAsBps: vi.fn(async () => '<bps/>'),
}));

vi.mock('../oristudioBpRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../oristudioBpRuntime')>();
  return {
    ...actual,
    addOristudioBpTreeLeaf: runtimeMocks.addOristudioBpTreeLeaf,
    moveOristudioBpTreeVertex: runtimeMocks.moveOristudioBpTreeVertex,
    moveOristudioBpLayoutFlap: runtimeMocks.moveOristudioBpLayoutFlap,
    exportOristudioBpProjectAsBps: runtimeMocks.exportOristudioBpProjectAsBps,
  };
});

const { useWorkspaceStore } = await import('../store');

function sheet(width: number, height = width): OristudioBpSheet {
  return {
    kind: 'rectangular',
    width,
    height,
    grid: { kind: 'rectangular', interval: 1, snap: true },
  };
}

// The starter project's real pair of sheets. The 20 → 16 ratio is what makes the
// tree→layout map a scaling rather than a copy.
const TREE_SHEET = sheet(20);
const LAYOUT_SHEET = sheet(16);
// The tree's mirror line: vertical through the tree sheet's centre.
const TREE_AXIS = { angle: 90, loc: { x: 10, y: 10 } };

function vertex(id: number, x: number, y: number): OristudioBpTreeVertex {
  return {
    id,
    name: `v${id}`,
    loc: { x, y },
    isRoot: id === 0,
    isLeaf: id !== 0,
    degree: 1,
    dist: 0,
    height: 0,
    maxHeight: null,
    maxNewLeafLength: null,
    dualFlapId: null,
  };
}

function flap(id: number, x: number, y: number): OristudioBpFlap {
  return {
    id,
    vertexId: id,
    name: `f${id}`,
    anchor: { x, y },
    width: 0,
    height: 0,
    radius: 1,
    constrained: true,
  };
}

/**
 * A fake engine, holding just enough state for the add path to read its own
 * writes: the leaf it created, where the caller then moved it, and where each
 * flap sits.
 *
 * The seeded position has to be read back off the document — the partner's
 * anchor is the reflection of where the *primary's* landed — so a mock that
 * returned a fixed snapshot would not exercise the rule under test.
 */
function fakeEngine() {
  let vertices = [vertex(0, 10, 10)];
  let flaps: OristudioBpFlap[] = [];
  let nextId = 1;
  const document = (): OristudioBpDocumentState =>
    ({
      activeSurface: 'tree',
      snapshot: {
        tree: {
          rootVertexId: 0,
          sheet: TREE_SHEET,
          vertices: [...vertices],
          edges: [],
          maxTreeHeight: null,
        },
        packing: { sheet: LAYOUT_SHEET, flaps: [...flaps] },
      },
    }) as unknown as OristudioBpDocumentState;

  runtimeMocks.addOristudioBpTreeLeaf.mockImplementation(async () => {
    const id = nextId++;
    // The engine parks every new leaf on the same spot, which is the defect this
    // path exists to correct — see the module doc.
    vertices = [...vertices, vertex(id, 11, 10)];
    flaps = [...flaps, flap(id, 9, 8)];
    return document();
  });
  runtimeMocks.moveOristudioBpTreeVertex.mockImplementation(async (id: number, loc: Point) => {
    vertices = vertices.map((v) => (v.id === id ? { ...v, loc } : v));
    return document();
  });
  runtimeMocks.moveOristudioBpLayoutFlap.mockImplementation(async (id: number, loc: Point) => {
    flaps = flaps.map((f) => (f.id === id ? { ...f, anchor: loc } : f));
    return document();
  });
  return { document, anchorOf: (id: number) => flaps.find((f) => f.id === id)?.anchor };
}

let engine: ReturnType<typeof fakeEngine>;

function setUp(symmetry: { enabled: boolean; fold?: 'book' | 'diagonal' }) {
  engine = fakeEngine();
  useWorkspaceStore.setState(
    {
      ...useWorkspaceStore.getInitialState(),
      ...singleBoxPleatDesignTab({
        document: engine.document(),
        symmetry: {
          ...TREE_AXIS,
          enabled: symmetry.enabled,
          fold: symmetry.fold ?? 'book',
          pairs: [],
        },
      }),
    },
    true
  );
}

beforeEach(() => {
  for (const mock of Object.values(runtimeMocks)) mock.mockReset();
  runtimeMocks.exportOristudioBpProjectAsBps.mockImplementation(async () => '<bps/>');
});

afterEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('addOristudioBpTreeLeaf', () => {
  it('seeds the flap where the leaf was drawn, not where the engine parked it', async () => {
    setUp({ enabled: false });
    await useWorkspaceStore.getState().addOristudioBpTreeLeaf(0, { x: 15, y: 5 });
    // 20 -> 16 is a factor of 0.8, so (15, 5) maps to (12, 4). The engine had it
    // at (9, 8).
    expect(engine.anchorOf(1)).toEqual({ x: 12, y: 4 });
  });

  it('stops consecutive adds piling every flap on one cell', async () => {
    setUp({ enabled: false });
    await useWorkspaceStore.getState().addOristudioBpTreeLeaf(0, { x: 15, y: 5 });
    await useWorkspaceStore.getState().addOristudioBpTreeLeaf(0, { x: 5, y: 15 });
    expect(engine.anchorOf(1)).not.toEqual(engine.anchorOf(2));
  });

  it('leaves the engine placement alone when no position was drawn', async () => {
    setUp({ enabled: false });
    await useWorkspaceStore.getState().addOristudioBpTreeLeaf(0, undefined);
    expect(engine.anchorOf(1)).toEqual({ x: 9, y: 8 });
  });
});

describe('addOristudioBpTreeLeafWithSymmetry', () => {
  it('starts a mirror pair at mirrored positions', async () => {
    setUp({ enabled: true });
    await useWorkspaceStore.getState().addOristudioBpTreeLeafWithSymmetry(0, { x: 15, y: 5 });
    const primary = engine.anchorOf(1);
    const partner = engine.anchorOf(2);
    expect(primary).toEqual({ x: 12, y: 4 });
    // Reflected about the layout sheet's centre at x = 8, not the tree's at 10.
    expect(partner).toEqual({ x: 4, y: 4 });
  });

  it('mirrors the primary rather than mapping the partner again', async () => {
    setUp({ enabled: true });
    // 11.875 * 0.8 = 9.5, which rounds up to 10. Its tree mirror is 8.125, and
    // 8.125 * 0.8 = 6.5, which also rounds up — to 7. So mapping each side
    // independently would give 10 and 7, which are not mirrors about 8.
    await useWorkspaceStore.getState().addOristudioBpTreeLeafWithSymmetry(0, { x: 11.875, y: 5 });
    expect(engine.anchorOf(1)).toEqual({ x: 10, y: 4 });
    expect(engine.anchorOf(2)).toEqual({ x: 6, y: 4 });
  });

  it('leaves a centred leaf on the mirror, with no partner', async () => {
    setUp({ enabled: true });
    await useWorkspaceStore
      .getState()
      .addOristudioBpTreeLeafWithSymmetry(0, { x: 10, y: 5 }, 0.5);
    expect(engine.anchorOf(1)).toEqual({ x: 8, y: 4 });
    expect(engine.anchorOf(2)).toBeUndefined();
  });

  it('records one undo entry for the pair and both seeds', async () => {
    setUp({ enabled: true });
    await useWorkspaceStore.getState().addOristudioBpTreeLeafWithSymmetry(0, { x: 15, y: 5 });
    expect(selectOristudioBpHistoryPast(useWorkspaceStore.getState())).toHaveLength(1);
  });
});
