import { proxy, wrap, type Remote } from 'comlink';
import {
  oristudioBpProjectStateFromRaw,
  type OristudioBpStateFromRawInput,
} from '../../engine/oristudioBpSnapshotMapper';
import type {
  OristudioBpDocumentState,
  OristudioBpEditingSurface,
  OristudioBpExportOptions,
  OristudioBpOptimizerEvent,
  OristudioBpOptimizerOptions,
  OristudioBpOptimizerProgress,
  OristudioBpPortDescriptor,
  OristudioBpRawProject,
  OristudioBpSelection,
  OristudioBpSheetKind,
  OristudioBpSourceRef,
  OristudioBpWorkspaceState,
  OristudioBpWasmHistoryNavigationProject,
  OristudioBpWasmOpenedProject,
  OristudioBpWasmWorkspaceProject,
} from '../../engine/oristudioBpTypes';
import type { Point } from '../../lib/geometry';
import type { WasmErrorEnvelope } from '../../engine/types';
import type { OristudioBpOptimizerWorkerApi } from '../../workers/oristudioBpOptimizerWorker';
import type { OristudioBpWorkerApi } from '../../workers/oristudioBpWorker';

export type OristudioBpClient = Remote<OristudioBpWorkerApi>;
type OristudioBpOptimizerClient = Remote<OristudioBpOptimizerWorkerApi>;

let worker: Worker | null = null;
let client: OristudioBpClient | null = null;
let optimizerWorker: Worker | null = null;
let optimizerClient: OristudioBpOptimizerClient | null = null;
let optimizerCancelRequested = false;
let activeHandle: number | null = null;
let loadedHandles = new Set<number>();
let descriptorsPromise: Promise<OristudioBpPortDescriptor[]> | null = null;
let currentSource: OristudioBpSourceRef | null = null;

export function oristudioBpError(error: unknown): WasmErrorEnvelope {
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
    code: 'oristudio_bp',
    message: error instanceof Error ? error.message : String(error),
  };
}

export async function getOristudioBpClient(): Promise<OristudioBpClient> {
  if (client) return client;
  worker = new Worker(new URL('../../workers/oristudioBpWorker.ts', import.meta.url), {
    type: 'module',
  });
  client = wrap<OristudioBpWorkerApi>(worker);
  return client;
}

export async function getOristudioBpPortDescriptors(): Promise<OristudioBpPortDescriptor[]> {
  const api = await getOristudioBpClient();
  descriptorsPromise ??= api.portDescriptors();
  return descriptorsPromise;
}

async function solveOptimizerRequestWithProgress(
  request: unknown,
  seed: number | null,
  onProgress?: (progress: OristudioBpOptimizerProgress) => void
): Promise<unknown> {
  optimizerCancelRequested = false;
  optimizerWorker?.terminate();
  optimizerWorker = new Worker(new URL('../../workers/oristudioBpOptimizerWorker.ts', import.meta.url), {
    type: 'module',
  });
  optimizerClient = wrap<OristudioBpOptimizerWorkerApi>(optimizerWorker);
  const activeWorker = optimizerWorker;
  try {
    return await optimizerClient.solveReportWithProgress(
      request,
      seed,
      proxy((event: OristudioBpOptimizerEvent) => {
        onProgress?.(optimizerProgressFromEvent(event));
      })
    );
  } catch (error) {
    if (optimizerCancelRequested) {
      throw {
        code: 'optimization_cancelled',
        message: 'Box Pleat optimization cancelled',
      } satisfies WasmErrorEnvelope;
    }
    throw error;
  } finally {
    if (optimizerWorker === activeWorker) {
      optimizerWorker.terminate();
      optimizerWorker = null;
      optimizerClient = null;
      optimizerCancelRequested = false;
    }
  }
}

export function cancelActiveOristudioBpOptimizer(): void {
  optimizerCancelRequested = true;
  optimizerWorker?.terminate();
  optimizerWorker = null;
  optimizerClient = null;
}

export async function releaseOristudioBpProject(): Promise<void> {
  if (!client || loadedHandles.size === 0) {
    activeHandle = null;
    loadedHandles = new Set();
    currentSource = null;
    return;
  }
  const staleHandles = [...loadedHandles];
  activeHandle = null;
  loadedHandles = new Set();
  currentSource = null;
  await Promise.all(staleHandles.map((staleHandle) => client?.freeProject(staleHandle).catch(() => undefined)));
}

