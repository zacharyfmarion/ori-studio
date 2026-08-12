import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectOristudioBpHistoryPast, singleBoxPleatDesignTab } from '../designTabs';
import type {
  OristudioBpDocumentState,
  OristudioBpFlap,
  OristudioBpSheet,
  OristudioBpTreeView,
} from '../../../engine/oristudioBpTypes';

/**
 * Moving a flap under mirror draw carries its partner, in one undo entry.
 *
 * The geometry itself is unit-tested in `lib/bpPackingSymmetry.test.ts`; what
 * these cover is the wiring — that the store asks the engine for the partner at
 * all, that it reflects about the *layout* sheet rather than the tree's mirror
 * line, that it mirrors where the flap landed rather than where it was sent, and
 * that it leaves the behaviour alone when mirror draw is off.
 */

const runtimeMocks = vi.hoisted(() => ({
  moveOristudioBpLayoutFlap: vi.fn(),
  moveOristudioBpLayoutFlaps: vi.fn(),
  exportOristudioBpProjectAsBps: vi.fn(async () => '<bps/>'),
}));

vi.mock('../oristudioBpRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../oristudioBpRuntime')>();
  return {
    ...actual,
    moveOristudioBpLayoutFlap: runtimeMocks.moveOristudioBpLayoutFlap,
    moveOristudioBpLayoutFlaps: runtimeMocks.moveOristudioBpLayoutFlaps,
    exportOristudioBpProjectAsBps: runtimeMocks.exportOristudioBpProjectAsBps,
  };
});

const { useWorkspaceStore } = await import('../store');

// The tree's mirror line is x = 4; the layout sheet's centre is x = 8. Two
// different lines on purpose — reflecting a flap about the tree's is the mistake
// this path exists to avoid, and equal sheets would hide it.
const TREE_AXIS = { angle: 90, loc: { x: 4, y: 4 } };

function sheet(width = 16, height = 16, kind: OristudioBpSheet['kind'] = 'rectangular'): OristudioBpSheet {
  return { kind, width, height, grid: { kind: 'rectangular', interval: 1, snap: true } };
}

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
    sheet: sheet(8, 8),
    // 1 and 2 mirror each other about x = 4; 3 has no counterpart.
    vertices: [vertex(0, 4, 4), vertex(1, 2, 6), vertex(2, 6, 6), vertex(3, 1, 3)],
    edges: [],
    maxTreeHeight: null,
  };
}

function flap(id: number, x: number, y: number, width = 2, height = 1): OristudioBpFlap {
  return {
    id,
    vertexId: id,
    name: `f${id}`,
    anchor: { x, y },
    width,
    height,
    radius: 1,
    constrained: true,
  };
}

/** Only the fields the flap-move path reads; the rest is inert here. */
function bpDocument(flaps: OristudioBpFlap[], layout = sheet()): OristudioBpDocumentState {
  return {
    activeSurface: 'packing',
    snapshot: { tree: tree(), packing: { sheet: layout, flaps } },
  } as unknown as OristudioBpDocumentState;
}

const FLAPS = [flap(1, 2, 6), flap(2, 12, 6), flap(3, 1, 3)];

function setUp(
  symmetry: {
    enabled: boolean;
    fold?: 'book' | 'diagonal';
    quarterTurn?: boolean;
    pairs?: { v1: number; v2: number }[];
  },
  layout = sheet()
) {
  useWorkspaceStore.setState(
    {
      ...useWorkspaceStore.getInitialState(),
      ...singleBoxPleatDesignTab({
        document: bpDocument(FLAPS, layout),
        symmetry: {
          ...TREE_AXIS,
          enabled: symmetry.enabled,
          fold: symmetry.fold ?? 'book',
          quarterTurn: symmetry.quarterTurn ?? false,
          pairs: symmetry.pairs ?? [],
        },
      }),
    },
    true
  );
}

/** `[id, loc]` for every single-flap move the engine was asked to make. */
function singleMoves(): [number, { x: number; y: number }][] {
  return runtimeMocks.moveOristudioBpLayoutFlap.mock.calls.map((call) => [call[0], call[1]]);
}

/** `[ids, loc]` for every group move the engine was asked to make. */
function groupMoves(): [number[], { x: number; y: number }][] {
  return runtimeMocks.moveOristudioBpLayoutFlaps.mock.calls.map((call) => [[...call[0]], call[1]]);
}

