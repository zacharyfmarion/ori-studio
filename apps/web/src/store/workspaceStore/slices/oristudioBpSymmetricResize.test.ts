import { singleBoxPleatDesignTab } from '../designTabs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioBpDocumentState, OristudioBpTreeView } from '../../../engine/oristudioBpTypes';

/**
 * Resizing a flap under mirror draw resizes its partner too.
 *
 * A pair whose boxes are not mirror images is rejected outright by the
 * optimizer (`validate_dimensions` in `crates/oristudio-bp/src/optimizer.rs`),
 * so resizing one side alone quietly breaks the symmetry the user drew — which
 * is why radius already mirrored and width/height had to.
 *
 * Whether the partner's width and height are exchanged depends on where the
 * tree's mirror lands on the paper: a reflection across a vertical line leaves a
 * rectangle's extents alone, one across a diagonal turns it a quarter turn.
 */

const runtimeMocks = vi.hoisted(() => ({
  resizeOristudioBpLayoutFlap: vi.fn(),
  exportOristudioBpProjectAsBps: vi.fn(async () => '<bps/>'),
  exportOristudioBpProjectAsSessionBps: vi.fn(async () => '<bps/>'),
}));

vi.mock('../oristudioBpRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../oristudioBpRuntime')>();
  return {
    ...actual,
    resizeOristudioBpLayoutFlap: runtimeMocks.resizeOristudioBpLayoutFlap,
    exportOristudioBpProjectAsBps: runtimeMocks.exportOristudioBpProjectAsBps,
    exportOristudioBpProjectAsSessionBps: runtimeMocks.exportOristudioBpProjectAsSessionBps,
  };
});

const { useWorkspaceStore } = await import('../store');

// A vertical axis through x = 4.
const AXIS = { angle: 90, loc: { x: 4, y: 4 } };

//   0 (root, on the axis)
//   ├─ 1 (left)  ── mirror of 2
//   ├─ 2 (right) ── mirror of 1
//   └─ 3 (left, no counterpart)
function tree(kind: 'rectangular' | 'diagonal'): OristudioBpTreeView {
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
    sheet: { kind, width: 8, height: 8, grid: { kind, interval: 1, snap: true } },
    vertices: [vertex(0, 4, 4), vertex(1, 2, 6), vertex(2, 6, 6), vertex(3, 1, 3)],
    edges: [],
    maxTreeHeight: null,
  } as unknown as OristudioBpTreeView;
}

function bpDocument(kind: 'rectangular' | 'diagonal' = 'rectangular'): OristudioBpDocumentState {
  return {
    activeSurface: 'packing',
    snapshot: { tree: tree(kind) },
  } as unknown as OristudioBpDocumentState;
}

function setUp(options: {
  enabled: boolean;
  fold?: 'book' | 'diagonal';
  quarterTurn?: boolean;
  kind?: 'rectangular' | 'diagonal';
  pairs?: { v1: number; v2: number }[];
}) {
  const kind = options.kind ?? 'rectangular';
  runtimeMocks.resizeOristudioBpLayoutFlap.mockImplementation(async () => bpDocument(kind));
  useWorkspaceStore.setState(
    {
      ...useWorkspaceStore.getInitialState(),
      ...singleBoxPleatDesignTab({
      document: bpDocument(kind),
      symmetry: {
        ...AXIS,
        enabled: options.enabled,
        fold: options.fold ?? 'book',
        quarterTurn: options.quarterTurn ?? false,
        sidesSwapped: false,
        pairs: options.pairs ?? [],
      }
      })},
    true
  );
}

/** Every `(id, width, height)` the action handed to the engine. */
function resizes(): [number, number, number][] {
  return runtimeMocks.resizeOristudioBpLayoutFlap.mock.calls.map((call) => [
    call[0],
    call[1],
    call[2],
  ]);
}

beforeEach(() => {
  runtimeMocks.resizeOristudioBpLayoutFlap.mockReset();
  runtimeMocks.exportOristudioBpProjectAsBps.mockClear();
});

afterEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('resizeOristudioBpLayoutFlap under symmetry', () => {
  it('resizes the mirror partner to match', async () => {
    setUp({ enabled: true });
    await expect(
      useWorkspaceStore.getState().resizeOristudioBpLayoutFlap(1, 3, 2)
    ).resolves.toBe(true);
    expect(resizes()).toEqual([
      [1, 3, 2],
      [2, 3, 2],
    ]);
  });

  it('works from either side of the axis', async () => {
    setUp({ enabled: true });
    await useWorkspaceStore.getState().resizeOristudioBpLayoutFlap(2, 5, 1);
    expect(resizes()).toEqual([
      [2, 5, 1],
      [1, 5, 1],
    ]);
  });

  it('honours an explicit pair over the geometric guess', async () => {
    setUp({ enabled: true, pairs: [{ v1: 1, v2: 3 }] });
    await useWorkspaceStore.getState().resizeOristudioBpLayoutFlap(1, 4, 0);
    expect(resizes()).toEqual([
      [1, 4, 0],
      [3, 4, 0],
    ]);
  });

  it('exchanges width and height when the mirror lands on a diagonal', async () => {
    // Diagonal fold on a rectangular sheet cuts across the grid at 45 degrees,
    // so the partner is this flap turned a quarter turn.
    setUp({ enabled: true, fold: 'diagonal' });
    await useWorkspaceStore.getState().resizeOristudioBpLayoutFlap(1, 3, 1);
    expect(resizes()).toEqual([
      [1, 3, 1],
      [2, 1, 3],
    ]);
  });

  it('does not exchange them when a diagonal sheet puts the fold along the grid', async () => {
    // A diagonal-grid sheet is the paper turned 45 degrees, so the two swap.
    setUp({ enabled: true, fold: 'diagonal', kind: 'diagonal' });
    await useWorkspaceStore.getState().resizeOristudioBpLayoutFlap(1, 3, 1);
    expect(resizes()).toEqual([
      [1, 3, 1],
      [2, 3, 1],
    ]);
  });

  it('resizes an on-axis flap once', async () => {
    setUp({ enabled: true });
    await useWorkspaceStore.getState().resizeOristudioBpLayoutFlap(0, 2, 2);
    expect(resizes()).toEqual([[0, 2, 2]]);
  });

  /**
   * Mirror draw off does not mean symmetry off.
   *
   * The toggle decides whether a *new* node is drawn with a twin. A pair that
   * already exists is part of the design, so editing one member still carries the
   * other — otherwise the whole feature would vanish the moment the user stopped
   * drawing symmetrically.
   */
  it('still resizes the partner after mirror draw is switched off', async () => {
    setUp({ enabled: false });
    await useWorkspaceStore.getState().resizeOristudioBpLayoutFlap(1, 3, 2);
    expect(resizes()).toEqual([
      [1, 3, 2],
      [2, 3, 2],
    ]);
  });
});
