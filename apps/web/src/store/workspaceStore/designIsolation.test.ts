import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../../lib/sampleProject';
import { createTreemakerDesignState } from './designContent';
import {
  activeDesignTab,
  createDesignTab,
  installTreemakerDesign,
  patchBoxPleatDesign,
  patchTreemakerDesign,
  resetDesignTabIds,
  selectHistoryFuture,
  selectHistoryPast,
  selectOristudioBpDocument,
  selectOristudioBpHistoryPast,
  selectOristudioBpSymmetry,
  selectOristudioBpViewportFitRequestId,
  selectProject,
  selectSelection,
  selectTreemakerDesign,
  singleBoxPleatDesignTab,
  singleTreemakerDesignTab,
  type DesignTab,
  type DesignTabsSlice,
} from './designTabs';

/**
 * What phase 2b is *for*.
 *
 * The store still only ever shows one design, so none of this is reachable
 * through the UI yet — but the state layer has to be right before the tab strip
 * lands on top of it, and these are the properties the tab strip will depend on.
 * Every one of them was impossible to state before the per-design fields moved
 * off the flat store.
 */

function twoDesigns(): DesignTabsSlice {
  resetDesignTabIds();
  const first = createDesignTab([], { kind: 'treemaker', title: 'Crane' });
  const second = createDesignTab([first], { kind: 'treemaker', title: 'Beetle' });
  return { designTabs: [first, second], activeDesignId: first.id };
}

const withActive = (state: DesignTabsSlice, id: string): DesignTabsSlice => ({
  ...state,
  activeDesignId: id,
});

const namedProject = (title: string) => ({ ...createEmptyProject(), title });

const treemakerOf = (state: DesignTabsSlice, id: string) => {
  const tab = state.designTabs.find((candidate) => candidate.id === id) as DesignTab;
  return tab.kind === 'treemaker' ? tab.treemaker : null;
};

/** The same, for assertions that only make sense on a TreeMaker design. */
const treeOf = (state: DesignTabsSlice, id: string) => {
  const design = treemakerOf(state, id);
  if (!design) throw new Error(`design ${id} is not TreeMaker`);
  return design;
};

describe('per-design isolation', () => {
  it('edits one design without touching its sibling', () => {
    const state = twoDesigns();
    const [crane, beetle] = state.designTabs;

    const next = { ...state, ...patchTreemakerDesign(state, { project: namedProject('edited') }) };

    expect(treemakerOf(next, crane.id)?.project.title).toBe('edited');
    expect(treemakerOf(next, beetle.id)?.project.title).toBe('Untitled');
  });

  it('keeps a sibling tab object identity across an edit', () => {
    // Zustand selectors compare by reference, so an untouched design must stay
    // the same object or every subscriber re-renders on every unrelated edit.
    const state = twoDesigns();
    const beetleBefore = state.designTabs[1];

    const next = { ...state, ...patchTreemakerDesign(state, { project: namedProject('edited') }) };

    expect(next.designTabs[1]).toBe(beetleBefore);
  });

  it('gives each design its own undo stack', () => {
    let state = twoDesigns();
    const [crane, beetle] = state.designTabs;

    const entry = { text: 'crane-v1', label: 'Add node', timestamp: '2026-01-01T00:00:00.000Z' };
    state = { ...state, ...patchTreemakerDesign(state, { historyPast: [entry] }) };

    expect(selectHistoryPast(state)).toHaveLength(1);

    // Switching tabs switches which history is reachable at all — this is what
    // makes cross-tab undo impossible rather than merely guarded against.
    const onBeetle = withActive(state, beetle.id);
    expect(selectHistoryPast(onBeetle)).toHaveLength(0);
    expect(selectHistoryFuture(onBeetle)).toHaveLength(0);

    // And the crane's stack is still there when we come back.
    expect(selectHistoryPast(withActive(onBeetle, crane.id))).toEqual([entry]);
  });

  it('gives each design its own selection', () => {
    let state = twoDesigns();
    const [crane, beetle] = state.designTabs;
    state = { ...state, ...patchTreemakerDesign(state, { selection: { kind: 'node', id: 7 } }) };

    expect(selectSelection(state)).toEqual({ kind: 'node', id: 7 });
    expect(selectSelection(withActive(state, beetle.id))).toEqual({ kind: 'tree' });
    expect(selectSelection(withActive(state, crane.id))).toEqual({ kind: 'node', id: 7 });
  });

  it('reads the active design, not the first', () => {
    let state = twoDesigns();
    state = { ...state, ...patchTreemakerDesign(state, { project: namedProject('crane tree') }) };
    const onBeetle = withActive(state, state.designTabs[1].id);
    state = { ...onBeetle, ...patchTreemakerDesign(onBeetle, { project: namedProject('beetle tree') }) };

    expect(selectProject(state).title).toBe('beetle tree');
    expect(selectProject(withActive(state, state.designTabs[0].id)).title).toBe('crane tree');
  });
});

