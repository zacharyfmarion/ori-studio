import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChoiceDialogOptions } from '../store/commandDialogStore';

const routingMocks = vi.hoisted(() => ({
  navigateTo: vi.fn(),
  currentPath: vi.fn<() => string | null>(() => '/edit'),
  currentWorkspacePath: vi.fn(() => '/edit'),
}));

const dialogMocks = vi.hoisted(() => ({
  requestChoice: vi.fn<(options: ChoiceDialogOptions) => Promise<string | null>>(async () => null),
}));

const capabilityMocks = vi.hoisted(() => ({
  importAddEnabled: { value: true },
}));

vi.mock('../routing/appRouter', () => ({
  navigateTo: routingMocks.navigateTo,
  currentPath: routingMocks.currentPath,
}));

vi.mock('../routing/landing', () => ({
  currentWorkspacePath: routingMocks.currentWorkspacePath,
}));

vi.mock('../store/workspaceStore/capabilities', () => ({
  selectWorkspaceCapabilities: () => ({
    'file.importAdd': { enabled: capabilityMocks.importAddEnabled.value, label: '', reason: '' },
  }),
}));

vi.mock('../store/commandDialogStore', async () => {
  const actual = await vi.importActual<typeof import('../store/commandDialogStore')>(
    '../store/commandDialogStore',
  );
  return { ...actual, requestChoice: dialogMocks.requestChoice };
});

import { handleFileDrop } from './fileDropController';
import { useCommandDialogStore } from '../store/commandDialogStore';
import { useWorkspaceStore } from '../store/workspaceStore';

function file(name: string, type = ''): File {
  return new File(['x'], name, { type });
}

function storeState() {
  return useWorkspaceStore.getState();
}

let openProject: ReturnType<typeof vi.fn>;
let importAddCreasePattern: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  capabilityMocks.importAddEnabled.value = true;
  routingMocks.currentPath.mockReturnValue('/edit');
  routingMocks.currentWorkspacePath.mockReturnValue('/edit');
  dialogMocks.requestChoice.mockResolvedValue(null);
  useCommandDialogStore.setState({ dialog: null });

  openProject = vi.fn().mockResolvedValue(true);
  importAddCreasePattern = vi.fn().mockResolvedValue(true);
  useWorkspaceStore.setState({
    dirty: false,
    error: null,
    projectMessage: null,
    openProject,
    importAddCreasePattern,
  } as never);
});

