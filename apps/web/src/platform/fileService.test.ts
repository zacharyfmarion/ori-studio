import { describe, expect, it } from 'vitest';
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
