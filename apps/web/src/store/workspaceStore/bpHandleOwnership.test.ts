import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who owns a box-pleat document handle.
 *
 * The BP runtime held one — `activeHandle`, beside a `loadedHandles` set and a
 * `currentSource`. That is correct while one box-pleat design can be open and
 * becomes data loss the moment two can: opening a second design called
 * `replaceHandles`, which **freed** every handle not in the new set, so the first
 * design's document was destroyed and every later mutation went to whichever
 * document was loaded last. Its filename went the same way — one `currentSource`
 * for two designs.
 */

const handles = vi.hoisted(() => ({
  adoptDesignHandle: vi.fn(async () => true),
  acquireDesignHandle: vi.fn(async () => 42),
  forgetDesign: vi.fn(async () => undefined),
}));

vi.mock('../../engines/designHandles', () => ({
  ...handles,
  withDesignHandle: vi.fn(),
  serializeDesign: vi.fn(async () => 'serialized'),
  parkDesign: vi.fn(async () => undefined),
  adoptDesign: vi.fn(),
  isDesignHot: vi.fn(() => false),
  hotDesignIds: vi.fn(() => []),
  subscribeToDesignHandles: vi.fn(() => () => undefined),
}));

const client = vi.hoisted(() => ({
  newSampleProject: vi.fn(async () => 11),
  loadProject: vi.fn(async () => 12),
  freeProject: vi.fn(async () => undefined),
  exportBps: vi.fn(async () => 'bps text'),
  notifyProjectSaved: vi.fn(async () => undefined),
  snapshot: vi.fn(async () => ({})),
  summary: vi.fn(async () => ({})),
  treeData: vi.fn(async () => null),
  layoutSnapshot: vi.fn(async () => null),
  packingValidation: vi.fn(async () => null),
}));

vi.mock('../../engines/engineHost', () => ({
  connectEngine: vi.fn(async () => client),
  resetEngine: vi.fn(),
  isEngineConnected: vi.fn(() => true),
  onEngineLost: vi.fn(() => () => undefined),
}));

// The snapshot mapper is a pure translation of engine output; these tests are
// about *which handle* is read, so it stands in as identity.
vi.mock('../../engine/oristudioBpSnapshotMapper', () => ({
  oristudioBpProjectStateFromRaw: vi.fn((input: Record<string, unknown>) => input),
}));

const runtime = await import('./oristudioBpRuntime');
const { registerActiveDesignSource } = await import('./activeDesignSource');

beforeEach(() => {
  vi.clearAllMocks();
  handles.adoptDesignHandle.mockResolvedValue(true);
  handles.acquireDesignHandle.mockResolvedValue(42);
});

describe('a design tab owns the box-pleat document it creates', () => {
  it('hands a fresh sample project to the active design', async () => {
    registerActiveDesignSource(() => ({ id: 'design-3', kind: 'box-pleat' }));

    await runtime.createSampleOristudioBpProject();

    expect(handles.adoptDesignHandle).toHaveBeenCalledWith('design-3', 'box-pleat', 11);
    // Nothing else is freed. The old runtime freed every handle outside the new
    // set here, which is what destroyed the other tab's document.
    expect(client.freeProject).not.toHaveBeenCalled();
  });

  it('hands a loaded .bps to the active design', async () => {
    registerActiveDesignSource(() => ({ id: 'design-3', kind: 'box-pleat' }));

    await runtime.loadOristudioBpProjectFromText('{}', { filename: 'crane.bps' });

    expect(handles.adoptDesignHandle).toHaveBeenCalledWith('design-3', 'box-pleat', 12);
  });

  it('claims a chooser tab, whose kind is still null', async () => {
    // Picking Box-pleated runs this *before* the tab is marked box-pleat.
    registerActiveDesignSource(() => ({ id: 'design-3', kind: null }));

    await runtime.createSampleOristudioBpProject();

    expect(handles.adoptDesignHandle).toHaveBeenCalledWith('design-3', 'box-pleat', 11);
  });

  it('addresses the tab that was active when the load started', async () => {
    let active = 'design-1';
    registerActiveDesignSource(() => ({ id: active, kind: 'box-pleat' }));
    client.newSampleProject.mockImplementation(async () => {
      active = 'design-2';
      return 11;
    });

    await runtime.createSampleOristudioBpProject();

    expect(handles.adoptDesignHandle).toHaveBeenCalledWith('design-1', 'box-pleat', 11);
    client.newSampleProject.mockImplementation(async () => 11);
  });

  it('frees the handle rather than leaking it when no design can hold it', async () => {
    registerActiveDesignSource(() => null);

    await expect(runtime.createSampleOristudioBpProject()).rejects.toThrow();
    expect(client.freeProject).toHaveBeenCalledWith(11);
  });
});

describe('reads resolve through the active design', () => {
  it('exports the active design\'s document, not a remembered handle', async () => {
    registerActiveDesignSource(() => ({ id: 'design-9', kind: 'box-pleat' }));
    handles.acquireDesignHandle.mockResolvedValue(77);

    await runtime.exportOristudioBpProjectAsBps();

    expect(handles.acquireDesignHandle).toHaveBeenCalledWith('design-9', 'box-pleat');
    expect(client.exportBps).toHaveBeenCalledWith(77);
  });

  it('refuses when the active design is not box-pleat', async () => {
    registerActiveDesignSource(() => ({ id: 'design-9', kind: 'treemaker' }));

    await expect(runtime.exportOristudioBpProjectAsBps()).rejects.toThrow('No Box Pleat project');
  });

  it('has nothing to refresh for a design of another kind', async () => {
    registerActiveDesignSource(() => ({ id: 'design-9', kind: 'treemaker' }));

    await expect(runtime.refreshOristudioBpProject()).resolves.toBeNull();
  });
});

describe('a design remembers where its own document came from', () => {
  it('keeps one source per design', async () => {
    // One `currentSource` meant opening a second design renamed the first, and
    // an undo in either restored the other's filename.
    let active = 'design-1';
    registerActiveDesignSource(() => ({ id: active, kind: 'box-pleat' }));

    await runtime.loadOristudioBpProjectFromText('{}', { filename: 'crane.bps' });
    active = 'design-2';
    await runtime.loadOristudioBpProjectFromText('{}', { filename: 'kabuto.bps' });

    active = 'design-1';
    const first = await runtime.refreshOristudioBpProject();
    expect((first as { source: { filename: string } }).source.filename).toBe('crane.bps');

    active = 'design-2';
    const second = await runtime.refreshOristudioBpProject();
    expect((second as { source: { filename: string } }).source.filename).toBe('kabuto.bps');
  });

  it('drops a closed design\'s document and its source', async () => {
    registerActiveDesignSource(() => ({ id: 'design-1', kind: 'box-pleat' }));
    await runtime.loadOristudioBpProjectFromText('{}', { filename: 'crane.bps' });

    await runtime.releaseOristudioBpProject();

    expect(handles.forgetDesign).toHaveBeenCalledWith('design-1');
    const refreshed = await runtime.refreshOristudioBpProject();
    expect((refreshed as { source: { filename: string } }).source.filename).toBe('Untitled.bps');
  });
});
