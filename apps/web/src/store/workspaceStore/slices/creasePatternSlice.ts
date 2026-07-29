import { projectFromSnapshot } from '../../../engine/snapshotMapper';
import type { FoldArtifacts, FoldDocument, OptimizationReport } from '../../../engine/types';
import {
  DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
  emptyOristudioCpSelection,
  toggleCpSelectionList,
} from '../../../lib/creasePatternViewport';
import {
  cpSelectionTransformLabel,
  selectedFoldableCpLineIds,
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
} from '../../../cp-workspace/inlineSimulation/inlineSimulation';
import {
  clearInlineSimulationSource,
  setInlineSimulationSource,
} from '../../../cp-workspace/inlineSimulation/inlineSimulationRuntime';
import { DEFAULT_SIMULATOR_VIEW } from '../../../simulator/SimulatorViewport';
import { boxAabb } from '../../../cp-workspace/canvasObjects/placeBesideCp';
import { foldedFigureUserAabb } from '../../../cp-workspace/adapters/cpFoldedToScene';
import { cpSvgToModel } from '../../../lib/creasePatternViewport';
import type { Aabb } from '../../../cp-workspace/picking/lineHitIndex';
import { foldArtifactsFromFold } from '../../../lib/creasePatternImport';
import {
  generatedCpLineage,
  markGeneratedCpLineageStale,
  stableTextDigest,
} from '../../../lib/oristudioCpLineage';
import { foldedFigureModelFromOrieditaMetadata } from '../../../lib/orieditaNativeMetadata';
import {
  cpUserAnchorForLineIds,
  placeFoldedFigureBesideCp,
} from '../../../cp-workspace/adapters/cpFoldedToScene';
import i18n from '../../../i18n';
import { requestConfirmation, requestConfirmationWithOption } from '../../commandDialogStore';
import { useLayoutStore } from '../../layoutStore';
import { useSettingsStore } from '../../settingsStore';
import { selectWorkspaceCapabilities } from '../capabilities';
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
  projectStateFromSnapshot,
  type EngineClient,
} from '../engineRuntime';
import {
  createBlankOristudioCpDocument,
  duplicateOristudioCpFoldedFigure as duplicateRuntimeOristudioCpFoldedFigure,
  deselectAllOristudioCp,
  exportOristudioCpDocumentAsFold,
  foldOristudioCpDocument as foldRuntimeOristudioCpDocument,
  foldOristudioCpFigureAnother as foldRuntimeOristudioCpFigureAnother,
  foldOristudioCpFigureToCase as foldRuntimeOristudioCpFigureToCase,
  freeOristudioCpFoldedFigure,
  getOristudioCpFoldedFigureRenderSnapshot as getRuntimeOristudioCpFoldedFigureRenderSnapshot,
  loadOristudioCpDocumentFromText,
  releaseOristudioCpDocument,
  runOristudioCpCheckCommand,
  setOristudioCpFoldedFigureModel as setRuntimeOristudioCpFoldedFigureModel,
} from '../oristudioCpRuntime';
import type { CreasePatternSlice, WorkspaceSliceCreator, WorkspaceState } from '../types';
import type { CanvasAnnotation } from '../../../cp-workspace/annotations/annotation';
import {
  releaseFoldedFigureHandle,
  releaseFoldedFigureHandles,
  resetFoldedFigureHandles,
  retainFoldedFigureHandle,
  retainFoldedFigureHandles,
  setFoldedFigureHandleFree,
} from '../../../cp-workspace/folded/foldedFigureHandles';
import { IDENTITY_FOLDED_PLACEMENT } from '../../../engine/oristudioCpTypes';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedFigureSnapshot,
} from '../../../engine/oristudioCpTypes';
import { foldedModelsEqual } from '../../../cp-workspace/folded/foldedFigureState';
import {
  cpLinesByIds,
  foldedSourceBounds,
  foldedSourceFingerprint,
  reselectFoldableLineIds,
} from '../../../cp-workspace/folded/foldedFigureStaleness';
import type { WorkspaceCapabilityId } from '../../../lib/workspaceCapabilities';

/** Cap on the CP undo stack (matches historySlice's MAX_HISTORY). */
const MAX_CP_HISTORY = 100;

