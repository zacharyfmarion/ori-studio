import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Undo belongs to a design, not to the workspace.
 *
 * `designIsolation.test.ts` states that each tab *has* its own stack. This states
 * the thing that actually matters: pressing undo in one design does not reach
 * into another — not its stack, not its document, and not the engine handle
 * behind it. Before the per-design move there was one `historyPast` on the store,
 * so a second design would have undone the first's edits into itself.
 */

const engineMocks = vi.hoisted(() => ({
  ensureTreeHandle: vi.fn(),
  loadTreeFromText: vi.fn(),
  getEngine: vi.fn(),
}));

vi.mock('./engineRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./engineRuntime')>();
  return {
    ...actual,
    ensureTreeHandle: engineMocks.ensureTreeHandle,
    loadTreeFromText: engineMocks.loadTreeFromText,
    getEngine: engineMocks.getEngine,
  };
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
const { createDesignTab, resetDesignTabIds, selectHistoryPast, selectProject } =
  await import('./designTabs');
const { createTreemakerDesignState } = await import('./designContent');
const { createEmptyProject } = await import('../../lib/sampleProject');

const store = () => useWorkspaceStore.getState();

const entry = (text: string, label: string) => ({
  text,
  label,
  timestamp: '2026-01-01T00:00:00.000Z',
});

const named = (title: string) => ({ ...createEmptyProject(), title });

/**
 * The snapshot the engine returns for a given `.tmd5` text.
 *
 * The text is carried on a node label rather than the project title: undo
 * deliberately *preserves* the title (restoring a design must not rename it), so
 * a title assertion would be checking the wrong thing.
 */
function snapshotTitled(title: string) {
  return {
    summary: { nodes: 1, edges: 0, paths: 0, creases: 0, conditions: 0 },
    cp_status_report: { status: 'empty', messages: [] },
    paper: {
      width: 1,
      height: 1,
      scale: 0.1,
      has_symmetry: false,
      sym_loc: { x: 0, y: 0 },
      sym_angle: 0,
    },
    nodes: [
      {
        id: 1,
        label: title,
        loc: { x: 0.5, y: 0.5 },
        is_leaf: true,
        is_pinned: false,
        is_conditioned: false,
        owner: 'Tree',
      },
    ],
    edges: [],
    paths: [],
    vertices: [],
    creases: [],
    facets: [],
    conditions: [],
  } as never;
}

/** Two circle-packed designs, each with an edit behind it. */
function twoEditedDesigns() {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  resetDesignTabIds();
  const crane = createDesignTab([], { kind: 'treemaker', title: 'Crane' });
  const beetle = createDesignTab([crane], { kind: 'treemaker', title: 'Beetle' });
  useWorkspaceStore.setState({
    designTabs: [
      {
        ...crane,
        kind: 'treemaker',
        treemaker: createTreemakerDesignState({
          project: named('Crane now'),
          historyPast: [entry('crane before', 'Add node')],
        }),
      },
      {
        ...beetle,
        kind: 'treemaker',
        treemaker: createTreemakerDesignState({
          project: named('Beetle now'),
          historyPast: [entry('beetle before', 'Add node')],
        }),
      },
    ],
    activeDesignId: crane.id,
    engineReady: true,
    status: 'ready',
    // Undo dispatches on the editing context; these are tree designs.
    activeEditingContext: 'treemaker-tree',
  });
  return { crane: crane.id, beetle: beetle.id };
}

beforeEach(() => {
  vi.clearAllMocks();
  engineMocks.ensureTreeHandle.mockResolvedValue({
    api: { saveTmd5: vi.fn(async () => 'current') },
    treeHandle: 1,
  });
  engineMocks.getEngine.mockResolvedValue({});
  engineMocks.loadTreeFromText.mockImplementation(async (_api: unknown, text: string) =>
    snapshotTitled(text)
  );
});

describe('undo in one design', () => {
  it('restores that design and leaves its sibling alone', async () => {
    const { crane, beetle } = twoEditedDesigns();

    await store().undo();

    expect(selectProject(store(), crane).nodes[0]?.label).toBe('crane before');
    expect(selectProject(store(), beetle).nodes).toHaveLength(0);
  });

  it('consumes only its own stack', async () => {
    const { crane, beetle } = twoEditedDesigns();

    await store().undo();

    expect(selectHistoryPast(store(), crane)).toHaveLength(0);
    expect(selectHistoryPast(store(), beetle)).toHaveLength(1);
  });

  it('reloads the engine handle from its own text', async () => {
    // The tree round-trips through `.tmd5` on every undo, so an undo that read
    // the wrong stack would load the wrong design into the live handle — the
    // corruption a shared stack caused, rather than merely a wrong label.
    twoEditedDesigns();

    await store().undo();

    expect(engineMocks.loadTreeFromText).toHaveBeenCalledWith(expect.anything(), 'crane before');
  });

  it('has nothing to undo in a design that has not been edited', async () => {
    const { beetle } = twoEditedDesigns();
    useWorkspaceStore.setState({ activeDesignId: beetle });
    await store().undo();
    engineMocks.loadTreeFromText.mockClear();

    // Beetle's one entry is now spent; a second undo finds an empty stack.
    await store().undo();

    expect(engineMocks.loadTreeFromText).not.toHaveBeenCalled();
  });

  it('redoes into the design it undid, after a tab switch', async () => {
    const { crane, beetle } = twoEditedDesigns();
    await store().undo();

    // The user looks at the other design, then comes back and redoes.
    useWorkspaceStore.setState({ activeDesignId: beetle });
    useWorkspaceStore.setState({ activeDesignId: crane });
    await store().redo();

    // Redo reloads the `.tmd5` captured at undo time, which the fake engine
    // labels 'current'.
    expect(selectProject(store(), crane).nodes[0]?.label).toBe('current');
    expect(selectProject(store(), beetle).nodes).toHaveLength(0);
  });

  it('restores into the design it was invoked on, even after a tab switch', async () => {
    // An undo is a `.tmd5` round trip through the engine, so the user can click
    // another tab while it reloads. Restoring into "the active design" would
    // overwrite the design they switched *to* with the one they undid.
    const { crane, beetle } = twoEditedDesigns();
    engineMocks.loadTreeFromText.mockImplementation(async (_api: unknown, text: string) => {
      useWorkspaceStore.setState({ activeDesignId: beetle });
      return snapshotTitled(text);
    });

    await store().undo();

    expect(selectProject(store(), crane).nodes[0]?.label).toBe('crane before');
    expect(selectProject(store(), beetle).nodes).toHaveLength(0);
    expect(selectHistoryPast(store(), beetle)).toHaveLength(1);
  });
});