export async function createSampleOristudioBpProject(): Promise<OristudioBpDocumentState> {
  const api = await getOristudioBpClient();
  const nextHandle = await api.newSampleProject();
  const source = {
    format: 'generated',
    filename: 'Untitled.bps',
    path: null,
  } satisfies OristudioBpSourceRef;

  try {
    const nextState = await buildProjectState(api, {
      handle: nextHandle,
      source,
      dirty: true,
    });
    await replaceHandles(api, [nextHandle], nextHandle);
    currentSource = source;
    return nextState;
  } catch (error) {
    await api.freeProject(nextHandle).catch(() => undefined);
    throw error;
  }
}

export async function loadOristudioBpProjectFromText(
  text: string,
  source: {
    filename: string;
    path?: string | null;
    format?: Extract<OristudioBpSourceRef['format'], 'bps' | 'generated'>;
    dirty?: boolean;
  }
): Promise<OristudioBpDocumentState> {
  const api = await getOristudioBpClient();
  const nextHandle = await api.loadProject(text);
  const nextSource = {
    format: source.format ?? 'bps',
    filename: source.filename,
    path: source.path ?? null,
  } satisfies OristudioBpSourceRef;

  try {
    const nextState = await buildProjectState(api, {
      handle: nextHandle,
      source: nextSource,
      dirty: source.dirty ?? false,
    });
    await replaceHandles(api, [nextHandle], nextHandle);
    currentSource = nextSource;
    return nextState;
  } catch (error) {
    await api.freeProject(nextHandle).catch(() => undefined);
    throw error;
  }
}

/**
 * Restore a BP project from a serialized snapshot (bps text) captured for undo/
 * redo. Loads it into a fresh engine handle and rebuilds the document, keeping
 * the current source (filename/path) so undo doesn't rename the project.
 */
export async function restoreOristudioBpProjectSnapshot(
  bps: string
): Promise<OristudioBpDocumentState> {
  return loadOristudioBpProjectFromText(bps, {
    filename: currentSource?.filename ?? 'Untitled.bps',
    path: currentSource?.path ?? null,
    format: currentSource?.format === 'bps' ? 'bps' : 'generated',
    dirty: true,
  });
}

export async function importTreeMakerToOristudioBpProject(
  text: string,
  source: {
    title: string;
    filename: string;
    path?: string | null;
    dirty?: boolean;
  }
): Promise<OristudioBpDocumentState> {
  const api = await getOristudioBpClient();
  const nextHandle = await api.importTreeMaker(source.title, text);
  const nextSource = {
    format: 'treemaker-import',
    filename: source.filename,
    path: source.path ?? null,
  } satisfies OristudioBpSourceRef;

  try {
    const nextState = await buildProjectState(api, {
      handle: nextHandle,
      source: nextSource,
      dirty: source.dirty ?? true,
    });
    await replaceHandles(api, [nextHandle], nextHandle);
    currentSource = nextSource;
    return nextState;
  } catch (error) {
    await api.freeProject(nextHandle).catch(() => undefined);
    throw error;
  }
}

export async function loadOristudioBpWorkspaceFromBytes(
  bytes: Uint8Array,
  source: {
    filename: string;
    path?: string | null;
    dirty?: boolean;
  }
): Promise<{ workspace: OristudioBpWorkspaceState; activeDocument: OristudioBpDocumentState | null }> {
  const api = await getOristudioBpClient();
  const loadedProjects = await api.loadWorkspace(bytes);
  const handles = loadedProjects.map((project) => project.handle);
  const workspaceSource = {
    format: 'bpz',
    filename: source.filename,
    path: source.path ?? null,
  } satisfies OristudioBpSourceRef;

  try {
    const projects = await Promise.all(
      loadedProjects.map((project) =>
        buildWorkspaceProjectState(api, project, workspaceSource, source.dirty ?? false)
      )
    );
    const firstProject = projects[0] ?? null;
    await replaceHandles(api, handles, firstProject?.handle ?? null);
    currentSource = firstProject?.source ?? workspaceSource;
    return {
      activeDocument: firstProject,
      workspace: {
        workflowTarget: 'box-pleat',
        kind: 'box-pleat-workspace',
        source: workspaceSource,
        activeProjectHandle: firstProject?.handle ?? null,
        projects,
        dirty: source.dirty ?? false,
      },
    };
  } catch (error) {
    await Promise.all(handles.map((staleHandle) => api.freeProject(staleHandle).catch(() => undefined)));
    throw error;
  }
}

