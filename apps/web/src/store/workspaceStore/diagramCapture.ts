import {hasConnectedDrawing} from '../../layer-spread/connectedScene';
import {rasterSpreadScene} from '../../layer-spread/settledSpreadPicture';
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
  type CaptureLayerOrder,
  type CapturedPicture,
  type CpCaptureRuntime,
  type SheetPaper,
  type SimulateFlat,
} from '../../diagram/capture/captureFolded';
import type { KnownCreases } from '../../diagram/capture/captureCreases';
import { layerOrderSummaryOf, type CaptureLayerOrderResolve } from '../../diagram/capture/captureLayerOrder';
import { abandonOnEngineLoss } from '../../diagram/capture/engineLoss';
import { dropStepSolutionCursor } from '../../diagram/capture/stepSolutionCursor';
import {
  DEFAULT_DIAGRAM_STYLE,
  DEFAULT_LAYER_SPREAD,
  isLockedStep,
  setFoldStepPicture,
  setLinkedLayerOrder,
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
import {
  resolveLayerOrder,
  type LayerOrderResolveBatch,
} from '../../layer-order/host/hostEngineGateway';
import { sameLayerOrderAttention } from '../../layer-order/host/layerOrderResolution';
import { FOLD_RUN_NONE } from '../../lib/foldCancellation';
import type { LayerOrderAttention } from '../../lib/layerOrder/layerOrderRecord';
import type { LayerOrderApplied } from '../../lib/layerOrder/layerOrderRequest';
import type { PaperFrame } from '../../lib/layerOrder/paperFrame';
import { paperPngSize, paperSvgToPng } from '../../lib/paper/paperPng';
import type { PaperPage } from '../../lib/paper/paperPage';
import { pageMarginPt, pagePtPerPx, paperSceneToSvg } from '../../lib/paper/paperSvg';
import { buildSegmentSimulationFold, resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { createCpCaptureRuntime } from './cpFoldRuntimeBindings';
import type { ProjectDocumentCommit } from './projectDocumentHistory';
import { landSeededFrame, type LandedFirstFrame } from '../../diagram/zoom/zoomFrames';
import { trackSeeded } from './diagramZoom';
import { releaseSimulatorClient, retainSimulatorClient } from './simulatorRuntime';
import { stopFoldRun, withFoldInFlight, type FoldRunControls, type FoldRunOptions } from './foldRuns';
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
  /**
   * The step's layer order record (`DiagramCpSource.layerOrder`), carried on
   * the source the capture makes and drawn when it folds flat (layer order
   * H7). Absent for a link, which starts without one.
   */
  layerOrder?: string;
  /**
   * The host engine's batch a Refresh all restores every step's record on,
   * so the run spawns one worker; absent, a capture spawns its own.
   */
  layerOrders?: LayerOrderResolveBatch;
  /**
   * An order the Layer order dialog applied to the step, folded as it is,
   * with the paper frame its record was made in; it takes `layerOrder`'s
   * place (`stepLayerOrderActions.ts`).
   */
  layerOrderApplied?: { applied: LayerOrderApplied; frame: PaperFrame };
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
      /**
       * The summary this capture stored on the step's layer order record,
       * when it changed it to one that needs a look — some constraints left
       * out, or creases that now fold in 3D (D10, D13); absent or null when
       * the stored summary is as it was, or needs nothing.
       */
      flagged?: LayerOrderAttention | null;
    }
  /**
   * The step's layer order could not be drawn (D10): it keeps its picture,
   * and its record is flagged with `attention`; `changed` is false when it
   * was flagged so already.
   */
  | { status: 'needs-attention'; attention: LayerOrderAttention; changed: boolean }
  /** The Layer order dialog's order, which the kernel cannot draw (D3): nothing was written. */
  | { status: 'order-refused' }
  /**
   * The host engine was not there to restore the step's record: nothing was
   * checked and nothing written. `offline` when the browser did not load it.
   */
  | { status: 'layer-order-lost'; offline: boolean }
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
  /** A discrete pose change is preparing its replacement picture. Live gesture captures do not block Pose. */
  blocksPose?: true;
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
  /** Transient view edits can be superseded before they reach the document. */
  current?: () => boolean;
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
  stepId: string,
  blocksPose = false
): StepCaptureStart | Extract<DiagramCaptureOutcome, { status: 'read-only' | 'no-pattern' | 'discarded' | 'busy' }> {
  const state = store.get();
  if (state.diagramReadOnly) return { status: 'read-only' };
  if (Object.hasOwn(state.diagramCaptures, stepId)) return { status: 'busy' };
  const cp = state.oristudioCpDocument;
  if (!cp) return { status: 'no-pattern' };
  const run = beginCaptureRun(store, stepId, blocksPose);
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
  stepId: string,
  blocksPose = false
): CaptureRunStart | Extract<DiagramCaptureOutcome, { status: 'read-only' | 'discarded' | 'busy' }> {
  const state = store.get();
  if (state.diagramReadOnly) return { status: 'read-only' };
  if (Object.hasOwn(state.diagramCaptures, stepId)) return { status: 'busy' };
  const step = state.diagram ? stepById(state.diagram, stepId) : null;
  if (!step || isLockedStep(step)) return { status: 'discarded' };
  setRun(store, stepId, { runId: null, ...(blocksPose ? { blocksPose: true } : {}) });
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
 * the engine is lost, since a call on a dead worker never settles (D4). The
 * run's stop signal reaches `work` too, for what it runs outside the kernel
 * (a Layer order resolve or step), and its `controls` say when a Stop can
 * reach it (`foldRuns.ts`; `options.stoppable` for work that starts outside
 * the kernel, which a Stop always reaches by terminating its worker).
 */
export function runStepFold<T>(
  store: DiagramCaptureStore,
  start: StepCaptureStart,
  kind: DiagramCaptureRequest['kind'],
  work: (runtime: CpCaptureRuntime, stop: AbortSignal, controls: FoldRunControls) => Promise<T>,
  options?: FoldRunOptions
): Promise<T> {
  const { stepId } = start.guard;
  return abandonOnEngineLoss(
    withFoldInFlight(
      store,
      kind,
      (runId, stop, controls) => {
        const capture = store.get().diagramCaptures[stepId];
        if (capture) setRun(store, stepId, { ...capture, runId });
        return work(createCpCaptureRuntime(runId, start.auxHandle), stop, controls);
      },
      options
    )
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
  if (start.guard.current?.() === false) return null;
  const kept = await keptPicture(captured.picture, captured.source.render, start.style);
  const now = store.get();
  const { stepId, loadId, revision } = start.guard;
  const current = now.diagram ? stepById(now.diagram, stepId) : null;
  if (start.guard.current?.() === false || now.diagramLoadId !== loadId || !current || current.revision !== revision) return null;
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

/**
 * Commit a step's layer order record, flagged, as one undo step, its picture
 * kept (layer order D10): what a capture that could not draw the record's
 * order leaves. Under the capture's guard, as {@link commitStepCapture} is;
 * null when it was dropped.
 */
export function commitStepLayerOrder(
  store: DiagramCaptureStore,
  commit: DiagramCommit,
  start: CaptureRunStart,
  layerOrder: string,
  label: string,
  joinEntry?: object
): { changed: boolean } | null {
  const now = store.get();
  const { stepId, loadId, revision } = start.guard;
  const current = now.diagram ? stepById(now.diagram, stepId) : null;
  if (now.diagramLoadId !== loadId || !current || current.revision !== revision) return null;
  const join = joinEntry !== undefined && now.diagramHistory.past.at(-1) === joinEntry;
  const next = commit(label, (diagram) => setLinkedLayerOrder(diagram, stepId, layerOrder), join);
  return { changed: next !== null };
}

/** The summary a step's layer order record stores now; null for none, or a record that needs nothing. */
function storedAttentionOf(store: DiagramCaptureStore, stepId: string): LayerOrderAttention | null {
  const { diagram } = store.get();
  const source = diagram ? stepById(diagram, stepId)?.source : null;
  return source?.kind === 'cp' ? (layerOrderSummaryOf(source)?.attention ?? null) : null;
}

/** Whether two summaries say the same: the same reason, for as many constraints (shared with Edit's figures). */
export const sameAttention = sameLayerOrderAttention;

/** The layer order a capture asks `captureStep` to draw: one the dialog applied, the step's record, or none. */
function captureLayerOrderOf(
  request: DiagramCaptureRequest,
  stop: AbortSignal | undefined
): { layerOrder?: CaptureLayerOrder } {
  if (request.layerOrderApplied) return { layerOrder: { kind: 'applied', ...request.layerOrderApplied } };
  if (request.layerOrder === undefined) return {};
  return {
    layerOrder: {
      kind: 'record',
      json: request.layerOrder,
      resolve: layerOrderResolver(request.layerOrders),
      ...(stop ? { stop } : {}),
    },
  };
}

/**
 * The host engine as a capture asks it (`captureLayerOrder.ts`): a resolve on
 * Refresh all's batch, which keeps one worker across its steps, or on a
 * worker of its own, spawned for it and ended when it answers. Neither loads
 * a line of the engine until a step's record is resolved.
 */
export function layerOrderResolver(batch?: LayerOrderResolveBatch): CaptureLayerOrderResolve {
  return (source, record, stop) =>
    batch
      ? batch.resolve(source, record, undefined, stop ? { signal: stop } : {})
      : resolveLayerOrder(source, record, undefined, stop ? { signal: stop } : {});
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
  // A capture from outside Pose — Refresh, Refresh All, Show as, a Relink, an
  // Apply — restores the step's record afresh: a solutions cursor stepping it
  // goes (layer order H9), and the next press makes one from what it lands.
  dropStepSolutionCursor(stepId);
  try {
    const document = start.cp.document;
    const sheets = await abandonOnEngineLoss(ensureCpSheetIndex(document));
    const { diagram } = store.get();
    // A saved Defox view this replaces: a flat fold is shown as it showed it.
    const replaced = diagram ? stepById(diagram, stepId)?.source : null;
    const defoxView = replaced?.kind === 'cp' && replaced.render.mode === 'defox' ? replaced.render.snapshot : undefined;
    const capture = (runtime: CpCaptureRuntime, stop?: AbortSignal) =>
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
        ...captureLayerOrderOf(request, stop),
        ...(defoxView !== undefined ? { defoxView } : {}),
      });
    const result =
      request.render.mode === 'crease-pattern' || request.render.mode === 'simulated'
        ? // The kernel folds nothing: there is no run to show or stop.
          await capture(stepCaptureRuntime(start))
        : await runStepFold(store, start, request.kind, capture);
    if (result.status === 'needs-attention') {
      const flagged = commitStepLayerOrder(store, commit, start, result.layerOrder, request.label, request.joinEntry);
      return flagged ? { status: 'needs-attention', attention: result.attention, changed: flagged.changed } : { status: 'discarded' };
    }
    // Nothing checked, nothing written: no undo step, nothing to save.
    if (result.status === 'layer-order-lost') return { status: 'layer-order-lost', offline: result.cause === 'load' };
    if (result.status !== 'captured') return result;
    // What the step's record said before, to tell a summary this capture stored from one it kept.
    const before = storedAttentionOf(store, stepId);
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
      flagged: result.attention && !sameAttention(before, result.attention) ? result.attention : null,
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
 * budget — a bitmap of it in the diagram's pens, kept as an asset. A spread
 * the capture could not clip is drawn by the shared bitmap stage
 * (`rasterSpreadScene`), through the policy every bitmap was drawn in before
 * a surface could name its own.
 */
export async function keptPicture(
  captured: CapturedPicture,
  render: DiagramCpRender,
  style: DiagramStyle
): Promise<{ picture: DiagramPicture; asset?: KnownDiagramAsset }> {
  if (captured.kind === 'picture') return { picture: captured.picture };
  if (hasConnectedDrawing(captured.scene)) {
    const { raster } = await rasterSpreadScene(captured.scene, {
      style: diagramScenePaintStyle(style, false),
      policy: 'fold',
      mm: CAPTURE_RASTER_BOX_MM,
    });
    const src = `data:image/png;base64,${bytesToBase64(new Uint8Array(raster.png))}`;
    const id = `asset-raster-${digest(src)}`;
    return {
      picture: {
        kind: 'asset', assetId: id,
        paperScale: captured.paperScale === null ? null : captured.paperScale * raster.scale,
        styleKey: diagramStyleKey(style), key: `raster-${id}`, sceneFrame: raster.sceneFrame,
      },
      asset: { id, kind: 'raster', src, widthPx: raster.width, heightPx: raster.height, bytes: src.length },
    };
  }
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
  const margin = pageMarginPt(diagramScenePaintStyle(style, pattern), pagePaper) * CAPTURE_RASTER_DPI / 72 / pxPerScenePx;
  const sceneFrame: [number, number, number, number] = [
    captured.scene.bounds.minX - margin, captured.scene.bounds.minY - margin,
    width / pxPerScenePx, height / pxPerScenePx,
  ];
  return {
    picture: {
      kind: 'asset', assetId: id, paperScale, styleKey: diagramStyleKey(style), key: `raster-${id}`,
      ...(render.mode === 'folded-flat' && render.spread?.kind === 'connected' ? { sceneFrame } : {}),
    },
    asset: { id, kind: 'raster', src, widthPx: width, heightPx: height, bytes: src.length },
  };
}
