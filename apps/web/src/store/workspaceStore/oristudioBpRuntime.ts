import { connectEngine } from '../../engines/engineHost';
import {
  acquireDesignHandle,
  adoptDesignHandle,
  forgetDesign,
} from '../../engines/designHandles';
import { readActiveDesign, type ActiveDesignRef } from './activeDesignSource';
import { proxy, wrap, type Remote } from 'comlink';
import {
  oristudioBpProjectStateFromRaw,
  type OristudioBpStateFromRawInput,
} from '../../engine/oristudioBpSnapshotMapper';
import type { OptimizerSymmetryPayload } from '../../lib/bpOptimizerSymmetry';
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
  OristudioBpWasmHistoryNavigationProject,
  OristudioBpWasmLayoutSnapshot,
  OristudioBpWasmOpenedProject,
} from '../../engine/oristudioBpTypes';
import type { Point } from '../../lib/geometry';
import type { WasmErrorEnvelope } from '../../engine/types';
import type { OristudioBpOptimizerWorkerApi } from '../../workers/oristudioBpOptimizerWorker';
import type { OristudioBpWorkerApi } from '../../workers/oristudioBpWorker';
import { attachWorkerDiagnostics } from '../../lib/workerDiagnostics';

export type OristudioBpClient = Remote<OristudioBpWorkerApi>;
type OristudioBpOptimizerClient = Remote<OristudioBpOptimizerWorkerApi>;

// Worker + comlink client are owned by `engines/engineHost`. The optimizer
// worker below stays local: it is spawned per run and terminated in a
// `finally`, so its lifetime is a call, not a session.
let optimizerWorker: Worker | null = null;
let optimizerClient: OristudioBpOptimizerClient | null = null;
let optimizerCancelRequested = false;
let descriptorsPromise: Promise<OristudioBpPortDescriptor[]> | null = null;

/**
 * Where a design's document came from — its filename, path, and format.
 *
 * Per design, keyed by tab id. It was one module-level `currentSource`, which was
 * right while one box-pleat design could be open: opening a second one renamed
 * the first, and an undo in either restored the other's filename (undo reloads
 * the document and keeps "the current source").
 *
 * Handles themselves are *not* here. They belong to the document registry, which
 * is what makes two box-pleat tabs two documents rather than one — see
 * {@link activeBpHandle}.
 */
const sourceByDesign = new Map<string, OristudioBpSourceRef>();

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
  return connectEngine('oristudio-bp');
}

export async function getOristudioBpPortDescriptors(): Promise<OristudioBpPortDescriptor[]> {
  const api = await getOristudioBpClient();
  descriptorsPromise ??= api.portDescriptors();
  return descriptorsPromise;
}

/**
 * Coalesce progress to at most one delivery per frame, latest-wins.
 *
 * The kernel emits one `cont` event per basin-hopping iteration per candidate,
 * so a random-mode run with a high candidate count produces thousands. Each one
 * would otherwise be a store write and a React render, on the same thread that
 * has to keep the Abort button responsive. Nothing is lost: progress is a
 * snapshot, not a stream, so only the most recent value ever matters.
 */
function coalesceProgress(
  onProgress: (progress: OristudioBpOptimizerProgress) => void
): { deliver: (progress: OristudioBpOptimizerProgress) => void; stop: () => void } {
  let pending: OristudioBpOptimizerProgress | null = null;
  let frame: number | null = null;
  const schedule =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16) as unknown as number;
  const cancel =
    typeof cancelAnimationFrame === 'function'
      ? cancelAnimationFrame
      : (handle: number) => clearTimeout(handle);

  return {
    deliver: (progress) => {
      pending = progress;
      frame ??= schedule(() => {
        frame = null;
        const next = pending;
        pending = null;
        if (next) onProgress(next);
      });
    },
    /**
     * Drop anything still queued. Called when the run ends: the caller resets
     * its own progress state, and a frame firing after that would paint a stale
     * stage back over the finished (or cancelled) dialog.
     */
    stop: () => {
      if (frame !== null) cancel(frame);
      frame = null;
      pending = null;
    },
  };
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
  attachWorkerDiagnostics(optimizerWorker, 'oristudio-bp-optimizer');
  optimizerClient = wrap<OristudioBpOptimizerWorkerApi>(optimizerWorker);
  const activeWorker = optimizerWorker;
  const progress = onProgress ? coalesceProgress(onProgress) : null;
  try {
    return await optimizerClient.solveReportWithProgress(
      request,
      seed,
      proxy((event: OristudioBpOptimizerEvent) => {
        progress?.deliver(optimizerProgressFromEvent(event));
      })
    );
  } catch (error) {
    if (optimizerCancelRequested) {
      throw {
        code: OPTIMIZER_CANCELLED,
        message: 'Box Pleat optimization cancelled',
      } satisfies WasmErrorEnvelope;
    }
    throw error;
  } finally {
    progress?.stop();
    if (optimizerWorker === activeWorker) {
      optimizerWorker.terminate();
      optimizerWorker = null;
      optimizerClient = null;
      optimizerCancelRequested = false;
    }
  }
}