describe('per-design isolation: box-pleat', () => {
  const bpDoc = (title: string) =>
    ({ snapshot: { summary: { title }, tree: { sheet: { width: 8, height: 8 } } } }) as never;

  function twoBoxPleatDesigns(): DesignTabsSlice {
    resetDesignTabIds();
    const first = createDesignTab([], { kind: 'box-pleat', title: 'Crane' });
    const second = createDesignTab([first], { kind: 'box-pleat', title: 'Beetle' });
    return { designTabs: [first, second], activeDesignId: first.id };
  }

  it('gives each design its own document', () => {
    let state = twoBoxPleatDesigns();
    const [crane, beetle] = state.designTabs;
    state = { ...state, ...patchBoxPleatDesign(state, { document: bpDoc('crane') }) };

    expect(selectOristudioBpDocument(state)).not.toBeNull();
    expect(selectOristudioBpDocument(withActive(state, beetle.id))).toBeNull();
    expect(selectOristudioBpDocument(withActive(state, crane.id))).not.toBeNull();
  });

  it('gives each design its own undo stack and symmetry', () => {
    let state = twoBoxPleatDesigns();
    const beetle = state.designTabs[1];
    state = {
      ...state,
      ...patchBoxPleatDesign(state, {
        historyPast: [{ label: 'Moved flap' }] as never,
        symmetry: { enabled: true, fold: 'diagonal', quarterTurn: false, angle: 90, loc: { x: 0, y: 0 }, pairs: [] },
      }),
    };

    expect(selectOristudioBpHistoryPast(state)).toHaveLength(1);
    expect(selectOristudioBpSymmetry(state).fold).toBe('diagonal');

    const onBeetle = withActive(state, beetle.id);
    expect(selectOristudioBpHistoryPast(onBeetle)).toHaveLength(0);
    // Untouched designs keep the default: mirror draw off, book fold.
    expect(selectOristudioBpSymmetry(onBeetle).fold).toBe('book');
    expect(selectOristudioBpSymmetry(onBeetle).enabled).toBe(false);
  });

  it('lets a tab be box-pleat before its document exists', () => {
    // The window the async chooser needs: kind claimed, worker still building.
    // If this were not representable the pane would flash the chooser mid-load.
    const state = singleBoxPleatDesignTab();
    expect(activeDesignTab(state).kind).toBe('box-pleat');
    expect(selectOristudioBpDocument(state)).toBeNull();
  });

  it('refuses a box-pleat patch against a TreeMaker design', () => {
    const state = singleTreemakerDesignTab();
    const next = { ...state, ...patchBoxPleatDesign(state, { document: bpDoc('nope') }) };
    expect(activeDesignTab(next).kind).toBe('treemaker');
    expect(selectOristudioBpDocument(next)).toBeNull();
  });
});

describe('kind and content cannot diverge', () => {
  it('installing a design sets both at once', () => {
    const state = singleTreemakerDesignTab({ project: namedProject('seeded') });
    const tab = activeDesignTab(state);

    expect(tab.kind).toBe('treemaker');
    expect(selectProject(state).title).toBe('seeded');
  });

  it('refuses to patch a design of another kind', () => {
    resetDesignTabIds();
    const boxPleat = createDesignTab([], { kind: 'box-pleat', title: 'BP' });
    const state: DesignTabsSlice = { designTabs: [boxPleat], activeDesignId: boxPleat.id };

    // A tree edit against a box-pleat design is a routing bug. Installing a tree
    // the user never asked for would hide it; the write is dropped instead.
    const next = { ...state, ...patchTreemakerDesign(state, { project: namedProject('nope') }) };

    expect(activeDesignTab(next).kind).toBe('box-pleat');
    expect(selectTreemakerDesign(next)).toBeNull();
  });

  it('reads an empty tree for a design that has none', () => {
    // The total accessor preserves pre-tabs behaviour: a box-pleat design used to
    // carry an empty `TreeProject`, so incidental readers never saw a null.
    resetDesignTabIds();
    const boxPleat = createDesignTab([], { kind: 'box-pleat', title: 'BP' });
    const state: DesignTabsSlice = { designTabs: [boxPleat], activeDesignId: boxPleat.id };

    expect(selectProject(state).nodes).toEqual([]);
    expect(selectSelection(state)).toEqual({ kind: 'tree' });
    expect(selectHistoryPast(state)).toEqual([]);
  });

  it('returns a stable empty design, so selectors do not thrash', () => {
    resetDesignTabIds();
    const boxPleat = createDesignTab([], { kind: 'box-pleat', title: 'BP' });
    const state: DesignTabsSlice = { designTabs: [boxPleat], activeDesignId: boxPleat.id };

    // A fresh object each call would fail Zustand's Object.is check and re-render
    // every subscriber on every unrelated store change.
    expect(selectProject(state)).toBe(selectProject(state));
  });

  it('installing replaces the previous design wholesale', () => {
    let state = singleTreemakerDesignTab({
      project: namedProject('old'),
      historyPast: [{ text: 'x', label: 'Edit', timestamp: '2026-01-01T00:00:00.000Z' }],
      selection: { kind: 'node', id: 3 },
    });

    state = { ...state, ...installTreemakerDesign(state, { project: namedProject('new') }) };

    // Loading a different design must not leave the previous one's undo stack or
    // selection behind for it to inherit.
    expect(selectProject(state).title).toBe('new');
    expect(selectHistoryPast(state)).toEqual([]);
    expect(selectSelection(state)).toEqual({ kind: 'tree' });
  });

  it('defaults every field of a fresh design', () => {
    const fresh = createTreemakerDesignState();
    expect(fresh).toMatchObject({
      selection: { kind: 'tree' },
      toolMode: 'select',
      symmetryAuthoringPairs: [],
      historyPast: [],
      historyFuture: [],
      lastOptimization: null,
      viewportFitRequestId: 0,
    });
    expect(fresh.project.nodes).toEqual([]);
  });
});

