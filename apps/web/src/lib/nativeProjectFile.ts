import type { FoldArtifacts, FoldDocument } from '../engine/types';
import { IDENTITY_FOLDED_PLACEMENT } from '../engine/oristudioCpTypes';
import type {
  FoldedFigurePlacement,
  FoldedSourceBounds,
  OristudioCpDocumentSnapshot,
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureStatus,
} from '../engine/oristudioCpTypes';
import type { ImportedCreasePatternSource } from './creasePatternImport';
import type { Point } from './geometry';
import { ProjectFileFormatError } from './projectFileError';
import type { CreaseColorMode } from './sampleProject';
import type { OristudioCpSelection, OristudioCpViewportOptions } from './creasePatternViewport';
import {
  importedCpLineage,
  normalizeCpLineage,
  type OristudioCpLineage,
} from './oristudioCpLineage';
import { validateCpImages, type CpImage } from '../cp-workspace/images/cpImage';
import {
  bpDocumentSymmetry,
  defaultBpDocumentSymmetry,
  validateBpDocumentSymmetry,
  type BpDocumentSymmetry,
} from './bpTreeSymmetry';
import {
  validateTextAnnotations,
  type TextAnnotation,
} from '../cp-workspace/annotations/textAnnotation';
import { validateInlineSimulations } from '../cp-workspace/inlineSimulation/inlineSimulationFile';
import type { InlineSimulation } from '../cp-workspace/inlineSimulation/inlineSimulation';
import { validateUserCamera } from '../cp-workspace/renderer/camera';
import type { UserCamera } from '../cp-workspace/renderer/camera';

export const NATIVE_PROJECT_FORMAT = 'oristudio.project';
export const NATIVE_PROJECT_EXTENSION = 'osf';
export const NATIVE_PROJECT_MIME_TYPE = 'application/vnd.oristudio.project+json';
export const NATIVE_PROJECT_SCHEMA_VERSION = 7;

export type NativeProjectDocumentKind = 'treemaker-tree' | 'crease-pattern' | 'box-pleat';

/**
 * Which document the workspace was focused on when saved. This is the file's
 * own concept — distinct from the runtime `DocumentMode`/editing-context types —
 * so the format can grow document kinds (e.g. box-pleat) without dragging in the
 * viewport-surface unions.
 */
export type NativeProjectActiveMode = 'tree' | 'crease-pattern' | 'box-pleat';

export interface NativeProjectActor {
  app: 'Ori Studio';
  version: string;
  savedAt: string;
}

export interface NativeProjectSource {
  format: 'osf' | 'tmd' | 'tmd4' | 'tmd5' | 'cp' | 'fold' | 'ori' | 'orh';
  filename: string;
  path: string | null;
}

export interface NativeProjectBaseDocumentV1 {
  id: string;
  kind: NativeProjectDocumentKind;
  title: string;
  source: NativeProjectSource | null;
  extensions: Record<string, unknown>;
}

export interface NativeTreeDocumentV1 extends NativeProjectBaseDocumentV1 {
  kind: 'treemaker-tree';
  tree: {
    format: 'tmd5';
    text: string;
  };
}

export interface NativeCreasePatternDocumentV1 extends NativeProjectBaseDocumentV1 {
  kind: 'crease-pattern';
  creasePattern: {
    engine: 'oristudio-cp';
    document: OristudioCpDocumentSnapshot;
    source: ImportedCreasePatternSource | NativeProjectSource | null;
    foldProjection: FoldDocument | null;
    sourceFold: FoldDocument | null;
    lineage: OristudioCpLineage;
    /**
     * Superset feature (no Oriedita equivalent): reference images placed on the
     * canvas. Persisted only in `.osf`; omitted from every Oriedita export.
     * Added in schema v3; absent in v1/v2 files (migrated to `[]`).
     */
    images: CpImage[];
    /**
     * Superset feature: rich-text boxes placed on the canvas. Persisted only in
     * `.osf` (Oriedita export flattens each to `{x,y,text}`). Added in schema v4;
     * absent in older files (migrated to `[]`).
     */
    textAnnotations: TextAnnotation[];
    /**
     * Superset feature: live simulation windows placed on the canvas. Added in
     * schema v5; absent in older files (migrated to `[]`).
     *
     * Placement and provenance only — the captured fold each window runs is
     * rebuilt on load rather than stored. See
     * `implementation-plans/persist-inline-simulations.md`.
     */
    inlineSimulations: InlineSimulation[];
  };
  viewState: {
    creaseColorMode: CreaseColorMode;
    selection: OristudioCpSelection;
    viewport: OristudioCpViewportOptions;
    /**
     * The canvas camera the document was last saved at — centre, zoom, and
     * rotation. Added in schema v7; absent in older files, which open auto-fit
     * as they always did.
     *
     * The view is document state, not a transient way of looking at the
     * document: a rotated canvas is how hex-pleated designs are authored for
     * their whole life, and every object created on that canvas is oriented
     * relative to it. Reopening square would tilt all of them.
     */
    camera: UserCamera | null;
    foldedFigures: OristudioCpFoldedFigureEntry[];
    activeFoldedFigureId: string | null;
  };
}