/** The error {@link solveOptimizerRequestWithProgress} throws when the user aborts. */
const OPTIMIZER_CANCELLED = 'optimization_cancelled';

/**
 * Whether an error is the user aborting the optimizer rather than a real
 * failure. Callers use this to skip the error toast and leave history alone.
 */
/**
 * The design these calls operate on, captured **before** any await.
 *
 * Every creation path takes a round trip to the worker, and a tab switch during
 * one must not hand the new document to whichever design the user landed on.
 */
function targetDesign(): ActiveDesignRef | null {
  return readActiveDesign();
}

/**
 * The active design's live engine handle, hydrating it if the registry had
 * parked it.
 *
 * The replacement for a module-level `activeHandle`. That singleton was correct
 * while one box-pleat design could be open and became a data-loss bug the moment
 * two could: opening a second one *freed* the first's handle, and every mutation
 * after that went to whichever document was loaded last.
 */
async function activeBpHandle(): Promise<number | null> {
  const active = readActiveDesign();
  if (!active || active.kind !== 'box-pleat') return null;
  return acquireDesignHandle(active.id, 'box-pleat');
}

/** Same, but for the callers that cannot proceed without one. */
async function requireActiveBpHandle(): Promise<number> {
  const handle = await activeBpHandle();
  if (handle === null) throw new Error('No Box Pleat project is loaded');
  return handle;
}

/**
 * Give a freshly built document to `target`, replacing whatever it held.
 *
 * Falls back to freeing the handle when no design owns it — an export-only flow,
 * or a test store — rather than leaking it.
 */
async function claimBpProject(
  api: OristudioBpClient,
  target: ActiveDesignRef | null,
  handle: number,
  source: OristudioBpSourceRef
): Promise<void> {
  if (!target) {
    await api.freeProject(handle).catch(() => undefined);
    throw new Error('No design tab to hold the Box Pleat project');
  }
  await adoptDesignHandle(target.id, 'box-pleat', handle);
  sourceByDesign.set(target.id, source);
}

/** The active design's source, or the placeholder a generated project carries. */
function currentSourceOf(designId: string | null): OristudioBpSourceRef | null {
  return designId === null ? null : (sourceByDesign.get(designId) ?? null);
}

export function isOptimizerCancellation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === OPTIMIZER_CANCELLED
  );
}

export function cancelActiveOristudioBpOptimizer(): void {
  optimizerCancelRequested = true;
  optimizerWorker?.terminate();
  optimizerWorker = null;
  optimizerClient = null;
}

/**
 * Drop the active design's box-pleat document.
 *
 * Scoped to one design rather than freeing every handle the engine holds: with
 * tabs, "release the BP project" cannot mean "release everyone's".
 */
export async function releaseOristudioBpProject(): Promise<void> {
  const active = readActiveDesign();
  if (!active) return;
  sourceByDesign.delete(active.id);
  // The registry frees the handle, and knows not to call a dead engine.
  await forgetDesign(active.id);
}

