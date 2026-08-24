import { invoke } from '@tauri-apps/api/core';
import { track } from '../analytics';
import { surfaceSupports } from './capabilities';
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
  /**
   * Where this document is now saved, in whatever terms the platform can save to
   * it *again*: an absolute filesystem path on desktop, a
   * {@link WEB_SAVE_TARGET_PREFIX} token in the browser, or null when the save
   * produced something that cannot be written to a second time (a download).
   *
   * Passed straight back as {@link SaveTextFileOptions.path} on the next save,
   * which is what makes a repeat Save overwrite rather than duplicate. Use
   * {@link filesystemPathOrNull} before recording it anywhere durable.
   */
  path: string | null;
}

export interface SaveTextFileOptions {
  title: string;
  contents: string;
  suggestedName: string;
  path?: string | null;
  extensions: string[];
  /**
   * Whether this save establishes a target the *next* save can overwrite.
   *
   * True for saving the document (File › Save / Save As). False for exports,
   * which produce a fresh artifact each time rather than a file you keep saving
   * over. In the browser this is also what chooses a save dialog over a
   * download, so leaving it off keeps an export the one-click download it is.
   */
  reusableTarget?: boolean;
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

declare global {
  interface Window {
    /**
     * File System Access API. Chromium only — absent in Firefox and Safari, and
     * in any non-secure context, which is why every use is guarded.
     */
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: { description?: string; accept: Record<string, string[]> }[];
    }) => Promise<FileSystemFileHandle>;
    showOpenFilePicker?: (options?: {
      multiple?: boolean;
      types?: { description?: string; accept: Record<string, string[]> }[];
    }) => Promise<FileSystemFileHandle[]>;
  }
  interface FileSystemHandle {
    // Opening a file grants read only; writing back to it needs an explicit
    // upgrade, which is a prompt the user answers once per file.
    queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  }
}

/** The picker's file-type filter, from the extensions a caller accepts. */
function pickerTypes(extensions: string[]) {
  return [
    {
      description: 'Ori Studio',
      accept: { 'application/octet-stream': extensions.map((extension) => `.${extension}`) },
    },
  ];
}

/**
 * Save targets the browser can write to a second time, by the token handed back
 * as {@link SaveFileResult.path}.
 *
 * A download has no way back to the file it produced, so a browser save could
 * only ever make another copy — `project.osf`, `project (1).osf`, and so on. The
 * File System Access API does have a way back: the handle from the save dialog
 * stays writable for the life of the page, so a later Save can overwrite the file
 * the first one created.
 *
 * The token is namespaced so it can never be mistaken for a filesystem path;
 * {@link filesystemPathOrNull} is what keeps it out of saved files. The store
 * round-trips it in `currentFilePath`, which is also what invalidates it: every
 * load and every new document already writes that field, and on the web they all
 * write null, so a handle cannot outlive the document it belongs to.
 */
const WEB_SAVE_TARGET_PREFIX = 'web-save:';
const webSaveTargets = new Map<string, FileSystemFileHandle>();
let nextWebSaveTargetId = 1;

/** Remember a handle as a save target, and return the token that names it. */
function rememberWebSaveTarget(handle: FileSystemFileHandle): string {
  const token = `${WEB_SAVE_TARGET_PREFIX}${nextWebSaveTargetId++}`;
  webSaveTargets.set(token, handle);
  return token;
}

/**
 * Upgrade a handle to writable.
 *
 * A handle from the *open* dialog carries read permission only, so saving back
 * to the file the user opened needs this — a one-time prompt per file. A handle
 * from the save dialog is already writable and answers `granted` outright.
 */
async function ensureWritable(handle: FileSystemFileHandle): Promise<boolean> {
  if (!handle.queryPermission) return true;
  if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await handle.requestPermission?.({ mode: 'readwrite' })) === 'granted';
}

/**
 * The path to record *inside a saved file*: a real filesystem path, or nothing.
 *
 * A web save-target token is meaningful only to the page that minted it, so
 * writing one into a portable `.osf` would persist a reference that resolves
 * nowhere — including on the machine that wrote it, after a reload.
 */
export function filesystemPathOrNull(path: string | null): string | null {
  return path?.startsWith(WEB_SAVE_TARGET_PREFIX) ? null : path;
}

/** Test seam: drop every remembered handle. */
export function resetWebSaveTargets(): void {
  webSaveTargets.clear();
  nextWebSaveTargetId = 1;
}

