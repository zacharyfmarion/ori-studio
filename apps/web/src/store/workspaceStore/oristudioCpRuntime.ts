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
import type { ImportedCreasePatternFormat } from '../../lib/creasePatternImport';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import type { OristudioCpWorkerApi } from '../../workers/oristudioCpWorker';

export type OristudioCpClient = Remote<OristudioCpWorkerApi>;

let worker: Worker | null = null;
let client: OristudioCpClient | null = null;
let handle: number | null = null;
let descriptorsPromise: Promise<OristudioCpOperationDescriptor[]> | null = null;
let currentSource: OristudioCpDocumentState['source'] | null = null;

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
  }
): Promise<OristudioCpDocumentState> {
  const api = await getOristudioCpClient();
  const nextHandle =
    source.format === 'cp'
      ? await api.loadCp(text, source.title ?? titleFromFilename(source.filename))
      : await api.loadFold(text, source.title ?? titleFromFilename(source.filename));

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

export async function refreshOristudioCpDocument(
  lastCommandResult: OristudioCpCommandResult | null = null
): Promise<OristudioCpDocumentState | null> {
  if (handle === null) return null;
  const api = await getOristudioCpClient();
  const document = await api.snapshot(handle);
  const summary = await api.summary(handle);
  const operationDescriptors = await getOristudioCpOperationDescriptors();
  return {
    handle,
    document,
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
  model?: OristudioCpFoldedFigureModel
): Promise<OristudioCpFoldedFigureResult> {
  if (handle === null) {
    throw new Error('No editable crease-pattern document is loaded');
  }
  const api = await getOristudioCpClient();
  return api.foldFigure(handle, startingFaceId, order, model);
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
  return api.exportFold(handle);
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
  const [document, summary, operationDescriptors] = await Promise.all([
    api.snapshot(documentHandle),
    api.summary(documentHandle),
    getOristudioCpOperationDescriptors(),
  ]);
  return {
    handle: documentHandle,
    document,
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
  return filename.replace(/\.(cp|fold|osf)$/i, '') || 'Untitled';
}

export type { OristudioCpDocumentSnapshot, OristudioCpDocumentSummary };