export async function createSampleOristudioBpProject(): Promise<OristudioBpDocumentState> {
  const target = targetDesign();
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
    await claimBpProject(api, target, nextHandle, source);
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
  const target = targetDesign();
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
    await claimBpProject(api, target, nextHandle, nextSource);
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
  const source = currentSourceOf(readActiveDesign()?.id ?? null);
  return loadOristudioBpProjectFromText(bps, {
    filename: source?.filename ?? 'Untitled.bps',
    path: source?.path ?? null,
    format: source?.format === 'bps' ? 'bps' : 'generated',
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
  const target = targetDesign();
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
    await claimBpProject(api, target, nextHandle, nextSource);
    return nextState;
  } catch (error) {
    await api.freeProject(nextHandle).catch(() => undefined);
    throw error;
  }
}

export async function refreshOristudioBpProject(): Promise<OristudioBpDocumentState | null> {
  const handle = await activeBpHandle();
  if (handle === null) return null;
  const api = await getOristudioBpClient();
  return buildProjectState(api, { handle, source: currentOrGeneratedSource() });
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

/**
 * Delete leaves as one round. Pass every id the gesture means to remove -- the
 * engine simulates the whole batch before it mutates, so the cascade and the
 * minimum-tree floor are resolved across all of them together.
 */
export async function deleteOristudioBpTreeLeaves(
  ids: readonly number[],
  options: OristudioBpMutationOptions = {}
): Promise<OristudioBpDocumentState> {
  return mutateActiveOristudioBpProject(options, (api, handle) =>
    api.deleteTreeLeaves(handle, [...ids])
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

export async function unsubdivideOristudioBpLayoutSheet(
  options: OristudioBpMutationOptions = {}
): Promise<OristudioBpDocumentState> {
  return mutateActiveOristudioBpProject(options, (api, handle) =>
    api.unsubdivideLayoutSheet(handle)
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

/** A `null` dimension keeps whatever the engine session's sheet has now. */
export async function updateOristudioBpLayoutSheet(
  gridType: OristudioBpSheetKind,
  width: number | null,
  height: number | null,
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
  stateOptions: Pick<OristudioBpMutationOptions, 'activeSurface'> = {},
  onProgress?: (progress: OristudioBpOptimizerProgress) => void
): Promise<OristudioBpOptimizerRunSummary> {
  const target = targetDesign();
  const handle = await requireActiveBpHandle();
  const api = await getOristudioBpClient();
  const request = await api.optimizerRequest(
    handle,
    options.layoutMode,
    options.useBasinHopping,
    options.randomCandidateCount,
    options.useDimension
  );
  // The request is built engine-side and carried as plain JSON, so a symmetry
  // requirement is attached here rather than threaded through the wasm signature.
  if (options.symmetry && request && typeof request === 'object') {
    (request as { symmetry?: OptimizerSymmetryPayload }).symmetry = options.symmetry;
  }
  const report = await solveOptimizerRequestWithProgress(request, options.seed, onProgress);
  const { result: solved, events } = optimizerSolveReportParts(report);
  await api.checkOptimizerResult(solved);
  // Validate the kernel's own result, before the minimum-size clamp below. The
  // packing validator is ours, not upstream's, and the kernel's output is
  // self-consistent at the size it reports; running it after the clamp would
  // let our extra check reject a packing upstream accepts.
  await api.validateOptimizerPacking(request, solved);
  const result = clampOptimizerResultToMinimumSheet(solved, request);
  if (options.openNew) {
    const opened = await api.openOptimizerTemplate(handle, request, result);
    const source = optimizedProjectSource(currentOrGeneratedSource());
    // "Open as new" replaces this design's document with the optimized one. The
    // registry frees the handle it displaces, so the old template cannot leak.
    await claimBpProject(api, target, opened.handle, source);
    const document = await buildOpenedProjectState(api, opened, source, {
      dirty: true,
      activeSurface: stateOptions.activeSurface ?? 'packing',
    });
    return { document, eventCount: events.length, openedNew: true };
  }

  const project = await api.replaceWithOptimizerTemplate(handle, request, result);
  const document = await buildProjectState(api, {
    handle,
    source: currentOrGeneratedSource(),
    project,
    dirty: true,
    activeSurface: stateOptions.activeSurface ?? 'packing',
  });
  return { document, eventCount: events.length, openedNew: false };
}

/** A history step: the restored document plus the selection it touched. */
export interface OristudioBpHistoryNavigation {
  document: OristudioBpDocumentState;
  selection: OristudioBpSelection;
}

export async function undoOristudioBpProject(): Promise<OristudioBpHistoryNavigation | null> {
  return navigateOristudioBpHistory((api, handle) => api.undoProject(handle), 'tree');
}

export async function redoOristudioBpProject(): Promise<OristudioBpHistoryNavigation | null> {
  return navigateOristudioBpHistory((api, handle) => api.redoProject(handle), 'tree');
}

export async function notifyOristudioBpProjectSaved(): Promise<void> {
  const handle = await activeBpHandle();
  if (handle === null) return;
  const api = await getOristudioBpClient();
  await api.notifyProjectSaved(handle);
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
  const handle = await requireActiveBpHandle();
  const api = await getOristudioBpClient();
  return api.exportBps(handle);
}

export async function exportOristudioBpProjectAsCp(
  options: Pick<OristudioBpExportOptions, 'reorient' | 'includeAuxiliaryHinges'> & {
    // Multiplier on the exported full width. "Send to Edit" passes
    // bpSheetMaxCells / editGridDivisions so one BP cell maps onto one Edit
    // grid cell. Defaults to 1 (fill the standard paper) for every other caller.
    cpScale?: number;
  }
): Promise<string> {
  const handle = await requireActiveBpHandle();
  const api = await getOristudioBpClient();
  return api.exportCp(
    handle,
    options.reorient,
    options.includeAuxiliaryHinges,
    options.cpScale ?? 1
  );
}

export async function exportOristudioBpProjectAsFold(
  options: Pick<OristudioBpExportOptions, 'reorient' | 'includeAuxiliaryHinges'>
): Promise<string> {
  const handle = await requireActiveBpHandle();
  const api = await getOristudioBpClient();
  return api.exportFold(handle, options.reorient, options.includeAuxiliaryHinges);
}

/** Record where the active design's document came from (a save-as, typically). */
export function setOristudioBpCurrentSource(source: OristudioBpSourceRef | null): void {
  const active = readActiveDesign();
  if (!active) return;
  if (source === null) sourceByDesign.delete(active.id);
  else sourceByDesign.set(active.id, source);
}

/** True for a Box Pleating Studio single-project file (`.bps`). */
export function isBpProjectFilename(filename: string): boolean {
  return /\.bps$/i.test(filename);
}

async function buildProjectState(
  api: OristudioBpClient,
  input: Omit<OristudioBpStateFromRawInput, 'project'> & {
    project?: OristudioBpStateFromRawInput['project'];
  }
): Promise<OristudioBpDocumentState> {
  const [project, summary, treeData, layout, packingValidation] = await Promise.all([
    input.project ? Promise.resolve(input.project) : api.snapshot(input.handle),
    api.summary(input.handle).catch(() => null),
    api.treeData(input.handle).catch(() => null),
    layoutSnapshotOrError(api, input.handle),
    api.packingValidation(input.handle).catch(() => null),
  ]);
  return oristudioBpProjectStateFromRaw({
    ...input,
    project,
    summary,
    treeData,
    layoutSnapshot: layout.snapshot,
    layoutError: layout.error,
    packingValidation,
  });
}

/**
 * The layout snapshot, or why there isn't one.
 *
 * A failure here stays non-fatal: the tree, the flaps and the sheet are all
 * still valid and editable, and moving the offending flap back onto legal ground
 * is exactly how a user recovers. What must not survive is the silence — this
 * used to be `.catch(() => null)`, which made a kernel refusal indistinguishable
 * from a design that simply has no layout yet, and drew it as an empty canvas.
 */
async function layoutSnapshotOrError(
  api: OristudioBpClient,
  handle: number
): Promise<{ snapshot: OristudioBpWasmLayoutSnapshot | null; error: string | null }> {
  try {
    return { snapshot: await api.layoutSnapshot(handle), error: null };
  } catch (error) {
    return { snapshot: null, error: oristudioBpError(error).message };
  }
}

async function buildOpenedProjectState(
  api: OristudioBpClient,
  opened: OristudioBpWasmOpenedProject,
  source: OristudioBpSourceRef,
  options: Pick<OristudioBpStateFromRawInput, 'dirty' | 'activeSurface'>
): Promise<OristudioBpDocumentState> {
  const layout = await layoutSnapshotOrError(api, opened.handle);
  return oristudioBpProjectStateFromRaw({
    handle: opened.handle,
    project: opened.project,
    summary: opened.summary,
    treeData: await api.treeData(opened.handle).catch(() => null),
    layoutSnapshot: layout.snapshot,
    layoutError: layout.error,
    packingValidation: await api.packingValidation(opened.handle).catch(() => null),
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
): Promise<OristudioBpHistoryNavigation | null> {
  const handle = await requireActiveBpHandle();
  const api = await getOristudioBpClient();
  const navigated = await operation(api, handle);
  const document = await buildProjectState(api, {
    handle,
    project: navigated.project,
    source: currentOrGeneratedSource(),
    dirty: true,
    activeSurface: navigated.project.design.mode === 'layout' ? 'packing' : fallbackSurface,
  });
  // The engine tags each step with what it touched. Hand that back beside the
  // document — the caller decides whether to show it — rather than folding a
  // selection into document state.
  return { document, selection: selectionFromHistoryTags(navigated.selection, document) };
}

interface OristudioBpMutationOptions {
  activeSurface?: OristudioBpEditingSurface;
  dragging?: boolean;
}

async function mutateActiveOristudioBpProject(
  options: OristudioBpMutationOptions,
  operation: (api: OristudioBpClient, handle: number) => Promise<OristudioBpRawProject>
): Promise<OristudioBpDocumentState> {
  const handle = await requireActiveBpHandle();
  const api = await getOristudioBpClient();
  const project = await operation(api, handle);
  return buildProjectState(api, {
    handle,
    project,
    source: currentOrGeneratedSource(),
    dirty: true,
    activeSurface: options.activeSurface ?? 'tree',
  });
}

/**
 * Box Pleating Studio's minimum sheet sizes (`shared/types/constants.ts`). The
 * kernel's own floor is 4 regardless of grid type, and for diagonal sheets the
 * reported size is derived from the flap coordinates rather than that floor, so
 * results below these do occur on small designs.
 */
const MIN_RECT_SHEET = 4;
const MIN_DIAG_SHEET = 6;

/**
 * Port of upstream's `grid.$fixDimension`, which
 * `client/plugins/optimizer/index.ts` applies to every result before writing it
 * back. Like upstream this only raises the dimensions; it does not re-centre the
 * flaps, so a bumped diagonal sheet can leave a flap outside the diamond exactly
 * as it does in BP Studio.
 */
function clampOptimizerResultToMinimumSheet(result: unknown, request: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const typed = result as { width?: unknown; height?: unknown };
  if (typeof typed.width !== 'number' || typeof typed.height !== 'number') return result;
  // `GridType` serializes as "rect" / "diag" (see `oristudio-bp`'s model).
  const gridType = (request as { problem?: { type?: unknown } } | null)?.problem?.type;
  const minimum = gridType === 'diag' ? MIN_DIAG_SHEET : MIN_RECT_SHEET;
  if (typed.width >= minimum && typed.height >= minimum) return result;
  return {
    ...result,
    width: Math.max(typed.width, minimum),
    height: Math.max(typed.height, minimum),
  };
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
    currentSourceOf(readActiveDesign()?.id ?? null) ??
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

function selectionFromHistoryTags(
  tags: string[],
  document: OristudioBpDocumentState
): OristudioBpSelection {
  const selections = tags
    .map((tag) => selectionFromHistoryTag(tag, document))
    .filter((selection): selection is Exclude<OristudioBpSelection, { kind: 'bp-none' }> =>
      Boolean(selection && selection.kind !== 'bp-none')
    );
  if (selections.length === 0) return { kind: 'bp-none' };
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
  if (tag === 'tree') return { kind: 'bp-none' };
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

