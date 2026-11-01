import { flushPendingEdits } from '../../../lib/pendingEdits';
import { patchTreemakerDesign, selectDesignViewportFitRequestId, selectProject } from '../designTabs';
import { withCpHistoryEntry } from '../cpHistory';
import { documentStateAfterSelection } from '../cpSelectedLines';
import {
  NO_CP_VERTEX_PINS,
  removeCpVertexPinsInBox,
  toggleCpVertexPin,
} from '../../../cp-workspace/pins/vertexPins';
import {
  ANALYTICS_EVENTS,
  bucketCount,
  COUNT_BUCKETS,
  FOLD_DURATION_MS_BUCKETS,
  track,
  trackDesignSentToEdit,
  trackLayerConstraintsDismissed,
  trackLayerConstraintsNeedAttention,
} from '../../../analytics';
import type { FoldMode, FoldVerdict } from '../../../analytics';
import { projectFromSnapshot } from '../../../engine/snapshotMapper';
import type { FoldArtifacts, FoldDocument, OptimizationReport } from '../../../engine/types';
import {
  DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
  emptyOristudioCpSelection,
  toggleCpSelectionList,
  type OristudioCpSelection,
} from '../../../lib/creasePatternViewport';
import {
  cpSelectionTransformLabel,
  selectedCpLineSegments,
  transformCpLineSegments,
} from '../../../lib/creasePatternClipboard';
import { DEFAULT_CREASE_COLOR_MODE } from '../../../lib/sampleProject';
import { withPaperStyleOverride } from '../../../lib/paper/paperStyle';
import { legacyPaperStyleOverrides } from '../../../lib/paper/paperStyleMigration';
import {
  buildSegmentSimulationFold,
  resolveCpSegments,
} from '../../../lib/creasePatternSegmentation';
import { MAX_CONCURRENT_SIMULATIONS } from '../../../simulator/simulatorLimits';
import {
  createInlineSimulation,
  resolveInlineSimulationSegment,
  sourceFingerprintFor,
  topInlineSimulationZ,
  type InlineSimulation,
} from '../../../cp-workspace/inlineSimulation/inlineSimulation';
import {
  clearInlineSimulationSource,
  getInlineSimulationSource,
  setInlineSimulationSource,
} from '../../../cp-workspace/inlineSimulation/inlineSimulationRuntime';
import { nextInlineSimulationId } from '../../../cp-workspace/inlineSimulation/inlineSimulationIds';
import { resolveInlineSimulationRegion } from '../../../cp-workspace/inlineSimulation/resolveSimulationRegion';
import { regionReferenceFor } from '../../../cp-workspace/regions/regionReference';
import { sheetRegions } from '../../../cp-workspace/sheets/cpSheetRegions';
import { ensureCpSheetSimulationArtifacts } from '../../../cp-workspace/sheets/cpSheetArtifacts';
import type { CpSheetRegion } from '../../../cp-workspace/sheets/cpSheetRegions';
import { ensureCpSheetIndex } from '../../../cp-workspace/sheets/cpSheetIndex';
import { DEFAULT_SIMULATOR_VIEW } from '../../../simulator/SimulatorViewport';
import { occupiedModelSpace } from '../occupiedModelSpace';
import { uprightRotationForView } from '../../../cp-workspace/annotations/annotationTransform';
import { cpOverlayViewStore } from '../../../cp-workspace/cpOverlayViewStore';
import {
  cpCheckSuppressionRules,
  partitionCpDiagnosticsBySuppression,
} from '../../../cp-workspace/diagnostics/checkSuppression';
import { countCpDiagnosticErrors } from '../../../cp-workspace/diagnostics/severity';
import { visibleCpDiagnosticEntries } from '../../../cp-workspace/diagnostics/visibleEntries';
import { cpSelectionSize } from '../../../lib/creasePatternViewport';
import { foldArtifactsFromFold, warnIfFacesWereInferred } from '../../../lib/creasePatternImport';
import {
  generatedCpLineage,
  markGeneratedCpLineageStale,
  stableTextDigest,
} from '../../../lib/oristudioCpLineage';
import { DEFAULT_FOLDED_MODEL, foldedFigureModelFromOrieditaMetadata } from '../../../lib/orieditaNativeMetadata';
import { NEW_FOLDED_FIGURE_SIDE } from '../../../lib/foldedFigureSides';
import {
  cpUserAnchorForLineIds,
  placeFoldedFigureBesideCp,
} from '../../../cp-workspace/adapters/cpFoldedToScene';
import i18n from '../../../i18n';
import {
  requestChoice,
  requestConfirmation,
  requestConfirmationWithOption,
} from '../../commandDialogStore';
import { useLayoutStore } from '../../layoutStore';
import { useSettingsStore } from '../../settingsStore';
import { selectWorkspaceCapabilities } from '../capabilities';
import { designKind } from '../../../designKinds/registry';
import { frameActiveCpDiagnostic, frameCpModelPoint } from '../cpDiagnosticFocus';
import { freshEditableCpState } from '../freshCreasePattern';
import {
  emptyFoldArtifactResourceState,
  readyFoldArtifactResourceState,
  staleFoldArtifactResourceState,
} from '../foldArtifactResource';
import {
  engineError,
  ensureTreeHandle,
  syncTreemakerProject,
  type EngineClient,
} from '../engineRuntime';
import { withDesignHandle } from '../../../engines/designHandles';
import { onEngineLost } from '../../../engines/engineHost';
import { fetchCpShareWithRetry } from '../../../cp-workspace/share/cpShareService';
import {
  createBlankOristudioCpDocument,
  openSharedCpPayload,
  duplicateOristudioCpFoldedFigure as duplicateRuntimeOristudioCpFoldedFigure,
  duplicateOristudioCp3dFoldedFigure as duplicateRuntimeOristudioCp3dFoldedFigure,
  deselectAllOristudioCp,
  exportOristudioCpDocumentAsFold,
  fold3dOristudioCpDocument as fold3dRuntimeOristudioCpDocument,
  fold3dOristudioCpFigureAnother as fold3dRuntimeOristudioCpFigureAnother,
  foldOristudioCpDocument as foldRuntimeOristudioCpDocument,
  foldOristudioCpFigureAnother as foldRuntimeOristudioCpFigureAnother,
  foldOristudioCpFigureToCase as foldRuntimeOristudioCpFigureToCase,
  foldOristudioCpWithOrder,
  freeOristudioCpFoldedFigure,
  getOristudioCpFoldedFigureDigest,
  getOristudioCpFoldedFigurePaperScene,
  getOristudioCpFoldedFigureRenderSnapshot as getRuntimeOristudioCpFoldedFigureRenderSnapshot,
  getOristudioCpFoldedFigureSnapshot,
  getOristudioCpFoldedFigureSource,
  getOristudioCpSelectionFoldSource,
  isFoldCancellation,
  loadOristudioCpDocumentFromText,
  releaseOristudioCpDocument,
  runOristudioCpCheckCommand,
  setOristudioCpFoldedFigureModel as setRuntimeOristudioCpFoldedFigureModel,
} from '../oristudioCpRuntime';
import { FOLD_RUN_NONE, foldCancellationAvailable } from '../../../lib/foldCancellation';
import {
  aimFoldStopAtOldestPending,
  stoppableFoldRuns,
  type FoldRunControls,
  type FoldRunOptions,
  withFoldInFlight as withFoldInFlightIn,
} from '../foldRuns';
import type {
  CreasePatternSlice,
  OristudioCpFigureLayerOrderOpening,
  OristudioCpFigureLayerOrderRefold,
  OristudioCpFigureSolutionStep,
  OristudioCpFoldWithChosenOrder,
  OristudioCpPressedFigure,
  OristudioCpSelectionLayerOrderOpening,
  OristudioCpFoldRunKind,
  WorkspaceSliceCreator,
  WorkspaceState,
} from '../types';
import {
  allowedAnnotationUpdate,
  type CanvasAnnotation,
} from '../../../cp-workspace/annotations/annotation';
import {
  adoptFoldedFigureHandle,
  adoptTransientFoldedFigureHandle,
  foldedFigureHandleEpoch,
  releaseFoldedFigureHandle,
  releaseFoldedFigureHandles,
  resetFoldedFigureHandles,
  retainFoldedFigureHandles,
  setFoldedFigureHandleFree,
} from '../../../cp-workspace/folded/foldedFigureHandles';
import {
  IDENTITY_FOLDED_PLACEMENT,
  isFoldedFromCurrentCpSourceKind,
} from '../../../engine/oristudioCpTypes';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpFold3dRefusal,
  OristudioCpFolded3dSnapshot,
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedFigureSnapshot,
  OristudioCpFoldedPaperScene,
  OristudioCpFoldedRenderSnapshot,
  OristudioCpFoldSource,
} from '../../../engine/oristudioCpTypes';
import {
  foldedFigureCurrentCase,
  foldedFigureCycling,
  foldedFigureModel,
  foldedModelsEqual,
  foldedSnapshotCase,
  reportedSolutions,
  sameFoldedOrder,
} from '../../../cp-workspace/folded/foldedFigureState';
import {
  foldedFiguresAtRest,
  foldedSelectionAtRest,
  holdFoldedFigureAtRest,
  holdFoldedPlaceholderAtRest,
} from '../../../cp-workspace/folded/foldedFiguresAtRest';
import { nextFoldedFigureId } from '../../../cp-workspace/folded/foldedFigureIds';
import { foldPressMoved, markFoldPress } from '../../../cp-workspace/folded/foldPress';
import {
  foldedFigureAwaitsFlatRefold,
  foldedFigureDetachedLayerOrder,
  foldedFigureLayerOrderBlock,
  foldedFigureLayerOrderHold,
  foldedFigureLayerOrderRecord,
  foldedFigureSolutionsHeldForReview,
  refoldHeldByLayerOrder,
  refoldHeldByLayerOrderReason,
  type FoldedFigureLayerOrderRefold,
} from '../../../cp-workspace/folded/foldedFigureLayerOrderState';
import {
  beginFoldedSolutionStep,
  watchFoldedSolutionCursor,
} from '../../../cp-workspace/folded/foldedSolutionCursor';
import { resolveLayerOrder } from '../../../layer-order/host/hostEngineGateway';
import { solutionPressOf } from '../../../layer-order/host/solutionCursorTable';
import {
  routed3dLayerOrderRecord,
  sameLayerOrderAttention,
  withLayerOrderAttention,
} from '../../../layer-order/host/layerOrderResolution';
import { dismissedFact, needsAttentionFact } from '../../../layer-order/model/layerOrderAnalytics';
import {
  foldedFigureLayerOrder,
  type FoldedFigureLayerOrder,
} from '../../../lib/layerOrder/foldedFigureLayerOrder';
import type { LayerOrderAttention } from '../../../lib/layerOrder/layerOrderRecord';
import { hasFoldedLayerOrder } from '../../../lib/creaseExportFold';
import {
  EDIT_PAPER_FRAME,
  layerOrderRecordFromSource,
  layerOrderRecordToSource,
} from '../../../lib/layerOrder/paperFrame';
import { kernelFoldSourceOf, layerOrderSourceOf } from '../../../lib/layerOrder/layerOrderSource';
import { noteSolutionFrontier } from '../../../cp-workspace/folded/foldedSolutionFrontiers';
import { resolveFoldRoute } from '../../../cp-workspace/folded/foldRoute';
import {
  fold3dRefusalMessage,
  fold3dRefusalNotice,
  type Fold3dRefusalNotice,
} from '../../../cp-workspace/folded/foldedFigureNotice';
import {
  defaultFolded3dCamera,
  folded3dFrameRadius,
} from '../../../cp-workspace/folded/folded3dCamera';
import { setFolded3dRenderModel } from '../../../cp-workspace/folded/folded3dRenderModels';
import {
  figuresAwaitFold,
  FoldMovedOn,
  isAwaitingFold,
} from '../../../cp-workspace/folded/foldLanding';
import {
  folded3dStoredSceneStyleChanged,
  project3dScene,
  reproject3dScene,
  reproject3dSceneAt,
} from '../../../cp-workspace/folded/folded3dReproject';
import {
  cpLinesByIds,
  foldedSourceBounds,
  foldedSourceFingerprint,
  isFoldedFigureStale,
  reselectFoldableLineIds,
  reselectSourceLineIds,
} from '../../../cp-workspace/folded/foldedFigureStaleness';
import {
  canRehydrateFolded3dFigure,
  folded3dSolutionReplaySteps,
  folded3dTargetSolution,
  sameFolded3dFrame,
} from '../../../cp-workspace/folded/folded3dRehydrate';
import type { WorkspaceCapabilityId } from '../../../lib/workspaceCapabilities';

/**
 * Opening a shared link over an existing document discards it, so ask first — the same
 * question File > Open asks, for the same reason.
 */
/** As `projectSlice`'s: pending drafts first, then `dirty` read through the getter. */
async function confirmDiscardDirtyProject(isDirty: () => boolean): Promise<boolean> {
  flushPendingEdits();
  if (!isDirty()) return true;
  return requestConfirmation({
    title: 'Discard unsaved changes?',
    message: 'Opening this shared crease pattern will replace your current work. Continue and discard it?',
    confirmLabel: 'Discard',
    tone: 'danger',
  });
}

/** What the user did with a refused 3D fold. */
type Fold3dRefusalAnswer = 'locate' | 'simulate' | 'cancel';

/**
 * Tell the user their pattern has no 3D figure, and offer the two next moves.
 *
 * Two dialog shapes, because there are two situations and one of them has an
 * extra thing to offer. When the refusal names a **place**, the user gets a real
 * choice — go and look at it, or simulate — and the message is the fact alone.
 * When it names none, this is the confirm dialog it has always been, word for
 * word.
 *
 * Which shape it takes is `notice.locate`, not the refusal code. It used to also
 * turn on whether the overlay had a row at that place, which put the four
 * refusals that *do* name a vertex back into the shape that names none — the
 * original defect. Measured over region-shaped selections across the corpus, that
 * is where they landed 4,979 times out of 5,100. `notice.locate` now carries the
 * place either way and says which route it is offering; this function does not
 * need to know, because the sentence it renders comes with it.
 */
async function requestFold3dRefusal(notice: Fold3dRefusalNotice): Promise<Fold3dRefusalAnswer> {
  const title = i18n.t('dialogs:fold3dRefused.title', 'This pattern can’t be folded in 3D');
  const simulateLabel = i18n.t('dialogs:fold3dRefused.simulate', 'Simulate');
  const simulateTrailer = i18n.t(
    'dialogs:fold3dRefused.simulateTrailer',
    'The simulator can fold it approximately.'
  );
  const cancelLabel = i18n.t('dialogs:common.cancel', 'Cancel');
  if (!notice.locate) {
    const simulate = await requestConfirmation({
      title,
      message: i18n.t('dialogs:fold3dRefused.message', '{{reason}} {{trailer}}', {
        reason: notice.message,
        trailer: simulateTrailer,
      }),
      confirmLabel: simulateLabel,
      cancelLabel,
    });
    return simulate ? 'simulate' : 'cancel';
  }
  // The trailer becomes the simulate option's own description rather than a
  // second clause of the message: it describes that button, and stacked options
  // are where this dialog states consequences (see `requestOpenOrImportChoice`).
  const picked = await requestChoice({
    title,
    message: notice.message,
    options: [
      { id: 'locate', label: notice.locate.label, description: notice.locate.description },
      { id: 'simulate', label: simulateLabel, description: simulateTrailer },
    ],
    cancelLabel,
  });
  return picked === 'locate' || picked === 'simulate' ? picked : 'cancel';
}

// Dedupe concurrent `ensureEditCreasePattern` calls (e.g. React StrictMode
// double-invoking the seeding effect) so only one blank document is created.
let ensureEditInFlight: Promise<void> | null = null;

/**
 * How many times a window's fold has been rebuilt, so each rebuild gets a fresh
 * model key and the worker's prepared-model cache cannot serve the old mesh.
 */
const inlineSimulationRevisions = new Map<string, number>();

/**
 * The rotation at which a newly created canvas object is upright on screen, in
 * the given space. Read from the imperative overlay-view store because placement
 * runs in the store, outside React — the same reason the canvas publishes it
 * there in the first place.
 */
function uprightFrameAngle(space: 'model' | 'user'): number {
  return uprightRotationForView(cpOverlayViewStore.get()?.[space] ?? null);
}

function inlineSimulationRevision(id: string): number {
  const next = (inlineSimulationRevisions.get(id) ?? 0) + 1;
  inlineSimulationRevisions.set(id, next);
  return next;
}

/**
 * Torn down when the slice is rebuilt, so a recreated store does not leave a
 * listener writing into the old one.
 */
let stopListeningForCpEngineLoss: (() => void) | null = null;
/** The same, for the store subscription that keeps the solutions cursor in step. */
let stopSettlingFoldedSolutionCursor: (() => void) | null = null;

