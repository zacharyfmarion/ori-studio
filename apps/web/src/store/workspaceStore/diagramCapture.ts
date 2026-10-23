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
  type SheetPaper,
  type SimulateFlat,
} from '../../diagram/capture/captureFolded';
import type { KnownCreases } from '../../diagram/capture/captureCreases';
import { abandonOnEngineLoss } from '../../diagram/capture/engineLoss';
import {
  DEFAULT_DIAGRAM_STYLE,
  DEFAULT_LAYER_SPREAD,
  isLockedStep,
  setFoldStepPicture,
  setLinkedPicture,
  spreadStartsFor,
  type DiagramCpRender,
  type DiagramCpScope,
  type DiagramDocument,
  type DiagramPicture,
  type DiagramPosedSource,
  type DiagramStyle,
  type KnownDiagramAnnotation,
  type KnownDiagramAsset,
  stepById,
} from '../../diagram/document/diagramDocument';
import { diagramScenePaintStyle, diagramStyleKey } from '../../diagram/pictures/diagramPaperStyle';
import { sceneMeasure } from '../../diagram/pictures/paintDiagramStep';
import { digest } from '../../diagram/pictures/pictureKey';
import {
  ensureCpSheetArtifacts,
  ensureCpSheetSimulationArtifacts,
} from '../../cp-workspace/sheets/cpSheetArtifacts';
import { ensureCpSheetIndex } from '../../cp-workspace/sheets/cpSheetIndex';
import type { CpSheetRegion } from '../../cp-workspace/sheets/cpSheetRegions';
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
import { buildSegmentSimulationFold, resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { createCpCaptureRuntime } from './cpFoldRuntimeBindings';
import type { ProjectDocumentCommit } from './projectDocumentHistory';
import { landSeededFrame, type LandedFirstFrame } from '../../diagram/zoom/zoomFrames';
import { trackSeeded } from './diagramZoom';
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
  const run = beginCaptureRun(store, stepId);
  if ('status' in run) return run;
  return {
    ...run,
    cp,
    // A 3D figure carries the document's aux lines; a document with none asks nothing.
    auxHandle: cpAuxLinesKey(cp.geometry) === NO_AUX_LINES_KEY ? null : cp.handle,
  };
}

/** A capture begun from any source: the guard its commit checks, and the style it is drawn in. */
export type CaptureRunStart = Pick<StepCaptureStart, 'guard' | 'style'>;

/**
 * Begin a capture of a step from whatever it shows — Edit's pattern
 * ({@link beginStepCapture}) or a Fold step — marking it capturing, or say
 * why it cannot be: a read-only diagram, a step not there or not this
 * build's, or one already capturing. End it with {@link endStepCapture}.
 */