/**
 * An async action's result belongs to the design it started in.
 *
 * Every engine call is a round trip, and that round trip is exactly the window in
 * which the user can click another tab. A write that resolves "the active design"
 * *after* the await lands on whichever tab is showing when the engine answers —
 * so an optimize started on the crane finishes into the beetle.
 *
 * The writers take the id the action captured before its first await; these are
 * the properties that makes true.
 */
describe('addressed writes', () => {
  it('patches the design named, not the one now active', () => {
    const state = twoDesigns();
    const [crane, beetle] = state.designTabs.map((tab) => tab.id);

    // The user switched to the beetle while the engine was working.
    const switched = withActive(state, beetle);
    const next = { ...switched, ...patchTreemakerDesign(switched, { project: namedProject('Crane v2') }, crane) };

    expect(treeOf(next, crane).project.title).toBe('Crane v2');
    expect(treeOf(next, beetle).project.title).not.toBe('Crane v2');
  });

  it('installs into the design named', () => {
    const state = twoDesigns();
    const [crane, beetle] = state.designTabs.map((tab) => tab.id);
    const switched = withActive(state, beetle);

    const next = {
      ...switched,
      ...installTreemakerDesign(switched, { project: namedProject('Loaded') }, crane),
    };

    expect(treeOf(next, crane).project.title).toBe('Loaded');
    expect(treeOf(next, beetle).project.title).not.toBe('Loaded');
  });

  it('reads the design named, not the one now active', () => {
    // An action also *reads* its design mid-flight — the title it carries into a
    // snapshot, the selection it filters. Those reads have the same window.
    const state = twoDesigns();
    const [crane, beetle] = state.designTabs.map((tab) => tab.id);
    const seeded = {
      ...state,
      ...patchTreemakerDesign(state, { project: namedProject('Crane') }, crane),
    };
    const withBeetle = {
      ...seeded,
      ...patchTreemakerDesign(seeded, { project: namedProject('Beetle') }, beetle),
    };

    const switched = withActive(withBeetle, beetle);

    expect(selectProject(switched, crane).title).toBe('Crane');
    expect(selectProject(switched).title).toBe('Beetle');
  });

  it('does nothing when the design it was addressed to has been closed', () => {
    // Closing a tab mid-optimize is allowed. The result has nowhere to go, and
    // silently landing on a survivor would be worse than dropping it.
    const state = twoDesigns();
    const [crane, beetle] = state.designTabs.map((tab) => tab.id);
    const closed: DesignTabsSlice = {
      designTabs: state.designTabs.filter((tab) => tab.id !== crane),
      activeDesignId: beetle,
    };

    const next = {
      ...closed,
      ...patchTreemakerDesign(closed, { project: namedProject('Ghost') }, crane),
    };

    expect(next.designTabs).toHaveLength(1);
    expect(treeOf(next, beetle).project.title).not.toBe('Ghost');
  });

  it('keeps a box-pleat result on its own design', () => {
    resetDesignTabIds();
    const first = createDesignTab([], { kind: 'box-pleat', title: 'Kabuto' });
    const second = createDesignTab([first], { kind: 'box-pleat', title: 'Kabuto 2' });
    const state: DesignTabsSlice = {
      designTabs: [first, second],
      activeDesignId: second.id,
    };

    const next = {
      ...state,
      ...patchBoxPleatDesign(state, { viewportFitRequestId: 7 }, first.id),
    };

    expect(selectOristudioBpViewportFitRequestId(next, first.id)).toBe(7);
    expect(selectOristudioBpViewportFitRequestId(next, second.id)).toBe(0);
  });
});
