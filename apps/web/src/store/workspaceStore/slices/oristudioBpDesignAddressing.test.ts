import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDesignTab,
  patchBoxPleatDesign,
  resetDesignTabIds,
  selectOristudioBpDocument,
  selectOristudioBpHistoryPast,
  selectOristudioBpSymmetry,
} from '../designTabs';
import { createBoxPleatDesignState } from '../designContent';
import type {
  OristudioBpDocumentState,
  OristudioBpFlap,
  OristudioBpSheet,
  OristudioBpTreeView,
} from '../../../engine/oristudioBpTypes';

/**
 * A BP edit belongs to the design it started on.
 *
 * Every mutation here is a worker round trip, so there is a window between "the
 * user asked" and "the answer came back" in which the active tab can change. The
 * store must resolve that window against the design that *started* the edit, not
 * against whichever one happens to be in front when the promise settles.
 *
 * This was wrong in a way that read as right: `runBpTreeMutation` captured
 * `activeDesignId` before its first await and left a comment saying the gesture
 * belongs to the design it started on — then used the captured id only as a
 * `Map` key for the pending undo entry. Every actual read and write went through
 * an unaddressed selector, so the document, selection, history and pruned
 * symmetry pairs all landed on the active design. Switching tabs mid-edit wrote
 * one design's document over another's.
 *
 * These tests hold a mutation open, switch tabs underneath it, and then let it
 * finish.
 */

const runtimeMocks = vi.hoisted(() => ({
  moveOristudioBpLayoutFlap: vi.fn(),
  exportOristudioBpProjectAsBps: vi.fn(async () => '<bps/>'),
  exportOristudioBpProjectAsSessionBps: vi.fn(async () => '<bps/>'),
  restoreOristudioBpProjectSnapshot: vi.fn(),
  loadOristudioBpProjectFromText: vi.fn(),
}));

vi.mock('../oristudioBpRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../oristudioBpRuntime')>();
  return {
    ...actual,
    moveOristudioBpLayoutFlap: runtimeMocks.moveOristudioBpLayoutFlap,
    exportOristudioBpProjectAsBps: runtimeMocks.exportOristudioBpProjectAsBps,
    exportOristudioBpProjectAsSessionBps: runtimeMocks.exportOristudioBpProjectAsSessionBps,
    restoreOristudioBpProjectSnapshot: runtimeMocks.restoreOristudioBpProjectSnapshot,
    loadOristudioBpProjectFromText: runtimeMocks.loadOristudioBpProjectFromText,
  };
});

const { useWorkspaceStore } = await import('../store');

const store = () => useWorkspaceStore.getState();

function sheet(width = 16, height = 16): OristudioBpSheet {
  return {
    kind: 'rectangular',
    width,
    height,
    grid: { kind: 'rectangular', interval: 1, snap: true },
  };
}

function tree(vertexIds: number[] = [0, 1, 2]): OristudioBpTreeView {
  const vertex = (id: number, x: number, y: number) => ({
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
  });
  return {
    rootVertexId: 0,
    sheet: sheet(8, 8),
    vertices: vertexIds.map((id) => vertex(id, id === 0 ? 4 : id * 2, id === 0 ? 4 : 6)),
    edges: [],
    maxTreeHeight: null,
  };
}

function flap(id: number, x: number, y: number): OristudioBpFlap {
  return { id, vertexId: id, name: `f${id}`, anchor: { x, y }, width: 2, height: 1, radius: 1, constrained: true };
}

/** A document tagged by its flap position, so "which design got it" is readable. */
function bpDocument(markerX: number, vertexIds?: number[]): OristudioBpDocumentState {
  return {
    activeSurface: 'packing',
    // `navigateBpHistory` names the undo step from this; the cast means a missing
    // field is a runtime error rather than a compile one.
    history: { activeLabel: 'edit' },
    snapshot: { tree: tree(vertexIds), packing: { sheet: sheet(), flaps: [flap(1, markerX, 6)] } },
  } as unknown as OristudioBpDocumentState;
}

const anchorX = (designId: string) =>
  selectOristudioBpDocument(store(), designId)?.snapshot.packing.flaps[0]?.anchor.x ?? null;