export interface NativeBoxPleatDocumentV1 extends NativeProjectBaseDocumentV1 {
  kind: 'box-pleat';
  project: {
    engine: 'oristudio-bp';
    format: 'bps';
    text: string;
  };
  /**
   * Superset feature (no Box Pleating Studio equivalent): which flaps mirror
   * which, whether mirror draw is on, and which fold of the paper the mirror
   * represents. Persisted only in `.osf`; omitted from `.bps`/`.bpz` and every
   * other export. Added in schema v6; absent in older files, which open with
   * {@link ../lib/bpTreeSymmetry.defaultBpDocumentSymmetry}.
   *
   * The mirror *axis* is deliberately not here — it is derived from the sheet on
   * load, so it cannot go stale when the sheet is resized.
   */
  symmetry: BpDocumentSymmetry;
}

export type NativeProjectDocumentV1 =
  | NativeTreeDocumentV1
  | NativeCreasePatternDocumentV1
  | NativeBoxPleatDocumentV1;

export interface NativeProjectFileV1 {
  format: typeof NATIVE_PROJECT_FORMAT;
  schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  minimumReaderSchemaVersion: 1;
  createdBy: NativeProjectActor;
  modifiedBy: NativeProjectActor;
  workspace: {
    id: string;
    title: string;
    activeDocumentId: string;
    activeMode: NativeProjectActiveMode;
    documents: NativeProjectDocumentV1[];
    viewState: Record<string, unknown>;
  };
  artifacts: {
    fold?: {
      documentId: string;
      value: FoldArtifacts;
    };
  };
  extensions: Record<string, unknown>;
}

export type NativeProjectFile = NativeProjectFileV1;

export interface NativeTreeProjectInput {
  title: string;
  filename: string;
  path: string | null;
  tmd5Text: string;
  creasePatternCompanion?: Omit<
    NativeCreasePatternProjectInput,
    'appVersion' | 'filename' | 'path' | 'now'
  > | null;
  appVersion: string;
  now?: Date;
}

export interface NativeCreasePatternProjectInput {
  title: string;
  filename: string;
  path: string | null;
  document: OristudioCpDocumentSnapshot;
  source: ImportedCreasePatternSource | NativeProjectSource | null;
  foldProjection: FoldDocument | null;
  sourceFold?: FoldDocument | null;
  foldArtifacts: FoldArtifacts | null;
  creaseColorMode: CreaseColorMode;
  selection: OristudioCpSelection;
  viewport: OristudioCpViewportOptions;
  /**
   * Canvas camera to persist (schema v7). Optional so older call sites and
   * tests omit it; written as `null`, which reads back as "auto-fit".
   */
  camera?: UserCamera | null;
  foldedFigures: OristudioCpFoldedFigureEntry[];
  activeFoldedFigureId: string | null;
  lineage: OristudioCpLineage;
  /**
   * Superset feature: reference images placed on the canvas (§ image support).
   * Optional so older call sites (and tests) omit it; written as `[]` when absent.
   */
  images?: CpImage[];
  /** Superset feature: rich-text boxes placed on the canvas (schema v4). */
  textAnnotations?: TextAnnotation[];
  /** Superset feature: inline simulation windows (schema v5). */
  inlineSimulations?: InlineSimulation[];
  /**
   * Document-level extension bag carried forward from a loaded file. Threading
   * this back on save preserves data written by a *newer* app version across a
   * round-trip through an *older* one (forward-compat). Defaults to `{}`.
   */
  extensions?: Record<string, unknown>;
  appVersion: string;
  now?: Date;
}

