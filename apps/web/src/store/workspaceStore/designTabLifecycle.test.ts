import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../engines/designHandles', () => ({
  acquireDesignHandle: vi.fn(async () => 1),
  withDesignHandle: vi.fn(),
  serializeDesign: vi.fn(async () => 'serialized-design'),
  parkDesign: vi.fn(async () => undefined),
  forgetDesign: vi.fn(async () => undefined),
  adoptDesign: vi.fn(),
  isDesignHot: vi.fn(() => false),
  hotDesignIds: vi.fn(() => []),
  subscribeToDesignHandles: vi.fn(() => () => undefined),
}));

const { useWorkspaceStore } = await import('../workspaceStore');
const handles = await import('../../engines/designHandles');
const { DEFAULT_DESIGN_TITLE, resetDesignTabIds, selectDesignMethod } = await import('./designTabs');

const tabs = () => useWorkspaceStore.getState().designTabs;
const activeId = () => useWorkspaceStore.getState().activeDesignId;
const titles = () => tabs().map((tab) => tab.title);

beforeEach(() => {
  vi.clearAllMocks();
  resetDesignTabIds();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('addDesignTab', () => {
  it('opens on the chooser and becomes active', () => {
    useWorkspaceStore.getState().addDesignTab();

    expect(tabs()).toHaveLength(2);
    // Every tab starts the same way the first one did — see the plan's "Startup"
    // decision. A new tab is never pre-committed to a method.
    expect(tabs()[1].kind).toBeNull();
    expect(activeId()).toBe(tabs()[1].id);
    expect(selectDesignMethod(useWorkspaceStore.getState())).toBe('none');
  });

  it('gives each new tab a non-colliding title', () => {
    useWorkspaceStore.getState().addDesignTab();
    useWorkspaceStore.getState().addDesignTab();

    expect(titles()).toEqual([
      DEFAULT_DESIGN_TITLE,
      `${DEFAULT_DESIGN_TITLE} 2`,
      `${DEFAULT_DESIGN_TITLE} 3`,
    ]);
  });
});

describe('activateDesignTab', () => {
  it('parks the outgoing design so its handle can be reused', () => {
    const first = activeId();
    useWorkspaceStore.getState().addDesignTab();
    const second = activeId();
    vi.mocked(handles.parkDesign).mockClear();

    useWorkspaceStore.getState().activateDesignTab(first);

    expect(activeId()).toBe(first);
    expect(handles.parkDesign).toHaveBeenCalledWith(second);
  });

  it('ignores a switch to the tab already active', () => {
    useWorkspaceStore.getState().activateDesignTab(activeId());
    expect(handles.parkDesign).not.toHaveBeenCalled();
  });

  it('ignores an id no tab holds', () => {
    const before = activeId();
    useWorkspaceStore.getState().activateDesignTab('design-nope');
    expect(activeId()).toBe(before);
  });
});

describe('closeDesignTab', () => {
  it('drops the design from the handle registry, not just the store', () => {
    useWorkspaceStore.getState().addDesignTab();
    const doomed = activeId();

    useWorkspaceStore.getState().closeDesignTab(doomed);

    // Forgetting is what frees the engine handle; removing the tab alone would
    // leak it for the life of the session.
    expect(handles.forgetDesign).toHaveBeenCalledWith(doomed);
    expect(tabs().some((tab) => tab.id === doomed)).toBe(false);
  });

  it('activates the neighbour when the active tab closes', () => {
    useWorkspaceStore.getState().addDesignTab();
    useWorkspaceStore.getState().addDesignTab();
    const [first, second, third] = tabs().map((tab) => tab.id);
    useWorkspaceStore.getState().activateDesignTab(second);

    useWorkspaceStore.getState().closeDesignTab(second);

    // The tab that slid into the closed one's position, not "the first".
    expect(activeId()).toBe(third);
    expect(tabs().map((tab) => tab.id)).toEqual([first, third]);
  });

  it('falls back to the last tab when the closed one was last', () => {
    useWorkspaceStore.getState().addDesignTab();
    const [first, second] = tabs().map((tab) => tab.id);
    useWorkspaceStore.getState().activateDesignTab(second);

    useWorkspaceStore.getState().closeDesignTab(second);
    expect(activeId()).toBe(first);
  });

  it('leaves the active tab alone when a different one closes', () => {
    useWorkspaceStore.getState().addDesignTab();
    const [first, second] = tabs().map((tab) => tab.id);

    useWorkspaceStore.getState().closeDesignTab(first);

    expect(activeId()).toBe(second);
  });

  it('re-provisions a fresh chooser tab when the last one closes', () => {
    const only = activeId();

    useWorkspaceStore.getState().closeDesignTab(only);

    // The ≥1-tab invariant: closing the last tab is allowed, and leaves a new
    // empty one rather than a workspace with nothing to render.
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0].id).not.toBe(only);
    expect(tabs()[0].kind).toBeNull();
    expect(activeId()).toBe(tabs()[0].id);
  });

  it('ignores an id no tab holds', () => {
    useWorkspaceStore.getState().closeDesignTab('design-nope');
    expect(tabs()).toHaveLength(1);
    expect(handles.forgetDesign).not.toHaveBeenCalled();
  });
});

