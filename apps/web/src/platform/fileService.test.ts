import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDroppedFileService,
  createFileService,
  createOpenedPathFileService,
  ensureExtension,
  filenameFromPath,
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

/**
 * The browser save has to report a cancellation truthfully: a project save that
 * returns a result clears `dirty`, and a cleared `dirty` is what silences the
 * close-tab warning. `<a download>` cannot report one, so the project save asks
 * the File System Access API instead — and only falls back to the download when
 * that API is not there to ask.
 */
describe('browser project save', () => {
  const stubPicker = (picker: unknown) => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      value: picker,
      configurable: true,
      writable: true,
    });
  };

  const stubDownload = () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stub');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    return vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  };

  const writtenFileHandle = (name: string, written: string[]) => ({
    name,
    createWritable: async () => ({
      write: async (blob: Blob) => {
        written.push(await blob.text());
      },
      close: async () => {},
      abort: async () => {},
    }),
  });

  const projectSave = (contents: () => Promise<string>) => ({
    title: 'Save Ori Studio Project',
    contents,
    suggestedName: 'design.osf',
    path: null,
    extensions: ['osf'],
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'showSaveFilePicker');
  });

  it('reports a dismissed picker as no save, and writes nothing', async () => {
    const download = stubDownload();
    const contents = vi.fn(async () => 'serialized');
    stubPicker(async () => {
      throw new DOMException('The user aborted a request.', 'AbortError');
    });

    await expect(
      createFileService('web').saveProjectFile(projectSave(contents))
    ).resolves.toBeNull();
    expect(download).not.toHaveBeenCalled();
    // Not serialized either: the target is settled first, so a cancel costs
    // nothing and cannot outlive the activation the picker needs.
    expect(contents).not.toHaveBeenCalled();
  });

  it('reports a denied write permission as no save', async () => {
    stubDownload();
    stubPicker(async () => ({
      name: 'design.osf',
      createWritable: async () => {
        throw new DOMException('Write permission denied.', 'NotAllowedError');
      },
    }));

    await expect(
      createFileService('web').saveProjectFile(projectSave(async () => 'serialized'))
    ).resolves.toBeNull();
  });

  it('writes the contents and reports the name the file was saved under', async () => {
    const written: string[] = [];
    // The picker lets the user rename, so the handle's name is the truth.
    stubPicker(async () => writtenFileHandle('renamed.osf', written));

    await expect(
      createFileService('web').saveProjectFile(projectSave(async () => 'serialized'))
    ).resolves.toEqual({ name: 'renamed.osf', path: null });
    expect(written).toEqual(['serialized']);
  });

  it('surfaces a failed write rather than quietly downloading instead', async () => {
    const download = stubDownload();
    stubPicker(async () => ({
      name: 'design.osf',
      createWritable: async () => ({
        write: async () => {
          throw new Error('disk full');
        },
        close: async () => {},
        abort: async () => {},
      }),
    }));

    await expect(
      createFileService('web').saveProjectFile(projectSave(async () => 'serialized'))
    ).rejects.toThrow('disk full');
    expect(download).not.toHaveBeenCalled();
  });

  it('falls back to a download where the picker does not exist', async () => {
    const download = stubDownload();

    await expect(
      createFileService('web').saveProjectFile(projectSave(async () => 'serialized'))
    ).resolves.toEqual({ name: 'design.osf', path: null });
    expect(download).toHaveBeenCalled();
  });

  it('falls back to a download when the picker refuses to open', async () => {
    const download = stubDownload();
    // What Chrome throws once transient activation has expired, and for an
    // insecure or cross-origin context.
    stubPicker(async () => {
      throw new DOMException('Must be handling a user gesture.', 'SecurityError');
    });

    await expect(
      createFileService('web').saveProjectFile(projectSave(async () => 'serialized'))
    ).resolves.toEqual({ name: 'design.osf', path: null });
    expect(download).toHaveBeenCalled();
  });

  // Exports are copies going out the door: nothing clears `dirty` on them, and a
  // picker per PNG would be friction for no correctness gain.
  it('leaves exports on the download path', async () => {
    const download = stubDownload();
    const picker = vi.fn();
    stubPicker(picker);

    await expect(
      createFileService('web').saveTextFile({
        title: 'Export CP Document',
        contents: 'creases',
        suggestedName: 'design.cp',
        path: null,
        extensions: ['cp'],
      })
    ).resolves.toEqual({ name: 'design.cp', path: null });
    expect(download).toHaveBeenCalled();
    expect(picker).not.toHaveBeenCalled();
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
      new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' })
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
