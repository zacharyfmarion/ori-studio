import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDroppedFileService,
  createFileService,
  createOpenedPathFileService,
  ensureExtension,
  filenameFromPath,
  filesystemPathOrNull,
  resetWebSaveTargets,
} from './fileService';

describe('file service selection', () => {
  it('creates a browser service for web runtime', () => {
    const service = createFileService('web');
    expect(service.surface).toBe('web');
    expect(service.supportsNativeDialogs).toBe(false);
    expect(service.openTextFile).toBeTypeOf('function');
    expect(service.openBinaryFile).toBeTypeOf('function');
    expect(service.saveTextFile).toBeTypeOf('function');
  });

  it('creates a Tauri service for desktop runtime', () => {
    const service = createFileService('desktop');
    expect(service.surface).toBe('desktop');
    expect(service.supportsNativeDialogs).toBe(true);
    expect(service.openTextFile).toBeTypeOf('function');
    expect(service.openBinaryFile).toBeTypeOf('function');
    expect(service.saveTextFile).toBeTypeOf('function');
  });

  it('normalizes filenames and paths', () => {
    expect(filenameFromPath('/tmp/fold/base.tmd5')).toBe('base.tmd5');
    expect(filenameFromPath('C:\\tmp\\base.tmd4')).toBe('base.tmd4');
    expect(ensureExtension('base', 'tmd5')).toBe('base.tmd5');
    expect(ensureExtension('base.tmd5', '.tmd5')).toBe('base.tmd5');
  });

  it('creates a desktop file service for Finder-opened paths', () => {
    const service = createOpenedPathFileService('/tmp/project.osf');

    expect(service.surface).toBe('desktop');
    expect(service.supportsNativeDialogs).toBe(true);
    expect(service.openTextFile).toBeTypeOf('function');
    expect(service.saveTextFile).toBeTypeOf('function');
    expect(service.saveBinaryFile).toBeTypeOf('function');
  });
});

describe('dropped file service', () => {
  it('resolves the dropped file as text without opening a picker', async () => {
    const service = createDroppedFileService(new File(['{"a":1}'], 'design.fold'));

    await expect(service.openTextFile({ title: 'ignored', extensions: [] })).resolves.toEqual({
      text: '{"a":1}',
      name: 'design.fold',
      path: null,
    });
  });

  it('resolves the dropped file as bytes, keeping its MIME type', async () => {
    const service = createDroppedFileService(
      new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' }),
    );

    const result = await service.openBinaryFile({ title: 'ignored', extensions: [] });
    expect(Array.from(result?.bytes ?? [])).toEqual([1, 2, 3]);
    expect(result?.mimeType).toBe('image/png');
    expect(result?.name).toBe('photo.png');
  });

  it('falls back to the filename when the drop carried no MIME type', async () => {
    const service = createDroppedFileService(new File([new Uint8Array([1])], 'photo.png'));

    const result = await service.openBinaryFile({ title: 'ignored', extensions: [] });
    expect(result?.mimeType).toBe('image/png');
  });

  // A webview drop hands over bytes but never a location, so there is no
  // overwrite target and the first save has to go through a save dialog.
  it('reports no path, so saving cannot silently overwrite', async () => {
    const service = createDroppedFileService(new File(['x'], 'design.osf'));

    const text = await service.openTextFile({ title: 'ignored', extensions: [] });
    const binary = await service.openBinaryFile({ title: 'ignored', extensions: [] });
    expect(text?.path).toBeNull();
    expect(binary?.path).toBeNull();
  });
});

/**
 * Saving the document twice in the browser used to produce two files —
 * `project.osf` and `project (1).osf` — because a download has no way back to
 * what it wrote. The handle from the save dialog does, so the second save
 * overwrites the first.
 */