describe('renameDesignTab', () => {
  it('renames and marks the project dirty', () => {
    useWorkspaceStore.setState({ dirty: false });
    useWorkspaceStore.getState().renameDesignTab(activeId(), '  Crane  ');

    expect(titles()).toEqual(['Crane']);
    // Tab names persist in the `.osf`, so renaming is a document edit.
    expect(useWorkspaceStore.getState().dirty).toBe(true);
  });

  it('refuses a blank name rather than leaving an unlabelled tab', () => {
    useWorkspaceStore.getState().renameDesignTab(activeId(), '   ');
    expect(titles()).toEqual([DEFAULT_DESIGN_TITLE]);
  });
});

describe('reorderDesignTab', () => {
  it('moves a tab and keeps every other one', () => {
    useWorkspaceStore.getState().addDesignTab();
    useWorkspaceStore.getState().addDesignTab();
    const [first, second, third] = tabs().map((tab) => tab.id);

    useWorkspaceStore.getState().reorderDesignTab(third, 0);

    expect(tabs().map((tab) => tab.id)).toEqual([third, first, second]);
  });

  it('clamps an out-of-range index instead of dropping the tab', () => {
    useWorkspaceStore.getState().addDesignTab();
    const [first, second] = tabs().map((tab) => tab.id);

    useWorkspaceStore.getState().reorderDesignTab(first, 99);

    expect(tabs().map((tab) => tab.id)).toEqual([second, first]);
  });

  it('does not change the active tab', () => {
    useWorkspaceStore.getState().addDesignTab();
    const before = activeId();
    useWorkspaceStore.getState().reorderDesignTab(tabs()[0].id, 1);
    expect(activeId()).toBe(before);
  });
});

describe('duplicateDesignTab', () => {
  it('copies through the codec and lands beside the original', async () => {
    useWorkspaceStore.setState({
      designTabs: [
        { id: 'design-1', title: 'Crane', kind: 'treemaker', treemaker: undefined as never },
      ],
      activeDesignId: 'design-1',
    });

    await useWorkspaceStore.getState().duplicateDesignTab('design-1');

    // Serialize → adopt is the same pair that saves a file and that eviction
    // uses, so a duplicate is exactly a round trip rather than a second path.
    expect(handles.serializeDesign).toHaveBeenCalledWith('design-1', 'treemaker');
    expect(handles.adoptDesign).toHaveBeenCalledWith(expect.any(String), 'serialized-design');
    expect(titles()).toEqual(['Crane', 'Crane copy']);
    expect(activeId()).toBe(tabs()[1].id);
  });

  it('refuses to duplicate a tab that has chosen no method', async () => {
    await useWorkspaceStore.getState().duplicateDesignTab(activeId());
    expect(tabs()).toHaveLength(1);
    expect(handles.serializeDesign).not.toHaveBeenCalled();
  });
});
