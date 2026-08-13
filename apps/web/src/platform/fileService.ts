import { invoke } from '@tauri-apps/api/core';
import { track } from '../analytics';
import { getRuntimeSurface, type RuntimeSurface } from './runtime';

export type FileCommand =
  | 'openProject'
  | 'importAddCreasePattern'
  | 'saveProject'
  | 'saveProjectAs'
  | 'exportV5'
  | 'exportV4'
  | 'exportCp'
  | 'exportFold'
  | 'exportBps'
  | 'exportOri'
  | 'exportOrh'
  | 'exportSvg'
  | 'exportPng';

export interface OpenTextFileOptions {
  title: string;
  extensions: string[];
}

export interface OpenTextFileResult {
  text: string;
  name: string;
  path: string | null;
}

export interface OpenBinaryFileOptions {
  title: string;
  extensions: string[];
  mimeTypes?: string[];
}

export interface OpenBinaryFileResult {
  bytes: Uint8Array;
  name: string;
  path: string | null;
  mimeType: string;
}

export interface SaveFileResult {
  name: string;
  path: string | null;
}

export interface SaveTextFileOptions {
  title: string;
  contents: string;
  suggestedName: string;
  path?: string | null;
  extensions: string[];
}

export interface SaveBinaryFileOptions {
  title: string;
  bytes: Uint8Array;
  suggestedName: string;
  path?: string | null;
  extensions: string[];
  mimeType: string;
}

export interface FileService {
  surface: RuntimeSurface;
  supportsNativeDialogs: boolean;
  openTextFile(options: OpenTextFileOptions): Promise<OpenTextFileResult | null>;
  openBinaryFile(options: OpenBinaryFileOptions): Promise<OpenBinaryFileResult | null>;
  saveTextFile(options: SaveTextFileOptions): Promise<SaveFileResult | null>;
  saveBinaryFile(options: SaveBinaryFileOptions): Promise<SaveFileResult | null>;
}

