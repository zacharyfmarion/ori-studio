import { connectEngine, isEngineConnected } from '../../engines/engineHost';
import { FOLD_RUN_NONE } from './foldCancellation';
import type { Remote } from 'comlink';
import type { FlatText } from '../../cp-workspace/annotations/annotation';
import type {
  OristudioCpCommandPayload,
  OristudioCpCommandPreview,
  OristudioCpCommandResult,
  OristudioCpDocumentSnapshot,
  OristudioCpDocumentState,
  OristudioCpDocumentSummary,
  OristudioCpEstimationOrder,
  OristudioCpFold3dFoldResult,
  OristudioCpFold3dStepResult,
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
import { orieditaDocumentTitle } from '../../lib/orieditaDocumentTitle';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import type { OristudioCpWorkerApi } from '../../workers/oristudioCpWorker';
import type { SendToEditCircle } from '../../designKinds/types';

export type OristudioCpClient = Remote<OristudioCpWorkerApi>;

// Worker + comlink client are owned by `engines/engineHost`.
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

/**
 * `session::FOLD_CANCELLED_CODE`. Every fold error path in the kernel converts a
 * cancel to this code, and `EngineError` crosses both bridges verbatim, so it is
 * the same string on web and on desktop.
 */
const FOLD_CANCELLED = 'fold_cancelled';

/**
 * Whether a rejected fold was stopped by the user rather than failing.
 *
 * The mirror of `isOptimizerCancellation`, and the one place that spells the
 * code — every catch on the fold path asks this rather than matching the string
 * itself, so a stop cannot become an error toast in whichever branch forgot.
 */
export function isFoldCancellation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === FOLD_CANCELLED
  );
}

export async function getOristudioCpClient(): Promise<OristudioCpClient> {
  return connectEngine('oristudio-cp');
}

export async function getOristudioCpOperationDescriptors(): Promise<
  OristudioCpOperationDescriptor[]
> {
  const api = await getOristudioCpClient();
  descriptorsPromise ??= api.operationDescriptors();
  return descriptorsPromise;
}