const AXIS = { angle: 90, loc: { x: 4, y: 4 } };

/** Two box-pleat designs, each with its own document and its own mirror state. */
function twoDesigns() {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  resetDesignTabIds();
  const first = createDesignTab([], { kind: 'box-pleat', title: 'First' });
  const second = createDesignTab([first], { kind: 'box-pleat', title: 'Second' });
  useWorkspaceStore.setState({
    designTabs: [
      {
        ...first,
        kind: 'box-pleat',
        boxPleat: createBoxPleatDesignState({
          document: bpDocument(1),
          symmetry: { ...AXIS, enabled: true, fold: 'book', quarterTurn: false, sidesSwapped: false, pairs: [{ v1: 1, v2: 2 }] },
        }),
      },
      {
        ...second,
        kind: 'box-pleat',
        boxPleat: createBoxPleatDesignState({
          document: bpDocument(99),
          symmetry: { ...AXIS, enabled: false, fold: 'diagonal', quarterTurn: false, sidesSwapped: false, pairs: [{ v1: 1, v2: 2 }] },
        }),
      },
    ],
    activeDesignId: first.id,
    // `undo` routes by editing context, and only the BP contexts reach
    // `navigateBpHistory`.
    activeEditingContext: 'bp-packing',
    engineReady: true,
    status: 'ready',
  });
  return { first: first.id, second: second.id };
}

/** A promise the test resolves by hand, so the await window can be held open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  runtimeMocks.exportOristudioBpProjectAsSessionBps.mockImplementation(async () => '<bps/>');
});

afterEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('a BP edit interrupted by a tab switch', () => {
  it('commits the document to the design it started on', async () => {
    const ids = twoDesigns();
    const gate = deferred<OristudioBpDocumentState>();
    runtimeMocks.moveOristudioBpLayoutFlap.mockReturnValue(gate.promise);

    const move = store().moveOristudioBpLayoutFlap(1, { x: 5, y: 6 });
    // The user switches tabs while the worker is still thinking.
    store().activateDesignTab(ids.second);
    gate.resolve(bpDocument(5));
    await move;

    expect(anchorX(ids.first)).toBe(5);
    // The design the user switched *to* must be exactly as it was.
    expect(anchorX(ids.second)).toBe(99);
  });

  it('records the undo entry against the design it started on', async () => {
    const ids = twoDesigns();
    const gate = deferred<OristudioBpDocumentState>();
    runtimeMocks.moveOristudioBpLayoutFlap.mockReturnValue(gate.promise);

    const move = store().moveOristudioBpLayoutFlap(1, { x: 5, y: 6 });
    store().activateDesignTab(ids.second);
    gate.resolve(bpDocument(5));
    await move;

    expect(selectOristudioBpHistoryPast(store(), ids.first)).toHaveLength(1);
    expect(selectOristudioBpHistoryPast(store(), ids.second)).toHaveLength(0);
  });

  it('prunes the pairs of the design it edited, not the one now in front', async () => {
    const ids = twoDesigns();
    const gate = deferred<OristudioBpDocumentState>();
    runtimeMocks.moveOristudioBpLayoutFlap.mockReturnValue(gate.promise);

    const move = store().moveOristudioBpLayoutFlap(1, { x: 5, y: 6 });
    store().activateDesignTab(ids.second);
    // The edit's result drops vertex 2, so the {1,2} pair no longer has both
    // ends and must be pruned — from *this* design.
    gate.resolve(bpDocument(5, [0, 1]));
    await move;

    expect(selectOristudioBpSymmetry(store(), ids.first).pairs).toEqual([]);
    // The design the user switched to still has its tree, so it keeps its pair.
    // Pruning used to read and write whichever design was active, which pruned
    // this one against the *other* one's post-edit tree.
    expect(selectOristudioBpSymmetry(store(), ids.second).pairs).toEqual([{ v1: 1, v2: 2 }]);
    expect(selectOristudioBpSymmetry(store(), ids.second).fold).toBe('diagonal');
  });
});

describe('a BP undo interrupted by a tab switch', () => {
  it('restores into the design it started on', async () => {
    const ids = twoDesigns();
    // Give the first design something to undo.
    runtimeMocks.moveOristudioBpLayoutFlap.mockResolvedValue(bpDocument(5));
    await store().moveOristudioBpLayoutFlap(1, { x: 5, y: 6 });
    expect(anchorX(ids.first)).toBe(5);

    const gate = deferred<OristudioBpDocumentState>();
    runtimeMocks.restoreOristudioBpProjectSnapshot.mockReturnValue(gate.promise);

    const undo = store().undo();
    store().activateDesignTab(ids.second);
    gate.resolve(bpDocument(1));
    await undo;

    expect(anchorX(ids.first)).toBe(1);
    expect(anchorX(ids.second)).toBe(99);
  });
});

/** A document shaped as `setLoadedBpProject` expects one off the loader. */
function loadedDocument(markerX: number): OristudioBpDocumentState {
  const base = bpDocument(markerX);
  return {
    ...base,
    source: { filename: 'Untitled.bps', format: 'generated', dirty: false },
    snapshot: { ...base.snapshot, summary: { title: '' } },
  } as unknown as OristudioBpDocumentState;
}