export async function refreshOristudioBpProject(): Promise<OristudioBpDocumentState | null> {
  if (activeHandle === null) return null;
  const api = await getOristudioBpClient();
  return buildProjectState(api, {
    handle: activeHandle,
    source:
      currentSource ??
      ({
        format: 'generated',
        filename: 'Untitled.bps',
        path: null,
      } satisfies OristudioBpSourceRef),
  });
}

export async function moveOristudioBpTreeVertex(
  id: number,
  loc: Point,
  options: OristudioBpMutationOptions = {}
): Promise<OristudioBpDocumentState> {
  return mutateActiveOristudioBpProject(options, (api, handle) =>
    api.moveTreeVertex(handle, id, loc.x, loc.y, options.dragging ?? false)
  );
}

export async function renameOristudioBpTreeVertex(
  id: number,
  name: string,
  options: OristudioBpMutationOptions = {}
): Promise<OristudioBpDocumentState> {
  return mutateActiveOristudioBpProject(options, (api, handle) =>
    api.renameTreeVertex(handle, id, name)
  );
}

export async function updateOristudioBpTreeEdgeLength(
  vertices: [number, number],
  length: number,
  options: OristudioBpMutationOptions = {}
): Promise<OristudioBpDocumentState> {
  return mutateActiveOristudioBpProject(options, (api, handle) =>
    api.updateTreeEdgeLength(handle, vertices[0], vertices[1], length, options.dragging ?? false)
  );
}

export async function addOristudioBpTreeLeaf(
  at: number,
  length: number,
  options: OristudioBpMutationOptions = {}
): Promise<OristudioBpDocumentState> {
  return mutateActiveOristudioBpProject(options, (api, handle) =>
    api.addTreeLeaf(handle, at, length)
  );
}

export async function deleteOristudioBpTreeLeaf(
  id: number,
  options: OristudioBpMutationOptions = {}
): Promise<OristudioBpDocumentState> {
  return mutateActiveOristudioBpProject(options, (api, handle) =>
    api.deleteTreeLeaf(handle, id)
  );
}

export async function joinOristudioBpTreeVertex(
  id: number,
  options: OristudioBpMutationOptions = {}
): Promise<OristudioBpDocumentState> {
  return mutateActiveOristudioBpProject(options, (api, handle) =>
    api.joinTreeVertex(handle, id)
  );
}

export async function splitOristudioBpTreeEdge(
  vertices: [number, number],
  options: OristudioBpMutationOptions = {}
): Promise<OristudioBpDocumentState> {
  return mutateActiveOristudioBpProject(options, (api, handle) =>
    api.splitTreeEdge(handle, vertices[0], vertices[1])
  );
}

export async function mergeOristudioBpTreeEdge(
  vertices: [number, number],
  options: OristudioBpMutationOptions = {}
): Promise<OristudioBpDocumentState> {
  return mutateActiveOristudioBpProject(options, (api, handle) =>
    api.mergeTreeEdge(handle, vertices[0], vertices[1])
  );
}

export async function moveOristudioBpLayoutFlap(
  id: number,
  loc: Point,
  options: OristudioBpMutationOptions = {}
): Promise<OristudioBpDocumentState> {
  return mutateActiveOristudioBpProject(options, (api, handle) =>
    api.moveLayoutFlap(handle, id, loc.x, loc.y, options.dragging ?? false)
  );
}

export async function moveOristudioBpLayoutFlaps(
  ids: number[],
  loc: Point,
  options: OristudioBpMutationOptions = {}
): Promise<OristudioBpDocumentState> {
  return mutateActiveOristudioBpProject(options, (api, handle) =>
    api.moveLayoutFlaps(handle, ids, loc.x, loc.y, options.dragging ?? false)
  );
}

