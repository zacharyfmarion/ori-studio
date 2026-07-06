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
  withFlatFoldArtifacts,
  withFlatFoldError,
} from '../../../lib/creasePatternImport';
import {
  DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
  emptyOristudioCpSelection,
  getCpVertices,
  normalizeOrieditaGridSize,
} from '../../../lib/creasePatternViewport';
import {
  blankCpLineage,
  importedCpLineage,
  markCpLineageEdited,
} from '../../../lib/oristudioCpLineage';
import {
  defaultOristudioCpSymmetry,
  normalizeOristudioCpCommandPayload,
  prepareOristudioCpCommandPayloads,
} from '../../../lib/oristudioCpSymmetry';
import {
  activeNativeDocument,
  createNativeCreasePatternProjectFile,
  createNativeTreeProjectFile,
  isNativeProjectFilename,
  NATIVE_PROJECT_EXTENSION,
  parseNativeProjectFile,
  serializeNativeProjectFile,
} from '../../../lib/nativeProjectFile';
import type { OristudioCpSelection } from '../../../lib/creasePatternViewport';
import type { OristudioCpOperationId } from '../../../lib/oristudioCpCommands';
import { createEmptyProject, DEFAULT_CREASE_COLOR_MODE } from '../../../lib/sampleProject';
import {
  getWorkspaceCapabilities,
  type WorkspaceCapabilityId,
} from '../../../lib/workspaceCapabilities';
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
  insertOristudioCpLineSegments as insertRuntimeOristudioCpLineSegments,
  oristudioCpError,
  previewOristudioCpCommand as previewRuntimeOristudioCpCommand,
  releaseOristudioCpDocument,
  replaceOristudioCpLineSegments as replaceRuntimeOristudioCpLineSegments,
  restoreOristudioCpDocument,
  restoreOristudioCpDocumentInPlace,
  setOristudioCpDocumentSource,
} from '../oristudioCpRuntime';
import type { ProjectSlice, RecentProject, WorkspaceSliceCreator } from '../types';
import type { FoldDocument } from '../../../engine/types';
import type {
  OristudioCpCommandResult,
  OristudioCpDocumentSnapshot,
  OristudioCpDocumentState,
  OristudioCpFoldedFigureEntry,
} from '../../../engine/oristudioCpTypes';

const RECENTS_STORAGE_KEY = 'treemaker.recentProjects.v1';
const AUTOSAVE_STORAGE_KEY = 'treemaker.autosave.v1';
const MAX_RECENTS = 8;

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

function loadRecentProjects(): RecentProject[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENTS_STORAGE_KEY) ?? '[]') as RecentProject[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

function persistRecentProjects(recents: RecentProject[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(recents.slice(0, MAX_RECENTS)));
}

function persistAutosave(recent: RecentProject): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(recent));
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

function defaultCreaseExportOptions(viewMode: CreaseExportOptions['viewMode']): CreaseExportOptions {
  return {
    viewMode,
    includeUnassigned: true,
    showBackgroundColor: true,
  };
}