export interface NativeBoxPleatProjectInput {
  title: string;
  filename: string;
  path: string | null;
  /** The Box Pleating Studio project serialized as `.bps` JSON text. */
  bps: string;
  /**
   * Superset feature: mirror-draw state (schema v6). Optional so older call
   * sites and tests omit it; written as the default when absent.
   */
  symmetry?: BpDocumentSymmetry;
  /** The crease pattern sent to Edit, bundled so the workspace round-trips. */
  creasePatternCompanion?: Omit<
    NativeCreasePatternProjectInput,
    'appVersion' | 'filename' | 'path' | 'now'
  > | null;
  appVersion: string;
  now?: Date;
}

/**
 * Serialize whatever documents the workspace currently holds into a single
 * native project file. Any combination of a TreeMaker tree, a Box-Pleat design,
 * and a crease pattern may be present; each is emitted only when supplied. This
 * is the multi-document path — the single-kind `createNative*ProjectFile`
 * helpers below are thin wrappers over it.
 */
export interface NativeProjectDocumentsInput {
  /** Workspace-level title (usually the active document's title). */
  workspaceTitle: string;
  filename: string;
  path: string | null;
  /** Which document the workspace was focused on when saved. */
  activeMode: NativeProjectActiveMode;
  tree?: { title: string; tmd5Text: string } | null;
  boxPleat?: { title: string; bps: string; symmetry?: BpDocumentSymmetry } | null;
  creasePattern?: Omit<
    NativeCreasePatternProjectInput,
    'appVersion' | 'filename' | 'path' | 'now'
  > | null;
  /**
   * File-level extension bag carried forward from a loaded project, preserved on
   * save for forward-compat (see the doc-level note on
   * {@link NativeCreasePatternProjectInput.extensions}). Defaults to `{}`.
   */
  extensions?: Record<string, unknown>;
  appVersion: string;
  now?: Date;
}

const TREE_DOCUMENT_ID = 'tree';
const BOX_PLEAT_DOCUMENT_ID = 'box-pleat';
const CREASE_PATTERN_DOCUMENT_ID = 'crease-pattern';

export function isNativeProjectFilename(filename: string): boolean {
  return /\.osf$/i.test(filename);
}

export function serializeNativeProjectFile(file: NativeProjectFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function parseNativeProjectFile(text: string): NativeProjectFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid Ori Studio project JSON';
    // Malformed JSON is a complete answer; a RangeError ("Invalid string length",
    // heap exhaustion) is not, so that one stays open to the size annotation.
    if (error instanceof SyntaxError) {
      throw new ProjectFileFormatError('project_file_damaged', message, { cause: error });
    }
    throw new Error(message, { cause: error });
  }
  return migrateNativeProjectFile(parsed);
}

export function migrateNativeProjectFile(value: unknown): NativeProjectFile {
  // Nothing here identifies the file as ours, so it is the wrong file rather
  // than a broken one — a JSON array, or someone's .fold renamed to .osf.
  if (!isRecord(value)) {
    throw new ProjectFileFormatError(
      'project_file_unrecognized',
      'Ori Studio project must contain a JSON object'
    );
  }
  if (value.format !== NATIVE_PROJECT_FORMAT) {
    throw new ProjectFileFormatError(
      'project_file_unrecognized',
      'File is not an Ori Studio project'
    );
  }

  const minimumReaderSchemaVersion = numberField(value.minimumReaderSchemaVersion);
  if (
    minimumReaderSchemaVersion !== null &&
    minimumReaderSchemaVersion > NATIVE_PROJECT_SCHEMA_VERSION
  ) {
    throw new ProjectFileFormatError(
      'project_file_too_new',
      `Ori Studio project requires reader schema ${minimumReaderSchemaVersion}, but this app supports ${NATIVE_PROJECT_SCHEMA_VERSION}`
    );
  }

  const schemaVersion = numberField(value.schemaVersion);
  if (
    schemaVersion === 1 ||
    schemaVersion === 2 ||
    schemaVersion === 3 ||
    schemaVersion === 4 ||
    schemaVersion === 5 ||
    schemaVersion === 6 ||
    schemaVersion === 7
  ) {
    return validateV1(value);
  }
  if (schemaVersion === null) {
    throw new ProjectFileFormatError(
      'project_file_damaged',
      'Ori Studio project is missing schemaVersion'
    );
  }
  // A version above the newest we know is a file from the future — the one case
  // here the user can act on, by updating. Anything else (0, 2.5, -1) is a file
  // no build ever wrote.
  throw new ProjectFileFormatError(
    schemaVersion > NATIVE_PROJECT_SCHEMA_VERSION ? 'project_file_too_new' : 'project_file_damaged',
    `Unsupported Ori Studio project schemaVersion ${schemaVersion}`
  );
}

