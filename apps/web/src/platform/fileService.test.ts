import { describe, expect, it } from 'vitest';
import {
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
