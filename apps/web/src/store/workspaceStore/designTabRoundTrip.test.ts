import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveProjectFileOptions, SaveTextFileOptions } from '../../platform/fileService';
import type { FileService } from '../../platform/fileService';

/**
 * The property the whole feature exists for: a project holds N designs, and
 * saving then reopening it gives you the same N back — same kinds, same titles,
 * same order, same pane arrangements, same active tab.
 *
 * `nativeProjectFile.test.ts` states this for the *format*. This states it for
 * the **store**, which is where a design becomes a tab and back again — and where
 * a field can be written and never read, or read and never written.
 */

const engineMocks = vi.hoisted(() => ({
  ensureTreeHandle: vi.fn(),
  getEngine: vi.fn(),
}));

vi.mock('./engineRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./engineRuntime')>();
  return {
    ...actual,
    ensureTreeHandle: engineMocks.ensureTreeHandle,
    getEngine: engineMocks.getEngine,
  };
});

const handles = vi.hoisted(() => ({
  serializeDesign: vi.fn(async (designId: string) => `serialized:${designId}`),
  adoptDesign: vi.fn(),
  forgetDesign: vi.fn(async (_designId: string) => undefined),
  acquireDesignHandle: vi.fn(async (_designId: string, _kind: string) => 1),
}));

const bpRuntimeMocks = vi.hoisted(() => ({
  refreshOristudioBpProject: vi.fn(async () => null as unknown),
}));

vi.mock('./oristudioBpRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./oristudioBpRuntime')>();
  return { ...actual, refreshOristudioBpProject: bpRuntimeMocks.refreshOristudioBpProject };
});

vi.mock('../../engines/designHandles', () => ({
  ...handles,
  adoptDesignHandle: vi.fn(async () => true),
  withDesignHandle: vi.fn(),
  parkDesign: vi.fn(async () => undefined),
  isDesignHot: vi.fn(() => false),
  hotDesignIds: vi.fn(() => []),
  subscribeToDesignHandles: vi.fn(() => () => undefined),
}));

const { useWorkspaceStore } = await import('./store');
const { createDesignTab, resetDesignTabIds } = await import('./designTabs');
const { createTreemakerDesignState, createBoxPleatDesignState } = await import('./designContent');

const store = () => useWorkspaceStore.getState();

/** A file service that remembers what was written, so it can be read back. */
function recordingFileService(): FileService & { written: string | null } {
  const state = { written: null as string | null };
  return {
    surface: 'web',
    supportsNativeDialogs: false,
    openTextFile: vi.fn(async () =>
      state.written === null ? null : { text: state.written, name: 'studio.osf', path: null }
    ),
    openBinaryFile: vi.fn(async () => null),
    saveProjectFile: vi.fn(async (options: SaveProjectFileOptions) => {
      state.written = await options.contents();
      return { name: options.suggestedName, path: `/tmp/${options.suggestedName}` };
    }),
    saveTextFile: vi.fn(async (options: SaveTextFileOptions) => {
      state.written = options.contents;
      return { name: options.suggestedName, path: `/tmp/${options.suggestedName}` };
    }),
    saveBinaryFile: vi.fn(async () => null),
    get written() {
      return state.written;
    },
  } as unknown as FileService & { written: string | null };
}

/** A fresh session, ready to open a file — a store that has not booted refuses. */
function reopenOn(_fileService: FileService) {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useWorkspaceStore.setState({ engineReady: true, status: 'ready' });
}

const paneLayout = (...ids: string[]) =>
  ({ grid: { root: { type: 'branch' } }, panels: Object.fromEntries(ids.map((id) => [id, {}])) }) as never;