beforeEach(() => {
  runtimeMocks.moveOristudioBpLayoutFlap.mockReset();
  runtimeMocks.moveOristudioBpLayoutFlaps.mockReset();
  runtimeMocks.exportOristudioBpProjectAsBps.mockClear();
  // The engine honours the request exactly unless a test says otherwise.
  const land = (ids: number[], loc: { x: number; y: number }) => {
    const reference = FLAPS.find((candidate) => candidate.id === ids[0]);
    const vector = reference
      ? { x: loc.x - reference.anchor.x, y: loc.y - reference.anchor.y }
      : { x: 0, y: 0 };
    const moving = new Set(ids);
    return bpDocument(
      FLAPS.map((candidate) =>
        moving.has(candidate.id)
          ? {
              ...candidate,
              anchor: { x: candidate.anchor.x + vector.x, y: candidate.anchor.y + vector.y },
            }
          : candidate
      )
    );
  };
  runtimeMocks.moveOristudioBpLayoutFlaps.mockImplementation(async (ids, loc) => land(ids, loc));
  runtimeMocks.moveOristudioBpLayoutFlap.mockImplementation(async (id, loc) => land([id], loc));
});

afterEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('moveOristudioBpLayoutFlapWithSymmetry', () => {
  it('carries the partner to the reflected position', async () => {
    setUp({ enabled: true });
    await expect(
      useWorkspaceStore.getState().moveOristudioBpLayoutFlapWithSymmetry(1, { x: 3, y: 9 })
    ).resolves.toBe(true);
    expect(groupMoves()).toEqual([[[1], { x: 3, y: 9 }]]);
    // Layout sheet is 16 wide and the flap is 2 wide: 16 - 3 - 2 = 11.
    expect(singleMoves()).toEqual([[2, { x: 11, y: 9 }]]);
  });

  it('reflects about the layout sheet, not the tree mirror line', async () => {
    setUp({ enabled: true });
    await useWorkspaceStore.getState().moveOristudioBpLayoutFlapWithSymmetry(1, { x: 3, y: 9 });
    // The tree's line is x = 4, which would put the partner at x = 3.
    expect(singleMoves()[0][1].x).toBe(11);
  });

  it('works from either member of the pair', async () => {
    setUp({ enabled: true });
    await useWorkspaceStore.getState().moveOristudioBpLayoutFlapWithSymmetry(2, { x: 11, y: 4 });
    expect(singleMoves()).toEqual([[1, { x: 3, y: 4 }]]);
  });

  it('honours an explicit pair over the geometric guess', async () => {
    setUp({ enabled: true, pairs: [{ v1: 1, v2: 3 }] });
    await useWorkspaceStore.getState().moveOristudioBpLayoutFlapWithSymmetry(1, { x: 3, y: 9 });
    expect(singleMoves().map(([id]) => id)).toEqual([3]);
  });

  it('moves an unpaired flap alone', async () => {
    setUp({ enabled: true });
    await useWorkspaceStore.getState().moveOristudioBpLayoutFlapWithSymmetry(3, { x: 5, y: 5 });
    expect(singleMoves()).toEqual([]);
  });

  it('still carries the partner after mirror draw is switched off', async () => {
    // Mirror draw decides whether a *new* node is drawn with a twin. A pair that
    // already exists belongs to the design, so moving one member still moves the
    // other — otherwise the feature would vanish the moment the user stopped
    // drawing symmetrically.
    setUp({ enabled: false });
    await useWorkspaceStore.getState().moveOristudioBpLayoutFlapWithSymmetry(1, { x: 3, y: 9 });
    expect(groupMoves()).toEqual([[[1], { x: 3, y: 9 }]]);
    expect(singleMoves()).toEqual([[2, { x: 11, y: 9 }]]);
  });

  it('mirrors where the flap landed, not where it was sent', async () => {
    setUp({ enabled: true });
    // A clamped engine: it takes the move but stops one cell short.
    runtimeMocks.moveOristudioBpLayoutFlaps.mockImplementationOnce(async () =>
      bpDocument(FLAPS.map((f) => (f.id === 1 ? { ...f, anchor: { x: 4, y: 9 } } : f)))
    );
    await useWorkspaceStore.getState().moveOristudioBpLayoutFlapWithSymmetry(1, { x: 3, y: 9 });
    // Mirror of the landing (x = 4), not of the request (x = 3).
    expect(singleMoves()).toEqual([[2, { x: 10, y: 9 }]]);
  });

  it('records one undo entry for the pair, not two', async () => {
    setUp({ enabled: true });
    await useWorkspaceStore.getState().moveOristudioBpLayoutFlapWithSymmetry(1, { x: 3, y: 9 });
    expect(selectOristudioBpHistoryPast(useWorkspaceStore.getState())).toHaveLength(1);
  });

  it('labels the mirrored move distinctly, so undo reads correctly', async () => {
    setUp({ enabled: true });
    await useWorkspaceStore.getState().moveOristudioBpLayoutFlapWithSymmetry(1, { x: 3, y: 9 });
    expect(useWorkspaceStore.getState().projectMessage).toBe('Moved mirrored BP flap');
  });

  it('mirrors nothing when the fold has no mirror on this sheet', async () => {
    setUp({ enabled: true, fold: 'diagonal' }, sheet(16, 10));
    await useWorkspaceStore.getState().moveOristudioBpLayoutFlapWithSymmetry(1, { x: 3, y: 9 });
    expect(groupMoves()).toHaveLength(1);
    expect(singleMoves()).toEqual([]);
  });
});

