import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who owns a TreeMaker tree handle.
 *
 * The engine runtime builds trees by calling the worker directly — `newDesign`
 * for a fresh one, `loadTmd` for one read from a file — and gets a handle back.
 * That handle has to become the *design tab's*, held by the document registry.
 *
 * It used to go into a module-level `let` instead, and nothing caught it: types
 * were fine, every test passed, and the UI looked right because the store held
 * its own snapshot of the project. What actually broke was everything that goes
 * through the registry — Duplicate silently did nothing (`serializeDesign` threw
 * for an id nothing was registered under), switching tabs parked an empty
 * document, and the next acquire built a second, blank tree while the real one
 * leaked.
 */

const handles = vi.hoisted(() => ({
  adoptDesignHandle: vi.fn(async () => true),
  acquireDesignHandle: vi.fn(async () => 99),
}));

vi.mock('../../engines/designHandles', () => ({
  ...handles,
  withDesignHandle: vi.fn(),
  serializeDesign: vi.fn(async () => 'serialized'),
  parkDesign: vi.fn(async () => undefined),
  forgetDesign: vi.fn(async () => undefined),
  adoptDesign: vi.fn(),
  isDesignHot: vi.fn(() => false),
  hotDesignIds: vi.fn(() => []),
  subscribeToDesignHandles: vi.fn(() => () => undefined),
}));

const { createBlankTree, createStarterTree, initializeBlankTree, loadTreeFromText } =
  await import('./engineRuntime');
const { registerActiveDesignSource } = await import('./activeDesignSource');

/** Enough of the worker API for the creation paths, with a settable delay. */
function fakeEngine() {
  let nextHandle = 10;
  const state = { pending: () => Promise.resolve() };
  const api = {
    newDesign: vi.fn(async () => {
      await state.pending();
      return (nextHandle += 1);
    }),
    loadTmd: vi.fn(async () => {
      await state.pending();
      return (nextHandle += 1);
    }),
    applyEdit: vi.fn(async () => undefined),
    snapshot: vi.fn(async () => ({ nodes: [], edges: [], paths: [], conditions: [] })),
    freeTree: vi.fn(async () => undefined),
  };
  return { api: api as never, state };
}

beforeEach(() => {
  vi.clearAllMocks();
  handles.adoptDesignHandle.mockResolvedValue(true);
});

describe('a design tab owns the tree it creates', () => {
  it('hands a blank tree to the active design', async () => {
    registerActiveDesignSource(() => ({ id: 'design-7', kind: 'treemaker' }));
    const { api } = fakeEngine();

    await createBlankTree(api);

    expect(handles.adoptDesignHandle).toHaveBeenCalledWith('design-7', 'treemaker', 11);
  });

  it('hands a loaded tree to the active design', async () => {
    registerActiveDesignSource(() => ({ id: 'design-7', kind: 'treemaker' }));
    const { api } = fakeEngine();

    await loadTreeFromText(api, 'tmd5 text');

    expect(handles.adoptDesignHandle).toHaveBeenCalledWith('design-7', 'treemaker', 11);
  });

  it('hands a starter tree to the active design', async () => {
    registerActiveDesignSource(() => ({ id: 'design-7', kind: 'treemaker' }));
    const { api } = fakeEngine();

    await createStarterTree(api);

    expect(handles.adoptDesignHandle).toHaveBeenCalledWith('design-7', 'treemaker', 11);
  });

  it('claims a chooser tab, whose kind is still null', async () => {
    // The normal way a design is made: the tab is still on the chooser when
    // `createNewProject` runs, and the tab is marked TreeMaker only afterwards.
    // Skipping a null kind here is exactly what sent the tree to the module
    // fallback, where the registry could not see it.
    registerActiveDesignSource(() => ({ id: 'design-7', kind: null }));
    const { api } = fakeEngine();

    await createBlankTree(api);

    expect(handles.adoptDesignHandle).toHaveBeenCalledWith('design-7', 'treemaker', 11);
  });

  it('addresses the tab that was active when the build started', async () => {
    // Building a tree is a round trip to the worker. A tab switch during it must
    // not hand the new tree to whichever design the user happened to land on.
    let active = 'design-1';
    registerActiveDesignSource(() => ({ id: active, kind: 'treemaker' }));
    const { api, state } = fakeEngine();
    state.pending = async () => {
      active = 'design-2';
    };

    await createBlankTree(api);

    expect(handles.adoptDesignHandle).toHaveBeenCalledWith('design-1', 'treemaker', 11);
  });

  it('keeps the boot tree out of the design registry', async () => {
    // Booting seeds a *handle*; it does not choose a design method, and the
    // startup tab is the chooser. Claiming it would hand a blank tree to a tab
    // that has not decided what it is.
    registerActiveDesignSource(() => ({ id: 'design-1', kind: null }));
    const { api } = fakeEngine();

    await initializeBlankTree(api);

    expect(handles.adoptDesignHandle).not.toHaveBeenCalled();
  });
});