/** Three designs of mixed kinds, each laid out differently, the middle active. */
function threeDesigns() {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  resetDesignTabIds();
  const crane = createDesignTab([], { kind: 'treemaker', title: 'Crane' });
  const kabuto = createDesignTab([crane], { kind: 'box-pleat', title: 'Kabuto' });
  const beetle = createDesignTab([crane, kabuto], { kind: 'treemaker', title: 'Beetle' });
  useWorkspaceStore.setState({
    designTabs: [
      {
        ...crane,
        paneLayout: paneLayout('design', 'inspector', 'diagnostics', 'conditions'),
        kind: 'treemaker',
        treemaker: createTreemakerDesignState(),
      },
      { ...kabuto, paneLayout: paneLayout('design', 'bp-editor'), kind: 'box-pleat', boxPleat: createBoxPleatDesignState() },
      { ...beetle, paneLayout: null, kind: 'treemaker', treemaker: createTreemakerDesignState() },
    ],
    // The *last* tab is active, so "reopens on the design that was active" is
    // testing the stored id rather than a default-to-first that would pass by
    // accident. Saving is gated on the active design being saveable, and a
    // box-pleat design with no document yet is not.
    activeDesignId: beetle.id,
    activeEditingContext: 'treemaker-tree',
    workspaceTitle: 'Studio',
    engineReady: true,
    status: 'ready',
  });
  return { crane: crane.id, kabuto: kabuto.id, beetle: beetle.id };
}

beforeEach(() => {
  vi.clearAllMocks();
  handles.serializeDesign.mockImplementation(async (designId: string) => `serialized:${designId}`);
  engineMocks.getEngine.mockResolvedValue({});
});

describe('saving and reopening a project of several designs', () => {
  it('brings back every design, in tab order, with its title and kind', async () => {
    const ids = threeDesigns();
    const fileService = recordingFileService();

    await store().saveProjectAs(fileService);
    reopenOn(fileService);
    await store().openProject(fileService);

    expect(store().designTabs.map((tab) => [tab.id, tab.title, tab.kind])).toEqual([
      [ids.crane, 'Crane', 'treemaker'],
      [ids.kabuto, 'Kabuto', 'box-pleat'],
      [ids.beetle, 'Beetle', 'treemaker'],
    ]);
  });

  it('reopens on the design that was active', async () => {
    const ids = threeDesigns();
    const fileService = recordingFileService();

    await store().saveProjectAs(fileService);
    reopenOn(fileService);
    await store().openProject(fileService);

    expect(store().activeDesignId).toBe(ids.beetle);
  });

  it('restores each design\'s own pane arrangement', async () => {
    threeDesigns();
    const fileService = recordingFileService();

    await store().saveProjectAs(fileService);
    reopenOn(fileService);
    await store().openProject(fileService);

    const layouts = store().designTabs.map((tab) => Object.keys(tab.paneLayout?.panels ?? {}));
    expect(layouts).toEqual([
      ['design', 'inspector', 'diagnostics', 'conditions'],
      ['design', 'bp-editor'],
      // A design that never saved a layout comes back without one, and opens on
      // its kind's default rather than on another design's.
      [],
    ]);
  });

  it('hands every design\'s text to the registry, not just the active one', async () => {
    const ids = threeDesigns();
    const fileService = recordingFileService();

    await store().saveProjectAs(fileService);
    reopenOn(fileService);
    handles.adoptDesign.mockClear();
    await store().openProject(fileService);

    // Lazy hydrate means only the active design gets a handle, but every design
    // must have its text adopted — otherwise visiting a background tab would
    // build a blank document.
    expect(handles.adoptDesign.mock.calls.map(([id]) => id).sort()).toEqual(
      [ids.crane, ids.kabuto, ids.beetle].sort()
    );
  });

  it('keeps the project title, which is the project\'s and not any design\'s', async () => {
    threeDesigns();
    const fileService = recordingFileService();

    await store().saveProjectAs(fileService);
    reopenOn(fileService);
    await store().openProject(fileService);

    expect(store().workspaceTitle).toBe('Studio');
  });
});

/**
 * A design that is only *text* until you look at it.
 *
 * Opening a file registers every design with the document registry but installs
 * only the active one into the store — that is what keeps a twelve-design project
 * cheap to open. The canvas renders the store, so without a read-back on
 * activation a background tab showed an empty design and the work looked lost.
 */
