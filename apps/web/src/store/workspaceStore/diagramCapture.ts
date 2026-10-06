/**
 * A linked Diagram step's capture, run against the store (D4): choose the
 * step's creases from the crease pattern as it stands, fold them if its
 * render folds — a visible, stoppable run in the fold-run registry, so the
 * global "Folding…" toast and Stop reach it from any workspace — and commit
 * the picture to the step by id, as one undo step.
 *
 * A capture outlives nothing it was not meant for: its result is dropped when
 * the diagram was replaced while it ran, the step is gone, or the step's
 * source changed under it (its `revision`). Opening a diagram never captures.
 */
import {
  captureStep,
  type CapturedPicture,
  type CpCaptureRuntime,
  type SimulateFlat,
} from '../../diagram/capture/captureFolded';
import type { KnownCreases } from '../../diagram/capture/captureCreases';
import { abandonOnEngineLoss } from '../../diagram/capture/engineLoss';
import {
  DEFAULT_DIAGRAM_STYLE,
  DEFAULT_LAYER_SPREAD,
  isLockedStep,
  setLinkedPicture,
  spreadStartsFor,
  type DiagramCpRender,
  type DiagramCpScope,
  type DiagramCpSource,
  type DiagramDocument,
  type DiagramPicture,
  type DiagramStyle,
  type KnownDiagramAsset,
  stepById,
} from '../../diagram/document/diagramDocument';
import { diagramScenePaintStyle, diagramStyleKey } from '../../diagram/pictures/diagramPaperStyle';
import { sceneMeasure } from '../../diagram/pictures/paintDiagramStep';
import { digest } from '../../diagram/pictures/pictureKey';
import { ensureCpSegmentationArtifacts } from '../../cp-workspace/cpSegmentationArtifacts';
import { cpAuxLinesKey, NO_AUX_LINES_KEY } from '../../cp-workspace/folded/foldedAuxSource';
import type {
  OristudioCpDocumentState,
  OristudioCpFold3dRefusal,
} from '../../engine/oristudioCpTypes';
import type { FoldDocument } from '../../engine/types';
import { FOLD_RUN_NONE } from '../../lib/foldCancellation';
import { paperPngSize, paperSvgToPng } from '../../lib/paper/paperPng';
import type { PaperPage } from '../../lib/paper/paperPage';
import { pagePtPerPx, paperSceneToSvg } from '../../lib/paper/paperSvg';
import { buildSegmentSimulationFold, type CpSegment } from '../../lib/creasePatternSegmentation';
import { createCpCaptureRuntime } from './cpFoldRuntimeBindings';
import { releaseSimulatorClient, retainSimulatorClient } from './simulatorRuntime';
import { stopFoldRun, withFoldInFlight } from './foldRuns';
import { isFoldCancellation, oristudioCpError } from './oristudioCpRuntime';
import type { WorkspaceState } from './types';
import { bytesToBase64 } from '../../lib/base64';

export interface DiagramCaptureRequest {
  scope: DiagramCpScope;
  /**
   * What the step remembers of its creases (`knownCreasesOf` its source), so a
   * sheet that moved is still found; absent for a link made now.
   */
  known?: KnownCreases | null;
  render: DiagramCpRender;
  /** Which run it is in the fold-run registry: a Pose or a link, or a Refresh. */
  kind: 'diagram-capture' | 'diagram-refresh';
  /** The undo step's name. */
  label: string;
  /**
   * An undo entry to fold this capture into, when it is still the newest:
   * Refresh all's one entry for the whole run. Anything recorded since starts
   * an entry of its own rather than being merged into.
   */
  joinEntry?: object;
}