export const createCreasePatternSlice: WorkspaceSliceCreator<CreasePatternSlice> = (
  set,
  get,
  api
) => {
  // A constrained figure's solutions cursor (H6) steps only the fold and the
  // record the figure holds, and only while the figure is in hand: an undo,
  // an Apply, a Delete, an edit to its creases, another selection, another
  // workspace, the Layer order dialog or a document closing lets it go, with
  // its worker (`foldedSolutionCursor.ts`). Nothing to do while none is kept.
  stopSettlingFoldedSolutionCursor?.();
  stopSettlingFoldedSolutionCursor = watchFoldedSolutionCursor(api);

  // A fold run is cleared by the `finally` of the call that started it, and a
  // Comlink call on a dead client never settles — so a CP worker that crashes
  // mid-fold (the large-CP case this feature exists for) leaves its run in the
  // map forever. That is not cosmetic: `stopOristudioCpFolds` answers `true`
  // while any cancellable run is listed, so Escape would be swallowed by a fold
  // that no longer exists for the rest of the session — no deselect, no
  // tool-input cancel, no leaving the text editor — under a non-dismissible
  // "Folding…" toast whose Stop writes into a dead worker's buffer.
  stopListeningForCpEngineLoss?.();
  stopListeningForCpEngineLoss = onEngineLost(({ engine }) => {
    if (engine !== 'oristudio-cp') return;
    if (Object.keys(get().oristudioCpFoldRuns).length === 0) return;
    set({ oristudioCpFoldRuns: {} });
  });

  // Handles are owned by reachability (live list + history), not by the delete
  // action — see cp-workspace/foldedFigureHandles.
  setFoldedFigureHandleFree((handle) => {
    // Forget what we believed about a slot the kernel is free to reuse.
    lastWrittenKernelModel.delete(handle);
    return freeOristudioCpFoldedFigure(handle);
  });

  /**
   * Note how far `handle`'s layer-order search has reached once the kernel
   * answered a step of `figure` with `snapshot` (`foldedSolutionFrontiers.ts`):
   * what the figure showed before the step, then what the kernel says now.
   * Answers how many solutions are known, which `fold solution cycled`
   * reports — not the kernel's own count, which a step back restarts.
   */
  function noteFoldedSolutions(
    figure: OristudioCpFoldedFigureEntry,
    handle: number,
    snapshot: Pick<OristudioCpFoldedFigureSnapshot, 'discovered_fold_cases' | 'find_another_overlap_valid'>
  ): number {
    const before = figure.folded3d ?? figure.snapshot;
    if (before) noteSolutionFrontier(handle, reportedSolutions(before));
    return noteSolutionFrontier(handle, reportedSolutions(snapshot)).cases;
  }

  let foldArtifactPromise: Promise<FoldArtifacts | null> | null = null;
  let foldArtifactPromiseRevision: number | null = null;
  // Newest artifact request. Loader-private rather than store state: a document
  // load resets the whole fold-artifact resource, so a counter kept there would
  // restart at zero and let a request still in flight for the previous document
  // match the id of the request for the new one — and publish its crease pattern
  // as the current document's.
  let foldArtifactRequestId = 0;
  // Newest in-flight model request per figure, so a stale response is dropped.
  const modelRequestSequence = new Map<string, number>();
  /**
   * Serializes *reconciles* per figure.
   *
   * Live edits stay concurrent: a colour picker fires a write per pointer move,
   * and queueing those would make every drag N round-trips deep. Reconciles are
   * different — they arrive in bursts (holding undo) and each re-reads the
   * desired state when it runs, so running them in order lets all but the first
   * collapse into no-ops.
   */
  const modelWriteChain = new Map<string, Promise<unknown>>();
  /**
   * Figures with live model edits in flight, counted; see
   * `reconcileFoldedFigureModel`. A count rather than a set because a colour
   * drag has several writes in flight at once, and the first to finish must not
   * unmask a reconcile while the rest are still landing.
   */
  const pendingLiveModelWrites = new Map<string, number>();
  /**
   * The model each figure's newest live write was issued with, while any write
   * is in flight. A partial update merges onto this rather than onto the store's
   * `snapshot.model`, which lags a round trip behind: merging onto the store let
   * two writes to different fields, issued back to back, drop whichever landed
   * first. Dropped once nothing is in flight — the store is authoritative again.
   */
  const issuedModels = new Map<string, OristudioCpFoldedFigureModel>();
  /**
   * Figures whose in-flight live writes were superseded from outside — an undo
   * mid-drag — and must reconcile once the stale write lands. The stale tick
   * writes nothing to the store, but it did reach the kernel, and the reconcile
   * scheduled by the undo ran while the write was still counted and so did not
   * write either.
   */
  const supersededLiveModelWrites = new Set<string>();

  function liveModelWriteCount(id: string): number {
    return pendingLiveModelWrites.get(id) ?? 0;
  }
  /**
   * Figures with a rehydrate in flight; see
   * `rehydrateOristudioCpFolded3dFigure`. The background queue and a press can
   * both name the same figure, and two folds of one figure would leak whichever
   * handle lost the race.
   */
  const pendingFolded3dRehydrations = new Set<string>();
  /**
   * Flat figures whose Layer order dialog is being opened; see
   * `prepareOristudioCpFigureLayerOrder`. A second press while one reads or
   * folds is refused rather than folding the figure twice.
   */
  const pendingLayerOrderOpens = new Set<string>();
  /**
   * A "Fold with layer order…" press still folding the selection; see
   * `prepareOristudioCpLayerOrderFold`. A second press meanwhile is refused
   * rather than folding the creases twice.
   */
  let selectionLayerOrderPending = false;
  /**
   * What we last wrote into each kernel handle, so a reconcile that would change
   * nothing costs a comparison instead of a round-trip. Cleared when the handle
   * is freed: the kernel may hand the same slot to a later figure, and a stale
   * belief about a reused slot would skip a write that was actually needed.
   */
  const lastWrittenKernelModel = new Map<number, OristudioCpFoldedFigureModel>();

  /** Run `task` after any reconcile already queued for `id`. */
  function enqueueModelWrite<T>(id: string, task: () => Promise<T>): Promise<T> {
    const prior = modelWriteChain.get(id) ?? Promise.resolve();
    const next = prior.then(task, task);
    // Swallow on the chain copy only; the returned promise keeps its rejection.
    modelWriteChain.set(id, next.then(undefined, () => undefined));
    return next;
  }

  /** Push `model` into the kernel and remember it, so reconciles can skip. */
  async function writeFoldedFigureModel(
    handle: number,
    model: OristudioCpFoldedFigureModel
  ): Promise<OristudioCpFoldedFigureSnapshot> {
    const snapshot = await setRuntimeOristudioCpFoldedFigureModel(handle, model);
    lastWrittenKernelModel.set(handle, model);
    return snapshot;
  }

  async function requireActiveTree() {
    const result = await ensureTreeHandle();
    if (result.initializedSnapshot) {
      set(syncTreemakerProject(get(), result.initializedSnapshot, selectProject(get()).title));
    }
    return result;
  }

  function parseFoldProjection(text: string): FoldDocument | null {
    try {
      return JSON.parse(text) as FoldDocument;
    } catch {
      return null;
    }
  }

  function hasFoldArtifactSource() {
    const state = get();
    if (state.oristudioCpDocument) return true;
    if (state.importedCreasePattern) return false;
    return selectProject(state).creases.length > 0 || selectProject(state).facets.length > 0;
  }

  async function confirmReplaceCustomizedGeneratedCp(): Promise<boolean> {
    const lineage = get().oristudioCpLineage;
    if (
      get().activeEditingContext !== 'treemaker-tree' ||
      lineage?.kind !== 'generated-from-tree' ||
      lineage.manualEditCount === 0
    ) {
      return true;
    }
    return requestConfirmation({
      title: 'Replace Edited CP?',
      message:
        'Rebuilding from the design will replace the editable crease pattern generated earlier. The tree stays unchanged.',
      confirmLabel: 'Replace CP',
      cancelLabel: 'Keep Current CP',
      tone: 'danger',
    });
  }

  function activeGeneratedFoldedFigure(): OristudioCpFoldedFigureEntry | null {
    const activeId = get().oristudioCpActiveFoldedFigureId;
    const figures = get().oristudioCpFoldedFigures;
    return (
      figures.find((figure) => figure.id === activeId) ??
      // Nothing selected: act on the most recent generated figure, which is the
      // one a just-completed fold produced.
      [...figures]
        .reverse()
        .find((figure) => isFoldedFromCurrentCpSourceKind(figure.sourceKind)) ??
      null
    );
  }

  async function renderSnapshotForFoldedFigure(
    handle: number,
    displayStyle: OristudioCpFoldedFigureDisplayStyle,
    index: number,
    selected: boolean
  ) {
    return getRuntimeOristudioCpFoldedFigureRenderSnapshot(handle, displayStyle, {
      // The camera/rotation marker (orange cross + purple selection disc) is not
      // used in this workspace — we always rotate about the origin and it only
      // inflated the figure's move hit-box. Omit it so the grab area is the
      // folded form itself.
      display_mark: false,
      selected,
      index,
    });
  }

  /**
   * Push a figure's stored model back into its kernel handle.
   *
   * Undo and redo swap the *web* entries only — deliberately, so an overlay-only
   * step stays synchronous and never reloads the wasm document. But a figure's
   * appearance lives in the kernel, and every history entry for a figure points
   * at the same mutable handle (see `cp-workspace/folded/foldedFigureHandles.ts`),
   * so after an undo the cached snapshot and the kernel disagree. Nothing shows
   * it until something re-renders from the kernel — a reselect is the cheapest
   * trigger — at which point the undone colour reappears.
   *
   * Reading the desired model *here*, at execution time rather than at schedule
   * time, is what makes a burst of undos correct: every queued reconcile sees
   * the state the burst settled on, so all but the first are skipped below.
   */
  /**
   * Take ownership of a freshly folded 3D handle for `id`, or give it back.
   *
   * Every 3D completion lands after an await, and in that window the figure it
   * targets can be deleted — the toolbar's delete verb stays enabled while a
   * figure is `loading` — or taken down with its document. Adopting anyway
   * writes the handle onto nothing: no entry and no history entry holds it, so
   * `releaseFoldedFigureHandle` is never called for it and a `Fold3dSession`
   * (up to 10.7 MiB, plus its render model) stays in the wasm heap for the life
   * of the tab, once per attempt.
   *
   * The rehydrate path has always made these two checks inline. This is the
   * same pair in one place, so the next completion path cannot quietly skip
   * them. Returns whether the caller may write the handle onto the entry.
   */
  async function adoptFolded3dHandle(
    figureId: string,
    epoch: number,
    handle: number,
    render: Parameters<typeof setFolded3dRenderModel>[1],
    { copyFrom }: { copyFrom?: number | null } = {}
  ): Promise<boolean> {
    const stillThere =
      foldedFigureHandleEpoch() === epoch &&
      get().oristudioCpFoldedFigures.some((candidate) => candidate.id === figureId);
    if (!stillThere) {
      await freeOristudioCpFoldedFigure(handle).catch(() => {});
      return false;
    }
    // A fresh session has reached only what this fold reports; a duplicate's, as far as its original.
    adoptFoldedFigureHandle(handle, copyFrom === undefined ? {} : { copyFrom });
    setFolded3dRenderModel(handle, render);
    return true;
  }

  async function reconcileFoldedFigureModel(id: string): Promise<void> {
    const figure = get().oristudioCpFoldedFigures.find((candidate) => candidate.id === id);
    // A figure the step removed, one reopened from a file without a handle, or a
    // 3D one — which keeps no appearance in the kernel at all, so there is
    // nothing for an undo to have put out of step.
    if (figure?.handle == null || !figure.snapshot) return;
    const handle = figure.handle;
    const desired = figure.snapshot.model;
    if (foldedModelsEqual(lastWrittenKernelModel.get(handle), desired)) return;
    // A live edit issued while this sat in the queue is newer intent than the
    // history position that scheduled it, and its response lands after ours.
    if (liveModelWriteCount(id) > 0) return;

    const requestId = (modelRequestSequence.get(id) ?? 0) + 1;
    modelRequestSequence.set(id, requestId);
    try {
      const snapshot = await writeFoldedFigureModel(handle, desired);
      const renderSnapshot = await renderSnapshotForFoldedFigure(
        handle,
        figure.displayStyle,
        foldedFigureIndex(id),
        get().oristudioCpActiveFoldedFigureId === id
      );
      if (modelRequestSequence.get(id) !== requestId) return;
      set({
        oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
          candidate.id === id ? { ...candidate, snapshot, renderSnapshot, error: null } : candidate
        ),
      });
    } catch (error) {
      // Deliberately not swallowed. A failed reconcile leaves the kernel and the
      // cache disagreeing, which is the exact condition this exists to prevent —
      // surfacing it beats drifting silently.
      const normalized = engineError(error);
      lastWrittenKernelModel.delete(handle);
      set({
        oristudioCpError: normalized.message,
        oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
          candidate.id === id
            ? { ...candidate, status: 'error', error: normalized.message }
            : candidate
        ),
      });
    }
  }

  async function refreshFoldedFigureSelectionMarker(id: string | null | undefined) {
    if (!id) return;
    const figure = get().oristudioCpFoldedFigures.find((candidate) => candidate.id === id);
    // Handle 0 is a valid wasm slot index; only null/undefined means "not ready".
    if (figure?.handle == null) return;
    // A 3D figure has no kernel marker to refresh. Its selection chrome comes
    // from the canvas-object overlay, and the kernel's own mark is disabled
    // anyway (`display_mark: false`), so re-projecting here would spend a whole
    // render to change nothing.
    if ((figure.folded3d ?? null) !== null) return;
    const selected = get().oristudioCpActiveFoldedFigureId === id;
    try {
      const renderSnapshot = await renderSnapshotForFoldedFigure(
        figure.handle,
        figure.displayStyle,
        foldedFigureIndex(id),
        selected
      );
      if ((get().oristudioCpActiveFoldedFigureId === id) !== selected) return;
      set({
        oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
          candidate.id === id ? { ...candidate, renderSnapshot } : candidate
        ),
      });
    } catch {
      // Selection marker refreshes are view-state updates; folding operations surface render errors.
    }
  }

  function refreshFoldedFigureSelectionMarkers(...ids: Array<string | null | undefined>) {
    const uniqueIds = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    void Promise.all(uniqueIds.map((id) => refreshFoldedFigureSelectionMarker(id)));
  }

  /**
   * Push one overlay-layer undo entry: the state *before* an action that touched
   * only annotations and/or folded figures, never the wasm document. Shared by
   * both overlay layers so the entry shape and the redo-stack clear can't drift.
   *
   * Deliberately unconditional. A "did anything change?" guard belongs to the
   * *bracket* that snapshots and records around a verb, not here: half this
   * function's callers record before mutating and half after, so comparing the
   * entry against live state here would suppress the entries of the first half.
   * See `commitFoldedFigureGesture`, which owns both ends and can therefore ask
   * the question soundly.
   */
  function pushOverlayHistoryEntry(input: {
    annotations: CanvasAnnotation[];
    foldedFigures: OristudioCpFoldedFigureEntry[];
    activeFoldedFigureId: string | null;
    /** Windows before the action. Omit to capture the live list. */
    inlineSimulations?: InlineSimulation[];
    label: string;
  }): void {
    if (!get().oristudioCpDocument) return;
    // Never a figure mid-press: an undo would put back one that waits forever
    // (`foldedFiguresAtRest.ts`).
    const foldedFigures = foldedFiguresAtRest(input.foldedFigures);
    // The new entry keeps its figures' handles alive for as long as undo can
    // reach them; anything the cap or the cleared redo stack drops lets go.
    retainFoldedFigureHandles(foldedFigures);
    // No `document`: undo of an overlay step leaves the crease pattern alone.
    const past = withCpHistoryEntry(get().oristudioCpHistoryPast, {
      selection: get().oristudioCpSelection,
      annotations: input.annotations,
      foldedFigures,
      activeFoldedFigureId: foldedSelectionAtRest(input.activeFoldedFigureId, input.foldedFigures),
      // Captured on every overlay entry, not only the window ones. An
      // annotation edit that omitted them would produce an entry whose undo
      // leaves windows alone — which is right — but the field is also how a
      // *later* undo past that point knows what the windows were, so a hole
      // here would restore the wrong list.
      inlineSimulations: input.inlineSimulations ?? get().oristudioCpInlineSimulations,
      overlayOnly: true,
      label: input.label,
      timestamp: new Date().toISOString(),
    });
    for (const entry of get().oristudioCpHistoryFuture) {
      releaseFoldedFigureHandles(entry.foldedFigures ?? []);
    }
    set({
      oristudioCpHistoryPast: past,
      oristudioCpHistoryFuture: [],
      dirty: true,
    });
  }

  function foldedFigureIndex(id: string): number {
    const index = get().oristudioCpFoldedFigures.findIndex((candidate) => candidate.id === id);
    return Math.max(index + 1, 1);
  }

  /**
   * Give each of `simulations` the fold its solver runs: its sheet's own mesh
   * (`sheetSimulationFold`), the sheet found by the window's outline. Returns
   * how many got one.
   *
   * Shared by loading a file and by undoing a delete. Each sheet's mesh is
   * built once per crease geometry and cached with its faces, so windows over
   * one sheet share it, and nothing meshes the whole canvas.
   *
   * Deliberately writes no descriptor state. Recomputing `sourceFingerprint`
   * from the current document is the one change here that would look harmless
   * and disable staleness for good: a window can legitimately be out of date,
   * and both callers can be looking at one.
   */
  async function buildInlineSimulationSources(simulations: InlineSimulation[]): Promise<number> {
    const document = get().oristudioCpDocument?.document ?? null;
    const index = await ensureCpSheetIndex(document);
    if (!document || !index) return 0;
    const sheets = sheetRegions(index);

    let built = 0;
    for (const simulation of simulations) {
      const sheet = resolveInlineSimulationSegment(simulation, sheets);
      // A region that no longer resolves keeps its window and its provenance.
      // Dropping it would lose placement the user chose, and re-pointing it at
      // the nearest region would silently simulate something else — the rule
      // refresh already follows.
      const fold = sheet ? await sheetSimulationFold(document, sheet) : null;
      if (!fold) continue;
      setInlineSimulationSource(simulation.id, {
        fold,
        modelKey: `${simulation.id}:${inlineSimulationRevision(simulation.id)}`,
      });
      built += 1;
    }
    return built;
  }

  /**
   * The fold a window over `sheet` solves: the sheet's own mesh, or null when it
   * has none to give.
   */
  async function sheetSimulationFold(
    document: OristudioCpDocumentSnapshot,
    sheet: CpSheetRegion
  ): Promise<FoldDocument | null> {
    const artifacts = await ensureCpSheetSimulationArtifacts(document, sheet.id);
    const [segment] = resolveCpSegments(artifacts);
    if (!artifacts || !segment) return null;
    const fold = buildSegmentSimulationFold(artifacts, segment);
    return (fold.faces_vertices?.length ?? 0) > 0 ? fold : null;
  }

  /**
   * Clear the kernel document's own selection flags.
   *
   * The frontend mirror is not the whole story: the kernel is authoritative for
   * select operations, so a mirror cleared on its own leaves stale flags behind
   * and the next select/deselect re-derives the old set.
   *
   * Best-effort and fire-and-forget — a deselect is UI state, and holding a
   * synchronous selection change on a wasm round-trip would be worse than a
   * missed one.
   */
  function deselectCreasesInKernel(): void {
    const started = get().oristudioCpDocument;
    if (!started) return;
    void (async () => {
      try {
        const cleared = await deselectAllOristudioCp();
        if (!cleared) return;
        // The cleared flags go onto the store's snapshot, or onto a fresh copy
        // of the document if an edit or undo was asked for meanwhile.
        const documentState = await documentStateAfterSelection(
          started,
          get().oristudioCpDocument,
          cleared,
          { ids: new Uint32Array(0), values: new Int32Array(0) },
          null
        );
        // Guard against a selection made while the round-trip was in flight:
        // the deselected state is only safe to adopt if nothing has since
        // taken the canvas selection back for the creases.
        if (cpSelectionSize(get().oristudioCpSelection) === 0) {
          set({ oristudioCpDocument: documentState });
        }
      } catch {
        // A deselect is best-effort UI state; ignore kernel errors.
      }
    })();
  }

  /**
   * Hand the canvas's single selection to `owner`, clearing whatever held it.
   *
   * The canvas shows one thing selected at a time: a crease selection, or one
   * annotation, or one folded figure, or one focused simulation window. Every
   * write to those four fields goes through here.
   *
   * It is a function rather than a patch object because giving up a selection
   * is not only a field write. Creases have to be deselected in the kernel too,
   * and a folded figure that loses selection has to redraw without its marker —
   * side effects that were previously attached to two of the setters and
   * therefore missing from every other path that changed the same fields.
   *
   * `owner` names who is taking it; `patch` carries the new id and anything else
   * the caller is setting in the same transition, so this stays one `set`.
   */
  function takeCanvasSelection(
    owner: 'creases' | 'annotation' | 'folded-figure' | 'inline-simulation' | 'none',
    patch: Partial<WorkspaceState> = {}
  ): void {
    const previousFoldedId = get().oristudioCpActiveFoldedFigureId;
    const releasingCreases =
      owner !== 'creases' && cpSelectionSize(get().oristudioCpSelection) > 0;
    const releasingFoldedFigure = owner !== 'folded-figure' && previousFoldedId !== null;

    // Orbit focus is narrower than folded-figure selection: it belongs to one
    // figure, so it has to go when the selection moves to a different one, not
    // only when it leaves folded figures altogether. The patch is what names the
    // new figure, so the comparison has to read from it rather than from state.
    const focusedFoldedId = get().oristudioCpFocusedFoldedFigureId;
    const nextFoldedId =
      'oristudioCpActiveFoldedFigureId' in patch
        ? (patch.oristudioCpActiveFoldedFigureId ?? null)
        : previousFoldedId;
    const keepsFoldedFocus =
      owner === 'folded-figure' && focusedFoldedId !== null && nextFoldedId === focusedFoldedId;

    set({
      ...(owner === 'creases' ? {} : { oristudioCpSelection: emptyOristudioCpSelection() }),
      ...(owner === 'annotation' ? {} : { oristudioCpSelectedAnnotationId: null }),
      ...(owner === 'folded-figure' ? {} : { oristudioCpActiveFoldedFigureId: null }),
      ...(keepsFoldedFocus ? {} : { oristudioCpFocusedFoldedFigureId: null }),
      ...(owner === 'inline-simulation'
        ? {}
        : { oristudioCpFocusedInlineSimulationId: null }),
      ...patch,
    });

    if (releasingCreases) deselectCreasesInKernel();
    if (releasingFoldedFigure) refreshFoldedFigureSelectionMarkers(previousFoldedId);
  }

  /**
   * Give up `owner`'s claim on the canvas — and only that claim.
   *
   * Releasing is deliberately asymmetric to taking: whatever else holds a
   * selection stays where it is, so a tool that clears the annotation as it
   * starts does not also drop the creases it is about to act on. Folded-figure
   * focus is narrower than folded-figure selection and goes with it — a figure
   * that kept focus after being deselected would go on turning under every drag
   * that landed on it. One name for the three release sites, so the rule has one
   * place to be read.
   */
  function releaseCanvasSelection(owner: 'annotation' | 'folded-figure' | 'inline-simulation'): void {
    switch (owner) {
      case 'annotation':
        set({ oristudioCpSelectedAnnotationId: null });
        return;
      case 'folded-figure':
        set({ oristudioCpActiveFoldedFigureId: null, oristudioCpFocusedFoldedFigureId: null });
        return;
      case 'inline-simulation':
        set({ oristudioCpFocusedInlineSimulationId: null });
        return;
    }
  }

  /**
   * Apply a crease selection under the canvas invariant.
   *
   * A selection that names nothing is a release rather than a claim, so it
   * leaves a selected canvas object where it is — otherwise every tool that
   * clears the selection as it starts would also drop the reference image or
   * folded figure the user was working next to.
   */
  function applyCreaseSelection(oristudioCpSelection: OristudioCpSelection): void {
    if (cpSelectionSize(oristudioCpSelection) === 0) {
      set({ oristudioCpSelection });
      return;
    }
    takeCanvasSelection('creases', { oristudioCpSelection });
  }

  /** Never one this session has seen: a file's, its layer order bag's, or one deleted (`foldedFigureIds.ts`). */
  function nextGeneratedFoldedFigureId(): string {
    return nextFoldedFigureId(get().oristudioCpFoldedFigures);
  }

  /**
   * Answer "simulate it instead" for a fold that has no flat folded form.
   *
   * An inline window, so the 3D answer lands beside the crease pattern the
   * question was asked about rather than in another workspace — the same result
   * as the selection toolbar's simulate-inline action, which is where this fold
   * was invoked from.
   *
   * Resolved from the ids the fold was scoped to rather than the live selection:
   * the toolbar clears the selection the moment it dispatches an action, so by
   * the time the dialog is answered there is nothing selected to resolve.
   *
   * Falls back to the Simulate panel when those ids are not one whole region —
   * the folded-figure inspector folds an arbitrary crease selection — and when
   * the window cap is reached. A simulation the store cannot open inline is
   * still one the panel can run, and this slice has no channel to say otherwise
   * (see `addOristudioCpInlineSimulation` on why it does not toast).
   */
  async function simulateNonFlatRegion(
    document: OristudioCpDocumentSnapshot,
    lineIds: readonly number[]
  ): Promise<void> {
    const region = await resolveInlineSimulationRegion(document, lineIds);
    const opened = region
      ? await get().addOristudioCpInlineSimulation({
          segment: region.segment,
          cpLineIds: region.cpLineIds,
        })
      : 'unavailable';
    if (opened !== 'added') useLayoutStore.getState().activatePanel('simulator');
  }

  /**
   * The provenance a fold records: the bounding box of the creases folded, plus
   * a fingerprint of them, so the figure can later be compared against a fresh
   * reselect of that region. Oriedita's refold check, ported per figure — see
   * `lib/foldedFigureStaleness.ts`.
   */
  function foldedSourceProvenance(
    document: OristudioCpDocumentSnapshot,
    lineIds: readonly number[],
    scopedLineIds: readonly number[] = lineIds
  ): Pick<
    OristudioCpFoldedFigureEntry,
    'sourceBounds' | 'sourceFingerprint' | 'sourceLineIds' | 'sourceScopedLineIds'
  > {
    const lines = cpLinesByIds(document, lineIds);
    const bounds = foldedSourceBounds(lines);
    // Fingerprint the *reselected* set, not the folded one: they can differ when
    // a crease merely crosses the region, and staleness compares against a
    // reselect, so seeding from anything else would report stale immediately.
    const reselected = cpLinesByIds(document, reselectFoldableLineIds(document, bounds));
    return {
      sourceBounds: bounds,
      sourceFingerprint: bounds ? foldedSourceFingerprint(reselected) : null,
      sourceLineIds: [...lineIds],
      // Both lists, because neither is derivable from the other and the two
      // answer different questions: the kernel indexes into the filtered one,
      // and a region is matched only by the unfiltered one.
      sourceScopedLineIds: [...scopedLineIds],
    };
  }

  /**
   * Whether a completed fold actually produced something to draw.
   *
   * A fold can return without a result: a global flat-foldability contradiction
   * concludes at the transparent development with no layer ordering
   * (`conclude_with_contradiction`). Mirrors the canvas's own renderability test
   * so "we will show this" and "we will keep this" cannot disagree.
   */
  function isDrawableFoldResult(
    snapshot: OristudioCpFoldedFigureEntry['snapshot'],
    renderSnapshot: OristudioCpFoldedFigureEntry['renderSnapshot']
  ): boolean {
    return Boolean(renderSnapshot?.primitives.length || snapshot?.wireframe);
  }

  /**
   * The analytics verdict for a fold that produced a drawable figure.
   *
   * Reads the kernel's own `outcome` rather than re-deriving it from
   * `estimation_step`, which cannot tell "no valid layer ordering exists" from
   * "nobody asked for one". A figure from a build before that field existed
   * carries no outcome, and `folded` is the honest answer there: it drew.
   */
  function foldVerdictForOutcome(
    snapshot: OristudioCpFoldedFigureEntry['snapshot']
  ): FoldVerdict {
    switch (snapshot?.outcome) {
      case 'NoSolutions':
        return 'no-solutions';
      case 'Contradiction':
        return 'contradiction';
      default:
        return 'folded';
    }
  }

  /**
   * The analytics verdict for a **3D** fold that placed a figure.
   *
   * Three of the four arms are new names rather than reused ones: a 3D figure
   * that passes through itself is not the flat path's `contradiction`, and
   * conflating them would make one series mean two things.
   */
  function fold3dVerdictForAnalytics(snapshot: OristudioCpFolded3dSnapshot): FoldVerdict {
    switch (snapshot.verdict.verdict) {
      case 'local_crossing':
        return 'local-crossing';
      case 'transversal_crossing':
        return 'transversal-crossing';
      case 'no_layer_order':
        return 'no-layer-order';
      case 'folded':
        return 'folded';
    }
  }

  /**
   * The bounded enum a `no_layer_order` verdict carries, and nothing else.
   *
   * Deliberately *not* the reason's fields: `component`, `faces`, `variables`,
   * `permutations` and the face ids are exact counts of the user's own content.
   * The code alone says which of the eight ways the search ended.
   */
  function fold3dVerdictProperties(snapshot: OristudioCpFolded3dSnapshot): {
    order_reason?: string;
  } {
    return snapshot.verdict.verdict === 'no_layer_order'
      ? { order_reason: snapshot.verdict.reason.code }
      : {};
  }

  /**
   * Drop a fold in progress and say why.
   *
   * The counterpart of {@link restorePreviousFigure} for a *first* fold, which
   * has no previous figure to put back — only the placeholder entry the list is
   * already showing. Leaving that behind as a `ready` figure with nothing in it
   * is the failure this exists to prevent; leaving it behind as a permanently
   * errored one would just be a different piece of debris on the canvas.
   */
  function discardFoldedFigureDraft(figureId: string, message: string): false {
    discardFoldedFigureDraftQuietly(figureId);
    set({ oristudioCpError: message, error: { code: 'invalid_operation', message } });
    return false;
  }

  /**
   * The same discard, with nothing to report.
   *
   * A stopped fold is not a failed one, and the two helpers above both write an
   * `error` envelope unconditionally — which `GlobalToasts` turns into an error
   * toast. Restoring the crease selection is the other half: the draft entry
   * cleared the canvas selection when it was inserted, and putting it back
   * leaves the user exactly where they pressed `G`. Upstream drops the selection at dispatch
   * (`FoldAction.foldCreasePattern` calls `unselect_all`), so keeping it is a
   * deliberate improvement rather than parity.
   */
  function discardFoldedFigureDraftQuietly(
    figureId: string,
    selection?: OristudioCpSelection
  ): false {
    set({
      oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.filter(
        (candidate) => candidate.id !== figureId
      ),
      oristudioCpActiveFoldedFigureId: null,
    });
    // Through the canonical path rather than a field write: handing the canvas
    // selection back to the creases is an ordinary claim, and the invariant that
    // one thing is selected at a time is `takeCanvasSelection`'s to keep.
    if (selection) applyCreaseSelection(selection);
    return false;
  }

  /**
   * Where a press's fold lands: the figure `figureId` it marked `loading`,
   * holding `holding` (null for a placeholder it added), in this generation of
   * handles. Each check throws {@link FoldMovedOn} once an undo, a redo, a
   * Delete or a new document has taken that figure from the press; its catch
   * frees the fold ({@link foldLandedOnNothing}). See `foldLanding.ts`.
   */
  function foldLanding(figureId: string, holding: number | null) {
    const epoch = foldedFigureHandleEpoch();
    /** Whether the figure the press marked is still there to land on, in this generation of handles. */
    const holds = () =>
      foldedFigureHandleEpoch() === epoch && figuresAwaitFold(get().oristudioCpFoldedFigures, figureId, holding);
    const check = (handle: number) => {
      if (!holds()) throw new FoldMovedOn(handle);
    };
    return {
      holds,
      check,
      /** The new fold's picture, the last thing a flat landing waits for, then the check. */
      async picture(...args: Parameters<typeof renderSnapshotForFoldedFigure>) {
        const picture = await renderSnapshotForFoldedFigure(...args);
        check(args[0]);
        return picture;
      },
    };
  }

  /** A fold whose figure moved on while it ran: nothing adopted it, so it is freed. */
  async function foldLandedOnNothing(moved: FoldMovedOn): Promise<false> {
    await freeOristudioCpFoldedFigure(moved.handle).catch(() => {});
    return false;
  }

  /**
   * Put a figure back exactly as it was and report why, for a refold that could
   * not produce a replacement. The figure itself was never invalid — the crease
   * pattern is — so destroying it would lose work over someone else's problem.
   */
  function restorePreviousFigure(
    previous: OristudioCpFoldedFigureEntry,
    message: string
  ): boolean {
    restorePreviousFigureQuietly(previous);
    set({ oristudioCpError: message, error: { code: 'invalid_operation', message } });
    return false;
  }

  /**
   * The same restore, for a fold the user stopped. See {@link discardFoldedFigureDraftQuietly}.
   * Only onto the figure the press left `loading`: one an undo or a redo put
   * in its place meanwhile is history's, and stays (`foldLanding.ts`).
   */
  function restorePreviousFigureQuietly(previous: OristudioCpFoldedFigureEntry): false {
    set({
      oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
        isAwaitingFold(candidate, previous.id, previous.handle) ? previous : candidate
      ),
    });
    return false;
  }

  /**
   * A fold of `source` made for the Layer order dialog alone, at case
   * `target` of Oriedita's search: the figure keeps its own. The count holds
   * it, and whoever opens the dialog on it lets go through `release`
   * (`adoptTransientFoldedFigureHandle`). Null when the search does not reach
   * that case again.
   */
  async function ownLayerOrderFold(
    source: OristudioCpFoldSource,
    model: OristudioCpFoldedFigureModel,
    target: number,
    runId: number
  ): Promise<{ handle: number; release: () => void } | null> {
    // No order given: Oriedita's own search, as a plain fold of these creases runs it.
    const result = await foldOristudioCpWithOrder(source, new Uint32Array(), model, runId);
    if (result.status !== 'folded') return null;
    const release = adoptTransientFoldedFigureHandle(result.handle);
    try {
      let snapshot = result.snapshot;
      if (foldedSnapshotCase(snapshot) !== target) {
        snapshot = (await foldRuntimeOristudioCpFigureToCase(result.handle, target, 'Order5', runId)).snapshot;
      }
      if (foldedSnapshotCase(snapshot) === target) return { handle: result.handle, release };
    } catch (error) {
      release();
      throw error;
    }
    release();
    return null;
  }

  /**
   * Put `folded`, a fold with a chosen order of a source whose faces are
   * `digest`'s, on `figure` in place of the fold it holds, with `layerOrder`
   * as its record: an Apply's landing (row H3) and a constrained step's (H6).
   * The digest is checked again on the new fold, which must solve and draw;
   * false when it doesn't, with the fold freed and the figure untouched, for
   * the caller to say why. Throws {@link FoldMovedOn} once its figure moved on
   * (`landing`), the fold freed. `onLanding` runs just before the figure shows
   * the new fold, and `also` is what else the figure takes with it (an Apply
   * that refolds re-baselines it, read then). The old fold is let go only once
   * the new one is in place: history may hold it, and an undo shows the order
   * it draws.
   */
  async function landChosenOrderFold(
    figure: OristudioCpFoldedFigureEntry,
    folded: { handle: number; snapshot: OristudioCpFoldedFigureSnapshot },
    digest: string,
    layerOrder: FoldedFigureLayerOrder,
    landing: ReturnType<typeof foldLanding>,
    {
      projectMessage,
      onLanding,
      also,
    }: {
      projectMessage: string;
      onLanding?: (handle: number) => void;
      also?: () => Partial<OristudioCpFoldedFigureEntry>;
    }
  ): Promise<boolean> {
    const free = () => freeOristudioCpFoldedFigure(folded.handle).catch(() => {});
    let renderSnapshot: OristudioCpFoldedRenderSnapshot | null;
    try {
      // The digest again, on the new fold: its faces are the ones the order names.
      if ((await getOristudioCpFoldedFigureDigest(folded.handle)) !== digest || folded.snapshot.outcome !== 'Solved') {
        await free();
        return false;
      }
      renderSnapshot = await landing.picture(folded.handle, figure.displayStyle, foldedFigureIndex(figure.id), true);
      if (!isDrawableFoldResult(folded.snapshot, renderSnapshot)) {
        await free();
        return false;
      }
    } catch (error) {
      await free();
      throw error;
    }
    adoptFoldedFigureHandle(folded.handle);
    onLanding?.(folded.handle);
    const more = also?.() ?? {};
    takeCanvasSelection('folded-figure', {
      oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
        candidate.id === figure.id
          ? {
              ...candidate,
              handle: folded.handle,
              status: 'ready',
              snapshot: folded.snapshot,
              renderSnapshot,
              contradiction: folded.snapshot.contradiction ?? null,
              error: null,
              layerOrder,
              ...more,
            }
          : candidate
      ),
      oristudioCpActiveFoldedFigureId: figure.id,
      oristudioCpError: null,
      dirty: true,
      projectMessage,
    });
    releaseFoldedFigureHandle(figure.handle);
    return true;
  }

  /**
   * The fold a constrained figure's step starts its cursor on: its live fold's
   * source, or, reopened from a file, its creases as they stand (not stale:
   * `foldedFigureLayerOrderBlock` refuses that), read without folding. Null
   * when its creases no longer fold flat.
   */
  function constrainedStepSource(
    figure: OristudioCpFoldedFigureEntry,
    document: OristudioCpDocumentSnapshot
  ): (() => Promise<OristudioCpFoldSource>) | null {
    const handle = figure.handle;
    if (handle !== null) return () => getOristudioCpFoldedFigureSource(handle);
    if (figure.sourceBounds == null) return null;
    const route = resolveFoldRoute(document, reselectFoldableLineIds(document, figure.sourceBounds));
    if (route.kind !== 'flat') return null;
    return () => getOristudioCpSelectionFoldSource(route.lineIds, figure.startingFaceId ?? 1);
  }

  /**
   * `layer constraints need attention` for an Edit figure (spec §10), once the
   * summary its record stores changes to one that needs a look: never again
   * for a figure refolded while flagged as it was, and never for an order
   * chosen with no constraint (D16), where nothing is broken.
   */
  function trackFigureLayerOrderAttention(was: LayerOrderAttention | null, now: LayerOrderAttention | null): void {
    if (!now || now.count === 0 || sameLayerOrderAttention(was, now)) return;
    trackLayerConstraintsNeedAttention(needsAttentionFact('edit_figure', now.count).properties);
  }

  /**
   * A figure's layer order as a refold onto creases that fold in 3D keeps it
   * (D13): flagged as waiting until they fold flat again. A newer build's,
   * and one flagged so already, as they were.
   */
  function routed3dFigureLayerOrder(
    layerOrder: FoldedFigureLayerOrder | null | undefined
  ): FoldedFigureLayerOrder | null | undefined {
    if (layerOrder?.kind !== 'record') return layerOrder;
    const routed = routed3dLayerOrderRecord(layerOrder.record);
    if (routed === layerOrder.record) return layerOrder;
    const held = foldedFigureLayerOrder(routed);
    return held.ok ? held.layerOrder : layerOrder;
  }

  /**
   * A refold whose constraints could not be drawn (D10): the figure keeps its
   * picture, and its record is flagged with `attention` — one undo entry, the
   * Refold's, when that changes what it stores, and none when it was flagged
   * so already. Only onto the figure the press marked (`foldLanding.ts`).
   */
  function keepFigureLayerOrderFlagged(
    previous: OristudioCpFoldedFigureEntry,
    held: Extract<FoldedFigureLayerOrder, { kind: 'record' }>,
    kept: Extract<FoldedFigureLayerOrderRefold, { kind: 'kept' }>,
    landing: ReturnType<typeof foldLanding>,
    report: ((outcome: FoldedFigureLayerOrderRefold) => void) | undefined
  ): false {
    // Moved on meanwhile (an undo, a Delete, a new document): nothing to keep it on.
    if (!landing.holds()) return false;
    const flagged = foldedFigureLayerOrder(withLayerOrderAttention(held.record, kept.attention));
    if (!flagged.ok || (flagged.layerOrder.kind === 'record' && flagged.layerOrder.json === held.json)) {
      restorePreviousFigureQuietly(previous);
    } else {
      set({
        oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
          isAwaitingFold(candidate, previous.id, previous.handle) ? { ...previous, layerOrder: flagged.layerOrder } : candidate
        ),
        oristudioCpError: null,
        dirty: true,
      });
    }
    trackFigureLayerOrderAttention(held.record.attention ?? null, kept.attention);
    report?.(kept);
    return false;
  }

  /**
   * What an Apply that also refolds a stale figure (D12) re-baselines it on,
   * as a refold does: its region's creases as they are now — while they are
   * still the ones the dialog opened on (`refold`). Null once they moved
   * again, and the figure stays stale: its picture is not of them.
   */
  function refoldedProvenance(
    figure: OristudioCpFoldedFigureEntry,
    refold: OristudioCpFigureLayerOrderRefold
  ): Partial<OristudioCpFoldedFigureEntry> | null {
    const document = get().oristudioCpDocument?.document;
    if (!document || figure.sourceBounds == null) return null;
    const route = resolveFoldRoute(document, reselectFoldableLineIds(document, figure.sourceBounds));
    if (route.kind !== 'flat') return null;
    const provenance = foldedSourceProvenance(
      document,
      route.lineIds,
      reselectSourceLineIds(document, figure.sourceBounds)
    );
    if ((provenance.sourceFingerprint ?? null) !== refold.sourceFingerprint) return null;
    return { ...provenance, sourceCpRevision: get().oristudioCpRevision };
  }

  /**
   * Refold a flat figure that carries a chosen layer order (row H4): its
   * creases as they are now are read without folding (`fold_source_of_selection`),
   * its record is restored onto them through the host engine (H2), inside the
   * Refold's own visible, stoppable run, and an order that applied is folded
   * with the relations it rebuilds (`fold_with_order`) into a new handle,
   * whose faces must still be the ones restored on (the digest). Drawn, the
   * figure takes it with the record of the order it shows, re-baselined on
   * the creases, as any refold.
   *
   * Otherwise (D10) nothing is applied greedily: on a clash, a timeout, or a
   * refusal of the engine's or the kernel's, the figure keeps its picture and
   * its record is flagged ({@link keepFigureLayerOrderFlagged}); with no
   * engine to ask (offline, crashed) nothing was checked and nothing is
   * written; a Stop puts it back as it was.
   */
  async function refoldFigureInLayerOrder(
    figure: OristudioCpFoldedFigureEntry,
    held: Extract<FoldedFigureLayerOrder, { kind: 'record' }>,
    document: OristudioCpDocumentSnapshot,
    lineIds: readonly number[],
    scopedLineIds: readonly number[],
    report: ((outcome: FoldedFigureLayerOrderRefold) => void) | undefined
  ): Promise<boolean> {
    // A 3D figure folding flat again carries its model on its 3D snapshot.
    const model = foldedFigureModel(figure) ?? DEFAULT_FOLDED_MODEL;
    const previousHandle = figure.handle;
    const landing = foldLanding(figure.id, previousHandle);
    const all = held.record.constraints.length;
    const refused = (): Extract<FoldedFigureLayerOrderRefold, { kind: 'kept' }> => ({
      kind: 'kept',
      outcome: 'refused',
      attention: { reason: 'unresolved', count: all },
    });
    let handle: number | null = null;
    const giveBack = async () => {
      if (handle !== null) await freeOristudioCpFoldedFigure(handle).catch(() => {});
      handle = null;
    };
    try {
      const folded = await withFoldInFlight('refold', async (runId, stop) => {
        const kernelSource = await getOristudioCpSelectionFoldSource([...lineIds], figure.startingFaceId ?? 1);
        const resolution = await resolveLayerOrder(
          layerOrderSourceOf(kernelSource, model),
          layerOrderRecordToSource(held.record, EDIT_PAPER_FRAME),
          undefined,
          { signal: stop }
        );
        if (resolution.outcome !== 'applied') return { resolution, result: null } as const;
        const result = await foldOristudioCpWithOrder(
          kernelFoldSourceOf(resolution.applied.source),
          resolution.applied.relations,
          model,
          runId
        );
        return { resolution, result } as const;
      });
      const { resolution, result } = folded;
      switch (resolution.outcome) {
        case 'cancelled':
          return restorePreviousFigureQuietly(figure);
        case 'lost':
          // Nothing was checked, so nothing is kept: the record stays as it was.
          if (landing.holds()) {
            restorePreviousFigureQuietly(figure);
            report?.({ kind: 'lost', cause: resolution.cause });
          }
          return false;
        case 'clash':
        case 'timed_out':
        case 'refused':
          return keepFigureLayerOrderFlagged(
            figure,
            held,
            {
              kind: 'kept',
              outcome: resolution.outcome,
              attention: resolution.attention ?? { reason: 'unresolved', count: all },
            },
            landing,
            report
          );
        case 'applied':
          break;
      }
      if (!result || result.status === 'refused') return keepFigureLayerOrderFlagged(figure, held, refused(), landing, report);
      handle = result.handle;
      // The digest again, on the new fold: its faces are the ones the order names.
      const digest = await getOristudioCpFoldedFigureDigest(result.handle);
      if (digest !== resolution.applied.source.digest || result.snapshot.outcome !== 'Solved') {
        await giveBack();
        return keepFigureLayerOrderFlagged(figure, held, refused(), landing, report);
      }
      const renderSnapshot = await landing.picture(result.handle, figure.displayStyle, foldedFigureIndex(figure.id), true);
      const shown = foldedFigureLayerOrder(layerOrderRecordFromSource(resolution.record, EDIT_PAPER_FRAME));
      if (!isDrawableFoldResult(result.snapshot, renderSnapshot) || !shown.ok) {
        await giveBack();
        return keepFigureLayerOrderFlagged(figure, held, refused(), landing, report);
      }
      adoptFoldedFigureHandle(result.handle);
      handle = null;
      takeCanvasSelection('folded-figure', {
        oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
          candidate.id === figure.id
            ? {
                ...candidate,
                handle: result.handle,
                status: 'ready',
                snapshot: result.snapshot,
                folded3d: null,
                camera: null,
                sourceKind: 'generated-from-current-cp',
                renderSnapshot,
                sourceCpRevision: get().oristudioCpRevision,
                contradiction: result.snapshot.contradiction ?? null,
                error: null,
                layerOrder: shown.layerOrder,
                ...foldedSourceProvenance(document, lineIds, scopedLineIds),
              }
            : candidate
        ),
        oristudioCpActiveFoldedFigureId: figure.id,
        oristudioCpError: null,
        dirty: true,
        projectMessage: 'Refolded model',
      });
      // Released only once the new fold is in place: history may still hold it.
      releaseFoldedFigureHandle(previousHandle);
      trackFigureLayerOrderAttention(held.record.attention ?? null, resolution.attention);
      report?.({ kind: 'applied', attention: resolution.attention });
      return true;
    } catch (error) {
      await giveBack();
      // Its figure moved on while it folded: the new fold is gone, and there is nothing to put back.
      if (error instanceof FoldMovedOn) return false;
      if (isFoldCancellation(error)) return restorePreviousFigureQuietly(figure);
      return restorePreviousFigure(figure, engineError(error).message);
    }
  }

  /**
   * Oriedita `FoldAction`'s check before a fold: run the local
   * flat-foldability check (CAMV / Check4) and, if it finds violations, warn
   * the user and let them fold anyway. Whether to fold. This gate is purely
   * LOCAL (per-vertex Maekawa/Kawasaki/big-little-big); global layer-ordering
   * contradictions surface later, from the fold itself. Skipped when the user
   * has disabled the warning. Asked by a plain fold and by Fold with layer
   * order…, at the press.
   */
  async function confirmFoldDespiteCheck(spatial: boolean): Promise<boolean> {
    const settings = useSettingsStore.getState();
    if (!settings.foldWarningEnabled) return true;
    let violationCount = 0;
    try {
      const camv = await runOristudioCpCheckCommand('CheckCamv');
      // The scoped check filter applies here too. This is the one gate that
      // calls the kernel directly, so it sees findings the canvas, the HUD
      // and the marker layer have all agreed to hide — and warning about a
      // class the user has declared does not apply to a region is how a
      // suppressor becomes a nag instead of a tool.
      //
      // Only the per-class rules, deliberately: `camvIssuesVisible` is a
      // *view* switch, and turning markers off must not silently disarm the
      // pre-fold warning. The switch for that is `foldWarningEnabled`, which
      // already guards this whole check.
      const rules = cpCheckSuppressionRules(
        get().oristudioCpViewport.suppressedCheckClasses,
        get().oristudioCpAnnotations
      );
      // Errors only. `CheckCamv` also emits `SpatialInteriorBorder` at
      // `warning` severity — "border with paper on both sides: the vertices
      // on it are not checked" — which is an observation about the check's
      // own coverage and not a violation of anything. Counting it here would
      // raise Oriedita's "continue to fold?" modal over a document with
      // nothing wrong with it, and report `had_violations` for it.
      violationCount = countCpDiagnosticErrors(
        partitionCpDiagnosticsBySuppression(camv.diagnostic_entries ?? [], rules).visible
      );
      track(ANALYTICS_EVENTS.foldabilityChecked, {
        source: 'pre-fold',
        had_violations: violationCount > 0,
        violation_count_bucket: bucketCount(violationCount, COUNT_BUCKETS),
      });
    } catch {
      // A failed check must not block folding — leave the count at zero and fold.
    }
    if (violationCount === 0) return true;
    track(ANALYTICS_EVENTS.foldWarningShown, { source: 'pre-fold' });
    const { confirmed, optionChecked } = await requestConfirmationWithOption({
      title: i18n.t('dialogs:foldWarning.title', 'Warning'),
      // Same check, same scope, same toggle — only the sentence is split.
      // "Errors in flat foldability" is a false description of a spatial
      // document, where what `CheckCamv` reports is closure and
      // self-intersection at folded vertices, not Maekawa and Kawasaki.
      message: spatial
        ? i18n.t(
            'dialogs:foldWarning.spatialMessage',
            'Detected errors in how these creases fold. Continue to fold?'
          )
        : i18n.t('dialogs:foldWarning.message', 'Detected errors in flat foldability. Continue to fold?'),
      optionLabel: i18n.t('dialogs:foldWarning.dontShowAgain', "Don't show this again"),
      confirmLabel: i18n.t('dialogs:common.yes', 'Yes'),
      cancelLabel: i18n.t('dialogs:common.no', 'No'),
    });
    track(ANALYTICS_EVENTS.foldWarningAccepted, {
      source: 'pre-fold',
      accepted: confirmed,
      suppressed_future_warnings: optionChecked,
    });
    // Oriedita persists the "don't show again" choice whether the user
    // clicks Yes or No.
    if (optionChecked) settings.setFoldWarningEnabled(false);
    return confirmed;
  }

  /**
   * The model a new flat figure folds with. A reopened Oriedita file keeps its
   * folded appearance, but not its saved side -- a new figure always faces
   * front (NEW_FOLDED_FIGURE_SIDE). Undefined for the kernel's own.
   */
  function newFoldedFigureModel(document: OristudioCpDocumentSnapshot): OristudioCpFoldedFigureModel | undefined {
    const savedModel = foldedFigureModelFromOrieditaMetadata(document.metadata);
    return savedModel ? { ...savedModel, state: NEW_FOLDED_FIGURE_SIDE } : undefined;
  }

  /**
   * The fold of a new figure with the order the Layer order dialog chose
   * (row H5): the source it analysed folded again as it is, with its
   * relations (`fold_with_order`); none folds it with Oriedita's own search.
   * Null, with nothing left in the kernel, when the order can't be drawn on
   * those faces whole: refused, other faces than the dialog analysed (the
   * digest), or a given order not reached.
   */
  async function foldWithChosenOrder(
    order: OristudioCpFoldWithChosenOrder,
    runId: number
  ): Promise<{ handle: number; snapshot: OristudioCpFoldedFigureSnapshot } | null> {
    const result = await foldOristudioCpWithOrder(
      kernelFoldSourceOf(order.source),
      order.relations,
      order.source.model,
      runId
    );
    if (result.status !== 'folded') return null;
    let digest: string;
    try {
      digest = await getOristudioCpFoldedFigureDigest(result.handle);
    } catch (error) {
      await freeOristudioCpFoldedFigure(result.handle).catch(() => {});
      throw error;
    }
    const drawsTheOrder = order.relations.length === 0 || result.snapshot.outcome === 'Solved';
    if (digest === order.source.digest && drawsTheOrder) return result;
    await freeOristudioCpFoldedFigure(result.handle).catch(() => {});
    return null;
  }

  /**
   * A Layer order press whose crease pattern changed or went (`foldPress.ts`):
   * nothing written. No fault, so no error either: the press, which knows its
   * mark, says why as a message (`layerOrderPressToasts.ts`).
   */
  function refuseMovedPress(): false {
    return false;
  }

  /** {@link withFoldInFlightIn} over this store: see `foldRuns.ts`. */
  function withFoldInFlight<T>(
    kind: OristudioCpFoldRunKind,
    run: (runId: number, stop: AbortSignal, controls: FoldRunControls) => Promise<T>,
    options?: FoldRunOptions
  ): Promise<T> {
    return withFoldInFlightIn({ get, set }, kind, run, options);
  }

  function clearFoldArtifactSource() {
    set({
      ...emptyFoldArtifactResourceState(),
    });
  }

  async function computeFoldArtifacts(): Promise<FoldArtifacts | null> {
    if (get().oristudioCpDocument) {
      // No flat-folding on the simulate path: the interactive simulator folds
      // the flat pattern itself, so it only needs faces plus M/V, and the Rust
      // flat-folder walks a single connected face graph and rejects a document
      // holding several crease patterns.
      //
      // Faces come from the kernel, including for those multi-pattern
      // documents. `foldArtifactsFromFold` only infers its own when the export
      // carries none, which now means the kernel judged the arrangement
      // numerically untrustworthy rather than simply "not computed".
      const fold = parseFoldProjection(await exportOristudioCpDocumentAsFold());
      if (!fold) return null;
      const artifacts = foldArtifactsFromFold(fold);
      warnIfFacesWereInferred(fold, artifacts.fold, 'simulate');
      return artifacts;
    }
    const { api, treeHandle } = await requireActiveTree();
    return api.foldArtifacts(treeHandle);
  }

  async function loadFoldArtifacts(force = false): Promise<FoldArtifacts | null> {
    if (!hasFoldArtifactSource()) {
      clearFoldArtifactSource();
      return null;
    }

    const current = get();
    const currentRevision = current.foldArtifactRevision;
    if (
      !force &&
      current.foldArtifactStatus === 'ready' &&
      current.foldArtifactResolvedRevision === currentRevision
    ) {
      return current.foldArtifacts;
    }
    if (
      !force &&
      current.foldArtifactStatus === 'error' &&
      current.foldArtifactResolvedRevision === currentRevision
    ) {
      return null;
    }
    if (
      !force &&
      current.foldArtifactStatus === 'loading' &&
      foldArtifactPromise &&
      foldArtifactPromiseRevision === currentRevision
    ) {
      return foldArtifactPromise;
    }

    const requestId = (foldArtifactRequestId += 1);
    set({
      foldArtifacts: null,
      foldArtifactError: null,
      foldArtifactStatus: 'loading',
      foldArtifactResolvedRevision: null,
      selectedSegmentId: null,
    });

    foldArtifactPromiseRevision = currentRevision;
    foldArtifactPromise = (async () => {
      try {
        const foldArtifacts = await computeFoldArtifacts();
        if (
          foldArtifacts &&
          get().foldArtifactRevision === currentRevision &&
          foldArtifactRequestId === requestId
        ) {
          set({
            ...readyFoldArtifactResourceState(foldArtifacts, currentRevision),
          });
        }
        return foldArtifacts;
      } catch (error) {
        if (
          get().foldArtifactRevision === currentRevision &&
          foldArtifactRequestId === requestId
        ) {
          set({
            foldArtifacts: null,
            foldArtifactError: engineError(error).message,
            foldArtifactStatus: 'error',
            foldArtifactResolvedRevision: currentRevision,
            selectedSegmentId: null,
          });
        }
        return null;
      } finally {
        if (foldArtifactPromiseRevision === currentRevision) {
          foldArtifactPromise = null;
          foldArtifactPromiseRevision = null;
        }
      }
    })();

    return foldArtifactPromise;
  }

  async function runOptimization(
    label: string,
    capabilityId: WorkspaceCapabilityId,
    optimize: (api: EngineClient, treeHandle: number) => Promise<OptimizationReport>,
    options: { fitPaperView?: boolean } = {}
  ) {
    const capability = selectWorkspaceCapabilities(get())[capabilityId];
    if (!capability.enabled) {
      set({ error: { code: 'invalid_operation', message: capability.reason } });
      return;
    }
    // Addressed write; see `mapDesignTab`. An optimize is the longest engine call
    // in the app, so it is the one most likely to outlive a tab switch.
    const designId = get().activeDesignId;
    set({ status: 'optimizing', error: null });
    const checkpoint = await get().beginHistoryCheckpoint();
    // 'optimize.scale' -> 'scale'. Also the analytics `kind`.
    const kind = capabilityId.replace('optimize.', '');
    try {
      const { api } = await requireActiveTree();
      // **Pinned** for the whole run. Switching tabs parks the outgoing design,
      // and parking serializes and *frees* its handle — pulling it out from under
      // the optimizer mid-call. The registry refuses to park or evict a pinned
      // document, which is what this API was built for; nothing had called it.
      const result = await withDesignHandle(designId, 'treemaker', async (treeHandle) => {
        const report = await optimize(api, treeHandle);
        return { report, snapshot: await api.snapshot(treeHandle) };
      });
      if (!result) return;
      const { report, snapshot } = result;
      set({
      ...patchTreemakerDesign(get(), {
        project: projectFromSnapshot(snapshot, selectProject(get(), designId).title),
        lastOptimization: report,
        viewportFitRequestId: options.fitPaperView
          ? selectDesignViewportFitRequestId(get(), designId) + 1
          : selectDesignViewportFitRequestId(get(), designId)
      }, designId),
        status: report.is_feasible ? 'optimized' : 'needs_optimization',
        error: null,
        ...staleFoldArtifactResourceState(get().foldArtifactRevision),
        oristudioCpLineage: markGeneratedCpLineageStale(get().oristudioCpLineage),
        dirty: true,
        projectMessage: label});
      get().commitHistoryCheckpoint(checkpoint, label);
      track('optimizer run', { kind, succeeded: true, feasible: report.is_feasible });
    } catch (error) {
      set({ status: 'error', error: engineError(error) });
      track('optimizer run', { kind, succeeded: false });
    }
  }

  return {
    creaseColorMode: DEFAULT_CREASE_COLOR_MODE,
    oristudioCpSelection: emptyOristudioCpSelection(),
    oristudioCpActionRequest: null,
    oristudioCpSurfaceRequest: null,
    oristudioCpActiveToolId: null,
    oristudioCpActiveDiagnosticId: null,
    oristudioCpRevision: 0,
    oristudioCpFoldedFigures: [],
    oristudioCpActiveFoldedFigureId: null,
    oristudioCpFoldRuns: {},
    oristudioCpViewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
    oristudioCpCamera: null,
    oristudioCpAnnotations: [],
    oristudioCpSelectedAnnotationId: null,
    oristudioCpInlineSimulations: [],
    oristudioCpFocusedInlineSimulationId: null,
    oristudioCpSimulateSheet: null,
    oristudioCpPinnedVertices: NO_CP_VERTEX_PINS,
    oristudioCpFocusedFoldedFigureId: null,
    ...emptyFoldArtifactResourceState(),

    optimizeScale: async () => {
      await runOptimization('Optimize scale', 'optimize.scale', (api, treeHandle) =>
        api.optimizeScale(treeHandle),
        { fitPaperView: true }
      );
    },

    optimizeEdges: async () => {
      await runOptimization('Optimize edges', 'optimize.edges', (api, treeHandle) =>
        api.optimizeEdges(treeHandle)
      );
    },

    optimizeStrain: async () => {
      await runOptimization('Optimize strain', 'optimize.strain', (api, treeHandle) =>
        api.optimizeStrain(treeHandle)
      );
    },

    // The Edit workspace's always-live canvas: seed a blank editable CP when the
    // workspace is entered with no crease pattern loaded, so it is never empty.
    ensureEditCreasePattern: async () => {
      // A share opened while a document is already loaded replaces it, after the usual
      // unsaved-changes confirmation. Returning early here instead — which is what this did
      // while `/s` was assumed to be a full page load only — strands the pending share and
      // the link silently does nothing, the worst of the three possible behaviours.
      if (get().oristudioCpDocument) {
        const pending = get().pendingSharedCp;
        if (!pending) return;
        if (!(await confirmDiscardDirtyProject(() => get().dirty))) {
          set({ pendingSharedCp: null });
          return;
        }
      }
      // Having no document because a file was *refused* is not the same as
      // having none because nothing is open yet, and only the second is a
      // reason to seed a blank canvas. Seeding on the first replaced the
      // failure with an empty sheet named after the user's file and cleared the
      // error on the way through (`freshEditableCpState` ->
      // `discardCpDocumentState`), so nothing anywhere said the load had failed.
      //
      // A share still overrides: it is an explicit request to open something
      // else, and succeeding at it clears the failure below.
      if (get().cpLoadFailure && !get().pendingSharedCp) return;
      if (ensureEditInFlight) return ensureEditInFlight;
      ensureEditInFlight = (async () => {
        try {
          // A share link routes through `/s`, which leaves its payload here for
          // us. Opening one is the same provisioning act as seeding a blank
          // canvas, so it happens on this one path rather than a parallel one —
          // and it is consumed inside the in-flight guard, so a StrictMode
          // double-invoke cannot open it twice.
          const pending = get().pendingSharedCp;
          let document;
          if (pending) {
            try {
              // A link normally arrives with its crease pattern already inlined into
              // the page, so this is pure decode. The `id` shape is the exception —
              // a hand-typed URL, or one opened inside the ~60s KV takes to propagate
              // — and is the only path that touches the network.
              let payload: string;
              if (pending.kind === 'payload') {
                payload = pending.payload;
              } else {
                // KV needs up to a minute to propagate, and a link is usually opened the
                // moment it is created — so retry a miss rather than reporting one.
                set({ openingSharedCp: true });
                try {
                  payload = (await fetchCpShareWithRetry(pending.shareId)).payload;
                } finally {
                  set({ openingSharedCp: false });
                }
              }
              document = await openSharedCpPayload(payload);
              track('share link opened', {
                succeeded: true,
                source: pending.kind === 'payload' ? 'inline' : 'stored',
              });
            } catch (error) {
              track('share link opened', { succeeded: false });
              // A bad link should leave a usable editor, not a broken one: tell
              // the user which kind of failure it was (the kernel distinguishes
              // "corrupt" from "made by a newer Ori Studio") and seed the blank
              // canvas they would otherwise have got.
              set({ error: engineError(error) });
              document = await createBlankOristudioCpDocument();
            }
          } else {
            document = await createBlankOristudioCpDocument();
          }
          const priorState = get();
          // Deliberately does **not** touch the design tabs. This used to clear
          // the active design when it had no edges and no BP document — a test
          // for "nothing authored yet" that a freshly created Circle-packed
          // design also passes, because a blank tree *is* zero edges. Visiting
          // Edit therefore threw away the design the user had just made. And
          // with tabs it asked the wrong question anyway: whether a design exists
          // is a fact about the tab set, not about the active tab's edge count.
          //
          // The case it was written for — a bare auto-seeded CP on a workspace
          // with no designs at all — needs no clearing: every tab is already on
          // the chooser, so there is nothing to clear.
          //
          // Same complete editor state File › New establishes, so interactive
          // edits (undo/redo, images, tools) behave identically on this canvas.
          set(freshEditableCpState(document, priorState));
        } catch (error) {
          set({ oristudioCpError: engineError(error).message });
        } finally {
          // Cleared on every path, success or failure. A payload that could not
          // be opened must not be retried on the next mount: the user has
          // already been told, and silently re-running a failing decode would
          // make Edit unusable rather than merely empty.
          set({ pendingSharedCp: null, openingSharedCp: false });
          ensureEditInFlight = null;
        }
      })();
      return ensureEditInFlight;
    },


    buildCreasePattern: async () => {
      // Addressed write: this action's result belongs to the design it started
      // in, not to whichever tab is showing when the engine answers. See
      // `mapDesignTab`.
      const designId = get().activeDesignId;
      const capability = selectWorkspaceCapabilities(get())['cp.build'];
      if (!capability.enabled) {
        set({
          error: {
            code: 'invalid_operation',
            message: capability.reason,
          },
        });
        return;
      }
      if (!(await confirmReplaceCustomizedGeneratedCp())) return;

      await get().clearOristudioCpFoldedFigures();
      set({ status: 'building_crease_pattern', error: null });
      const checkpoint = await get().beginHistoryCheckpoint();
      try {
        const { api, treeHandle } = await requireActiveTree();
        const snapshot = await api.buildCreasePattern(treeHandle);
        const project = projectFromSnapshot(snapshot, selectProject(get(), designId).title);
        const hasDrawableCreasePattern = project.creases.length > 0 || project.facets.length > 0;

        if (!hasDrawableCreasePattern) {
          set({
            ...patchTreemakerDesign(get(), { project }, designId),
            status:
              project.edges.length === 0
                ? 'ready'
                : snapshot.summary.is_feasible
                  ? 'optimized'
                  : 'needs_optimization',
            error: {
              code: 'invalid_operation',
              message: 'Build CP completed but did not produce drawable crease-pattern geometry.',
            },
            ...emptyFoldArtifactResourceState(),
            oristudioCpDocument: null,
            oristudioCpLineage: null,
            oristudioCpSelection: emptyOristudioCpSelection(),
            oristudioCpRevision: 0,
            oristudioCpFoldedFigures: [],
            oristudioCpActiveFoldedFigureId: null,
            projectMessage: null,
          });
          await releaseOristudioCpDocument();
          return;
        }

        const artifactRevision = get().foldArtifactRevision + 1;
        let foldArtifactError: string | null = null;
        const foldArtifacts = await api.foldArtifacts(treeHandle).catch((error) => {
          foldArtifactError = engineError(error).message;
          return null;
        });
        const foldJson = await api.exportFold(treeHandle);
        const foldProjection = parseFoldProjection(foldJson);
        const treeText = await api.saveTmd5(treeHandle);
        const editableDocument = await loadOristudioCpDocumentFromText(foldJson, {
          format: 'fold',
          filename: `${project.title || 'generated-crease-pattern'}.fold`,
          title: `${project.title || 'Generated'} CP`,
        });
        set({
          ...patchTreemakerDesign(get(), { project }, designId),
          oristudioCpDocument: editableDocument,
          oristudioCpLineage: generatedCpLineage({
            sourceTreeDigest: stableTextDigest(treeText),
            sourceGeneratedFold: foldProjection,
          }),
          oristudioCpOperationDescriptors: editableDocument.operationDescriptors,
          oristudioCpError: null,
          oristudioCpCamvResult: null,
          oristudioCpHistoryPast: [],
          oristudioCpHistoryFuture: [],
          oristudioCpSelection: emptyOristudioCpSelection(),
          oristudioCpRevision: 0,
          oristudioCpFoldedFigures: [],
          oristudioCpActiveFoldedFigureId: null,
          status: 'crease_pattern_ready',
          error: null,
          ...(foldArtifacts
            ? readyFoldArtifactResourceState(foldArtifacts, artifactRevision)
            : {
                foldArtifacts: null,
                foldArtifactError: foldArtifactError ?? 'Fold artifacts unavailable',
                foldArtifactStatus: 'error' as const,
                foldArtifactRevision: artifactRevision,
                foldArtifactResolvedRevision: artifactRevision,
                selectedSegmentId: null,
              }),
          dirty: true,
          projectMessage: 'Built crease pattern',
        });
        get().commitHistoryCheckpoint(checkpoint, 'Build crease pattern');
        // The tree→CP core moment. Counts are bucketed; no node/edge geometry.
        track('crease pattern built', {
          node_count_bucket: bucketCount(snapshot.summary.nodes, COUNT_BUCKETS),
          had_conditions: snapshot.summary.conditions > 0,
        });
        useLayoutStore.getState().activateWorkspace('edit');
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
      }
    },

    sendTreeCreasePatternToEdit: async (includeCircles = false) => {
      const capability = selectWorkspaceCapabilities(get())['cp.build'];
      if (!capability.enabled) {
        set({ error: { code: 'invalid_operation', message: capability.reason } });
        return false;
      }
      const kind = designKind('treemaker');
      if (!kind) return false;
      const previousStatus = get().status;
      set({ status: 'building_crease_pattern', error: null });
      try {
        const { treeHandle } = await requireActiveTree();
        // Turn the tree into creases, then hand the generated CP to the always-live
        // Edit canvas via Import(Add) so it merges into whatever is already there,
        // instead of replacing the Edit surface. Mirrors BP's "Send to Edit"
        // (see sendOristudioBpToEdit).
        //
        // The conversion itself is the *descriptor's*, not ours: the kind knows
        // how its document becomes a crease pattern, and the store only routes
        // the result into Edit. Reimplementing it here is what let this and the
        // BP path drift into two spellings of one operation.
        await get().ensureEditCreasePattern();
        const payload = await kind.sendToEdit(treeHandle, {
          editGridDivisions:
            get().oristudioCpDocument?.document.crease_pattern.grid.grid_size ?? 0,
          title: selectProject(get()).title,
          includeCircles,
        });
        const ok = await get().importAddOristudioCpText(payload);
        set({ status: ok ? 'crease_pattern_ready' : previousStatus });
        if (ok) {
          trackDesignSentToEdit({
            designKind: 'treemaker',
            includeCircles,
            circleCount: payload.circles?.length ?? 0,
          });
          const layout = useLayoutStore.getState();
          layout.activateWorkspace('edit');
          layout.activatePanel('crease-pattern');
        }
        return ok;
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
        return false;
      }
    },

    markFoldSourceChanged: () => {
      set(staleFoldArtifactResourceState(get().foldArtifactRevision));
    },

    ensureFoldArtifacts: () => loadFoldArtifacts(false),

    refreshFoldArtifacts: () => loadFoldArtifacts(true),

    setCreaseColorMode: (creaseColorMode) => set({ creaseColorMode }),

    setSelectedSegment: (id) => {
      const segments = resolveCpSegments(get().foldArtifacts);
      if (id !== null && !segments.some((segment) => segment.id === id)) return;
      set({ selectedSegmentId: id });
    },

    setOristudioCpSimulateSheet: (oristudioCpSimulateSheet) => set({ oristudioCpSimulateSheet }),

    simulateOristudioCpSheet: async (sheet) => {
      const index = await ensureCpSheetIndex(get().oristudioCpDocument?.document);
      const region = index ? sheetRegions(index)[sheet] : undefined;
      if (!region) return false;
      // By outline, so the Simulate workspace finds it again after an edit that
      // renumbers the index; then switch workspace via the layout store
      // (activatePanel resolves the simulator's owning workspace), mirroring
      // sendTreeCreasePatternToEdit.
      set({ oristudioCpSimulateSheet: regionReferenceFor(region) });
      useLayoutStore.getState().activatePanel('simulator');
      return true;
    },

    addOristudioCpInlineSimulation: async ({ segment, cpLineIds }) => {
      const document = get().oristudioCpDocument?.document ?? null;
      if (!document) return 'unavailable';
      const simulations = get().oristudioCpInlineSimulations;
      // A hard cap, not a soft one. Each open window is a solver session the
      // worker may be asked to swap to, and a canvas the camera has to track;
      // an unbounded count degrades quietly rather than failing.
      //
      // Reported rather than set as a `projectMessage`: that channel is rendered
      // by nothing (see GlobalToasts), and a raw string in the store could not be
      // translated anyway. The caller says it, in the user's language.
      if (simulations.length >= MAX_CONCURRENT_SIMULATIONS) return 'at-capacity';

      // The simulator needs the triangulated mesh. It is built for the region's
      // sheet alone when the region is one — every caller's is, resolved from the
      // sheet index — so a window on one pattern never meshes the whole canvas;
      // the whole-canvas artifacts are the fallback. The *region* is the
      // caller's: resolving it again here from a second segmentation is what
      // opened the wrong one.
      const sheet = (await ensureCpSheetIndex(document))?.sheetMadeBy(cpLineIds) ?? null;
      const artifacts =
        (sheet !== null ? await ensureCpSheetSimulationArtifacts(document, sheet) : null) ??
        get().foldArtifacts ??
        (await get().ensureFoldArtifacts());
      if (!artifacts) return 'unavailable';

      const fold = buildSegmentSimulationFold(artifacts, segment);
      // No mesh faces under the region means the two are not describing the same
      // paper — the artifacts are in some other coordinate space. Report it
      // rather than open a window onto an empty fold, which renders as a blank
      // pane with nothing to say why.
      if ((fold.faces_vertices?.length ?? 0) === 0) return 'unavailable';

      // Unique against the windows a file restored as well as the ones this
      // session made — the id keys this window's fold, so a clash makes two
      // windows draw one mesh. See `inlineSimulationIds`.
      const id = nextInlineSimulationId(simulations);
      const modelFrameAngle = uprightFrameAngle('model');
      const simulation = createInlineSimulation({
        id,
        segment,
        document,
        cpLineIds,
        z: topInlineSimulationZ(simulations) + 1,
        view: DEFAULT_SIMULATOR_VIEW,
        blockers: occupiedModelSpace(get(), modelFrameAngle),
        frameAngle: modelFrameAngle,
      });
      setInlineSimulationSource(id, { fold, modelKey: `${id}:0` });

      // Undoable, so record the list before the window existed. Pushed here
      // rather than at the call sites because there are several — the selection
      // toolbar, Shift+S — and one that forgot would be an action that silently
      // is not undoable.
      get().recordInlineSimulationHistory(
        simulations,
        i18n.t('panels:creasePattern.inlineSimulation.addAction', 'Add simulation window')
      );

      // A new window takes the solver *and* the canvas selection: opening one
      // and watching nothing happen would be the wrong first impression, and
      // the region it was built from stays selected under it otherwise.
      //
      // `dirty` because windows are written to `.osf`: without it you could
      // arrange a workspace of them and be let back to the start screen with no
      // prompt (see useWelcomeDiscardGuard).
      takeCanvasSelection('inline-simulation', {
        oristudioCpInlineSimulations: [...simulations, simulation],
        oristudioCpFocusedInlineSimulationId: id,
        dirty: true,
      });
      return 'added';
    },

    updateOristudioCpInlineSimulation: (id, patch) => {
      // Deliberately no history push: this runs on every pointermove of a
      // move/resize gesture. The checkpoint is taken once per gesture by the
      // panel's begin/commit protocol, the same as the other canvas objects.
      set({
        oristudioCpInlineSimulations: get().oristudioCpInlineSimulations.map((simulation) =>
          simulation.id === id ? { ...simulation, ...patch } : simulation
        ),
        dirty: true,
      });
    },

    setOristudioCpInlineSimulationAppearance: (id, field, value) => {
      const simulations = get().oristudioCpInlineSimulations;
      const simulation = simulations.find((candidate) => candidate.id === id);
      if (!simulation) return false;
      const appearance = withPaperStyleOverride(simulation.appearance, field, value);
      if (appearance === simulation.appearance) return true;
      set({
        oristudioCpInlineSimulations: simulations.map((candidate) =>
          candidate.id === id ? { ...candidate, appearance } : candidate
        ),
        dirty: true,
      });
      return true;
    },

    removeOristudioCpInlineSimulation: (id) => {
      const previous = get().oristudioCpInlineSimulations;
      if (!previous.some((simulation) => simulation.id === id)) return;
      get().recordInlineSimulationHistory(
        previous,
        i18n.t('panels:creasePattern.inlineSimulation.deleteAction', 'Delete simulation window')
      );
      // The fold goes; undo rebuilds it rather than history holding it alive.
      clearInlineSimulationSource(id);
      const remaining = previous.filter((simulation) => simulation.id !== id);
      set({
        oristudioCpInlineSimulations: remaining,
        oristudioCpFocusedInlineSimulationId:
          get().oristudioCpFocusedInlineSimulationId === id
            ? null
            : get().oristudioCpFocusedInlineSimulationId,
        dirty: true,
      });
    },

    focusOristudioCpInlineSimulation: (id) => {
      if (get().oristudioCpFocusedInlineSimulationId === id) return;
      if (id === null) {
        releaseCanvasSelection('inline-simulation');
        return;
      }
      takeCanvasSelection('inline-simulation', {
        oristudioCpFocusedInlineSimulationId: id,
      });
    },

    focusOristudioCpFoldedFigure: (id) => {
      if (get().oristudioCpFocusedFoldedFigureId === id) return;
      if (id === null) {
        set({ oristudioCpFocusedFoldedFigureId: null });
        return;
      }
      // Refused rather than admitted for a flat figure, so focus can never be a
      // state the user reaches and finds inert. `folded3d` is the same predicate
      // `setOristudioCpFolded3dCamera` gates on, and for the same reason: there
      // is no camera to turn without it.
      const figure = get().oristudioCpFoldedFigures.find((candidate) => candidate.id === id);
      if (!figure || (figure.folded3d ?? null) === null) return;

      // Focusing selects, because the two are never usefully apart: the figure
      // whose camera is taking drags is the figure whose toolbar should be up.
      // Routing it through `takeCanvasSelection` is also what drops a focused
      // simulation window, which would otherwise keep claiming the same presses.
      takeCanvasSelection('folded-figure', {
        oristudioCpActiveFoldedFigureId: id,
        oristudioCpFocusedFoldedFigureId: id,
      });
    },

    hydrateOristudioCpInlineSimulations: async () => {
      const simulations = get().oristudioCpInlineSimulations;
      if (simulations.length === 0) return 0;

      // Each window's sheet is meshed alone, from the document as it is now:
      // the sheet index and the per-sheet cache are keyed by its creases, so a
      // file opened over an edited document is read as edited.
      return buildInlineSimulationSources(simulations);
    },

    restoreOristudioCpInlineSimulationSources: async () => {
      // Undo can bring back a window whose fold was dropped when it was deleted.
      // Rebuild rather than having history hold folds alive: a triangulated
      // segment fold is 240KB-2.9MB, and a hundred undoable deletions of them is
      // tens to hundreds of MB retained for windows the user threw away.
      const missing = get().oristudioCpInlineSimulations.filter(
        (simulation) => getInlineSimulationSource(simulation.id) === null
      );
      if (missing.length === 0) return 0;

      // Deleting a window does not change the creases, so the common
      // delete-then-undo path finds its sheet's mesh still cached.
      return buildInlineSimulationSources(missing);
    },

    refreshOristudioCpInlineSimulation: async (id) => {
      const document = get().oristudioCpDocument?.document ?? null;
      const simulation = get().oristudioCpInlineSimulations.find(
        (candidate) => candidate.id === id
      );
      if (!document || !simulation) return false;

      const index = await ensureCpSheetIndex(document);
      const sheet = index ? resolveInlineSimulationSegment(simulation, sheetRegions(index)) : null;
      const fold = sheet ? await sheetSimulationFold(document, sheet) : null;
      if (!sheet || !fold) {
        // The region merged, split, or its rim stopped being all-border. Keep
        // the window rather than silently re-pointing it at whichever region
        // happens to be nearest — see 0b3b1ea6 for the same rule applied to a
        // refold that cannot produce a replacement.
        //
        // Saying so is the caller's job, and used to be attempted here with a
        // `projectMessage`: a channel many actions write and nothing renders, so
        // a refresh that could not resolve its region reported the failure to
        // no one. `useInlineSimulations.refresh` toasts on this `false`, in the
        // user's language, as `addOristudioCpInlineSimulation`'s outcomes are.
        return false;
      }

      const bounds = foldedSourceBounds(cpLinesByIds(document, [...sheet.lineIds]));
      const revision = inlineSimulationRevision(id);
      // Recorded before the rewrite, and after the failure paths above so a
      // refresh that could not resolve its region leaves no entry behind.
      get().recordInlineSimulationHistory(
        get().oristudioCpInlineSimulations,
        i18n.t(
          'panels:creasePattern.inlineSimulation.refreshAction',
          'Rebuild simulation region'
        )
      );
      setInlineSimulationSource(id, { fold, modelKey: `${id}:${revision}` });
      // Rewrites persisted provenance, so it dirties like the others.
      takeCanvasSelection('inline-simulation', {
        oristudioCpInlineSimulations: get().oristudioCpInlineSimulations.map((candidate) =>
          candidate.id === id
            ? {
                ...candidate,
                sourceBoundary: sheet.boundary.map((ring) => ring.map((point) => ({ ...point }))),
                sourceBounds: bounds,
                sourceFingerprint: sourceFingerprintFor(document, bounds),
                segmentIdHint: sheet.id,
              }
            : candidate
        ),
        oristudioCpFocusedInlineSimulationId: id,
        dirty: true,
      });
      return true;
    },


    setOristudioCpCamera: (oristudioCpCamera) => set({ oristudioCpCamera }),

    setOristudioCpViewportOption: (key, value) =>
      set({ oristudioCpViewport: { ...get().oristudioCpViewport, [key]: value } }),

    setOristudioCpSelection: (oristudioCpSelection) =>
      applyCreaseSelection(oristudioCpSelection),

    claimCanvasForCreaseSelection: () => {
      // For selections that arrive from the *kernel* rather than from a click:
      // executing a CP operation writes `oristudioCpSelection` straight from the
      // returned document, so it cannot go through `applyCreaseSelection` without
      // a second store write on the hot edit path. Called after that write
      // instead, and guarded so the ordinary case — nothing else selected — costs
      // a few reads and no `set` at all.
      if (cpSelectionSize(get().oristudioCpSelection) === 0) return;
      if (
        get().oristudioCpSelectedAnnotationId === null &&
        get().oristudioCpActiveFoldedFigureId === null &&
        get().oristudioCpFocusedInlineSimulationId === null
      ) {
        return;
      }
      // No patch: the creases are already selected, this only takes the canvas
      // from whatever else was holding it.
      takeCanvasSelection('creases');
    },

    requestOristudioCpAction: (operationId) => {
      const previousId = get().oristudioCpActionRequest?.id ?? 0;
      set({ oristudioCpActionRequest: { id: previousId + 1, operationId } });
    },

    requestOristudioCpSurface: (kind) => {
      const previousId = get().oristudioCpSurfaceRequest?.id ?? 0;
      set({ oristudioCpSurfaceRequest: { id: previousId + 1, kind } });
    },

    setOristudioCpActiveToolId: (id) => set({ oristudioCpActiveToolId: id }),

    // Pins are not document state and record no history entry: a pin changes
    // nothing about the pattern, so an undo after one should walk back the last
    // crease edit rather than the marker. See `pins/vertexPins.ts`.
    toggleOristudioCpVertexPin: (point) =>
      set({ oristudioCpPinnedVertices: toggleCpVertexPin(get().oristudioCpPinnedVertices, point) }),

    clearOristudioCpVertexPinsIn: (box) => {
      const pins = get().oristudioCpPinnedVertices;
      const remaining = removeCpVertexPinsInBox(pins, box);
      // Identity-compared, so a region with no pins in it costs no re-render.
      if (remaining !== pins) set({ oristudioCpPinnedVertices: remaining });
    },

    clearOristudioCpActionRequest: (id) =>
      set({
        oristudioCpActionRequest:
          get().oristudioCpActionRequest?.id === id ? null : get().oristudioCpActionRequest,
      }),

    // Clear-by-id, not clear-outright: a panel handling request N must not drop
    // request N+1 that arrived while it was doing so.
    clearOristudioCpSurfaceRequest: (id) =>
      set({
        oristudioCpSurfaceRequest:
          get().oristudioCpSurfaceRequest?.id === id ? null : get().oristudioCpSurfaceRequest,
      }),

    setOristudioCpActiveDiagnostic: (oristudioCpActiveDiagnosticId) => {
      set({ oristudioCpActiveDiagnosticId });
      frameActiveCpDiagnostic(get());
    },

    setOristudioCpActiveFoldedFigure: (oristudioCpActiveFoldedFigureId) => {
      const previousActiveId = get().oristudioCpActiveFoldedFigureId;
      if (oristudioCpActiveFoldedFigureId === null) {
        releaseCanvasSelection('folded-figure');
      } else {
        takeCanvasSelection('folded-figure', { oristudioCpActiveFoldedFigureId });
      }
      // Both ids, not just the one takeCanvasSelection released: the newly
      // active figure has to gain its marker as well as the old one losing it.
      refreshFoldedFigureSelectionMarkers(previousActiveId, oristudioCpActiveFoldedFigureId);
    },

    setOristudioCpFoldedFigurePlacement: (id, patch) => {
      set({
        oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((figure) =>
          figure.id === id
            ? { ...figure, placement: { ...figure.placement, ...patch } }
            : figure
        ),
        dirty: true,
      });
    },

    setOristudioCpFoldedFigureAppearance: (id, field, value) => {
      const figures = get().oristudioCpFoldedFigures;
      const figure = figures.find((candidate) => candidate.id === id);
      if (!figure) return false;
      const appearance = withPaperStyleOverride(figure.appearance, field, value);
      if (appearance === figure.appearance) return true;
      // A colour pin re-inks the picture that is already there, but the light
      // is baked into every face's shade, so pinning one is a rebuild — and
      // without it the Lighting row would write an override that changed
      // nothing until the figure was next turned.
      const scene =
        (figure.folded3d ?? null) !== null &&
        folded3dStoredSceneStyleChanged(figure.appearance, appearance)
          ? reproject3dScene({ ...figure, appearance }, figure.displayStyle)
          : null;
      // Editing a figure's appearance selects it, as editing its model does.
      takeCanvasSelection('folded-figure', {
        oristudioCpFoldedFigures: figures.map((candidate) =>
          candidate.id === id
            ? { ...candidate, appearance, scene: scene ?? candidate.scene }
            : candidate
        ),
        oristudioCpActiveFoldedFigureId: id,
        dirty: true,
      });
      return true;
    },

    refreshOristudioCpFolded3dScenes: () => {
      const figures = get().oristudioCpFoldedFigures;
      let changed = false;
      const next = figures.map((figure) => {
        if ((figure.folded3d ?? null) === null || figure.handle == null) return figure;
        const scene = reproject3dScene(figure, figure.displayStyle);
        if (!scene) return figure;
        changed = true;
        return { ...figure, scene };
      });
      if (changed) set({ oristudioCpFoldedFigures: next });
    },

    simulateOristudioCpCreaseRegion: async (lineIds) => {
      const oristudioCpDocument = get().oristudioCpDocument;
      if (!oristudioCpDocument || lineIds.length === 0) return;
      await simulateNonFlatRegion(oristudioCpDocument.document, lineIds);
    },

    foldOristudioCpDocument: async (options = {}) => {
      const oristudioCpDocument = get().oristudioCpDocument;
      if (!oristudioCpDocument) {
        set({
          oristudioCpError: 'No editable crease-pattern document is loaded',
          error: {
            code: 'invalid_operation',
            message: 'No editable crease-pattern document is loaded',
          },
        });
        return false;
      }
      // A fold with a chosen order folds what its press folded: when a crease
      // changed or another document opened since, it would fold the old
      // creases into what is open now.
      if (options.withOrder && foldPressMoved(options.withOrder.press, get())) return refuseMovedPress();

      // What the fold is scoped to, before the foldable-colour filter: the
      // refusal dialog resolves a region from these, and a region is matched by
      // *every* crease inside it, aux lines and borders included.
      const scopedLineIds = options.lineIds ?? get().oristudioCpSelection.lines;
      // The one routing decision, made on the **scoped** ids. Deciding it on the
      // document would fold a wholly classic selection in 3D whenever some other
      // part of the pattern carried an angle — see `foldRoute.ts`.
      const route = resolveFoldRoute(oristudioCpDocument.document, scopedLineIds);
      if (route.kind === 'none') {
        const message = 'Select one or more foldable crease-pattern lines first';
        set({
          oristudioCpError: message,
          error: {
            code: 'invalid_operation',
            message,
          },
        });
        return false;
      }
      const selectedLineIds = route.lineIds;
      const nonClassicCount = route.kind === 'spatial' ? route.nonClassicCount : 0;
      const withOrder = options.withOrder;
      // A layer order is a flat fold's: these creases fold in 3D now, and the
      // order chosen for them would be drawn on nothing.
      if (withOrder && route.kind !== 'flat') {
        const message = i18n.t('panels:creasePattern.selectionToolbar.foldWithLayerOrder3d', 'Layer order works on flat folds');
        set({ oristudioCpError: message, error: { code: 'invalid_operation', message } });
        return false;
      }
      // The record, as the figure saves it, before anything is folded: one too
      // large to save is refused with nothing to undo.
      const held = withOrder?.record
        ? foldedFigureLayerOrder(layerOrderRecordFromSource(withOrder.record, EDIT_PAPER_FRAME))
        : null;
      if (held && !held.ok) {
        const message = i18n.t(
          'errors:cp.layerOrderTooLargeToFold',
          'This layer order is too large to save with a folded model, so nothing was folded.'
        );
        set({ oristudioCpError: message, error: { code: 'invalid_operation', message } });
        return false;
      }

      // `G` reaches neither analytics chokepoint: `handleCpShortcutAction`
      // short-circuits to the fold before `handleCpToolAction` (so no
      // `cp tool used`), and the toolbar button calls the same store action
      // directly (so no `command invoked`). These are hand-placed for that
      // reason, and every terminal branch below pairs one `fold completed` with
      // this one `fold attempted`. A fold with a layer order the dialog chose
      // says so (`via`), on both.
      const mode: FoldMode = route.kind === 'spatial' ? 'spatial' : 'flat';
      const via = withOrder ? ({ via: 'layer_order' } as const) : {};
      track(ANALYTICS_EVENTS.foldAttempted, {
        mode,
        crease_count_bucket: bucketCount(selectedLineIds.length, COUNT_BUCKETS),
        non_classic_count_bucket: bucketCount(nonClassicCount, COUNT_BUCKETS),
        ...via,
      });
      // Measured from the press, not from the kernel call: the CAMV pre-check and
      // its dialog are part of what the user waits through, and a `halted` verdict
      // is only interesting against how long the folds that *finish* take.
      const attemptedAt = Date.now();
      const completed = (
        verdict: FoldVerdict,
        solutionCount?: number,
        extra?: {
          refusal?: OristudioCpFold3dRefusal['code'];
          order_reason?: string;
          /**
           * Which half of the offer the user got: the overlay's own row, or the
           * bare point. Measured on the corpus, the point is the common one, and
           * the split is the only way to tell whether that holds in the wild.
           */
          located_by?: 'row' | 'point';
        }
      ): void => {
        track(ANALYTICS_EVENTS.foldCompleted, {
          mode,
          verdict,
          solution_count_bucket: bucketCount(solutionCount ?? 0, COUNT_BUCKETS),
          elapsed_ms_bucket: bucketCount(Date.now() - attemptedAt, FOLD_DURATION_MS_BUCKETS),
          ...extra,
          ...via,
        });
      };

      // A fold with a chosen order was asked the pre-fold check at its press,
      // before the Layer order dialog opened on the same creases.
      if (!withOrder && !(await confirmFoldDespiteCheck(route.kind === 'spatial'))) {
        completed('cancelled');
        return false;
      }

      const previousActiveId = get().oristudioCpActiveFoldedFigureId;

      if (route.kind === 'spatial') {
        // Deliberately **no draft entry**. The flat path inserts a `loading`
        // figure and discards it on failure, and discarding writes `error:`,
        // which the global toast host turns into an error toast — but a refusal
        // is a result, not an error. Inserting one would also take the canvas
        // selection, so declining the refusal dialog would silently destroy the
        // creases the user still has selected. Awaiting the fold first makes
        // both problems unrepresentable rather than guarded; progress is still
        // shown, because `withFoldInFlight` drives the global "Folding…"
        // indicator.
        try {
          const result = await withFoldInFlight('fold-3d', (runId) =>
            fold3dRuntimeOristudioCpDocument(
              selectedLineIds,
              options.startingFaceId ?? 1,
              options.model,
              runId
            )
          );

          if (result.status === 'refused') {
            // Asked with the overlay treated as **on**, because accepting the
            // offer is what turns it on: reading the live toggle would find no
            // entries for a user who had hidden the markers, and drop the one
            // affordance that answers "which vertex?" for exactly the people
            // who cannot see the answer already.
            const notice = fold3dRefusalNotice(
              i18n.t,
              result.refusal,
              visibleCpDiagnosticEntries(
                get().oristudioCpCamvResult,
                get().oristudioCpDocument?.lastCommandResult ?? null,
                true
              )
            );
            const answer = await requestFold3dRefusal(notice);
            if (answer === 'locate' && notice.locate) {
              const target = notice.locate.target;
              if (target.kind === 'entry') {
                // Visibility first. `setOristudioCpActiveDiagnostic` frames from
                // committed state via `frameActiveCpDiagnostic`, which rebuilds
                // the list from `visibleCpDiagnosticEntries` on the same two
                // results — so once the overlay is on, that list is the one the
                // offer was built from, and activating before revealing would
                // jump nowhere and leave a row selected that nothing draws.
                get().setOristudioCpViewportOption('camvIssuesVisible', true);
                get().setOristudioCpActiveDiagnostic(target.entryId);
              } else {
                // No row to activate, and deliberately no overlay toggle either:
                // there is nothing at this place for it to draw, and switching on
                // a layer that adds nothing visible is a state change the user
                // did not ask for and cannot see the point of.
                frameCpModelPoint(target.point);
              }
              completed('located', 0, {
                refusal: result.refusal.code,
                located_by: target.kind === 'entry' ? 'row' : 'point',
              });
              return false;
            }
            if (answer === 'simulate') {
              track(ANALYTICS_EVENTS.foldSimulationRun, {
                source: 'fold-3d-refused',
                crease_count_bucket: bucketCount(selectedLineIds.length, COUNT_BUCKETS),
              });
              // Scoped ids, not the folded ones: a region is matched by every
              // crease inside it, borders and aux lines included. Captured
              // before the dialog, because the selection toolbar clears the
              // selection the moment it dispatches.
              await simulateNonFlatRegion(oristudioCpDocument.document, scopedLineIds);
            }
            completed(answer === 'simulate' ? 'simulated' : 'cancelled', 0, {
              refusal: result.refusal.code,
            });
            return false;
          }

          const figureId = nextGeneratedFoldedFigureId();
          const figureIndex = get().oristudioCpFoldedFigures.length + 1;
          const camera = defaultFolded3dCamera(result.render, result.snapshot.model.state);
          const displayStyle: OristudioCpFoldedFigureDisplayStyle = 'Paper5';
          const scene = project3dScene(result.render, result.snapshot, displayStyle, camera);
          adoptFoldedFigureHandle(result.handle);
          // The geometry lives beside the handle, not on the entry: it is up to
          // ~235 KB of packed arrays and the `.osf` writer pretty-prints. It is
          // what every *re*-projection needs, and it is released with the handle.
          setFolded3dRenderModel(result.handle, result.render);

          const userFrameAngle = uprightFrameAngle('user');
          const foldedSourceAnchor = cpUserAnchorForLineIds(
            oristudioCpDocument.document,
            selectedLineIds,
            userFrameAngle
          );
          const existing = get().oristudioCpFoldedFigures;
          const folded: OristudioCpFoldedFigureEntry = {
            id: figureId,
            title: `Folded model ${figureIndex}`,
            handle: result.handle,
            // Its own kind, not the flat one. Two witnesses now say a figure is
            // 3D — this and `folded3d` — and `validateFoldedFigure` asserts they
            // agree rather than letting them drift.
            sourceKind: 'generated-3d',
            sourceCpRevision: get().oristudioCpRevision,
            startingFaceId: options.startingFaceId ?? 1,
            displayStyle,
            status: 'ready',
            // Exactly one of the two is ever non-null. `folded3d` is the witness
            // the whole UI branches on.
            snapshot: null,
            folded3d: result.snapshot,
            // A 3D figure's picture is a scene; `renderSnapshot` keeps its
            // meaning for the flat figure alone. See `folded3dStoredScene.ts`.
            renderSnapshot: null,
            scene,
            camera,
            // Recorded once, here, because it must not follow the projection:
            // the frame is a window onto the model and a window does not change
            // shape when you turn what is inside it. See `folded3dFrameRadius`.
            frameRadius: folded3dFrameRadius(result.render),
            placement: IDENTITY_FOLDED_PLACEMENT,
            // A seeded model's non-default colours become pins (D1), so the
            // paper-style mirror keeps them rather than writing the display
            // style over them.
            appearance: legacyPaperStyleOverrides(options.model),
            error: null,
            contradiction: null,
            ...foldedSourceProvenance(
              oristudioCpDocument.document,
              selectedLineIds,
              scopedLineIds
            ),
          };
          // A fresh fold is selected **and focused**, which for a 3D figure has
          // to be one step rather than two.
          //
          // Selected alone was the state the user could see — outline and
          // floating toolbar — while the gesture still read as unfocused, so a
          // figure that looked ready to turn moved instead. Focus is what makes
          // the body inert and hands the drag to the camera, so the chrome and
          // the gesture have to arrive together or the chrome is lying.
          //
          // This is also what an inline simulation does: for a window, focus
          // *is* selection (see `selectedCanvasObjectId` in the panel), and a
          // new one opens focused.
          //
          // Through `takeCanvasSelection`, like every other claim: the creases
          // that were folded release their selection in the kernel as well as
          // the store, and any window or annotation that somehow held the canvas
          // lets go. The focus in the patch outranks the helper's own rule for
          // it, because the patch names the figure the focus belongs to.
          takeCanvasSelection('folded-figure', {
            oristudioCpFoldedFigures: [
              ...existing,
              {
                ...folded,
                placement: placeFoldedFigureBesideCp(
                  folded,
                  existing,
                  foldedSourceAnchor,
                  userFrameAngle
                ),
              },
            ],
            oristudioCpActiveFoldedFigureId: figureId,
            oristudioCpFocusedFoldedFigureId: figureId,
            oristudioCpError: null,
            dirty: true,
            projectMessage: 'Folded model',
          });
          refreshFoldedFigureSelectionMarkers(previousActiveId);
          completed(
            fold3dVerdictForAnalytics(result.snapshot),
            result.snapshot.discovered_fold_cases,
            fold3dVerdictProperties(result.snapshot)
          );
          return true;
        } catch (error) {
          // A stop is neither a failure nor a result. Nothing to undo here: this
          // branch deliberately inserts no draft entry, so the canvas is already
          // exactly as the user left it.
          if (isFoldCancellation(error)) {
            completed('halted');
            return false;
          }
          // Only a genuine engine failure reaches here: a refusal is a result.
          const normalized = engineError(error);
          set({ oristudioCpError: normalized.message, error: normalized });
          completed('error');
          return false;
        }
      }

      const figureId = nextGeneratedFoldedFigureId();
      // A fold with a chosen order is of the creases as they stood at its press.
      const sourceCpRevision = withOrder?.figure.sourceCpRevision ?? get().oristudioCpRevision;
      const figureIndex = get().oristudioCpFoldedFigures.length + 1;
      const loadingEntry: OristudioCpFoldedFigureEntry = {
        id: figureId,
        title: `Folded model ${figureIndex}`,
        handle: null,
        sourceKind: 'generated-from-current-cp',
        sourceCpRevision,
        startingFaceId: options.startingFaceId ?? 1,
        displayStyle: 'Paper5',
        status: 'loading',
        snapshot: null,
        renderSnapshot: null,
        placement: IDENTITY_FOLDED_PLACEMENT,
        error: null,
      };

      // What the crease selection was before the draft entry cleared the canvas,
      // so a stopped fold can hand it back rather than making the user reselect
      // the creases they were about to fold.
      const selectionBeforeFold = get().oristudioCpSelection;
      // Releases the canvas — the creases being folded let go, in the kernel too
      // — but claims nothing: a fresh flat fold lands unselected (below), so a
      // draft that took the selection was a figure selected for exactly as long
      // as the kernel took, and every selection-driven surface flashed for it.
      // History never stores the draft: an entry taken while it folds reads the list without it.
      const draftAtRest = holdFoldedPlaceholderAtRest(figureId, get().oristudioCpActiveFoldedFigureId);
      takeCanvasSelection('none', {
        oristudioCpFoldedFigures: [...get().oristudioCpFoldedFigures, loadingEntry],
        oristudioCpError: null,
      });
      // The fold lands only on the draft, which an undo can take away meanwhile.
      const landing = foldLanding(figureId, null);

      try {
        const model = options.model ?? newFoldedFigureModel(oristudioCpDocument.document);
        const result = withOrder
          ? await withFoldInFlight('layer-order', (runId) => foldWithChosenOrder(withOrder, runId))
          : await withFoldInFlight('fold', (runId) =>
              foldRuntimeOristudioCpDocument(
                options.startingFaceId ?? 1,
                options.order ?? 'Order5',
                model,
                selectedLineIds,
                runId
              )
            );
        if (!result) {
          completed('error');
          return discardFoldedFigureDraft(
            figureId,
            i18n.t('errors:cp.layerOrderNotFolded', 'Layer order couldn’t fold these creases in this order.')
          );
        }
        const displayStyle = result.snapshot.display_style;
        // Rendered unselected: a fresh fold is not the canvas selection, so it
        // must not carry the kernel's selection marker either.
        const renderSnapshot = await landing.picture(
          result.handle,
          displayStyle,
          figureIndex,
          false
        );
        // A fold that *returns* has not necessarily produced anything to draw,
        // and this is the same test the refold path already makes. Without it a
        // selection the Euler gate rejects lands as a `ready` figure that draws
        // nothing and says nothing — a placed canvas object with no content, on
        // the one path where the user has no earlier figure to compare it to.
        if (!isDrawableFoldResult(result.snapshot, renderSnapshot)) {
          await freeOristudioCpFoldedFigure(result.handle).catch(() => {});
          completed('not-drawable', result.snapshot.discovered_fold_cases);
          return discardFoldedFigureDraft(
            figureId,
            i18n.t(
              'errors:cp.foldProducedNothing',
              'These creases have no flat folded form to draw'
            )
          );
        }
        // A global layer-ordering contradiction is NOT an error: the estimate
        // still produced a (transparent) figure. Oriedita shows no dialog for
        // this — it highlights the two offending faces red. Carry the pair on
        // the entry so deleting/re-folding the figure clears the highlight for
        // free, and keep the fold out of the error toast path.
        const contradiction = result.snapshot.contradiction ?? null;
        adoptFoldedFigureHandle(result.handle);
        // Park the figure against the creases it was actually folded from, not
        // against the nominal paper square — a pattern can sit anywhere in the
        // sheet, and anchoring to the paper leaves the figure adrift from it.
        // Folded figures live in SVG user space, so the frame angle is read for
        // that space rather than the model's.
        const userFrameAngle = uprightFrameAngle('user');
        const foldedSourceAnchor = cpUserAnchorForLineIds(
          oristudioCpDocument.document,
          selectedLineIds,
          userFrameAngle
        );
        const existing = get().oristudioCpFoldedFigures;
        const folded: OristudioCpFoldedFigureEntry = {
          ...(existing.find((figure) => figure.id === figureId) ?? loadingEntry),
          handle: result.handle,
          status: 'ready',
          displayStyle,
          snapshot: result.snapshot,
          renderSnapshot,
          // The model an Oriedita file saved is the figure's own appearance:
          // its non-default colours become pins (D1), so the paper-style
          // mirror keeps them rather than writing the display style over them.
          appearance: withOrder ? withOrder.figure.appearance : legacyPaperStyleOverrides(model),
          error: null,
          contradiction,
          // Provenance, so the figure can later be told apart from the creases
          // it came from and refolded from them. Oriedita keeps exactly this
          // (a bounding box) — see lib/foldedFigureStaleness.ts. A fold with a
          // chosen order folded its press's creases, so it is theirs: one
          // edited since reads stale.
          ...(withOrder
            ? withOrder.figure.provenance
            : foldedSourceProvenance(oristudioCpDocument.document, selectedLineIds, scopedLineIds)),
          // The order the dialog chose, saved as its record; an Apply that
          // changed nothing folds Oriedita's own order, and saves none.
          ...(held?.ok ? { layerOrder: held.layerOrder } : {}),
        };
        // A fresh flat fold is not selected. Selecting it would put delete-key
        // focus on the new figure the moment it appears, and the folded-figure
        // menu targets the most recent figure anyway (activeGeneratedFoldedFigure).
        // Nothing holds the canvas afterwards: the creases that were folded would
        // otherwise stay selected, so a delete right after folding would take
        // them with it — and through `takeCanvasSelection` they let go in the
        // kernel too, not only in the store.
        takeCanvasSelection('none', {
          oristudioCpFoldedFigures: existing.map((figure) =>
            figure.id === figureId
              ? {
                  ...folded,
                  // Park it beside the crease pattern: the kernel folds into
                  // roughly the flat CP's own coordinates, so left alone the
                  // figure covers the pattern it came from.
                  placement: placeFoldedFigureBesideCp(
                    folded,
                    existing,
                    foldedSourceAnchor,
                    userFrameAngle
                  ),
                }
              : figure
          ),
          oristudioCpError: null,
          dirty: true,
          projectMessage: 'Folded model',
        });
        // `takeCanvasSelection('none')` already redrew the released figure's marker.
        completed(
          contradiction ? 'contradiction' : foldVerdictForOutcome(result.snapshot),
          result.snapshot.discovered_fold_cases
        );
        return true;
      } catch (error) {
        // Undone, or deleted, while it folded: nothing to land on, and nothing to put back.
        if (error instanceof FoldMovedOn) {
          completed('halted');
          return await foldLandedOnNothing(error);
        }
        if (isFoldCancellation(error)) {
          // The draft goes, quietly. Left as an `error` entry it would be debris
          // on the canvas *and* an error toast, for something the user asked for.
          completed('halted');
          return discardFoldedFigureDraftQuietly(figureId, selectionBeforeFold);
        }
        // The draft goes, and the selection comes back — the same cleanup a stop
        // gets, because the debris is the same. `figureId` names a figure this
        // call created moments ago and never filled in; leaving it behind as a
        // permanent `status: 'error'` row put a dead entry in the folded-models
        // menu, aimed the folded-figure verbs at it, and serialised it into the
        // saved `.osf` — for a fold that produced nothing. It also took the
        // user's crease selection with it, which is the part that costs work:
        // the draft claimed the canvas selection when it was inserted, and
        // nothing gave it back unless the fold was cancelled.
        //
        // `discardFoldedFigureDraft` is the shape of this, but it writes an
        // `invalid_operation` envelope; the engine's own code is what
        // `humanizeError` needs to pick the right sentence, so the report is
        // written here.
        const normalized = engineError(error);
        completed('error');
        discardFoldedFigureDraftQuietly(figureId, selectionBeforeFold);
        set({ oristudioCpError: normalized.message, error: normalized });
        return false;
      } finally {
        draftAtRest();
      }
    },

    stopOristudioCpFolds: () => {
      // Only the runs that can actually be stopped. Answering `true` for a run
      // the transport cannot reach would let Escape swallow the key on behalf of
      // a fold that then keeps going — and the affordance is hidden in that case
      // for the same reason.
      const stoppable = stoppableFoldRuns(get().oristudioCpFoldRuns);
      if (stoppable.length === 0) return false;
      // Marked, not removed: the run is still in the kernel until it unwinds at
      // its next checkpoint, and its own `finally` is what clears it. Removing it
      // here would leave the indicator lying in the other direction — gone while
      // the fold is still going — and would leak an untracked run if the stop
      // raced the checkpoint.
      //
      // Every stoppable run is marked, because Stop means all of them; only the
      // oldest is written to the transport, because the transport names one run
      // and the oldest is the one the engine is executing. `withFoldInFlight`
      // re-aims at the next as each finishes.
      const stopped = Object.fromEntries(
        Object.values(get().oristudioCpFoldRuns).map((run) => [
          run.runId,
          run.cancellable ? { ...run, stopping: true } : run,
        ])
      );
      set({ oristudioCpFoldRuns: stopped });
      aimFoldStopAtOldestPending(stopped);
      return true;
    },

    foldAnotherOristudioCpFigure: async (id) => {
      const figure =
        (id
          ? get().oristudioCpFoldedFigures.find((candidate) => candidate.id === id)
          : activeGeneratedFoldedFigure()) ?? null;
      if (figure?.handle == null || figure.status !== 'ready') {
        const message =
          figure?.status === 'stale'
            ? 'Refold the stale folded model first'
            : 'No folded model is ready';
        set({
          oristudioCpError: message,
          error: {
            code: 'invalid_operation',
            message,
          },
        });
        return false;
      }
      // Oriedita's search knows nothing of a chosen order's constraints: a
      // constrained figure steps through the solutions that fit them instead
      // (`stepOristudioCpFigureLayerOrder`), and a newer build's is its own.
      if (foldedFigureLayerOrderHold(figure) !== null) {
        const message = 'A folded model with layer constraints steps through the solutions that fit them';
        set({ oristudioCpError: message, error: { code: 'invalid_operation', message } });
        return false;
      }

      // Read before the call, because the call is what changes it. Exactly the
      // predicate `buildFoldedFigureActions` labels the verb from, and exactly
      // the branch `fold_another` takes in the kernel — so the event, the button
      // and the search agree about which of the two a press was. Read through
      // `foldedFigureCycling`, which is the one place that knows a figure has
      // two kinds; both spell the two fields the same way.
      const cycling = foldedFigureCycling(figure);
      const cycleDirection = cycling.wrapsToFirst ? 'wrap' : 'next';
      const spatial = (figure.folded3d ?? null) !== null;

      // An entry taken while it steps reads the figure as it was before the press.
      const atRest = holdFoldedFigureAtRest(figure);
      set({
        oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
          candidate.id === figure.id ? { ...candidate, status: 'loading' } : candidate
        ),
      });

      try {
        // Captured after the guard above: the closure would otherwise lose the
        // narrowing on a mutable property.
        const handle = figure.handle;
        // The two kinds of figure have two kernel commands, and sending one to
        // the other's is not a silent no-op: `flat_mut` answers
        // `folded_figure_kind_mismatch`, and a success would be worse — it would
        // write a flat snapshot onto an entry that already has `folded3d`,
        // leaving both witnesses non-null.
        if (spatial) {
          const step = await withFoldInFlight('another-3d', (runId) =>
            fold3dRuntimeOristudioCpFigureAnother(handle, runId)
          );
          // Noted before anything reads it: the event, then the entry's readout.
          const known = noteFoldedSolutions(figure, handle, step.snapshot);
          track(ANALYTICS_EVENTS.foldSolutionCycled, {
            direction: cycleDirection,
            solution_count_bucket: bucketCount(known, COUNT_BUCKETS),
          });
          setFolded3dRenderModel(handle, step.render);
          const camera =
            figure.camera ?? defaultFolded3dCamera(step.render, step.snapshot.model.state);
          const scene = project3dScene(
            step.render,
            step.snapshot,
            figure.displayStyle,
            camera,
            figure
          );
          takeCanvasSelection('folded-figure', {
            oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
              candidate.id === figure.id
                ? {
                    ...candidate,
                    status: 'ready',
                    folded3d: step.snapshot,
                    scene: scene ?? candidate.scene,
                    camera,
                    error: null,
                  }
                : candidate
            ),
            oristudioCpActiveFoldedFigureId: figure.id,
            oristudioCpError: null,
            dirty: true,
            projectMessage: 'Advanced folded model',
          });
          return true;
        }
        const snapshot = await withFoldInFlight('another', (runId) =>
          foldRuntimeOristudioCpFigureAnother(handle, runId)
        );
        // Noted before anything reads it: the event, then the entry's readout.
        const known = noteFoldedSolutions(figure, handle, snapshot);
        track(ANALYTICS_EVENTS.foldSolutionCycled, {
          direction: cycleDirection,
          solution_count_bucket: bucketCount(known, COUNT_BUCKETS),
        });
        const renderSnapshot = await renderSnapshotForFoldedFigure(
          figure.handle,
          figure.displayStyle,
          foldedFigureIndex(figure.id),
          true
        );
        takeCanvasSelection('folded-figure', {
          oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
            candidate.id === figure.id
              ? {
                  ...candidate,
                  status: 'ready',
                  snapshot,
                  renderSnapshot,
                  error: null,
                }
              : candidate
          ),
          oristudioCpActiveFoldedFigureId: figure.id,
          oristudioCpError: null,
          dirty: true,
          projectMessage: 'Advanced folded model',
        });
        return true;
      } catch (error) {
        // Stopped: the figure never changed, so it goes back to `ready` showing
        // the solution it already was. The kernel rolled its session back for the
        // same reason (Phase 3's transaction), so the two agree.
        if (isFoldCancellation(error)) return restorePreviousFigureQuietly(figure);
        const normalized = engineError(error);
        set({
          oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
            candidate.id === figure.id
              ? { ...candidate, status: 'error', error: normalized.message }
              : candidate
          ),
          oristudioCpError: normalized.message,
          error: normalized,
        });
        return false;
      } finally {
        atRest();
      }
    },

    foldOristudioCpFigureToCase: async (id, objective) => {
      const figure = get().oristudioCpFoldedFigures.find((candidate) => candidate.id === id);
      // There is deliberately no 3D `fold_to_case`: `discovered_fold_cases` is a
      // forward-only high-water mark over an odometer of per-component streams,
      // so there is no total to batch towards and "case N" names nothing stable.
      // Refused here rather than at the kernel, so the raw
      // `folded_figure_kind_mismatch` code never surfaces as English.
      if (figure && (figure.folded3d ?? null) !== null) {
        const message = 'A 3D folded model has no numbered solutions to batch to';
        set({
          oristudioCpError: message,
          error: { code: 'invalid_operation', message },
        });
        return false;
      }
      if (figure?.handle == null || figure.status !== 'ready') {
        const message =
          figure?.status === 'stale'
            ? 'Refold the stale folded model first'
            : 'No folded model is ready';
        set({
          oristudioCpError: message,
          error: {
            code: 'invalid_operation',
            message,
          },
        });
        return false;
      }
      // As Another solution: a chosen order is no case of Oriedita's search.
      if (foldedFigureLayerOrderHold(figure) !== null) {
        const message = 'A folded model with layer constraints steps through the solutions that fit them';
        set({ oristudioCpError: message, error: { code: 'invalid_operation', message } });
        return false;
      }

      // An entry taken while it steps reads the figure as it was before the press.
      const atRest = holdFoldedFigureAtRest(figure);
      set({
        oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
          candidate.id === figure.id ? { ...candidate, status: 'loading' } : candidate
        ),
      });

      try {
        const handle = figure.handle;
        const result = await withFoldInFlight('to-case', (runId) =>
          foldRuntimeOristudioCpFigureToCase(handle, objective, 'Order5', runId)
        );
        // A seek back restarts the enumeration and forgets what it found past
        // the case it lands on; the handle's frontier does not.
        noteFoldedSolutions(figure, handle, result.snapshot);
        const renderSnapshot = await renderSnapshotForFoldedFigure(
          figure.handle,
          figure.displayStyle,
          foldedFigureIndex(figure.id),
          true
        );
        takeCanvasSelection('folded-figure', {
          oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
            candidate.id === figure.id
              ? {
                  ...candidate,
                  status: 'ready',
                  snapshot: result.snapshot,
                  renderSnapshot,
                  error: null,
                }
              : candidate
          ),
          oristudioCpActiveFoldedFigureId: figure.id,
          oristudioCpError: null,
          dirty: true,
          projectMessage: 'Folded model case updated',
        });
        return true;
      } catch (error) {
        // A batch is the run most worth stopping — it folds towards a numbered
        // case and can walk a long way to get there. Stopped, the figure keeps
        // the case it was already showing.
        if (isFoldCancellation(error)) return restorePreviousFigureQuietly(figure);
        const normalized = engineError(error);
        set({
          oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
            candidate.id === figure.id
              ? { ...candidate, status: 'error', error: normalized.message }
              : candidate
          ),
          oristudioCpError: normalized.message,
          error: normalized,
        });
        return false;
      } finally {
        atRest();
      }
    },

    setOristudioCpFolded3dCamera: async (id, camera) => {
      const figure = get().oristudioCpFoldedFigures.find((candidate) => candidate.id === id);
      if (!figure || (figure.folded3d ?? null) === null) {
        const message = 'No 3D folded model is ready';
        set({
          oristudioCpError: message,
          error: { code: 'invalid_operation', message },
        });
        return false;
      }

      // The camera is recorded whether or not the picture can be remade: a
      // figure reopened from a file has no render model (it is deliberately not
      // persisted), and blanking it would be worse than showing the saved view
      // until the next refold, which does honour the stored camera.
      //
      // Only the *orientation* is rebuilt, because only the orientation reaches
      // the picture: zoom is a window setting the scene camera deliberately
      // ignores (see `FoldedFigureCamera.zoom`), so rebuilding for one would be
      // a BSP build and a hidden-piece pass to arrive at the picture already on
      // the entry.
      const before = figure.camera ?? null;
      const sameView =
        before !== null && before.yaw === camera.yaw && before.pitch === camera.pitch;
      const scene = sameView ? null : reproject3dSceneAt(figure, figure.displayStyle, camera);
      takeCanvasSelection('folded-figure', {
        oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
          candidate.id === figure.id
            ? {
                ...candidate,
                camera,
                scene: scene ?? candidate.scene,
              }
            : candidate
        ),
        oristudioCpActiveFoldedFigureId: figure.id,
        oristudioCpError: null,
        dirty: true,
      });
      return true;
    },

    setOristudioCpFoldedFigureDisplayStyle: async (id, displayStyle) => {
      const figure = get().oristudioCpFoldedFigures.find((candidate) => candidate.id === id);
      if (figure?.handle == null) {
        const message = 'No folded model is ready';
        set({
          oristudioCpError: message,
          error: { code: 'invalid_operation', message },
        });
        return false;
      }

      // A 3D figure's picture is made here, not by the kernel, so a style change
      // is a re-projection rather than a round trip. Ungated it would reach
      // `folded_figure_render_snapshot`, whose `flat(handle)` rejects a spatial
      // one — and the rejection would be caught below and written onto the entry
      // as `status: 'error'`, destroying a perfectly good figure over a style
      // click.
      // Changing a figure's style selects it — before the round trip, for the
      // same reason as `updateOristudioCpFoldedFigureModel`: a claim made when
      // the kernel answers would take the selection back from whatever the user
      // clicked while it was in flight.
      if (get().oristudioCpActiveFoldedFigureId !== figure.id) {
        takeCanvasSelection('folded-figure', { oristudioCpActiveFoldedFigureId: figure.id });
      }

      if ((figure.folded3d ?? null) !== null) {
        const scene = reproject3dScene(figure, displayStyle);
        // A figure reopened from a file has no render model: keep the stored
        // picture rather than blanking it, and still record the chosen style so
        // a refold shows it.
        set({
          oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
            candidate.id === figure.id
              ? {
                  ...candidate,
                  displayStyle,
                  scene: scene ?? candidate.scene,
                }
              : candidate
          ),
          oristudioCpError: null,
          dirty: true,
        });
        return true;
      }

      try {
        const renderSnapshot = await renderSnapshotForFoldedFigure(
          figure.handle,
          displayStyle,
          foldedFigureIndex(figure.id),
          get().oristudioCpActiveFoldedFigureId === figure.id
        );
        set({
          oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
            candidate.id === figure.id ? { ...candidate, displayStyle, renderSnapshot } : candidate
          ),
          oristudioCpError: null,
          dirty: true,
        });
        return true;
      } catch (error) {
        const normalized = engineError(error);
        set({
          oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
            candidate.id === figure.id
              ? { ...candidate, status: 'error', error: normalized.message }
              : candidate
          ),
          oristudioCpError: normalized.message,
          error: normalized,
        });
        return false;
      }
    },

    updateOristudioCpFoldedFigureModel: async (id, update, options) => {
      const figure = get().oristudioCpFoldedFigures.find((candidate) => candidate.id === id);
      // A mirror write is the store keeping the model in step with the figure's
      // effective paper style: derived, not an edit, so it neither selects the
      // figure nor dirties the project. Every user edit does both.
      const edit = !options?.mirror;

      // A 3D figure keeps its model on `folded3d`, not in the kernel, so this
      // writes the entry and reaches nothing. No request sequencing either:
      // there is nothing in flight to land out of order.
      //
      // And no rebuild of the picture. The model's colours are a derived mirror
      // of the figure's effective style (D6), and a 3D figure's picture is a
      // `PaperScene` — geometry and roles, no ink — so nothing in this update
      // can move a vertex. The canvas and the painter re-ink the same scene from
      // the style; the model is kept because the `.ori` round trip reads it.
      const spatial = figure?.folded3d ?? null;
      if (figure && spatial) {
        const model: OristudioCpFoldedFigureModel = { ...spatial.model, ...update };
        const next = { ...spatial, model };
        const figures = get().oristudioCpFoldedFigures.map((candidate) =>
          candidate.id === figure.id ? { ...candidate, folded3d: next } : candidate
        );
        if (edit) {
          takeCanvasSelection('folded-figure', {
            oristudioCpFoldedFigures: figures,
            oristudioCpActiveFoldedFigureId: figure.id,
            oristudioCpError: null,
            dirty: true,
          });
        } else {
          set({ oristudioCpFoldedFigures: figures, oristudioCpError: null });
        }
        return true;
      }

      if (figure?.handle == null || !figure.snapshot) {
        const message = 'No folded model is ready';
        set({
          oristudioCpError: message,
          error: { code: 'invalid_operation', message },
        });
        return false;
      }

      // Editing a figure's appearance selects it — now, before the round trip.
      // The landing below writes only the figure entry: a claim made when the
      // kernel answers would yank the selection back from whatever the user
      // clicked in the meantime, and clear that crease selection in the kernel
      // with it.
      if (edit && get().oristudioCpActiveFoldedFigureId !== figure.id) {
        takeCanvasSelection('folded-figure', { oristudioCpActiveFoldedFigureId: figure.id });
      }
      // Merge onto the newest *issued* model while writes are in flight, not
      // onto the store's copy: the store lags a round trip, so two writes to
      // different fields issued back to back would each carry the other's old
      // value, and the newer one — the only one allowed to land — would drop
      // the older field.
      const model: OristudioCpFoldedFigureModel = {
        ...(issuedModels.get(id) ?? figure.snapshot.model),
        ...update,
      };
      issuedModels.set(id, model);
      // Continuous controls (the colour pickers, the alpha slider) fire a change
      // per pointer move, so several round-trips can be in flight at once and
      // could otherwise land out of order. Only the newest request for a figure
      // is allowed to write.
      const requestId = (modelRequestSequence.get(id) ?? 0) + 1;
      modelRequestSequence.set(id, requestId);
      pendingLiveModelWrites.set(id, liveModelWriteCount(id) + 1);
      try {
        const snapshot = await writeFoldedFigureModel(figure.handle, model);
        const renderSnapshot = await renderSnapshotForFoldedFigure(
          figure.handle,
          figure.displayStyle,
          foldedFigureIndex(figure.id),
          get().oristudioCpActiveFoldedFigureId === figure.id
        );
        if (modelRequestSequence.get(id) !== requestId) return true;
        set({
          oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
            candidate.id === figure.id
              ? { ...candidate, snapshot, renderSnapshot, error: null }
              : candidate
          ),
          oristudioCpError: null,
          ...(edit ? { dirty: true } : {}),
        });
        return true;
      } catch (error) {
        const normalized = engineError(error);
        set({
          oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
            candidate.id === figure.id
              ? { ...candidate, status: 'error', error: normalized.message }
              : candidate
          ),
          oristudioCpError: normalized.message,
          error: normalized,
        });
        return false;
      } finally {
        const remaining = liveModelWriteCount(id) - 1;
        if (remaining > 0) {
          pendingLiveModelWrites.set(id, remaining);
        } else {
          pendingLiveModelWrites.delete(id);
          issuedModels.delete(id);
          // The last in-flight write for a figure whose writes were superseded
          // by an undo has landed in the kernel and nowhere else; the reconcile
          // the undo scheduled found a write still counted and stood down, so
          // schedule it again now that it can act.
          if (supersededLiveModelWrites.delete(id)) {
            void get().reconcileFoldedFigureModels([id]);
          }
        }
      }
    },

    supersedeOristudioCpFoldedFigureModelWrites: () => {
      for (const [id, count] of pendingLiveModelWrites) {
        if (count <= 0) continue;
        // A bumped sequence makes every in-flight response for the figure
        // stale: it will not write the store. It did reach the kernel, though,
        // which is what the deferred reconcile above puts right.
        modelRequestSequence.set(id, (modelRequestSequence.get(id) ?? 0) + 1);
        issuedModels.delete(id);
        supersededLiveModelWrites.add(id);
      }
    },

    /**
     * Re-run the fold for a figure whose source creases have changed, keeping
     * the figure itself: same id, placement, display style, model and starting
     * face, new geometry.
     *
     * Oriedita refolds in place only when the creases are *unchanged*, and
     * discards the figure when they differ (`FoldingServiceImpl.fold`). We
     * refold in place either way — here a folded figure is a placed canvas
     * object, not a transient view, so throwing it away on an edit would lose
     * work the user can see. The source selection (reselect by bounding box) and
     * the fold itself are unchanged from upstream.
     */
    refoldOristudioCpFoldedFigure: async (id, options) => {
      const oristudioCpDocument = get().oristudioCpDocument;
      const figure = get().oristudioCpFoldedFigures.find((candidate) => candidate.id === id);
      if (!oristudioCpDocument || !figure || figure.sourceBounds == null) {
        const message = 'This folded model has no recorded source creases to refold from';
        set({
          oristudioCpError: message,
          error: { code: 'invalid_operation', message },
        });
        return false;
      }
      // The toolbar's hold on a newer build's layer order, for a call that reaches here without it.
      if (refoldHeldByLayerOrder(figure)) {
        const message = refoldHeldByLayerOrderReason(i18n.t);
        set({ oristudioCpError: message, error: { code: 'invalid_operation', message } });
        return false;
      }

      const lineIds = reselectFoldableLineIds(oristudioCpDocument.document, figure.sourceBounds);
      // The unfiltered half of the same reselect. A refold has no live selection
      // to record, so the region "simulate instead" would resolve is re-derived
      // from the box the same way the folded set is — see `reselectSourceLineIds`.
      const scopedRefoldLineIds = reselectSourceLineIds(
        oristudioCpDocument.document,
        figure.sourceBounds
      );
      // Matches what folding itself requires (`foldOristudioCpDocument` rejects
      // an empty selection); anything the kernel will accept, a refold should.
      if (lineIds.length === 0) {
        const message = 'The creases this folded model came from are gone';
        set({
          oristudioCpError: message,
          error: { code: 'invalid_operation', message },
        });
        return false;
      }

      const previousHandle = figure.handle;
      // Which teardown generation this refold belongs to, captured before the
      // await. See `adoptFolded3dHandle`.
      const refoldEpoch = foldedFigureHandleEpoch();
      // It lands only on the figure as this marks it: still holding `previousHandle`.
      const landing = foldLanding(figure.id, previousHandle);
      // An entry taken while it refolds reads the figure as it was before the press.
      const atRest = holdFoldedFigureAtRest(figure);
      set({
        oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
          candidate.id === figure.id ? { ...candidate, status: 'loading' } : candidate
        ),
        oristudioCpError: null,
      });

      // A refold reselects, so the creases it is folding now may not be the kind
      // it was folded from: give a figure fold angles and it becomes 3D, take
      // them away and it becomes flat again. The route is therefore recomputed
      // from the reselected ids, and the figure **swaps kind in place** — one
      // witness set, the other cleared. Leaving both non-null would break the
      // invariant the whole UI branches on.
      const refoldRoute = resolveFoldRoute(oristudioCpDocument.document, lineIds);
      if (refoldRoute.kind === 'none') {
        // Unreachable through `reselectFoldableLineIds`, which already applies
        // the same colour filter — but the route is the authority on what the
        // kernel will accept, and disagreeing with it silently is how a fold
        // reaches the wrong door.
        atRest();
        return restorePreviousFigure(figure, 'The creases this folded model came from are gone');
      }
      if (refoldRoute.kind === 'spatial') {
        try {
          const result = await withFoldInFlight('refold-3d', (runId) =>
            fold3dRuntimeOristudioCpDocument(
              refoldRoute.lineIds,
              figure.startingFaceId ?? 1,
              figure.folded3d?.model,
              runId
            )
          );
          if (result.status === 'refused') {
            // A refusal on a refold restores rather than offering the simulator:
            // a refold can be triggered in the background by a stale figure, and
            // a background action must not raise a modal. The old figure is
            // still a valid picture of the creases it was folded from.
            return restorePreviousFigure(
              figure,
              fold3dRefusalMessage(i18n.t, result.refusal)
            );
          }
          landing.check(result.handle);
          const camera = defaultFolded3dCamera(result.render, result.snapshot.model.state);
          const scene = project3dScene(
            result.render,
            result.snapshot,
            figure.displayStyle,
            camera,
            // The frame is resized to the refolded geometry below, so the
            // picture is built at that frame and not at the one being replaced.
            { appearance: figure.appearance, frameRadius: folded3dFrameRadius(result.render) }
          );
          if (!(await adoptFolded3dHandle(figure.id, refoldEpoch, result.handle, result.render))) {
            return false;
          }
          // A chosen layer order is kept, waiting for the creases to fold flat again (D13).
          const layerOrder = routed3dFigureLayerOrder(figure.layerOrder);
          takeCanvasSelection('folded-figure', {
            oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
              candidate.id === figure.id
                ? {
                    ...candidate,
                    ...(layerOrder ? { layerOrder } : {}),
                    handle: result.handle,
                    status: 'ready',
                    snapshot: null,
                    folded3d: result.snapshot,
                    renderSnapshot: null,
                    scene,
                    camera,
                    // Refolded geometry is different geometry, so the frame is
                    // resized to it. Carrying the old one over would leave a
                    // window sized for paper that is no longer there.
                    frameRadius: folded3dFrameRadius(result.render),
                    // The kind swaps with the witness. A figure whose creases
                    // gained fold angles since it was folded is a 3D figure now,
                    // and leaving `sourceKind` behind would leave the two
                    // witnesses disagreeing.
                    sourceKind: 'generated-3d',
                    sourceCpRevision: get().oristudioCpRevision,
                    contradiction: null,
                    error: null,
                    ...foldedSourceProvenance(
                      oristudioCpDocument.document,
                      refoldRoute.lineIds,
                      scopedRefoldLineIds
                    ),
                  }
                : candidate
            ),
            oristudioCpActiveFoldedFigureId: figure.id,
            oristudioCpError: null,
            dirty: true,
            projectMessage: 'Refolded model',
          });
          releaseFoldedFigureHandle(previousHandle);
          if (layerOrder?.kind === 'record' && figure.layerOrder?.kind === 'record') {
            trackFigureLayerOrderAttention(figure.layerOrder.record.attention ?? null, layerOrder.record.attention ?? null);
          }
          return true;
        } catch (error) {
          if (error instanceof FoldMovedOn) return await foldLandedOnNothing(error);
          if (isFoldCancellation(error)) return restorePreviousFigureQuietly(figure);
          return restorePreviousFigure(figure, engineError(error).message);
        } finally {
          atRest();
        }
      }

      // A chosen layer order refolds in it, or keeps the picture flagged (D10).
      if (figure.layerOrder?.kind === 'record') {
        try {
          return await refoldFigureInLayerOrder(
            figure,
            figure.layerOrder,
            oristudioCpDocument.document,
            refoldRoute.lineIds,
            scopedRefoldLineIds,
            options?.onLayerOrder
          );
        } finally {
          atRest();
        }
      }

      try {
        const result = await withFoldInFlight('refold', (runId) =>
          foldRuntimeOristudioCpDocument(
            figure.startingFaceId ?? 1,
            'Order5',
            figure.snapshot?.model,
            refoldRoute.lineIds,
            runId
          )
        );
        const renderSnapshot = await landing.picture(
          result.handle,
          figure.displayStyle,
          foldedFigureIndex(figure.id),
          true
        );
        // A fold that *returns* has not necessarily produced anything: a global
        // flat-foldability contradiction concludes at the transparent
        // development with no layer ordering and nothing to draw. Swapping that
        // in would replace a perfectly good figure with an empty one, so treat
        // it exactly like a throw and keep what the user is looking at.
        if (!isDrawableFoldResult(result.snapshot, renderSnapshot)) {
          await freeOristudioCpFoldedFigure(result.handle).catch(() => {});
          return restorePreviousFigure(
            figure,
            'This crease pattern can no longer be folded flat, so the folded model is unchanged'
          );
        }
        // A refold is a new search on a new handle: it starts from what it found.
        adoptFoldedFigureHandle(result.handle);
        takeCanvasSelection('folded-figure', {
          oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
            candidate.id === figure.id
              ? {
                  ...candidate,
                  handle: result.handle,
                  status: 'ready',
                  snapshot: result.snapshot,
                  // The other half of the kind swap: a figure whose creases have
                  // since been made classic refolds flat, and must stop claiming
                  // to be 3D.
                  folded3d: null,
                  camera: null,
                  sourceKind: 'generated-from-current-cp',
                  renderSnapshot,
                  sourceCpRevision: get().oristudioCpRevision,
                  contradiction: result.snapshot.contradiction ?? null,
                  error: null,
                  // Re-baseline against what was actually folded, so the figure
                  // reads as up to date until the creases move again.
                  ...foldedSourceProvenance(
                      oristudioCpDocument.document,
                      refoldRoute.lineIds,
                      scopedRefoldLineIds
                    ),
                }
              : candidate
          ),
          oristudioCpActiveFoldedFigureId: figure.id,
          oristudioCpError: null,
          dirty: true,
          projectMessage: 'Refolded model',
        });
        // Released only after the new handle is in place: the old one may still
        // be referenced by history entries, and releasing early would free a
        // handle an undo still needs (see foldedFigureHandles).
        releaseFoldedFigureHandle(previousHandle);
        return true;
      } catch (error) {
        // A refold is a no-op when it fails. The figure on the canvas is still
        // valid — it is the *crease pattern* that cannot be folded — and the old
        // kernel handle is untouched, since it is released only after a success.
        // Stopping one is the same no-op with nothing to say about it.
        if (error instanceof FoldMovedOn) return await foldLandedOnNothing(error);
        if (isFoldCancellation(error)) return restorePreviousFigureQuietly(figure);
        return restorePreviousFigure(figure, engineError(error).message);
      } finally {
        atRest();
      }
    },

    /**
     * Give a reopened 3D figure its geometry back, without changing what it
     * draws.
     *
     * A refold in every mechanical respect, and the opposite of one in intent.
     * **Refold** replaces the picture with one made from the creases as they are
     * now, which is why it is an explicit verb with an undo entry; this
     * reproduces the picture that is already on screen, and so records nothing,
     * dirties nothing, selects nothing and reports nothing. The user is not told
     * because there is nothing to tell them: the figure looks the same before
     * and after, and can now be turned.
     *
     * Which figures qualify, and why each condition is there, is
     * {@link canRehydrateFolded3dFigure}. Two more guards live here because they
     * need the document and the kernel:
     *
     * - **Stale figures are refused.** A figure whose creases have moved would
     *   come back as a *different* fold, which is the one thing this must not
     *   do. Refold is the door for that, and it asks first.
     * - **The result has to be the same fold.** A fresh session opens at
     *   solution 1, so a figure saved at a later one is stepped back to it and
     *   the index is checked; and the frame the geometry produces is checked
     *   against the frame the figure is drawn in. Either disagreeing means the
     *   picture would change, so the handle is freed and the figure keeps
     *   exactly what it has.
     *
     * `pending` is the on-demand case — someone pressed the figure and is
     * waiting — and shows as the ordinary `loading` status the folded-models
     * list already words. The background pass leaves the status alone, because
     * a row that says "Folding…" on its own is a change to what the user sees.
     */
    rehydrateOristudioCpFolded3dFigure: async (id, options) => {
      const oristudioCpDocument = get().oristudioCpDocument;
      const figure = get().oristudioCpFoldedFigures.find((candidate) => candidate.id === id);
      if (!oristudioCpDocument || !figure) return false;
      if (!canRehydrateFolded3dFigure(figure) || figure.sourceBounds == null) return false;
      // Left alone on purpose — see the note above.
      if (isFoldedFigureStale(oristudioCpDocument.document, figure)) return false;
      // Re-entrancy: the background queue and a press can both name the same
      // figure, and two folds of it would leak one of the two handles.
      if (pendingFolded3dRehydrations.has(id)) return false;

      const lineIds = reselectFoldableLineIds(oristudioCpDocument.document, figure.sourceBounds);
      if (lineIds.length === 0) return false;
      // Unreachable while the figure is not stale — the fingerprint it matched
      // is over the same reselect — but the route is the authority on what the
      // kernel will accept, and folding 3D creases through the flat door is how
      // a figure silently swaps kind.
      const route = resolveFoldRoute(oristudioCpDocument.document, lineIds);
      if (route.kind !== 'spatial') return false;
      const replaySteps = folded3dSolutionReplaySteps(figure);
      if (replaySteps === null) return false;
      const targetSolution = folded3dTargetSolution(figure);

      // Which teardown generation this fold belongs to. A document replaced
      // while it is in flight frees every handle in the kernel, so adopting the
      // one that comes back would attach a figure to a dead session.
      const epoch = foldedFigureHandleEpoch();
      pendingFolded3dRehydrations.add(id);
      const setStatus = (status: OristudioCpFoldedFigureEntry['status']) => {
        set({
          oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
            candidate.id === id ? { ...candidate, status } : candidate
          ),
        });
      };
      // An undo entry taken while the press waits reads the figure as it was before it.
      const atRest = options?.pending ? holdFoldedFigureAtRest(figure) : () => {};
      if (options?.pending) setStatus('loading');

      // Fired only from here on, i.e. only once a fold has actually been asked
      // for — a figure the rules skip is not an attempt and has nothing to
      // report. Two enums, no counts: the whole process is invisible by design,
      // so this is the only evidence that it works in the field.
      const trigger = options?.pending ? 'press' : 'background';

      /** Give the handle back and leave the figure exactly as it was. */
      const abandon = async (handle: number | null): Promise<false> => {
        if (handle !== null) await freeOristudioCpFoldedFigure(handle).catch(() => {});
        if (options?.pending && foldedFigureHandleEpoch() === epoch) setStatus('ready');
        track(ANALYTICS_EVENTS.foldedFigureRehydrated, { trigger, outcome: 'refused', mode: 'spatial' });
        return false;
      };

      // Held outside the try so a throw part-way through the replay still gives
      // the handle back; a leaked 3D session is megabytes, not bytes.
      let handle: number | null = null;
      try {
        // Deliberately not wrapped in `withFoldInFlight`: that drives the global
        // "Folding…" indicator, and a background pass on load must not raise one.
        // `FOLD_RUN_NONE`: the rehydrate is unindicated by design, so the user
        // has nothing to press and nothing to aim at — and a Stop meant for the
        // fold they *can* see must not reach in here and abandon a figure that
        // was about to come back. Unbound rather than `BACKGROUND`, because the
        // kernel skips its rollback snapshot only when nothing is bound, and
        // this loop takes one per replay step on load.
        const result = await fold3dRuntimeOristudioCpDocument(
          route.lineIds,
          figure.startingFaceId ?? 1,
          figure.folded3d?.model,
          FOLD_RUN_NONE
        );
        if (result.status === 'refused') return await abandon(null);
        handle = result.handle;

        let snapshot = result.snapshot;
        let render = result.render;
        for (let step = 0; step < replaySteps; step += 1) {
          const advanced = await fold3dRuntimeOristudioCpFigureAnother(
            result.handle,
            FOLD_RUN_NONE
          );
          snapshot = advanced.snapshot;
          render = advanced.render;
        }
        // The odometer is deterministic, so this holds within a build. It can
        // fail across one whose solver enumerates differently, and then the
        // figure would come back showing a layer order nobody chose — so it is
        // checked rather than assumed.
        if (snapshot.current_fold_case !== targetSolution) return await abandon(handle);
        // Same creases, same fold, same size. Cheap, and it is the one number
        // that says the geometry the window will draw is the geometry the stored
        // picture was drawn from.
        if (!sameFolded3dFrame(folded3dFrameRadius(render), figure.frameRadius)) {
          return await abandon(handle);
        }

        if (foldedFigureHandleEpoch() !== epoch) return await abandon(handle);
        const latest = get().oristudioCpFoldedFigures.find((candidate) => candidate.id === id);
        // Deleted, refolded or rehydrated by another path while this was in
        // flight. Adopting now would overwrite a newer handle and leak it.
        if (!latest || latest.handle != null) return await abandon(handle);

        adoptFoldedFigureHandle(handle);
        setFolded3dRenderModel(handle, render);
        set({
          oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
            candidate.id === id
              ? {
                  ...candidate,
                  handle,
                  status: 'ready',
                  // The live session's own snapshot, not the stored one. They
                  // describe the same fold, but `discovered_fold_cases` is a
                  // high-water mark over *this* session's stepping, and keeping
                  // the file's would make "Show another solution" report a
                  // history the session it now drives does not have.
                  folded3d: snapshot,
                  error: null,
                }
              : candidate
          ),
          // No `dirty`, no `projectMessage`, no selection, no history entry.
          // Nothing about the document changed; a figure that could not be
          // turned now can be.
        });
        track(ANALYTICS_EVENTS.foldedFigureRehydrated, { trigger, outcome: 'adopted', mode: 'spatial' });
        return true;
      } catch {
        // Silent by design. A background rehydrate that fails leaves a figure
        // exactly as good as it was, and `oristudioCpError` is a toast.
        return await abandon(handle);
      } finally {
        pendingFolded3dRehydrations.delete(id);
        atRest();
      }
    },

    duplicateOristudioCpFoldedFigure: async (id) => {
      const source =
        (id
          ? get().oristudioCpFoldedFigures.find((candidate) => candidate.id === id)
          : activeGeneratedFoldedFigure()) ?? null;
      if (source?.handle == null) {
        const message = 'No folded model is ready';
        set({
          oristudioCpError: message,
          error: { code: 'invalid_operation', message },
        });
        return false;
      }

      const previousActiveId = get().oristudioCpActiveFoldedFigureId;
      const figureId = nextGeneratedFoldedFigureId();
      const figureIndex = get().oristudioCpFoldedFigures.length + 1;
      const loadingEntry: OristudioCpFoldedFigureEntry = {
        id: figureId,
        title: `Folded model ${figureIndex}`,
        handle: null,
        sourceKind: source.sourceKind,
        sourceCpRevision: source.sourceCpRevision,
        startingFaceId: source.startingFaceId,
        displayStyle: source.displayStyle,
        status: 'loading',
        snapshot: null,
        renderSnapshot: null,
        placement: source.placement,
        // A copy keeps its original's pins on the paper style; the kernel
        // clones the model beneath them.
        appearance: source.appearance,
        // A copy is folded from the same creases, so it inherits the provenance
        // and goes stale with its original.
        sourceBounds: source.sourceBounds ?? null,
        sourceFingerprint: source.sourceFingerprint ?? null,
        sourceLineIds: [...(source.sourceLineIds ?? [])],
        sourceScopedLineIds: [...(source.sourceScopedLineIds ?? source.sourceLineIds ?? [])],
        // A copy shows its original's chosen layer order — the kernel clones
        // the session with its given order — so it keeps the record that
        // order was saved as, and saves it under its own id.
        ...(source.layerOrder ? { layerOrder: source.layerOrder } : {}),
        error: null,
      };

      // Captured before the await: the placeholder below is deletable while it
      // loads, exactly as a refolding figure is. See `adoptFolded3dHandle`.
      const duplicateEpoch = foldedFigureHandleEpoch();
      // The copy lands only on that placeholder, which an undo can take away.
      const landing = foldLanding(figureId, null);
      // History never stores the placeholder, nor stores it as the selection, which the copy
      // takes now: an entry taken meanwhile reads the list without it, and what was selected before.
      const placeholderAtRest = holdFoldedPlaceholderAtRest(figureId, get().oristudioCpActiveFoldedFigureId);
      takeCanvasSelection('folded-figure', {
        oristudioCpFoldedFigures: [...get().oristudioCpFoldedFigures, loadingEntry],
        oristudioCpActiveFoldedFigureId: figureId,
        oristudioCpError: null,
      });

      try {
        // The fourth door into a folder, and the one easiest to miss: the flat
        // duplicate command takes `flat(handle)` too. A duplicated 3D figure
        // shows the solution its original was showing and cycles independently
        // of it thereafter, because the kernel clones the whole session.
        if ((source.folded3d ?? null) !== null) {
          const result = await duplicateRuntimeOristudioCp3dFoldedFigure(source.handle);
          if (result.status === 'refused') {
            // Unreachable in practice — the source was already placed — but a
            // refusal is a result, so it has to be answered rather than fall
            // through as if a handle had come back.
            throw new Error(fold3dRefusalMessage(i18n.t, result.refusal));
          }
          landing.check(result.handle);
          const camera =
            source.camera ?? defaultFolded3dCamera(result.render, result.snapshot.model.state);
          const scene = project3dScene(
            result.render,
            result.snapshot,
            source.displayStyle,
            camera,
            { appearance: source.appearance, frameRadius: folded3dFrameRadius(result.render) }
          );
          if (
            // The kernel cloned the whole session: the copy has searched as far.
            !(await adoptFolded3dHandle(figureId, duplicateEpoch, result.handle, result.render, {
              copyFrom: source.handle,
            }))
          ) {
            return false;
          }
          takeCanvasSelection('folded-figure', {
            oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((figure) =>
              figure.id === figureId
                ? {
                    ...figure,
                    handle: result.handle,
                    status: 'ready',
                    snapshot: null,
                    folded3d: result.snapshot,
                    renderSnapshot: null,
                    scene,
                    camera,
                    frameRadius: folded3dFrameRadius(result.render),
                    error: null,
                  }
                : figure
            ),
            oristudioCpActiveFoldedFigureId: figureId,
            oristudioCpError: null,
            dirty: true,
            projectMessage: 'Duplicated folded model',
          });
          refreshFoldedFigureSelectionMarkers(previousActiveId);
          return true;
        }
        const result = await duplicateRuntimeOristudioCpFoldedFigure(source.handle);
        const renderSnapshot = await landing.picture(
          result.handle,
          source.displayStyle,
          figureIndex,
          true
        );
        // A copy of the original's session, so it has searched as far.
        adoptFoldedFigureHandle(result.handle, { copyFrom: source.handle });
        takeCanvasSelection('folded-figure', {
          oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((figure) =>
            figure.id === figureId
              ? {
                  ...figure,
                  handle: result.handle,
                  status: 'ready',
                  snapshot: result.snapshot,
                  renderSnapshot,
                  error: null,
                }
              : figure
          ),
          oristudioCpActiveFoldedFigureId: figureId,
          oristudioCpError: null,
          dirty: true,
          projectMessage: 'Duplicated folded model',
        });
        refreshFoldedFigureSelectionMarkers(previousActiveId);
        return true;
      } catch (error) {
        if (error instanceof FoldMovedOn) return await foldLandedOnNothing(error);
        const normalized = engineError(error);
        set({
          oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((figure) =>
            figure.id === figureId
              ? { ...figure, status: 'error', error: normalized.message }
              : figure
          ),
          oristudioCpError: normalized.message,
          error: normalized,
        });
        return false;
      } finally {
        placeholderAtRest();
      }
    },

    prepareOristudioCpFigureLayerOrder: async (id) => {
      const oristudioCpDocument = get().oristudioCpDocument;
      const figure = get().oristudioCpFoldedFigures.find((candidate) => candidate.id === id);
      const blocked = { status: 'unavailable', reason: 'blocked' } as const;
      if (!oristudioCpDocument || !figure) return blocked;
      // A 3D figure whose creases fold flat again, its record flagged by a refold
      // on them: a stale figure on flat creases, with its model on its 3D snapshot.
      const awaitsFlat = foldedFigureAwaitsFlatRefold(figure);
      if (!figure.snapshot && !awaitsFlat) return blocked;
      if (foldedFigureLayerOrderBlock(figure) !== null) return blocked;
      if (pendingLayerOrderOpens.has(id)) return blocked;
      const stale = awaitsFlat || isFoldedFigureStale(oristudioCpDocument.document, figure);
      const model = foldedFigureModel(figure) ?? DEFAULT_FOLDED_MODEL;
      const record = foldedFigureLayerOrderRecord(figure);
      const target = foldedFigureCurrentCase(figure);
      const nothingToRelease = async () => {};
      const ready = (
        source: OristudioCpFoldSource,
        shown: OristudioCpFoldedPaperScene | null,
        release: () => Promise<void> = nothingToRelease
      ) => ({ status: 'ready', source, shown, model, release }) as const;

      pendingLayerOrderOpens.add(id);
      try {
        // Creases changed since the fold (D12): the dialog opens on them as they are now.
        if (stale) return await openOnCurrentCreases();
        const snapshot = figure.snapshot;
        if (!snapshot) return blocked;
        if (figure.handle !== null) {
          const handle = figure.handle;
          try {
            // An undo after Another solution puts back the entry, not the
            // kernel's case: the handle may show a later order than the
            // figure. The dialog opens on what the figure shows.
            const kernel = await getOristudioCpFoldedFigureSnapshot(handle);
            const source = await getOristudioCpFoldedFigureSource(handle);
            if (sameFoldedOrder(kernel, snapshot)) {
              return ready(source, await getOristudioCpFoldedFigurePaperScene(handle));
            }
            // A chosen order the handle no longer shows: the dialog restores
            // the record itself.
            if (record) return ready(source, null);
            const own = await withFoldInFlight('layer-order', (runId) =>
              ownLayerOrderFold(source, model, target, runId)
            );
            return own ? await readyOn(own, source) : ready(source, null);
          } catch (error) {
            if (isFoldCancellation(error)) return { status: 'unavailable', reason: 'cancelled' };
            const normalized = engineError(error);
            set({ oristudioCpError: normalized.message, error: normalized });
            return { status: 'unavailable', reason: 'failed' };
          }
        }
        return await reopenForLayerOrder();
      } finally {
        pendingLayerOrderOpens.delete(id);
      }

      /**
       * The dialog's opening on a fold made for it alone, `own` (the count
       * holds it): its picture is what the dialog opens on, and the opening's
       * release lets it go — not across a document replaced while the dialog
       * was open, whose next fold may have its slot.
       */
      async function readyOn(own: { handle: number; release: () => void }, source: OristudioCpFoldSource) {
        try {
          const shown = await getOristudioCpFoldedFigurePaperScene(own.handle);
          return ready(source, shown, async () => own.release());
        } catch {
          own.release();
          return ready(source, null);
        }
      }

      /**
       * A figure whose creases changed since it was folded (D12): the dialog
       * opens on them as they are now (`fold_source_of_selection`), so it
       * analyses what a refold would fold, and its Apply also refolds the
       * figure (`refold`). Its record, if any, the dialog restores itself;
       * with none, it opens on the order a plain Refold would draw — the
       * first of Oriedita's search, on a fold of its own that the opening's
       * release lets go — so an untouched Apply is that Refold. The figure is
       * left as it is until Apply. Creases that fold in 3D now can't open it.
       */
      async function openOnCurrentCreases(): Promise<OristudioCpFigureLayerOrderOpening> {
        if (!oristudioCpDocument || !figure || figure.sourceBounds == null) return blocked;
        const document = oristudioCpDocument.document;
        const lineIds = reselectFoldableLineIds(document, figure.sourceBounds);
        const route = resolveFoldRoute(document, lineIds);
        if (route.kind === 'spatial') return { status: 'unavailable', reason: 'spatial' };
        if (route.kind !== 'flat') {
          const message = 'The creases this folded model came from are gone';
          set({ oristudioCpError: message, error: { code: 'invalid_operation', message } });
          return { status: 'unavailable', reason: 'failed' };
        }
        const { sourceFingerprint } = foldedSourceProvenance(
          document,
          route.lineIds,
          reselectSourceLineIds(document, figure.sourceBounds)
        );
        try {
          const refold = { sourceFingerprint: sourceFingerprint ?? null };
          const source = await getOristudioCpSelectionFoldSource(route.lineIds, figure.startingFaceId ?? 1);
          if (record) return { ...ready(source, null), refold };
          // No record: the first order of Oriedita's search, which a plain Refold draws.
          const own = await withFoldInFlight('layer-order', (runId) => ownLayerOrderFold(source, model, 1, runId));
          return { ...(own ? await readyOn(own, source) : ready(source, null)), refold };
        } catch (error) {
          if (isFoldCancellation(error)) return { status: 'unavailable', reason: 'cancelled' };
          const normalized = engineError(error);
          set({ oristudioCpError: normalized.message, error: normalized });
          return { status: 'unavailable', reason: 'failed' };
        }
      }

      /**
       * A figure reopened from a file has no live fold. Its source is its
       * creases as they stand (not stale: opened above on them), read without
       * folding (`fold_source_of_selection`), so the dialog can open whatever
       * the refold below does. With a record, the record is restored on
       * them through the host engine (H2) and folded with the order it
       * rebuilds, and the figure keeps that fold if it draws the order it
       * was saved with. With none, the figure is folded to the case it
       * shows on a fold of the dialog's own. When that fails, the dialog
       * opens on the source alone: it restores the record itself and shows
       * why, in its own frames.
       */
      async function reopenForLayerOrder(): Promise<OristudioCpFigureLayerOrderOpening> {
        if (!oristudioCpDocument || !figure || figure.sourceBounds == null) return blocked;
        const lineIds = reselectFoldableLineIds(oristudioCpDocument.document, figure.sourceBounds);
        const route = resolveFoldRoute(oristudioCpDocument.document, lineIds);
        if (route.kind !== 'flat') return blocked;
        const epoch = foldedFigureHandleEpoch();
        // The press waits, and the figure's verbs with it; an undo entry taken
        // meanwhile reads the figure as it was before the press.
        const atRest = holdFoldedFigureAtRest(figure);
        set({
          oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
            candidate.id === id ? { ...candidate, status: 'loading' } : candidate
          ),
        });
        const putBack = () => {
          if (foldedFigureHandleEpoch() === epoch) restorePreviousFigureQuietly(figure);
        };
        let source: OristudioCpFoldSource | null = null;
        try {
          const kernelSource = await getOristudioCpSelectionFoldSource(route.lineIds, figure.startingFaceId ?? 1);
          source = kernelSource;
          const folded = await withFoldInFlight('layer-order', async (runId, stop) => {
            if (!record) return { kind: 'own', own: await ownLayerOrderFold(kernelSource, model, target, runId) } as const;
            const resolution = await resolveLayerOrder(
              layerOrderSourceOf(kernelSource, model),
              layerOrderRecordToSource(record, EDIT_PAPER_FRAME),
              undefined,
              { signal: stop }
            );
            if (resolution.outcome === 'cancelled') return { kind: 'cancelled' } as const;
            // An engine that never loaded: the dialog's would not either.
            if (resolution.outcome === 'lost' && resolution.cause === 'unavailable') {
              return { kind: 'unavailable' } as const;
            }
            // Only the order it was saved with, whole: anything else would change its picture.
            if (
              resolution.outcome !== 'applied' ||
              resolution.found.opened_on.kind !== 'held' ||
              resolution.found.opened_on.ignored !== 0
            ) {
              return { kind: 'source' } as const;
            }
            const result = await foldOristudioCpWithOrder(kernelSource, resolution.applied.relations, model, runId);
            if (result.status !== 'folded') return { kind: 'source' } as const;
            // The count holds it from here; every way out lets go through it.
            const release = adoptTransientFoldedFigureHandle(result.handle);
            if (result.snapshot.outcome !== 'Solved') {
              release();
              return { kind: 'source' } as const;
            }
            return { kind: 'adopt', handle: result.handle, snapshot: result.snapshot, release } as const;
          });

          switch (folded.kind) {
            case 'cancelled':
              putBack();
              return { status: 'unavailable', reason: 'cancelled' };
            case 'unavailable':
              putBack();
              return { status: 'unavailable', reason: 'unavailable' };
            case 'own':
              putBack();
              return folded.own === null ? ready(kernelSource, null) : await readyOn(folded.own, kernelSource);
            case 'source':
              putBack();
              track(ANALYTICS_EVENTS.foldedFigureRehydrated, { trigger: 'press', outcome: 'refused', mode: 'flat' });
              return ready(kernelSource, null);
            case 'adopt': {
              // Read before it is the figure's, so a failure leaves nothing adopted.
              let shown: OristudioCpFoldedPaperScene | null;
              try {
                shown = await getOristudioCpFoldedFigurePaperScene(folded.handle);
              } catch {
                folded.release();
                putBack();
                track(ANALYTICS_EVENTS.foldedFigureRehydrated, { trigger: 'press', outcome: 'refused', mode: 'flat' });
                return ready(kernelSource, null);
              }
              // Torn down, deleted, undone or given a fold by another path while this folded.
              if (
                foldedFigureHandleEpoch() !== epoch ||
                !figuresAwaitFold(get().oristudioCpFoldedFigures, id, null)
              ) {
                folded.release();
                return { status: 'unavailable', reason: 'cancelled' };
              }
              // The same picture, now live, as a rehydrate makes it: nothing about
              // the document changed, so no entry, no `dirty`, no selection.
              set({
                oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
                  candidate.id === id
                    ? { ...figure, handle: folded.handle, status: 'ready', snapshot: folded.snapshot, error: null }
                    : candidate
                ),
              });
              track(ANALYTICS_EVENTS.foldedFigureRehydrated, { trigger: 'press', outcome: 'adopted', mode: 'flat' });
              return ready(kernelSource, shown);
            }
          }
        } catch (error) {
          putBack();
          if (isFoldCancellation(error)) return { status: 'unavailable', reason: 'cancelled' };
          if (source) return ready(source, null);
          const normalized = engineError(error);
          set({ oristudioCpError: normalized.message, error: normalized });
          return { status: 'unavailable', reason: 'failed' };
        } finally {
          atRest();
        }
      }
    },

    applyOristudioCpFigureLayerOrder: async (id, applied, press, options) => {
      // Since the press, a crease edited or another document opened: figure
      // `id` may be another document's, and its creases not the dialog's.
      if (foldPressMoved(press, get())) return refuseMovedPress();
      const figure = get().oristudioCpFoldedFigures.find((candidate) => candidate.id === id);
      const refold = options?.refold;
      // A flat figure; or, refolding, a 3D one whose creases fold flat again (its model on its 3D snapshot).
      const flat = (figure?.folded3d ?? null) === null;
      const model = figure ? foldedFigureModel(figure) : null;
      if (!figure || !model || figure.status !== 'ready' || (flat ? !figure.snapshot : !refold)) {
        const message = 'No folded model is ready';
        set({ oristudioCpError: message, error: { code: 'invalid_operation', message } });
        return false;
      }
      const held = foldedFigureLayerOrder(layerOrderRecordFromSource(applied.record, EDIT_PAPER_FRAME));
      if (!held.ok) {
        const message = i18n.t(
          'errors:cp.layerOrderTooLarge',
          'This layer order is too large to save with the figure, so it is unchanged.'
        );
        set({ oristudioCpError: message, error: { code: 'invalid_operation', message } });
        return false;
      }
      // An Apply that changed nothing writes nothing (D16): the order the
      // figure shows was given, and this is the record it was given with. One
      // that refolds a figure whose creases changed always changes its picture.
      if (
        !refold &&
        figure.handle !== null &&
        figure.snapshot?.shown_order === 'given' &&
        figure.layerOrder?.kind === 'record' &&
        held.layerOrder.kind === 'record' &&
        figure.layerOrder.json === held.layerOrder.json
      ) {
        return false;
      }
      const notApplied = () =>
        i18n.t('errors:cp.layerOrderNotApplied', 'Layer order couldn’t apply this order to {{name}}. Its picture is unchanged.', {
          name: figure.title,
        });

      // It lands only on the figure as this marks it, still holding its fold:
      // not after an undo, a Delete or a new document took it (`foldLanding.ts`).
      const landing = foldLanding(figure.id, figure.handle);
      // An entry taken while it folds reads the figure as it was before the press.
      const atRest = holdFoldedFigureAtRest(figure);
      set({
        oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
          candidate.id === figure.id ? { ...candidate, status: 'loading' } : candidate
        ),
        oristudioCpError: null,
      });

      try {
        // Exactly the segments the dialog analysed, never lines reselected from
        // the document, whose order can renumber faces (approach 4).
        const result = await withFoldInFlight('layer-order', (runId) =>
          foldOristudioCpWithOrder(kernelFoldSourceOf(applied.source), applied.relations, model, runId)
        );
        if (result.status === 'refused') return restorePreviousFigure(figure, notApplied());
        // A record a reload detached, shown for review, is taken up by this Apply: the save drops its entry.
        const detached = foldedFigureDetachedLayerOrder(figure) ? figure.detachedLayerOrder : null;
        const landed = await landChosenOrderFold(figure, result, applied.source.digest, held.layerOrder, landing, {
          projectMessage: refold ? 'Refolded model' : 'Set layer order',
          also: () => ({
            ...(detached ? { detachedLayerOrder: { ...detached, settled: 'reattached' as const } } : {}),
            // Its refold, as Refold leaves a figure: flat, of the current creases,
            // a 3D one whose creases fold flat again included.
            ...(refold ? { folded3d: null, camera: null, sourceKind: 'generated-from-current-cp' as const } : {}),
            ...((refold ? refoldedProvenance(figure, refold) : null) ?? {}),
          }),
        });
        return landed || restorePreviousFigure(figure, notApplied());
      } catch (error) {
        // Its figure moved on while it folded: the new fold is gone, and there is nothing to put back.
        if (error instanceof FoldMovedOn) return false;
        if (isFoldCancellation(error)) return restorePreviousFigureQuietly(figure);
        return restorePreviousFigure(figure, engineError(error).message);
      } finally {
        atRest();
      }
    },

    stepOristudioCpFigureLayerOrder: async (id, direction, options = {}) => {
      const document = get().oristudioCpDocument?.document ?? null;
      const figure = get().oristudioCpFoldedFigures.find((candidate) => candidate.id === id);
      const record = figure ? foldedFigureLayerOrderRecord(figure) : null;
      const source =
        figure?.snapshot &&
        record &&
        document &&
        foldedFigureLayerOrderBlock(figure) === null &&
        !foldedFigureSolutionsHeldForReview(figure) &&
        !isFoldedFigureStale(document, figure)
          ? constrainedStepSource(figure, document)
          : null;
      if (!figure?.snapshot || !record || !source) {
        const message = 'No folded model is ready';
        set({ oristudioCpError: message, error: { code: 'invalid_operation', message } });
        return { status: 'blocked' };
      }
      const model = figure.snapshot.model;
      const notDrawn = (message: string): OristudioCpFigureSolutionStep => {
        restorePreviousFigure(figure, message);
        return { status: 'not-drawn' };
      };

      // The cursor in step with the figure, or a fresh one the step makes (`foldedSolutionCursor.ts`).
      const turn = beginFoldedSolutionStep(figure, document);
      const landing = foldLanding(figure.id, figure.handle);
      // An entry taken while it steps reads the figure as it was before the press.
      const atRest = holdFoldedFigureAtRest(figure);
      set({
        oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
          candidate.id === figure.id ? { ...candidate, status: 'loading' } : candidate
        ),
        oristudioCpError: null,
      });
      try {
        // One run for both halves, so one Stop ends whichever is running. The
        // engine's half can always be stopped, since stopping it terminates its
        // worker; the kernel's fold only where its cancel transport reaches.
        const stepped = await withFoldInFlight(
          'another',
          async (runId, stop, controls) => {
            const answer = await turn.step({
              direction,
              source: async () => layerOrderSourceOf(await source(), model),
              record: layerOrderRecordToSource(record, EDIT_PAPER_FRAME),
              signal: stop,
              tries: options.tries ?? 0,
            });
            if (answer.outcome !== 'moved') return { answer, folded: null } as const;
            controls.stoppable(foldCancellationAvailable());
            // Exactly the segments the cursor analysed, as an Apply folds them.
            const folded = await foldOristudioCpWithOrder(
              kernelFoldSourceOf(answer.applied.source),
              answer.applied.relations,
              model,
              runId
            );
            return { answer, folded } as const;
          },
          { stoppable: true }
        );
        const { answer, folded } = stepped;
        if (answer.outcome !== 'moved' || !folded) {
          // Undone, redone or deleted while it ran: nothing to say about a figure that has moved on.
          if (!landing.holds()) return { status: 'stopped' };
          // Nothing moved: the figure is as it was, and the press says why.
          restorePreviousFigureQuietly(figure);
          // As every host's press says it (`solutionCursorTable.ts`): an end is proved (E9), and Keep
          // trying after a timeout goes on from what it proved.
          return answer.outcome === 'moved' ? { status: 'stopped' } : solutionPressOf(answer);
        }
        const notApplied = i18n.t(
          'errors:cp.layerOrderNotApplied',
          'Layer order couldn’t apply this order to {{name}}. Its picture is unchanged.',
          { name: figure.title }
        );
        if (folded.status === 'refused') return notDrawn(notApplied);
        const held = foldedFigureLayerOrder(layerOrderRecordFromSource(answer.applied.record, EDIT_PAPER_FRAME));
        if (!held.ok || held.layerOrder.kind !== 'record') {
          // Past what a figure can save: the press says so, as for the engine's own refusal.
          await freeOristudioCpFoldedFigure(folded.handle).catch(() => {});
          restorePreviousFigureQuietly(figure);
          return { status: 'too-large' };
        }
        const { json } = held.layerOrder;
        const landed = await landChosenOrderFold(figure, folded, answer.applied.source.digest, held.layerOrder, landing, {
          projectMessage: 'Advanced folded model',
          onLanding: (handle) => turn.landed(handle, json),
        });
        if (!landed) return notDrawn(notApplied);
        track(ANALYTICS_EVENTS.foldSolutionCycled, {
          direction,
          solution_count_bucket: bucketCount(answer.position.total.n, COUNT_BUCKETS),
          constrained: true,
        });
        return { status: 'moved' };
      } catch (error) {
        // Undone or deleted while it ran: its fold is gone, and there is nothing to put back.
        if (error instanceof FoldMovedOn) return { status: 'stopped' };
        if (isFoldCancellation(error)) {
          restorePreviousFigureQuietly(figure);
          return { status: 'stopped' };
        }
        return notDrawn(engineError(error).message);
      } finally {
        atRest();
        turn.end(
          get().oristudioCpFoldedFigures,
          get().oristudioCpDocument?.document ?? null,
          get().oristudioCpActiveFoldedFigureId
        );
      }
    },

    dismissOristudioCpFigureDetachedLayerOrder: (id) => {
      const figure = get().oristudioCpFoldedFigures.find((candidate) => candidate.id === id);
      const shown = figure ? foldedFigureDetachedLayerOrder(figure) : null;
      const detached = figure?.detachedLayerOrder;
      if (!figure || !shown || !detached) return false;
      set({
        oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
          candidate.id === figure.id
            ? { ...candidate, detachedLayerOrder: { ...detached, settled: 'dismissed' as const } }
            : candidate
        ),
        dirty: true,
      });
      trackLayerConstraintsDismissed(dismissedFact('edit_figure', shown.constraints.length).properties);
      return true;
    },

    prepareOristudioCpLayerOrderFold: async (scopedLineIds) => {
      const oristudioCpDocument = get().oristudioCpDocument;
      // A refusal with a message is said as Fold says its own, an error; the
      // expected ones (`spatial`, `moved`, `undetermined`) write nothing here,
      // and the press says them as a message (`layerOrderPressToasts.ts`).
      const refuse = (
        reason: Extract<OristudioCpSelectionLayerOrderOpening, { status: 'unavailable' }>['reason'],
        message?: string
      ): OristudioCpSelectionLayerOrderOpening => {
        if (message) set({ oristudioCpError: message, error: { code: 'invalid_operation', message } });
        return { status: 'unavailable', reason };
      };
      if (!oristudioCpDocument) return refuse('blocked', 'No editable crease-pattern document is loaded');
      // What the press found open, checked again before the dialog opens and before Apply writes.
      const press = markFoldPress(get());
      // The same routing a fold makes, on the same scoped ids.
      const route = resolveFoldRoute(oristudioCpDocument.document, scopedLineIds);
      if (route.kind === 'none') return refuse('blocked', 'Select one or more foldable crease-pattern lines first');
      // A layer order is a flat fold's (D2); the selection toolbar says so before a press.
      if (route.kind === 'spatial') return refuse('spatial');
      // One press at a time, from the press until its dialog has closed and its Apply folded.
      if (selectionLayerOrderPending) return refuse('busy');
      selectionLayerOrderPending = true;
      let handedOver = false;
      try {
        // Asked here, once, as Fold asks it: Apply's fold does not ask again.
        if (!(await confirmFoldDespiteCheck(false))) return refuse('declined');
        const model = newFoldedFigureModel(oristudioCpDocument.document);
        // The figure Apply makes, as the creases stand now: it lands with these, not with what is open by then.
        const figure: OristudioCpPressedFigure = {
          sourceCpRevision: press.revision,
          provenance: foldedSourceProvenance(oristudioCpDocument.document, route.lineIds, scopedLineIds),
          appearance: legacyPaperStyleOverrides(model),
        };
        const { source, folded } = await withFoldInFlight('layer-order', async (runId) => {
          // From face 1, as every fold is (`foldCreases`).
          const source = await getOristudioCpSelectionFoldSource(route.lineIds, 1);
          // No order given: Oriedita's own search, as Fold runs it on these creases.
          return { source, folded: await foldOristudioCpWithOrder(source, new Uint32Array(), model, runId) };
        });
        // The count holds it from here, and every way out lets go through it:
        // no figure ever holds this fold.
        const release = folded.status === 'folded' ? adoptTransientFoldedFigureHandle(folded.handle) : () => {};
        // A crease edited, or another document opened, while it folded: the
        // dialog would open on creases that are no longer there.
        const moved = () => {
          if (!foldPressMoved(press, get())) return null;
          release();
          return refuse('moved');
        };
        const movedWhileFolding = moved();
        if (movedWhileFolding) return movedWhileFolding;
        // As "Layer order…" is held on a figure Oriedita's search did not order
        // (D3): Apply could not draw the order chosen on these faces. With no
        // order given, the kernel refuses where that search finds none
        // (`in_closure`, `not_found`, out of `budget`): the same creases a
        // plain Fold draws see-through, so the same D3 refusal, never "no flat
        // folded form", which Fold says only of creases it cannot draw at all.
        const undetermined = () => refuse('undetermined');
        if (folded.status !== 'folded') return undetermined();
        const { snapshot } = folded;
        if (
          !hasFoldedLayerOrder({
            discoveredCases: snapshot.discovered_fold_cases,
            displayStyle: snapshot.display_style,
            outcome: snapshot.outcome,
          })
        ) {
          release();
          return undetermined();
        }
        let shown: OristudioCpFoldedPaperScene | null = null;
        try {
          shown = await getOristudioCpFoldedFigurePaperScene(folded.handle);
        } catch {
          // The dialog opens on its solver's first order instead.
        }
        const movedWhileReading = moved();
        if (movedWhileReading) return movedWhileReading;
        // The press is the opening's from here: its release ends it.
        handedOver = true;
        return {
          status: 'ready',
          source,
          shown,
          model: snapshot.model,
          lineIds: [...scopedLineIds],
          press,
          figure,
          release: async () => {
            release();
            selectionLayerOrderPending = false;
          },
        };
      } catch (error) {
        if (isFoldCancellation(error)) return refuse('cancelled');
        // A fold of creases that changed under it: that, not the kernel's words, is why.
        if (foldPressMoved(press, get())) return refuse('moved');
        const normalized = engineError(error);
        set({ oristudioCpError: normalized.message, error: normalized });
        return { status: 'unavailable', reason: 'failed' };
      } finally {
        if (!handedOver) selectionLayerOrderPending = false;
      }
    },

    deleteOristudioCpFoldedFigure: async (id) => {
      const figures = get().oristudioCpFoldedFigures;
      const figure = figures.find((candidate) => candidate.id === id);
      if (!figure) return;

      // Drop the live list's reference. The handle is only actually freed if no
      // history entry still holds it — otherwise undoing this delete would
      // restore a figure that draws but can no longer be recoloured or refolded.
      releaseFoldedFigureHandle(figure.handle);
      const remaining = get().oristudioCpFoldedFigures.filter((candidate) => candidate.id !== id);
      // Deleting the selected figure selects nothing, like deleting any other
      // canvas object. It used to advance to the next figure, which put the
      // selection — and everything that follows it — on a figure nobody clicked.
      // Focus is narrower than selection and cannot outlive the figure either.
      const wasActive = get().oristudioCpActiveFoldedFigureId === id;
      const wasFocused = get().oristudioCpFocusedFoldedFigureId === id;
      set({
        oristudioCpFoldedFigures: remaining,
        ...(wasActive ? { oristudioCpActiveFoldedFigureId: null } : {}),
        ...(wasFocused ? { oristudioCpFocusedFoldedFigureId: null } : {}),
        dirty: true,
      });
    },

    clearOristudioCpFoldedFigures: async () => {
      // Closing/replacing the document takes every figure with it, history
      // included, so free outright rather than unwinding reference counts.
      // `resetFoldedFigureHandles` frees everything it was tracking, which is a
      // superset of the live list: a figure deleted earlier in the session is
      // held only by an undo entry, and collecting handles from the live list
      // alone is exactly how those used to be left behind.
      await resetFoldedFigureHandles();
      set({
        oristudioCpFoldedFigures: [],
        oristudioCpActiveFoldedFigureId: null,
      });
    },

    clearOristudioCpSelection: () => {
      // Clear the frontend mirror immediately (the surface deselects at once),
      // then the kernel's own flags. Deliberately not routed through
      // `takeCanvasSelection`: this releases the creases and nothing else, so a
      // reference image or folded figure keeps its selection.
      set({ oristudioCpSelection: emptyOristudioCpSelection() });
      deselectCreasesInKernel();
    },

    transformOristudioCpSelection: async (transform) => {
      const document = get().oristudioCpDocument?.document;
      const selection = get().oristudioCpSelection;
      const selectedLines = selectedCpLineSegments(document, selection);
      if (selection.lines.length === 0 || selectedLines.length === 0) {
        set({
          error: {
            code: 'invalid_operation',
            message: 'Select one or more crease-pattern lines first',
          },
        });
        return false;
      }
      const transformed = transformCpLineSegments(selectedLines, transform);
      if (transformed.length === 0) return false;
      return get().replaceOristudioCpLineSegments(
        selection.lines,
        transformed,
        cpSelectionTransformLabel(transform)
      );
    },

    // Each toggle routes through `applyCreaseSelection`, so clicking a crease
    // takes the canvas from whatever object held it — a focused simulation
    // window included.
    toggleOristudioCpLineSelection: (id, additive = false) =>
      applyCreaseSelection(
        additive
          ? {
              ...get().oristudioCpSelection,
              lines: toggleCpSelectionList(get().oristudioCpSelection.lines, id),
            }
          : { ...emptyOristudioCpSelection(), lines: [id] }
      ),

    // Box / Lasso Deselect's click. Not a toggle: a click on a crease that is not
    // selected leaves the selection alone, where a toggle would add it.
    unselectOristudioCpLine: (id) =>
      applyCreaseSelection({
        ...get().oristudioCpSelection,
        lines: get().oristudioCpSelection.lines.filter((lineId) => lineId !== id),
      }),

    toggleOristudioCpPointSelection: (id, additive = false) =>
      applyCreaseSelection(
        additive
          ? {
              ...get().oristudioCpSelection,
              points: toggleCpSelectionList(get().oristudioCpSelection.points, id),
            }
          : { ...emptyOristudioCpSelection(), points: [id] }
      ),

    toggleOristudioCpCircleSelection: (id, additive = false) =>
      applyCreaseSelection(
        additive
          ? {
              ...get().oristudioCpSelection,
              circles: toggleCpSelectionList(get().oristudioCpSelection.circles, id),
            }
          : { ...emptyOristudioCpSelection(), circles: [id] }
      ),

    toggleOristudioCpTextSelection: (id, additive = false) =>
      applyCreaseSelection(
        additive
          ? {
              ...get().oristudioCpSelection,
              texts: toggleCpSelectionList(get().oristudioCpSelection.texts, id),
            }
          : { ...emptyOristudioCpSelection(), texts: [id] }
      ),

    // --- Annotations: images + text boxes (superset feature; see
    // docs/superset-features.md). Web-side layer only; a fresh document resets
    // the layer via the load/create paths.
    addAnnotation: (annotation) =>
      takeCanvasSelection('annotation', {
        oristudioCpAnnotations: [...get().oristudioCpAnnotations, annotation],
        oristudioCpSelectedAnnotationId: annotation.id,
        dirty: true,
      }),

    updateAnnotation: (id, patch) =>
      set({
        oristudioCpAnnotations: get().oristudioCpAnnotations.map((annotation) =>
          annotation.id === id
            ? // Filtered per kind: `AnnotationUpdate` is a union, so `hidden`
              // typechecks against the image member no matter which annotation
              // the id resolves to, and a hidden suppression region is the one
              // state this design must not allow. See `allowedAnnotationUpdate`.
              ({ ...annotation, ...allowedAnnotationUpdate(annotation, patch) } as typeof annotation)
            : annotation
        ),
        dirty: true,
      }),

    removeAnnotation: (id) =>
      set({
        oristudioCpAnnotations: get().oristudioCpAnnotations.filter(
          (annotation) => annotation.id !== id
        ),
        oristudioCpSelectedAnnotationId:
          get().oristudioCpSelectedAnnotationId === id
            ? null
            : get().oristudioCpSelectedAnnotationId,
        dirty: true,
      }),

    setSelectedAnnotation: (id) => {
      const resolved =
        id !== null && get().oristudioCpAnnotations.some((annotation) => annotation.id === id)
          ? id
          : null;
      // Only *taking* the selection is an invariant-bearing move; see
      // `releaseCanvasSelection` for why releasing leaves the rest alone.
      if (resolved === null) {
        releaseCanvasSelection('annotation');
        return;
      }
      takeCanvasSelection('annotation', { oristudioCpSelectedAnnotationId: resolved });
    },

    syncAnnotationHeight: (id, height) =>
      set({
        oristudioCpAnnotations: get().oristudioCpAnnotations.map((annotation) => {
          if (annotation.id !== id || annotation.kind !== 'text') return annotation;
          // Keep the top edge fixed so the box grows *downward* with content
          // rather than symmetrically about its center: shift the center by half
          // the height delta along the box's local +y (down) axis. Purely in
          // model space, so the top-center is invariant regardless of camera.
          const delta = height - annotation.height;
          const sin = Math.sin(annotation.rotation);
          const cos = Math.cos(annotation.rotation);
          return {
            ...annotation,
            height,
            center: {
              x: annotation.center.x + (delta / 2) * -sin,
              y: annotation.center.y + (delta / 2) * cos,
            },
          };
        }),
      }),

    setAnnotations: (annotations) =>
      set({
        oristudioCpAnnotations: annotations,
        oristudioCpSelectedAnnotationId:
          get().oristudioCpSelectedAnnotationId !== null &&
          annotations.some((annotation) => annotation.id === get().oristudioCpSelectedAnnotationId)
            ? get().oristudioCpSelectedAnnotationId
            : null,
      }),

    recordAnnotationHistory: (previous, label) =>
      pushOverlayHistoryEntry({
        annotations: previous,
        foldedFigures: get().oristudioCpFoldedFigures,
        activeFoldedFigureId: get().oristudioCpActiveFoldedFigureId,
        label,
      }),

    /**
     * Bring the kernel back in line with what the store says a figure looks
     * like. Fire-and-forget by design: the caller's state transition stays
     * synchronous, so holding undo never blocks on a wasm round-trip and never
     * trips the `historyBusy` guard.
     */
    reconcileFoldedFigureModels: (ids) => {
      for (const id of new Set(ids)) {
        void enqueueModelWrite(id, () => reconcileFoldedFigureModel(id));
      }
    },

    recordFoldedFigureHistory: (previous, label, previousActiveId) =>
      pushOverlayHistoryEntry({
        annotations: get().oristudioCpAnnotations,
        foldedFigures: previous,
        activeFoldedFigureId:
          previousActiveId === undefined ? get().oristudioCpActiveFoldedFigureId : previousActiveId,
        label,
      }),

    recordInlineSimulationHistory: (previous, label) =>
      pushOverlayHistoryEntry({
        annotations: get().oristudioCpAnnotations,
        foldedFigures: get().oristudioCpFoldedFigures,
        activeFoldedFigureId: get().oristudioCpActiveFoldedFigureId,
        inlineSimulations: previous,
        label,
      }),
  };
};