describe('visiting a design that was not the active one', () => {
  it('reads its content back from the file', async () => {
    const ids = threeDesigns();
    const fileService = recordingFileService();
    await store().saveProjectAs(fileService);
    reopenOn(fileService);
    await store().openProject(fileService);

    // Everything but the active design starts as text alone.
    const background = store().designTabs.filter((tab) => tab.id !== store().activeDesignId);
    expect(background.every((tab) => tab.pendingHydration)).toBe(true);

    await store().hydrateDesignTab(ids.crane);

    expect(store().designTabs.find((tab) => tab.id === ids.crane)?.pendingHydration).toBe(false);
  });

  it('reads it back exactly once, however many times the tab is activated', async () => {
    const ids = threeDesigns();
    const fileService = recordingFileService();
    await store().saveProjectAs(fileService);
    reopenOn(fileService);
    await store().openProject(fileService);
    handles.acquireDesignHandle.mockClear();

    // Two activations racing: the flag is cleared before the read, so the second
    // finds nothing to do rather than installing over the first.
    await Promise.all([store().hydrateDesignTab(ids.crane), store().hydrateDesignTab(ids.crane)]);

    expect(handles.acquireDesignHandle.mock.calls.filter(([id]) => id === ids.crane)).toHaveLength(1);
  });

  it('leaves a design created in this session alone', async () => {
    // Only a design read from a file is text-first; one made here already has
    // its content, and re-reading would be a round trip for nothing.
    threeDesigns();
    expect(store().designTabs.every((tab) => !tab.pendingHydration)).toBe(true);
  });
});

/**
 * Mirror draw is *design* state, and there is more than one design.
 *
 * These two facts arrived from opposite directions — main made a BP design carry
 * its own mirror line, fold and pairs, while this branch made designs plural — so
 * nothing yet pinned that they compose. A single shared symmetry would round-trip
 * through the format's per-design `viewState` and still come back wrong here: both
 * tabs would read the same value, and the last one written would win.
 */
describe('two box-pleat designs with different mirror state', () => {
  const BOOK = {
    enabled: true,
    fold: 'book' as const,
    quarterTurn: false,
    sidesSwapped: false,
    angle: 90,
    loc: { x: 10, y: 10 },
    pairs: [{ v1: 3, v2: 4 }],
  };
  const DIAGONAL = {
    enabled: false,
    fold: 'diagonal' as const,
    quarterTurn: false,
    sidesSwapped: false,
    angle: 45,
    loc: { x: 6, y: 6 },
    pairs: [],
  };

  function twoBoxPleatDesigns() {
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    resetDesignTabIds();
    const helmet = createDesignTab([], { kind: 'box-pleat', title: 'Helmet' });
    const mask = createDesignTab([helmet], { kind: 'box-pleat', title: 'Mask' });
    // A treemaker design stays active because saving is gated on the active
    // design being saveable, and a box-pleat design with no document is not.
    const anchor = createDesignTab([helmet, mask], { kind: 'treemaker', title: 'Anchor' });
    useWorkspaceStore.setState({
      designTabs: [
        { ...helmet, kind: 'box-pleat', boxPleat: createBoxPleatDesignState({ symmetry: BOOK }) },
        { ...mask, kind: 'box-pleat', boxPleat: createBoxPleatDesignState({ symmetry: DIAGONAL }) },
        { ...anchor, kind: 'treemaker', treemaker: createTreemakerDesignState() },
      ],
      activeDesignId: anchor.id,
      activeEditingContext: 'treemaker-tree',
      workspaceTitle: 'Studio',
      engineReady: true,
      status: 'ready',
    });
    return { helmet: helmet.id, mask: mask.id };
  }

  it('keeps that mirror when the background tab is finally opened', async () => {
    // Opening a file installs only the active design; a background tab is text
    // until visited. Hydration used to `install` rather than `patch`, which
    // rebuilds the box-pleat content from defaults — so the mirror the file had
    // just restored was dropped the moment the user clicked the tab. The design
    // came back with its pairs gone and mirror draw reset.
    const ids = twoBoxPleatDesigns();
    const fileService = recordingFileService();
    await store().saveProjectAs(fileService);
    reopenOn(fileService);
    await store().openProject(fileService);
    bpRuntimeMocks.refreshOristudioBpProject.mockResolvedValue({
      activeSurface: 'tree',
      snapshot: { tree: { vertices: [] }, packing: { flaps: [] } },
    });

    await store().hydrateDesignTab(ids.helmet);

    const tab = store().designTabs.find((candidate) => candidate.id === ids.helmet);
    expect(tab?.kind).toBe('box-pleat');
    const symmetry = tab?.kind === 'box-pleat' ? tab.boxPleat.symmetry : null;
    expect(symmetry?.pairs).toEqual(BOOK.pairs);
    expect(symmetry?.fold).toBe(BOOK.fold);
    expect(symmetry?.enabled).toBe(BOOK.enabled);
  });

  it('gives each design back its own mirror, not the other one\'s', async () => {
    const ids = twoBoxPleatDesigns();
    const fileService = recordingFileService();

    await store().saveProjectAs(fileService);
    reopenOn(fileService);
    await store().openProject(fileService);

    // `angle` and `loc` are deliberately *not* asserted: `setLoadedBpProject`
    // re-derives the axis from whichever sheet loaded rather than restoring it,
    // so they are a function of the document and not of the file. What must be
    // per-design is what the user authored — whether mirror draw is on, which
    // fold the mirror is, and which nodes are paired.
    const authoredOf = (id: string) => {
      const tab = store().designTabs.find((candidate) => candidate.id === id);
      if (tab?.kind !== 'box-pleat') return null;
      const { enabled, fold, pairs } = tab.boxPleat.symmetry;
      return { enabled, fold, pairs };
    };
    expect(authoredOf(ids.helmet)).toEqual({
      enabled: BOOK.enabled,
      fold: BOOK.fold,
      pairs: BOOK.pairs,
    });
    expect(authoredOf(ids.mask)).toEqual({
      enabled: DIAGONAL.enabled,
      fold: DIAGONAL.fold,
      pairs: DIAGONAL.pairs,
    });
  });
});