export async function resizeOristudioBpLayoutFlap(
  id: number,
  width: number,
  height: number,
  options: OristudioBpMutationOptions = {}
): Promise<OristudioBpDocumentState> {
  return mutateActiveOristudioBpProject(options, (api, handle) =>
    api.resizeLayoutFlap(handle, id, width, height)
  );
}

export async function subdivideOristudioBpLayoutSheet(
  options: OristudioBpMutationOptions = {}
): Promise<OristudioBpDocumentState> {
  return mutateActiveOristudioBpProject(options, (api, handle) =>
    api.subdivideLayoutSheet(handle)
  );
}

export async function rotateOristudioBpLayoutSheet(
  clockwise: boolean,
  options: OristudioBpMutationOptions = {}
): Promise<OristudioBpDocumentState> {
  return mutateActiveOristudioBpProject(options, (api, handle) =>
    api.rotateLayoutSheet(handle, clockwise)
  );
}

export async function flipOristudioBpLayoutSheet(
  horizontal: boolean,
  options: OristudioBpMutationOptions = {}
): Promise<OristudioBpDocumentState> {
  return mutateActiveOristudioBpProject(options, (api, handle) =>
    api.flipLayoutSheet(handle, horizontal)
  );
}

export async function updateOristudioBpLayoutSheet(
  gridType: OristudioBpSheetKind,
  width: number,
  height: number,
  options: OristudioBpMutationOptions = {}
): Promise<OristudioBpDocumentState> {
  return mutateActiveOristudioBpProject(options, (api, handle) =>
    api.updateLayoutSheet(handle, gridType, width, height)
  );
}

export async function completeOristudioBpStretch(
  id: string,
  options: OristudioBpMutationOptions = {}
): Promise<OristudioBpDocumentState> {
  return mutateActiveOristudioBpProject(options, (api, handle) =>
    api.completeStretch(handle, id)
  );
}

export async function switchOristudioBpStretchConfig(
  id: string,
  delta: number,
  options: OristudioBpMutationOptions = {}
): Promise<OristudioBpDocumentState> {
  return mutateActiveOristudioBpProject(options, (api, handle) =>
    api.switchStretchConfig(handle, id, delta)
  );
}

export async function switchOristudioBpStretchPattern(
  id: string,
  delta: number,
  options: OristudioBpMutationOptions = {}
): Promise<OristudioBpDocumentState> {
  return mutateActiveOristudioBpProject(options, (api, handle) =>
    api.switchStretchPattern(handle, id, delta)
  );
}

export async function moveOristudioBpDevice(
  id: string,
  index: number,
  loc: Point,
  options: OristudioBpMutationOptions = {}
): Promise<OristudioBpDocumentState> {
  return mutateActiveOristudioBpProject(options, (api, handle) =>
    api.moveDevice(handle, id, index, loc.x, loc.y, options.dragging ?? false)
  );
}

export interface OristudioBpOptimizerRunSummary {
  document: OristudioBpDocumentState;
  eventCount: number;
  openedNew: boolean;
}

export async function optimizeOristudioBpLayout(
  options: OristudioBpOptimizerOptions,
  stateOptions: Pick<OristudioBpMutationOptions, 'selection' | 'activeSurface'> = {},
  onProgress?: (progress: OristudioBpOptimizerProgress) => void
): Promise<OristudioBpOptimizerRunSummary> {
  if (activeHandle === null) {
    throw new Error('No Box Pleat project is loaded');
  }
  const api = await getOristudioBpClient();
  const request = await api.optimizerRequest(
    activeHandle,
    options.layoutMode,
    options.useBasinHopping,
    options.randomCandidateCount,
    options.useDimension
  );
  const report = await solveOptimizerRequestWithProgress(request, options.seed, onProgress);
  const { result, events } = optimizerSolveReportParts(report);
  await api.checkOptimizerResult(result);
  await api.validateOptimizerPacking(request, result);
  if (options.openNew) {
    const opened = await api.openOptimizerTemplate(activeHandle, request, result);
    const source = optimizedProjectSource(currentSource);
    loadedHandles = new Set([...loadedHandles, opened.handle]);
    activeHandle = opened.handle;
    currentSource = source;
    const document = await buildOpenedProjectState(api, opened, source, {
      dirty: true,
      activeSurface: stateOptions.activeSurface ?? 'packing',
      selection: stateOptions.selection,
    });
    return { document, eventCount: events.length, openedNew: true };
  }

  const project = await api.replaceWithOptimizerTemplate(activeHandle, request, result);
  const document = await buildProjectState(api, {
    handle: activeHandle,
    source: currentOrGeneratedSource(),
    project,
    dirty: true,
    activeSurface: stateOptions.activeSurface ?? 'packing',
    selection: stateOptions.selection,
  });
  return { document, eventCount: events.length, openedNew: false };
}