export function beginCaptureRun(
  store: DiagramCaptureStore,
  stepId: string
): CaptureRunStart | Extract<DiagramCaptureOutcome, { status: 'read-only' | 'discarded' | 'busy' }> {
  const state = store.get();
  if (state.diagramReadOnly) return { status: 'read-only' };
  if (Object.hasOwn(state.diagramCaptures, stepId)) return { status: 'busy' };
  const step = state.diagram ? stepById(state.diagram, stepId) : null;
  if (!step || isLockedStep(step)) return { status: 'discarded' };
  setRun(store, stepId, { runId: null });
  return {
    guard: { stepId, loadId: state.diagramLoadId, revision: step.revision },
    style: state.diagram?.style ?? DEFAULT_DIAGRAM_STYLE,
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
  start: CaptureRunStart,
  captured: StepCaptured,
  label: string,
  joinEntry?: object
): Promise<{ changed: boolean; tooDetailed: boolean; replaced?: number } | null> {
  const kept = await keptPicture(captured.picture, captured.source.render, start.style);
  const now = store.get();
  const { stepId, loadId, revision } = start.guard;
  const current = now.diagram ? stepById(now.diagram, stepId) : null;
  if (now.diagramLoadId !== loadId || !current || current.revision !== revision) return null;
  const join = joinEntry !== undefined && now.diagramHistory.past.at(-1) === joinEntry;
  // A step enlarged before it had a picture lands its frame on its first, or starts whole if that shows another
  // picture type than its run, in the same undo step (Revision 2; review fix 3).
  let landed = null as LandedFirstFrame | null;
  let replaced = 0;
  const next = commit(
    label,
    (diagram) => {
      let pictured: DiagramDocument;
      if (captured.source.kind === 'fold-step') {
        // A Fold step's marks follow its source (plan D17), as a References card's do.
        const set = setFoldStepPicture(diagram, stepId, { source: captured.source, marks: captured.marks ?? [], ...kept });
        pictured = set.document;
        replaced = set.replaced;
      } else {
        pictured = setLinkedPicture(diagram, stepId, { source: captured.source, ...kept });
      }
      landed = landSeededFrame(diagram, pictured, stepId);
      return landed.document;
    },
    join
  );
  if (next && landed) trackSeeded(next, stepId, landed);
  // How many edited marks a Fold step's own replaced, said only when any were.
  return { changed: next !== null, tooDetailed: kept.asset !== undefined, ...(next && replaced > 0 ? { replaced } : {}) };
}

/** What a capture commits: the step's new source and picture, and for a Fold step the marks its fold brings. */
export interface StepCaptured {
  source: DiagramPosedSource;
  picture: CapturedPicture;
  /** A Fold step's line and arrow, tagged as its source's (`setFoldStepPicture`). */
  marks?: readonly KnownDiagramAnnotation[];
}

/** A capture that threw: stopped by the user, or failed. */
export function captureFailure(error: unknown): Extract<DiagramCaptureOutcome, { status: 'stopped' | 'failed' }> {
  if (isFoldCancellation(error)) return { status: 'stopped' };
  const { code, message } = oristudioCpError(error);
  return { status: 'failed', code, message };
}

/** The slice's commit: one undo step, the project dirty, nothing for an edit that changes nothing. */
export type DiagramCommit = ProjectDocumentCommit<DiagramDocument>;

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
    const sheets = await abandonOnEngineLoss(ensureCpSheetIndex(document));
    const { diagram } = store.get();
    const capture = (runtime: CpCaptureRuntime) =>
      captureStep(runtime, {
        document,
        sheets,
        scope: request.scope,
        known: request.known ?? null,
        render: request.render,
        style: start.style,
        simulateFlat: storeSimulateFlat(store),
        sheetPaper: storeSheetPaper(store),
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
 * The simulator's flat sheet for a sheet (D19), bound to the store: the
 * sheet's own triangulated mesh, as an inline simulation's is, and the
 * simulator's worker, held only for the call. Null when the sheet has no
 * faces in that mesh.
 */
export function storeSimulateFlat(store: DiagramCaptureStore): SimulateFlat {
  return async (sheet, view, style) => {
    const fold = await storeSimulationFold(store, sheet);
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
 * A sheet's paper, from the faces built for it alone (`ensureCpSheetArtifacts`):
 * the rim of every face, so a hole the kernel left out is left out of the
 * paper a crease-pattern picture fills, as it was when the paper came from
 * the whole canvas's faces.
 */
export function storeSheetPaper(store: DiagramCaptureStore): SheetPaper {
  return async (sheet) => {
    const artifacts = await ensureCpSheetArtifacts(store.get().oristudioCpDocument?.document, sheet.id);
    return resolveCpSegments(artifacts)[0]?.boundary ?? null;
  };
}

/**
 * The model the simulator folds for a sheet, as an inline simulation builds
 * it: the sheet's own mesh (`ensureCpSheetSimulationArtifacts`), what a 0%
 * picture is drawn from and what Pose's live simulator loads (D19), so the
 * two are one model. Null when the mesh cannot be built or has no faces.
 */
export async function storeSimulationFold(
  store: DiagramCaptureStore,
  sheet: CpSheetRegion
): Promise<FoldDocument | null> {
  const artifacts = await ensureCpSheetSimulationArtifacts(
    store.get().oristudioCpDocument?.document,
    sheet.id
  );
  const [segment] = resolveCpSegments(artifacts);
  if (!artifacts || !segment) return null;
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