export type DiagramCaptureOutcome =
  | {
      status: 'captured';
      /** False when the capture changed nothing, and no undo step was recorded. */
      changed: boolean;
      /** The render as captured: the folder the creases need may not be the one asked for. */
      render: DiagramCpRender;
      /** The fold found no layer order; the picture is its transparent development. */
      noLayerOrder: boolean;
      /** Too detailed to keep as vector; kept as a bitmap. */
      tooDetailed: boolean;
    }
  | { status: 'no-pattern' }
  | { status: 'missing' }
  | { status: 'unknown' }
  | { status: 'refused'; refusal: OristudioCpFold3dRefusal }
  /** Shown as Simulated above 0%: captured only in Pose (D19). */
  | { status: 'needs-pose' }
  /** Shown as Simulated, and the region has no model to simulate. */
  | { status: 'unavailable' }
  | { status: 'stopped' }
  | { status: 'discarded' }
  | { status: 'busy' }
  | { status: 'read-only' }
  /**
   * The engine's envelope, kept whole: its `code` is what `humanizeError`
   * words for the reader, and its `message` is often a Rust value.
   */
  | { status: 'failed'; code: string; message: string };

/** One capture in flight, by step: what a card shows progress and a Stop for. */
export interface DiagramCaptureRun {
  /** The fold run a Stop names; null while the creases are being chosen, or for a picture with no fold. */
  runId: number | null;
}

/** The store as a capture uses it. */
export interface DiagramCaptureStore {
  get: () => WorkspaceState;
  set: (partial: Partial<WorkspaceState>) => void;
}

/**
 * The box a picture too detailed to keep as vector is drawn in, and how
 * finely (D2): a bitmap, at 300 dpi, of an 80 mm picture.
 */
export const CAPTURE_RASTER_BOX_MM = 80;
const CAPTURE_RASTER_DPI = 300;

/** What a step's capture was started against: the diagram, and the step's source. */
export interface StepCaptureGuard {
  stepId: string;
  loadId: number;
  revision: number;
}

/** A step's capture, begun: what it captures from, and the guard its commit checks. */
export interface StepCaptureStart {
  guard: StepCaptureGuard;
  cp: OristudioCpDocumentState;
  style: DiagramStyle;
  /** The document whose aux lines a 3D figure carries, or null when it has none. */
  auxHandle: number | null;
}

/**
 * Begin a capture of a step: mark it capturing (the card's progress row), or
 * say why it cannot be — a read-only diagram, no pattern open, a step that is
 * not there or not this build's, or one already capturing. End it with
 * {@link endStepCapture}, whatever happens.
 */
export function beginStepCapture(
  store: DiagramCaptureStore,
  stepId: string
): StepCaptureStart | Extract<DiagramCaptureOutcome, { status: 'read-only' | 'no-pattern' | 'discarded' | 'busy' }> {
  const state = store.get();
  if (state.diagramReadOnly) return { status: 'read-only' };
  if (Object.hasOwn(state.diagramCaptures, stepId)) return { status: 'busy' };
  const cp = state.oristudioCpDocument;
  if (!cp) return { status: 'no-pattern' };
  const step = state.diagram ? stepById(state.diagram, stepId) : null;
  if (!step || isLockedStep(step)) return { status: 'discarded' };
  setRun(store, stepId, { runId: null });
  return {
    guard: { stepId, loadId: state.diagramLoadId, revision: step.revision },
    cp,
    style: state.diagram?.style ?? DEFAULT_DIAGRAM_STYLE,
    // A 3D figure carries the document's aux lines; a document with none asks nothing.
    auxHandle: cpAuxLinesKey(cp.geometry) === NO_AUX_LINES_KEY ? null : cp.handle,
  };
}

export function endStepCapture(store: DiagramCaptureStore, stepId: string): void {
  clearRun(store, stepId);
}

/**
 * Run kernel work for a step's capture as a fold run: visible in the global
 * "Folding…" toast, stoppable there and from the step's card, and abandoned if
 * the engine is lost, since a call on a dead worker never settles (D4).
 */
export function runStepFold<T>(
  store: DiagramCaptureStore,
  start: StepCaptureStart,
  kind: DiagramCaptureRequest['kind'],
  work: (runtime: CpCaptureRuntime) => Promise<T>
): Promise<T> {
  const { stepId } = start.guard;
  return abandonOnEngineLoss(
    withFoldInFlight(store, kind, (runId) => {
      if (Object.hasOwn(store.get().diagramCaptures, stepId)) setRun(store, stepId, { runId });
      return work(createCpCaptureRuntime(runId, start.auxHandle));
    })
  );
}

