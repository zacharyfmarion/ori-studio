import { getExampleProject } from '../../../examples/catalog';
import { APP_VERSION } from '../../../constants/release';
import {
  serializeCreasePatternSvg,
  renderCreasePatternPng,
  DEFAULT_CREASE_EXPORT_OPTIONS,
  EMPTY_CREASE_EXPORT_CAPTION,
  EMPTY_CREASE_EXPORT_CONTENT,
  type CreaseExportContent,
  type CreaseExportFoldedFigureSettings,
  type CreaseExportFormat,
  type CreaseExportOptions,
} from '../../../lib/creaseExport';
import {
  cpModelToFoldTransform,
  foldSegmentForExport,
  type CreaseExportFoldResult,
} from '../../../lib/creaseExportFold';
import { hexToRgbColor } from '../../../lib/rgbColor';
import { foldedFigureModelFromOrieditaMetadata } from '../../../lib/orieditaNativeMetadata';
import type { OristudioCpFoldedFigureModel } from '../../../engine/oristudioCpTypes';
import {
  buildSegmentSubFold,
  isSegmentImageFormat,
  type SegmentExportFormat,
} from '../../../lib/creaseSegmentExport';
import {
  renderFoldedFigurePng,
  serializeFoldedFigureSvg,
  type FoldedFigureExportFormat,
} from '../../../cp-workspace/folded/foldedFigureExport';
import { ensureCpSegmentationArtifacts } from '../../../cp-workspace/cpSegmentationArtifacts';
import {
  importedCreasePatternFormat,
  isCreasePatternFilename,
  parseImportedCreasePattern,
  parseImportedCreasePatternFromFold,
  type ImportedCreasePatternResult,
  type ImportedCreasePatternSource,
} from '../../../lib/creasePatternImport';
import {
  clampOrieditaGridAngle,
  DEFAULT_ORISTUDIO_CP_LINE_STYLE,
  DEFAULT_ORISTUDIO_CP_LINE_WIDTH,
  DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
  emptyOristudioCpSelection,
  isValidOrieditaGridScale,
  normalizeOrieditaGridSize,
  normalizeOrieditaIntervalGridSize,
  ORIEDITA_GRID_SCALE_DEFAULTS,
  textCoordinate,
} from '../../../lib/creasePatternViewport';
import {
  importedCpLineage,
  markCpLineageEdited,
} from '../../../lib/oristudioCpLineage';
import { IMAGE_TOTAL_BYTES_WARN, totalCpImageBytes } from '../../../cp-workspace/images/cpImage';
import {
  foldedFoldDocument,
  foldedObj,
  foldedStl,
  type FoldedMesh,
} from '../../../lib/foldedExport';
import { peekSimulatorClient } from '../simulatorRuntime';
import { simulationFoldOf } from '../../../lib/creasePatternSegmentation';
import {
  flattenTextAnnotations,
  isImageAnnotation,
  isTextAnnotation,
} from '../../../cp-workspace/annotations/annotation';
import {
  createTextAnnotation,
  textDocFromPlainText,
} from '../../../cp-workspace/annotations/textAnnotation';
import type { CanvasAnnotation } from '../../../cp-workspace/annotations/annotation';
import type { InlineSimulation } from '../../../cp-workspace/inlineSimulation/inlineSimulation';
import { discardCpDocumentState } from '../cpDocumentState';
import { normalizeOristudioCpCommandPayload } from '../../../lib/oristudioCpCommandPayloads';
import {
  activeNativeDocument,
  createNativeCreasePatternProjectFile,
  createNativeProjectFile,
  isNativeProjectFilename,
  NATIVE_PROJECT_EXTENSION,
  parseNativeProjectFile,
  serializeNativeProjectFile,
  type NativeProjectActiveMode,
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
import { freshEditableCpState } from '../freshCreasePattern';
import { ensureExtension, getFileService, type FileService } from '../../../platform/fileService';
import { exportFilename as defaultFilename } from '../../../platform/exportFilename';
import { requestConfirmation, requestCreasePatternExportOptions } from '../../commandDialogStore';
import {
  blockingExportLoss,
  collectExportLossWarnings,
  describeExportLoss,
  exportFormatLabel,
  type ExportFormat,
} from '../../../lib/supersetFeatures';
import { useLayoutStore } from '../../layoutStore';
import {
  emptyFoldArtifactResourceState,
  pickFoldArtifactResourceState,
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
  runOristudioCpCheckCommand,
  exportOristudioCpDocumentAsCp,
  exportOristudioCpDocumentAsFold,
  exportOristudioCpDocumentAsOri,
  exportOristudioCpDocumentAsOrh,
  exportFoldFrameAsFormat,
  clearOristudioCpKernelTexts,
  createBlankOristudioCpDocument,
  foldOristudioCpDocument,
  foldOristudioCpFigureToCase,
  freeOristudioCpFoldedFigure,
  getOristudioCpFoldedFigureRenderSnapshot,
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
import type { OristudioCpHistoryEntry, ProjectSlice, WorkspaceSliceCreator } from '../types';
import { retainFoldedFigureHandles } from '../../../cp-workspace/folded/foldedFigureHandles';
import type { FoldDocument } from '../../../engine/types';
import type {
  OristudioCpCommandResult,
  OristudioCpDocumentSnapshot,
  OristudioCpDocumentState,
  OristudioCpFoldedFigureEntry,
  OristudioCpGridMetadata,
} from '../../../engine/oristudioCpTypes';
import type { EditingContext } from '../../../workspaces/editingContext';
import { cpSlotGeneration, cpSlotGenerationIsCurrent } from '../cpDocumentSlots';

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Which document a saved workspace records as active/primary. A design (tree or
 * box-pleat) always wins over the crease pattern: the Edit canvas is always
 * focusable, and the single-document loader dispatches on the active document,
 * so letting a focused Edit view mark the CP active would drop the design on
 * reload. The editing context only chooses which design is primary when more
 * than one is present.
 */
function resolveNativeActiveMode(
  context: EditingContext,
  present: { hasTree: boolean; hasBoxPleat: boolean }
): NativeProjectActiveMode {
  if ((context === 'bp-tree' || context === 'bp-packing') && present.hasBoxPleat) {
    return 'box-pleat';
  }
  if (context === 'treemaker-tree' && present.hasTree) return 'tree';
  if (present.hasBoxPleat) return 'box-pleat';
  if (present.hasTree) return 'tree';
  return 'crease-pattern';
}

function cpHistoryEntry(
  document: Awaited<ReturnType<typeof loadOristudioCpDocumentFromText>>['document'],
  label: string,
  selection: OristudioCpSelection,
  annotations: CanvasAnnotation[],
  foldedFigures: OristudioCpFoldedFigureEntry[],
  activeFoldedFigureId: string | null,
  inlineSimulations: InlineSimulation[]
): OristudioCpHistoryEntry {
  // The entry keeps these figures' wasm handles alive for as long as undo can
  // reach it — see cp-workspace/foldedFigureHandles.
  retainFoldedFigureHandles(foldedFigures);
  return {
    document,
    selection,
    annotations,
    // Captured so undo restores the figures a crease edit was made alongside —
    // including their recorded source region, which is what decides whether they
    // read as out of date (see lib/foldedFigureStaleness.ts).
    foldedFigures,
    activeFoldedFigureId,
    // Same reason as the figures above: undo restores the simulation windows the
    // crease edit was made alongside, with the provenance that decides whether
    // they read as out of date.
    inlineSimulations,
    label,
    timestamp: nowIso(),
  };
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

// Deferred always-on CAMV recompute: a passive diagnostic overlay does not need to
// block the edit's critical path, so edits/undo/redo apply + render immediately and
// schedule this instead. The short debounce coalesces bursts (e.g. held cmd+z).
const CAMV_REFRESH_DEBOUNCE_MS = 120;
let camvRefreshTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Synchronous, eager CAMV refresh (runs CheckCamv + re-snapshots). Still used by the
 * document-load paths, which want the overlay populated as part of opening a document.
 * Interactive edits use the deferred `scheduleOristudioCamvRefresh` instead.
 */
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

  return {
    lines: selection.lines.filter((id) => id >= 1 && id <= document.crease_pattern.line_segments.length),
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

// A project source this large risks exhausting the desktop WebView's memory as
// it is parsed, loaded into the engine, and uploaded to WebGL. We can't stop the
// OS from killing an out-of-memory WebView, but when a load throws we can turn the
// opaque engine error into an actionable message. Measured against string length
// (a cheap UTF-16 proxy) to avoid allocating a byte view of a huge file.
const LARGE_PROJECT_WARN_CHARS = 25 * 1024 * 1024;

function annotateLargeSourceError(
  error: ReturnType<typeof engineError>,
  sourceLength: number
): ReturnType<typeof engineError> {
  if (sourceLength < LARGE_PROJECT_WARN_CHARS) return error;
  const mb = Math.round(sourceLength / (1024 * 1024));
  return {
    ...error,
    message: `${error.message} — this file is very large (~${mb} MB) and may have exceeded available memory. Very large crease patterns can fail to open in the desktop app; the web version has more headroom.`,
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

/**
 * Fold one crease pattern for an export preview.
 *
 * Ephemeral by design: the figure never becomes a canvas entry, so exporting
 * leaves no folded model, no history entry, and no dirty flag behind.
 */
async function foldExportSegment(
  documentState: OristudioCpDocumentState | null,
  fold: FoldDocument,
  segment: CpSegment | null,
  settings: CreaseExportFoldedFigureSettings
): Promise<CreaseExportFoldResult> {
  if (!documentState) throw new Error('No editable crease-pattern document is loaded');
  try {
    return await foldSegmentForExport(
      {
        fold: async (startingFaceId, order, model, lineIds) => {
          const result = await foldOristudioCpDocument(startingFaceId, order, model, lineIds);
          return {
            handle: result.handle,
            discoveredCases: result.snapshot.discovered_fold_cases,
            displayStyle: result.snapshot.display_style,
          };
        },
        foldToCase: async (handle, objective) => {
          const result = await foldOristudioCpFigureToCase(handle, objective);
          return {
            discoveredCases: result.snapshot.discovered_fold_cases,
            displayStyle: result.snapshot.display_style,
          };
        },
        // Render at the style the estimate reached, exactly as the canvas does.
        renderSnapshot: (handle, displayStyle) =>
          getOristudioCpFoldedFigureRenderSnapshot(handle, displayStyle, {
            display_mark: false,
            selected: false,
          }),
        free: (handle) => freeOristudioCpFoldedFigure(handle),
      },
      documentState.document,
      segment,
      exportFoldedFigureModel(documentState, settings),
      settings.foldCase,
      cpModelToFoldTransform(fold, documentState.document)
    );
  } catch (error) {
    // Kernel failures arrive as wasm error envelopes, not Errors; the dialog
    // shows this message verbatim, so normalize it here.
    throw new Error(oristudioCpError(error).message, { cause: error });
  }
}

/**
 * The kernel model an export fold runs with: the document's own folded-figure
 * metadata (so a reopened Oriedita file keeps its colours) with the dialog's
 * choices layered on top.
 */
function exportFoldedFigureModel(
  documentState: OristudioCpDocumentState,
  settings: CreaseExportFoldedFigureSettings
): OristudioCpFoldedFigureModel {
  const base =
    foldedFigureModelFromOrieditaMetadata(documentState.document.metadata) ??
    DEFAULT_EXPORT_FOLDED_MODEL;
  return {
    ...base,
    state: settings.side,
    front_color: hexToRgbColor(settings.frontColor),
    back_color: hexToRgbColor(settings.backColor),
  };
}

/** Mirrors the Rust `FoldedFigureModel::default()`. */
const DEFAULT_EXPORT_FOLDED_MODEL: OristudioCpFoldedFigureModel = {
  front_color: { red: 255, green: 255, blue: 50 },
  back_color: { red: 233, green: 233, blue: 233 },
  line_color: { red: 0, green: 0, blue: 0 },
  scale: 1,
  rotation: 0,
  anti_alias: true,
  display_shadows: false,
  state: 'Front0',
  folded_cases: 1,
  transparent_transparency: 16,
  transparency_color: false,
};

function defaultCreaseExportOptions(viewport: OristudioCpViewportOptions): CreaseExportOptions {
  return {
    ...DEFAULT_CREASE_EXPORT_OPTIONS,
    lineStyle: viewport.lineStyle ?? DEFAULT_ORISTUDIO_CP_LINE_STYLE,
    lineWidth: viewport.lineWidth ?? DEFAULT_ORISTUDIO_CP_LINE_WIDTH,
    // The caption starts empty: a document is usually still called "Untitled"
    // when it is exported, and a placeholder title drawn into the image is
    // worse than none.
    caption: EMPTY_CREASE_EXPORT_CAPTION,
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

  /**
   * The simulator's current folded geometry, or null with a message when the
   * simulator has not produced any. Read from the shared worker client -- the same
   * one the panel drives -- because in GPU-render mode positions never cross to
   * the main thread on their own.
   */
  const readFoldedGeometry = async (): Promise<FoldedMesh | null> => {
    if (!get().foldArtifacts) {
      set({ projectMessage: 'Simulate a crease pattern before exporting its folded form' });
      return null;
    }
    // Reads the live session rather than starting one: there is nothing to
    // export from a simulator that was never opened, and spinning a worker up
    // just to ask would take one of the four WebGL2 contexts a worker gets.
    const client = peekSimulatorClient();
    if (!client) {
      set({ projectMessage: 'Open the Simulate workspace before exporting the folded form' });
      return null;
    }
    try {
      const snapshot = await client.exportGeometry();
      return {
        positions: new Float32Array(snapshot.positions),
        triangles: new Uint32Array(snapshot.triangles),
        foldPercent: snapshot.foldPercent,
      };
    } catch {
      // requireSession throws when the worker is running but holds no model.
      set({ projectMessage: 'Open the Simulate workspace before exporting the folded form' });
      return null;
    }
  };

  const resolveCreaseExport = async (
    format: CreaseExportFormat,
    options?: CreaseExportOptions
  ): Promise<{
    options: CreaseExportOptions;
    content: CreaseExportContent;
    fold: FoldDocument;
    segments: CpSegment[];
  } | null> => {
    const foldArtifacts = get().foldArtifacts ?? (await get().ensureFoldArtifacts());
    if (!foldArtifacts) return null;
    // Export the real (untriangulated) crease pattern, not the simulation mesh
    // (simulation_model.fold is triangulated, which adds spurious diagonals).
    const fold = foldArtifacts.fold;
    const segments = segmentFoldDocument(fold);
    if (options) return { options, content: EMPTY_CREASE_EXPORT_CONTENT, fold, segments };
    const label = format.toUpperCase();
    const resolved = await requestCreasePatternExportOptions({
      title: `Export ${label}`,
      format,
      fold,
      segments,
      initialOptions: defaultCreaseExportOptions(get().oristudioCpViewport),
      // Only an editable crease-pattern document can be folded; a TreeMaker
      // design has no kernel handle, so the dialog disables the option.
      foldSegment: get().oristudioCpDocument
        ? (segment, settings) =>
            foldExportSegment(get().oristudioCpDocument, fold, segment, settings)
        : null,
      confirmLabel: `Export ${label}`,
    });
    return resolved ? { ...resolved, fold, segments } : null;
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
      const nextRevision = get().oristudioCpRevision + 1;
      // Apply + render the edit immediately. The always-on CAMV overlay is a passive
      // read-only view of the new document, so it recomputes off the critical path
      // (below) rather than blocking here; the previous overlay stays until it lands.
      set({
        oristudioCpDocument: commandDocument,
        oristudioCpOperationDescriptors: commandDocument.operationDescriptors,
        oristudioCpError: null,
        oristudioCpActiveDiagnosticId: null,
        oristudioCpSelection: selectedLineSelectionFromDocument(commandDocument.document),
        oristudioCpRevision: nextRevision,
        oristudioCpHistoryPast: previousDocument
          ? [
              ...get().oristudioCpHistoryPast,
              cpHistoryEntry(
                previousDocument,
                label,
                previousSelection,
                get().oristudioCpAnnotations,
                get().oristudioCpFoldedFigures,
                get().oristudioCpActiveFoldedFigureId,
                get().oristudioCpInlineSimulations
              ),
            ]
          : get().oristudioCpHistoryPast,
        oristudioCpHistoryFuture: [],
        ...staleFoldArtifactResourceState(get().foldArtifactRevision),
        error: null,
        dirty: true,
        projectMessage: label,
      });
      // The selection above came from the document, not from the setter, so the
      // canvas's one-selection rule has to be applied after the fact.
      get().claimCanvasForCreaseSelection();
      get().scheduleOristudioCamvRefresh();
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
      ...discardCpDocumentState(),
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
    // Inflate any Oriedita text elements the file carried into web-side rich-text
    // boxes (the kernel `texts` vec is only the interchange representation). The
    // kernel copy is then cleared so a later re-snapshot / `.osf` save doesn't
    // double-count them.
    const importedTextAnnotations = oristudioCpDocument
      ? oristudioCpDocument.document.crease_pattern.texts.map((element) =>
          createTextAnnotation({
            center: { x: textCoordinate(element.x), y: textCoordinate(element.y) },
            doc: textDocFromPlainText(element.text),
            plainText: element.text,
          })
        )
      : [];
    if (oristudioCpDocument && importedTextAnnotations.length > 0) {
      oristudioCpDocument = {
        ...oristudioCpDocument,
        document: {
          ...oristudioCpDocument.document,
          crease_pattern: { ...oristudioCpDocument.document.crease_pattern, texts: [] },
        },
      };
      // Keep the live kernel document free of the now-inflated texts so later
      // snapshots and `.osf` saves don't re-introduce them.
      await clearOristudioCpKernelTexts();
    }
    const artifactRevision = get().foldArtifactRevision + 1;
    // A kernel-backed document derives its own fold artifacts from the kernel
    // export, lazily via `ensureFoldArtifacts`. The importer's are in the
    // importer's space -- `normalizePoints` squashes every geometry into the
    // unit square -- so installing them here left the store believing the paper
    // was 1x1 while the document said Oriedita's 400-space. Everything keyed on
    // both then disagreed: region containment found nothing, and the recovery
    // that papered over it re-segmented into a *third* region list. Marking the
    // resource stale is what makes the first real request rebuild from the
    // kernel.
    const artifactState = oristudioCpDocument
      ? staleFoldArtifactResourceState(get().foldArtifactRevision)
      : readyFoldArtifactResourceState(result.foldArtifacts, artifactRevision);
    set({
      ...discardCpDocumentState(),
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
      // A non-.osf crease pattern carries no images; its Oriedita text elements
      // are inflated into rich-text annotations above.
      oristudioCpAnnotations: importedTextAnnotations,
      oristudioCpDocumentExtensions: {},
      nativeProjectExtensions: {},
      projectLoadId: get().projectLoadId + 1,
      currentFileName: filename,
      currentFilePath: source.path ?? null,
      projectMessage: `Loaded ${filename}`,
      selection: { kind: 'tree' },
      oristudioCpSelection: emptyOristudioCpSelection(),
      oristudioCpActiveDiagnosticId: null,
      oristudioCpRevision: 0,
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
    const creasePattern = nativeDocument.creasePattern;
    const restoredDocument = await restoreOristudioCpDocument(creasePattern.document, nativeSource);
    // The engine now owns the crease-pattern snapshot; drop this (potentially large)
    // parsed copy so it can be reclaimed before the FOLD projection is turned into
    // simulator artifacts and uploaded to WebGL below, keeping peak memory lower.
    (creasePattern as { document: unknown }).document = undefined;
    const checked = await refreshAlwaysOnCamvDiagnostics(restoredDocument);
    const documentState = checked.documentState;
    const fold =
      creasePattern.sourceFold ??
      creasePattern.foldProjection ??
      (await exportedEditableFoldProjection());
    if (!fold) throw new Error('Native crease-pattern project does not contain a FOLD projection');

    // Parse straight from the live FOLD object — no stringify + re-parse round-trip.
    const parsed = parseImportedCreasePatternFromFold(fold, {
      format: 'fold',
      filename: `${nativeDocument.title || source.filename}.fold`,
      path: null,
    });
    // Simulation faces are inferred in JS (no flat-folding), so multi-pattern
    // documents work.
    const result = parsed;
    // See the note on the other install site: a kernel-backed document's
    // artifacts come from the kernel, never from the importer.
    const artifactState = staleFoldArtifactResourceState(get().foldArtifactRevision);
    const originalSource = importedSourceFromNativeSource(nativeDocument.creasePattern.source);
    const importedDocument = originalSource
      ? { ...result.document, source: originalSource }
      : result.document;
    set({
      // Overridden field-by-field below; spread for the fold side table,
      // which hydration only refills for the incoming windows.
      ...discardCpDocumentState(),
      // Opening a crease pattern makes the CP editor the active view.
      activePanelId: 'crease-pattern',
      // A CP-only project establishes no design; keep the Design chooser.
      pendingDesignChoice: true,
      project: { ...result.project, title: nativeDocument.title || result.project.title },
      importedCreasePattern: importedDocument,
      oristudioCpDocument: documentState,
      oristudioCpLineage: nativeDocument.creasePattern.lineage,
      oristudioCpAnnotations: [...nativeDocument.creasePattern.images, ...nativeDocument.creasePattern.textAnnotations],
      oristudioCpSelectedAnnotationId: null,
      // Placement and provenance only. Each window's fold is rebuilt from the
      // loaded document below, and until then a window has no mesh to draw.
      oristudioCpInlineSimulations: nativeDocument.creasePattern.inlineSimulations,
      oristudioCpFocusedInlineSimulationId: null,
      oristudioCpDocumentExtensions: nativeDocument.extensions,
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
      lastOptimization: null,
      historyPast: [],
      historyFuture: [],
      clipboardPasteCount: 0,
    });
    // After the document is in place: each restored window needs a fold
    // rebuilt from the creases just loaded, and the artifacts that produces
    // are shared. Not awaited — a window draws nothing until its fold arrives,
    // and blocking the open on twenty of them would freeze it for no benefit.
    void get().hydrateOristudioCpInlineSimulations();
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
      // Overridden field-by-field below; spread for the fold side table,
      // which hydration only refills for the incoming windows.
      ...discardCpDocumentState(),
      oristudioCpDocument: checked.documentState,
      oristudioCpLineage: nativeDocument.creasePattern.lineage,
      oristudioCpAnnotations: [...nativeDocument.creasePattern.images, ...nativeDocument.creasePattern.textAnnotations],
      oristudioCpSelectedAnnotationId: null,
      // Placement and provenance only. Each window's fold is rebuilt from the
      // loaded document below, and until then a window has no mesh to draw.
      oristudioCpInlineSimulations: nativeDocument.creasePattern.inlineSimulations,
      oristudioCpFocusedInlineSimulationId: null,
      oristudioCpDocumentExtensions: nativeDocument.extensions,
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
      // The companion becomes the simulator's source, so whatever the design
      // load left behind must not be simulated in its place.
      ...staleFoldArtifactResourceState(get().foldArtifactRevision),
    });
    void get().hydrateOristudioCpInlineSimulations();
  };

  const loadNativeProject = async (
    text: string,
    source: { filename: string; path?: string | null }
  ) => {
    const nativeProject = parseNativeProjectFile(text);
    const nativeDocument = activeNativeDocument(nativeProject);
    // Retain the file-level extension bag for a lossless save round-trip. Set
    // early; the document load paths below never touch this field.
    set({ nativeProjectExtensions: nativeProject.extensions });
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

  // Serialize every design document the workspace currently holds into one
  // native `.osf` bundle: a TreeMaker tree (if the tree has nodes), a Box-Pleat
  // design (if one is loaded), and the Edit crease pattern as a companion (if
  // present). This is the multi-document path; the workspace container can hold
  // all three at once. `activeMode` records which view was focused, but a design
  // always stays the primary/active document so the single-document loader never
  // drops it when the always-live Edit canvas is the one in focus.
  const saveNativeWorkspaceProject = async (fileService: FileService, forceSaveAs: boolean) => {
    const hasTree = get().project.nodes.length > 0;
    const bpDocument = get().oristudioBpDocument;
    const tmd5Text = hasTree ? await currentTreeTmd5Text() : null;
    const bps = bpDocument ? await exportOristudioBpProjectAsBps() : null;
    const creasePatternCompanion = get().oristudioCpDocument
      ? await currentEditableCreasePatternProjectInput(get().currentFileName, get().currentFilePath)
      : null;
    const bpTitle = bpDocument?.snapshot?.summary?.title || get().project.title;
    const activeMode = resolveNativeActiveMode(get().activeEditingContext, {
      hasTree,
      hasBoxPleat: Boolean(bpDocument),
    });
    const contents = serializeNativeProjectFile(
      createNativeProjectFile({
        workspaceTitle: activeMode === 'box-pleat' ? bpTitle : get().project.title,
        filename: get().currentFileName,
        path: get().currentFilePath,
        activeMode,
        tree: tmd5Text !== null ? { title: get().project.title, tmd5Text } : null,
        boxPleat: bps !== null ? { title: bpTitle, bps } : null,
        creasePattern: creasePatternCompanion,
        extensions: get().nativeProjectExtensions,
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
    // Soft, non-blocking notice when the file embeds a lot of image data.
    const imageBytes = totalCpImageBytes(get().oristudioCpAnnotations.filter(isImageAnnotation));
    const savedMessage =
      imageBytes > IMAGE_TOTAL_BYTES_WARN
        ? `Saved ${result.name} — embeds ~${Math.round(
            imageBytes / (1024 * 1024)
          )} MB of images and may be slow to open or sync.`
        : `Saved ${result.name}`;
    set({
      currentFileName: result.name,
      currentFilePath: result.path,
      dirty: false,
      projectMessage: savedMessage,
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
      images: get().oristudioCpAnnotations.filter(isImageAnnotation),
      textAnnotations: get().oristudioCpAnnotations.filter(isTextAnnotation),
      inlineSimulations: get().oristudioCpInlineSimulations,
      extensions: get().oristudioCpDocumentExtensions,
      appVersion: APP_VERSION,
    };
  };

  // Superset-feature guard: warn before an Oriedita-compatible export drops data
  // it cannot store (images, and future superset features). `.osf` save is
  // lossless and never calls this. Returns `true` *synchronously* when there is
  // nothing to lose, so a lossless export keeps whatever confirm timing it had;
  // otherwise returns a Promise resolving to the user's choice. Callers use the
  // `gate !== true && !(await gate)` idiom so the no-loss path never awaits.
  const guardExportLoss = (format: ExportFormat): true | Promise<boolean> => {
    const warnings = collectExportLossWarnings(format, {
      images: get().oristudioCpAnnotations.filter(isImageAnnotation),
      richText: get().oristudioCpAnnotations.filter(isTextAnnotation),
      inlineSimulations: get().oristudioCpInlineSimulations,
      lineSegments: get().oristudioCpDocument?.document.crease_pattern.line_segments ?? [],
    });
    if (warnings.length === 0) return true;

    // Some losses are refused rather than confirmed. Dropping an image still
    // leaves a crease pattern that means what it meant; dropping a fold angle
    // changes what the pattern *is*, and the re-imported file gives no hint that
    // anything was lost. So there is no "export anyway" for those.
    const blocking = blockingExportLoss(warnings);
    if (blocking.length > 0) {
      // A dead-end "OK" would leave the user where they started, so the
      // affirmative button does the thing the message recommends: FOLD is the
      // one interchange format that carries a fold angle. Re-entering the guard
      // for `fold` is safe -- it is not in the blocking list, so this cannot
      // recurse.
      return requestConfirmation({
        title: `Can’t export to ${exportFormatLabel(format)}`,
        message: `The ${exportFormatLabel(
          format
        )} format can’t store ${describeExportLoss(blocking)}, and re-importing would silently read every crease as a full fold. FOLD stores them, and .osf keeps everything.`,
        confirmLabel: 'Export FOLD instead',
        cancelLabel: 'Cancel',
      }).then(async (useFold) => {
        if (useFold) await get().exportFold();
        // Either way the requested format is not written.
        return false;
      });
    }

    return requestConfirmation({
      title: 'Some features can’t be exported',
      message: `This project uses features the ${exportFormatLabel(
        format
      )} format can’t store. They’ll be omitted from the export: ${describeExportLoss(
        warnings
      )}.`,
      confirmLabel: 'Export anyway',
      cancelLabel: 'Cancel',
    });
  };

  const saveEditableCreasePatternAsOri = async (fileService: FileService) => {
    const documentState = get().oristudioCpDocument;
    if (!documentState) return false;
    const contents = await exportOristudioCpDocumentAsOri(
      flattenTextAnnotations(get().oristudioCpAnnotations)
    );
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
    const contents = await exportOristudioCpDocumentAsOrh(
      flattenTextAnnotations(get().oristudioCpAnnotations)
    );
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
  // active view would drop the design whenever the user saved from Edit. If any
  // design is present (a TreeMaker tree and/or a Box-Pleat design), save a native
  // `.osf` bundling every design plus the Edit crease pattern as a companion; a
  // bare crease pattern (no design) saves as a CP project, preserving its
  // Oriedita-sourced `.ori`/`.orh` save-as special cases.
  const saveActiveProject = async (fileService: FileService, forceSaveAs: boolean) => {
    const hasDesign = get().project.nodes.length > 0 || Boolean(get().oristudioBpDocument);
    if (hasDesign) {
      return saveNativeWorkspaceProject(fileService, forceSaveAs);
    }
    return saveEditableCreasePattern(fileService, forceSaveAs);
  };

  return {
    project: createEmptyProject(),
    workflowTarget: 'treemaker',
    pendingDesignChoice: false,
    projectEstablished: false,
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
    nativeProjectExtensions: {},
    oristudioCpDocumentExtensions: {},
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
        // A document may already have been established while the engine was
        // loading — an imported CP, or an editable CP the Edit surface
        // provisioned for itself on a cold `/edit`. Mark the engine ready but do
        // not run the blank-tree reset below, which would clobber that document
        // (and cause the Edit canvas to re-provision with a visible flash).
        if (get().importedCreasePattern || get().oristudioCpDocument) {
          set({ engineReady: true, oristudioCpOperationDescriptors: operationDescriptors });
          return;
        }
        await releaseEditableCreasePattern();
        set({
          ...discardCpDocumentState(),
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

    createNewProject: async (options = {}) => {
      const preserveEditCanvas = options.preserveEditCanvas ?? false;
      if (rejectDisabled('file.new')) return;
      // When preserving the Edit canvas (design-method chooser) there is nothing
      // to discard and the CP handle must stay alive, so skip the prompt + release.
      if (!preserveEditCanvas && !(await confirmDiscardDirty(get().dirty))) return;
      set({ status: 'loading_engine', error: null, projectMessage: null });
      try {
        if (!preserveEditCanvas) await releaseEditableCreasePattern();
        const api = await getEngine();
        const snapshot = await createBlankTree(api);
        // File>New clears the Edit canvas back to blank. The design-method chooser
        // instead preserves the always-live canvas (its CP wasm handle is never
        // released), so it omits every CP reset and keeps the live document's fold
        // artifacts — spread last so they win over projectStateFromSnapshot's empty
        // fold state. Grouping the resets under one conditional means a newly added
        // oristudioCp* field is preserved automatically, with no capture list to
        // keep in sync.
        const editCanvasState = preserveEditCanvas
          ? pickFoldArtifactResourceState(get())
          : {
              ...discardCpDocumentState(),
              importedCreasePattern: null,
              oristudioCpDocument: null,
              oristudioCpLineage: null,
              oristudioCpError: null,
              oristudioCpCamvResult: null,
              oristudioCpHistoryPast: [],
              oristudioCpHistoryFuture: [],
              oristudioCpSelection: emptyOristudioCpSelection(),
              oristudioCpActiveDiagnosticId: null,
              oristudioCpRevision: 0,
              oristudioCpDocumentExtensions: {},
              creaseColorMode: DEFAULT_CREASE_COLOR_MODE,
              ...emptyFoldArtifactResourceState(),
            };
        set({
          ...projectStateFromSnapshot(snapshot, 'Untitled'),
          activePanelId: 'design',
          workflowTarget: 'treemaker',
          pendingDesignChoice: false,
          oristudioBpDocument: null,
          oristudioBpWorkspace: null,
          nativeProjectExtensions: {},
          projectLoadId: get().projectLoadId + 1,
          currentFileName: defaultNativeFilename('Untitled'),
          currentFilePath: null,
          projectMessage: null,
          selection: { kind: 'tree' },
          toolMode: 'select',
          symmetryAuthoringPairs: [],
          dirty: false,
          lastOptimization: null,
          historyPast: [],
          historyFuture: [],
          clipboardPasteCount: 0,
          ...editCanvasState,
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
          ...discardCpDocumentState(),
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
          // Shared "fresh blank CP" editor state (activePanelId, history reset,
          // projectLoadId bump, fold-artifact invalidation, …) — the same bundle
          // the Edit self-provision uses.
          ...freshEditableCpState(documentState, get()),
          // File › New additionally discards the whole project back to a bare CP:
          project: { ...createEmptyProject(), title: documentState.summary.title ?? 'Untitled CP' },
          workflowTarget: 'treemaker',
          // Creating a bare CP establishes no design, so the Design workspace
          // keeps offering the method chooser (Circle-packed vs Box-pleated).
          pendingDesignChoice: true,
          importedCreasePattern: null,
          currentFileName: defaultNativeFilename(documentState.summary.title ?? 'Untitled CP'),
          currentFilePath: null,
          projectMessage: null,
          selection: { kind: 'tree' },
          nativeProjectExtensions: {},
          // `status: 'crease_pattern_ready'` comes from `freshEditableCpState`.
          dirty: false,
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
        // The always-on CAMV overlay is a passive read-only view of the new document,
        // so a mutating edit applies + renders immediately and recomputes CAMV deferred,
        // off the critical path (below) — mirroring `applyOristudioCpLineMutation`. Awaiting
        // the full-document CheckCamv here is what made edits feel laggy on dense patterns
        // (~200ms before the edit rendered). The previous overlay stays until the new one lands.
        const nextDocument = commandDocument;
        const nextCamvResult = mutatesDocument
          ? get().oristudioCpCamvResult
          : operationId === 'CheckCamv' &&
              commandDocument.lastCommandResult?.operation === 'CheckCamv'
            ? commandDocument.lastCommandResult
            : get().oristudioCpCamvResult;
        const diagnosticEntries = nextDocument.lastCommandResult?.diagnostic_entries ?? [];
        const nextRevision = editsCreasePattern
          ? get().oristudioCpRevision + 1
          : get().oristudioCpRevision;
        set({
          oristudioCpDocument: nextDocument,
          oristudioCpLineage: editsCreasePattern
            ? markCpLineageEdited(get().oristudioCpLineage)
            : get().oristudioCpLineage,
          oristudioCpCamvResult: nextCamvResult,
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
          oristudioCpHistoryPast: previousDocument
            ? mutatesDocument
              ? [
                  ...get().oristudioCpHistoryPast,
                  cpHistoryEntry(
                    previousDocument,
                    String(operationId),
                    previousSelection,
                    get().oristudioCpAnnotations,
                    get().oristudioCpFoldedFigures,
                    get().oristudioCpActiveFoldedFigureId,
                    get().oristudioCpInlineSimulations
                  ),
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
                sequenceTarget: get().sequenceTarget,
                sequencePlan: get().sequencePlan,
                sequenceSimulationFocus: get().sequenceSimulationFocus,
                sequencePlanning: get().sequencePlanning,
                sequenceError: get().sequenceError,
              }),
          error: null,
          dirty: mutatesDocument ? true : get().dirty,
        });
        // The selection above came from the document, not from the setter, so the
        // canvas's one-selection rule has to be applied after the fact. This is
        // the path a select tool takes, which is how a focused simulation window
        // and a crease selection could both be live after the invariant landed.
        get().claimCanvasForCreaseSelection();
        // Recompute the passive CAMV overlay off the critical path (debounced),
        // now that the edit has already rendered.
        if (mutatesDocument) get().scheduleOristudioCamvRefresh();
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
            cpHistoryEntry(
                previousDocument,
                label,
                previousSelection,
                get().oristudioCpAnnotations,
                get().oristudioCpFoldedFigures,
                get().oristudioCpActiveFoldedFigureId,
                get().oristudioCpInlineSimulations
              ),
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
        // Nothing to override: closing the document keeps none of its state.
        ...discardCpDocumentState(),
        // The document the artifacts were derived from is gone with it.
        ...staleFoldArtifactResourceState(get().foldArtifactRevision),
      });
    },

    scheduleOristudioCamvRefresh: () => {
      if (camvRefreshTimer !== null) clearTimeout(camvRefreshTimer);
      const generation = cpSlotGeneration();
      camvRefreshTimer = setTimeout(() => {
        camvRefreshTimer = null;
        // A pending refresh belongs to the document that scheduled it; if the
        // foreground document has changed, the check would run against the wrong
        // kernel handle entirely.
        if (!cpSlotGenerationIsCurrent(generation)) return;
        // Snapshot the document we're checking; the result is discarded if any edit,
        // undo/redo, or load replaces it (reference change) before the check lands.
        const pending = get().oristudioCpDocument;
        if (!pending) return;
        void runOristudioCpCheckCommand('CheckCamv')
          .then((result) => {
            if (!cpSlotGenerationIsCurrent(generation)) return;
            if (get().oristudioCpDocument !== pending) return;
            set({
              oristudioCpCamvResult: result.operation === 'CheckCamv' ? result : null,
            });
          })
          .catch(() => {
            // Leave the existing overlay in place on failure.
          });
      }, CAMV_REFRESH_DEBOUNCE_MS);
    },

    openProject: async (fileService = getFileService()) => {
      if (rejectDisabled('file.open')) return false;
      if (!(await confirmDiscardDirty(get().dirty))) return false;
      set({ pendingDesignChoice: false });
      let openedSourceLength = 0;
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
        openedSourceLength = file.text.length;
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
        set({ status: 'error', error: annotateLargeSourceError(engineError(error), openedSourceLength) });
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
        const cpLoss = guardExportLoss('cp');
        if (cpLoss !== true && !(await cpLoss)) return false;
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
        const foldLoss = guardExportLoss('fold');
        if (foldLoss !== true && !(await foldLoss)) return false;
        const contents =
          get().oristudioCpDocument
            ? await exportOristudioCpDocumentAsFold(
                flattenTextAnnotations(get().oristudioCpAnnotations)
              )
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
        const oriLoss = guardExportLoss('ori');
        if (oriLoss !== true && !(await oriLoss)) return false;
        const contents = await exportOristudioCpDocumentAsOri(
          flattenTextAnnotations(get().oristudioCpAnnotations)
        );
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
        const orhLoss = guardExportLoss('orh');
        if (orhLoss !== true && !(await orhLoss)) return false;
        if (!(await confirmLossyOrhWrite())) return false;
        const contents = await exportOristudioCpDocumentAsOrh(
          flattenTextAnnotations(get().oristudioCpAnnotations)
        );
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
        const svgLoss = guardExportLoss('svg');
        if (svgLoss !== true && !(await svgLoss)) return false;
        const resolved = await resolveCreaseExport('svg', options);
        if (!resolved) return false;
        const contents = serializeCreasePatternSvg(
          resolved.fold,
          resolved.segments,
          resolved.options,
          resolved.content
        );
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
        const pngLoss = guardExportLoss('png');
        if (pngLoss !== true && !(await pngLoss)) return false;
        const resolved = await resolveCreaseExport('png', options);
        if (!resolved) return false;
        const bytes = await renderCreasePatternPng(
          resolved.fold,
          resolved.segments,
          resolved.options,
          resolved.content
        );
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

    exportFoldedFold: async (fileService = getFileService()) => {
      try {
        if (rejectDisabled('file.exportFoldedFold')) return false;
        const geometry = await readFoldedGeometry();
        if (!geometry) return false;
        const source = simulationFoldOf(get().foldArtifacts!);
        const contents = JSON.stringify(foldedFoldDocument(source, geometry), null, 2);
        const result = await fileService.saveTextFile({
          title: 'Export Folded FOLD',
          contents,
          suggestedName: defaultFilename(`${get().project.title} folded`, 'fold'),
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

    exportObj: async (fileService = getFileService()) => {
      try {
        if (rejectDisabled('file.exportObj')) return false;
        const geometry = await readFoldedGeometry();
        if (!geometry) return false;
        const result = await fileService.saveTextFile({
          title: 'Export Folded OBJ',
          contents: foldedObj(geometry, get().project.title || 'folded'),
          suggestedName: defaultFilename(`${get().project.title} folded`, 'obj'),
          path: null,
          extensions: ['obj'],
        });
        if (!result) return false;
        set({ projectMessage: `Exported ${result.name}` });
        return true;
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
        return false;
      }
    },

    exportStl: async (fileService = getFileService()) => {
      try {
        if (rejectDisabled('file.exportStl')) return false;
        const geometry = await readFoldedGeometry();
        if (!geometry) return false;
        const result = await fileService.saveBinaryFile({
          title: 'Export Folded STL',
          bytes: foldedStl(geometry),
          suggestedName: defaultFilename(`${get().project.title} folded`, 'stl'),
          path: null,
          extensions: ['stl'],
          mimeType: 'model/stl',
        });
        if (!result) return false;
        set({ projectMessage: `Exported ${result.name}` });
        return true;
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
        return false;
      }
    },

    exportOristudioCpSegment: async (
      format: SegmentExportFormat,
      segmentId: number,
      fileService = getFileService()
    ) => {
      try {
        // Segments-only artifacts (no simulation mesh) keep per-region export off
        // the multi-second prepareSimulationFold path; captured once so the segment
        // id can't drift under a concurrent edit mid-export.
        const foldArtifacts = await ensureCpSegmentationArtifacts(get().oristudioCpDocument?.document);
        if (!foldArtifacts) return false;
        const patternTitle = `${get().project.title} pattern ${segmentId + 1}`;

        if (isSegmentImageFormat(format)) {
          // Open the export-image modal pre-scoped to this segment.
          const fold = foldArtifacts.fold;
          const segments = segmentFoldDocument(fold);
          const label = format.toUpperCase();
          const resolved = await requestCreasePatternExportOptions({
            title: `Export ${label}`,
            format,
            fold,
            segments,
            initialOptions: { ...defaultCreaseExportOptions(get().oristudioCpViewport), segmentId },
            // Mirrors resolveCreaseExport: only an editable crease pattern has a
            // kernel handle to fold with, so a TreeMaker design disables it.
            foldSegment: get().oristudioCpDocument
              ? (segment, settings) =>
                  foldExportSegment(get().oristudioCpDocument, fold, segment, settings)
              : null,
            confirmLabel: `Export ${label}`,
          });
          if (!resolved) return false;
          if (format === 'svg') {
            const result = await fileService.saveTextFile({
              title: 'Export Crease Pattern SVG',
              contents: serializeCreasePatternSvg(fold, segments, resolved.options, resolved.content),
              suggestedName: defaultFilename(patternTitle, 'svg'),
              path: null,
              extensions: ['svg'],
            });
            if (!result) return false;
            set({ projectMessage: `Exported ${result.name}` });
            return true;
          }
          const bytes = await renderCreasePatternPng(fold, segments, resolved.options, resolved.content);
          const result = await fileService.saveBinaryFile({
            title: 'Export Crease Pattern PNG',
            bytes,
            suggestedName: defaultFilename(patternTitle, 'png'),
            path: null,
            extensions: ['png'],
            mimeType: 'image/png',
          });
          if (!result) return false;
          set({ projectMessage: `Exported ${result.name}` });
          return true;
        }

        // File formats: extract the sub-fold and serialize it through the kernel.
        const subFold = buildSegmentSubFold(foldArtifacts, segmentId);
        if (!subFold) return false;
        const contents = await exportFoldFrameAsFormat(JSON.stringify(subFold), format);
        const result = await fileService.saveTextFile({
          title: `Export ${format.toUpperCase()}`,
          contents,
          suggestedName: defaultFilename(patternTitle, format),
          path: null,
          extensions: [format],
        });
        if (!result) return false;
        set({ projectMessage: `Exported ${result.name}` });
        return true;
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
        return false;
      }
    },

    exportOristudioCpFoldedFigure: async (
      format: FoldedFigureExportFormat,
      figureId: string,
      fileService = getFileService()
    ) => {
      try {
        const figure = get().oristudioCpFoldedFigures.find(
          (candidate) => candidate.id === figureId
        );
        // Serialized straight from the snapshot the canvas is drawing, so the
        // file is the figure the user is looking at — no second fold.
        const snapshot = figure?.renderSnapshot;
        if (!snapshot) {
          const message = 'This folded model has nothing to export yet';
          set({
            oristudioCpError: message,
            error: { code: 'invalid_operation', message },
          });
          return false;
        }
        const name = `${get().project.title} ${figure.title}`;

        if (format === 'svg') {
          const contents = serializeFoldedFigureSvg(snapshot);
          if (!contents) return false;
          const result = await fileService.saveTextFile({
            title: 'Export Folded Figure SVG',
            contents,
            suggestedName: defaultFilename(name, 'svg'),
            path: null,
            extensions: ['svg'],
          });
          if (!result) return false;
          set({ projectMessage: `Exported ${result.name}` });
          return true;
        }

        const bytes = await renderFoldedFigurePng(snapshot);
        if (!bytes) return false;
        const result = await fileService.saveBinaryFile({
          title: 'Export Folded Figure PNG',
          bytes,
          suggestedName: defaultFilename(name, 'png'),
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

    applyDesignRoute: (variant) => {
      // Reflect the Design sub-route into the variant fields. Layout rebuild and
      // document provisioning are the caller's concern (WorkspaceRoute).
      const state = get();
      if (variant === 'nux') {
        if (!state.pendingDesignChoice) set({ pendingDesignChoice: true });
      } else if (variant === 'box-pleat') {
        if (state.pendingDesignChoice || state.workflowTarget !== 'box-pleat') {
          set({ pendingDesignChoice: false, workflowTarget: 'box-pleat' });
        }
      } else {
        if (state.pendingDesignChoice || state.workflowTarget !== 'treemaker') {
          set({ pendingDesignChoice: false, workflowTarget: 'treemaker' });
        }
      }
    },

    chooseDesignMethod: async (target) => {
      // Choosing a design method establishes a design surface but must not touch
      // the always-live Edit canvas. The creators run in preserveEditCanvas mode,
      // where they keep the CP wasm handle alive and omit every Edit-canvas field
      // from their set() — so no snapshot/restore is needed here. The only thing
      // to carry across is dirtiness: establishing a design must not silently mark
      // a previously-dirty document clean.
      // Establish the project up front (synchronously, before the async creation
      // and before the chooser navigates to the sub-route) so the route guard
      // doesn't bounce a freshly-chosen design — a blank TreeMaker tree has no
      // document content for the presence subscription to detect.
      set({ projectEstablished: true });
      const wasDirty = get().dirty;
      if (target === 'box-pleat') {
        await get().createOristudioBpProject({ confirmDiscard: false, preserveEditCanvas: true });
      } else {
        await get().createNewProject({ preserveEditCanvas: true });
      }
      if (get().dirty !== wasDirty) set({ dirty: get().dirty || wasDirty });
    },
  };
};
