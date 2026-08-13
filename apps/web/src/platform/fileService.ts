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

export interface SaveProjectFileOptions {
  title: string;
  /**
   * The file's contents, produced only once a target is settled.
   *
   * A thunk rather than a string because the target has to be chosen first.
   * Serializing a whole workspace means wasm exports, base64 images, and a large
   * stringify — on a big project that outruns the ~5s of transient activation a
   * browser save picker needs, and the picker is then refused. It also means a
   * cancelled dialog no longer costs a full serialize, on either surface.
   */
  contents: () => Promise<string>;
  suggestedName: string;
  path?: string | null;
  extensions: string[];
}

export interface FileService {
  surface: RuntimeSurface;
  supportsNativeDialogs: boolean;
  openTextFile(options: OpenTextFileOptions): Promise<OpenTextFileResult | null>;
  openBinaryFile(options: OpenBinaryFileOptions): Promise<OpenBinaryFileResult | null>;
  /**
   * Write the project's own save — the one whose success clears `dirty`.
   *
   * Separate from {@link FileService.saveTextFile} because the two need
   * different things from the surface. A project save has to report a
   * cancellation truthfully, which on the web means a save picker rather than a
   * download; an export is a copy going out the door, where a download is both
   * unambiguous and the friendlier behavior.
   */
  saveProjectFile(options: SaveProjectFileOptions): Promise<SaveFileResult | null>;
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

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}

type SaveFilePicker = (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;

function saveFilePicker(): SaveFilePicker | null {
  if (typeof window === 'undefined') return null;
  const picker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  return typeof picker === 'function' ? picker.bind(window) : null;
}

/**
 * What asking the browser for a save location turned into.
 *
 * `cancelled` and `unavailable` both end with no file picked, but only the
 * second may fall through to a download: the user having said no is an answer,
 * and re-asking as a download would ignore it.
 */
type SaveTargetOutcome =
  | { status: 'picked'; handle: FileSystemFileHandle }
  | { status: 'cancelled' }
  | { status: 'unavailable' };

/** The rejections that mean the user refused, rather than the API being unusable. */
function isUserRefusal(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'AbortError' || name === 'NotAllowedError';
}

/**
 * Ask for a save location through the File System Access API, the only browser
 * save that reports whether it happened.
 *
 * `<a download>` cannot: the click returns the same way whether the file is
 * written, queued behind a "where do you want to save this?" prompt, or
 * dismissed at that prompt. A project save reads a returned
 * {@link SaveFileResult} as "the write happened" and clears `dirty` — so a
 * cancelled download used to mark the project clean and take the close-tab
 * warning with it.
 *
 * Unavailable covers more than an old browser: no `showSaveFilePicker` at all
 * (Firefox, Safari, Chrome on Android), an insecure context or cross-origin
 * frame, and a `suggestedName` the picker rejects. Those keep the download,
 * where a cancel stays undetectable because nothing can detect it.
 */
async function pickSaveTarget(
  suggestedName: string,
  extensions: string[]
): Promise<SaveTargetOutcome> {
  const picker = saveFilePicker();
  if (!picker) return { status: 'unavailable' };

  try {
    const handle = await picker({
      suggestedName,
      types:
        extensions.length > 0
          ? [
              {
                description: 'Ori Studio',
                accept: { 'text/plain': extensions.map((extension) => `.${extension}`) },
              },
            ]
          : undefined,
    });
    return { status: 'picked', handle };
  } catch (error) {
    return isUserRefusal(error) ? { status: 'cancelled' } : { status: 'unavailable' };
  }
}

/**
 * Write to a picked file, leaving it untouched if the write fails.
 *
 * `createWritable` stages into a swap file, so aborting before close is what
 * keeps a failed save from truncating the file the user chose.
 *
 * Returns false when the user denied the write permission prompt — still an
 * answer, not a failure. Anything else throws: a save that genuinely failed has
 * to surface as an error rather than turn into a download nobody asked for.
 */
async function writePickedFile(handle: FileSystemFileHandle, blob: Blob): Promise<boolean> {
  let writable: FileSystemWritableFileStream;
  try {
    writable = await handle.createWritable();
  } catch (error) {
    if (isUserRefusal(error)) return false;
    throw error;
  }

  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
  return true;
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

  async saveProjectFile(options: SaveProjectFileOptions): Promise<SaveFileResult | null> {
    const name = ensureExtension(options.suggestedName, options.extensions[0] ?? 'osf');
    const target = await pickSaveTarget(name, options.extensions);
    if (target.status === 'cancelled') return null;

    const blob = new Blob([await options.contents()], { type: 'text/plain;charset=utf-8' });
    if (target.status === 'unavailable') {
      downloadBlob(blob, name);
      return { name, path: null };
    }
    if (!(await writePickedFile(target.handle, blob))) return null;
    // The name the file was written under, which the picker lets the user change.
    return { name: target.handle.name, path: null };
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

  async saveProjectFile(options: SaveProjectFileOptions): Promise<SaveFileResult | null> {
    const path =
      options.path ??
      (await this.chooseSavePath(options.title, options.suggestedName, options.extensions));
    if (!path) return null;
    await invoke('write_text_file', { path, contents: await options.contents() });
    return { name: filenameFromPath(path), path };
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
    async saveProjectFile(options) {
      const result = await service.saveProjectFile(options);
      trackExport(options.extensions, result);
      return result;
    },
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
    saveProjectFile: (options) => base.saveProjectFile(options),
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
    saveProjectFile: (options) => desktopService.saveProjectFile(options),
    saveTextFile: (options) => desktopService.saveTextFile(options),
    saveBinaryFile: (options) => desktopService.saveBinaryFile(options),
  };
}

export function getFileService(): FileService {
  return createFileService(getRuntimeSurface());
}