export function createNativeProjectFile(
  input: NativeProjectDocumentsInput
): NativeProjectFileV1 {
  const actor = actorFromInput(input);
  const documents: NativeProjectDocumentV1[] = [];

  if (input.tree) {
    documents.push({
      id: TREE_DOCUMENT_ID,
      kind: 'treemaker-tree',
      title: input.tree.title.trim() || 'Untitled',
      source: sourceFromFilename(input.filename, input.path),
      tree: {
        format: 'tmd5',
        text: input.tree.tmd5Text,
      },
      extensions: {},
    });
  }

  if (input.boxPleat) {
    documents.push({
      id: BOX_PLEAT_DOCUMENT_ID,
      kind: 'box-pleat',
      title: input.boxPleat.title.trim() || 'Untitled',
      source: sourceFromFilename(input.filename, input.path),
      project: {
        engine: 'oristudio-bp',
        format: 'bps',
        text: input.boxPleat.bps,
      },
      // Projected here, not at the call site: the runtime symmetry state is a
      // subtype of the persisted one, so handing it over whole typechecks and
      // then writes the derived axis into the file.
      symmetry: bpDocumentSymmetry(input.boxPleat.symmetry ?? defaultBpDocumentSymmetry()),
      extensions: {},
    });
  }

  if (input.creasePattern) {
    documents.push(
      createNativeCreasePatternDocument(
        {
          ...input.creasePattern,
          filename: input.filename,
          path: input.path,
          appVersion: input.appVersion,
          now: input.now,
        },
        CREASE_PATTERN_DOCUMENT_ID
      )
    );
  }

  return {
    format: NATIVE_PROJECT_FORMAT,
    schemaVersion: NATIVE_PROJECT_SCHEMA_VERSION,
    minimumReaderSchemaVersion: 1,
    createdBy: actor,
    modifiedBy: actor,
    workspace: {
      id: 'workspace',
      title: input.workspaceTitle.trim() || 'Untitled',
      activeDocumentId: activeDocumentIdForMode(input.activeMode, documents),
      activeMode: input.activeMode,
      documents,
      viewState: {},
    },
    artifacts: {},
    extensions: input.extensions ?? {},
  };
}

/** Resolve which document the file's `activeMode` refers to. */
function activeDocumentIdForMode(
  mode: NativeProjectActiveMode,
  documents: NativeProjectDocumentV1[]
): string {
  const kind: NativeProjectDocumentKind =
    mode === 'tree' ? 'treemaker-tree' : mode === 'box-pleat' ? 'box-pleat' : 'crease-pattern';
  const match = documents.find((document) => document.kind === kind);
  return (match ?? documents[0])?.id ?? kind;
}

export function createNativeTreeProjectFile(input: NativeTreeProjectInput): NativeProjectFileV1 {
  return createNativeProjectFile({
    workspaceTitle: input.title,
    filename: input.filename,
    path: input.path,
    activeMode: 'tree',
    tree: { title: input.title, tmd5Text: input.tmd5Text },
    creasePattern: input.creasePatternCompanion ?? null,
    appVersion: input.appVersion,
    now: input.now,
  });
}

export function createNativeBoxPleatProjectFile(
  input: NativeBoxPleatProjectInput
): NativeProjectFileV1 {
  return createNativeProjectFile({
    workspaceTitle: input.title,
    filename: input.filename,
    path: input.path,
    activeMode: 'box-pleat',
    boxPleat: { title: input.title, bps: input.bps, symmetry: input.symmetry },
    creasePattern: input.creasePatternCompanion ?? null,
    appVersion: input.appVersion,
    now: input.now,
  });
}

