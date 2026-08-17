import { designKindRegistry } from '../designKinds';
import type { Mat3 } from '@treemaker/origami-simulator';
import type { FoldArtifacts, FoldDocument } from '../engine/types';
import {
  CREASE_PATTERN_DOCUMENT_ID,
  isReservedDocumentId,
  type NativeDesignDocumentV8,
} from './nativeProjectDesigns';
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
export const NATIVE_PROJECT_SCHEMA_VERSION = 8;

export type NativeProjectDocumentKind =
  | 'treemaker-tree'
  | 'crease-pattern'
  | 'box-pleat'
  | 'explori';

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
  schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  /**
   * The oldest reader that can open this file without losing data.
   *
   * `1` for anything a v1–v7 build could read losslessly; `8` once the file
   * holds more than the old format could express. Declarative only in practice —
   * a v7 build already rejects `schemaVersion: 8` because 8 is not in its
   * enumerated list — but it is what makes the refusal say *why*.
   */
  minimumReaderSchemaVersion: 1 | 8;
  createdBy: NativeProjectActor;
  modifiedBy: NativeProjectActor;
  workspace: {
    id: string;
    title: string;
    /**
     * The design tab that was active. Stored, not derived: v1–v7 inferred it
     * from `activeMode` + document kind, which cannot name one of two designs
     * of the same kind.
     */
    activeDocumentId: string;
    /**
     * Legacy focus hint. Read during migration, where it is the only signal for
     * which design was active; **not written** in v8, where `activeDocumentId`
     * says it directly and a second source of truth would only drift.
     */
    activeMode?: NativeProjectActiveMode;
    /**
     * The design tabs, in tab order, plus at most one crease-pattern document
     * under the reserved id.
     */
    designs: NativeDesignDocumentV8[];
    creasePattern: NativeCreasePatternDocumentV1 | null;
    /**
     * Design documents whose `kind` this build does not recognize.
     *
     * Kept verbatim and re-emitted on save. A file written by a build with a
     * design kind this one lacks opens, shows the tabs it understands, and does
     * not silently destroy the rest on the next save.
     */
    unknownDesigns: unknown[];
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

export type NativeProjectFileV8 = NativeProjectFileV1;
export type NativeProjectFile = NativeProjectFileV8;

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
  /**
   * Design documents of a kind this build cannot read, carried through verbatim.
   *
   * Same forward-compatibility contract as the design writer's: a project saved
   * by a newer build may hold designs this one has no descriptor for, and
   * dropping them here would delete a user's work on a round trip through an
   * older version. Defaults to `[]`.
   */
  unknownDesigns?: unknown[];
  /** File-level extension bag, carried forward for the same reason. */
  fileExtensions?: Record<string, unknown>;
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
/** One design tab, ready to write. */
export interface NativeDesignInput {
  /** The tab's id. Round-trips, so tab identity survives a save/open cycle. */
  id: string;
  title: string;
  /** Design kind id — validated against the registry on read. */
  kind: string;
  /** Codec output. */
  text: string;
  /** Dialect label for diagnostics (`tmd5`, `bps`). */
  format: string;
  viewState?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

export interface NativeProjectDocumentsInput {
  /** Workspace-level title (usually the active document's title). */
  workspaceTitle: string;
  filename: string;
  path: string | null;
  /** Design tabs, in tab order. */
  designs: NativeDesignInput[];
  /** Which design tab was active. */
  activeDesignId?: string;
  /** Unrecognized design documents carried forward from a loaded file. */
  unknownDesigns?: unknown[];
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

/**
 * v1–v7 document ids, kept as constants because the legacy migration preserves
 * them **verbatim** as tab ids rather than renumbering to `design-N`.
 *
 * Renumbering would look tidier and would be wrong: the id is the registry key
 * and the `.osf` identity, so rewriting it on open would detach a design from
 * anything that referenced it. It also means tab ids are not always `design-N`,
 * which `nextDesignTabId` handles by taking the tabs already present.
 */
const LEGACY_TREE_DOCUMENT_ID = 'tree';
const LEGACY_BOX_PLEAT_DOCUMENT_ID = 'box-pleat';

export function isNativeProjectFilename(filename: string): boolean {
  return /\.osf$/i.test(filename);
}

/**
 * Write a project file.
 *
 * Designs this build could not read are written back **into `workspace.designs`**,
 * beside the ones it could, rather than left in the `unknownDesigns` field they
 * were parked in.
 *
 * That field is an in-memory distinction — "designs I can open" versus "designs I
 * am only carrying" — and the reader has no use for it: `validateV8` builds
 * `unknownDesigns` by scanning `workspace.designs` for kinds it does not know,
 * and never reads the field itself. Writing them there and only there meant a
 * design survived exactly one save and then vanished, including for the build
 * that *could* read it. Merging here makes the file the union it is supposed to
 * be, and costs nothing for the common case of having none.
 */
export function serializeNativeProjectFile(file: NativeProjectFile): string {
  const unknown = 'workspace' in file ? (file.workspace.unknownDesigns ?? []) : [];
  const written =
    unknown.length === 0
      ? file
      : {
          ...file,
          workspace: {
            ...file.workspace,
            designs: [...file.workspace.designs, ...unknown],
            unknownDesigns: [],
          },
        };
  return `${JSON.stringify(written, null, 2)}\n`;
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
  if (schemaVersion === NATIVE_PROJECT_SCHEMA_VERSION) {
    return validateV8(value);
  }
  if (
    schemaVersion === 1 ||
    schemaVersion === 2 ||
    schemaVersion === 3 ||
    schemaVersion === 4 ||
    schemaVersion === 5 ||
    schemaVersion === 6 ||
    schemaVersion === 7
  ) {
    return migrateLegacyToV8(value);
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

/**
 * Serialize a whole workspace: N design tabs in order, plus the one crease
 * pattern the Edit canvas holds.
 *
 * `minimumReaderSchemaVersion` is 8 only when the file actually needs it — more
 * than one design, or a design of a kind the old shape could not name. A file a
 * v1–v7 build could still read losslessly keeps 1, so updating this app does not
 * strand every project a user has.
 */
export function createNativeProjectFile(
  input: NativeProjectDocumentsInput
): NativeProjectFileV8 {
  const actor = actorFromInput(input);
  const designs: NativeDesignDocumentV8[] = input.designs.map((design) => ({
    id: design.id,
    title: design.title.trim() || 'Untitled Design',
    payload: { kind: design.kind, text: design.text, format: design.format },
    viewState: design.viewState ?? {},
    extensions: design.extensions ?? {},
  }));

  const creasePattern = input.creasePattern
    ? createNativeCreasePatternDocument(
        {
          ...input.creasePattern,
          filename: input.filename,
          path: input.path,
          appVersion: input.appVersion,
          now: input.now,
        },
        CREASE_PATTERN_DOCUMENT_ID
      )
    : null;

  const legacyReadable =
    designs.length <= 1 && (input.unknownDesigns?.length ?? 0) === 0;

  return {
    format: NATIVE_PROJECT_FORMAT,
    schemaVersion: NATIVE_PROJECT_SCHEMA_VERSION,
    minimumReaderSchemaVersion: legacyReadable ? 1 : 8,
    createdBy: actor,
    modifiedBy: actor,
    workspace: {
      id: 'workspace',
      title: input.workspaceTitle.trim() || 'Untitled',
      activeDocumentId: input.activeDesignId ?? designs[0]?.id ?? CREASE_PATTERN_DOCUMENT_ID,
      designs,
      creasePattern,
      // Re-emitted verbatim so a design kind this build does not know survives a
      // round trip through it.
      unknownDesigns: input.unknownDesigns ?? [],
      viewState: {},
    },
    artifacts: {},
    extensions: input.extensions ?? {},
  };
}

export function createNativeTreeProjectFile(input: NativeTreeProjectInput): NativeProjectFileV8 {
  return createNativeProjectFile({
    workspaceTitle: input.title,
    filename: input.filename,
    path: input.path,
    designs: [
      {
        id: LEGACY_TREE_DOCUMENT_ID,
        title: input.title,
        kind: 'treemaker',
        text: input.tmd5Text,
        format: 'tmd5',
      },
    ],
    creasePattern: input.creasePatternCompanion ?? null,
    appVersion: input.appVersion,
    now: input.now,
  });
}

export function createNativeBoxPleatProjectFile(
  input: NativeBoxPleatProjectInput
): NativeProjectFileV8 {
  return createNativeProjectFile({
    workspaceTitle: input.title,
    filename: input.filename,
    path: input.path,
    designs: [
      {
        id: LEGACY_BOX_PLEAT_DOCUMENT_ID,
        title: input.title,
        kind: 'box-pleat',
        text: input.bps,
        format: 'bps',
        viewState: {
          symmetry: bpDocumentSymmetry(input.symmetry ?? defaultBpDocumentSymmetry()),
        },
      },
    ],
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
    // An unreadable design is exactly the case an older build must refuse, for
    // the same reason the design writer raises the bar: it cannot round-trip
    // what it cannot parse.
    minimumReaderSchemaVersion: (input.unknownDesigns?.length ?? 0) > 0 ? 8 : 1,
    createdBy: actor,
    modifiedBy: actor,
    workspace: {
      id: 'workspace',
      title,
      activeDocumentId: CREASE_PATTERN_DOCUMENT_ID,
      // A crease pattern is not a design: it holds no design tabs at all. Designs
      // of a kind this build cannot read are a different matter — they are not
      // "no designs", they are designs it must not touch — so they ride through.
      designs: [],
      creasePattern: createNativeCreasePatternDocument(input, CREASE_PATTERN_DOCUMENT_ID),
      unknownDesigns: input.unknownDesigns ?? [],
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
    extensions: input.fileExtensions ?? {},
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

/**
 * Read one folded figure back.
 *
 * **This function is the drop.** The writer spreads `...entry`, so anything on a
 * figure is written; this builds an explicit literal, so anything *not named
 * here* silently vanishes on the way back in with no type error to show for it.
 * `contradiction` was lost that way for months. A field added to
 * `OristudioCpFoldedFigureEntry` has to be added here too, and the round-trip
 * test in `nativeProjectFile.test.ts` is what says so.
 */
function validateFoldedFigure(value: unknown, index: number): OristudioCpFoldedFigureEntry {
  const entry = recordField(value, `document.viewState.foldedFigures[${index}]`);
  const snapshot = isRecord(entry.snapshot)
    ? (entry.snapshot as unknown as OristudioCpFoldedFigureEntry['snapshot'])
    : null;
  const folded3d = isRecord(entry.folded3d)
    ? (entry.folded3d as unknown as OristudioCpFoldedFigureEntry['folded3d'])
    : null;
  return {
    id: stringField(entry.id, `document.viewState.foldedFigures[${index}].id`),
    title: stringField(entry.title, `document.viewState.foldedFigures[${index}].title`),
    handle: null,
    sourceKind: foldedFigureSourceKind(entry.sourceKind, folded3d != null),
    sourceCpRevision: numberField(entry.sourceCpRevision),
    startingFaceId: numberField(entry.startingFaceId),
    displayStyle:
      foldedFigureDisplayStyle(entry.displayStyle) ??
      foldedFigureDisplayStyle(snapshot?.display_style) ??
      'Paper5',
    status: foldedFigureStatus(entry.status),
    // Exactly one of the two is the witness of what kind of figure this is, and
    // both being set is a state the rest of the app has no branch for. A file
    // holding both is damaged rather than ambiguous, so the flat one — the older
    // field, and the one a 3D figure never writes — loses.
    snapshot: folded3d != null ? null : snapshot,
    folded3d,
    renderSnapshot: isRecord(entry.renderSnapshot)
      ? (entry.renderSnapshot as unknown as OristudioCpFoldedFigureEntry['renderSnapshot'])
      : null,
    placement: foldedFigurePlacement(entry),
    // The viewpoint the stored picture was taken at. It cannot be *applied* on
    // load — re-projecting needs the render model, which is deliberately not
    // persisted — but it is what a refold restores, so losing it would silently
    // move the figure the first time it is refolded.
    camera: foldedFigureCamera(entry.camera),
    // The frame the figure draws inside. Persisted rather than recomputed for
    // the same reason as the camera — it comes from the render model, which is
    // not persisted — and a figure that lost it would fall back to the
    // projection's own bounds and start resizing as it turns again.
    frameRadius: positiveNumber(entry.frameRadius),
    sourceBounds: foldedSourceBoundsField(entry.sourceBounds),
    sourceFingerprint:
      typeof entry.sourceFingerprint === 'string' ? entry.sourceFingerprint : null,
    sourceLineIds: Array.isArray(entry.sourceLineIds)
      ? entry.sourceLineIds.filter((id): id is number => typeof id === 'number')
      : [],
    // Falls back to the folded set rather than to empty: a file written before
    // this field existed still has one honest answer for "which creases was this
    // scoped to", and an empty list would silently disable "simulate instead".
    sourceScopedLineIds: Array.isArray(entry.sourceScopedLineIds)
      ? entry.sourceScopedLineIds.filter((id): id is number => typeof id === 'number')
      : Array.isArray(entry.sourceLineIds)
        ? entry.sourceLineIds.filter((id): id is number => typeof id === 'number')
        : [],
    error: typeof entry.error === 'string' ? entry.error : null,
    contradiction: isRecord(entry.contradiction)
      ? (entry.contradiction as unknown as OristudioCpFoldedFigureEntry['contradiction'])
      : null,
  };
}

/** The stored viewpoint of a 3D figure. Absent on every flat one. */
function foldedFigureCamera(value: unknown): OristudioCpFoldedFigureEntry['camera'] {
  if (!isRecord(value)) return null;
  const yaw = finiteNumber(value.yaw);
  const pitch = finiteNumber(value.pitch);
  const zoom = positiveNumber(value.zoom);
  if (yaw === null || pitch === null || zoom === null) return null;
  const orient = foldedFigureOrient(value.orient);
  return orient ? { yaw, pitch, zoom, orient } : { yaw, pitch, zoom };
}

/**
 * A figure's model orientation — which way it was told is up.
 *
 * Absent on every file written before the verb existed, and absent on any figure
 * nobody has set an upright on, so "missing" has to mean identity rather than
 * an error. That is what lets this ride in without a schema bump: an old `.osf`
 * opens at exactly the camera it always did.
 *
 * Dropped whole on anything malformed, like the canvas camera beside it. A
 * partly-read rotation is not a rotation, and half a basis would draw a sheared
 * figure that looks like a kernel bug.
 */
function foldedFigureOrient(value: unknown): Mat3 | null {
  if (!Array.isArray(value) || value.length !== 9) return null;
  const out: number[] = [];
  for (const entry of value) {
    const n = finiteNumber(entry);
    if (n === null) return null;
    out.push(n);
  }
  return out as unknown as Mat3;
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
  if (value === 'ready' || value === 'stale' || value === 'loading' || value === 'error') {
    return value === 'loading' ? 'stale' : value;
  }
  // Anything else — including the retired `'unsupported'` a much older build
  // could in principle have written — reads as stale, which is the safe answer:
  // it offers a refold rather than claiming the figure is current.
  return 'stale';
}

/**
 * Where a stored figure came from.
 *
 * **Unknown is `'unknown'`, not `'generated-from-current-cp'`.** The old
 * fallback was the one value that makes a figure look refoldable from the
 * document's live creases, so a figure written by a newer build with a kind this
 * one has never heard of would be offered a Refold — through whichever folder
 * this build happens to have. `'unknown'` fails the
 * `isFoldedFromCurrentCpSourceKind` test instead, so the figure draws from its
 * stored picture and offers nothing it cannot do.
 *
 * `hasFolded3d` repairs the one case this build can be sure about: a file
 * written before `'generated-3d'` existed, carrying a 3D snapshot under the flat
 * kind. The witness on the entry outranks the label beside it.
 */
function foldedFigureSourceKind(
  value: unknown,
  hasFolded3d: boolean
): OristudioCpFoldedFigureEntry['sourceKind'] {
  if (hasFolded3d) return 'generated-3d';
  if (
    value === 'generated-from-current-cp' ||
    // Kept even with no `folded3d` beside it, which means the file went through
    // a reader that did not know the field and dropped it. The kind is still
    // true about where the figure came from, and it is what keeps Refold on the
    // menu — the only way to get the 3D state back.
    value === 'generated-3d' ||
    value === 'imported-folded-form' ||
    value === 'imported-preserved-frame'
  ) {
    return value;
  }
  // Absent, rather than unrecognised: every file written before provenance was
  // tracked has no kind at all, and those figures really were folded from the
  // document.
  return value === undefined || value === null ? 'generated-from-current-cp' : 'unknown';
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

/**
 * The design tab a file opens on, or null when it holds only a crease pattern.
 *
 * Replaces `activeNativeDocument`, which resolved the active document by *kind*
 * — a question that has no answer once a file can hold two designs of the same
 * kind. v8 stores the id.
 */
export function activeNativeDesign(file: NativeProjectFile): NativeDesignDocumentV8 | null {
  const { designs, activeDocumentId } = file.workspace;
  return designs.find((design) => design.id === activeDocumentId) ?? designs[0] ?? null;
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

/**
 * Read a v8 file.
 *
 * Design documents are validated generically — id, title, and a `{kind, text,
 * format}` payload — with `kind` matched against the design-kind registry. One
 * unrecognized kind does not fail the file: it is preserved verbatim in
 * `unknownDesigns` and re-emitted on save, so a project written by a build with
 * a design kind this one lacks survives a round trip through it.
 */
function validateV8(value: Record<string, unknown>): NativeProjectFileV8 {
  const workspace = recordField(value.workspace, 'workspace');
  const knownKinds = new Set(designKindRegistry().ids as string[]);

  const designs: NativeDesignDocumentV8[] = [];
  const unknownDesigns: unknown[] = [];
  for (const entry of arrayField(workspace.designs, 'workspace.designs')) {
    const document = recordField(entry, 'workspace.designs[]');
    const payload = recordField(document.payload, 'design.payload');
    const kind = stringField(payload.kind, 'design.payload.kind');
    if (!knownKinds.has(kind)) {
      unknownDesigns.push(entry);
      continue;
    }
    const id = stringField(document.id, 'design.id');
    if (isReservedDocumentId(id)) {
      throw new ProjectFileFormatError(
        'project_file_damaged',
        `Design document may not use the reserved id ${JSON.stringify(id)}`
      );
    }
    designs.push({
      id,
      title: stringField(document.title, 'design.title'),
      payload: {
        kind,
        text: stringField(payload.text, 'design.payload.text'),
        format: typeof payload.format === 'string' ? payload.format : 'unknown',
      },
      // Drop-on-malformed, like the crease pattern's viewport and camera: a
      // corrupt pane layout must open with a default layout, never fail the file.
      viewState: isRecord(document.viewState) ? document.viewState : {},
      extensions: isRecord(document.extensions) ? document.extensions : {},
    });
  }

  const creasePattern =
    workspace.creasePattern === null || workspace.creasePattern === undefined
      ? null
      : (validateDocumentV1(workspace.creasePattern) as NativeCreasePatternDocumentV1);

  const activeDocumentId = stringField(workspace.activeDocumentId, 'workspace.activeDocumentId');

  return {
    format: NATIVE_PROJECT_FORMAT,
    schemaVersion: NATIVE_PROJECT_SCHEMA_VERSION,
    minimumReaderSchemaVersion: designs.length > 1 || unknownDesigns.length > 0 ? 8 : 1,
    createdBy: validateActor(recordField(value.createdBy, 'createdBy')),
    modifiedBy: validateActor(recordField(value.modifiedBy, 'modifiedBy')),
    workspace: {
      id: stringField(workspace.id, 'workspace.id'),
      title: stringField(workspace.title, 'workspace.title'),
      // Falls back rather than throwing: an active id naming a design this build
      // could not read is a legitimate consequence of `unknownDesigns`, not
      // corruption.
      activeDocumentId: designs.some((design) => design.id === activeDocumentId)
        ? activeDocumentId
        : (designs[0]?.id ?? CREASE_PATTERN_DOCUMENT_ID),
      designs,
      creasePattern,
      unknownDesigns,
      viewState: isRecord(workspace.viewState) ? workspace.viewState : {},
    },
    artifacts: validateArtifacts(value.artifacts),
    extensions: isRecord(value.extensions) ? value.extensions : {},
  };
}

/**
 * Read a v1–v7 file and lift it into the v8 shape.
 *
 * Document ids migrate **verbatim** — a legacy tree becomes a tab with id
 * `tree`, a box-pleat design a tab with id `box-pleat`. Renumbering them to
 * `design-N` would look tidier and would detach each design from the identity
 * anything else recorded for it.
 */
function migrateLegacyToV8(value: Record<string, unknown>): NativeProjectFileV8 {
  const legacy = validateV1(value);
  const documents = legacy.workspace.documents ?? [];

  const designs: NativeDesignDocumentV8[] = [];
  for (const document of documents) {
    if (document.kind === 'treemaker-tree') {
      designs.push({
        id: document.id,
        title: document.title,
        payload: { kind: 'treemaker', text: document.tree.text, format: document.tree.format },
        viewState: {},
        extensions: document.extensions,
      });
    } else if (document.kind === 'box-pleat') {
      designs.push({
        id: document.id,
        title: document.title,
        payload: { kind: 'box-pleat', text: document.project.text, format: document.project.format },
        // The mirror-draw state was a top-level field on the legacy document;
        // in v8 it rides the design's own view state.
        viewState: { symmetry: document.symmetry },
        extensions: document.extensions,
      });
    }
  }

  const creasePattern =
    (documents.find((document) => document.kind === 'crease-pattern') as
      | NativeCreasePatternDocumentV1
      | undefined) ?? null;

  // `activeMode` is the only signal a legacy file carries for which design was
  // active, which is why it is still read here and no longer written.
  const activeKind = legacy.workspace.activeMode === 'box-pleat' ? 'box-pleat' : 'treemaker';
  const active =
    designs.find((design) => design.payload.kind === activeKind) ?? designs[0] ?? null;

  return {
    ...legacy,
    schemaVersion: NATIVE_PROJECT_SCHEMA_VERSION,
    minimumReaderSchemaVersion: 1,
    workspace: {
      id: legacy.workspace.id,
      title: legacy.workspace.title,
      activeDocumentId: active?.id ?? CREASE_PATTERN_DOCUMENT_ID,
      designs,
      creasePattern,
      unknownDesigns: [],
      viewState: legacy.workspace.viewState,
    },
  };
}

interface LegacyWorkspaceFile extends Omit<NativeProjectFileV8, 'workspace'> {
  workspace: {
    id: string;
    title: string;
    activeDocumentId: string;
    activeMode: NativeProjectActiveMode;
    documents: NativeProjectDocumentV1[];
    viewState: Record<string, unknown>;
  };
}

function validateV1(value: Record<string, unknown>): LegacyWorkspaceFile {
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
  } as LegacyWorkspaceFile;
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