export function filenameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function ensureExtension(filename: string, extension: string): string {
  const normalized = extension.startsWith('.') ? extension : `.${extension}`;
  return filename.toLowerCase().endsWith(normalized.toLowerCase())
    ? filename
    : `${filename}${normalized}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function openBrowserTextFile(options: OpenTextFileOptions): Promise<OpenTextFileResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = options.extensions.map((extension) => `.${extension}`).join(',');
    input.style.display = 'none';
    document.body.append(input);

    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0] ?? null;
        input.remove();
        if (!file) {
          resolve(null);
          return;
        }
        file
          .text()
          .then((text) => resolve({ text, name: file.name, path: null }))
          .catch(() => resolve(null));
      },
      { once: true }
    );

    // Dismissing the picker fires `cancel`, never `change`, so without this the
    // promise never settles: callers that showed a "reading…" state stayed in it
    // forever, and the detached input leaked. Supported in every browser we
    // target; where it is not, the old behaviour is what remains.
    input.addEventListener(
      'cancel',
      () => {
        input.remove();
        resolve(null);
      },
      { once: true }
    );

    input.click();
  });
}

function openBrowserBinaryFile(
  options: OpenBinaryFileOptions
): Promise<OpenBinaryFileResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    const extensionAccept = options.extensions.map((extension) => `.${extension}`);
    input.accept = [...extensionAccept, ...(options.mimeTypes ?? [])].join(',');
    input.style.display = 'none';
    document.body.append(input);

    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0] ?? null;
        input.remove();
        if (!file) {
          resolve(null);
          return;
        }
        file
          .arrayBuffer()
          .then((buffer) =>
            resolve({
              bytes: new Uint8Array(buffer),
              name: file.name,
              path: null,
              mimeType: file.type || 'application/octet-stream',
            })
          )
          .catch(() => resolve(null));
      },
      { once: true }
    );

    // Dismissing the picker fires `cancel`, never `change`, so without this the
    // promise never settles: callers that showed a "reading…" state stayed in it
    // forever, and the detached input leaked. Supported in every browser we
    // target; where it is not, the old behaviour is what remains.
    input.addEventListener(
      'cancel',
      () => {
        input.remove();
        resolve(null);
      },
      { once: true }
    );

    input.click();
  });
}

class BrowserFileService implements FileService {
  readonly surface = 'web' as const;
  readonly supportsNativeDialogs = false;

  async openTextFile(options: OpenTextFileOptions): Promise<OpenTextFileResult | null> {
    return openBrowserTextFile(options);
  }

  async openBinaryFile(options: OpenBinaryFileOptions): Promise<OpenBinaryFileResult | null> {
    return openBrowserBinaryFile(options);
  }

  async saveTextFile(options: SaveTextFileOptions): Promise<SaveFileResult | null> {
    const name = ensureExtension(options.suggestedName, options.extensions[0] ?? 'txt');
    downloadBlob(new Blob([options.contents], { type: 'text/plain;charset=utf-8' }), name);
    return { name, path: null };
  }

  async saveBinaryFile(options: SaveBinaryFileOptions): Promise<SaveFileResult | null> {
    const name = ensureExtension(options.suggestedName, options.extensions[0] ?? 'bin');
    const bytes = new Uint8Array(options.bytes);
    downloadBlob(new Blob([bytes.buffer], { type: options.mimeType }), name);
    return { name, path: null };
  }
}

class TauriFileService implements FileService {
  readonly surface = 'desktop' as const;
  readonly supportsNativeDialogs = true;

  async openTextFile(options: OpenTextFileOptions): Promise<OpenTextFileResult | null> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      title: options.title,
      multiple: false,
      filters: [{ name: 'Ori Studio', extensions: options.extensions }],
    });
    if (typeof selected !== 'string') return null;
    const text = await invoke<string>('read_text_file', { path: selected });
    return { text, name: filenameFromPath(selected), path: selected };
  }

  async openBinaryFile(options: OpenBinaryFileOptions): Promise<OpenBinaryFileResult | null> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      title: options.title,
      multiple: false,
      filters: [{ name: 'Image', extensions: options.extensions }],
    });
    if (typeof selected !== 'string') return null;
    const bytes = await invoke<number[]>('read_binary_file', { path: selected });
    return {
      bytes: new Uint8Array(bytes),
      name: filenameFromPath(selected),
      path: selected,
      mimeType: mimeTypeFromFilename(selected),
    };
  }

  async saveTextFile(options: SaveTextFileOptions): Promise<SaveFileResult | null> {
    const path =
      options.path ??
      (await this.chooseSavePath(options.title, options.suggestedName, options.extensions));
    if (!path) return null;
    await invoke('write_text_file', { path, contents: options.contents });
    return { name: filenameFromPath(path), path };
  }

  async saveBinaryFile(options: SaveBinaryFileOptions): Promise<SaveFileResult | null> {
    const path =
      options.path ??
      (await this.chooseSavePath(options.title, options.suggestedName, options.extensions));
    if (!path) return null;
    await invoke('write_binary_file', { path, bytes: Array.from(options.bytes) });
    return { name: filenameFromPath(path), path };
  }

  private async chooseSavePath(
    title: string,
    suggestedName: string,
    extensions: string[]
  ): Promise<string | null> {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const selected = await save({
      title,
      defaultPath: suggestedName,
      filters: [{ name: 'Ori Studio', extensions }],
    });
    return selected || null;
  }
}

function mimeTypeFromFilename(filename: string): string {
  if (/\.png$/i.test(filename)) return 'image/png';
  if (/\.jpe?g$/i.test(filename)) return 'image/jpeg';
  if (/\.webp$/i.test(filename)) return 'image/webp';
  return 'application/octet-stream';
}

/**
 * Emit `file exported { format }` whenever a save actually writes a file. The
 * format is the primary extension — never the filename or path. `osf` is a
 * project save, recorded separately as `project saved`, so it's excluded here.
 * A null result means the user cancelled the picker; nothing is emitted.
 */
function withExportTracking(service: FileService): FileService {
  const trackExport = (extensions: string[], result: SaveFileResult | null): void => {
    if (!result) return;
    const format = extensions[0];
    if (!format || format === 'osf') return;
    track('file exported', { format });
  };
  // Delegate every member explicitly: `service` is a class instance, so its
  // methods live on the prototype and a spread (`...service`) would drop them.
  return {
    surface: service.surface,
    supportsNativeDialogs: service.supportsNativeDialogs,
    openTextFile: (options) => service.openTextFile(options),
    openBinaryFile: (options) => service.openBinaryFile(options),
    async saveTextFile(options) {
      const result = await service.saveTextFile(options);
      trackExport(options.extensions, result);
      return result;
    },
    async saveBinaryFile(options) {
      const result = await service.saveBinaryFile(options);
      trackExport(options.extensions, result);
      return result;
    },
  };
}

export function createFileService(surface: RuntimeSurface): FileService {
  return withExportTracking(
    surface === 'desktop' ? new TauriFileService() : new BrowserFileService()
  );
}

/**
 * A {@link FileService} that resolves to one already-in-hand `File` instead of
 * opening a picker — how a dropped file reaches `openProject` and
 * `importAddCreasePattern` without either needing a drag-and-drop code path.
 *
 * The path is always null: a webview drop hands over the bytes but not the
 * file's location, on desktop as much as on web. So a document opened this way
 * has no overwrite target, and its first save falls through to a save dialog
 * pre-filled with the dropped filename. Saves themselves are ordinary — they
 * delegate to the surface's real service.
 */
export function createDroppedFileService(file: File): FileService {
  const base = getFileService();
  return {
    surface: base.surface,
    supportsNativeDialogs: base.supportsNativeDialogs,
    async openTextFile(): Promise<OpenTextFileResult | null> {
      return { text: await file.text(), name: file.name, path: null };
    },
    async openBinaryFile(): Promise<OpenBinaryFileResult | null> {
      return {
        bytes: new Uint8Array(await file.arrayBuffer()),
        name: file.name,
        path: null,
        mimeType: file.type || mimeTypeFromFilename(file.name),
      };
    },
    saveTextFile: (options) => base.saveTextFile(options),
    saveBinaryFile: (options) => base.saveBinaryFile(options),
  };
}

export function createOpenedPathFileService(path: string): FileService {
  const desktopService = createFileService('desktop');
  return {
    surface: desktopService.surface,
    supportsNativeDialogs: desktopService.supportsNativeDialogs,
    async openTextFile(): Promise<OpenTextFileResult | null> {
      const text = await invoke<string>('read_text_file', { path });
      return { text, name: filenameFromPath(path), path };
    },
    async openBinaryFile(): Promise<OpenBinaryFileResult | null> {
      const bytes = await invoke<number[]>('read_binary_file', { path });
      return {
        bytes: new Uint8Array(bytes),
        name: filenameFromPath(path),
        path,
        mimeType: mimeTypeFromFilename(path),
      };
    },
    saveTextFile: (options) => desktopService.saveTextFile(options),
    saveBinaryFile: (options) => desktopService.saveBinaryFile(options),
  };
}

export function getFileService(): FileService {
  return createFileService(getRuntimeSurface());
}