describe('replacing the project', () => {
  it('discards every open design when a new one is started', () => {
    const ids = threeDesigns();

    store().startNewDesign();

    expect(store().designTabs).toHaveLength(1);
    expect(store().designTabs[0].kind).toBeNull();
    expect([ids.crane, ids.kabuto, ids.beetle]).not.toContain(store().designTabs[0].id);
    // The engine documents go with them, or the registry leaks a handle per
    // design for the life of the session.
    expect(handles.forgetDesign.mock.calls.map(([id]) => id).sort()).toEqual(
      [ids.crane, ids.kabuto, ids.beetle].sort()
    );
  });
});

/**
 * Saving goes through a file dialog, and the user can leave one open.
 *
 * The save path captures `activeDesignId` before it serializes, but the write
 * that follows the dialog — stamping the saved filename and path onto the
 * box-pleat document and clearing its dirty flag — did not use it. Switching
 * tabs while the dialog was up marked a *different* design clean under a name it
 * had never been saved as.
 */
describe('saving while the user switches tabs', () => {
  const bpDoc = (filename: string) =>
    ({
      activeSurface: 'tree',
      dirty: true,
      source: { filename, path: null, format: 'bps' },
      snapshot: { tree: { vertices: [] }, packing: { flaps: [] }, summary: { title: '' } },
    }) as never;

  it('stamps the saved name on the design that was saved', async () => {
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    resetDesignTabIds();
    const saved = createDesignTab([], { kind: 'box-pleat', title: 'Saved' });
    const other = createDesignTab([saved], { kind: 'box-pleat', title: 'Other' });
    useWorkspaceStore.setState({
      designTabs: [
        { ...saved, kind: 'box-pleat', boxPleat: createBoxPleatDesignState({ document: bpDoc('Saved.bps') }) },
        { ...other, kind: 'box-pleat', boxPleat: createBoxPleatDesignState({ document: bpDoc('Other.bps') }) },
      ],
      activeDesignId: saved.id,
      workspaceTitle: 'Studio',
      engineReady: true,
      status: 'ready',
    });

    const fileService = recordingFileService();
    const realSave = fileService.saveProjectFile as unknown as (
      o: SaveProjectFileOptions
    ) => Promise<unknown>;
    (fileService as { saveProjectFile: unknown }).saveProjectFile = async (
      options: SaveProjectFileOptions
    ) => {
      // The click lands while the dialog is up — which is now also before the
      // project is serialized, so the switch has to survive both halves.
      useWorkspaceStore.setState({ activeDesignId: other.id });
      return realSave(options);
    };

    await store().saveProjectAs(fileService);

    const docOf = (id: string) => {
      const tab = store().designTabs.find((candidate) => candidate.id === id);
      return tab?.kind === 'box-pleat' ? tab.boxPleat.document : null;
    };
    expect(docOf(saved.id)?.source.filename).toBe('Untitled.osf');
    expect(docOf(saved.id)?.dirty).toBe(false);
    // The design the user switched to was not saved and must still say so.
    expect(docOf(other.id)?.source.filename).toBe('Other.bps');
    expect(docOf(other.id)?.dirty).toBe(true);
  });
});
