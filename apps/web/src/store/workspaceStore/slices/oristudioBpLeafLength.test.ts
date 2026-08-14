import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { singleBoxPleatDesignTab } from '../designTabs';
import type {
  OristudioBpDocumentState,
  OristudioBpSheet,
  OristudioBpTreeVertex,
} from '../../../engine/oristudioBpTypes';
import type { Point } from '../../../lib/geometry';

/**
 * A leaf is created at the length it is about to be *drawn* at.
 *
 * The engine mints a leaf at a length the caller chooses and the caller then
 * repositions it. Asking for 1 and moving the vertex three cells out is how a
 * flap came to be drawn at three and labelled one — the geometry and the number
 * are two different facts and only one of them was being set.
 *
 * Tested here rather than through the pane because the pane genuinely cannot see
 * the difference: it draws vertex positions, which were right the whole time.
 * That is exactly why this shipped.
 */

const runtimeMocks = vi.hoisted(() => ({
  addOristudioBpTreeLeaf: vi.fn(),
  moveOristudioBpTreeVertex: vi.fn(),
  moveOristudioBpLayoutFlap: vi.fn(),
  exportOristudioBpProjectAsBps: vi.fn(async () => '<bps/>'),
  exportOristudioBpProjectAsSessionBps: vi.fn(async () => '<bps/>'),
}));

vi.mock('../oristudioBpRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../oristudioBpRuntime')>();
  return {
    ...actual,
    addOristudioBpTreeLeaf: runtimeMocks.addOristudioBpTreeLeaf,
    moveOristudioBpTreeVertex: runtimeMocks.moveOristudioBpTreeVertex,
    moveOristudioBpLayoutFlap: runtimeMocks.moveOristudioBpLayoutFlap,
    exportOristudioBpProjectAsBps: runtimeMocks.exportOristudioBpProjectAsBps,
    exportOristudioBpProjectAsSessionBps: runtimeMocks.exportOristudioBpProjectAsSessionBps,
  };
});

const { useWorkspaceStore } = await import('../store');

const SHEET: OristudioBpSheet = {
  kind: 'rectangular',
  width: 20,
  height: 20,
  grid: { kind: 'rectangular', interval: 1, snap: true },
};
const AXIS = { angle: 90, loc: { x: 10, y: 10 } };

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

/** Records the length each add asked for; the geometry is not the subject here. */
function fakeEngine() {
  let vertices = [vertex(0, 10, 10)];
  let nextId = 1;
  const lengths: number[] = [];
  const document = (): OristudioBpDocumentState =>
    ({
      activeSurface: 'tree',
      snapshot: {
        tree: {
          rootVertexId: 0,
          sheet: SHEET,
          vertices: [...vertices],
          edges: [],
          maxTreeHeight: null,
        },
        packing: { sheet: SHEET, flaps: [] },
      },
    }) as unknown as OristudioBpDocumentState;

  runtimeMocks.addOristudioBpTreeLeaf.mockImplementation(async (_at: number, length: number) => {
    lengths.push(length);
    vertices = [...vertices, vertex(nextId++, 11, 10)];
    return document();
  });
  runtimeMocks.moveOristudioBpTreeVertex.mockImplementation(async (id: number, loc: Point) => {
    vertices = vertices.map((v) => (v.id === id ? { ...v, loc } : v));
    return document();
  });
  runtimeMocks.moveOristudioBpLayoutFlap.mockImplementation(async () => document());
  return { document, lengths };
}

let engine: ReturnType<typeof fakeEngine>;

function setUp(symmetryEnabled: boolean) {
  engine = fakeEngine();
  useWorkspaceStore.setState(
    {
      ...useWorkspaceStore.getInitialState(),
      ...singleBoxPleatDesignTab({
        document: engine.document(),
        symmetry: { ...AXIS, enabled: symmetryEnabled, fold: 'book', quarterTurn: false, sidesSwapped: false, pairs: [] },
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

describe('the length a new leaf is created at', () => {
  it('is the distance it is drawn at, not always one', async () => {
    setUp(false);
    // Three cells straight up from the root at (10, 10).
    await useWorkspaceStore.getState().addOristudioBpTreeLeaf(0, { x: 10, y: 13 });
    expect(engine.lengths).toEqual([3]);
  });

  it('is whole cells, because box-pleat lengths are', async () => {
    setUp(false);
    // 3-4-5: exactly five cells away, and a diagonal the grid cannot express.
    await useWorkspaceStore.getState().addOristudioBpTreeLeaf(0, { x: 13, y: 14 });
    expect(engine.lengths).toEqual([5]);
  });

  it('never goes below the engine floor of one', async () => {
    setUp(false);
    await useWorkspaceStore.getState().addOristudioBpTreeLeaf(0, { x: 10.1, y: 10 });
    expect(engine.lengths).toEqual([1]);
  });

  it('falls back to one when the caller names no position', async () => {
    setUp(false);
    await useWorkspaceStore.getState().addOristudioBpTreeLeaf(0, undefined);
    expect(engine.lengths).toEqual([1]);
  });

  it('gives a mirrored pair the same length on both sides', async () => {
    setUp(true);
    // Off the axis at x = 10, so this adds a leaf and its twin.
    await useWorkspaceStore
      .getState()
      .addOristudioBpTreeLeafWithSymmetry(0, { x: 13, y: 14 }, 0.02);
    expect(engine.lengths.length).toBeGreaterThan(1);
    for (const length of engine.lengths) expect(length).toBe(5);
  });
});
