import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveTextFileOptions } from '../../platform/fileService';
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
  forgetDesign: vi.fn(async () => undefined),
}));

vi.mock('../../engines/designHandles', () => ({
  ...handles,
  acquireDesignHandle: vi.fn(async () => 1),
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
