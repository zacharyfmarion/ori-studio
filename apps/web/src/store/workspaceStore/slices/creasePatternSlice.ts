import { projectFromSnapshot } from '../../../engine/snapshotMapper';
import type { FoldArtifacts, FoldDocument, OptimizationReport } from '../../../engine/types';
import {
  DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
  emptyOristudioCpSelection,
  toggleCpSelectionList,
} from '../../../lib/creasePatternViewport';
import {
  cpSelectionTransformLabel,
  selectedCpLineSegments,
  transformCpLineSegments,
} from '../../../lib/creasePatternClipboard';
import { DEFAULT_CREASE_COLOR_MODE } from '../../../lib/sampleProject';
import {
  generatedCpLineage,
  markGeneratedCpLineageStale,
  stableTextDigest,
} from '../../../lib/oristudioCpLineage';
import { defaultOristudioCpSymmetry } from '../../../lib/oristudioCpSymmetry';
import { requestConfirmation } from '../../commandDialogStore';
import { useLayoutStore } from '../../layoutStore';
import { selectWorkspaceCapabilities } from '../capabilities';
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
  exportOristudioCpDocumentAsFold,
  loadOristudioCpDocumentFromText,
  releaseOristudioCpDocument,
} from '../oristudioCpRuntime';
import type { CreasePatternSlice, WorkspaceSliceCreator } from '../types';
import type { WorkspaceCapabilityId } from '../../../lib/workspaceCapabilities';

export const createCreasePatternSlice: WorkspaceSliceCreator<CreasePatternSlice> = (
  set,
  get
) => {
  const wholeSimulationFocus = { kind: 'whole' as const };
  let foldArtifactPromise: Promise<FoldArtifacts | null> | null = null;
  let foldArtifactPromiseRevision: number | null = null;

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
    if (state.documentMode === 'crease-pattern') return false;
    return state.project.creases.length > 0 || state.project.facets.length > 0;
  }

  async function confirmReplaceCustomizedGeneratedCp(): Promise<boolean> {
    const lineage = get().oristudioCpLineage;
    if (
      get().documentMode !== 'tree' ||
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
      const [api, foldJson] = await Promise.all([
        getEngine(),
        exportOristudioCpDocumentAsFold(),
      ]);
      return api.flatFoldArtifacts(foldJson, { solution_limit: 10 });
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
        activeEditingSurface: 'tree',
        oristudioCpLineage: markGeneratedCpLineageStale(get().oristudioCpLineage),
        dirty: true,
        projectMessage: label,
        designViewportFitRequestId: options.fitPaperView
          ? get().designViewportFitRequestId + 1
          : get().designViewportFitRequestId,
      });
      get().commitHistoryCheckpoint(checkpoint, label);
      void get().autosaveProject();
    } catch (error) {
      set({ status: 'error', error: engineError(error) });
    }
  }

  return {
    creaseColorMode: DEFAULT_CREASE_COLOR_MODE,
    oristudioCpSelection: emptyOristudioCpSelection(),
    oristudioCpActionRequest: null,
    oristudioCpActiveDiagnosticId: null,
    oristudioCpViewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
    oristudioCpSymmetry: defaultOristudioCpSymmetry(),
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
            oristudioCpSymmetry: defaultOristudioCpSymmetry(),
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
          activeEditingSurface: 'crease-pattern',
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
        void get().autosaveProject();
        useLayoutStore.getState().activatePanel('crease-pattern');
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
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

    setSequenceSimulationFocus: (sequenceSimulationFocus) => set({ sequenceSimulationFocus }),

    setOristudioCpViewportOption: (key, value) =>
      set({ oristudioCpViewport: { ...get().oristudioCpViewport, [key]: value } }),

    setOristudioCpSymmetry: (update) =>
      set({
        oristudioCpSymmetry: {
          ...get().oristudioCpSymmetry,
          ...update,
          axis: update.axis
            ? { ...update.axis, loc: { ...update.axis.loc } }
            : get().oristudioCpSymmetry.axis,
        },
        dirty: get().oristudioCpDocument ? true : get().dirty,
      }),

    setOristudioCpSelection: (oristudioCpSelection) => set({ oristudioCpSelection }),

    requestOristudioCpAction: (operationId) => {
      const previousId = get().oristudioCpActionRequest?.id ?? 0;
      set({ oristudioCpActionRequest: { id: previousId + 1, operationId } });
    },

    clearOristudioCpActionRequest: (id) =>
      set({
        oristudioCpActionRequest:
          get().oristudioCpActionRequest?.id === id ? null : get().oristudioCpActionRequest,
      }),

    setOristudioCpActiveDiagnostic: (oristudioCpActiveDiagnosticId) =>
      set({ oristudioCpActiveDiagnosticId }),

    clearOristudioCpSelection: () =>
      set({ oristudioCpSelection: emptyOristudioCpSelection() }),

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

    toggleOristudioCpVertexSelection: (id, additive = false) =>
      set({
        oristudioCpSelection: additive
          ? {
              ...get().oristudioCpSelection,
              vertices: toggleCpSelectionList(get().oristudioCpSelection.vertices ?? [], id),
            }
          : { ...emptyOristudioCpSelection(), vertices: [id] },
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
  };
};