export function createNativeCreasePatternProjectFile(
  input: NativeCreasePatternProjectInput
): NativeProjectFileV1 {
  const actor = actorFromInput(input);
  const title = input.title.trim() || input.document.title || 'Untitled CP';
  return {
    format: NATIVE_PROJECT_FORMAT,
    schemaVersion: NATIVE_PROJECT_SCHEMA_VERSION,
    minimumReaderSchemaVersion: 1,
    createdBy: actor,
    modifiedBy: actor,
    workspace: {
      id: 'workspace',
      title,
      activeDocumentId: 'crease-pattern',
      activeMode: 'crease-pattern',
      documents: [
        createNativeCreasePatternDocument(input, 'crease-pattern'),
      ],
      viewState: {},
    },
    artifacts:
      input.foldArtifacts && input.foldProjection
        ? {
            fold: {
              documentId: 'crease-pattern',
              value: input.foldArtifacts,
            },
          }
        : {},
    extensions: {},
  };
}

function createNativeCreasePatternDocument(
  input: NativeCreasePatternProjectInput,
  id: string
): NativeCreasePatternDocumentV1 {
  const title = input.title.trim() || input.document.title || 'Untitled CP';
  return {
    id,
    kind: 'crease-pattern',
    title,
    source: sourceFromFilename(input.filename, input.path),
    creasePattern: {
      engine: 'oristudio-cp',
      document: input.document,
      source: input.source,
      foldProjection: input.foldProjection,
      sourceFold: input.sourceFold ?? null,
      lineage: input.lineage,
      images: input.images ?? [],
      textAnnotations: input.textAnnotations ?? [],
      inlineSimulations: input.inlineSimulations ?? [],
    },
    viewState: {
      creaseColorMode: input.creaseColorMode,
      selection: input.selection,
      viewport: input.viewport,
      camera: input.camera ?? null,
      foldedFigures: nativeFoldedFigures(input.foldedFigures),
      activeFoldedFigureId: activeFoldedFigureId(
        input.foldedFigures,
        input.activeFoldedFigureId
      ),
    },
    // Preserve any extension bag carried forward from a loaded file rather than
    // clobbering it with `{}` — keeps forward-compat data written by a newer app
    // version across a round-trip through this one.
    extensions: input.extensions ?? {},
  };
}

function nativeFoldedFigures(entries: OristudioCpFoldedFigureEntry[]): OristudioCpFoldedFigureEntry[] {
  return entries.map((entry) => ({
    ...entry,
    handle: null,
    status: entry.status === 'loading' ? 'stale' : entry.status,
  }));
}

function activeFoldedFigureId(
  entries: OristudioCpFoldedFigureEntry[],
  activeId: string | null
): string | null {
  return activeId && entries.some((entry) => entry.id === activeId) ? activeId : null;
}

function validateFoldedFigures(value: unknown): OristudioCpFoldedFigureEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => validateFoldedFigure(entry, index));
}

function validateFoldedFigure(value: unknown, index: number): OristudioCpFoldedFigureEntry {
  const entry = recordField(value, `document.viewState.foldedFigures[${index}]`);
  const snapshot = isRecord(entry.snapshot)
    ? (entry.snapshot as unknown as OristudioCpFoldedFigureEntry['snapshot'])
    : null;
  return {
    id: stringField(entry.id, `document.viewState.foldedFigures[${index}].id`),
    title: stringField(entry.title, `document.viewState.foldedFigures[${index}].title`),
    handle: null,
    sourceKind: foldedFigureSourceKind(entry.sourceKind),
    sourceCpRevision: numberField(entry.sourceCpRevision),
    startingFaceId: numberField(entry.startingFaceId),
    displayStyle:
      foldedFigureDisplayStyle(entry.displayStyle) ??
      foldedFigureDisplayStyle(snapshot?.display_style) ??
      'Paper5',
    status: foldedFigureStatus(entry.status),
    snapshot,
    renderSnapshot: isRecord(entry.renderSnapshot)
      ? (entry.renderSnapshot as unknown as OristudioCpFoldedFigureEntry['renderSnapshot'])
      : null,
    placement: foldedFigurePlacement(entry),
    sourceBounds: foldedSourceBoundsField(entry.sourceBounds),
    sourceFingerprint:
      typeof entry.sourceFingerprint === 'string' ? entry.sourceFingerprint : null,
    sourceLineIds: Array.isArray(entry.sourceLineIds)
      ? entry.sourceLineIds.filter((id): id is number => typeof id === 'number')
      : [],
    error: typeof entry.error === 'string' ? entry.error : null,
  };
}

