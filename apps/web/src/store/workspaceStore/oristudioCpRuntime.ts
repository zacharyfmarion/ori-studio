import { wrap, type Remote } from 'comlink';
import type {
  OristudioCpCommandPayload,
  OristudioCpCommandPreview,
  OristudioCpCommandResult,
  OristudioCpDocumentSnapshot,
  OristudioCpDocumentState,
  OristudioCpDocumentSummary,
  OristudioCpEstimationOrder,
  OristudioCpFoldedFigureBatchResult,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedFigureRenderOptions,
  OristudioCpFoldedFigureResult,
  OristudioCpFoldedRenderSnapshot,
  OristudioCpFoldedFigureSnapshot,
  OristudioCpLineSegment,
  OristudioCpOperationDescriptor,
} from '../../engine/oristudioCpTypes';
import type { WasmErrorEnvelope } from '../../engine/types';
import {
  decodeCpGeometryToSnapshot,
  type CpGeometryTransport,
} from '../../engine/oristudioCpGeometry';
import type { ImportedCreasePatternFormat } from '../../lib/creasePatternImport';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import type { OristudioCpWorkerApi } from '../../workers/oristudioCpWorker';
import { createOristudioCpNativeClient } from '../../engine/oristudioCpNativeClient';
import { isDesktopRuntime } from '../../platform/runtime';

export type OristudioCpClient = Remote<OristudioCpWorkerApi>;

let worker: Worker | null = null;
let client: OristudioCpClient | null = null;
let handle: number | null = null;
let descriptorsPromise: Promise<OristudioCpOperationDescriptor[]> | null = null;
let currentSource: OristudioCpDocumentState['source'] | null = null;
// Monotonic identifier for a genuine document load (open/new/import/native/
// generate-from-tree). It advances only when a fresh kernel handle is
// allocated, never for edits, undo/redo, or in-place restores. The CP panel
// keys its auto-fit on this so restoring history does not read as "a new
// document was opened" and reset the viewport.
let documentLoadSerial = 0;

export function oristudioCpError(error: unknown): WasmErrorEnvelope {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return error as WasmErrorEnvelope;
  }
  return {
    code: 'oristudio_cp',
    message: error instanceof Error ? error.message : String(error),
  };
}

export async function getOristudioCpClient(): Promise<OristudioCpClient> {
  if (client) return client;
  if (isDesktopRuntime()) {
    // Desktop: native Rust engine via Tauri commands (no wasm worker). The
    // native client implements the same OristudioCpWorkerApi surface.
    client = createOristudioCpNativeClient() as unknown as OristudioCpClient;
    return client;
  }
  worker = new Worker(new URL('../../workers/oristudioCpWorker.ts', import.meta.url), {
    type: 'module',
  });
  client = wrap<OristudioCpWorkerApi>(worker);
  return client;
}

export async function getOristudioCpOperationDescriptors(): Promise<
  OristudioCpOperationDescriptor[]
> {
  const api = await getOristudioCpClient();
  descriptorsPromise ??= api.operationDescriptors();
  return descriptorsPromise;
}

export async function releaseOristudioCpDocument(): Promise<void> {
  if (!client || handle === null) {
    handle = null;
    return;
  }
  const staleHandle = handle;
  handle = null;
  currentSource = null;
  await client.freeDocument(staleHandle).catch(() => undefined);
}

export async function loadOristudioCpDocumentFromText(
  text: string,
  source: {
    format: ImportedCreasePatternFormat;
    filename: string;
    path?: string | null;
    title?: string;
    acceptUnknownVersion?: boolean;
  }
): Promise<OristudioCpDocumentState> {
  const api = await getOristudioCpClient();
  const nextHandle =
    source.format === 'cp'
      ? await api.loadCp(text, source.title ?? titleFromFilename(source.filename))
      : source.format === 'ori'
        ? await api.loadOri(text, source.acceptUnknownVersion ?? false)
        : source.format === 'orh'
          ? await api.loadOrh(text)
          : await api.loadFoldFile(text);

  documentLoadSerial += 1;
  try {
    const nextSource = {
      format: source.format,
      filename: source.filename,
      path: source.path ?? null,
    };
    const nextState = await buildDocumentState(api, nextHandle, nextSource, null);
    await replaceHandle(api, nextHandle);
    currentSource = nextSource;
    return nextState;
  } catch (error) {
    await api.freeDocument(nextHandle).catch(() => undefined);
    throw error;
  }
}