export async function undoOristudioBpProject(): Promise<OristudioBpDocumentState | null> {
  return navigateOristudioBpHistory((api, handle) => api.undoProject(handle), 'tree');
}

export async function redoOristudioBpProject(): Promise<OristudioBpDocumentState | null> {
  return navigateOristudioBpHistory((api, handle) => api.redoProject(handle), 'tree');
}

export async function notifyOristudioBpProjectSaved(handle = activeHandle): Promise<void> {
  if (handle === null) return;
  const api = await getOristudioBpClient();
  await api.notifyProjectSaved(handle);
}

export function activateOristudioBpProjectHandle(
  handle: number | null,
  source: OristudioBpSourceRef | null
): void {
  if (handle !== null && !loadedHandles.has(handle)) {
    throw new Error('Box Pleat project handle is not loaded');
  }
  activeHandle = handle;
  currentSource = source;
}

export async function cloneOristudioBpProjectHandle(
  handle: number,
  source: OristudioBpSourceRef,
  options: Pick<OristudioBpStateFromRawInput, 'activeSurface' | 'selection'> = {}
): Promise<OristudioBpDocumentState> {
  if (!loadedHandles.has(handle)) {
    throw new Error('Box Pleat project handle is not loaded');
  }
  const api = await getOristudioBpClient();
  const text = await api.exportBps(handle);
  const cloneHandle = await api.loadProject(text);
  const cloneSource = clonedProjectSource(source);

  try {
    const document = await buildProjectState(api, {
      handle: cloneHandle,
      source: cloneSource,
      dirty: true,
      activeSurface: options.activeSurface,
      selection: options.selection,
    });
    loadedHandles = new Set([...loadedHandles, cloneHandle]);
    activeHandle = cloneHandle;
    currentSource = cloneSource;
    return document;
  } catch (error) {
    await api.freeProject(cloneHandle).catch(() => undefined);
    throw error;
  }
}

export async function releaseOristudioBpProjectHandle(handle: number): Promise<void> {
  if (!client || !loadedHandles.has(handle)) return;
  loadedHandles.delete(handle);
  if (activeHandle === handle) {
    activeHandle = null;
    currentSource = null;
  }
  await client.freeProject(handle).catch(() => undefined);
}

function optimizerProgressFromEvent(event: OristudioBpOptimizerEvent): OristudioBpOptimizerProgress {
  switch (event.event) {
    case 'loading':
      return optimizerProgress('initializing', 'Initializing', event.data, null, 'Loading optimizer');
    case 'start':
      return optimizerProgress('start', 'Starting', null, null, 'Starting BP optimizer');
    case 'candidate':
      return optimizerProgress(
        'candidate-generation',
        'Candidate generation',
        event.data[0],
        event.data[1],
        'Generating random layout candidates'
      );
    case 'cont':
      return optimizerProgress(
        'continuous-solving',
        'Continuous solving',
        event.data[1],
        event.data[2],
        'Solving continuous layout constraints'
      );
    case 'flap':
      return optimizerProgress(
        'pre-solving',
        'Pre-solving',
        event.data,
        null,
        'Preparing flap hierarchy'
      );
    case 'pack':
      return optimizerProgress('packing', 'Packing', event.data, null, 'Packing flaps');
    case 'fit':
      return optimizerProgress(
        'integral-grid-fitting',
        'Integral grid fitting',
        event.data[0],
        event.data[1],
        'Fitting result to the integer grid'
      );
  }
}

function optimizerProgress(
  stage: OristudioBpOptimizerProgress['stage'],
  label: string,
  current: number | null,
  total: number | null,
  message: string
): OristudioBpOptimizerProgress {
  return {
    stage,
    label,
    current,
    total,
    canSkip: false,
    canCancel: false,
    message,
  };
}