/**
 * Dismissing a file dialog rejects rather than resolving. That is a cancelled
 * save, not a failure — the store already reads a null result as "cancelled".
 */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Replace the file's contents through its handle.
 *
 * `createWritable` writes to a swap file and only replaces the original on
 * `close()`, so a failure part-way through leaves the file that is already on
 * disk intact rather than truncated.
 */
async function writeWebSaveTarget(handle: FileSystemFileHandle, contents: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(contents);
  await writable.close();
}

/**
 * How a browser save found its file. Reported separately from `project saved`
 * rather than as a property of it, because the distinction exists only here —
 * the store cannot see which of the three happened, and a second `project saved`
 * would double-count every save.
 */
type WebSaveMode = 'overwrite' | 'picker' | 'download';

function trackWebSave(mode: WebSaveMode): void {
  track('project save target', { mode });
}

async function saveBrowserTextFile(
  options: SaveTextFileOptions
): Promise<SaveFileResult | null> {
  const name = ensureExtension(options.suggestedName, options.extensions[0] ?? 'txt');

  const existing = options.path ? webSaveTargets.get(options.path) : undefined;
  if (existing && options.path) {
    try {
      if (await ensureWritable(existing)) {
        await writeWebSaveTarget(existing, options.contents);
        trackWebSave('overwrite');
        return { name: existing.name, path: options.path };
      }
      // Permission refused. Asking where to put it instead is a better answer
      // than failing the save outright.
      webSaveTargets.delete(options.path);
    } catch (error) {
      if (isAbortError(error)) return null;
      // The page can lose permission on a handle (a revoked grant, a file moved
      // out from under it). Forget it and ask again rather than failing the save.
      webSaveTargets.delete(options.path);
    }
  }

  const showSaveFilePicker = options.reusableTarget ? window.showSaveFilePicker : undefined;
  if (!showSaveFilePicker) {
    // An export, or a browser with no File System Access API (Firefox, Safari).
    // A download is still a save; it just cannot be written to again, so the
    // next one makes a copy.
    downloadBlob(new Blob([options.contents], { type: 'text/plain;charset=utf-8' }), name);
    if (options.reusableTarget) trackWebSave('download');
    return { name, path: null };
  }

  let handle: FileSystemFileHandle;
  try {
    handle = await showSaveFilePicker({
      suggestedName: name,
      types: pickerTypes(options.extensions),
    });
  } catch (error) {
    if (isAbortError(error)) return null;
    throw error;
  }

  await writeWebSaveTarget(handle, options.contents);
  trackWebSave('picker');
  return { name: handle.name, path: rememberWebSaveTarget(handle) };
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

/**
 * Open a file the app can later save back to.
 *
 * The `<input type=file>` fallback below hands over the file's *contents* and
 * nothing else — no way back to the file on disk. So opening a document, editing
 * it and pressing Save had to ask where to put it, every time, even though the
 * user had just said which file they meant. The open dialog's handle is that way
 * back: it is remembered as the save target, so Save writes to the file that was
 * opened. Chromium grants it read permission only; {@link ensureWritable}
 * upgrades it at the first save.
 */
async function openBrowserTextFile(
  options: OpenTextFileOptions
): Promise<OpenTextFileResult | null> {
  const showOpenFilePicker = window.showOpenFilePicker;
  if (!showOpenFilePicker) return openBrowserTextFileInput(options);

  let handle: FileSystemFileHandle | undefined;
  try {
    [handle] = await showOpenFilePicker({
      multiple: false,
      types: pickerTypes(options.extensions),
    });
  } catch (error) {
    if (isAbortError(error)) return null;
    // Rejected for a reason other than a dismissal — a sandboxed frame, a
    // policy block. The input still opens the file; it just cannot save back.
    return openBrowserTextFileInput(options);
  }
  if (!handle) return null;

  // Deliberately *not* upgrading to write access here. Chrome's guidance is to
  // fold that request into the open, and the API gives no way to ask for it in
  // the dialog itself (`showOpenFilePicker` takes no permission mode), so the
  // request has to be a second prompt either way. Raised at open it reads as
  // nonsense — Chrome words it "Save changes to <file>?", asked of someone who
  // has just opened a file and changed nothing. {@link ensureWritable} asks at
  // the first save instead, where the question matches what is happening.
  const file = await handle.getFile();
  return { text: await file.text(), name: file.name, path: rememberWebSaveTarget(handle) };
}

function openBrowserTextFileInput(
  options: OpenTextFileOptions
): Promise<OpenTextFileResult | null> {
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
  readonly supportsNativeDialogs = false;

  constructor(readonly surface: RuntimeSurface) {}

  async openTextFile(options: OpenTextFileOptions): Promise<OpenTextFileResult | null> {
    return openBrowserTextFile(options);
  }

  async openBinaryFile(options: OpenBinaryFileOptions): Promise<OpenBinaryFileResult | null> {
    return openBrowserBinaryFile(options);
  }

  async saveTextFile(options: SaveTextFileOptions): Promise<SaveFileResult | null> {
    return saveBrowserTextFile(options);
  }

  async saveBinaryFile(options: SaveBinaryFileOptions): Promise<SaveFileResult | null> {
    // Deliberately still a download. The binary saves are all *exports* (SVG,
    // PNG, a foreign format), and an export is a new artifact each time rather
    // than a document you keep saving over.
    const name = ensureExtension(options.suggestedName, options.extensions[0] ?? 'bin');
    const bytes = new Uint8Array(options.bytes);
    downloadBlob(new Blob([bytes.buffer], { type: options.mimeType }), name);
    return { name, path: null };
  }
}

class TauriFileService implements FileService {
  readonly supportsNativeDialogs = true;

  constructor(readonly surface: RuntimeSurface) {}

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
    return {
      bytes: await readNativeBinaryFile(selected),
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
    await writeNativeBinaryFile(path, options.bytes);
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

/**
 * Read a file's bytes over the Tauri bridge.
 *
 * The bytes cross as an `application/octet-stream` body rather than as JSON.
 * They used to cross as `number[]` — `invoke` JSON-serializes a `Uint8Array`
 * nested inside an args object by way of `Array.from`, so every byte became up to
 * four characters of decimal text. Measured on this repo's fixtures that is
 * **3.6x** the payload for a PNG and 3.1x for an `.osf`, plus a `JSON.stringify`
 * of the whole thing on the way through (67 ms for 2 MiB) and a multi-megabyte
 * intermediate string on each side. This is not an iOS-specific fix; it is what
 * every desktop reference-image import has been paying.
 *
 * The `number[]` arm is kept deliberately, and mirrors `tauri-plugin-fs`'s own
 * `readFile`: the raw response arrives as an `ArrayBuffer` over the custom
 * protocol, but a host that falls back to the `postMessage` IPC still answers
 * with an array, and decoding one as the other yields silent garbage.
 */
async function readNativeBinaryFile(path: string): Promise<Uint8Array> {
  const body = await invoke<ArrayBuffer | number[]>('read_binary_file', { path });
  return body instanceof ArrayBuffer ? new Uint8Array(body) : Uint8Array.from(body);
}

/**
 * Write bytes to a file over the Tauri bridge, the mirror of
 * {@link readNativeBinaryFile}.
 *
 * The bytes are the *whole* argument — that is the only shape `invoke` sends as a
 * raw body — so the path has to travel beside them in a header, and be
 * percent-encoded to survive one. `write_binary_file` decodes it.
 */
async function writeNativeBinaryFile(path: string, bytes: Uint8Array): Promise<void> {
  await invoke('write_binary_file', bytes, { headers: { path: encodeURIComponent(path) } });
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
    surfaceSupports('nativeFileIo', surface)
      ? new TauriFileService(surface)
      : new BrowserFileService(surface)
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
  // The live surface, not a hard-coded `'desktop'`: this is only ever reached
  // from the Tauri opened-file hook, and on iOS that is the iOS shell.
  const nativeService = createFileService(getRuntimeSurface());
  return {
    surface: nativeService.surface,
    supportsNativeDialogs: nativeService.supportsNativeDialogs,
    async openTextFile(): Promise<OpenTextFileResult | null> {
      const text = await invoke<string>('read_text_file', { path });
      return { text, name: filenameFromPath(path), path };
    },
    async openBinaryFile(): Promise<OpenBinaryFileResult | null> {
      return {
        bytes: await readNativeBinaryFile(path),
        name: filenameFromPath(path),
        path,
        mimeType: mimeTypeFromFilename(path),
      };
    },
    saveTextFile: (options) => nativeService.saveTextFile(options),
    saveBinaryFile: (options) => nativeService.saveBinaryFile(options),
  };
}

export function getFileService(): FileService {
  return createFileService(getRuntimeSurface());
}