/**
 * A folded figure's source region, absent in files written before provenance
 * was tracked. Such a figure simply offers no refold — see
 * `lib/foldedFigureStaleness.ts` — so a missing or malformed box is null rather
 * than an error.
 */
function foldedSourceBoundsField(value: unknown): FoldedSourceBounds | null {
  if (!isRecord(value)) return null;
  const minX = finiteNumber(value.minX);
  const minY = finiteNumber(value.minY);
  const maxX = finiteNumber(value.maxX);
  const maxY = finiteNumber(value.maxY);
  if (minX === null || minY === null || maxX === null || maxY === null) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * A folded figure's display placement, tolerating both shapes we have written:
 * the current `placement` record, and the pre-placement `displayOffset` point,
 * which is exactly an identity placement carrying that offset.
 */
function foldedFigurePlacement(entry: Record<string, unknown>): FoldedFigurePlacement {
  const placement = isRecord(entry.placement) ? entry.placement : null;
  if (placement) {
    return {
      offset: pointField(placement.offset) ?? { x: 0, y: 0 },
      scale: positiveNumber(placement.scale) ?? 1,
      rotation: finiteNumber(placement.rotation) ?? 0,
    };
  }
  const legacyOffset = pointField(entry.displayOffset);
  return legacyOffset ? { offset: legacyOffset, scale: 1, rotation: 0 } : IDENTITY_FOLDED_PLACEMENT;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A scale must be finite and > 0, else the figure would collapse or invert. */
function positiveNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function foldedFigureStatus(value: unknown): OristudioCpFoldedFigureStatus {
  if (
    value === 'ready' ||
    value === 'stale' ||
    value === 'loading' ||
    value === 'error' ||
    value === 'unsupported'
  ) {
    return value === 'loading' ? 'stale' : value;
  }
  return 'stale';
}

function foldedFigureSourceKind(value: unknown): OristudioCpFoldedFigureEntry['sourceKind'] {
  if (
    value === 'generated-from-current-cp' ||
    value === 'imported-folded-form' ||
    value === 'imported-preserved-frame'
  ) {
    return value;
  }
  return 'generated-from-current-cp';
}

function foldedFigureDisplayStyle(
  value: unknown
): OristudioCpFoldedFigureDisplayStyle | null {
  if (
    value === 'None0' ||
    value === 'Development1' ||
    value === 'Wire2' ||
    value === 'Transparent3' ||
    value === 'Development4' ||
    value === 'Paper5'
  ) {
    return value;
  }
  return null;
}

export function activeNativeDocument(file: NativeProjectFile): NativeProjectDocumentV1 {
  const active =
    file.workspace.documents.find((document) => document.id === file.workspace.activeDocumentId) ??
    file.workspace.documents[0];
  if (!active) {
    throw new ProjectFileFormatError(
      'project_file_damaged',
      'Ori Studio project does not contain any documents'
    );
  }
  return active;
}

function actorFromInput(input: { appVersion: string; now?: Date }): NativeProjectActor {
  return {
    app: 'Ori Studio',
    version: input.appVersion,
    savedAt: (input.now ?? new Date()).toISOString(),
  };
}

function sourceFromFilename(filename: string, path: string | null): NativeProjectSource | null {
  const format = extensionFormat(filename);
  if (!format) return null;
  return {
    format,
    filename,
    path,
  };
}

function extensionFormat(filename: string): NativeProjectSource['format'] | null {
  const extension = filename.split('.').pop()?.toLowerCase();
  if (
    extension === 'osf' ||
    extension === 'tmd' ||
    extension === 'tmd4' ||
    extension === 'tmd5' ||
    extension === 'cp' ||
    extension === 'fold' ||
    extension === 'ori' ||
    extension === 'orh'
  ) {
    return extension;
  }
  return null;
}

function validateV1(value: Record<string, unknown>): NativeProjectFileV1 {
  const workspace = recordField(value.workspace, 'workspace');
  const documents = arrayField(workspace.documents, 'workspace.documents').map(validateDocumentV1);
  const activeDocumentId = stringField(workspace.activeDocumentId, 'workspace.activeDocumentId');
  const activeMode = stringField(workspace.activeMode, 'workspace.activeMode');
  if (activeMode !== 'tree' && activeMode !== 'crease-pattern' && activeMode !== 'box-pleat') {
    throw new ProjectFileFormatError(
      'project_file_damaged',
      `Unsupported Ori Studio activeMode ${JSON.stringify(activeMode)}`
    );
  }
  if (!documents.some((document) => document.id === activeDocumentId)) {
    throw new ProjectFileFormatError(
      'project_file_damaged',
      'Ori Studio project activeDocumentId does not match a document'
    );
  }

  return {
    format: NATIVE_PROJECT_FORMAT,
    schemaVersion: NATIVE_PROJECT_SCHEMA_VERSION,
    minimumReaderSchemaVersion: 1,
    createdBy: validateActor(recordField(value.createdBy, 'createdBy')),
    modifiedBy: validateActor(recordField(value.modifiedBy, 'modifiedBy')),
    workspace: {
      id: stringField(workspace.id, 'workspace.id'),
      title: stringField(workspace.title, 'workspace.title'),
      activeDocumentId,
      activeMode,
      documents,
      viewState: isRecord(workspace.viewState) ? workspace.viewState : {},
    },
    artifacts: validateArtifacts(value.artifacts),
    extensions: isRecord(value.extensions) ? value.extensions : {},
  };
}

function validateDocumentV1(value: unknown): NativeProjectDocumentV1 {
  const document = recordField(value, 'workspace.documents[]');
  const id = stringField(document.id, 'document.id');
  const title = stringField(document.title, 'document.title');
  const kind = stringField(document.kind, 'document.kind');
  const source = validateSource(document.source);
  const extensions = isRecord(document.extensions) ? document.extensions : {};

  if (kind === 'treemaker-tree') {
    const tree = recordField(document.tree, 'document.tree');
    const format = stringField(tree.format, 'document.tree.format');
    if (format !== 'tmd5') {
      throw new ProjectFileFormatError(
        'project_file_damaged',
        `Unsupported tree document format ${format}`
      );
    }
    return {
      id,
      kind,
      title,
      source,
      tree: {
        format: 'tmd5',
        text: stringField(tree.text, 'document.tree.text'),
      },
      extensions,
    };
  }

  if (kind === 'crease-pattern') {
    const creasePattern = recordField(document.creasePattern, 'document.creasePattern');
    const engine = stringField(creasePattern.engine, 'document.creasePattern.engine');
    if (engine !== 'oristudio-cp') {
      throw new ProjectFileFormatError(
        'project_file_damaged',
        `Unsupported crease-pattern engine ${JSON.stringify(engine)}`
      );
    }
    const viewState = isRecord(document.viewState) ? document.viewState : {};
    const foldedFigures = validateFoldedFigures(viewState.foldedFigures);
    return {
      id,
      kind,
      title,
      source,
      creasePattern: {
        engine,
        document: recordField(
          creasePattern.document,
          'document.creasePattern.document'
        ) as unknown as OristudioCpDocumentSnapshot,
        source: validateSource(creasePattern.source) ?? validateImportedSource(creasePattern.source),
        foldProjection: isRecord(creasePattern.foldProjection)
          ? (creasePattern.foldProjection as unknown as FoldDocument)
          : null,
        sourceFold: isRecord(creasePattern.sourceFold)
          ? (creasePattern.sourceFold as unknown as FoldDocument)
          : null,
        lineage: isRecord(creasePattern.lineage)
          ? normalizeCpLineage(creasePattern.lineage)
          : importedCpLineage(),
        // Absent in v1/v2 files → []. Invalid entries are dropped, not thrown.
        images: validateCpImages(creasePattern.images),
        // Absent before schema v4 → []. Invalid entries are dropped, not thrown.
        textAnnotations: validateTextAnnotations(creasePattern.textAnnotations),
        inlineSimulations: validateInlineSimulations(creasePattern.inlineSimulations),
      },
      viewState: {
        creaseColorMode:
          viewState.creaseColorMode === 'agrh' || viewState.creaseColorMode === 'mvf'
            ? viewState.creaseColorMode
            : 'mvf',
        selection: isRecord(viewState.selection)
          ? (viewState.selection as unknown as OristudioCpSelection)
          : {
              lines: [],
              points: [],
              circles: [],
              texts: [],
              faces: [],
            },
        viewport: isRecord(viewState.viewport)
          ? (viewState.viewport as unknown as OristudioCpViewportOptions)
          : ({} as OristudioCpViewportOptions),
        // Absent before schema v7 → null, i.e. auto-fit. A malformed camera is
        // dropped rather than thrown, like every other viewState field.
        camera: validateUserCamera(viewState.camera),
        foldedFigures,
        activeFoldedFigureId: activeFoldedFigureId(
          foldedFigures,
          typeof viewState.activeFoldedFigureId === 'string'
            ? viewState.activeFoldedFigureId
            : null
        ),
      },
      extensions,
    };
  }

  if (kind === 'box-pleat') {
    const project = recordField(document.project, 'document.project');
    const engine = stringField(project.engine, 'document.project.engine');
    if (engine !== 'oristudio-bp') {
      throw new ProjectFileFormatError(
        'project_file_damaged',
        `Unsupported box-pleat engine ${JSON.stringify(engine)}`
      );
    }
    const format = stringField(project.format, 'document.project.format');
    if (format !== 'bps') {
      throw new ProjectFileFormatError(
        'project_file_damaged',
        `Unsupported box-pleat project format ${format}`
      );
    }
    return {
      id,
      kind,
      title,
      source,
      project: {
        engine,
        format: 'bps',
        text: stringField(project.text, 'document.project.text'),
      },
      symmetry: validateBpDocumentSymmetry(document.symmetry) ?? defaultBpDocumentSymmetry(),
      extensions,
    };
  }

  throw new ProjectFileFormatError(
    'project_file_damaged',
    `Unsupported Ori Studio document kind ${JSON.stringify(kind)}`
  );
}

function validateActor(value: Record<string, unknown>): NativeProjectActor {
  return {
    app: 'Ori Studio',
    version: stringField(value.version, 'actor.version'),
    savedAt: stringField(value.savedAt, 'actor.savedAt'),
  };
}

function validateSource(value: unknown): NativeProjectSource | null {
  if (value === null || value === undefined || !isRecord(value)) return null;
  const format = value.format;
  if (
    format !== 'osf' &&
    format !== 'tmd' &&
    format !== 'tmd4' &&
    format !== 'tmd5' &&
    format !== 'cp' &&
    format !== 'fold' &&
    format !== 'ori' &&
    format !== 'orh'
  ) {
    return null;
  }
  return {
    format,
    filename: stringField(value.filename, 'source.filename'),
    path: typeof value.path === 'string' ? value.path : null,
  };
}

function validateImportedSource(value: unknown): ImportedCreasePatternSource | null {
  if (value === null || value === undefined || !isRecord(value)) return null;
  const format = value.format;
  if (format !== 'cp' && format !== 'fold' && format !== 'ori' && format !== 'orh') return null;
  return {
    format,
    filename: stringField(value.filename, 'source.filename'),
    path: typeof value.path === 'string' ? value.path : null,
  };
}

function validateArtifacts(value: unknown): NativeProjectFileV1['artifacts'] {
  if (!isRecord(value)) return {};
  const fold = isRecord(value.fold) ? value.fold : null;
  if (!fold) return {};
  return {
    fold: {
      documentId: stringField(fold.documentId, 'artifacts.fold.documentId'),
      value: recordField(fold.value, 'artifacts.fold.value') as unknown as FoldArtifacts,
    },
  };
}

function recordField(value: unknown, field: string): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw new ProjectFileFormatError(
    'project_file_damaged',
    `Ori Studio project field ${field} must be an object`
  );
}

function arrayField(value: unknown, field: string): unknown[] {
  if (Array.isArray(value)) return value;
  throw new ProjectFileFormatError(
    'project_file_damaged',
    `Ori Studio project field ${field} must be an array`
  );
}

function stringField(value: unknown, field: string): string {
  if (typeof value === 'string') return value;
  throw new ProjectFileFormatError(
    'project_file_damaged',
    `Ori Studio project field ${field} must be a string`
  );
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pointField(value: unknown): Point | null {
  if (!isRecord(value)) return null;
  const x = numberField(value.x);
  const y = numberField(value.y);
  return x === null || y === null ? null : { x, y };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