export async function createBlankOristudioCpDocument(
  title = 'Untitled CP',
  filename = 'Untitled.cp'
): Promise<OristudioCpDocumentState> {
  const api = await getOristudioCpClient();
  const source = {
    format: 'cp' as const,
    filename,
    path: null,
  };
  const nextHandle = await api.loadDocument({
    ...createStarterOristudioCpDocument(title),
  });

  documentLoadSerial += 1;
  try {
    const nextState = await buildDocumentState(api, nextHandle, source, null);
    await replaceHandle(api, nextHandle);
    currentSource = source;
    return nextState;
  } catch (error) {
    await api.freeDocument(nextHandle).catch(() => undefined);
    throw error;
  }
}

/**
 * Fetch the document for a handle via the compact geometry transport: fetch **only**
 * the compact geometry (transferable typed arrays) and build the structured snapshot
 * from it on the main thread via `decodeCpGeometryToSnapshot`, skipping the worker's
 * `document_snapshot` (its serde object-graph build + structured clone, ~140ms on a
 * dense document vs ~4ms here). The parity gate proves the decoded snapshot is
 * identical to `document_snapshot`, so every consumer, undo, and save/export are
 * unaffected. Save/export operate on the kernel handle directly, so they never need
 * `document_snapshot` either.
 */
async function fetchDocumentAndGeometry(
  api: OristudioCpClient,
  targetHandle: number
): Promise<{ document: OristudioCpDocumentSnapshot; geometry: CpGeometryTransport }> {
  const geometry = await api.documentGeometry(targetHandle);
  return { document: decodeCpGeometryToSnapshot(geometry), geometry };
}

export async function refreshOristudioCpDocument(
  lastCommandResult: OristudioCpCommandResult | null = null
): Promise<OristudioCpDocumentState | null> {
  if (handle === null) return null;
  const api = await getOristudioCpClient();
  const { document, geometry } = await fetchDocumentAndGeometry(api, handle);
  const summary = await api.summary(handle);
  const operationDescriptors = await getOristudioCpOperationDescriptors();
  return {
    handle,
    loadSerial: documentLoadSerial,
    document,
    geometry,
    summary,
    source:
      currentSource ??
      ({
        format: 'cp',
        filename: document.title ? `${document.title}.cp` : 'Untitled.cp',
        path: null,
      } satisfies OristudioCpDocumentState['source']),
    operationDescriptors,
    lastCommandResult,
  };
}

export async function restoreOristudioCpDocument(
  document: OristudioCpDocumentSnapshot,
  source: OristudioCpDocumentState['source'],
  lastCommandResult: OristudioCpCommandResult | null = null
): Promise<OristudioCpDocumentState> {
  const api = await getOristudioCpClient();
  const nextHandle = await api.loadDocument(document);

  documentLoadSerial += 1;
  try {
    const nextState = await buildDocumentState(api, nextHandle, source, lastCommandResult);
    await replaceHandle(api, nextHandle);
    currentSource = nextState.source;
    return nextState;
  } catch (error) {
    await api.freeDocument(nextHandle).catch(() => undefined);
    throw error;
  }
}

/**
 * Restore a document snapshot into the current handle in place, mirroring
 * Oriedita's in-place `foldLineSet.setSave`. Used by undo/redo and
 * whole-document edits so the handle (and thus the editor viewport) is
 * preserved. The load serial is intentionally not advanced, so the CP panel
 * does not treat the restore as a new document load. Falls back to a fresh
 * handle only if no document is currently loaded.
 */
export async function restoreOristudioCpDocumentInPlace(
  document: OristudioCpDocumentSnapshot,
  source?: OristudioCpDocumentState['source'],
  lastCommandResult: OristudioCpCommandResult | null = null
): Promise<OristudioCpDocumentState> {
  if (handle === null) {
    return restoreOristudioCpDocument(
      document,
      source ??
        currentSource ?? {
          format: 'cp',
          filename: document.title ? `${document.title}.cp` : 'Untitled.cp',
          path: null,
        },
      lastCommandResult
    );
  }
  const api = await getOristudioCpClient();
  await api.restoreDocument(handle, document);
  const nextSource = source ?? currentSource ?? { format: 'cp', filename: 'Untitled.cp', path: null };
  const nextState = await buildDocumentState(api, handle, nextSource, lastCommandResult);
  currentSource = nextState.source;
  return nextState;
}

