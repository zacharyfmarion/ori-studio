import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * An async design action finishing after a tab switch.
 *
 * Every engine call is a round trip, and that round trip is exactly the window in
 * which the user can click another tab. An action that resolves "the active
 * design" *after* its await writes into whichever tab is showing when the engine
 * answers — so an edit made on the crane lands on the beetle, and the crane
 * silently loses it.
 *
 * These drive the real store with an engine that switches tabs mid-call, which is
 * the only way to state the property end to end: the unit tests in
 * `designIsolation.test.ts` prove the *writers* address a design, not that every
 * action passes one.
 */

const engineMocks = vi.hoisted(() => ({
  ensureTreeHandle: vi.fn(),
}));

vi.mock('./engineRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./engineRuntime')>();
  return { ...actual, ensureTreeHandle: engineMocks.ensureTreeHandle };
});

vi.mock('../../engines/designHandles', () => ({
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

const { useWorkspaceStore } = await import('./store');
const { createDesignTab, resetDesignTabIds, selectProject } = await import('./designTabs');

const store = () => useWorkspaceStore.getState();

/** A minimally complete engine snapshot carrying `nodes` tree nodes. */
function snapshotWith(nodes: number) {
  return {
    summary: { nodes, edges: 0, paths: 0, creases: 0, conditions: 0 },
    cp_status_report: { status: 'empty', messages: [] },
    paper: {
      width: 1,
      height: 1,
      scale: 0.1,
      has_symmetry: false,
      sym_loc: { x: 0, y: 0 },
      sym_angle: 0,
    },
    nodes: Array.from({ length: nodes }, (_, index) => ({
      id: index + 1,
      label: `n${index + 1}`,
      loc: { x: 0.1 * index, y: 0.1 * index },
      is_leaf: true,
      is_pinned: false,
      is_conditioned: false,
      owner: 'Tree',
    })),
    edges: [],
    paths: [],
    vertices: [],
    creases: [],
    facets: [],
    conditions: [],
  } as never;
}

/** Two circle-packed designs, the first active. */
function twoTreeDesigns() {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  resetDesignTabIds();
  const first = createDesignTab([], { kind: 'treemaker', title: 'Crane' });
  const second = createDesignTab([first], { kind: 'treemaker', title: 'Beetle' });
  useWorkspaceStore.setState({
    designTabs: [first, second],
    activeDesignId: first.id,
    engineReady: true,
    status: 'ready',
  });
  return { first: first.id, second: second.id };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('an edit that finishes after the user switched tabs', () => {
  it('lands on the design it was made in', async () => {
    const { first, second } = twoTreeDesigns();
    const engine = {
      applyEdit: vi.fn(async () => {
        // The click on the other tab, mid-round-trip.
        useWorkspaceStore.setState({ activeDesignId: second });
        return { snapshot: snapshotWith(1), created_node: 1, created_edge: null };
      }),
      saveTmd5: vi.fn(async () => 'tmd5'),
    };
    engineMocks.ensureTreeHandle.mockResolvedValue({ api: engine, treeHandle: 1 });

    await store().addNodeAt({ x: 0.5, y: 0.5 });

    // The node belongs to the design the user was drawing in.
    expect(selectProject(store(), first).nodes).toHaveLength(1);
    expect(selectProject(store(), second).nodes).toHaveLength(0);
  });

  it('leaves the design the user switched to untouched', async () => {
    const { first, second } = twoTreeDesigns();
    const engine = {
      applyEdit: vi.fn(async () => {
        useWorkspaceStore.setState({ activeDesignId: second });
        return { snapshot: snapshotWith(3), created_node: 3, created_edge: null };
      }),
      saveTmd5: vi.fn(async () => 'tmd5'),
    };
    engineMocks.ensureTreeHandle.mockResolvedValue({ api: engine, treeHandle: 1 });

    await store().moveNode(1, { x: 0.2, y: 0.2 });

    expect(store().activeDesignId).toBe(second);
    expect(selectProject(store(), second).nodes).toHaveLength(0);
    expect(selectProject(store(), first).nodes).toHaveLength(3);
  });
});