describe('moveOristudioBpLayoutFlapsWithSymmetry', () => {
  it('mirrors every flap in the group that has a partner outside it', async () => {
    setUp({ enabled: true, pairs: [{ v1: 1, v2: 2 }] });
    // Dragging flap 3 (unpaired) with flap 1 (paired to 2): only 1 mirrors.
    await useWorkspaceStore.getState().moveOristudioBpLayoutFlapsWithSymmetry([3, 1], { x: 2, y: 4 });
    expect(groupMoves()).toEqual([[[3, 1], { x: 2, y: 4 }]]);
    // The group translates by (+1, +1), so flap 1 lands at (3, 7) and its
    // partner at 16 - 3 - 2 = 11.
    expect(singleMoves()).toEqual([[2, { x: 11, y: 7 }]]);
  });

  it('mirrors nothing when the selection already holds both members', async () => {
    setUp({ enabled: true });
    await useWorkspaceStore.getState().moveOristudioBpLayoutFlapsWithSymmetry([1, 2], { x: 3, y: 9 });
    expect(singleMoves()).toEqual([]);
  });

  /** A document holding one flap, keyed to whichever tree vertex the test wants. */
  function withOneFlap(id: number, anchorX: number, enabled = true) {
    useWorkspaceStore.setState(
      {
        ...useWorkspaceStore.getInitialState(),
        ...singleBoxPleatDesignTab({
          document: bpDocument([flap(id, anchorX, 4)]),
          symmetry: { ...TREE_AXIS, enabled, fold: 'book', quarterTurn: false, pairs: [] },
        }),
      },
      true
    );
  }

  it('slides a flap that is its own mirror along the axis instead of off it', async () => {
    // Vertex 0 sits on the tree's mirror line, so its flap is its own mirror.
    withOneFlap(0, 7);
    await useWorkspaceStore.getState().moveOristudioBpLayoutFlapWithSymmetry(0, { x: 2, y: 11 });
    // The drag wanted x = 2; the mirror keeps it at 7 and lets y through.
    expect(groupMoves()).toEqual([[[0], { x: 7, y: 11 }]]);
    expect(singleMoves()).toEqual([]);
  });

  it('does not pin a flap that merely drifted onto the mirror', async () => {
    // Vertex 7 is not in the tree at all, so this flap is nobody's mirror — it
    // has just ended up centred on the line. Deciding from that geometry pinned
    // it there with no way to drag it off again, which is what a user hits after
    // pushing a flap up against the mirror.
    withOneFlap(7, 7);
    await useWorkspaceStore.getState().moveOristudioBpLayoutFlapWithSymmetry(7, { x: 2, y: 11 });
    expect(groupMoves()).toEqual([[[7], { x: 2, y: 11 }]]);
  });

  it('does not pin a flap to the axis when mirror draw is off', async () => {
    // A new design's tree is a three-node path, so *every* node sits on the
    // mirror line whether or not anyone meant it to — which pinned both starter
    // flaps to the sheet's centre column and made a fresh design undraggable.
    // Unlike a pair, a self-mirror can only ever be inferred from position (no
    // pair may name the same vertex twice), so the toggle is what licenses it.
    withOneFlap(0, 7, false);
    await useWorkspaceStore.getState().moveOristudioBpLayoutFlapWithSymmetry(0, { x: 2, y: 11 });
    expect(groupMoves()).toEqual([[[0], { x: 2, y: 11 }]]);
  });

  it('pins the flap again once mirror draw is switched back on', async () => {
    withOneFlap(0, 7, false);
    await useWorkspaceStore.getState().moveOristudioBpLayoutFlapWithSymmetry(0, { x: 3, y: 11 });
    // Mirror draw goes back on, with the flap where the last move left it.
    // Re-installed rather than carried over because the mocked runtime lands
    // every move on the shared `FLAPS` document, which has no vertex 0 in it.
    withOneFlap(0, 3, true);
    // Enabling did not reach back and re-centre anything — the next move is
    // where symmetry is restored, and it takes the flap back to the line.
    await useWorkspaceStore.getState().moveOristudioBpLayoutFlapWithSymmetry(0, { x: 3, y: 12 });
    expect(groupMoves()).toEqual([
      [[0], { x: 3, y: 11 }],
      [[0], { x: 7, y: 12 }],
    ]);
  });
});