export async function executeOristudioCpCommand(
  operationId: OristudioCpOperationId,
  payload: OristudioCpCommandPayload = {}
): Promise<OristudioCpDocumentState> {
  if (handle === null) {
    throw new Error('No editable crease-pattern document is loaded');
  }
  const api = await getOristudioCpClient();
  const result = await api.executeCommand(handle, operationId, payload);
  const refreshed = await refreshOristudioCpDocument(result);
  if (!refreshed) throw new Error('Editable crease-pattern document was released');
  return refreshed;
}

/**
 * Run a non-mutating check command (e.g. `CheckCamv`) for its result only. The
 * kernel already holds the document and the check does not mutate it, so this
 * deliberately skips the full-document snapshot that `executeOristudioCpCommand`
 * performs — the caller keeps the current document state and only needs the
 * command's diagnostics. Used by the deferred always-on CAMV recompute.
 */
export async function runOristudioCpCheckCommand(
  operationId: OristudioCpOperationId,
  payload: OristudioCpCommandPayload = {}
): Promise<OristudioCpCommandResult> {
  if (handle === null) {
    throw new Error('No editable crease-pattern document is loaded');
  }
  const api = await getOristudioCpClient();
  return api.executeCommand(handle, operationId, payload);
}

export async function previewOristudioCpCommand(
  operationId: OristudioCpOperationId,
  payload: OristudioCpCommandPayload = {}
): Promise<OristudioCpCommandPreview> {
  if (handle === null) {
    throw new Error('No editable crease-pattern document is loaded');
  }
  const api = await getOristudioCpClient();
  return api.previewCommand(handle, operationId, payload);
}

export async function insertOristudioCpLineSegments(
  segments: OristudioCpLineSegment[]
): Promise<OristudioCpDocumentState> {
  if (handle === null) {
    throw new Error('No editable crease-pattern document is loaded');
  }
  const api = await getOristudioCpClient();
  await api.insertLineSegments(handle, segments);
  const refreshed = await refreshOristudioCpDocument(null);
  if (!refreshed) throw new Error('Editable crease-pattern document was released');
  return refreshed;
}

/**
 * Clear the kernel document's selection flags (a UI deselect, not an undoable
 * edit). The frontend selection mirror is cleared separately; this keeps the
 * kernel in sync so a later select/deselect doesn't re-derive a stale selection.
 */
export async function deselectAllOristudioCp(): Promise<OristudioCpDocumentState | null> {
  if (handle === null) return null;
  const api = await getOristudioCpClient();
  await api.deselectAll(handle);
  return refreshOristudioCpDocument(null);
}

/**
 * Oriedita import (add): parse `text` into a throwaway document, merge it into
 * the currently loaded crease pattern (shifted beside the existing pattern and
 * divided against it), then release the throwaway document. Mirrors Oriedita's
 * `ImportAddAction` → `setSave_for_reading_tuika` flow.
 */
export async function importAddOristudioCpDocumentFromText(
  text: string,
  source: {
    format: ImportedCreasePatternFormat;
    filename: string;
    acceptUnknownVersion?: boolean;
  }
): Promise<OristudioCpDocumentState> {
  if (handle === null) {
    throw new Error('No editable crease-pattern document is loaded');
  }
  const api = await getOristudioCpClient();
  const importedHandle =
    source.format === 'cp'
      ? await api.loadCp(text, titleFromFilename(source.filename))
      : source.format === 'ori'
        ? await api.loadOri(text, source.acceptUnknownVersion ?? false)
        : source.format === 'orh'
          ? await api.loadOrh(text)
          : await api.loadFoldFile(text);

  try {
    await api.importAdd(handle, importedHandle);
  } finally {
    await api.freeDocument(importedHandle).catch(() => undefined);
  }

  const refreshed = await refreshOristudioCpDocument(null);
  if (!refreshed) throw new Error('Editable crease-pattern document was released');
  return refreshed;
}

export async function replaceOristudioCpLineSegments(
  lineIds: number[],
  segments: OristudioCpLineSegment[]
): Promise<OristudioCpDocumentState> {
  if (handle === null) {
    throw new Error('No editable crease-pattern document is loaded');
  }
  const api = await getOristudioCpClient();
  await api.replaceLineSegments(handle, lineIds, segments);
  const refreshed = await refreshOristudioCpDocument(null);
  if (!refreshed) throw new Error('Editable crease-pattern document was released');
  return refreshed;
}

export async function foldOristudioCpDocument(
  startingFaceId = 1,
  order: OristudioCpEstimationOrder = 'Order5',
  model?: OristudioCpFoldedFigureModel,
  selectedLineIds: number[] = []
): Promise<OristudioCpFoldedFigureResult> {
  if (handle === null) {
    throw new Error('No editable crease-pattern document is loaded');
  }
  const api = await getOristudioCpClient();
  return api.foldFigure(handle, startingFaceId, order, model, selectedLineIds);
}

