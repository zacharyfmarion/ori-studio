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
import { resolveCpSegments } from '../../../lib/creasePatternSegmentation';
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
import type { CreasePatternSlice, WorkspaceSliceCreator } from '../types';
import type { CanvasAnnotation } from '../../../cp-workspace/annotations/annotation';
import {
  releaseFoldedFigureHandle,
  releaseFoldedFigureHandles,
  resetFoldedFigureHandles,
  retainFoldedFigureHandle,
  retainFoldedFigureHandles,
  setFoldedFigureHandleFree,
} from '../../../cp-workspace/foldedFigureHandles';
import { IDENTITY_FOLDED_PLACEMENT } from '../../../engine/oristudioCpTypes';
import type {
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
} from '../../../engine/oristudioCpTypes';
import type { WorkspaceCapabilityId } from '../../../lib/workspaceCapabilities';

/** Cap on the CP undo stack (matches historySlice's MAX_HISTORY). */
const MAX_CP_HISTORY = 100;

// Dedupe concurrent `ensureEditCreasePattern` calls (e.g. React StrictMode
// double-invoking the seeding effect) so only one blank document is created.
let ensureEditInFlight: Promise<void> | null = null;

export const createCreasePatternSlice: WorkspaceSliceCreator<CreasePatternSlice> = (
  set,
  get
) => {
  // Handles are owned by reachability (live list + history), not by the delete
  // action — see cp-workspace/foldedFigureHandles.
  setFoldedFigureHandleFree(freeOristudioCpFoldedFigure);

  const wholeSimulationFocus = { kind: 'whole' as const };
  let foldArtifactPromise: Promise<FoldArtifacts | null> | null = null;
  let foldArtifactPromiseRevision: number | null = null;
  let foldedFigureRequestSequence = 0;
  // Newest in-flight model request per figure, so a stale response is dropped.
  const modelRequestSequence = new Map<string, number>();

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

    const requestId = current.foldArtifactRequestId + 1;
    set({
      foldArtifacts: null,
      foldArtifactError: null,
      foldArtifactStatus: 'loading',
      foldArtifactResolvedRevision: null,
      foldArtifactRequestId: requestId,
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
        const latest = get();
        if (
          foldArtifacts &&
          latest.foldArtifactRevision === currentRevision &&
          latest.foldArtifactRequestId === requestId
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
        const latest = get();
        if (
          latest.foldArtifactRevision === currentRevision &&
          latest.foldArtifactRequestId === requestId
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
    oristudioCpViewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
    oristudioCpAnnotations: [],
    oristudioCpSelectedAnnotationId: null,
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
            ...freshEditableCpState(document, priorState.projectLoadId),
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
        const result = await foldRuntimeOristudioCpDocument(
          options.startingFaceId ?? 1,
          options.order ?? 'Order5',
          model,
          selectedLineIds
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
        const snapshot = await foldRuntimeOristudioCpFigureAnother(figure.handle);
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
        const result = await foldRuntimeOristudioCpFigureToCase(figure.handle, objective, 'Order5');
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
      try {
        const snapshot = await setRuntimeOristudioCpFoldedFigureModel(figure.handle, model);
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
