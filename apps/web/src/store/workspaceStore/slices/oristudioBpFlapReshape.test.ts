import { singleBoxPleatDesignTab } from '../designTabs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OristudioBpDocumentState,
  OristudioBpFlapReshape,
} from '../../../engine/oristudioBpTypes';

/**
 * `reshapeOristudioBpFlap`: what a resize *handle* commits, as opposed to the
 * typed width/height fields.
 *
 * A flap draws as its box grown by its radius, so dragging one of its edges
 * generally moves the anchor and the box and the radius at once. Three things
 * have to hold, and each of them is a bug that would look plausible:
 *
 * - The partner's anchor is mirrored from the primary's **new** box. A
 *   reflection of a lower-left corner picks up the size term, so mirroring
 *   against the old box lands the partner off by exactly the amount the flap
 *   grew — invisible on a point flap, obvious on a large one.
 * - The partner's radius is the *same* number. A reflection preserves length;
 *   it is the dimensions that swap on a diagonal fold.
 * - The leaf vertex only moves on release. Keeping the tree drawing
 *   length-faithful is a drawing correction, and paying for it every frame of a
 *   drag buys a round trip nobody is looking at.
 */

const runtimeMocks = vi.hoisted(() => ({
  reshapeOristudioBpLayoutFlap: vi.fn(),
  exportOristudioBpProjectAsBps: vi.fn(async () => '<bps/>'),
  // History snapshots take the *session* form, which keeps the stretch
  // repository and the config/pattern indices — undo has to land back on the
  // exact selection, not on a prototype that regenerates at index 0.
  exportOristudioBpProjectAsSessionBps: vi.fn(async () => '<bps/>'),
}));

vi.mock('../oristudioBpRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../oristudioBpRuntime')>();
  return {
    ...actual,
    reshapeOristudioBpLayoutFlap: runtimeMocks.reshapeOristudioBpLayoutFlap,
    exportOristudioBpProjectAsBps: runtimeMocks.exportOristudioBpProjectAsBps,
    exportOristudioBpProjectAsSessionBps: runtimeMocks.exportOristudioBpProjectAsSessionBps,
  };
});

const { useWorkspaceStore } = await import('../store');

/** The tree's mirror line: vertical through x = 4, the 8×8 tree sheet's centre. */
const AXIS = { angle: 90, loc: { x: 4, y: 4 } };

/**
 * The layout sheet is 16×16 while the tree sheet is 8×8, on purpose: the layout
 * mirror runs through x = 8, and a partner reflected about the *tree's* line
 * would land four cells out.
 */
function bpDocument(kind: 'rectangular' | 'diagonal' = 'rectangular'): OristudioBpDocumentState {
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
    activeSurface: 'packing',
    snapshot: {
      tree: {
        rootVertexId: 0,
        sheet: { kind, width: 8, height: 8, grid: { kind, interval: 1, snap: true } },
        vertices: [vertex(0, 4, 4), vertex(1, 2, 4), vertex(2, 6, 4), vertex(3, 1, 3)],
        // Leaf 1 sits two cells left of the root along -x, so a radius of 5 puts
        // it five cells out in the same direction.
        edges: [
          { id: 10, vertices: [0, 1], length: 2, maxLength: null, isLeafEdge: true, dualRiverId: null },
          { id: 11, vertices: [0, 2], length: 2, maxLength: null, isLeafEdge: true, dualRiverId: null },
        ],
        maxTreeHeight: null,
      },
      packing: {
        sheet: { kind, width: 16, height: 16, grid: { kind, interval: 1, snap: true } },
        flaps: [],
      },
    },
  } as unknown as OristudioBpDocumentState;
}

function setUp(options: {
  fold?: 'book' | 'diagonal';
  kind?: 'rectangular' | 'diagonal';
  pairs?: { v1: number; v2: number }[];
} = {}) {
  const kind = options.kind ?? 'rectangular';
  runtimeMocks.reshapeOristudioBpLayoutFlap.mockImplementation(async () => bpDocument(kind));
  useWorkspaceStore.setState(
    {
      ...useWorkspaceStore.getInitialState(),
      ...singleBoxPleatDesignTab({
        document: bpDocument(kind),
        symmetry: {
          ...AXIS,
          enabled: true,
          fold: options.fold ?? 'book',
          quarterTurn: false,
          sidesSwapped: false,
          pairs: options.pairs ?? [],
        },
      }),
    },
    true
  );
}

/** Every `(id, reshape)` the action handed to the engine. */
function reshapes(): [number, OristudioBpFlapReshape][] {
  return runtimeMocks.reshapeOristudioBpLayoutFlap.mock.calls.map((call) => [call[0], call[1]]);
}

const FOOTPRINT = { anchor: { x: 2, y: 5 }, width: 3, height: 1, radius: 5 };

beforeEach(() => {
  runtimeMocks.reshapeOristudioBpLayoutFlap.mockReset();
  runtimeMocks.exportOristudioBpProjectAsBps.mockClear();
  runtimeMocks.exportOristudioBpProjectAsSessionBps.mockClear();
});

afterEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('reshapeOristudioBpFlap', () => {
  it('sends the whole footprint for the flap that was grabbed', async () => {
    setUp();
    await expect(
      useWorkspaceStore.getState().reshapeOristudioBpFlap(1, FOOTPRINT, true)
    ).resolves.toBe(true);
    expect(reshapes()[0]).toEqual([
      1,
      { x: 2, y: 5, width: 3, height: 1, radius: 5, vertex: undefined },
    ]);
  });

  it('mirrors the partner against the new box, not the old one', async () => {
    setUp();
    await useWorkspaceStore.getState().reshapeOristudioBpFlap(1, FOOTPRINT, true);
    // Layout sheet centre is x = 8, so the partner's anchor is 16 - 2 - 3. The
    // `- 3` is the size term; dropping it would put the partner at x = 14.
    expect(reshapes()[1]).toEqual([
      2,
      { x: 16 - 2 - 3, y: 5, width: 3, height: 1, radius: 5, vertex: undefined },
    ]);
  });

  it('exchanges the partner’s dimensions on a diagonal fold, keeping the radius', async () => {
    setUp({ fold: 'diagonal' });
    await useWorkspaceStore.getState().reshapeOristudioBpFlap(1, FOOTPRINT, true);
    const [id, reshape] = reshapes()[1];
    expect(id).toBe(2);
    expect([reshape.width, reshape.height]).toEqual([1, 3]);
    expect(reshape.radius).toBe(5);
  });

  it('honours an explicit pair over the geometric guess', async () => {
    setUp({ pairs: [{ v1: 1, v2: 3 }] });
    await useWorkspaceStore.getState().reshapeOristudioBpFlap(1, FOOTPRINT, true);
    expect(reshapes().map(([id]) => id)).toEqual([1, 3]);
  });

  it('reshapes an unpaired flap alone', async () => {
    setUp();
    await useWorkspaceStore.getState().reshapeOristudioBpFlap(3, FOOTPRINT, true);
    expect(reshapes().map(([id]) => id)).toEqual([3]);
  });

  it('leaves the tree drawing alone mid-drag and corrects it on release', async () => {
    setUp();
    await useWorkspaceStore.getState().reshapeOristudioBpFlap(1, FOOTPRINT, true);
    expect(reshapes()[0][1].vertex).toBeUndefined();

    runtimeMocks.reshapeOristudioBpLayoutFlap.mockClear();
    await useWorkspaceStore.getState().reshapeOristudioBpFlap(1, FOOTPRINT, false);
    // Leaf 1 is two cells left of the root at (4,4); a radius of 5 puts it five
    // cells out along the same direction.
    expect(reshapes()[0][1].vertex).toEqual({ x: -1, y: 4 });
  });

  it('does not move the leaf when it is already the right distance out', async () => {
    setUp();
    // Leaf 1 is at (2,4), two cells from the root at (4,4), under an edge of
    // length 2. The drawing is already faithful, so there is nothing to do.
    await useWorkspaceStore
      .getState()
      .reshapeOristudioBpFlap(1, { ...FOOTPRINT, radius: 2 }, false);
    expect(reshapes()[0][1].vertex).toBeUndefined();
  });

  /**
   * The release of a drag has to reposition the leaf even though the edge length
   * already says what it will be.
   *
   * Every mid-drag step sets the length and skips the reposition, so by the
   * release the length *is* the radius. A "has the length changed" guard would
   * skip the one reposition the whole gesture was saving up for, leaving the leaf
   * drawn one cell from its parent under a label reading 3. The question is about
   * the drawing, not the number.
   */
  it('repositions the leaf on release even after the drag already set the length', async () => {
    setUp();
    // What a mid-gesture step does: length committed, drawing left alone.
    await useWorkspaceStore.getState().reshapeOristudioBpFlap(1, FOOTPRINT, true);
    expect(reshapes()[0][1].vertex).toBeUndefined();

    // The snapshot the release reads now carries the new length already. The
    // fixture stands in for that: edge 0-1 reads 5 while leaf 1 is still two
    // cells out.
    runtimeMocks.reshapeOristudioBpLayoutFlap.mockClear();
    const settled = bpDocument();
    settled.snapshot.tree.edges[0].length = 5;
    runtimeMocks.reshapeOristudioBpLayoutFlap.mockImplementation(async () => settled);
    useWorkspaceStore.setState(
      {
        ...useWorkspaceStore.getInitialState(),
        ...singleBoxPleatDesignTab({
          document: settled,
          symmetry: {
            ...AXIS,
            enabled: true,
            fold: 'book',
            quarterTurn: false,
            sidesSwapped: false,
            pairs: [],
          },
        }),
      },
      true
    );

    await useWorkspaceStore.getState().reshapeOristudioBpFlap(1, FOOTPRINT, false);
    expect(reshapes()[0][1].vertex).toEqual({ x: -1, y: 4 });
  });

  it('leaves the partner alone when the sheet cannot carry the fold', async () => {
    // A diagonal fold needs a square sheet. Reachable only from a file saved
    // square and reopened after a resize — better to skip the mirror than to
    // send the partner somewhere off the paper.
    runtimeMocks.reshapeOristudioBpLayoutFlap.mockReset();
    const oblong = bpDocument();
    (oblong.snapshot.packing.sheet as { height: number }).height = 10;
    runtimeMocks.reshapeOristudioBpLayoutFlap.mockImplementation(async () => oblong);
    useWorkspaceStore.setState(
      {
        ...useWorkspaceStore.getInitialState(),
        ...singleBoxPleatDesignTab({
          document: oblong,
          symmetry: {
            ...AXIS,
            enabled: true,
            fold: 'diagonal',
            quarterTurn: false,
            sidesSwapped: false,
            pairs: [],
          },
        }),
      },
      true
    );
    await useWorkspaceStore.getState().reshapeOristudioBpFlap(1, FOOTPRINT, true);
    expect(reshapes().map(([id]) => id)).toEqual([1]);
  });
});