// Dedupe concurrent `ensureEditCreasePattern` calls (e.g. React StrictMode
// double-invoking the seeding effect) so only one blank document is created.
let ensureEditInFlight: Promise<void> | null = null;

let nextInlineSimulationId = 1;

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
function occupiedModelSpace(state: WorkspaceState): Aabb[] {
  const boxes = [
    ...state.oristudioCpInlineSimulations.map((simulation) => boxAabb(simulation.box)),
    ...state.oristudioCpAnnotations
      .filter((annotation) => !annotation.hidden)
      .map((annotation) =>
        boxAabb({
          center: annotation.center,
          width: annotation.width,
          height: annotation.height,
          rotation: annotation.rotation,
        })
      ),
  ];
  for (const figure of state.oristudioCpFoldedFigures) {
    const userAabb = foldedFigureUserAabb(figure);
    if (!userAabb) continue;
    const min = cpSvgToModel({ x: userAabb.minX, y: userAabb.minY });
    const max = cpSvgToModel({ x: userAabb.maxX, y: userAabb.maxY });
    boxes.push({
      minX: Math.min(min.x, max.x),
      minY: Math.min(min.y, max.y),
      maxX: Math.max(min.x, max.x),
      maxY: Math.max(min.y, max.y),
    });
  }
  return boxes;
}

function inlineSimulationRevision(id: string): number {
  const next = (inlineSimulationRevisions.get(id) ?? 0) + 1;
  inlineSimulationRevisions.set(id, next);
  return next;
}