export const createProjectSlice: WorkspaceSliceCreator<ProjectSlice> = (set, get) => {
  const rememberRecent = (recent: RecentProject) => {
    const existing = get().recentProjects;
    const next = [
      recent,
      ...existing.filter((item) => item.id !== recent.id && item.filename !== recent.filename),
    ].slice(0, MAX_RECENTS);
    persistRecentProjects(next);
    persistAutosave(recent);
    set({ recentProjects: next });
  };

  const capabilities = () =>
    getWorkspaceCapabilities({
      documentMode: get().documentMode,
      activeEditingSurface: get().activeEditingSurface,
      engineReady: get().engineReady,
      status: get().status,
      edgeCount: get().project.edges.length,
      creaseCount: get().project.creases.length,
      facetCount: get().project.facets.length,
      hasEditableCreasePattern: get().oristudioCpDocument !== null,
      hasImportedCreasePattern: get().importedCreasePattern !== null,
      hasSimulationModel: get().foldArtifacts?.simulation_model != null,
      oristudioCpSelectedLineCount: get().oristudioCpSelection.lines.length,
      oristudioCpSelectedVertexCount: get().oristudioCpSelection.vertices?.length ?? 0,
      oristudioCpSelectedPointCount: get().oristudioCpSelection.points.length,
      oristudioCpSelectedCircleCount: get().oristudioCpSelection.circles.length,
      historyPastCount:
        get().activeEditingSurface === 'crease-pattern'
          ? get().oristudioCpHistoryPast.length
          : get().historyPast.length,
      historyFutureCount:
        get().activeEditingSurface === 'crease-pattern'
          ? get().oristudioCpHistoryFuture.length
          : get().historyFuture.length,
      clipboard: get().clipboard,
      selection: get().selection,
    });

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

  const resolveCreaseExportOptions = (
    format: CreaseExportFormat,
    options?: CreaseExportOptions
  ): Promise<CreaseExportOptions | null> => {
    if (options) return Promise.resolve(options);
    const label = format.toUpperCase();
    return requestCreasePatternExportOptions({
      title: `Export ${label}`,
      format,
      project: get().project,
      initialOptions: defaultCreaseExportOptions(get().creaseColorMode),
      confirmLabel: `Export ${label}`,
    });
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
      recentText?: string | null;
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
      documentMode: 'tree',
      activeEditingSurface: 'tree',
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
    if (source.recentText !== null) {
      rememberRecent({
        id: source.path ?? filename,
        title,
        filename,
        savedAt: nowIso(),
        text: source.recentText ?? text,
      });
    }
    useLayoutStore.getState().activatePanel('design');
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
    const result = await (async () => {
      try {
        const api = await getEngine();
        const foldArtifacts = await api.flatFoldArtifacts(JSON.stringify(parsed.document.fold), {
          solution_limit: 10,
        });
        return withFlatFoldArtifacts(parsed, foldArtifacts);
      } catch (error) {
        return withFlatFoldError(parsed, engineError(error).message);
      }
    })();
    const artifactRevision = get().foldArtifactRevision + 1;
    const artifactState =
      result.foldArtifacts.folded_base_error && !result.foldArtifacts.folded_base
        ? {
            foldArtifacts: result.foldArtifacts,
            foldArtifactError: result.foldArtifacts.folded_base_error,
            foldArtifactStatus: 'error' as const,
            foldArtifactRevision: artifactRevision,
            foldArtifactResolvedRevision: artifactRevision,
          }
        : readyFoldArtifactResourceState(result.foldArtifacts, artifactRevision);
    set({
      project: result.project,
      documentMode: 'crease-pattern',
      activeEditingSurface: 'crease-pattern',
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
      oristudioCpSymmetry: defaultOristudioCpSymmetry(),
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
    rememberRecent({
      id: source.path ?? filename,
      title: result.document.title,
      filename,
      savedAt: nowIso(),
      text,
    });
    useLayoutStore.getState().activatePanel('crease-pattern');
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
    nativeText: string,
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
    const result = await (async () => {
      try {
        const api = await getEngine();
        const foldArtifacts = await api.flatFoldArtifacts(JSON.stringify(parsed.document.fold), {
          solution_limit: 10,
        });
        return withFlatFoldArtifacts(parsed, foldArtifacts);
      } catch (error) {
        return withFlatFoldError(parsed, engineError(error).message);
      }
    })();
    const artifactRevision = get().foldArtifactRevision + 1;
    const artifactState =
      result.foldArtifacts.folded_base_error && !result.foldArtifacts.folded_base
        ? {
            foldArtifacts: result.foldArtifacts,
            foldArtifactError: result.foldArtifacts.folded_base_error,
            foldArtifactStatus: 'error' as const,
            foldArtifactRevision: artifactRevision,
            foldArtifactResolvedRevision: artifactRevision,
          }
        : readyFoldArtifactResourceState(result.foldArtifacts, artifactRevision);
    const originalSource = importedSourceFromNativeSource(nativeDocument.creasePattern.source);
    const importedDocument = originalSource
      ? { ...result.document, source: originalSource }
      : result.document;
    set({
      project: { ...result.project, title: nativeDocument.title || result.project.title },
      documentMode: 'crease-pattern',
      activeEditingSurface: 'crease-pattern',
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
      oristudioCpSymmetry: nativeDocument.viewState.symmetry ?? defaultOristudioCpSymmetry(),
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
    rememberRecent({
      id: source.path ?? source.filename,
      title: nativeDocument.title,
      filename: source.filename,
      savedAt: nowIso(),
      text: nativeText,
    });
    useLayoutStore.getState().activatePanel('crease-pattern');
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
      oristudioCpSymmetry: nativeDocument.viewState.symmetry ?? defaultOristudioCpSymmetry(),
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
        recentText: text,
      });
      const companion = nativeProject.workspace.documents.find(
        (document) => document.kind === 'crease-pattern'
      );
      if (companion?.kind === 'crease-pattern') {
        await restoreNativeCreasePatternCompanion(companion, source);
      }
      return;
    }
    await loadNativeCreasePattern(nativeDocument, text, source);
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
    rememberRecent({
      id: result.path ?? result.name,
      title: get().project.title,
      filename: result.name,
      savedAt: nowIso(),
      text: contents,
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
      symmetry: get().oristudioCpSymmetry,
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
    rememberRecent({
      id: result.path ?? result.name,
      title: documentState.summary.title || get().project.title,
      filename: result.name,
      savedAt: nowIso(),
      text: contents,
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
    rememberRecent({
      id: result.path ?? result.name,
      title: documentState.summary.title || get().project.title,
      filename: result.name,
      savedAt: nowIso(),
      text: contents,
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
    rememberRecent({
      id: result.path ?? result.name,
      title: documentState.summary.title || get().project.title,
      filename: result.name,
      savedAt: nowIso(),
      text: contents,
    });
    return true;
  };

  return {
    project: createEmptyProject(),
    documentMode: 'tree',
    activeEditingSurface: 'tree',
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
    recentProjects: loadRecentProjects(),
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
        if (get().documentMode !== 'tree') {
          set({ engineReady: true, oristudioCpOperationDescriptors: operationDescriptors });
          return;
        }
        await releaseEditableCreasePattern();
        set({
          ...projectStateFromSnapshot(snapshot, get().project.title),
          documentMode: 'tree',
          activeEditingSurface: 'tree',
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
          documentMode: 'tree',
          activeEditingSurface: 'tree',
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
        useLayoutStore.getState().activatePanel('design');
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
          documentMode: 'tree',
          activeEditingSurface: 'tree',
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
        useLayoutStore.getState().activatePanel('design');
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
          project: { ...createEmptyProject(), title: documentState.summary.title ?? 'Untitled CP' },
          documentMode: 'crease-pattern',
          activeEditingSurface: 'crease-pattern',
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
          oristudioCpSymmetry: defaultOristudioCpSymmetry(),
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
        useLayoutStore.getState().activatePanel('crease-pattern');
      } catch (error) {
        set({ status: 'error', error: oristudioCpError(error) });
      }
    },

    loadProjectText: async (text, source) => {
      try {
        await loadText(text, source);
      } catch (error) {
        set({ status: 'error', error: engineError(error), projectMessage: null });
      }
    },

    loadCreasePatternText: async (text, source) => {
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
        const preparedPayloads = previousDocument
          ? prepareOristudioCpCommandPayloads(
              operationId,
              previousDocument,
              payload,
              get().oristudioCpSymmetry
            )
          : normalizeOristudioCpCommandPayload(payload);
        if (!preparedPayloads.ok) {
          set({
            oristudioCpError: preparedPayloads.error,
            error: {
              code: 'invalid_operation',
              message: preparedPayloads.error,
            },
          });
          return false;
        }
        const payloads =
          'payloads' in preparedPayloads
            ? preparedPayloads.payloads
            : [preparedPayloads.payload];
        let commandDocument: OristudioCpDocumentState | null = null;
        for (const commandPayload of payloads) {
          commandDocument = await executeRuntimeOristudioCpCommand(operationId, commandPayload);
        }
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
          activeEditingSurface: 'crease-pattern',
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

      const normalizedGridSize = normalizeOrieditaGridSize(gridSize);
      const previousDocument = currentDocumentState.document;
      if (previousDocument.crease_pattern.grid.grid_size === normalizedGridSize) return true;

      const previousSelection = get().oristudioCpSelection;
      const nextSnapshot: OristudioCpDocumentSnapshot = {
        ...previousDocument,
        crease_pattern: {
          ...previousDocument.crease_pattern,
          grid: {
            ...previousDocument.crease_pattern.grid,
            grid_size: normalizedGridSize,
          },
        },
      };

      try {
        const nextDocument = await restoreOristudioCpDocumentInPlace(
          nextSnapshot,
          currentDocumentState.source,
          currentDocumentState.lastCommandResult
        );
        const label = `Set grid size to ${normalizedGridSize}`;
        set({
          oristudioCpDocument: nextDocument,
          activeEditingSurface: 'crease-pattern',
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
        oristudioCpSymmetry: defaultOristudioCpSymmetry(),
      });
    },

    openProject: async (fileService = getFileService()) => {
      if (rejectDisabled('file.open')) return false;
      if (!(await confirmDiscardDirty(get().dirty))) return false;
      try {
        const file = await fileService.openTextFile({
          title: 'Open Ori Studio Project or Crease Pattern',
          extensions: [NATIVE_PROJECT_EXTENSION, 'tmd', 'tmd4', 'tmd5', 'fold', 'cp', 'ori', 'orh'],
        });
        if (!file) return false;
        if (isNativeProjectFilename(file.name)) {
          await loadNativeProject(file.text, { filename: file.name, path: file.path });
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
        if (get().documentMode === 'crease-pattern') {
          return await saveEditableCreasePattern(fileService, false);
        }
        return await saveNativeTreeProject(fileService, false);
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
        return false;
      }
    },

    saveProjectAs: async (fileService = getFileService()) => {
      try {
        if (rejectDisabled('file.saveAs')) return false;
        if (get().documentMode === 'crease-pattern') {
          return await saveEditableCreasePattern(fileService, true);
        }
        return await saveNativeTreeProject(fileService, true);
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

    exportFold: async (fileService = getFileService()) => {
      try {
        if (rejectDisabled('file.exportFold')) return false;
        const contents =
          get().oristudioCpDocument
            ? await exportOristudioCpDocumentAsFold()
            : get().documentMode === 'crease-pattern' && get().importedCreasePattern
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
        const exportOptions = await resolveCreaseExportOptions('svg', options);
        if (!exportOptions) return false;
        const contents = serializeCreasePatternSvg(get().project, exportOptions);
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
        const exportOptions = await resolveCreaseExportOptions('png', options);
        if (!exportOptions) return false;
        const bytes = await renderCreasePatternPng(get().project, exportOptions);
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

    loadRecentProject: async (id) => {
      if (!(await confirmDiscardDirty(get().dirty))) return;
      const recent = get().recentProjects.find((item) => item.id === id);
      if (!recent) return;
      if (isNativeProjectFilename(recent.filename)) {
        await loadNativeProject(recent.text, {
          filename: recent.filename,
          path: recent.id === AUTOSAVE_STORAGE_KEY ? null : recent.id,
        });
      } else if (isCreasePatternFilename(recent.filename)) {
        await get().loadCreasePatternText(recent.text, {
          filename: recent.filename,
          path: recent.id,
        });
      } else {
        await get().loadProjectText(recent.text, {
          title: recent.title,
          filename: recent.filename,
        });
      }
    },

    autosaveProject: async () => {
      if (!get().dirty) return;
      try {
        const filename = isNativeProjectFilename(get().currentFileName)
          ? get().currentFileName
          : defaultNativeFilename(get().project.title);
        const text =
          get().documentMode === 'crease-pattern'
            ? await (async () => {
                const input = await currentEditableCreasePatternProjectInput(filename, null);
                if (!input) return null;
                return serializeNativeProjectFile(
                  createNativeCreasePatternProjectFile(input)
                );
              })()
            : serializeNativeProjectFile(
                createNativeTreeProjectFile({
                  title: get().project.title,
                  filename,
                  path: null,
                  tmd5Text: await currentTreeTmd5Text(),
                  creasePatternCompanion: await currentEditableCreasePatternProjectInput(filename, null),
                  appVersion: APP_VERSION,
                })
              );
        if (!text) return;
        rememberRecent({
          id: AUTOSAVE_STORAGE_KEY,
          title: get().project.title,
          filename,
          savedAt: nowIso(),
          text,
        });
      } catch {
        // Autosave is best-effort and should never interrupt editing.
      }
    },

    clearProjectMessage: () => set({ projectMessage: null }),
    setActiveEditingSurface: (surface) => set({ activeEditingSurface: surface }),
  };
};