export async function releaseOristudioCpDocument(): Promise<void> {
  // Not connected means there is nothing to free — no engine was ever spawned,
  // or it died and took its handles with it.
  if (!isEngineConnected('oristudio-cp') || handle === null) {
    handle = null;
    return;
  }
  const staleHandle = handle;
  handle = null;
  currentSource = null;
  const api = await getOristudioCpClient();
  await api.freeDocument(staleHandle).catch(() => undefined);
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
 * Open a share payload as the active document.
 *
 * Deliberately the same shape as {@link createBlankOristudioCpDocument} — take a
 * handle, build the document state, install it, free it on failure — because
 * from Edit's point of view opening a link and seeding a blank canvas are the
 * same act, and the two must not drift.
 *
 * The kernel validates the payload: a truncated or corrupt link, or one from a
 * newer Ori Studio, throws a typed error carrying `share_link_invalid` or
 * `share_link_too_new` rather than producing a partial document.
 */
export async function openSharedCpPayload(
  payload: string,
  filename = 'Shared.cp'
): Promise<OristudioCpDocumentState> {
  const api = await getOristudioCpClient();
  const source = { format: 'cp' as const, filename, path: null };
  // The payload carries its own title when the sharer had one, so nothing is
  // invented here.
  const nextHandle = await api.loadShareLink(payload);

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
  // Shares `buildDocumentState` rather than assembling the same shape again. The
  // second copy is how the loaded document ended up normalized and every
  // refreshed one did not — a refresh runs after the always-on CAMV pass, so it
  // was the copy that actually reached the store.
  return buildDocumentState(api, handle, currentSource ?? null, lastCommandResult);
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
    /**
     * Packing circles to bring along, in `text`'s own coordinate space with
     * `circleSourceBounds` describing that space. Placed on the *imported*
     * document, so the merge's shift carries them with the creases they
     * annotate rather than leaving them behind at the origin.
     */
    circles?: readonly SendToEditCircle[];
    circleSourceBounds?: readonly [number, number, number, number];
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
    if (source.circles?.length && source.circleSourceBounds) {
      await api.placeCircles(importedHandle, source.circleSourceBounds, source.circles);
    }
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

/**
 * Every wrapper below that runs a layer-ordering search takes a `runId` — the id
 * a Stop would name (see `foldCancellation.ts`). It defaults to
 * {@link FOLD_RUN_NONE}, which is inert in the kernel and is what an
 * unattributed call has always meant. The duplicate wrappers take none: they
 * copy a figure rather than fold one.
 */
export async function foldOristudioCpDocument(
  startingFaceId = 1,
  order: OristudioCpEstimationOrder = 'Order5',
  model?: OristudioCpFoldedFigureModel,
  selectedLineIds: number[] = [],
  runId: number = FOLD_RUN_NONE
): Promise<OristudioCpFoldedFigureResult> {
  if (handle === null) {
    throw new Error('No editable crease-pattern document is loaded');
  }
  const api = await getOristudioCpClient();
  return api.foldFigure(handle, startingFaceId, order, model, selectedLineIds, runId);
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
  foldedFigureHandle: number,
  runId: number = FOLD_RUN_NONE
): Promise<OristudioCpFoldedFigureSnapshot> {
  const api = await getOristudioCpClient();
  return api.foldFigureAnother(foldedFigureHandle, runId);
}

export async function foldOristudioCpFigureToCase(
  foldedFigureHandle: number,
  objective: number,
  initialOrder: OristudioCpEstimationOrder = 'Order5',
  runId: number = FOLD_RUN_NONE
): Promise<OristudioCpFoldedFigureBatchResult> {
  const api = await getOristudioCpClient();
  return api.foldFigureToCase(foldedFigureHandle, objective, initialOrder, runId);
}

/**
 * Fold the selected creases in 3D.
 *
 * Shaped exactly like {@link foldOristudioCpDocument} so the slice layer stays
 * symmetric, with one deliberate difference: the selection is **required**. The
 * flat command widens an empty selection to the whole document; the 3D one has
 * a whole-document fold as its blast radius and may refuse for reasons the user
 * cannot connect to what they selected, so an empty selection is a caller error
 * there.
 *
 * Resolves — never rejects — when the crease pattern has no 3D folded state;
 * see {@link OristudioCpFold3dFoldResult}.
 */
export async function fold3dOristudioCpDocument(
  selectedLineIds: number[],
  startingFaceId = 1,
  model?: OristudioCpFoldedFigureModel,
  runId: number = FOLD_RUN_NONE
): Promise<OristudioCpFold3dFoldResult> {
  if (handle === null) {
    throw new Error('No editable crease-pattern document is loaded');
  }
  const api = await getOristudioCpClient();
  return api.fold3d(handle, selectedLineIds, startingFaceId, model, runId);
}

export async function fold3dOristudioCpFigureAnother(
  foldedFigureHandle: number,
  runId: number = FOLD_RUN_NONE
): Promise<OristudioCpFold3dStepResult> {
  const api = await getOristudioCpClient();
  return api.fold3dAnother(foldedFigureHandle, runId);
}

export async function duplicateOristudioCp3dFoldedFigure(
  foldedFigureHandle: number
): Promise<OristudioCpFold3dFoldResult> {
  const api = await getOristudioCpClient();
  return api.duplicateFolded3dFigure(foldedFigureHandle);
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

/**
 * `foldedHandles` names the 3D folded figures to write as `foldedForm` frames.
 * Empty is the ordinary case and means "the pattern only" — see
 * `cp-workspace/folded/foldedFigureInterchange.ts` for which figures qualify.
 */
export async function exportOristudioCpDocumentAsFold(
  texts: FlatText[] = [],
  foldedHandles: readonly number[] = []
): Promise<string> {
  if (handle === null) {
    throw new Error('No editable crease-pattern document is loaded');
  }
  const api = await getOristudioCpClient();
  return api.exportFoldFile(handle, texts, [...foldedHandles]);
}

export async function exportOristudioCpDocumentAsOri(texts: FlatText[] = []): Promise<string> {
  if (handle === null) {
    throw new Error('No editable crease-pattern document is loaded');
  }
  const api = await getOristudioCpClient();
  return api.exportOri(handle, texts);
}

export async function exportOristudioCpDocumentAsOrh(texts: FlatText[] = []): Promise<string> {
  if (handle === null) {
    throw new Error('No editable crease-pattern document is loaded');
  }
  const api = await getOristudioCpClient();
  return api.exportOrh(handle, texts);
}

/**
 * Serialize a standalone FOLD frame (e.g. one extracted crease-pattern segment)
 * to a kernel-owned text format, reusing the same serializers as the active
 * document. The frame is loaded into a scratch kernel handle that is independent
 * of the active document's handle — so this never disturbs the editor — and freed
 * in `finally` on every path, including serializer failure.
 */
export async function exportFoldFrameAsFormat(
  foldJson: string,
  format: 'cp' | 'fold' | 'ori' | 'orh'
): Promise<string> {
  const api = await getOristudioCpClient();
  const scratch = await api.loadFold(foldJson);
  try {
    switch (format) {
      case 'cp':
        return await api.exportCp(scratch);
      case 'fold':
        return await api.exportFoldFile(scratch);
      case 'ori':
        return await api.exportOri(scratch);
      case 'orh':
        return await api.exportOrh(scratch);
    }
  } finally {
    await api.freeDocument(scratch).catch(() => undefined);
  }
}

/**
 * Encode a standalone FOLD frame (one extracted crease-pattern segment) as a
 * base64url share payload, using a scratch kernel handle so the active document
 * is never disturbed. Freed in `finally` on every path.
 *
 * The kernel verifies its own output before returning — it decodes the payload
 * with the shipped decoder and compares the creases and foldability diagnostics
 * — so a string from here always reloads to the same crease pattern.
 */
export async function shareFoldFrameAsLink(foldJson: string): Promise<string> {
  const api = await getOristudioCpClient();
  const scratch = await api.loadFold(foldJson);
  try {
    return await api.exportShareLink(scratch);
  } finally {
    await api.freeDocument(scratch).catch(() => undefined);
  }
}

/**
 * Empty the kernel document's text elements. Rich text lives web-side, so after
 * a loaded file's kernel texts are inflated into annotations the kernel copy is
 * cleared — otherwise a later re-snapshot would carry them back and they would
 * be double-counted on `.osf` save (once as kernel texts, once as annotations).
 */
export async function clearOristudioCpKernelTexts(): Promise<void> {
  if (handle === null) return;
  const api = await getOristudioCpClient();
  await api.setTexts(handle, []);
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

/**
 * The single constructor for a CP document state, for both loads and refreshes.
 *
 * `source` may be null, which asks for the fallback derived from the document
 * itself — only `refreshOristudioCpDocument` needs that, and only when nothing
 * has recorded where the document came from.
 */
async function buildDocumentState(
  api: OristudioCpClient,
  documentHandle: number,
  source: OristudioCpDocumentState['source'] | null,
  lastCommandResult: OristudioCpCommandResult | null
): Promise<OristudioCpDocumentState> {
  const [{ document, geometry }, summary, operationDescriptors] = await Promise.all([
    fetchDocumentAndGeometry(api, documentHandle),
    api.summary(documentHandle),
    getOristudioCpOperationDescriptors(),
  ]);
  // The one place a kernel summary becomes app state, so the one place to drop
  // Oriedita's "no title" placeholder. Every read site downstream already ends in
  // `|| <filename>`; they just could not tell that `"_"` means empty, and so put
  // it in the title bar and in export filenames verbatim. `document` below keeps
  // the raw value, which is what saving round-trips.
  const title = orieditaDocumentTitle(summary.title);
  return {
    handle: documentHandle,
    loadSerial: documentLoadSerial,
    document,
    geometry,
    summary: { ...summary, title },
    source: source
      ? {
          format: source.format,
          filename: source.filename,
          path: source.path ?? null,
        }
      : ({
          format: 'cp',
          filename: title ? `${title}.cp` : 'Untitled.cp',
          path: null,
        } satisfies OristudioCpDocumentState['source']),
    operationDescriptors,
    lastCommandResult,
  };
}

function titleFromFilename(filename: string): string {
  return filename.replace(/\.(cp|fold|ori|orh|osf)$/i, '') || 'Untitled';
}

export type { OristudioCpDocumentSnapshot, OristudioCpDocumentSummary };