export async function exportOristudioBpProjectAsBps(): Promise<string> {
  if (activeHandle === null) {
    throw new Error('No Box Pleat project is loaded');
  }
  const api = await getOristudioBpClient();
  return api.exportBps(activeHandle);
}

export async function exportOristudioBpWorkspaceAsBpz(
  projects: OristudioBpDocumentState[]
): Promise<Uint8Array> {
  const api = await getOristudioBpClient();
  const exportProjects = workspaceExportProjects(projects);
  if (exportProjects.length === 0) {
    throw new Error('No Box Pleat projects are loaded');
  }
  return api.exportWorkspace(exportProjects);
}

export async function exportOristudioBpProjectAsCp(
  options: Pick<OristudioBpExportOptions, 'reorient' | 'includeAuxiliaryHinges'>
): Promise<string> {
  if (activeHandle === null) {
    throw new Error('No Box Pleat project is loaded');
  }
  const api = await getOristudioBpClient();
  return api.exportCp(activeHandle, options.reorient, options.includeAuxiliaryHinges);
}

export async function exportOristudioBpProjectAsFold(
  options: Pick<OristudioBpExportOptions, 'reorient' | 'includeAuxiliaryHinges'>
): Promise<string> {
  if (activeHandle === null) {
    throw new Error('No Box Pleat project is loaded');
  }
  const api = await getOristudioBpClient();
  return api.exportFold(activeHandle, options.reorient, options.includeAuxiliaryHinges);
}

export function setOristudioBpCurrentSource(source: OristudioBpSourceRef | null): void {
  currentSource = source;
}

/** True for a Box Pleating Studio single-project file (`.bps`). */
export function isBpProjectFilename(filename: string): boolean {
  return /\.bps$/i.test(filename);
}

async function replaceHandles(
  api: OristudioBpClient,
  nextHandles: number[],
  nextActiveHandle: number | null
) {
  const nextHandleSet = new Set(nextHandles);
  const staleHandles = [...loadedHandles].filter((staleHandle) => !nextHandleSet.has(staleHandle));
  loadedHandles = nextHandleSet;
  activeHandle = nextActiveHandle;
  await Promise.all(staleHandles.map((staleHandle) => api.freeProject(staleHandle).catch(() => undefined)));
}

async function buildProjectState(
  api: OristudioBpClient,
  input: Omit<OristudioBpStateFromRawInput, 'project'> & {
    project?: OristudioBpStateFromRawInput['project'];
  }
): Promise<OristudioBpDocumentState> {
  const [project, summary, treeData, layoutSnapshot, packingValidation] = await Promise.all([
    input.project ? Promise.resolve(input.project) : api.snapshot(input.handle),
    api.summary(input.handle).catch(() => null),
    api.treeData(input.handle).catch(() => null),
    api.layoutSnapshot(input.handle).catch(() => null),
    api.packingValidation(input.handle).catch(() => null),
  ]);
  const creasePatternSnapshot =
    input.creasePatternSnapshot ??
    (await api.creasePatternSnapshot(input.handle, false, false).catch(() => null));
  return oristudioBpProjectStateFromRaw({
    ...input,
    project,
    summary,
    treeData,
    layoutSnapshot,
    packingValidation,
    creasePatternSnapshot,
  });
}

async function buildWorkspaceProjectState(
  api: OristudioBpClient,
  project: OristudioBpWasmWorkspaceProject,
  workspaceSource: OristudioBpSourceRef,
  dirty: boolean
): Promise<OristudioBpDocumentState> {
  const source = {
    format: 'bpz',
    filename: project.filename,
    path: workspaceSource.path,
  } satisfies OristudioBpSourceRef;
  return oristudioBpProjectStateFromRaw({
    handle: project.handle,
    project: project.project,
    summary: project.summary,
    treeData: await api.treeData(project.handle).catch(() => null),
    layoutSnapshot: await api.layoutSnapshot(project.handle).catch(() => null),
    packingValidation: await api.packingValidation(project.handle).catch(() => null),
    creasePatternSnapshot: await api.creasePatternSnapshot(project.handle, false, false).catch(() => null),
    source,
    dirty,
  });
}