describe('handleFileDrop', () => {
  it('does nothing for an empty drop', async () => {
    await expect(handleFileDrop({ files: [], policy: 'open-or-import' })).resolves.toBeNull();
    expect(openProject).not.toHaveBeenCalled();
  });

  it('opens an unmergeable document with no dialog', async () => {
    const result = await handleFileDrop({ files: [file('a.osf')], policy: 'open-or-import' });

    expect(result).toBe('opened');
    expect(dialogMocks.requestChoice).not.toHaveBeenCalled();
    expect(openProject).toHaveBeenCalledOnce();
    expect(routingMocks.navigateTo).toHaveBeenCalledWith('/edit');
  });

  // Nobody has asked about the discard yet, so the store's own prompt has to run.
  it('leaves the discard prompt to the store when it raised no choice', async () => {
    useWorkspaceStore.setState({ dirty: true });

    await handleFileDrop({ files: [file('a.osf')], policy: 'open-or-import' });

    expect(openProject).toHaveBeenCalledWith(expect.anything(), { confirmDiscard: true });
  });

  it('offers the choice for a crease pattern when one can be merged into', async () => {
    dialogMocks.requestChoice.mockResolvedValue('import');

    const result = await handleFileDrop({ files: [file('a.cp')], policy: 'open-or-import' });

    expect(result).toBe('imported');
    expect(importAddCreasePattern).toHaveBeenCalledOnce();
    expect(openProject).not.toHaveBeenCalled();
  });

  // The reported bug, end to end: macOS types `.ori` as Olympus raw, so the
  // drop arrived describing itself as a photo. It has to take the same route a
  // `.fold` does.
  it('takes a .ori the platform typed as an image down the crease-pattern route', async () => {
    dialogMocks.requestChoice.mockResolvedValue('import');

    const result = await handleFileDrop({
      files: [file('design.ori', 'image/x-olympus-orf')],
      policy: 'open-or-import',
    });

    expect(result).toBe('imported');
    expect(importAddCreasePattern).toHaveBeenCalledOnce();
    expect(storeState().error).toBeNull();
  });

  it('suppresses the second prompt when its own choice covered the discard', async () => {
    useWorkspaceStore.setState({ dirty: true });
    dialogMocks.requestChoice.mockResolvedValue('open');

    const result = await handleFileDrop({ files: [file('a.cp')], policy: 'open-or-import' });

    expect(result).toBe('opened');
    expect(openProject).toHaveBeenCalledWith(expect.anything(), { confirmDiscard: false });
  });

  it('marks the open option as destructive only when there is work to lose', async () => {
    dialogMocks.requestChoice.mockResolvedValue(null);

    await handleFileDrop({ files: [file('a.cp')], policy: 'open-or-import' });
    const clean = dialogMocks.requestChoice.mock.calls[0]?.[0];
    expect(clean?.options.find((option) => option.id === 'open')?.tone).toBe('default');

    useWorkspaceStore.setState({ dirty: true });
    await handleFileDrop({ files: [file('a.cp')], policy: 'open-or-import' });
    const dirty = dialogMocks.requestChoice.mock.calls[1]?.[0];
    expect(dirty?.options.find((option) => option.id === 'open')?.tone).toBe('danger');
  });

  it('does nothing when the choice is dismissed', async () => {
    dialogMocks.requestChoice.mockResolvedValue(null);

    const result = await handleFileDrop({ files: [file('a.cp')], policy: 'open-or-import' });

    expect(result).toBe('cancelled');
    expect(openProject).not.toHaveBeenCalled();
    expect(importAddCreasePattern).not.toHaveBeenCalled();
  });

  it('skips the choice when nothing can be merged into', async () => {
    capabilityMocks.importAddEnabled.value = false;

    const result = await handleFileDrop({ files: [file('a.cp')], policy: 'open-or-import' });

    expect(result).toBe('opened');
    expect(dialogMocks.requestChoice).not.toHaveBeenCalled();
    expect(openProject).toHaveBeenCalledOnce();
  });

  // The welcome screen: the Edit canvas is always-live, so a crease pattern can
  // be loaded while sitting there, but merging into it makes no sense.
  it('never offers the choice on an open-only target', async () => {
    const result = await handleFileDrop({ files: [file('a.cp')], policy: 'open-only' });

    expect(result).toBe('opened');
    expect(dialogMocks.requestChoice).not.toHaveBeenCalled();
  });

  it('navigates to Edit after an import triggered from elsewhere', async () => {
    routingMocks.currentPath.mockReturnValue('/design');
    dialogMocks.requestChoice.mockResolvedValue('import');

    await handleFileDrop({ files: [file('a.cp')], policy: 'open-or-import' });

    expect(routingMocks.navigateTo).toHaveBeenCalledWith('/edit');
  });

  it('stays put after an import triggered from Edit', async () => {
    routingMocks.currentPath.mockReturnValue('/edit');
    dialogMocks.requestChoice.mockResolvedValue('import');

    await handleFileDrop({ files: [file('a.cp')], policy: 'open-or-import' });

    expect(routingMocks.navigateTo).not.toHaveBeenCalled();
  });

  it('refuses an unsupported file, naming it and the supported extensions', async () => {
    const result = await handleFileDrop({ files: [file('notes.txt')], policy: 'open-only' });

    expect(result).toBe('refused');
    expect(openProject).not.toHaveBeenCalled();
    expect(storeState().error?.message).toContain('notes.txt');
    expect(storeState().error?.message).toContain('.osf');
  });

  // Folders arrive as a zero-byte entry with no extension and no type.
  it('refuses a dropped folder', async () => {
    const result = await handleFileDrop({
      files: [new File([], 'My Designs')],
      policy: 'open-only',
    });

    expect(result).toBe('refused');
    expect(openProject).not.toHaveBeenCalled();
  });

  it('points an image at the crease pattern instead of opening it', async () => {
    const result = await handleFileDrop({
      files: [file('photo.png', 'image/png')],
      policy: 'open-or-import',
    });

    expect(result).toBe('refused');
    expect(storeState().error?.message).toContain('reference image');
  });

  // Raising a dialog while one is open would resolve that one with its fallback,
  // silently cancelling whatever it was asking about.
  it('refuses while another dialog is open', async () => {
    useCommandDialogStore.setState({
      dialog: { id: 1, type: 'confirm', title: 'Busy', message: 'Busy' },
    });

    const result = await handleFileDrop({ files: [file('a.osf')], policy: 'open-only' });

    expect(result).toBe('refused');
    expect(openProject).not.toHaveBeenCalled();
  });

  it('acts on the first openable document and reports the rest as ignored', async () => {
    const result = await handleFileDrop({
      files: [file('notes.txt'), file('design.fold'), file('other.cp')],
      policy: 'open-only',
    });

    expect(result).toBe('opened');
    expect(openProject).toHaveBeenCalledOnce();
    expect(storeState().projectMessage).toContain('design.fold');
    expect(storeState().projectMessage).toContain('2');
  });

  it('says nothing about ignored files for a single-file drop', async () => {
    await handleFileDrop({ files: [file('a.osf')], policy: 'open-only' });

    expect(storeState().projectMessage).toBeNull();
  });

  it('reports nothing when the open itself fails', async () => {
    openProject.mockResolvedValue(false);

    const result = await handleFileDrop({ files: [file('a.osf')], policy: 'open-only' });

    expect(result).toBeNull();
    expect(routingMocks.navigateTo).not.toHaveBeenCalled();
  });
});