describe('self-provisioning a box-pleat design', () => {
  it('seeds the design that asked, not the one the user switched to', async () => {
    // `ensureBoxPleatProject` hydrates before it seeds, because a tab opened from
    // a file is text until visited. It captured a designId for that await and
    // then handed off to `createOristudioBpProject`, which captured
    // `activeDesignId` *again* — after the hydrate. So a click during hydration
    // sent the starter to the design the user landed on. With
    // `confirmDiscard: false` it would replace real work with a blank sample and
    // never ask.
    const ids = twoDesigns();
    useWorkspaceStore.setState(patchBoxPleatDesign(store(), { document: null }, ids.first));
    // The click lands while the design that asked is still hydrating.
    useWorkspaceStore.setState({
      hydrateDesignTab: async () => {
        store().activateDesignTab(ids.second);
      },
    });
    runtimeMocks.loadOristudioBpProjectFromText.mockResolvedValue(loadedDocument(42));

    await store().ensureBoxPleatProject();

    expect(anchorX(ids.first)).toBe(42);
    expect(anchorX(ids.second)).toBe(99);
  });
});

describe('an open gesture in another design', () => {
  it('survives a project being loaded into this one', async () => {
    // The pending undo entry is held per design while a drag is in flight, and a
    // load used to `clear()` the whole map. The count alone would not show it —
    // settling the gesture just opens a fresh entry — so this pins *which state*
    // the undo step goes back to, by giving every export a distinct body.
    const ids = twoDesigns();
    let exportCount = 0;
    runtimeMocks.exportOristudioBpProjectAsSessionBps.mockImplementation(async () => {
      exportCount += 1;
      return `<bps#${exportCount}/>`;
    });

    // A drag step in the second design leaves its snapshot open: `<bps#1/>` is
    // the state to go back to.
    store().activateDesignTab(ids.second);
    runtimeMocks.moveOristudioBpLayoutFlap.mockResolvedValue(bpDocument(7));
    await store().moveOristudioBpLayoutFlap(1, { x: 7, y: 6 }, true);

    // A project is seeded into the *first* design while that gesture is open.
    runtimeMocks.loadOristudioBpProjectFromText.mockResolvedValue(loadedDocument(42));
    await store().createOristudioBpProject({
      designId: ids.first,
      confirmDiscard: false,
      preserveEditCanvas: true,
    });

    // Settle the second design's gesture.
    store().activateDesignTab(ids.second);
    runtimeMocks.moveOristudioBpLayoutFlap.mockResolvedValue(bpDocument(8));
    await store().moveOristudioBpLayoutFlap(1, { x: 8, y: 6 });

    const past = selectOristudioBpHistoryPast(store(), ids.second);
    expect(past).toHaveLength(1);
    // Back to before the drag began — not to the middle of it.
    expect(past[0]?.snapshot.bps).toBe('<bps#1/>');
  });
});
