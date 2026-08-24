import { patchTreemakerDesign, selectDesignViewportFitRequestId, selectProject } from '../designTabs';
import {
  ANALYTICS_EVENTS,
  bucketCount,
  COUNT_BUCKETS,
  FOLD_DURATION_MS_BUCKETS,
  track,
  trackDesignSentToEdit,
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
import {
  buildSegmentSimulationFold,
  resolveCpSegments,
} from '../../../lib/creasePatternSegmentation';
import { segmentContainedLineIds } from '../../../lib/creasePatternSelectionSegment';
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
import { DEFAULT_SIMULATOR_VIEW } from '../../../simulator/SimulatorViewport';
import {
  aabbInFrame,
  boxAabbInFrame,
} from '../../../cp-workspace/canvasObjects/placeBesideCp';
import { uprightRotationForView } from '../../../cp-workspace/annotations/annotationTransform';
import { cpOverlayViewStore } from '../../../cp-workspace/cpOverlayViewStore';
import { countCpDiagnosticErrors } from '../../../cp-workspace/diagnostics/severity';
import { visibleCpDiagnosticEntries } from '../../../cp-workspace/diagnostics/visibleEntries';
import { foldedFigureUserAabb } from '../../../cp-workspace/adapters/cpFoldedToScene';
import { cpSelectionSize, cpSvgToModel } from '../../../lib/creasePatternViewport';
import type { Aabb } from '../../../cp-workspace/picking/lineHitIndex';
import { foldArtifactsFromFold } from '../../../lib/creasePatternImport';
import {
  generatedCpLineage,
  markGeneratedCpLineageStale,
  stableTextDigest,
} from '../../../lib/oristudioCpLineage';
import { foldedFigureModelFromOrieditaMetadata } from '../../../lib/orieditaNativeMetadata';
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
import { frameActiveCpDiagnostic } from '../cpDiagnosticFocus';
import { freshEditableCpState } from '../freshCreasePattern';
import {
  emptyFoldArtifactResourceState,
  readyFoldArtifactResourceState,
  staleFoldArtifactResourceState,
} from '../foldArtifactResource';
import {
  engineError,
  ensureTreeHandle,
  getEngine,
  syncTreemakerProject,
  type EngineClient,
} from '../engineRuntime';
import { withDesignHandle } from '../../../engines/designHandles';
import { onEngineLost } from '../../../engines/engineHost';
import { fetchCpShareWithRetry } from '../../../cp-workspace/share/cpShareService';

/**
 * Opening a shared link over an existing document discards it, so ask first — the same
 * question File > Open asks, for the same reason.
 */
async function confirmDiscardDirtyProject(dirty: boolean): Promise<boolean> {
  if (!dirty) return true;
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
 * extra thing to offer. When the refusal names a place the overlay is already
 * reporting on, the user gets a real choice — go and look at it, or simulate —
 * and the message is the fact alone. When it does not, this is the confirm
 * dialog it has always been, word for word.
 *
 * Which shape it takes is `notice.locate`, not the refusal code: a refusal can
 * name a vertex the overlay has nothing to say about (the fold is scoped to a
 * selection; the overlay reports on the document), and offering to show the user
 * a row that does not exist would be worse than the old dialog.
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
  freeOristudioCpFoldedFigure,
  getOristudioCpFoldedFigureRenderSnapshot as getRuntimeOristudioCpFoldedFigureRenderSnapshot,
  isFoldCancellation,
  loadOristudioCpDocumentFromText,
  releaseOristudioCpDocument,
  runOristudioCpCheckCommand,
  setOristudioCpFoldedFigureModel as setRuntimeOristudioCpFoldedFigureModel,
} from '../oristudioCpRuntime';
import {
  beginFoldRun,
  cancelFoldRun,
  foldCancellationAvailable,
  FOLD_RUN_NONE,
} from '../../../lib/foldCancellation';
import type {
  CreasePatternSlice,
  OristudioCpFoldRun,
  OristudioCpFoldRunKind,
  WorkspaceSliceCreator,
  WorkspaceState,
} from '../types';
import type { CanvasAnnotation } from '../../../cp-workspace/annotations/annotation';
import {
  foldedFigureHandleEpoch,
  releaseFoldedFigureHandle,
  releaseFoldedFigureHandles,
  resetFoldedFigureHandles,
  retainFoldedFigureHandle,
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
} from '../../../engine/oristudioCpTypes';
import {
  foldedFigureCycling,
  foldedModelsEqual,
} from '../../../cp-workspace/folded/foldedFigureState';
import { resolveFoldRoute } from '../../../cp-workspace/folded/foldRoute';
import {
  fold3dRefusalMessage,
  fold3dRefusalNotice,
  type Fold3dRefusalNotice,
} from '../../../cp-workspace/folded/foldedFigureNotice';
import {
  defaultFolded3dCamera,
  folded3dFrameRadius,
} from '../../../cp-workspace/folded/foldedFigure3dProjection';
import { setFolded3dRenderModel } from '../../../cp-workspace/folded/folded3dRenderModels';
import {
  project3dRenderSnapshot,
  reproject3dFigure,
  reproject3dFigureAt,
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

/** Cap on the CP undo stack (matches historySlice's MAX_HISTORY). */
const MAX_CP_HISTORY = 100;

// Dedupe concurrent `ensureEditCreasePattern` calls (e.g. React StrictMode
// double-invoking the seeding effect) so only one blank document is created.
let ensureEditInFlight: Promise<void> | null = null;

/**
 * How many times a window's fold has been rebuilt, so each rebuild gets a fresh
 * model key and the worker's prepared-model cache cannot serve the old mesh.
 */
const inlineSimulationRevisions = new Map<string, number>();

/**
 * What is already on the canvas, in crease-pattern model coordinates, so a new
 * window parks clear of all of it rather than only of its own kind.
 *
 * Folded figures are placed in SVG user space -- the space their render
 * primitives land in -- so their bounds are mapped back through the same affine
 * the flat pattern uses. It is positive and axis-preserving, so an axis-aligned
 * box stays axis-aligned and the corners are enough.
 */
function occupiedModelSpace(state: WorkspaceState, frameAngle = 0): Aabb[] {
  // Measured along the frame's axes, straight from each object's own box, so an
  // object created upright under this view contributes its exact footprint
  // rather than a bounding box inflated by its rotation.
  const boxes = [
    ...state.oristudioCpInlineSimulations.map((simulation) =>
      boxAabbInFrame(simulation.box, frameAngle)
    ),
    ...state.oristudioCpAnnotations
      .filter((annotation) => !annotation.hidden)
      .map((annotation) =>
        boxAabbInFrame(
          {
            center: annotation.center,
            width: annotation.width,
            height: annotation.height,
            rotation: annotation.rotation,
          },
          frameAngle
        )
      ),
  ];
  for (const figure of state.oristudioCpFoldedFigures) {
    const userAabb = foldedFigureUserAabb(figure);
    if (!userAabb) continue;
    const min = cpSvgToModel({ x: userAabb.minX, y: userAabb.minY });
    const max = cpSvgToModel({ x: userAabb.maxX, y: userAabb.maxY });
    boxes.push(
      aabbInFrame(
        {
          minX: Math.min(min.x, max.x),
          minY: Math.min(min.y, max.y),
          maxX: Math.max(min.x, max.x),
          maxY: Math.max(min.y, max.y),
        },
        frameAngle
      )
    );
  }
  return boxes;
}

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

export const createCreasePatternSlice: WorkspaceSliceCreator<CreasePatternSlice> = (
  set,
  get
) => {
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

  const wholeSimulationFocus = { kind: 'whole' as const };
  let foldArtifactPromise: Promise<FoldArtifacts | null> | null = null;
  let foldArtifactPromiseRevision: number | null = null;
  // Newest artifact request. Loader-private rather than store state: a document
  // load resets the whole fold-artifact resource, so a counter kept there would
  // restart at zero and let a request still in flight for the previous document
  // match the id of the request for the new one — and publish its crease pattern
  // as the current document's.
  let foldArtifactRequestId = 0;
  let foldedFigureRequestSequence = 0;
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
  /** Figures with a live model edit in flight; see `reconcileFoldedFigureModel`. */
  const pendingLiveModelWrites = new Set<string>();
  /**
   * Figures with a rehydrate in flight; see
   * `rehydrateOristudioCpFolded3dFigure`. The background queue and a press can
   * both name the same figure, and two folds of one figure would leak whichever
   * handle lost the race.
   */
  const pendingFolded3dRehydrations = new Set<string>();
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
    render: Parameters<typeof setFolded3dRenderModel>[1]
  ): Promise<boolean> {
    const stillThere =
      foldedFigureHandleEpoch() === epoch &&
      get().oristudioCpFoldedFigures.some((candidate) => candidate.id === figureId);
    if (!stillThere) {
      await freeOristudioCpFoldedFigure(handle).catch(() => {});
      return false;
    }
    retainFoldedFigureHandle(handle);
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
    if (pendingLiveModelWrites.has(id)) return;

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
    const document = get().oristudioCpDocument;
    if (!document) return;
    // The new entry keeps its figures' handles alive for as long as undo can
    // reach them; anything the cap or the cleared redo stack drops lets go.
    retainFoldedFigureHandles(input.foldedFigures);
    const grown = [
      ...get().oristudioCpHistoryPast,
      {
        document: document.document,
        selection: get().oristudioCpSelection,
        annotations: input.annotations,
        foldedFigures: input.foldedFigures,
        activeFoldedFigureId: input.activeFoldedFigureId,
        // Captured on every overlay entry, not only the window ones. An
        // annotation edit that omitted them would produce an entry whose undo
        // leaves windows alone — which is right — but the field is also how a
        // *later* undo past that point knows what the windows were, so a hole
        // here would restore the wrong list.
        inlineSimulations: input.inlineSimulations ?? get().oristudioCpInlineSimulations,
        overlayOnly: true,
        label: input.label,
        timestamp: new Date().toISOString(),
      },
    ];
    const evicted = grown.slice(0, Math.max(0, grown.length - MAX_CP_HISTORY));
    for (const entry of evicted) releaseFoldedFigureHandles(entry.foldedFigures ?? []);
    for (const entry of get().oristudioCpHistoryFuture) {
      releaseFoldedFigureHandles(entry.foldedFigures ?? []);
    }
    set({
      oristudioCpHistoryPast: grown.slice(-MAX_CP_HISTORY),
      oristudioCpHistoryFuture: [],
      dirty: true,
    });
  }

  function foldedFigureIndex(id: string): number {
    const index = get().oristudioCpFoldedFigures.findIndex((candidate) => candidate.id === id);
    return Math.max(index + 1, 1);
  }

  /**
   * Give each of `simulations` the fold its solver runs, built from `artifacts`.
   * Returns how many got one.
   *
   * Shared by loading a file and by undoing a delete, which want the same work
   * from different artifacts — see each caller for why its choice differs.
   *
   * Deliberately writes no descriptor state. Recomputing `sourceFingerprint`
   * from the current document is the one change here that would look harmless
   * and disable staleness for good: a window can legitimately be out of date,
   * and both callers can be looking at one.
   */
  function buildInlineSimulationSources(
    simulations: InlineSimulation[],
    artifacts: FoldArtifacts | null | undefined
  ): number {
    if (!artifacts || !get().oristudioCpDocument) return 0;
    const segments = resolveCpSegments(artifacts);

    let built = 0;
    for (const simulation of simulations) {
      const segment = resolveInlineSimulationSegment(simulation, segments);
      // A region that no longer resolves keeps its window and its provenance.
      // Dropping it would lose placement the user chose, and re-pointing it at
      // the nearest region would silently simulate something else — the rule
      // refresh already follows.
      if (!segment) continue;
      setInlineSimulationSource(simulation.id, {
        fold: buildSegmentSimulationFold(artifacts, segment),
        modelKey: `${simulation.id}:${inlineSimulationRevision(simulation.id)}`,
      });
      built += 1;
    }
    return built;
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
    if (!get().oristudioCpDocument) return;
    void (async () => {
      try {
        const refreshed = await deselectAllOristudioCp();
        // Guard against a selection made while the round-trip was in flight:
        // the refreshed document is only safe to adopt if nothing has since
        // taken the canvas selection back for the creases.
        if (refreshed && cpSelectionSize(get().oristudioCpSelection) === 0) {
          set({ oristudioCpDocument: refreshed });
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

  function nextGeneratedFoldedFigureId(): string {
    let figureId = '';
    do {
      figureId = `generated-${++foldedFigureRequestSequence}`;
    } while (get().oristudioCpFoldedFigures.some((figure) => figure.id === figureId));
    return figureId;
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
   * toast. Restoring the crease selection is the other half: the draft entry took
   * the canvas selection when it was inserted, and putting it back leaves the
   * user exactly where they pressed `G`. Upstream drops the selection at dispatch
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

  /** The same restore, for a fold the user stopped. See {@link discardFoldedFigureDraftQuietly}. */
  function restorePreviousFigureQuietly(previous: OristudioCpFoldedFigureEntry): false {
    set({
      oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
        candidate.id === previous.id ? previous : candidate
      ),
    });
    return false;
  }

  /** The run map without `runId`, for the `finally` that ends every fold. */
  function foldRunsWithout(runId: number): Record<number, OristudioCpFoldRun> {
    const remaining: Record<number, OristudioCpFoldRun> = {};
    for (const run of Object.values(get().oristudioCpFoldRuns)) {
      if (run.runId !== runId) remaining[run.runId] = run;
    }
    return remaining;
  }

  /**
   * Live stoppable runs, **oldest first** — which is executing order.
   *
   * One CP worker on web and one engine mutex on desktop, so folds run strictly
   * serially in the order they were dispatched, and run ids are minted at
   * dispatch. `startedAt` leads because it is what "oldest" means; the id breaks
   * its millisecond ties.
   */
  function stoppableFoldRuns(
    runs: Record<number, OristudioCpFoldRun> = get().oristudioCpFoldRuns
  ): OristudioCpFoldRun[] {
    return Object.values(runs)
      .filter((run) => run.cancellable)
      .sort((a, b) => a.startedAt - b.startedAt || a.runId - b.runId);
  }

  /**
   * Point the cancel slot at the oldest run still waiting to be stopped.
   *
   * The transport names **one** run: a single `SharedArrayBuffer` slot on web, a
   * single `AtomicU32` on desktop, matched exactly. So a Stop over several live
   * runs cannot be a loop of writes — the last write would win, and since ids
   * ascend that is the *newest* run while the engine is busy with the oldest.
   * Instead the stop intent is recorded on every run (`stopping`) and the slot is
   * re-aimed here, as each run leaves and the next becomes the one executing.
   * Re-writing an id already in the slot is harmless.
   */
  function aimFoldStopAtOldestPending(runs: Record<number, OristudioCpFoldRun>): void {
    const pending = stoppableFoldRuns(runs).find((run) => run.stopping);
    if (pending) cancelFoldRun(pending.runId);
  }

  /**
   * Record a fold as live for as long as `run` takes, under an id a Stop can
   * name, so the UI can both show progress for a slow one and offer a way out of
   * it. Folding happens in the CP worker, so the main thread stays free to paint
   * that indicator and to write the stop.
   *
   * The id is minted here rather than by the caller: a run is live exactly while
   * it is in the map, and the two must not be able to disagree. The `finally`
   * clears it on **every** exit — including a cancel, which a cooperative stop
   * makes an ordinary rejection rather than a promise that never settles (the
   * stuck-flag failure recorded in `bp-optimizer-cancellation.md`).
   */
  async function withFoldInFlight<T>(
    kind: OristudioCpFoldRunKind,
    run: (runId: number) => Promise<T>
  ): Promise<T> {
    const runId = beginFoldRun();
    set({
      oristudioCpFoldRuns: {
        ...get().oristudioCpFoldRuns,
        [runId]: {
          runId,
          kind,
          startedAt: Date.now(),
          // Asked once, at dispatch, because that is when the binding is made:
          // a run started in a browser that cannot share memory stays
          // un-stoppable for its whole life, however the page changes later.
          cancellable: foldCancellationAvailable(),
          stopping: false,
        },
      },
    });
    try {
      return await run(runId);
    } finally {
      const remaining = foldRunsWithout(runId);
      set({ oristudioCpFoldRuns: remaining });
      aimFoldStopAtOldestPending(remaining);
    }
  }

  function clearFoldArtifactSource() {
    set({
      ...emptyFoldArtifactResourceState(),
      sequenceTarget: null,
      sequencePlan: null,
      sequenceSimulationFocus: wholeSimulationFocus,
      sequencePlanning: false,
      sequenceError: null,
    });
  }

  async function computeFoldArtifacts(): Promise<FoldArtifacts | null> {
    if (get().oristudioCpDocument) {
      // Editable crease patterns build simulation faces in JS (no flat-folding).
      // This supports documents with multiple disconnected crease patterns,
      // which the Rust flat-folder rejects.
      const fold = parseFoldProjection(await exportOristudioCpDocumentAsFold());
      if (!fold) return null;
      return foldArtifactsFromFold(fold);
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
      sequenceTarget: null,
      sequencePlan: null,
      sequenceSimulationFocus: wholeSimulationFocus,
      sequencePlanning: false,
      sequenceError: null,
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
            sequenceTarget: null,
            sequencePlan: null,
            sequenceSimulationFocus: wholeSimulationFocus,
            sequencePlanning: false,
            sequenceError: null,
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
            sequenceTarget: null,
            sequencePlan: null,
            sequenceSimulationFocus: wholeSimulationFocus,
            sequencePlanning: false,
            sequenceError: null,
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

  async function requireFoldForSequence(): Promise<FoldArtifacts | null> {
    const foldArtifacts = get().foldArtifacts ?? (await loadFoldArtifacts(false));
    if (!foldArtifacts) {
      set({
        sequencePlanning: false,
        sequenceError: 'No crease pattern is available for sequence planning.',
      });
      return null;
    }
    return foldArtifacts;
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
    oristudioCpFocusedFoldedFigureId: null,
    ...emptyFoldArtifactResourceState(),
    sequenceTarget: null,
    sequencePlan: null,
    sequenceSimulationFocus: wholeSimulationFocus,
    sequencePlanning: false,
    sequenceError: null,

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
        if (!(await confirmDiscardDirtyProject(get().dirty))) {
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
            sequenceTarget: null,
            sequencePlan: null,
            sequenceSimulationFocus: wholeSimulationFocus,
            sequencePlanning: false,
            sequenceError: null,
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
          sequenceTarget: null,
          sequencePlan: null,
          sequenceSimulationFocus: wholeSimulationFocus,
          sequencePlanning: false,
          sequenceError: null,
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

    analyzeSequenceTarget: async () => {
      set({ sequencePlanning: true, sequenceError: null });
      try {
        const foldArtifacts = await requireFoldForSequence();
        if (!foldArtifacts) return null;
        const sourceRevision = get().foldArtifactResolvedRevision;
        const api = await getEngine();
        const target = await api.sequenceAnalyzeFold(JSON.stringify(foldArtifacts.fold), {
          solution_limit: 10,
        });
        if (get().foldArtifactResolvedRevision !== sourceRevision) return null;
        set({ sequenceTarget: target, sequencePlanning: false, sequenceError: null });
        return target;
      } catch (error) {
        const message = engineError(error).message;
        set({ sequencePlanning: false, sequenceError: message, sequenceTarget: null });
        return null;
      }
    },

    planFoldingSequence: async () => {
      set({ sequencePlanning: true, sequenceError: null });
      try {
        const foldArtifacts = await requireFoldForSequence();
        if (!foldArtifacts) return null;
        const sourceRevision = get().foldArtifactResolvedRevision;
        const api = await getEngine();
        const foldJson = JSON.stringify(foldArtifacts.fold);
        const { target, plan } = await api.sequencePlanFoldWithTarget(foldJson, {
          solution_limit: 10,
          max_steps: 64,
          max_states: 1024,
        });
        if (get().foldArtifactResolvedRevision !== sourceRevision) return null;
        set({
          sequenceTarget: target,
          sequencePlan: plan,
          sequenceSimulationFocus: wholeSimulationFocus,
          sequencePlanning: false,
          sequenceError: null,
        });
        return plan;
      } catch (error) {
        const message = engineError(error).message;
        set({
          sequencePlanning: false,
          sequenceError: message,
          sequencePlan: null,
          sequenceSimulationFocus: wholeSimulationFocus,
        });
        return null;
      }
    },

    setCreaseColorMode: (creaseColorMode) => set({ creaseColorMode }),

    setSelectedSegment: (id) => {
      const segments = resolveCpSegments(get().foldArtifacts);
      if (id !== null && !segments.some((segment) => segment.id === id)) return;
      set({ selectedSegmentId: id });
    },

    simulateOristudioCpSegment: async (segmentId) => {
      // Unlike the toolbar's fast path, the simulator needs the full artifacts
      // (the triangulated simulation mesh). Ensure them *before* setting the scope
      // so entering the panel finds them cached and does not reload — a reload
      // resets selectedSegmentId, which would drop the chosen segment.
      const artifacts = get().foldArtifacts ?? (await get().ensureFoldArtifacts());
      const segments = resolveCpSegments(artifacts);
      if (!segments.some((segment) => segment.id === segmentId)) return false;
      // Then set the scope and switch workspace via the layout store (activatePanel
      // resolves and activates the simulator's owning workspace), mirroring
      // sendTreeCreasePatternToEdit.
      set({ selectedSegmentId: segmentId });
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

      // The simulator needs the triangulated mesh, so the full artifacts, not
      // the segmentation-only fast path the toolbar uses to decide it can offer
      // this at all. The *region* is the caller's — resolving it again here from
      // a second segmentation is what opened the wrong one.
      const artifacts = get().foldArtifacts ?? (await get().ensureFoldArtifacts());
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
        set({ oristudioCpFocusedInlineSimulationId: null });
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

      // Recomputed once for the whole document rather than once per window.
      //
      // The coordinate-space half of this is now handled upstream: a
      // kernel-backed document no longer inherits the importer's unit-square
      // artifacts, so a saved boundary and the artifacts it is matched against
      // are in the same space either way. Refreshing still earns its keep --
      // the file may have been opened over an edited document -- but it must
      // not happen per window.
      return buildInlineSimulationSources(simulations, await get().refreshFoldArtifacts());
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

      // Warm artifacts first, unlike hydrate: deleting a window does not
      // invalidate them, so the common delete-then-undo path recomputes nothing.
      const cached = get().foldArtifacts ?? (await get().ensureFoldArtifacts());
      const built = buildInlineSimulationSources(missing, cached);
      if (built > 0) return built;

      // Nothing resolved. The cache can predate edits that moved or merged the
      // regions these windows were cut from, and resolving nothing is the only
      // signal of it we get. One recompute before giving up, never per window.
      return buildInlineSimulationSources(missing, await get().refreshFoldArtifacts());
    },

    refreshOristudioCpInlineSimulation: async (id) => {
      const document = get().oristudioCpDocument?.document ?? null;
      const simulation = get().oristudioCpInlineSimulations.find(
        (candidate) => candidate.id === id
      );
      if (!document || !simulation) return false;

      const artifacts = await get().refreshFoldArtifacts();
      const segment = artifacts
        ? resolveInlineSimulationSegment(simulation, resolveCpSegments(artifacts))
        : null;
      if (!artifacts || !segment) {
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

      const bounds = foldedSourceBounds(
        cpLinesByIds(document, segmentContainedLineIds(document, artifacts, segment))
      );
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
      setInlineSimulationSource(id, {
        fold: buildSegmentSimulationFold(artifacts, segment),
        modelKey: `${id}:${revision}`,
      });
      // Rewrites persisted provenance, so it dirties like the others.
      takeCanvasSelection('inline-simulation', {
        oristudioCpInlineSimulations: get().oristudioCpInlineSimulations.map((candidate) =>
          candidate.id === id
            ? {
                ...candidate,
                sourceBoundary: segment.boundary.map((ring) => ring.map((point) => ({ ...point }))),
                sourceBounds: bounds,
                sourceFingerprint: sourceFingerprintFor(document, bounds),
                segmentIdHint: segment.id,
              }
            : candidate
        ),
        oristudioCpFocusedInlineSimulationId: id,
        dirty: true,
      });
      return true;
    },

    setSequenceSimulationFocus: (sequenceSimulationFocus) => set({ sequenceSimulationFocus }),

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

    setOristudioCpActiveToolId: (id) => set({ oristudioCpActiveToolId: id }),

    clearOristudioCpActionRequest: (id) =>
      set({
        oristudioCpActionRequest:
          get().oristudioCpActionRequest?.id === id ? null : get().oristudioCpActionRequest,
      }),

    setOristudioCpActiveDiagnostic: (oristudioCpActiveDiagnosticId) => {
      set({ oristudioCpActiveDiagnosticId });
      frameActiveCpDiagnostic(get());
    },

    setOristudioCpActiveFoldedFigure: (oristudioCpActiveFoldedFigureId) => {
      const previousActiveId = get().oristudioCpActiveFoldedFigureId;
      if (oristudioCpActiveFoldedFigureId === null) {
        // Orbit focus goes with the selection. This branch deliberately skips
        // `takeCanvasSelection` — releasing a claim is the releaser's business —
        // but focus is *narrower* than selection, so it cannot be left behind:
        // a figure that keeps focus after being deselected goes on turning under
        // every drag that lands on it.
        set({ oristudioCpActiveFoldedFigureId: null, oristudioCpFocusedFoldedFigureId: null });
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

      // `G` reaches neither analytics chokepoint: `handleCpShortcutAction`
      // short-circuits to the fold before `handleCpToolAction` (so no
      // `cp tool used`), and the toolbar button calls the same store action
      // directly (so no `command invoked`). These are hand-placed for that
      // reason, and every terminal branch below pairs one `fold completed` with
      // this one `fold attempted`.
      const mode: FoldMode = route.kind === 'spatial' ? 'spatial' : 'flat';
      track(ANALYTICS_EVENTS.foldAttempted, {
        mode,
        crease_count_bucket: bucketCount(selectedLineIds.length, COUNT_BUCKETS),
        non_classic_count_bucket: bucketCount(nonClassicCount, COUNT_BUCKETS),
      });
      // Measured from the press, not from the kernel call: the CAMV pre-check and
      // its dialog are part of what the user waits through, and a `halted` verdict
      // is only interesting against how long the folds that *finish* take.
      const attemptedAt = Date.now();
      const completed = (
        verdict: FoldVerdict,
        solutionCount?: number,
        extra?: { refusal?: OristudioCpFold3dRefusal['code']; order_reason?: string }
      ): void => {
        track(ANALYTICS_EVENTS.foldCompleted, {
          mode,
          verdict,
          solution_count_bucket: bucketCount(solutionCount ?? 0, COUNT_BUCKETS),
          elapsed_ms_bucket: bucketCount(Date.now() - attemptedAt, FOLD_DURATION_MS_BUCKETS),
          ...extra,
        });
      };

      // Oriedita `FoldAction`: before folding, run the local flat-foldability
      // check (CAMV / Check4) and, if it finds violations, warn the user and let
      // them fold anyway. This gate is purely LOCAL (per-vertex Maekawa/Kawasaki/
      // big-little-big); global layer-ordering contradictions surface later, from
      // the fold itself. Skipped when the user has disabled the warning.
      const settings = useSettingsStore.getState();
      if (settings.foldWarningEnabled) {
        let violationCount = 0;
        try {
          const camv = await runOristudioCpCheckCommand('CheckCamv');
          // Errors only. `CheckCamv` also emits `SpatialInteriorBorder` at
          // `warning` severity — "border with paper on both sides: the vertices
          // on it are not checked" — which is an observation about the check's
          // own coverage and not a violation of anything. Counting it here would
          // raise Oriedita's "continue to fold?" modal over a document with
          // nothing wrong with it, and report `had_violations` for it.
          violationCount = countCpDiagnosticErrors(camv.diagnostic_entries);
          track(ANALYTICS_EVENTS.foldabilityChecked, {
            source: 'pre-fold',
            had_violations: violationCount > 0,
            violation_count_bucket: bucketCount(violationCount, COUNT_BUCKETS),
          });
        } catch {
          // A failed check must not block folding — leave the count at zero and fold.
        }
        const hasFlatFoldabilityViolations = violationCount > 0;
        if (hasFlatFoldabilityViolations) {
          track(ANALYTICS_EVENTS.foldWarningShown, { source: 'pre-fold' });
          const { confirmed, optionChecked } = await requestConfirmationWithOption({
            title: i18n.t('dialogs:foldWarning.title', 'Warning'),
            // Same check, same scope, same toggle — only the sentence is split.
            // "Errors in flat foldability" is a false description of a spatial
            // document, where what `CheckCamv` reports is closure and
            // self-intersection at folded vertices, not Maekawa and Kawasaki.
            message:
              route.kind === 'spatial'
                ? i18n.t(
                    'dialogs:foldWarning.spatialMessage',
                    'Detected errors in how these creases fold. Continue to fold?'
                  )
                : i18n.t(
                    'dialogs:foldWarning.message',
                    'Detected errors in flat foldability. Continue to fold?'
                  ),
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
          if (!confirmed) {
            completed('cancelled');
            return false;
          }
        }
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
              // Visibility first. `setOristudioCpActiveDiagnostic` frames from
              // committed state via `frameActiveCpDiagnostic`, which rebuilds
              // the list from `visibleCpDiagnosticEntries` on the same two
              // results — so once the overlay is on, that list is the one the
              // offer was built from, and activating before revealing would
              // jump nowhere and leave a row selected that nothing draws.
              get().setOristudioCpViewportOption('camvIssuesVisible', true);
              get().setOristudioCpActiveDiagnostic(notice.locate.entryId);
              completed('located', 0, { refusal: result.refusal.code });
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
          const renderSnapshot = project3dRenderSnapshot(
            result.render,
            result.snapshot,
            displayStyle,
            camera
          );
          retainFoldedFigureHandle(result.handle);
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
            renderSnapshot,
            camera,
            // Recorded once, here, because it must not follow the projection:
            // the frame is a window onto the model and a window does not change
            // shape when you turn what is inside it. See `folded3dFrameRadius`.
            frameRadius: folded3dFrameRadius(result.render),
            placement: IDENTITY_FOLDED_PLACEMENT,
            error: null,
            contradiction: null,
            ...foldedSourceProvenance(
              oristudioCpDocument.document,
              selectedLineIds,
              scopedLineIds
            ),
          };
          set({
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
            oristudioCpActiveFoldedFigureId: figureId,
            oristudioCpFocusedFoldedFigureId: figureId,
            oristudioCpSelection: emptyOristudioCpSelection(),
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
      const sourceCpRevision = get().oristudioCpRevision;
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

      // What the crease selection was before the draft entry took the canvas, so
      // a stopped fold can hand it back rather than making the user reselect the
      // creases they were about to fold.
      const selectionBeforeFold = get().oristudioCpSelection;
      takeCanvasSelection('folded-figure', {
        oristudioCpFoldedFigures: [...get().oristudioCpFoldedFigures, loadingEntry],
        oristudioCpActiveFoldedFigureId: figureId,
        oristudioCpError: null,
      });

      try {
        // A reopened Oriedita file keeps its folded appearance, but not its
        // saved side -- a new figure always faces front (NEW_FOLDED_FIGURE_SIDE).
        const savedModel = foldedFigureModelFromOrieditaMetadata(
          oristudioCpDocument.document.metadata
        );
        const model =
          options.model ??
          (savedModel ? { ...savedModel, state: NEW_FOLDED_FIGURE_SIDE } : undefined);
        const result = await withFoldInFlight('fold', (runId) =>
          foldRuntimeOristudioCpDocument(
            options.startingFaceId ?? 1,
            options.order ?? 'Order5',
            model,
            selectedLineIds,
            runId
          )
        );
        const displayStyle = result.snapshot.display_style;
        // Rendered unselected: a fresh fold is not the canvas selection, so it
        // must not carry the kernel's selection marker either.
        const renderSnapshot = await renderSnapshotForFoldedFigure(
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
        retainFoldedFigureHandle(result.handle);
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
          error: null,
          contradiction,
          // Provenance, so the figure can later be told apart from the creases
          // it came from and refolded from them. Oriedita keeps exactly this
          // (a bounding box) — see lib/foldedFigureStaleness.ts.
          ...foldedSourceProvenance(
            oristudioCpDocument.document,
            selectedLineIds,
            scopedLineIds
          ),
        };
        set({
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
          // A fresh fold is not selected. Selecting it would put delete-key focus
          // on the new figure the moment it appears, and the folded-figure menu
          // targets the most recent figure anyway (activeGeneratedFoldedFigure).
          oristudioCpActiveFoldedFigureId: null,
          // The creases that were folded stay selected otherwise, so a delete
          // right after folding would take them with it.
          oristudioCpSelection: emptyOristudioCpSelection(),
          oristudioCpError: null,
          dirty: true,
          projectMessage: 'Folded model',
        });
        refreshFoldedFigureSelectionMarkers(previousActiveId);
        completed(
          contradiction ? 'contradiction' : foldVerdictForOutcome(result.snapshot),
          result.snapshot.discovered_fold_cases
        );
        return true;
      } catch (error) {
        if (isFoldCancellation(error)) {
          // The draft goes, quietly. Left as an `error` entry it would be debris
          // on the canvas *and* an error toast, for something the user asked for.
          completed('halted');
          return discardFoldedFigureDraftQuietly(figureId, selectionBeforeFold);
        }
        const normalized = engineError(error);
        set({
          oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((figure) =>
            figure.id === figureId
              ? {
                  ...figure,
                  status: 'error',
                  error: normalized.message,
                }
              : figure
          ),
          oristudioCpError: normalized.message,
          error: normalized,
        });
        completed('error');
        return false;
      }
    },

    stopOristudioCpFolds: () => {
      // Only the runs that can actually be stopped. Answering `true` for a run
      // the transport cannot reach would let Escape swallow the key on behalf of
      // a fold that then keeps going — and the affordance is hidden in that case
      // for the same reason.
      const stoppable = stoppableFoldRuns();
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

      // Read before the call, because the call is what changes it. Exactly the
      // predicate `buildFoldedFigureActions` labels the verb from, and exactly
      // the branch `fold_another` takes in the kernel — so the event, the button
      // and the search agree about which of the two a press was. Read through
      // `foldedFigureCycling`, which is the one place that knows a figure has
      // two kinds; both spell the two fields the same way.
      const cycling = foldedFigureCycling(figure);
      const cycleDirection = cycling.wrapsToFirst ? 'wrap' : 'next';
      const spatial = (figure.folded3d ?? null) !== null;

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
          track(ANALYTICS_EVENTS.foldSolutionCycled, {
            direction: cycleDirection,
            solution_count_bucket: bucketCount(
              step.snapshot.discovered_fold_cases,
              COUNT_BUCKETS
            ),
          });
          setFolded3dRenderModel(handle, step.render);
          const camera =
            figure.camera ?? defaultFolded3dCamera(step.render, step.snapshot.model.state);
          const renderSnapshot = project3dRenderSnapshot(
            step.render,
            step.snapshot,
            figure.displayStyle,
            camera
          );
          takeCanvasSelection('folded-figure', {
            oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
              candidate.id === figure.id
                ? {
                    ...candidate,
                    status: 'ready',
                    folded3d: step.snapshot,
                    renderSnapshot,
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
        track(ANALYTICS_EVENTS.foldSolutionCycled, {
          direction: cycleDirection,
          solution_count_bucket: bucketCount(snapshot.discovered_fold_cases, COUNT_BUCKETS),
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
              ? { ...candidate, status: 'ready', snapshot, renderSnapshot, error: null }
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
      // Only the *orientation* is re-projected, because only the orientation
      // reaches the picture: zoom is a window setting the projection deliberately
      // ignores (see `FoldedFigureCamera.zoom`), so re-projecting for one would
      // be `earcut` plus a BSP build to arrive at the picture already on the
      // entry.
      const before = figure.camera ?? null;
      const sameView =
        before !== null && before.yaw === camera.yaw && before.pitch === camera.pitch;
      const renderSnapshot = sameView
        ? null
        : reproject3dFigureAt(figure, figure.displayStyle, camera);
      takeCanvasSelection('folded-figure', {
        oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
          candidate.id === figure.id
            ? {
                ...candidate,
                camera,
                renderSnapshot: renderSnapshot ?? candidate.renderSnapshot,
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
      if ((figure.folded3d ?? null) !== null) {
        const renderSnapshot = reproject3dFigure(figure, displayStyle);
        // A figure reopened from a file has no render model: keep the stored
        // picture rather than blanking it, and still record the chosen style so
        // a refold shows it.
        takeCanvasSelection('folded-figure', {
          oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
            candidate.id === figure.id
              ? {
                  ...candidate,
                  displayStyle,
                  renderSnapshot: renderSnapshot ?? candidate.renderSnapshot,
                }
              : candidate
          ),
          oristudioCpActiveFoldedFigureId: figure.id,
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
          true
        );
        takeCanvasSelection('folded-figure', {
          oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
            candidate.id === figure.id ? { ...candidate, displayStyle, renderSnapshot } : candidate
          ),
          oristudioCpActiveFoldedFigureId: figure.id,
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

    updateOristudioCpFoldedFigureModel: async (id, update) => {
      const figure = get().oristudioCpFoldedFigures.find((candidate) => candidate.id === id);

      // A 3D figure keeps its model on `folded3d`, not in the kernel, and the
      // projector is a pure function of (render model, model, camera) — so this
      // is a re-projection rather than a round trip. No request sequencing
      // either: there is nothing in flight to land out of order.
      const spatial = figure?.folded3d ?? null;
      if (figure && spatial) {
        const model: OristudioCpFoldedFigureModel = { ...spatial.model, ...update };
        const next = { ...spatial, model };
        const renderSnapshot = reproject3dFigureAt(
          { ...figure, folded3d: next },
          figure.displayStyle,
          figure.camera ?? null
        );
        takeCanvasSelection('folded-figure', {
          oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
            candidate.id === figure.id
              ? {
                  ...candidate,
                  folded3d: next,
                  // A figure reopened from a file has no render model, so it
                  // cannot be re-projected; keep the stored picture rather than
                  // blanking it, exactly as the camera setter does.
                  renderSnapshot: renderSnapshot ?? candidate.renderSnapshot,
                }
              : candidate
          ),
          oristudioCpActiveFoldedFigureId: figure.id,
          oristudioCpError: null,
          dirty: true,
        });
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

      const model: OristudioCpFoldedFigureModel = {
        ...figure.snapshot.model,
        ...update,
      };
      // Continuous controls (the colour pickers, the alpha slider) fire a change
      // per pointer move, so several round-trips can be in flight at once and
      // could otherwise land out of order. Only the newest request for a figure
      // is allowed to write.
      const requestId = (modelRequestSequence.get(id) ?? 0) + 1;
      modelRequestSequence.set(id, requestId);
      pendingLiveModelWrites.add(id);
      try {
        const snapshot = await writeFoldedFigureModel(figure.handle, model);
        const renderSnapshot = await renderSnapshotForFoldedFigure(
          figure.handle,
          figure.displayStyle,
          foldedFigureIndex(figure.id),
          true
        );
        if (modelRequestSequence.get(id) !== requestId) return true;
        takeCanvasSelection('folded-figure', {
          oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
            candidate.id === figure.id
              ? { ...candidate, snapshot, renderSnapshot, error: null }
              : candidate
          ),
          oristudioCpActiveFoldedFigureId: figure.id,
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
      } finally {
        pendingLiveModelWrites.delete(id);
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
    refoldOristudioCpFoldedFigure: async (id) => {
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
          const camera = defaultFolded3dCamera(result.render, result.snapshot.model.state);
          const renderSnapshot = project3dRenderSnapshot(
            result.render,
            result.snapshot,
            figure.displayStyle,
            camera
          );
          if (!(await adoptFolded3dHandle(figure.id, refoldEpoch, result.handle, result.render))) {
            return false;
          }
          takeCanvasSelection('folded-figure', {
            oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
              candidate.id === figure.id
                ? {
                    ...candidate,
                    handle: result.handle,
                    status: 'ready',
                    snapshot: null,
                    folded3d: result.snapshot,
                    renderSnapshot,
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
          return true;
        } catch (error) {
          if (isFoldCancellation(error)) return restorePreviousFigureQuietly(figure);
          return restorePreviousFigure(figure, engineError(error).message);
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
        const renderSnapshot = await renderSnapshotForFoldedFigure(
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
        retainFoldedFigureHandle(result.handle);
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
        if (isFoldCancellation(error)) return restorePreviousFigureQuietly(figure);
        return restorePreviousFigure(figure, engineError(error).message);
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
        track(ANALYTICS_EVENTS.foldedFigureRehydrated, { trigger, outcome: 'refused' });
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

        retainFoldedFigureHandle(handle);
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
        track(ANALYTICS_EVENTS.foldedFigureRehydrated, { trigger, outcome: 'adopted' });
        return true;
      } catch {
        // Silent by design. A background rehydrate that fails leaves a figure
        // exactly as good as it was, and `oristudioCpError` is a toast.
        return await abandon(handle);
      } finally {
        pendingFolded3dRehydrations.delete(id);
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
        // A copy is folded from the same creases, so it inherits the provenance
        // and goes stale with its original.
        sourceBounds: source.sourceBounds ?? null,
        sourceFingerprint: source.sourceFingerprint ?? null,
        sourceLineIds: [...(source.sourceLineIds ?? [])],
        sourceScopedLineIds: [...(source.sourceScopedLineIds ?? source.sourceLineIds ?? [])],
        error: null,
      };

      // Captured before the await: the placeholder below is deletable while it
      // loads, exactly as a refolding figure is. See `adoptFolded3dHandle`.
      const duplicateEpoch = foldedFigureHandleEpoch();
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
          const camera =
            source.camera ?? defaultFolded3dCamera(result.render, result.snapshot.model.state);
          const renderSnapshot = project3dRenderSnapshot(
            result.render,
            result.snapshot,
            source.displayStyle,
            camera
          );
          if (
            !(await adoptFolded3dHandle(figureId, duplicateEpoch, result.handle, result.render))
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
                    renderSnapshot,
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
        const renderSnapshot = await renderSnapshotForFoldedFigure(
          result.handle,
          source.displayStyle,
          figureIndex,
          true
        );
        retainFoldedFigureHandle(result.handle);
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
      const activeId =
        get().oristudioCpActiveFoldedFigureId === id
          ? remaining[0]?.id ?? null
          : get().oristudioCpActiveFoldedFigureId;
      set({
        oristudioCpFoldedFigures: remaining,
        oristudioCpActiveFoldedFigureId: activeId,
        dirty: true,
      });
      refreshFoldedFigureSelectionMarkers(activeId);
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
          annotation.id === id ? ({ ...annotation, ...patch } as typeof annotation) : annotation
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
      // Only *taking* the selection is an invariant-bearing move. Releasing your
      // own claim leaves whatever else holds one alone — picking a crease tool
      // deselects the reference image without deselecting the creases the tool
      // is about to act on.
      if (resolved === null) {
        set({ oristudioCpSelectedAnnotationId: null });
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