export async function getOristudioCpFoldedFigureSnapshot(
  foldedFigureHandle: number
): Promise<OristudioCpFoldedFigureSnapshot> {
  const api = await getOristudioCpClient();
  return api.foldedFigureSnapshot(foldedFigureHandle);
}

export async function getOristudioCpFoldedFigureRenderSnapshot(
  foldedFigureHandle: number,
  displayStyle?: OristudioCpFoldedFigureSnapshot['display_style'],
  options?: OristudioCpFoldedFigureRenderOptions
): Promise<OristudioCpFoldedRenderSnapshot | null> {
  const api = await getOristudioCpClient();
  return api.foldedFigureRenderSnapshot(foldedFigureHandle, displayStyle, options);
}

export async function setOristudioCpFoldedFigureModel(
  foldedFigureHandle: number,
  model: OristudioCpFoldedFigureModel
): Promise<OristudioCpFoldedFigureSnapshot> {
  const api = await getOristudioCpClient();
  return api.setFoldedFigureModel(foldedFigureHandle, model);
}

export async function duplicateOristudioCpFoldedFigure(
  foldedFigureHandle: number
): Promise<OristudioCpFoldedFigureResult> {
  const api = await getOristudioCpClient();
  return api.duplicateFoldedFigure(foldedFigureHandle);
}

export async function foldOristudioCpFigureAnother(
  foldedFigureHandle: number
): Promise<OristudioCpFoldedFigureSnapshot> {
  const api = await getOristudioCpClient();
  return api.foldFigureAnother(foldedFigureHandle);
}

export async function foldOristudioCpFigureToCase(
  foldedFigureHandle: number,
  objective: number,
  initialOrder: OristudioCpEstimationOrder = 'Order5'
): Promise<OristudioCpFoldedFigureBatchResult> {
  const api = await getOristudioCpClient();
  return api.foldFigureToCase(foldedFigureHandle, objective, initialOrder);
}

export async function freeOristudioCpFoldedFigure(foldedFigureHandle: number): Promise<void> {
  const api = await getOristudioCpClient();
  await api.freeFoldedFigure(foldedFigureHandle);
}

export async function exportOristudioCpDocumentAsCp(): Promise<string> {
  if (handle === null) {
    throw new Error('No editable crease-pattern document is loaded');
  }
  const api = await getOristudioCpClient();
  return api.exportCp(handle);
}

export async function exportOristudioCpDocumentAsFold(): Promise<string> {
  if (handle === null) {
    throw new Error('No editable crease-pattern document is loaded');
  }
  const api = await getOristudioCpClient();
  return api.exportFoldFile(handle);
}

export async function exportOristudioCpDocumentAsOri(): Promise<string> {
  if (handle === null) {
    throw new Error('No editable crease-pattern document is loaded');
  }
  const api = await getOristudioCpClient();
  return api.exportOri(handle);
}

export async function exportOristudioCpDocumentAsOrh(): Promise<string> {
  if (handle === null) {
    throw new Error('No editable crease-pattern document is loaded');
  }
  const api = await getOristudioCpClient();
  return api.exportOrh(handle);
}

export function setOristudioCpDocumentSource(source: OristudioCpDocumentState['source']): void {
  currentSource = source;
}

async function replaceHandle(api: OristudioCpClient, nextHandle: number) {
  if (handle !== null) {
    await api.freeDocument(handle).catch(() => undefined);
  }
  handle = nextHandle;
}

async function buildDocumentState(
  api: OristudioCpClient,
  documentHandle: number,
  source: OristudioCpDocumentState['source'],
  lastCommandResult: OristudioCpCommandResult | null
): Promise<OristudioCpDocumentState> {
  const [{ document, geometry }, summary, operationDescriptors] = await Promise.all([
    fetchDocumentAndGeometry(api, documentHandle),
    api.summary(documentHandle),
    getOristudioCpOperationDescriptors(),
  ]);
  return {
    handle: documentHandle,
    loadSerial: documentLoadSerial,
    document,
    geometry,
    summary,
    source: {
      format: source.format,
      filename: source.filename,
      path: source.path ?? null,
    },
    operationDescriptors,
    lastCommandResult,
  };
}

function titleFromFilename(filename: string): string {
  return filename.replace(/\.(cp|fold|ori|orh|osf)$/i, '') || 'Untitled';
}

export type { OristudioCpDocumentSnapshot, OristudioCpDocumentSummary };