/** The kernel calls a step's capture makes outside a fold run. */
export function stepCaptureRuntime(start: StepCaptureStart): CpCaptureRuntime {
  return createCpCaptureRuntime(FOLD_RUN_NONE, start.auxHandle);
}

/**
 * Commit a captured picture to its step as one undo step — unless the diagram
 * was replaced, or the step is gone or its source changed, since the capture
 * began. Null when it was dropped; otherwise whether anything changed, and
 * whether the picture is kept as a bitmap.
 */
export async function commitStepCapture(
  store: DiagramCaptureStore,
  commit: DiagramCommit,
  start: StepCaptureStart,
  captured: { source: DiagramCpSource; picture: CapturedPicture },
  label: string,
  joinEntry?: object
): Promise<{ changed: boolean; tooDetailed: boolean } | null> {
  const kept = await keptPicture(captured.picture, captured.source.render, start.style);
  const now = store.get();
  const { stepId, loadId, revision } = start.guard;
  const current = now.diagram ? stepById(now.diagram, stepId) : null;
  if (now.diagramLoadId !== loadId || !current || current.revision !== revision) return null;
  const join = joinEntry !== undefined && now.diagramHistory.past.at(-1) === joinEntry;
  const next = commit(
    label,
    (diagram) => setLinkedPicture(diagram, stepId, { source: captured.source, ...kept }),
    join
  );
  return { changed: next !== null, tooDetailed: kept.asset !== undefined };
}

/** A capture that threw: stopped by the user, or failed. */
export function captureFailure(error: unknown): Extract<DiagramCaptureOutcome, { status: 'stopped' | 'failed' }> {
  if (isFoldCancellation(error)) return { status: 'stopped' };
  const { code, message } = oristudioCpError(error);
  return { status: 'failed', code, message };
}

/** The slice's commit: one undo step, the project dirty, nothing for an edit that changes nothing. */
export type DiagramCommit = (
  label: string,
  edit: (document: DiagramDocument) => DiagramDocument,
  /** Fold the edit into the newest undo entry instead of recording one. */
  extend?: boolean
) => DiagramDocument | null;

/** Capture a step's picture from its pattern as it stands, and commit it. */
export async function runDiagramCapture(
  store: DiagramCaptureStore,
  commit: DiagramCommit,
  stepId: string,
  request: DiagramCaptureRequest
): Promise<DiagramCaptureOutcome> {
  const start = beginStepCapture(store, stepId);
  if ('status' in start) return start;
  try {
    const document = start.cp.document;
    const segmentation = await abandonOnEngineLoss(ensureCpSegmentationArtifacts(document));
    const { diagram } = store.get();
    const capture = (runtime: CpCaptureRuntime) =>
      captureStep(runtime, {
        document,
        segmentation,
        scope: request.scope,
        known: request.known ?? null,
        render: request.render,
        style: start.style,
        simulateFlat: storeSimulateFlat(store),
        spreadStart: diagram ? spreadStartsFor(diagram, stepId).any : DEFAULT_LAYER_SPREAD,
      });
    const result =
      request.render.mode === 'crease-pattern' || request.render.mode === 'simulated'
        ? // The kernel folds nothing: there is no run to show or stop.
          await capture(stepCaptureRuntime(start))
        : await runStepFold(store, start, request.kind, capture);
    if (result.status !== 'captured') return result;
    const committed = await commitStepCapture(
      store,
      commit,
      start,
      { source: result.source, picture: result.captured },
      request.label,
      request.joinEntry
    );
    if (!committed) return { status: 'discarded' };
    return {
      status: 'captured',
      changed: committed.changed,
      render: result.source.render,
      noLayerOrder: result.noLayerOrder,
      tooDetailed: committed.tooDetailed,
    };
  } catch (error) {
    return captureFailure(error);
  } finally {
    endStepCapture(store, stepId);
  }
}

/**
 * The simulator's flat sheet for a region (D19), bound to the store: the
 * simulator's own artifacts (the triangulated mesh the region is modelled
 * on, as an inline simulation's is) and its worker, held only for the call.
 * Null when the region has no faces in that mesh.
 */