async function buildOpenedProjectState(
  api: OristudioBpClient,
  opened: OristudioBpWasmOpenedProject,
  source: OristudioBpSourceRef,
  options: Pick<OristudioBpStateFromRawInput, 'dirty' | 'activeSurface' | 'selection'>
): Promise<OristudioBpDocumentState> {
  return oristudioBpProjectStateFromRaw({
    handle: opened.handle,
    project: opened.project,
    summary: opened.summary,
    treeData: await api.treeData(opened.handle).catch(() => null),
    layoutSnapshot: await api.layoutSnapshot(opened.handle).catch(() => null),
    packingValidation: await api.packingValidation(opened.handle).catch(() => null),
    creasePatternSnapshot: await api.creasePatternSnapshot(opened.handle, false, false).catch(() => null),
    source,
    ...options,
  });
}

async function navigateOristudioBpHistory(
  operation: (
    api: OristudioBpClient,
    handle: number
  ) => Promise<OristudioBpWasmHistoryNavigationProject>,
  fallbackSurface: OristudioBpEditingSurface
): Promise<OristudioBpDocumentState | null> {
  if (activeHandle === null) {
    throw new Error('No Box Pleat project is loaded');
  }
  const api = await getOristudioBpClient();
  const navigated = await operation(api, activeHandle);
  const document = await buildProjectState(api, {
    handle: activeHandle,
    project: navigated.project,
    source: currentOrGeneratedSource(),
    dirty: true,
    activeSurface: navigated.project.design.mode === 'layout' ? 'packing' : fallbackSurface,
  });
  return {
    ...document,
    selection: selectionFromHistoryTags(navigated.selection, document),
  };
}

interface OristudioBpMutationOptions {
  selection?: OristudioBpSelection;
  activeSurface?: OristudioBpEditingSurface;
  dragging?: boolean;
}

async function mutateActiveOristudioBpProject(
  options: OristudioBpMutationOptions,
  operation: (api: OristudioBpClient, handle: number) => Promise<OristudioBpRawProject>
): Promise<OristudioBpDocumentState> {
  if (activeHandle === null) {
    throw new Error('No Box Pleat project is loaded');
  }
  const api = await getOristudioBpClient();
  const project = await operation(api, activeHandle);
  return buildProjectState(api, {
    handle: activeHandle,
    project,
    source:
      currentSource ??
      ({
        format: 'generated',
        filename: 'Untitled.bps',
        path: null,
      } satisfies OristudioBpSourceRef),
    dirty: true,
    activeSurface: options.activeSurface ?? 'tree',
    selection: options.selection,
  });
}

function optimizerSolveReportParts(report: unknown): { result: unknown; events: unknown[] } {
  if (!report || typeof report !== 'object' || !('result' in report)) {
    throw new Error('Box Pleat optimizer report did not include a result');
  }
  const typedReport = report as { result: unknown; events?: unknown };
  return {
    result: typedReport.result,
    events: Array.isArray(typedReport.events) ? typedReport.events : [],
  };
}

function currentOrGeneratedSource(): OristudioBpSourceRef {
  return (
    currentSource ??
    ({
      format: 'generated',
      filename: 'Untitled.bps',
      path: null,
    } satisfies OristudioBpSourceRef)
  );
}

function optimizedProjectSource(source: OristudioBpSourceRef | null): OristudioBpSourceRef {
  const current = source ?? currentOrGeneratedSource();
  const base = current.filename.replace(/\.[^.]+$/u, '') || 'Untitled';
  return {
    format: 'generated',
    filename: `Optimized ${base}.bps`,
    path: null,
  };
}

function clonedProjectSource(source: OristudioBpSourceRef): OristudioBpSourceRef {
  const base = source.filename.replace(/\.[^.]+$/u, '') || 'Untitled';
  return {
    format: 'generated',
    filename: `Copy of ${base}.bps`,
    path: null,
  };
}

