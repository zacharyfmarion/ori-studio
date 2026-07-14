import { getExampleProject } from '../../../examples/catalog';
import { APP_VERSION } from '../../../constants/release';
import {
  serializeCreasePatternSvg,
  renderCreasePatternPng,
  type CreaseExportFormat,
  type CreaseExportOptions,
} from '../../../lib/creaseExport';
import {
  importedCreasePatternFormat,
  isCreasePatternFilename,
  parseImportedCreasePattern,
  type ImportedCreasePatternResult,
  type ImportedCreasePatternSource,
} from '../../../lib/creasePatternImport';
import {
  clampOrieditaGridAngle,
  DEFAULT_ORISTUDIO_CP_LINE_STYLE,
  DEFAULT_ORISTUDIO_CP_LINE_WIDTH,
  DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
  emptyOristudioCpSelection,
  getCpVertices,
  isValidOrieditaGridScale,
  normalizeOrieditaGridSize,
  normalizeOrieditaIntervalGridSize,
  ORIEDITA_GRID_SCALE_DEFAULTS,
} from '../../../lib/creasePatternViewport';
import {
  blankCpLineage,
  importedCpLineage,
  markCpLineageEdited,
} from '../../../lib/oristudioCpLineage';
import { normalizeOristudioCpCommandPayload } from '../../../lib/oristudioCpCommandPayloads';
import {
  activeNativeDocument,
  createNativeBoxPleatProjectFile,
  createNativeCreasePatternProjectFile,
  createNativeTreeProjectFile,
  isNativeProjectFilename,
  NATIVE_PROJECT_EXTENSION,
  parseNativeProjectFile,
  serializeNativeProjectFile,
} from '../../../lib/nativeProjectFile';
import {
  exportOristudioBpProjectAsBps,
  isBpProjectFilename,
} from '../oristudioBpRuntime';
import type {
  OristudioCpSelection,
  OristudioCpViewportOptions,
} from '../../../lib/creasePatternViewport';
import {
  segmentFoldDocument,
  type CpSegment,
} from '../../../lib/creasePatternSegmentation';
import type { OristudioCpOperationId } from '../../../lib/oristudioCpCommands';
import { createEmptyProject, DEFAULT_CREASE_COLOR_MODE } from '../../../lib/sampleProject';
import { type WorkspaceCapabilityId } from '../../../lib/workspaceCapabilities';
import { selectWorkspaceCapabilities } from '../capabilities';
import { ensureExtension, getFileService, type FileService } from '../../../platform/fileService';
import { requestConfirmation, requestCreasePatternExportOptions } from '../../commandDialogStore';
import { useLayoutStore } from '../../layoutStore';
import {
  emptyFoldArtifactResourceState,
  readyFoldArtifactResourceState,
  staleFoldArtifactResourceState,
} from '../foldArtifactResource';
import {
  createBlankTree,
  createStarterTree,
  engineError,
  ensureTreeHandle,
  getEngine,
  initializeBlankTree,
  loadTreeFromText,
  projectStateFromSnapshot,
  statusFromSnapshot,
} from '../engineRuntime';
import {
  executeOristudioCpCommand as executeRuntimeOristudioCpCommand,
  exportOristudioCpDocumentAsCp,
  exportOristudioCpDocumentAsFold,
  exportOristudioCpDocumentAsOri,
  exportOristudioCpDocumentAsOrh,
  createBlankOristudioCpDocument,
  getOristudioCpOperationDescriptors,
  loadOristudioCpDocumentFromText,
  importAddOristudioCpDocumentFromText,
  insertOristudioCpLineSegments as insertRuntimeOristudioCpLineSegments,
  oristudioCpError,
  previewOristudioCpCommand as previewRuntimeOristudioCpCommand,
  releaseOristudioCpDocument,
  replaceOristudioCpLineSegments as replaceRuntimeOristudioCpLineSegments,
  restoreOristudioCpDocument,
  restoreOristudioCpDocumentInPlace,
  setOristudioCpDocumentSource,
} from '../oristudioCpRuntime';
import type { ProjectSlice, WorkspaceSliceCreator } from '../types';
import type { FoldDocument } from '../../../engine/types';
import type {
  OristudioCpCommandResult,
  OristudioCpDocumentSnapshot,
  OristudioCpDocumentState,
  OristudioCpFoldedFigureEntry,
  OristudioCpGridMetadata,
} from '../../../engine/oristudioCpTypes';

function nowIso(): string {
  return new Date().toISOString();
}

function cpHistoryEntry(
  document: Awaited<ReturnType<typeof loadOristudioCpDocumentFromText>>['document'],
  label: string,
  selection: OristudioCpSelection
) {
  return {
    document,
    selection,
    label,
    timestamp: nowIso(),
  };
}

function staleGeneratedFoldedFigures(
  entries: OristudioCpFoldedFigureEntry[]
): OristudioCpFoldedFigureEntry[] {
  return entries.map((entry) =>
    entry.sourceKind === 'generated-from-current-cp' && entry.status === 'ready'
      ? { ...entry, status: 'stale' as const }
      : entry
  );
}

function importedSourceFromNativeSource(
  source: { format: string; filename: string; path: string | null } | null | undefined
): ImportedCreasePatternSource | null {
  if (
    !source ||
    (source.format !== 'cp' &&
      source.format !== 'fold' &&
      source.format !== 'ori' &&
      source.format !== 'orh')
  ) {
    return null;
  }
  return {
    format: source.format,
    filename: source.filename,
    path: source.path,
  };
}

async function refreshAlwaysOnCamvDiagnostics(
  documentState: OristudioCpDocumentState
): Promise<{
  documentState: OristudioCpDocumentState;
  camvResult: OristudioCpCommandResult | null;
}> {
  try {
    const checkedDocument = await executeRuntimeOristudioCpCommand('CheckCamv');
    return {
      documentState: {
        ...checkedDocument,
        lastCommandResult: documentState.lastCommandResult,
      },
      camvResult:
        checkedDocument.lastCommandResult?.operation === 'CheckCamv'
          ? checkedDocument.lastCommandResult
          : null,
    };
  } catch {
    return { documentState, camvResult: null };
  }
}

const CLEAR_CP_SELECTION_AFTER_OPERATIONS = new Set<OristudioCpOperationId>([
  'LineSegmentDelete',
  'CreaseMakeAux',
  'CreaseMove',
  'CreaseCopy',
  'CreaseMove4p',
  'CreaseCopy4p',
  'CreaseDeleteOverlapping',
  'CreaseDeleteIntersecting',
  'DeletePoint',
  'FixInaccurate',
  'ReplaceLineTypeSelect',
  'DeleteLineTypeSelect',
  'VertexDeleteOnCrease',
]);

const SYNC_CP_LINE_SELECTION_AFTER_OPERATIONS = new Set<OristudioCpOperationId>([
  'CreaseSelect',
  'CreaseUnselect',
  'SelectPolygon',
  'UnselectPolygon',
  'SelectLineIntersecting',
  'UnselectLineIntersecting',
  'SelectLasso',
  'UnselectLasso',
]);

const NON_MUTATING_CP_OPERATIONS = new Set<OristudioCpOperationId>([
  'Check1',
  'Check2',
  'Check3',
  'Check4',
  'CheckCamv',
  'FlatFoldableCheck',
]);

function oristudioCpSelectionAfterCommand(
  operationId: OristudioCpOperationId,
  selection: OristudioCpSelection,
  document: OristudioCpDocumentSnapshot
): OristudioCpSelection {
  if (CLEAR_CP_SELECTION_AFTER_OPERATIONS.has(operationId)) {
    return emptyOristudioCpSelection();
  }

  if (SYNC_CP_LINE_SELECTION_AFTER_OPERATIONS.has(operationId)) {
    return {
      ...emptyOristudioCpSelection(),
      lines: document.crease_pattern.line_segments
        .map((line, index) => (line.selected === 0 ? null : index + 1))
        .filter((id): id is number => id !== null),
    };
  }

  const vertexIds = new Set(getCpVertices(document).map((vertex) => vertex.id));

  return {
    lines: selection.lines.filter((id) => id >= 1 && id <= document.crease_pattern.line_segments.length),
    vertices: (selection.vertices ?? []).filter((id) => vertexIds.has(id)),
    points: selection.points.filter((id) => id >= 1 && id <= document.crease_pattern.points.length),
    circles: selection.circles.filter((id) => id >= 1 && id <= document.crease_pattern.circles.length),
    texts: selection.texts.filter((id) => id >= 1 && id <= document.crease_pattern.texts.length),
    faces: selection.faces,
  };
}