export const createCreasePatternSlice: WorkspaceSliceCreator<CreasePatternSlice> = (
  set,
  get
) => {
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
      set(projectStateFromSnapshot(result.initializedSnapshot, get().project.title));
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
    return state.project.creases.length > 0 || state.project.facets.length > 0;
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
      [...figures].reverse().find((figure) => figure.sourceKind === 'generated-from-current-cp') ??
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
  async function reconcileFoldedFigureModel(id: string): Promise<void> {
    const figure = get().oristudioCpFoldedFigures.find((candidate) => candidate.id === id);
    // A figure the step removed, or one reopened from a file without a handle.
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
   */
  function pushOverlayHistoryEntry(input: {
    annotations: CanvasAnnotation[];
    foldedFigures: OristudioCpFoldedFigureEntry[];
    activeFoldedFigureId: string | null;
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

  function nextGeneratedFoldedFigureId(): string {
    let figureId = '';
    do {
      figureId = `generated-${++foldedFigureRequestSequence}`;
    } while (get().oristudioCpFoldedFigures.some((figure) => figure.id === figureId));
    return figureId;
  }

  /**
   * The provenance a fold records: the bounding box of the creases folded, plus
   * a fingerprint of them, so the figure can later be compared against a fresh
   * reselect of that region. Oriedita's refold check, ported per figure — see
   * `lib/foldedFigureStaleness.ts`.
   */
  function foldedSourceProvenance(
    document: OristudioCpDocumentSnapshot,
    lineIds: readonly number[]
  ): Pick<
    OristudioCpFoldedFigureEntry,
    'sourceBounds' | 'sourceFingerprint' | 'sourceLineIds'
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
   * Put a figure back exactly as it was and report why, for a refold that could
   * not produce a replacement. The figure itself was never invalid — the crease
   * pattern is — so destroying it would lose work over someone else's problem.
   */
  function restorePreviousFigure(
    previous: OristudioCpFoldedFigureEntry,
    message: string
  ): boolean {
    set({
      oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
        candidate.id === previous.id ? previous : candidate
      ),
      oristudioCpError: message,
      error: { code: 'invalid_operation', message },
    });
    return false;
  }

  /**
   * Mark a fold as in flight for as long as `run` takes, so the UI can show
   * progress for a slow one. Folding happens in the CP worker, so the main
   * thread stays free to actually paint that indicator.
   */
  async function withFoldInFlight<T>(run: () => Promise<T>): Promise<T> {
    set({ oristudioCpFoldsInFlight: get().oristudioCpFoldsInFlight + 1 });
    try {
      return await run();
    } finally {
      set({ oristudioCpFoldsInFlight: Math.max(0, get().oristudioCpFoldsInFlight - 1) });
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
    set({ status: 'optimizing', error: null });
    const checkpoint = await get().beginHistoryCheckpoint();
    try {
      const { api, treeHandle } = await requireActiveTree();
      const report = await optimize(api, treeHandle);
      const snapshot = await api.snapshot(treeHandle);
      set({
        project: projectFromSnapshot(snapshot, get().project.title),
        status: report.is_feasible ? 'optimized' : 'needs_optimization',
        error: null,
        lastOptimization: report,
        ...staleFoldArtifactResourceState(get().foldArtifactRevision),
        oristudioCpLineage: markGeneratedCpLineageStale(get().oristudioCpLineage),
        dirty: true,
        projectMessage: label,
        designViewportFitRequestId: options.fitPaperView
          ? get().designViewportFitRequestId + 1
          : get().designViewportFitRequestId,
      });
      get().commitHistoryCheckpoint(checkpoint, label);
    } catch (error) {
      set({ status: 'error', error: engineError(error) });
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
    oristudioCpFoldsInFlight: 0,
    oristudioCpViewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
    oristudioCpAnnotations: [],
    oristudioCpSelectedAnnotationId: null,
    oristudioCpInlineSimulations: [],
    oristudioCpFocusedInlineSimulationId: null,
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
      if (get().oristudioCpDocument) return;
      if (ensureEditInFlight) return ensureEditInFlight;
      ensureEditInFlight = (async () => {
        try {
          const document = await createBlankOristudioCpDocument();
          const priorState = get();
          // A bare, auto-seeded CP establishes no design. If nothing has been
          // authored yet (no tree, no BP project), keep the Design workspace on
          // its method chooser — matching `createNewCreasePattern` — instead of
          // deep-linking to a TreeMaker layout for a design that doesn't exist.
          const noDesignYet =
            priorState.project.edges.length === 0 && priorState.oristudioBpDocument === null;
          // Same complete editor state File › New establishes, so interactive
          // edits (undo/redo, images, tools) behave identically on this canvas.
          set({
            ...freshEditableCpState(document, priorState),
            ...(noDesignYet ? { pendingDesignChoice: true } : {}),
          });
        } catch (error) {
          set({ oristudioCpError: engineError(error).message });
        } finally {
          ensureEditInFlight = null;
        }
      })();
      return ensureEditInFlight;
    },

    buildCreasePattern: async () => {
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
        const project = projectFromSnapshot(snapshot, get().project.title);
        const hasDrawableCreasePattern = project.creases.length > 0 || project.facets.length > 0;

        if (!hasDrawableCreasePattern) {
          set({
            project,
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
          project,
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
        useLayoutStore.getState().activateWorkspace('edit');
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
      }
    },

    sendTreeCreasePatternToEdit: async () => {
      const capability = selectWorkspaceCapabilities(get())['cp.build'];
      if (!capability.enabled) {
        set({ error: { code: 'invalid_operation', message: capability.reason } });
        return false;
      }
      const previousStatus = get().status;
      set({ status: 'building_crease_pattern', error: null });
      try {
        const { api, treeHandle } = await requireActiveTree();
        // Turn the tree into creases, then hand the generated CP to the always-live
        // Edit canvas via Import(Add) so it merges into whatever is already there,
        // instead of replacing the Edit surface. Mirrors BP's "Send to Edit"
        // (see sendOristudioBpToEdit). The engine FOLD already uses the CP editor's
        // crease convention, so no ORIPA-style 2<->3 swap is needed here.
        await api.buildCreasePattern(treeHandle);
        const foldJson = await api.exportFold(treeHandle);
        await get().ensureEditCreasePattern();
        const ok = await get().importAddOristudioCpText(
          foldJson,
          'fold',
          'Sent design to Edit',
          `${get().project.title || 'design'}.fold`
        );
        set({ status: ok ? 'crease_pattern_ready' : previousStatus });
        if (ok) {
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

      const id = `inline-sim-${nextInlineSimulationId++}`;
      const simulation = createInlineSimulation({
        id,
        segment,
        document,
        cpLineIds,
        z: topInlineSimulationZ(simulations) + 1,
        view: DEFAULT_SIMULATOR_VIEW,
        blockers: occupiedModelSpace(get()),
      });
      setInlineSimulationSource(id, { fold, modelKey: `${id}:0` });

      set({
        oristudioCpInlineSimulations: [...simulations, simulation],
        // A new window takes the solver: opening one and watching nothing happen
        // would be the wrong first impression.
        oristudioCpFocusedInlineSimulationId: id,
        oristudioCpSelectedAnnotationId: null,
      });
      return 'added';
    },

    updateOristudioCpInlineSimulation: (id, patch) => {
      set({
        oristudioCpInlineSimulations: get().oristudioCpInlineSimulations.map((simulation) =>
          simulation.id === id ? { ...simulation, ...patch } : simulation
        ),
      });
    },

    removeOristudioCpInlineSimulation: (id) => {
      clearInlineSimulationSource(id);
      const remaining = get().oristudioCpInlineSimulations.filter(
        (simulation) => simulation.id !== id
      );
      set({
        oristudioCpInlineSimulations: remaining,
        oristudioCpFocusedInlineSimulationId:
          get().oristudioCpFocusedInlineSimulationId === id
            ? null
            : get().oristudioCpFocusedInlineSimulationId,
      });
    },

    focusOristudioCpInlineSimulation: (id) => {
      if (get().oristudioCpFocusedInlineSimulationId === id) return;
      set({
        oristudioCpFocusedInlineSimulationId: id,
        // The canvas allows one selected object at a time; focusing a window
        // drops an annotation selection, as selecting an annotation drops this.
        ...(id !== null ? { oristudioCpSelectedAnnotationId: null } : {}),
      });
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
        // the window and say so rather than silently re-pointing it at whichever
        // region happens to be nearest — see 0b3b1ea6 for the same rule applied
        // to a refold that cannot produce a replacement.
        set({ projectMessage: 'That region no longer exists in the crease pattern' });
        return false;
      }

      const bounds = foldedSourceBounds(
        cpLinesByIds(document, segmentContainedLineIds(document, artifacts, segment))
      );
      const revision = inlineSimulationRevision(id);
      setInlineSimulationSource(id, {
        fold: buildSegmentSimulationFold(artifacts, segment),
        modelKey: `${id}:${revision}`,
      });
      set({
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
      });
      return true;
    },

    setSequenceSimulationFocus: (sequenceSimulationFocus) => set({ sequenceSimulationFocus }),

    setOristudioCpViewportOption: (key, value) =>
      set({ oristudioCpViewport: { ...get().oristudioCpViewport, [key]: value } }),

    setOristudioCpSelection: (oristudioCpSelection) => set({ oristudioCpSelection }),

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

    setOristudioCpActiveDiagnostic: (oristudioCpActiveDiagnosticId) =>
      set({ oristudioCpActiveDiagnosticId }),

    setOristudioCpActiveFoldedFigure: (oristudioCpActiveFoldedFigureId) => {
      const previousActiveId = get().oristudioCpActiveFoldedFigureId;
      set({
        oristudioCpActiveFoldedFigureId,
        // The other half of the canvas's single-selection rule: selecting a
        // folded figure drops the annotation selection. See setSelectedAnnotation.
        ...(oristudioCpActiveFoldedFigureId !== null
          ? { oristudioCpSelectedAnnotationId: null }
          : {}),
      });
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

      const selectedLineIds = selectedFoldableCpLineIds(oristudioCpDocument.document, {
        ...emptyOristudioCpSelection(),
        lines: options.lineIds ?? get().oristudioCpSelection.lines,
      });
      if (selectedLineIds.length === 0) {
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

      // Oriedita `FoldAction`: before folding, run the local flat-foldability
      // check (CAMV / Check4) and, if it finds violations, warn the user and let
      // them fold anyway. This gate is purely LOCAL (per-vertex Maekawa/Kawasaki/
      // big-little-big); global layer-ordering contradictions surface later, from
      // the fold itself. Skipped when the user has disabled the warning.
      const settings = useSettingsStore.getState();
      if (settings.foldWarningEnabled) {
        let hasFlatFoldabilityViolations = false;
        try {
          const camv = await runOristudioCpCheckCommand('CheckCamv');
          hasFlatFoldabilityViolations = (camv.diagnostic_entries?.length ?? 0) > 0;
        } catch {
          // A failed check must not block folding — leave the flag false and fold.
        }
        if (hasFlatFoldabilityViolations) {
          const { confirmed, optionChecked } = await requestConfirmationWithOption({
            title: i18n.t('dialogs:foldWarning.title', 'Warning'),
            message: i18n.t(
              'dialogs:foldWarning.message',
              'Detected errors in flat foldability. Continue to fold?'
            ),
            optionLabel: i18n.t('dialogs:foldWarning.dontShowAgain', "Don't show this again"),
            confirmLabel: i18n.t('dialogs:common.yes', 'Yes'),
            cancelLabel: i18n.t('dialogs:common.no', 'No'),
          });
          // Oriedita persists the "don't show again" choice whether the user
          // clicks Yes or No.
          if (optionChecked) settings.setFoldWarningEnabled(false);
          if (!confirmed) return false;
        }
      }

      const previousActiveId = get().oristudioCpActiveFoldedFigureId;
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

      set({
        oristudioCpFoldedFigures: [...get().oristudioCpFoldedFigures, loadingEntry],
        oristudioCpActiveFoldedFigureId: figureId,
        oristudioCpError: null,
      });

      try {
        const model =
          options.model ??
          foldedFigureModelFromOrieditaMetadata(oristudioCpDocument.document.metadata) ??
          undefined;
        const result = await withFoldInFlight(() =>
          foldRuntimeOristudioCpDocument(
            options.startingFaceId ?? 1,
            options.order ?? 'Order5',
            model,
            selectedLineIds
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
        const foldedSourceAnchor = cpUserAnchorForLineIds(
          oristudioCpDocument.document,
          selectedLineIds
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
          ...foldedSourceProvenance(oristudioCpDocument.document, selectedLineIds),
        };
        set({
          oristudioCpFoldedFigures: existing.map((figure) =>
            figure.id === figureId
              ? {
                  ...folded,
                  // Park it beside the crease pattern: the kernel folds into
                  // roughly the flat CP's own coordinates, so left alone the
                  // figure covers the pattern it came from.
                  placement: placeFoldedFigureBesideCp(folded, existing, foldedSourceAnchor),
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
        return true;
      } catch (error) {
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
        return false;
      }
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

      set({
        oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
          candidate.id === figure.id ? { ...candidate, status: 'loading' } : candidate
        ),
      });

      try {
        // Captured after the guard above: the closure would otherwise lose the
        // narrowing on a mutable property.
        const handle = figure.handle;
        const snapshot = await withFoldInFlight(() =>
          foldRuntimeOristudioCpFigureAnother(handle)
        );
        const renderSnapshot = await renderSnapshotForFoldedFigure(
          figure.handle,
          figure.displayStyle,
          foldedFigureIndex(figure.id),
          true
        );
        set({
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
        const result = await withFoldInFlight(() =>
          foldRuntimeOristudioCpFigureToCase(handle, objective, 'Order5')
        );
        const renderSnapshot = await renderSnapshotForFoldedFigure(
          figure.handle,
          figure.displayStyle,
          foldedFigureIndex(figure.id),
          true
        );
        set({
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

      try {
        const renderSnapshot = await renderSnapshotForFoldedFigure(
          figure.handle,
          displayStyle,
          foldedFigureIndex(figure.id),
          true
        );
        set({
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
        set({
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
      set({
        oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
          candidate.id === figure.id ? { ...candidate, status: 'loading' } : candidate
        ),
        oristudioCpError: null,
      });

      try {
        const result = await withFoldInFlight(() =>
          foldRuntimeOristudioCpDocument(
            figure.startingFaceId ?? 1,
            'Order5',
            figure.snapshot?.model,
            lineIds
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
        set({
          oristudioCpFoldedFigures: get().oristudioCpFoldedFigures.map((candidate) =>
            candidate.id === figure.id
              ? {
                  ...candidate,
                  handle: result.handle,
                  status: 'ready',
                  snapshot: result.snapshot,
                  renderSnapshot,
                  sourceCpRevision: get().oristudioCpRevision,
                  contradiction: result.snapshot.contradiction ?? null,
                  error: null,
                  // Re-baseline against what was actually folded, so the figure
                  // reads as up to date until the creases move again.
                  ...foldedSourceProvenance(oristudioCpDocument.document, lineIds),
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
        return restorePreviousFigure(figure, engineError(error).message);
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
        error: null,
      };

      set({
        oristudioCpFoldedFigures: [...get().oristudioCpFoldedFigures, loadingEntry],
        oristudioCpActiveFoldedFigureId: figureId,
        oristudioCpError: null,
      });

      try {
        const result = await duplicateRuntimeOristudioCpFoldedFigure(source.handle);
        const renderSnapshot = await renderSnapshotForFoldedFigure(
          result.handle,
          source.displayStyle,
          figureIndex,
          true
        );
        retainFoldedFigureHandle(result.handle);
        set({
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
      const handles = get().oristudioCpFoldedFigures
        .map((figure) => figure.handle)
        .filter((handle): handle is number => handle !== null);
      resetFoldedFigureHandles();
      await Promise.allSettled(handles.map((handle) => freeOristudioCpFoldedFigure(handle)));
      set({
        oristudioCpFoldedFigures: [],
        oristudioCpActiveFoldedFigureId: null,
      });
    },

    clearOristudioCpSelection: () => {
      // Clear the frontend mirror immediately (the surface deselects at once)...
      set({ oristudioCpSelection: emptyOristudioCpSelection() });
      // ...and the kernel document's selection flags, else a later select/deselect
      // re-derives the stale set (the kernel is authoritative for select ops).
      if (!get().oristudioCpDocument) return;
      void (async () => {
        try {
          const refreshed = await deselectAllOristudioCp();
          if (refreshed) {
            set({
              oristudioCpDocument: refreshed,
              oristudioCpSelection: emptyOristudioCpSelection(),
            });
          }
        } catch {
          // A deselect is best-effort UI state; ignore kernel errors.
        }
      })();
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

    toggleOristudioCpLineSelection: (id, additive = false) =>
      set({
        oristudioCpSelection: additive
          ? {
              ...get().oristudioCpSelection,
              lines: toggleCpSelectionList(get().oristudioCpSelection.lines, id),
            }
          : { ...emptyOristudioCpSelection(), lines: [id] },
      }),

    toggleOristudioCpPointSelection: (id, additive = false) =>
      set({
        oristudioCpSelection: additive
          ? {
              ...get().oristudioCpSelection,
              points: toggleCpSelectionList(get().oristudioCpSelection.points, id),
            }
          : { ...emptyOristudioCpSelection(), points: [id] },
      }),

    toggleOristudioCpCircleSelection: (id, additive = false) =>
      set({
        oristudioCpSelection: additive
          ? {
              ...get().oristudioCpSelection,
              circles: toggleCpSelectionList(get().oristudioCpSelection.circles, id),
            }
          : { ...emptyOristudioCpSelection(), circles: [id] },
      }),

    toggleOristudioCpTextSelection: (id, additive = false) =>
      set({
        oristudioCpSelection: additive
          ? {
              ...get().oristudioCpSelection,
              texts: toggleCpSelectionList(get().oristudioCpSelection.texts, id),
            }
          : { ...emptyOristudioCpSelection(), texts: [id] },
      }),

    // --- Annotations: images + text boxes (superset feature; see
    // docs/superset-features.md). Web-side layer only; a fresh document resets
    // the layer via the load/create paths.
    addAnnotation: (annotation) =>
      set({
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
      const previousFoldedId = get().oristudioCpActiveFoldedFigureId;
      set({
        oristudioCpSelectedAnnotationId: resolved,
        // The canvas has one selection. Selecting an annotation drops the folded
        // figure's selection so two objects never show handles at once; enforced
        // here rather than at the call sites so the invariant cannot drift.
        ...(resolved !== null ? { oristudioCpActiveFoldedFigureId: null } : {}),
      });
      if (resolved !== null && previousFoldedId) {
        refreshFoldedFigureSelectionMarkers(previousFoldedId);
      }
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
  };
};