describe('browser document saves', () => {
  /** A stand-in for the file a picker hands back. */
  function fakeHandle(name: string) {
    const written: string[] = [];
    const handle = {
      name,
      kind: 'file' as const,
      written,
      failNextWrite: false,
      getFile: async () => new File([''], name),
      queryPermission: undefined as
        undefined | ((descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>),
      requestPermission: undefined as
        undefined | ((descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>),
      createWritable: vi.fn(async () => {
        if (handle.failNextWrite) throw new DOMException('denied', 'NotAllowedError');
        let buffer = '';
        return {
          write: async (contents: string) => {
            buffer = contents;
          },
          close: async () => {
            written.push(buffer);
          },
        };
      }),
    };
    return handle;
  }

  function saveOptions(
    overrides: Partial<Parameters<ReturnType<typeof createFileService>['saveTextFile']>[0]> = {},
  ) {
    return {
      title: 'Save Ori Studio Project',
      contents: 'first',
      suggestedName: 'project.osf',
      extensions: ['osf'],
      reusableTarget: true,
      ...overrides,
    };
  }

  beforeEach(() => {
    resetWebSaveTargets();
  });

  afterEach(() => {
    delete window.showSaveFilePicker;
    delete window.showOpenFilePicker;
    vi.restoreAllMocks();
  });

  /**
   * The half that was missing: opening a file established no save target, so the
   * first Save after an Open asked where to put it — a file the user had just
   * named. The open dialog's handle is the way back to it.
   */
  it('saves back to the file that was opened, without asking where', async () => {
    const handle = fakeHandle('opened.osf');
    handle.getFile = async () => new File(['{"a":1}'], 'opened.osf');
    const openPicker = vi.fn(async () => [handle as unknown as FileSystemFileHandle]);
    const savePicker = vi.fn();
    window.showOpenFilePicker = openPicker;
    window.showSaveFilePicker = savePicker as unknown as typeof window.showSaveFilePicker;
    const service = createFileService('web');

    const opened = await service.openTextFile({ title: 'Open', extensions: ['osf'] });
    expect(opened).toMatchObject({ text: '{"a":1}', name: 'opened.osf' });
    expect(opened?.path).toBeTruthy();

    const saved = await service.saveTextFile(saveOptions({ path: opened?.path }));

    expect(savePicker).not.toHaveBeenCalled();
    expect(handle.written).toEqual(['first']);
    expect(saved?.path).toBe(opened?.path);
  });

  /**
   * A read-only handle has to be upgraded before it can be written, and the API
   * offers no way to ask for that inside the open dialog. So it is asked at the
   * first save, not at open: Chrome words the prompt "Save changes to <file>?",
   * which is nonsense asked of someone who has just opened a file and changed
   * nothing. Once granted it holds for the rest of the session.
   */
  it('asks for write access at the first save, and not at open', async () => {
    const handle = fakeHandle('opened.osf');
    handle.getFile = async () => new File(['{}'], 'opened.osf');
    // What Chromium reports for a handle that came from the *open* dialog.
    let granted = false;
    handle.queryPermission = vi.fn(async () => (granted ? 'granted' : 'prompt') as PermissionState);
    handle.requestPermission = vi.fn(async () => {
      granted = true;
      return 'granted' as PermissionState;
    });
    window.showOpenFilePicker = vi.fn(async () => [handle as unknown as FileSystemFileHandle]);
    const service = createFileService('web');

    const opened = await service.openTextFile({ title: 'Open', extensions: ['osf'] });
    expect(handle.requestPermission).not.toHaveBeenCalled();

    await service.saveTextFile(saveOptions({ path: opened?.path }));
    expect(handle.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });

    await service.saveTextFile(saveOptions({ contents: 'second', path: opened?.path }));

    // Granted once, so the second save asks nothing.
    expect(handle.requestPermission).toHaveBeenCalledTimes(1);
    expect(handle.written).toEqual(['first', 'second']);
  });

  it('asks where to save instead when permission to write the opened file is refused', async () => {
    const opened = fakeHandle('opened.osf');
    opened.getFile = async () => new File(['{}'], 'opened.osf');
    opened.queryPermission = vi.fn(async () => 'prompt' as PermissionState);
    opened.requestPermission = vi.fn(async () => 'denied' as PermissionState);
    const replacement = fakeHandle('elsewhere.osf');
    const savePicker = vi.fn(async () => replacement as unknown as FileSystemFileHandle);
    window.showOpenFilePicker = vi.fn(async () => [opened as unknown as FileSystemFileHandle]);
    window.showSaveFilePicker = savePicker;
    const service = createFileService('web');

    const result = await service.openTextFile({ title: 'Open', extensions: ['osf'] });
    const saved = await service.saveTextFile(saveOptions({ path: result?.path }));

    expect(savePicker).toHaveBeenCalledOnce();
    expect(opened.written).toEqual([]);
    expect(replacement.written).toEqual(['first']);
    expect(saved?.name).toBe('elsewhere.osf');
  });

  it('reports a dismissed open dialog as a cancel, not a fallback to the input', async () => {
    window.showOpenFilePicker = vi.fn(async () => {
      throw new DOMException('dismissed', 'AbortError');
    });
    const service = createFileService('web');

    await expect(service.openTextFile({ title: 'Open', extensions: ['osf'] })).resolves.toBeNull();
  });

  it('saves again over the file the first save created, with no second dialog', async () => {
    const handle = fakeHandle('project.osf');
    const picker = vi.fn(async () => handle as unknown as FileSystemFileHandle);
    window.showSaveFilePicker = picker;
    const service = createFileService('web');

    const first = await service.saveTextFile(saveOptions());
    expect(first?.path).toBeTruthy();

    const second = await service.saveTextFile(
      saveOptions({ contents: 'second', path: first?.path }),
    );

    expect(second?.path).toBe(first?.path);
    expect(picker).toHaveBeenCalledOnce();
    expect(handle.written).toEqual(['first', 'second']);
  });

  it('asks again for Save As, which passes no target', async () => {
    const first = fakeHandle('project.osf');
    const second = fakeHandle('copy.osf');
    const picker = vi
      .fn()
      .mockResolvedValueOnce(first as unknown as FileSystemFileHandle)
      .mockResolvedValueOnce(second as unknown as FileSystemFileHandle);
    window.showSaveFilePicker = picker;
    const service = createFileService('web');

    await service.saveTextFile(saveOptions());
    const result = await service.saveTextFile(saveOptions({ contents: 'copy', path: null }));

    expect(picker).toHaveBeenCalledTimes(2);
    expect(result?.name).toBe('copy.osf');
    // The original is untouched: Save As writes the new file only.
    expect(first.written).toEqual(['first']);
    expect(second.written).toEqual(['copy']);
  });

  it('reports a dismissed dialog as a cancelled save, not a failure', async () => {
    window.showSaveFilePicker = vi.fn(async () => {
      throw new DOMException('dismissed', 'AbortError');
    });
    const service = createFileService('web');

    await expect(service.saveTextFile(saveOptions())).resolves.toBeNull();
  });

  it('falls back to a fresh dialog when the handle can no longer be written', async () => {
    const handle = fakeHandle('project.osf');
    const replacement = fakeHandle('project.osf');
    const picker = vi
      .fn()
      .mockResolvedValueOnce(handle as unknown as FileSystemFileHandle)
      .mockResolvedValueOnce(replacement as unknown as FileSystemFileHandle);
    window.showSaveFilePicker = picker;
    const service = createFileService('web');

    const first = await service.saveTextFile(saveOptions());
    handle.failNextWrite = true;

    const second = await service.saveTextFile(
      saveOptions({ contents: 'second', path: first?.path }),
    );

    expect(picker).toHaveBeenCalledTimes(2);
    expect(second?.path).not.toBe(first?.path);
    expect(replacement.written).toEqual(['second']);
  });

  it('downloads, as before, where the browser has no File System Access API', async () => {
    // Firefox and Safari. `showSaveFilePicker` is left undefined.
    const service = createFileService('web');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const result = await service.saveTextFile(saveOptions());

    expect(click).toHaveBeenCalledOnce();
    // No path means no overwrite target, so the next save downloads again.
    expect(result).toEqual({ name: 'project.osf', path: null });
  });

  it('leaves exports as downloads even where the API exists', async () => {
    const picker = vi.fn();
    window.showSaveFilePicker = picker as unknown as typeof window.showSaveFilePicker;
    const service = createFileService('web');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const result = await service.saveTextFile(
      saveOptions({ suggestedName: 'pattern.cp', extensions: ['cp'], reusableTarget: false }),
    );

    expect(picker).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledOnce();
    expect(result?.path).toBeNull();
  });
});

describe('filesystemPathOrNull', () => {
  it('keeps a real path and drops a web save-target token', () => {
    // The token is local to the page that minted it, so writing one into a
    // portable .osf would persist a reference that resolves nowhere.
    expect(filesystemPathOrNull('/tmp/project.osf')).toBe('/tmp/project.osf');
    expect(filesystemPathOrNull('C:\\work\\project.osf')).toBe('C:\\work\\project.osf');
    expect(filesystemPathOrNull(null)).toBeNull();
    expect(filesystemPathOrNull('web-save:1')).toBeNull();
  });
});