// Applies a partial grid-metadata patch with the same validation Oriedita's
// GridMetadata setters enforce: size/interval floors, angle clamp, and the
// axis-scale validity check that resets an axis to `1 + 0*sqrt(1)` when the
// resolved length is degenerate. Grid X and grid Y are each validated as a
// group so an invalid trio resets that axis rather than partially applying.
function normalizeOristudioCpGridPatch(
  grid: OristudioCpGridMetadata,
  patch: Partial<OristudioCpGridMetadata>
): OristudioCpGridMetadata {
  const merged: OristudioCpGridMetadata = { ...grid, ...patch };

  const next: OristudioCpGridMetadata = {
    ...merged,
    grid_size: normalizeOrieditaGridSize(merged.grid_size),
    interval_grid_size: normalizeOrieditaIntervalGridSize(merged.interval_grid_size),
    grid_angle: clampOrieditaGridAngle(merged.grid_angle),
  };

  if (!isValidOrieditaGridScale(next.grid_xa, next.grid_xb, next.grid_xc)) {
    next.grid_xa = ORIEDITA_GRID_SCALE_DEFAULTS.a;
    next.grid_xb = ORIEDITA_GRID_SCALE_DEFAULTS.b;
    next.grid_xc = ORIEDITA_GRID_SCALE_DEFAULTS.c;
  }
  if (!isValidOrieditaGridScale(next.grid_ya, next.grid_yb, next.grid_yc)) {
    next.grid_ya = ORIEDITA_GRID_SCALE_DEFAULTS.a;
    next.grid_yb = ORIEDITA_GRID_SCALE_DEFAULTS.b;
    next.grid_yc = ORIEDITA_GRID_SCALE_DEFAULTS.c;
  }

  return next;
}

function oristudioCpGridEquals(
  a: OristudioCpGridMetadata,
  b: OristudioCpGridMetadata
): boolean {
  return (
    a.grid_size === b.grid_size &&
    a.interval_grid_size === b.interval_grid_size &&
    a.grid_xa === b.grid_xa &&
    a.grid_xb === b.grid_xb &&
    a.grid_xc === b.grid_xc &&
    a.grid_ya === b.grid_ya &&
    a.grid_yb === b.grid_yb &&
    a.grid_yc === b.grid_yc &&
    a.grid_angle === b.grid_angle &&
    a.base_state === b.base_state &&
    a.vertical_scale_position === b.vertical_scale_position &&
    a.horizontal_scale_position === b.horizontal_scale_position &&
    a.draw_diagonal_gridlines === b.draw_diagonal_gridlines
  );
}

function selectedLineSelectionFromDocument(
  document: OristudioCpDocumentSnapshot
): OristudioCpSelection {
  return {
    ...emptyOristudioCpSelection(),
    lines: document.crease_pattern.line_segments
      .map((line, index) => (line.selected === 0 ? null : index + 1))
      .filter((id): id is number => id !== null),
  };
}

function basenameWithoutProjectExtension(filename: string): string {
  return filename.replace(/\.(osf|tmd5?|tmd4|cp|fold|ori|orh)$/i, '') || 'Untitled';
}

function isOrieditaOriFilename(filename: string): boolean {
  return /\.ori$/i.test(filename);
}

function isOrieditaOrhFilename(filename: string): boolean {
  return /\.orh$/i.test(filename);
}

function defaultFilename(title: string, extension: string): string {
  const base = title.trim() || 'Untitled';
  const safe = base.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'Untitled';
  return ensureExtension(safe, extension);
}

function defaultNativeFilename(title: string): string {
  return defaultFilename(title, NATIVE_PROJECT_EXTENSION);
}

async function confirmDiscardDirty(dirty: boolean): Promise<boolean> {
  if (!dirty) return true;
  return requestConfirmation({
    title: 'Discard unsaved changes?',
    message: 'Your current project has unsaved changes. Continue and discard them?',
    confirmLabel: 'Discard',
    tone: 'danger',
  });
}

function defaultCreaseExportOptions(viewport: OristudioCpViewportOptions): CreaseExportOptions {
  return {
    segmentId: null,
    lineStyle: viewport.lineStyle ?? DEFAULT_ORISTUDIO_CP_LINE_STYLE,
    lineWidth: viewport.lineWidth ?? DEFAULT_ORISTUDIO_CP_LINE_WIDTH,
    // Points off by default for exports.
    pointSize: 0,
    includeUnassigned: true,
    showBackgroundColor: true,
  };
}