function selectionFromHistoryTags(
  tags: string[],
  document: OristudioBpDocumentState
): OristudioBpSelection {
  const selections = tags
    .map((tag) => selectionFromHistoryTag(tag, document))
    .filter((selection): selection is Exclude<OristudioBpSelection, { kind: 'bp-tree' }> =>
      Boolean(selection && selection.kind !== 'bp-tree')
    );
  if (selections.length === 0) return { kind: 'bp-tree' };
  if (selections.length === 1) return selections[0];
  return {
    kind: 'bp-multi',
    vertices: selections.flatMap((selection) =>
      selection.kind === 'bp-vertex' ? [selection.id] : []
    ),
    edges: selections.flatMap((selection) => (selection.kind === 'bp-edge' ? [selection.id] : [])),
    flaps: selections.flatMap((selection) => (selection.kind === 'bp-flap' ? [selection.id] : [])),
    rivers: selections.flatMap((selection) =>
      selection.kind === 'bp-river' ? [selection.id] : []
    ),
    stretches: selections.flatMap((selection) =>
      selection.kind === 'bp-stretch' ? [selection.id] : []
    ),
    devices: selections.flatMap((selection) =>
      selection.kind === 'bp-device' ? [selection.id] : []
    ),
    invalidJunctions: [],
  };
}

function selectionFromHistoryTag(
  tag: string,
  document: OristudioBpDocumentState
): OristudioBpSelection | null {
  if (tag === 'tree') return { kind: 'bp-tree' };
  const vertexId = prefixedNumericTag(tag, 'v');
  if (vertexId !== null) return { kind: 'bp-vertex', id: vertexId };
  const flapId = prefixedNumericTag(tag, 'f');
  if (flapId !== null) return { kind: 'bp-flap', id: flapId };
  if (tag.startsWith('e')) {
    const edgeVertices = tag
      .slice(1)
      .split(',')
      .map((value) => Number(value));
    if (edgeVertices.length === 2 && edgeVertices.every(Number.isFinite)) {
      const edge = document.snapshot.tree.edges.find(
        (candidate) =>
          (candidate.vertices[0] === edgeVertices[0] &&
            candidate.vertices[1] === edgeVertices[1]) ||
          (candidate.vertices[0] === edgeVertices[1] &&
            candidate.vertices[1] === edgeVertices[0])
      );
      if (edge) return { kind: 'bp-edge', id: edge.id };
    }
  }
  if (tag.startsWith('s')) {
    const deviceSeparator = tag.lastIndexOf('.');
    if (deviceSeparator > 1) {
      const stretchId = tag.slice(1, deviceSeparator);
      const deviceIndex = Number(tag.slice(deviceSeparator + 1));
      if (stretchId && Number.isInteger(deviceIndex)) {
        return { kind: 'bp-device', id: `${stretchId}:device:${deviceIndex}` };
      }
    }
    return { kind: 'bp-stretch', id: tag.slice(1) };
  }
  return null;
}

function prefixedNumericTag(tag: string, prefix: string): number | null {
  if (!tag.startsWith(prefix)) return null;
  const value = tag.slice(prefix.length);
  if (!/^\d+$/u.test(value)) return null;
  return Number(value);
}

function workspaceExportProjects(projects: OristudioBpDocumentState[]) {
  const names = new Set<string>();
  return projects.map((project) => {
    const baseName = uniqueBpWorkspaceFilename(project.snapshot.summary.title, names);
    return {
      filename: `${baseName}.bps`,
      handle: project.handle,
    };
  });
}

function uniqueBpWorkspaceFilename(title: string, names: Set<string>): string {
  let name = sanitizeBpFilename(title);
  if (names.has(name)) {
    let suffix = 1;
    while (names.has(`${name} (${suffix})`)) suffix += 1;
    name = `${name} (${suffix})`;
  }
  names.add(name);
  return name;
}

function sanitizeBpFilename(filename: string): string {
  const illegal = ['/', '\\', ':', '*', '|', '"', '<', '>', '?'];
  const replacements = ['\u2215', '\u2216', '\u2236', '\u2217', '\u2223', '\u2033', '\u2039', '\u203a', '\uff1f'];
  let next = filename;
  for (let index = 0; index < illegal.length; index += 1) {
    next = next.replaceAll(illegal[index], replacements[index]);
  }
  return next
    .replace(/\s+/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x80-\x9f]/g, '')
    .replace(/^\.*$/, 'project')
    .replace(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i, 'project')
    .replace(/[. ]+$/, 'project');
}