export function storeSimulateFlat(store: DiagramCaptureStore): SimulateFlat {
  return async (segment, view, style) => {
    const fold = await storeSimulationFold(store, segment);
    if (!fold) return null;
    const client = retainSimulatorClient();
    try {
      return await client.flatScene(fold, { view, size: SIMULATED_FRAME_PX, style, markHidden: true });
    } finally {
      releaseSimulatorClient();
    }
  };
}

/**
 * The model the simulator folds for a region, as an inline simulation builds
 * it from the simulator's own artifacts: what a 0% picture is drawn from and
 * what Pose's live simulator loads (D19), so the two are one model. Null when
 * the artifacts cannot be built or the region has no faces in their mesh.
 */
export async function storeSimulationFold(
  store: DiagramCaptureStore,
  segment: CpSegment
): Promise<FoldDocument | null> {
  const artifacts = store.get().foldArtifacts ?? (await store.get().ensureFoldArtifacts());
  if (!artifacts) return null;
  const fold = buildSegmentSimulationFold(artifacts, segment);
  return (fold.faces_vertices?.length ?? 0) === 0 ? null : fold;
}

/**
 * The square a simulated picture is framed in, CSS px: a size, not a scale (it
 * carries no paper scale). Pose's captures use it too, so a step framed at 0%
 * headless and in Pose is one picture.
 */
export const SIMULATED_FRAME_PX = 512;

/** Stop a step's capture, if it is folding. */
export function stopDiagramCapture(store: DiagramCaptureStore, stepId: string): boolean {
  const run = store.get().diagramCaptures[stepId];
  return run?.runId != null && stopFoldRun(store, run.runId);
}

function setRun(store: DiagramCaptureStore, stepId: string, run: DiagramCaptureRun): void {
  store.set({ diagramCaptures: { ...store.get().diagramCaptures, [stepId]: run } });
}

function clearRun(store: DiagramCaptureStore, stepId: string): void {
  const runs = store.get().diagramCaptures;
  if (!Object.hasOwn(runs, stepId)) return;
  const { [stepId]: _finished, ...rest } = runs;
  store.set({ diagramCaptures: rest });
}

/**
 * The picture a step keeps: the capture's own, or — for a scene past the
 * budget — a bitmap of it in the diagram's pens, kept as an asset.
 */
export async function keptPicture(
  captured: CapturedPicture,
  render: DiagramCpRender,
  style: DiagramStyle
): Promise<{ picture: DiagramPicture; asset?: KnownDiagramAsset }> {
  if (captured.kind === 'picture') return { picture: captured.picture };
  const pagePaper: PaperPage = {
    sheet: { mm: CAPTURE_RASTER_BOX_MM },
    paddingMm: 1,
    background: null,
    keepHiddenFaces: false,
  };
  const pattern = render.mode === 'crease-pattern';
  const measure = sceneMeasure(pattern);
  const page = paperSceneToSvg(captured.scene, diagramScenePaintStyle(style, pattern), pagePaper, measure);
  const png = await paperSvgToPng(page, CAPTURE_RASTER_DPI);
  const { width, height } = paperPngSize(page, CAPTURE_RASTER_DPI);
  const src = `data:image/png;base64,${bytesToBase64(png)}`;
  // Named by what it draws, as a scene picture is by its JSON: the same
  // capture again is the same picture, and records nothing.
  const id = `asset-raster-${digest(`${CAPTURE_RASTER_DPI}|${CAPTURE_RASTER_BOX_MM}|${page.svg}`)}`;
  // The bitmap's own px per pattern unit: the scene's, through the page's scale.
  const pxPerScenePx = (pagePtPerPx(captured.scene, pagePaper, measure) * CAPTURE_RASTER_DPI) / 72;
  const paperScale = captured.paperScale === null ? null : captured.paperScale * pxPerScenePx;
  return {
    picture: { kind: 'asset', assetId: id, paperScale, styleKey: diagramStyleKey(style), key: `raster-${id}` },
    asset: { id, kind: 'raster', src, widthPx: width, heightPx: height, bytes: src.length },
  };
}