export const createProjectSlice: WorkspaceSliceCreator<ProjectSlice> = (set, get) => {
  // Reuse the single capability input builder (which is context/BP-aware) rather
  // than a divergent inline copy.
  const capabilities = () => selectWorkspaceCapabilities(get());

  const rejectDisabled = (id: WorkspaceCapabilityId) => {
    const capability = capabilities()[id];
    if (capability.enabled) return false;
    set({
      error: { code: 'invalid_operation', message: capability.reason },
      projectMessage: null,
    });
    return true;
  };

  const releaseEditableCreasePattern = async () => {
    await get().clearOristudioCpFoldedFigures();
    await releaseOristudioCpDocument();
  };

  const resolveCreaseExport = async (
    format: CreaseExportFormat,
    options?: CreaseExportOptions
  ): Promise<{ options: CreaseExportOptions; fold: FoldDocument; segments: CpSegment[] } | null> => {
    const foldArtifacts = get().foldArtifacts ?? (await get().ensureFoldArtifacts());
    if (!foldArtifacts) return null;
    // Export the real (untriangulated) crease pattern, not the simulation mesh
    // (simulation_model.fold is triangulated, which adds spurious diagonals).
    const fold = foldArtifacts.fold;
    const segments = segmentFoldDocument(fold);
    if (options) return { options, fold, segments };
    const label = format.toUpperCase();
    const resolved = await requestCreasePatternExportOptions({
      title: `Export ${label}`,
      format,
      fold,
      segments,
      initialOptions: defaultCreaseExportOptions(get().oristudioCpViewport),
      confirmLabel: `Export ${label}`,
    });
    return resolved ? { options: resolved, fold, segments } : null;
  };

  const confirmLossyOrhWrite = () =>
    requestConfirmation({
      title: 'Export legacy ORH?',
      message:
        'ORH is a legacy Oriedita/Orihime format and cannot preserve Ori Studio workspace state, embedded FOLD frames, or all modern editor metadata.',
      confirmLabel: 'Export ORH',
      tone: 'danger',
    });

  const applyOristudioCpLineMutation = async (
    label: string,
    mutate: () => Promise<OristudioCpDocumentState>
  ): Promise<boolean> => {
    if (!get().oristudioCpDocument) {
      set({
        oristudioCpError: 'No editable crease-pattern document is loaded',
        error: {
          code: 'invalid_operation',
          message: 'No editable crease-pattern document is loaded',
        },
      });
      return false;
    }

    try {
      const previousDocument = get().oristudioCpDocument?.document ?? null;
      const previousSelection = get().oristudioCpSelection;
      const commandDocument = await mutate();
      const checked = await refreshAlwaysOnCamvDiagnostics(commandDocument);
      const nextDocument = checked.documentState;
      const nextRevision = get().oristudioCpRevision + 1;
      set({
        oristudioCpDocument: nextDocument,
        oristudioCpCamvResult: checked.camvResult,
        oristudioCpOperationDescriptors: nextDocument.operationDescriptors,
        oristudioCpError: null,
        oristudioCpActiveDiagnosticId: null,
        oristudioCpSelection: selectedLineSelectionFromDocument(nextDocument.document),
        oristudioCpRevision: nextRevision,
        oristudioCpFoldedFigures: staleGeneratedFoldedFigures(get().oristudioCpFoldedFigures),
        oristudioCpHistoryPast: previousDocument
          ? [
              ...get().oristudioCpHistoryPast,
              cpHistoryEntry(previousDocument, label, previousSelection),
            ]
          : get().oristudioCpHistoryPast,
        oristudioCpHistoryFuture: [],
        ...staleFoldArtifactResourceState(get().foldArtifactRevision),
        error: null,
        dirty: true,
        projectMessage: label,
      });
      return true;
    } catch (error) {
      const normalized = oristudioCpError(error);
      set({
        oristudioCpError: normalized.message,
        error: normalized,
      });
      return false;
    }
  };

  const loadText = async (
    text: string,
    source: {
      title?: string;
      filename?: string;
      path?: string | null;
      dirty?: boolean;
    } = {}
  ) => {
    set({ status: 'loading_engine', error: null, projectMessage: null });
    await releaseEditableCreasePattern();
    const api = await getEngine();
    const snapshot = await loadTreeFromText(api, text);
    const filename = source.filename ?? defaultNativeFilename('Untitled');
    const title = source.title ?? basenameWithoutProjectExtension(filename);
    set({
      ...projectStateFromSnapshot(snapshot, title),
      importedCreasePattern: null,
      oristudioCpDocument: null,
      oristudioCpLineage: null,
      oristudioCpError: null,
      oristudioCpCamvResult: null,
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
      projectLoadId: get().projectLoadId + 1,
      currentFileName: filename,
      currentFilePath: source.path ?? null,
      projectMessage: `Loaded ${filename}`,
      selection: { kind: 'tree' },
      oristudioCpSelection: emptyOristudioCpSelection(),
      oristudioCpActiveDiagnosticId: null,
      oristudioCpRevision: 0,
      oristudioCpFoldedFigures: [],
      oristudioCpActiveFoldedFigureId: null,
      toolMode: 'select',
      symmetryAuthoringPairs: [],
      creaseColorMode: DEFAULT_CREASE_COLOR_MODE,
      ...emptyFoldArtifactResourceState(),
      status: statusFromSnapshot(snapshot),
      dirty: source.dirty ?? false,
      lastOptimization: null,
      historyPast: [],
      historyFuture: [],
      clipboardPasteCount: 0,
    });
    useLayoutStore.getState().activateWorkspace('design');
  };

  const loadCreasePattern = async (
    text: string,
    source: { filename: string; path?: string | null }
  ) => {
    set({
      status: 'loading_engine',
      error: null,
      projectMessage: null,
      oristudioCpCamvResult: null,
    });
    const filename = source.filename;
    const path = source.path ?? null;
    const format = importedCreasePatternFormat(filename);
    await releaseEditableCreasePattern();
    let parsed: ImportedCreasePatternResult;
    let oristudioCpDocument: Awaited<
      ReturnType<typeof loadOristudioCpDocumentFromText>
    > | null = null;
    let oristudioCpCamvResult: OristudioCpCommandResult | null = null;
    let oristudioCpRuntimeError: string | null = null;

    if (format === 'ori' || format === 'orh') {
      try {
        oristudioCpDocument = await loadOristudioCpDocumentFromText(text, {
          format,
          filename,
          path,
        });
        const checked = await refreshAlwaysOnCamvDiagnostics(oristudioCpDocument);
        oristudioCpDocument = checked.documentState;
        oristudioCpCamvResult = checked.camvResult;
        const foldProjection = await exportOristudioCpDocumentAsFold();
        const projectionTitle =
          oristudioCpDocument.summary.title || basenameWithoutProjectExtension(filename);
        const projected = parseImportedCreasePattern(foldProjection, {
          format: 'fold',
          filename: defaultFilename(projectionTitle, 'fold'),
          path: null,
        });
        parsed = {
          ...projected,
          project: {
            ...projected.project,
            title: projectionTitle,
          },
          document: {
            ...projected.document,
            source: { format, filename, path },
            title: projectionTitle,
          },
        };
      } catch (error) {
        await releaseEditableCreasePattern();
        throw error;
      }
    } else {
      parsed = parseImportedCreasePattern(text, {
        format,
        filename,
        path,
      });
      try {
        oristudioCpDocument = await loadOristudioCpDocumentFromText(text, {
          format,
          filename,
          path,
          title: parsed.document.title,
        });
        const checked = await refreshAlwaysOnCamvDiagnostics(oristudioCpDocument);
        oristudioCpDocument = checked.documentState;
        oristudioCpCamvResult = checked.camvResult;
      } catch (error) {
        oristudioCpRuntimeError = oristudioCpError(error).message;
      }
    }
    // Simulation faces are inferred in JS by parseImportedCreasePattern (no
    // flat-folding), so imports with multiple crease patterns work.
    const result = parsed;
    const artifactRevision = get().foldArtifactRevision + 1;
    const artifactState = readyFoldArtifactResourceState(result.foldArtifacts, artifactRevision);
    set({
      // Loading a document makes its editor the active view, so the derived
      // editing context matches the document without waiting for Dockview to
      // report the activated panel (which never fires in headless tests).
      activePanelId: oristudioCpDocument ? 'crease-pattern' : 'design',
      // A bare crease pattern establishes no design, so the Design workspace
      // should still offer the method chooser rather than an empty tree.
      pendingDesignChoice: true,
      project: result.project,
      importedCreasePattern: result.document,
      oristudioCpDocument,
      oristudioCpLineage: importedCpLineage(),
      oristudioCpCamvResult,
      oristudioCpOperationDescriptors: oristudioCpDocument
        ? oristudioCpDocument.operationDescriptors
        : get().oristudioCpOperationDescriptors,
      oristudioCpError: oristudioCpRuntimeError,
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
      projectLoadId: get().projectLoadId + 1,
      currentFileName: filename,
      currentFilePath: source.path ?? null,
      projectMessage: `Loaded ${filename}`,
      selection: { kind: 'tree' },
      oristudioCpSelection: emptyOristudioCpSelection(),
      oristudioCpActiveDiagnosticId: null,
      oristudioCpRevision: 0,
      oristudioCpFoldedFigures: [],
      oristudioCpActiveFoldedFigureId: null,
      toolMode: 'select',
      creaseColorMode: DEFAULT_CREASE_COLOR_MODE,
      ...artifactState,
      sequenceTarget: null,
      sequencePlan: null,
      sequenceSimulationFocus: { kind: 'whole' },
      sequencePlanning: false,
      sequenceError: null,
      status: 'crease_pattern_ready',
      dirty: false,
      error: null,
      engineReady: true,
      lastOptimization: null,
      historyPast: [],
      historyFuture: [],
      clipboardPasteCount: 0,
    });
    useLayoutStore.getState().activateWorkspace('edit');
  };

  const parseFoldProjection = (text: string): FoldDocument | null => {
    try {
      return JSON.parse(text) as FoldDocument;
    } catch {
      return null;
    }
  };

  const exportedEditableFoldProjection = async (): Promise<FoldDocument | null> => {
    try {
      return parseFoldProjection(await exportOristudioCpDocumentAsFold());
    } catch {
      return null;
    }
  };

  const sourceFoldWithCurrentProjection = (
    sourceFold: FoldDocument | null | undefined,
    foldProjection: FoldDocument | null
  ): FoldDocument | null => {
    if (!sourceFold) return null;
    if (!foldProjection) return sourceFold;
    return {
      ...sourceFold,
      ...foldProjection,
      file_title: sourceFold.file_title ?? foldProjection.file_title,
      file_frames: sourceFold.file_frames ?? [],
    };
  };

  const loadNativeCreasePattern = async (
    nativeDocument: Extract<ReturnType<typeof activeNativeDocument>, { kind: 'crease-pattern' }>,
    source: { filename: string; path?: string | null }
  ) => {
    set({
      status: 'loading_engine',
      error: null,
      projectMessage: null,
      oristudioCpCamvResult: null,
    });
    const nativeSource = {
      format: 'osf' as const,
      filename: source.filename,
      path: source.path ?? null,
    };
    const restoredDocument = await restoreOristudioCpDocument(
      nativeDocument.creasePattern.document,
      nativeSource
    );
    const checked = await refreshAlwaysOnCamvDiagnostics(restoredDocument);
    const documentState = checked.documentState;
    const fold =
      nativeDocument.creasePattern.sourceFold ??
      nativeDocument.creasePattern.foldProjection ??
      (await exportedEditableFoldProjection());
    if (!fold) throw new Error('Native crease-pattern project does not contain a FOLD projection');

    const parsed = parseImportedCreasePattern(JSON.stringify(fold), {
      format: 'fold',
      filename: `${nativeDocument.title || source.filename}.fold`,
      path: null,
    });
    // Simulation faces are inferred in JS (no flat-folding), so multi-pattern
    // documents work.
    const result = parsed;
    const artifactRevision = get().foldArtifactRevision + 1;
    const artifactState = readyFoldArtifactResourceState(result.foldArtifacts, artifactRevision);
    const originalSource = importedSourceFromNativeSource(nativeDocument.creasePattern.source);
    const importedDocument = originalSource
      ? { ...result.document, source: originalSource }
      : result.document;
    set({
      // Opening a crease pattern makes the CP editor the active view.
      activePanelId: 'crease-pattern',
      // A CP-only project establishes no design; keep the Design chooser.
      pendingDesignChoice: true,
      project: { ...result.project, title: nativeDocument.title || result.project.title },
      importedCreasePattern: importedDocument,
      oristudioCpDocument: documentState,
      oristudioCpLineage: nativeDocument.creasePattern.lineage,
      oristudioCpCamvResult: checked.camvResult,
      oristudioCpOperationDescriptors: documentState.operationDescriptors,
      oristudioCpError: null,
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
      projectLoadId: get().projectLoadId + 1,
      currentFileName: source.filename,
      currentFilePath: source.path ?? null,
      projectMessage: `Loaded ${source.filename}`,
      selection: { kind: 'tree' },
      oristudioCpSelection: nativeDocument.viewState.selection ?? emptyOristudioCpSelection(),
      oristudioCpActiveDiagnosticId: null,
      oristudioCpRevision: 0,
      oristudioCpFoldedFigures: nativeDocument.viewState.foldedFigures ?? [],
      oristudioCpActiveFoldedFigureId: nativeDocument.viewState.activeFoldedFigureId ?? null,
      toolMode: 'select',
      creaseColorMode: nativeDocument.viewState.creaseColorMode ?? DEFAULT_CREASE_COLOR_MODE,
      oristudioCpViewport: {
        ...DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
        ...nativeDocument.viewState.viewport,
      },
      ...artifactState,
      sequenceTarget: null,
      sequencePlan: null,
      sequenceSimulationFocus: { kind: 'whole' },
      sequencePlanning: false,
      sequenceError: null,
      status: 'crease_pattern_ready',
      dirty: false,
      error: null,
      engineReady: true,
      lastOptimization: null,
      historyPast: [],
      historyFuture: [],
      clipboardPasteCount: 0,
    });
    useLayoutStore.getState().activateWorkspace('edit');
  };

  const restoreNativeCreasePatternCompanion = async (
    nativeDocument: Extract<ReturnType<typeof activeNativeDocument>, { kind: 'crease-pattern' }>,
    source: { filename: string; path?: string | null }
  ) => {
    const nativeSource = {
      format: 'osf' as const,
      filename: source.filename,
      path: source.path ?? null,
    };
    const restoredDocument = await restoreOristudioCpDocument(
      nativeDocument.creasePattern.document,
      nativeSource
    );
    const checked = await refreshAlwaysOnCamvDiagnostics(restoredDocument);
    set({
      oristudioCpDocument: checked.documentState,
      oristudioCpLineage: nativeDocument.creasePattern.lineage,
      oristudioCpCamvResult: checked.camvResult,
      oristudioCpOperationDescriptors: checked.documentState.operationDescriptors,
      oristudioCpError: null,
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
      oristudioCpSelection: nativeDocument.viewState.selection ?? emptyOristudioCpSelection(),
      oristudioCpActiveDiagnosticId: null,
      oristudioCpRevision: 0,
      oristudioCpFoldedFigures: nativeDocument.viewState.foldedFigures ?? [],
      oristudioCpActiveFoldedFigureId: nativeDocument.viewState.activeFoldedFigureId ?? null,
    });
  };

  const loadNativeProject = async (
    text: string,
    source: { filename: string; path?: string | null }
  ) => {
    const nativeProject = parseNativeProjectFile(text);
    const nativeDocument = activeNativeDocument(nativeProject);
    if (nativeDocument.kind === 'treemaker-tree') {
      await loadText(nativeDocument.tree.text, {
        title: nativeDocument.title || nativeProject.workspace.title,
        filename: source.filename,
        path: source.path ?? null,
      });
      const companion = nativeProject.workspace.documents.find(
        (document) => document.kind === 'crease-pattern'
      );
      if (companion?.kind === 'crease-pattern') {
        await restoreNativeCreasePatternCompanion(companion, source);
      }
      return;
    }
    if (nativeDocument.kind === 'box-pleat') {
      const loaded = await get().loadOristudioBpProjectFromFile(nativeDocument.project.text, {
        filename: source.filename,
        path: source.path ?? null,
      });
      // Loading the BP design clears the Edit canvas; restore the saved CP
      // companion (if any) so the Send-to-Edit result comes back too.
      if (loaded) {
        const companion = nativeProject.workspace.documents.find(
          (document) => document.kind === 'crease-pattern'
        );
        if (companion?.kind === 'crease-pattern') {
          await restoreNativeCreasePatternCompanion(companion, source);
        }
      }
      return;
    }
    await loadNativeCreasePattern(nativeDocument, source);
  };

  const currentTreeTmd5Text = async () => {
    const { api, treeHandle, initializedSnapshot } = await ensureTreeHandle();
    if (initializedSnapshot) {
      set(projectStateFromSnapshot(initializedSnapshot, get().project.title));
    }
    return api.saveTmd5(treeHandle);
  };

  const nativeSaveTarget = () => {
    const canOverwriteNative = isNativeProjectFilename(get().currentFileName);
    const suggestedName = canOverwriteNative
      ? get().currentFileName
      : defaultNativeFilename(get().project.title);
    return {
      suggestedName,
      path: canOverwriteNative ? get().currentFilePath : null,
    };
  };

  const saveNativeTreeProject = async (fileService: FileService, forceSaveAs: boolean) => {
    const tmd5Text = await currentTreeTmd5Text();
    const creasePatternCompanion = get().oristudioCpDocument
      ? await currentEditableCreasePatternProjectInput(get().currentFileName, get().currentFilePath)
      : null;
    const contents = serializeNativeProjectFile(
      createNativeTreeProjectFile({
        title: get().project.title,
        filename: get().currentFileName,
        path: get().currentFilePath,
        tmd5Text,
        creasePatternCompanion,
        appVersion: APP_VERSION,
      })
    );
    const target = nativeSaveTarget();
    const result = await fileService.saveTextFile({
      title: forceSaveAs ? 'Save Ori Studio Project As' : 'Save Ori Studio Project',
      contents,
      suggestedName: target.suggestedName,
      path: forceSaveAs ? null : target.path,
      extensions: [NATIVE_PROJECT_EXTENSION],
    });
    if (!result) return false;
    set({
      currentFileName: result.name,
      currentFilePath: result.path,
      dirty: false,
      projectMessage: `Saved ${result.name}`,
    });
    return true;
  };

  const saveNativeBoxPleatProject = async (fileService: FileService, forceSaveAs: boolean) => {
    const bps = await exportOristudioBpProjectAsBps();
    const creasePatternCompanion = get().oristudioCpDocument
      ? await currentEditableCreasePatternProjectInput(get().currentFileName, get().currentFilePath)
      : null;
    const contents = serializeNativeProjectFile(
      createNativeBoxPleatProjectFile({
        title: get().oristudioBpDocument?.snapshot?.summary?.title || get().project.title,
        filename: get().currentFileName,
        path: get().currentFilePath,
        bps,
        creasePatternCompanion,
        appVersion: APP_VERSION,
      })
    );
    const target = nativeSaveTarget();
    const result = await fileService.saveTextFile({
      title: forceSaveAs ? 'Save Ori Studio Project As' : 'Save Ori Studio Project',
      contents,
      suggestedName: target.suggestedName,
      path: forceSaveAs ? null : target.path,
      extensions: [NATIVE_PROJECT_EXTENSION],
    });
    if (!result) return false;
    const document = get().oristudioBpDocument;
    set({
      currentFileName: result.name,
      currentFilePath: result.path,
      dirty: false,
      projectMessage: `Saved ${result.name}`,
      ...(document
        ? {
            oristudioBpDocument: {
              ...document,
              dirty: false,
              source: { ...document.source, filename: result.name, path: result.path },
            },
          }
        : {}),
    });
    return true;
  };

  const currentEditableCreasePatternProjectInput = async (
    filename: string,
    path: string | null
  ) => {
    const documentState = get().oristudioCpDocument;
    if (!documentState) return null;
    const foldProjection = await exportedEditableFoldProjection();
    const sourceFold = sourceFoldWithCurrentProjection(
      get().importedCreasePattern?.sourceFold,
      foldProjection
    );
    return {
      title:
        documentState.summary.title ||
        get().importedCreasePattern?.title ||
        get().project.title,
      filename,
      path,
      document: documentState.document,
      source: get().importedCreasePattern?.source ?? documentState.source,
      foldProjection,
      sourceFold,
      foldArtifacts: get().foldArtifacts,
      creaseColorMode: get().creaseColorMode,
      selection: get().oristudioCpSelection,
      viewport: get().oristudioCpViewport,
      foldedFigures: get().oristudioCpFoldedFigures,
      activeFoldedFigureId: get().oristudioCpActiveFoldedFigureId,
      lineage: get().oristudioCpLineage ?? importedCpLineage(),
      appVersion: APP_VERSION,
    };
  };

  const saveEditableCreasePatternAsOri = async (fileService: FileService) => {
    const documentState = get().oristudioCpDocument;
    if (!documentState) return false;
    const contents = await exportOristudioCpDocumentAsOri();
    const importedCreasePattern = get().importedCreasePattern;
    const result = await fileService.saveTextFile({
      title: 'Save Oriedita ORI Document',
      contents,
      suggestedName: ensureExtension(get().currentFileName, 'ori'),
      path: get().currentFilePath,
      extensions: ['ori'],
    });
    if (!result) return false;

    const source = {
      format: 'ori' as const,
      filename: result.name,
      path: result.path,
    };
    setOristudioCpDocumentSource(source);
    set({
      currentFileName: result.name,
      currentFilePath: result.path,
      dirty: false,
      projectMessage: `Saved ${result.name}`,
      importedCreasePattern: importedCreasePattern
        ? {
            ...importedCreasePattern,
            source,
          }
        : null,
      oristudioCpDocument: {
        ...documentState,
        source,
      },
    });
    return true;
  };

  const saveEditableCreasePatternAsOrh = async (fileService: FileService) => {
    const documentState = get().oristudioCpDocument;
    if (!documentState) return false;
    if (!(await confirmLossyOrhWrite())) return false;
    const contents = await exportOristudioCpDocumentAsOrh();
    const importedCreasePattern = get().importedCreasePattern;
    const result = await fileService.saveTextFile({
      title: 'Save Oriedita ORH Document',
      contents,
      suggestedName: ensureExtension(get().currentFileName, 'orh'),
      path: get().currentFilePath,
      extensions: ['orh'],
    });
    if (!result) return false;

    const source = {
      format: 'orh' as const,
      filename: result.name,
      path: result.path,
    };
    setOristudioCpDocumentSource(source);
    set({
      currentFileName: result.name,
      currentFilePath: result.path,
      dirty: false,
      projectMessage: `Saved ${result.name}`,
      importedCreasePattern: importedCreasePattern
        ? {
            ...importedCreasePattern,
            source,
          }
        : null,
      oristudioCpDocument: {
        ...documentState,
        source,
      },
    });
    return true;
  };

  const saveEditableCreasePattern = async (
    fileService: FileService,
    forceSaveAs: boolean
  ) => {
    const documentState = get().oristudioCpDocument;
    if (!documentState) {
      set({
        error: {
          code: 'invalid_operation',
          message: 'No editable crease-pattern document is loaded',
        },
        projectMessage: null,
      });
      return false;
    }
    if (!forceSaveAs && isOrieditaOriFilename(get().currentFileName)) {
      return saveEditableCreasePatternAsOri(fileService);
    }
    if (!forceSaveAs && isOrieditaOrhFilename(get().currentFileName)) {
      return saveEditableCreasePatternAsOrh(fileService);
    }

    const input = await currentEditableCreasePatternProjectInput(
      get().currentFileName,
      get().currentFilePath
    );
    if (!input) return false;
    const contents = serializeNativeProjectFile(
      createNativeCreasePatternProjectFile(input)
    );
    const target = nativeSaveTarget();
    const result = await fileService.saveTextFile({
      title: forceSaveAs ? 'Save Ori Studio Project As' : 'Save Ori Studio Project',
      contents,
      suggestedName: target.suggestedName,
      path: forceSaveAs ? null : target.path,
      extensions: [NATIVE_PROJECT_EXTENSION],
    });
    if (!result) return false;

    const source = {
      format: 'osf' as const,
      filename: result.name,
      path: result.path,
    };
    setOristudioCpDocumentSource(source);
    set({
      currentFileName: result.name,
      currentFilePath: result.path,
      dirty: false,
      projectMessage: `Saved ${result.name}`,
      oristudioCpDocument: {
        ...documentState,
        source,
      },
    });
    return true;
  };

  // Route a native save/save-as by the documents that exist, NOT by the pane in
  // focus. The Edit crease-pattern canvas is always focusable, so keying off the
  // active view would drop the design whenever the user saved from Edit. A design
  // (box-pleat or TreeMaker tree) is always saved as a native `.osf` bundling its
  // Edit crease pattern as a companion; a bare crease pattern (no design) saves
  // as a CP project.
  const saveActiveProject = async (fileService: FileService, forceSaveAs: boolean) => {
    if (get().oristudioBpDocument) {
      return saveNativeBoxPleatProject(fileService, forceSaveAs);
    }
    if (get().project.nodes.length > 0) {
      return saveNativeTreeProject(fileService, forceSaveAs);
    }
    return saveEditableCreasePattern(fileService, forceSaveAs);
  };

  return {
    project: createEmptyProject(),
    workflowTarget: 'treemaker',
    pendingDesignChoice: false,
    activePanelId: null,
    activeEditingContext: 'treemaker-tree',
    importedCreasePattern: null,
    oristudioCpDocument: null,
    oristudioCpLineage: null,
    oristudioCpOperationDescriptors: [],
    oristudioCpError: null,
    oristudioCpCamvResult: null,
    oristudioCpHistoryPast: [],
    oristudioCpHistoryFuture: [],
    projectLoadId: 0,
    currentFilePath: null,
    currentFileName: defaultNativeFilename('Untitled'),
    projectMessage: null,
    status: 'loading_engine',
    dirty: false,
    engineReady: false,
    error: null,
    lastOptimization: null,
    designViewportFitRequestId: 0,
    ...emptyFoldArtifactResourceState(),

    initEngine: async () => {
      set({ status: 'loading_engine', error: null });
      try {
        const operationDescriptors = await getOristudioCpOperationDescriptors().catch(() => []);
        const api = await getEngine();
        const snapshot = await initializeBlankTree(api);
        if (get().importedCreasePattern) {
          set({ engineReady: true, oristudioCpOperationDescriptors: operationDescriptors });
          return;
        }
        await releaseEditableCreasePattern();
        set({
          ...projectStateFromSnapshot(snapshot, get().project.title),
          importedCreasePattern: null,
          oristudioCpDocument: null,
          oristudioCpLineage: null,
          oristudioCpOperationDescriptors: operationDescriptors,
          oristudioCpError: null,
          oristudioCpCamvResult: null,
          oristudioCpHistoryPast: [],
          oristudioCpHistoryFuture: [],
          projectLoadId: get().projectLoadId + 1,
          selection: { kind: 'tree' },
          oristudioCpSelection: emptyOristudioCpSelection(),
          oristudioCpActiveDiagnosticId: null,
          oristudioCpRevision: 0,
          oristudioCpFoldedFigures: [],
          oristudioCpActiveFoldedFigureId: null,
          symmetryAuthoringPairs: [],
          dirty: false,
          lastOptimization: null,
          ...emptyFoldArtifactResourceState(),
          historyPast: [],
          historyFuture: [],
        });
      } catch (error) {
        set({ status: 'error', error: engineError(error), engineReady: false });
      }
    },

    createNewProject: async () => {
      if (rejectDisabled('file.new')) return;
      if (!(await confirmDiscardDirty(get().dirty))) return;
      set({ status: 'loading_engine', error: null, projectMessage: null });
      try {
        await releaseEditableCreasePattern();
        const api = await getEngine();
        const snapshot = await createBlankTree(api);
        set({
          ...projectStateFromSnapshot(snapshot, 'Untitled'),
          activePanelId: 'design',
          workflowTarget: 'treemaker',
          pendingDesignChoice: false,
          oristudioBpDocument: null,
          oristudioBpWorkspace: null,
          importedCreasePattern: null,
          oristudioCpDocument: null,
          oristudioCpLineage: null,
          oristudioCpError: null,
          oristudioCpCamvResult: null,
          oristudioCpHistoryPast: [],
          oristudioCpHistoryFuture: [],
          projectLoadId: get().projectLoadId + 1,
          currentFileName: defaultNativeFilename('Untitled'),
          currentFilePath: null,
          projectMessage: null,
          selection: { kind: 'tree' },
          oristudioCpSelection: emptyOristudioCpSelection(),
          oristudioCpActiveDiagnosticId: null,
          oristudioCpRevision: 0,
          oristudioCpFoldedFigures: [],
          oristudioCpActiveFoldedFigureId: null,
          toolMode: 'select',
          symmetryAuthoringPairs: [],
          creaseColorMode: DEFAULT_CREASE_COLOR_MODE,
          ...emptyFoldArtifactResourceState(),
          dirty: false,
          lastOptimization: null,
          historyPast: [],
          historyFuture: [],
          clipboardPasteCount: 0,
        });
        const layout = useLayoutStore.getState();
        layout.activateWorkspace('design');
        // Rebuild the Design layout if switching variant (e.g. NUX or box-pleat
        // -> circle-packed) so the TreeMaker side panes are correct and no BP
        // Editor pane lingers.
        layout.ensureDesignLayout();
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
      }
    },

    loadStarterProject: async () => {
      if (!(await confirmDiscardDirty(get().dirty))) return;
      set({ status: 'loading_engine', error: null, projectMessage: null });
      try {
        await releaseEditableCreasePattern();
        const api = await getEngine();
        const snapshot = await createStarterTree(api);
        set({
          ...projectStateFromSnapshot(snapshot, 'Three terminal flaps'),
          importedCreasePattern: null,
          oristudioCpDocument: null,
          oristudioCpLineage: null,
          oristudioCpError: null,
          oristudioCpCamvResult: null,
          oristudioCpHistoryPast: [],
          oristudioCpHistoryFuture: [],
          projectLoadId: get().projectLoadId + 1,
          currentFileName: defaultNativeFilename('three-terminal-flaps'),
          currentFilePath: null,
          projectMessage: 'Loaded starter project',
          selection: { kind: 'tree' },
          oristudioCpSelection: emptyOristudioCpSelection(),
          oristudioCpActiveDiagnosticId: null,
          oristudioCpRevision: 0,
          oristudioCpFoldedFigures: [],
          oristudioCpActiveFoldedFigureId: null,
          toolMode: 'select',
          symmetryAuthoringPairs: [],
          creaseColorMode: DEFAULT_CREASE_COLOR_MODE,
          ...emptyFoldArtifactResourceState(),
          dirty: false,
          lastOptimization: null,
          historyPast: [],
          historyFuture: [],
          clipboardPasteCount: 0,
        });
        useLayoutStore.getState().activateWorkspace('design');
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
      }
    },

    createNewCreasePattern: async () => {
      if (rejectDisabled('file.new')) return;
      if (!(await confirmDiscardDirty(get().dirty))) return;
      set({ status: 'loading_engine', error: null, projectMessage: null });
      try {
        await releaseEditableCreasePattern();
        const documentState = await createBlankOristudioCpDocument();
        set({
          // A new crease pattern opens directly in the CP editor.
          activePanelId: 'crease-pattern',
          project: { ...createEmptyProject(), title: documentState.summary.title ?? 'Untitled CP' },
          workflowTarget: 'treemaker',
          // Creating a bare CP establishes no design, so the Design workspace
          // keeps offering the method chooser (Circle-packed vs Box-pleated).
          pendingDesignChoice: true,
          importedCreasePattern: null,
          oristudioCpDocument: documentState,
          oristudioCpLineage: blankCpLineage(),
          oristudioCpOperationDescriptors: documentState.operationDescriptors,
          oristudioCpError: null,
          oristudioCpCamvResult: null,
          oristudioCpHistoryPast: [],
          oristudioCpHistoryFuture: [],
          projectLoadId: get().projectLoadId + 1,
          currentFileName: defaultNativeFilename(documentState.summary.title ?? 'Untitled CP'),
          currentFilePath: null,
          projectMessage: null,
          selection: { kind: 'tree' },
          oristudioCpSelection: emptyOristudioCpSelection(),
          oristudioCpActiveDiagnosticId: null,
          oristudioCpRevision: 0,
          oristudioCpFoldedFigures: [],
          oristudioCpActiveFoldedFigureId: null,
          toolMode: 'select',
          symmetryAuthoringPairs: [],
          creaseColorMode: DEFAULT_CREASE_COLOR_MODE,
          ...emptyFoldArtifactResourceState(),
          sequenceTarget: null,
          sequencePlan: null,
          sequenceSimulationFocus: { kind: 'whole' },
          sequencePlanning: false,
          sequenceError: null,
          status: 'crease_pattern_ready',
          dirty: false,
          engineReady: true,
          lastOptimization: null,
          historyPast: [],
          historyFuture: [],
          clipboardPasteCount: 0,
        });
        useLayoutStore.getState().activateWorkspace('edit');
      } catch (error) {
        set({ status: 'error', error: oristudioCpError(error) });
      }
    },

    loadProjectText: async (text, source) => {
      set({ pendingDesignChoice: false });
      try {
        await loadText(text, source);
      } catch (error) {
        set({ status: 'error', error: engineError(error), projectMessage: null });
      }
    },

    loadCreasePatternText: async (text, source) => {
      set({ pendingDesignChoice: false });
      try {
        await loadCreasePattern(text, source);
      } catch (error) {
        set({ status: 'error', error: engineError(error), projectMessage: null });
      }
    },

    executeOristudioCpCommand: async (operationId, payload = {}) => {
      if (!get().oristudioCpDocument) {
        set({
          oristudioCpError: 'No editable crease-pattern document is loaded',
          error: {
            code: 'invalid_operation',
            message: 'No editable crease-pattern document is loaded',
          },
        });
        return false;
      }
      try {
        const previousDocument = get().oristudioCpDocument?.document ?? null;
        const previousSelection = get().oristudioCpSelection;
        const mutatesDocument = !NON_MUTATING_CP_OPERATIONS.has(operationId);
        const editsCreasePattern =
          mutatesDocument && !SYNC_CP_LINE_SELECTION_AFTER_OPERATIONS.has(operationId);
        const validation = normalizeOristudioCpCommandPayload(payload);
        if (!validation.ok) {
          set({
            oristudioCpError: validation.error,
            error: {
              code: 'invalid_operation',
              message: validation.error,
            },
          });
          return false;
        }
        const commandDocument = await executeRuntimeOristudioCpCommand(
          operationId,
          validation.payload
        );
        if (!commandDocument) throw new Error('Crease-pattern command did not return a document');
        const checked =
          mutatesDocument
            ? await refreshAlwaysOnCamvDiagnostics(commandDocument)
            : {
                documentState: commandDocument,
                camvResult:
                  operationId === 'CheckCamv' &&
                  commandDocument.lastCommandResult?.operation === 'CheckCamv'
                    ? commandDocument.lastCommandResult
                    : get().oristudioCpCamvResult,
              };
        const nextDocument = checked.documentState;
        const diagnosticEntries = nextDocument.lastCommandResult?.diagnostic_entries ?? [];
        const nextRevision = editsCreasePattern
          ? get().oristudioCpRevision + 1
          : get().oristudioCpRevision;
        set({
          oristudioCpDocument: nextDocument,
          oristudioCpLineage: editsCreasePattern
            ? markCpLineageEdited(get().oristudioCpLineage)
            : get().oristudioCpLineage,
          oristudioCpCamvResult: checked.camvResult,
          oristudioCpOperationDescriptors: nextDocument.operationDescriptors,
          oristudioCpError: null,
          oristudioCpActiveDiagnosticId: mutatesDocument
            ? null
            : (diagnosticEntries[0]?.id ?? null),
          oristudioCpSelection: oristudioCpSelectionAfterCommand(
            operationId,
            previousSelection,
            nextDocument.document
          ),
          oristudioCpRevision: nextRevision,
          oristudioCpFoldedFigures: editsCreasePattern
            ? staleGeneratedFoldedFigures(get().oristudioCpFoldedFigures)
            : get().oristudioCpFoldedFigures,
          oristudioCpHistoryPast: previousDocument
            ? mutatesDocument
              ? [
                  ...get().oristudioCpHistoryPast,
                  cpHistoryEntry(previousDocument, String(operationId), previousSelection),
                ]
              : get().oristudioCpHistoryPast
            : get().oristudioCpHistoryPast,
          oristudioCpHistoryFuture: mutatesDocument ? [] : get().oristudioCpHistoryFuture,
          ...(mutatesDocument
            ? staleFoldArtifactResourceState(get().foldArtifactRevision)
            : {
                foldArtifacts: get().foldArtifacts,
                foldArtifactError: get().foldArtifactError,
                foldArtifactStatus: get().foldArtifactStatus,
                foldArtifactRevision: get().foldArtifactRevision,
                foldArtifactResolvedRevision: get().foldArtifactResolvedRevision,
                foldArtifactRequestId: get().foldArtifactRequestId,
                sequenceTarget: get().sequenceTarget,
                sequencePlan: get().sequencePlan,
                sequenceSimulationFocus: get().sequenceSimulationFocus,
                sequencePlanning: get().sequencePlanning,
                sequenceError: get().sequenceError,
              }),
          error: null,
          dirty: mutatesDocument ? true : get().dirty,
        });
        return true;
      } catch (error) {
        const normalized = oristudioCpError(error);
        set({
          oristudioCpError: normalized.message,
          error: normalized,
        });
        return false;
      }
    },

    insertOristudioCpLineSegments: async (segments, label = 'Paste CP lines') => {
      if (segments.length === 0) return false;
      return applyOristudioCpLineMutation(label, () =>
        insertRuntimeOristudioCpLineSegments(segments)
      );
    },

    importAddCreasePattern: async (fileService = getFileService()) => {
      if (rejectDisabled('file.importAdd')) return false;
      const file = await fileService.openTextFile({
        title: 'Import Into Crease Pattern',
        extensions: ['fold', 'cp', 'ori', 'orh'],
      });
      if (!file) return false;
      if (!isCreasePatternFilename(file.name)) {
        set({
          error: {
            code: 'invalid_operation',
            message: 'Import (add) supports FOLD, CP, ORI, and ORH crease patterns',
          },
          projectMessage: null,
        });
        return false;
      }
      const format = importedCreasePatternFormat(file.name);
      return applyOristudioCpLineMutation('Import (add)', () =>
        importAddOristudioCpDocumentFromText(file.text, { format, filename: file.name })
      );
    },

    importAddOristudioCpText: async (text, format, label, filename = 'design.cp') =>
      // In-memory Import(Add): merge crease-pattern text (e.g. a design's built CP)
      // into the always-live Edit canvas. Used by "Send to Edit".
      applyOristudioCpLineMutation(label, () =>
        importAddOristudioCpDocumentFromText(text, { format, filename })
      ),

    replaceOristudioCpLineSegments: async (
      lineIds,
      segments,
      label = 'Transform CP selection'
    ) => {
      if (lineIds.length === 0 || segments.length === 0) return false;
      return applyOristudioCpLineMutation(label, () =>
        replaceRuntimeOristudioCpLineSegments(lineIds, segments)
      );
    },

    setOristudioCpGridSize: async (gridSize) => {
      const normalizedGridSize = normalizeOrieditaGridSize(gridSize);
      return get().updateOristudioCpGrid(
        { grid_size: normalizedGridSize },
        `Set grid size to ${normalizedGridSize}`
      );
    },

    updateOristudioCpGrid: async (patch, label = 'Update grid') => {
      const currentDocumentState = get().oristudioCpDocument;
      if (!currentDocumentState) {
        set({
          oristudioCpError: 'No editable crease-pattern document is loaded',
          error: {
            code: 'invalid_operation',
            message: 'No editable crease-pattern document is loaded',
          },
        });
        return false;
      }

      const previousDocument = currentDocumentState.document;
      const nextGrid = normalizeOristudioCpGridPatch(
        previousDocument.crease_pattern.grid,
        patch
      );
      if (oristudioCpGridEquals(previousDocument.crease_pattern.grid, nextGrid)) return true;

      const previousSelection = get().oristudioCpSelection;
      const nextSnapshot: OristudioCpDocumentSnapshot = {
        ...previousDocument,
        crease_pattern: {
          ...previousDocument.crease_pattern,
          grid: nextGrid,
        },
      };

      try {
        const nextDocument = await restoreOristudioCpDocumentInPlace(
          nextSnapshot,
          currentDocumentState.source,
          currentDocumentState.lastCommandResult
        );
        set({
          oristudioCpDocument: nextDocument,
          oristudioCpLineage: markCpLineageEdited(get().oristudioCpLineage),
          oristudioCpOperationDescriptors: nextDocument.operationDescriptors,
          oristudioCpError: null,
          oristudioCpHistoryPast: [
            ...get().oristudioCpHistoryPast,
            cpHistoryEntry(previousDocument, label, previousSelection),
          ],
          oristudioCpHistoryFuture: [],
          error: null,
          dirty: true,
          projectMessage: label,
        });
        return true;
      } catch (error) {
        const normalized = oristudioCpError(error);
        set({
          oristudioCpError: normalized.message,
          error: normalized,
        });
        return false;
      }
    },

    previewOristudioCpCommand: async (operationId, payload = {}) => {
      if (!get().oristudioCpDocument) return null;
      try {
        const validation = normalizeOristudioCpCommandPayload(payload);
        if (!validation.ok) {
          set({ oristudioCpError: validation.error });
          return null;
        }
        const preview = await previewRuntimeOristudioCpCommand(operationId, validation.payload);
        set({ oristudioCpError: null });
        return preview;
      } catch (error) {
        const normalized = oristudioCpError(error);
        set({ oristudioCpError: normalized.message });
        return null;
      }
    },

    clearOristudioCpDocument: async () => {
      await releaseEditableCreasePattern();
      set({
        oristudioCpDocument: null,
        oristudioCpLineage: null,
        oristudioCpError: null,
        oristudioCpHistoryPast: [],
        oristudioCpHistoryFuture: [],
        oristudioCpActiveDiagnosticId: null,
        oristudioCpRevision: 0,
        oristudioCpFoldedFigures: [],
        oristudioCpActiveFoldedFigureId: null,
        oristudioCpCamvResult: null,
      });
    },

    openProject: async (fileService = getFileService()) => {
      if (rejectDisabled('file.open')) return false;
      if (!(await confirmDiscardDirty(get().dirty))) return false;
      set({ pendingDesignChoice: false });
      try {
        const file = await fileService.openTextFile({
          title: 'Open Ori Studio Project or Crease Pattern',
          extensions: [
            NATIVE_PROJECT_EXTENSION,
            'tmd',
            'tmd4',
            'tmd5',
            'fold',
            'cp',
            'ori',
            'orh',
            'bps',
          ],
        });
        if (!file) return false;
        if (isNativeProjectFilename(file.name)) {
          await loadNativeProject(file.text, { filename: file.name, path: file.path });
        } else if (isBpProjectFilename(file.name)) {
          await get().loadOristudioBpProjectFromFile(file.text, {
            filename: file.name,
            path: file.path,
          });
        } else if (isCreasePatternFilename(file.name)) {
          await loadCreasePattern(file.text, { filename: file.name, path: file.path });
        } else {
          await loadText(file.text, { filename: file.name, path: file.path });
        }
        return true;
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
        return false;
      }
    },

    saveProject: async (fileService = getFileService()) => {
      try {
        if (rejectDisabled('file.save')) return false;
        return await saveActiveProject(fileService, false);
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
        return false;
      }
    },

    saveProjectAs: async (fileService = getFileService()) => {
      try {
        if (rejectDisabled('file.saveAs')) return false;
        return await saveActiveProject(fileService, true);
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
        return false;
      }
    },

    exportV5: async (fileService = getFileService()) => {
      try {
        if (rejectDisabled('file.exportV5')) return false;
        const contents = await currentTreeTmd5Text();
        const result = await fileService.saveTextFile({
          title: 'Export TreeMaker 5 Project',
          contents,
          suggestedName: defaultFilename(get().project.title, 'tmd5'),
          path: null,
          extensions: ['tmd5'],
        });
        if (!result) return false;
        set({ projectMessage: `Exported ${result.name}` });
        return true;
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
        return false;
      }
    },

    exportV4: async (fileService = getFileService()) => {
      try {
        if (rejectDisabled('file.exportV4')) return false;
        const { api, treeHandle } = await ensureTreeHandle();
        const contents = await api.exportV4(treeHandle);
        const result = await fileService.saveTextFile({
          title: 'Export TreeMaker 4 Project',
          contents,
          suggestedName: defaultFilename(get().project.title, 'tmd4'),
          path: null,
          extensions: ['tmd4'],
        });
        if (!result) return false;
        set({ projectMessage: `Exported ${result.name}` });
        return true;
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
        return false;
      }
    },

    exportCp: async (fileService = getFileService()) => {
      try {
        if (rejectDisabled('file.exportCp')) return false;
        const contents = await exportOristudioCpDocumentAsCp();
        const result = await fileService.saveTextFile({
          title: 'Export CP Document',
          contents,
          suggestedName: defaultFilename(
            get().oristudioCpDocument?.summary.title || get().project.title,
            'cp'
          ),
          path: null,
          extensions: ['cp'],
        });
        if (!result) return false;
        set({ projectMessage: `Exported ${result.name}` });
        return true;
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
        return false;
      }
    },

    exportBps: async (fileService = getFileService()) => {
      try {
        if (rejectDisabled('file.exportBps')) return false;
        const contents = await exportOristudioBpProjectAsBps();
        const result = await fileService.saveTextFile({
          title: 'Export Box Pleating Studio Project',
          contents,
          suggestedName: defaultFilename(
            get().oristudioBpDocument?.snapshot?.summary?.title || get().project.title,
            'bps'
          ),
          path: null,
          extensions: ['bps'],
        });
        if (!result) return false;
        set({ projectMessage: `Exported ${result.name}` });
        return true;
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
        return false;
      }
    },

    exportFold: async (fileService = getFileService()) => {
      try {
        if (rejectDisabled('file.exportFold')) return false;
        const contents =
          get().oristudioCpDocument
            ? await exportOristudioCpDocumentAsFold()
            : get().importedCreasePattern
            ? JSON.stringify(get().importedCreasePattern?.fold, null, 2)
            : await (async () => {
                const { api, treeHandle } = await ensureTreeHandle();
                return api.exportFold(treeHandle);
              })();
        const result = await fileService.saveTextFile({
          title: 'Export FOLD Document',
          contents,
          suggestedName: defaultFilename(get().project.title, 'fold'),
          path: null,
          extensions: ['fold'],
        });
        if (!result) return false;
        set({ projectMessage: `Exported ${result.name}` });
        return true;
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
        return false;
      }
    },

    exportOri: async (fileService = getFileService()) => {
      try {
        if (rejectDisabled('file.exportOri')) return false;
        const contents = await exportOristudioCpDocumentAsOri();
        const result = await fileService.saveTextFile({
          title: 'Export Oriedita ORI Document',
          contents,
          suggestedName: defaultFilename(
            get().oristudioCpDocument?.summary.title || get().project.title,
            'ori'
          ),
          path: null,
          extensions: ['ori'],
        });
        if (!result) return false;
        set({ projectMessage: `Exported ${result.name}` });
        return true;
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
        return false;
      }
    },

    exportOrh: async (fileService = getFileService()) => {
      try {
        if (rejectDisabled('file.exportOrh')) return false;
        if (!(await confirmLossyOrhWrite())) return false;
        const contents = await exportOristudioCpDocumentAsOrh();
        const result = await fileService.saveTextFile({
          title: 'Export Oriedita ORH Document',
          contents,
          suggestedName: defaultFilename(
            get().oristudioCpDocument?.summary.title || get().project.title,
            'orh'
          ),
          path: null,
          extensions: ['orh'],
        });
        if (!result) return false;
        set({ projectMessage: `Exported ${result.name}` });
        return true;
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
        return false;
      }
    },

    exportSvg: async (fileService = getFileService(), options) => {
      try {
        if (rejectDisabled('file.exportSvg')) return false;
        const resolved = await resolveCreaseExport('svg', options);
        if (!resolved) return false;
        const contents = serializeCreasePatternSvg(resolved.fold, resolved.segments, resolved.options);
        const result = await fileService.saveTextFile({
          title: 'Export Crease Pattern SVG',
          contents,
          suggestedName: defaultFilename(get().project.title, 'svg'),
          path: null,
          extensions: ['svg'],
        });
        if (!result) return false;
        set({ projectMessage: `Exported ${result.name}` });
        return true;
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
        return false;
      }
    },

    exportPng: async (fileService = getFileService(), options) => {
      try {
        if (rejectDisabled('file.exportPng')) return false;
        const resolved = await resolveCreaseExport('png', options);
        if (!resolved) return false;
        const bytes = await renderCreasePatternPng(resolved.fold, resolved.segments, resolved.options);
        const result = await fileService.saveBinaryFile({
          title: 'Export Crease Pattern PNG',
          bytes,
          suggestedName: defaultFilename(get().project.title, 'png'),
          path: null,
          extensions: ['png'],
          mimeType: 'image/png',
        });
        if (!result) return false;
        set({ projectMessage: `Exported ${result.name}` });
        return true;
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
        return false;
      }
    },

    loadExampleProject: async (id) => {
      if (!(await confirmDiscardDirty(get().dirty))) return;
      const example = getExampleProject(id);
      if (!example) return;
      await get().loadProjectText(example.text, {
        title: example.title,
        filename: example.filename,
      });
    },

    clearProjectMessage: () => set({ projectMessage: null }),
    setActivePanelId: (id) => set({ activePanelId: id }),
    setWorkflowTarget: (target) => {
      if (get().workflowTarget === target) return;
      set({ workflowTarget: target });
      // The Design layout variant follows the method, so rebuild it if needed.
      useLayoutStore.getState().ensureDesignLayout();
    },

    startNewDesign: () => {
      // Enter the Design workspace on the NUX chooser; no document is created
      // until the user picks Circle-packed or Box-pleated.
      set({ pendingDesignChoice: true, error: null, projectMessage: null });
      useLayoutStore.getState().activateWorkspace('design');
      useLayoutStore.getState().ensureDesignLayout();
    },

    chooseDesignMethod: async (target) => {
      if (target === 'box-pleat') {
        // Create a real BP document; it sets workflowTarget/box-pleat, clears
        // the pending choice, and materializes the box-pleat Design layout.
        await get().createOristudioBpProject({ confirmDiscard: false });
        return;
      }
      // Circle-packed: the standard TreeMaker blank-tree flow. createNewProject
      // resets workflowTarget to 'treemaker' and clears pendingDesignChoice.
      await get().createNewProject();
    },
  };
};
