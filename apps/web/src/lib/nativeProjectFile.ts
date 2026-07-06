import type { FoldArtifacts, FoldDocument } from '../engine/types';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureStatus,
} from '../engine/oristudioCpTypes';
import type { ImportedCreasePatternSource } from './creasePatternImport';
import type { Point } from './geometry';
import type { CreaseColorMode, DocumentMode } from './sampleProject';
import type { OristudioCpSelection, OristudioCpViewportOptions } from './creasePatternViewport';
import {
  importedCpLineage,
  normalizeCpLineage,
  type OristudioCpLineage,
} from './oristudioCpLineage';
import {
  defaultOristudioCpSymmetry,
  normalizeOristudioCpSymmetry,
  type OristudioCpSymmetryState,
} from './oristudioCpSymmetry';

export const NATIVE_PROJECT_FORMAT = 'oristudio.project';
export const NATIVE_PROJECT_EXTENSION = 'osf';
export const NATIVE_PROJECT_MIME_TYPE = 'application/vnd.oristudio.project+json';
export const NATIVE_PROJECT_SCHEMA_VERSION = 2;

export type NativeProjectDocumentKind = 'treemaker-tree' | 'crease-pattern';

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
  };
  viewState: {
    creaseColorMode: CreaseColorMode;
    selection: OristudioCpSelection;
    viewport: OristudioCpViewportOptions;
    symmetry: OristudioCpSymmetryState;
    foldedFigures: OristudioCpFoldedFigureEntry[];
    activeFoldedFigureId: string | null;
  };
}

export type NativeProjectDocumentV1 = NativeTreeDocumentV1 | NativeCreasePatternDocumentV1;

export interface NativeProjectFileV1 {
  format: typeof NATIVE_PROJECT_FORMAT;
  schemaVersion: 1 | 2;
  minimumReaderSchemaVersion: 1;
  createdBy: NativeProjectActor;
  modifiedBy: NativeProjectActor;
  workspace: {
    id: string;
    title: string;
    activeDocumentId: string;
    activeMode: DocumentMode;
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
  symmetry: OristudioCpSymmetryState;
  foldedFigures: OristudioCpFoldedFigureEntry[];
  activeFoldedFigureId: string | null;
  lineage: OristudioCpLineage;
  appVersion: string;
  now?: Date;
}

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
    throw new Error(error instanceof Error ? error.message : 'Invalid Ori Studio project JSON', {
      cause: error,
    });
  }
  return migrateNativeProjectFile(parsed);
}

export function migrateNativeProjectFile(value: unknown): NativeProjectFile {
  if (!isRecord(value)) throw new Error('Ori Studio project must contain a JSON object');
  if (value.format !== NATIVE_PROJECT_FORMAT) {
    throw new Error('File is not an Ori Studio project');
  }

  const minimumReaderSchemaVersion = numberField(value.minimumReaderSchemaVersion);
  if (
    minimumReaderSchemaVersion !== null &&
    minimumReaderSchemaVersion > NATIVE_PROJECT_SCHEMA_VERSION
  ) {
    throw new Error(
      `Ori Studio project requires reader schema ${minimumReaderSchemaVersion}, but this app supports ${NATIVE_PROJECT_SCHEMA_VERSION}`
    );
  }

  const schemaVersion = numberField(value.schemaVersion);
  if (schemaVersion === 1 || schemaVersion === 2) return validateV1(value);
  if (schemaVersion === null) throw new Error('Ori Studio project is missing schemaVersion');
  throw new Error(`Unsupported Ori Studio project schemaVersion ${schemaVersion}`);
}

export function createNativeTreeProjectFile(input: NativeTreeProjectInput): NativeProjectFileV1 {
  const actor = actorFromInput(input);
  const title = input.title.trim() || 'Untitled';
  return {
    format: NATIVE_PROJECT_FORMAT,
    schemaVersion: 2,
    minimumReaderSchemaVersion: 1,
    createdBy: actor,
    modifiedBy: actor,
    workspace: {
      id: 'workspace',
      title,
      activeDocumentId: 'tree',
      activeMode: 'tree',
      documents: [
        {
          id: 'tree',
          kind: 'treemaker-tree',
          title,
          source: sourceFromFilename(input.filename, input.path),
          tree: {
            format: 'tmd5',
            text: input.tmd5Text,
          },
          extensions: {},
        },
        ...(input.creasePatternCompanion
          ? [
              createNativeCreasePatternDocument(
                {
                  ...input.creasePatternCompanion,
                  filename: input.filename,
                  path: input.path,
                  appVersion: input.appVersion,
                  now: input.now,
                },
                'generated-crease-pattern'
              ),
            ]
          : []),
      ],
      viewState: {},
    },
    artifacts: {},
    extensions: {},
  };
}

export function createNativeCreasePatternProjectFile(
  input: NativeCreasePatternProjectInput
): NativeProjectFileV1 {
  const actor = actorFromInput(input);
  const title = input.title.trim() || input.document.title || 'Untitled CP';
  return {
    format: NATIVE_PROJECT_FORMAT,
    schemaVersion: 2,
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
    },
    viewState: {
      creaseColorMode: input.creaseColorMode,
      selection: input.selection,
      viewport: input.viewport,
      symmetry: normalizeOristudioCpSymmetry(input.symmetry),
      foldedFigures: nativeFoldedFigures(input.foldedFigures),
      activeFoldedFigureId: activeFoldedFigureId(
        input.foldedFigures,
        input.activeFoldedFigureId
      ),
    },
    extensions: {},
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
  const displayOffset = pointField(entry.displayOffset);
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
    ...(displayOffset ? { displayOffset } : {}),
    error: typeof entry.error === 'string' ? entry.error : null,
  };
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
  if (!active) throw new Error('Ori Studio project does not contain any documents');
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
  if (activeMode !== 'tree' && activeMode !== 'crease-pattern') {
    throw new Error(`Unsupported Ori Studio activeMode ${JSON.stringify(activeMode)}`);
  }
  if (!documents.some((document) => document.id === activeDocumentId)) {
    throw new Error('Ori Studio project activeDocumentId does not match a document');
  }

  return {
    format: NATIVE_PROJECT_FORMAT,
    schemaVersion: 2,
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
    if (format !== 'tmd5') throw new Error(`Unsupported tree document format ${format}`);
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
      throw new Error(`Unsupported crease-pattern engine ${JSON.stringify(engine)}`);
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
              vertices: [],
              points: [],
              circles: [],
              texts: [],
              faces: [],
            },
        viewport: isRecord(viewState.viewport)
          ? (viewState.viewport as unknown as OristudioCpViewportOptions)
          : ({} as OristudioCpViewportOptions),
        symmetry: isRecord(viewState.symmetry)
          ? normalizeOristudioCpSymmetry(viewState.symmetry)
          : defaultOristudioCpSymmetry(),
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

  throw new Error(`Unsupported Ori Studio document kind ${JSON.stringify(kind)}`);
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
  throw new Error(`Ori Studio project field ${field} must be an object`);
}

function arrayField(value: unknown, field: string): unknown[] {
  if (Array.isArray(value)) return value;
  throw new Error(`Ori Studio project field ${field} must be an array`);
}

function stringField(value: unknown, field: string): string {
  if (typeof value === 'string') return value;
  throw new Error(`Ori Studio project field ${field} must be a string`);
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
