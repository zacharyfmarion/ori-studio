import { importedCreasePatternFormat, type ImportedCreasePatternFormat } from './creasePatternImport';
import { NATIVE_PROJECT_EXTENSION } from './nativeProjectFile';

/**
 * What a dropped file is, and what the app can do with it.
 *
 * Documents are classified by extension rather than MIME type: `.cp`, `.fold`,
 * `.ori`, and `.orh` all report an empty or `application/octet-stream` type, so
 * the extension is the only usable signal — and it is what every other file
 * route in the app keys off too (`isNativeProjectFilename`,
 * `isCreasePatternFilename`, `importedCreasePatternFormat`).
 */
export type DroppedFileKind =
  | { kind: 'project' }
  | { kind: 'box-pleat' }
  | { kind: 'tree' }
  | { kind: 'crease-pattern'; format: ImportedCreasePatternFormat }
  | { kind: 'image' }
  | { kind: 'unsupported' };

/**
 * Extensions File ▸ Open accepts, in the order its dialog filter lists them.
 * `openProject` consumes this list, so the set a drop understands and the set
 * the Open dialog offers cannot drift apart.
 */
export const OPENABLE_FILE_EXTENSIONS = [
  NATIVE_PROJECT_EXTENSION,
  'tmd',
  'tmd4',
  'tmd5',
  'fold',
  'cp',
  'ori',
  'orh',
  'bps',
] as const;

const CREASE_PATTERN_EXTENSIONS = new Set(['fold', 'cp', 'ori', 'orh']);
const TREE_EXTENSIONS = new Set(['tmd', 'tmd4', 'tmd5']);

/** Lowercased extension without the dot, or `''` when the name carries none. */
export function droppedFileExtension(filename: string): string {
  const match = /\.([^.\\/]+)$/.exec(filename);
  return match ? match[1].toLowerCase() : '';
}

export function classifyDroppedFile(file: File): DroppedFileKind {
  // MIME first for images: it is authoritative for a browser `File`, and it is
  // the same test the crease-pattern viewport's reference-image drop uses.
  if (file.type.startsWith('image/')) return { kind: 'image' };

  const extension = droppedFileExtension(file.name);
  if (extension === NATIVE_PROJECT_EXTENSION) return { kind: 'project' };
  if (extension === 'bps') return { kind: 'box-pleat' };
  if (TREE_EXTENSIONS.has(extension)) return { kind: 'tree' };
  if (CREASE_PATTERN_EXTENSIONS.has(extension)) {
    return { kind: 'crease-pattern', format: importedCreasePatternFormat(file.name) };
  }
  // Covers dropped folders too: they arrive as a zero-byte entry with an empty
  // type and no extension, and are refused here before anything tries to read
  // them.
  return { kind: 'unsupported' };
}

/** True for the kinds that can be opened as a document. */
export function isOpenableKind(kind: DroppedFileKind): boolean {
  return (
    kind.kind === 'project' ||
    kind.kind === 'box-pleat' ||
    kind.kind === 'tree' ||
    kind.kind === 'crease-pattern'
  );
}

/** Where the drop landed, which decides whether merging is even on offer. */
export type DropTargetPolicy = 'open-only' | 'open-or-import';

export type DropRejectReason = 'unsupported-file' | 'image-not-here';

/**
 * What to do with a drop.
 *
 * `choose` means the file could either replace the current document or be
 * merged into it, and only the user can say which — the controller raises the
 * choice dialog. `warnsDiscard` rides along on both document outcomes because
 * the open path is destructive whenever the project is dirty, and the drop
 * prompt states that consequence itself rather than deferring to a second
 * modal.
 */
export type DropDecision =
  | { outcome: 'reject'; reason: DropRejectReason }
  | { outcome: 'open'; warnsDiscard: boolean }
  | { outcome: 'choose'; warnsDiscard: boolean };

export interface DropDecisionInput {
  kind: DroppedFileKind;
  policy: DropTargetPolicy;
  /** Capability `file.importAdd` — an editable crease pattern is loaded and idle. */
  canImportAdd: boolean;
  dirty: boolean;
}

export function resolveDropDecision({
  kind,
  policy,
  canImportAdd,
  dirty,
}: DropDecisionInput): DropDecision {
  if (kind.kind === 'unsupported') {
    return { outcome: 'reject', reason: 'unsupported-file' };
  }
  // The crease-pattern viewport consumes image drops before they reach a
  // file-drop target, so an image arriving here landed somewhere that has
  // nothing to place it on.
  if (kind.kind === 'image') {
    return { outcome: 'reject', reason: 'image-not-here' };
  }

  const mergeable = kind.kind === 'crease-pattern';
  if (mergeable && policy === 'open-or-import' && canImportAdd) {
    return { outcome: 'choose', warnsDiscard: dirty };
  }
  return { outcome: 'open', warnsDiscard: dirty };
}

export interface DroppedSelection {
  file: File;
  kind: DroppedFileKind;
  /** Files dropped alongside this one, which are ignored. */
  ignoredCount: number;
}

/**
 * The one file a drop acts on: the first openable document, or — when the drop
 * carried none — the first file, so the refusal can name something real.
 */
export function selectDroppedFile(files: readonly File[]): DroppedSelection | null {
  if (files.length === 0) return null;
  const documentIndex = files.findIndex((file) => isOpenableKind(classifyDroppedFile(file)));
  const file = files[documentIndex >= 0 ? documentIndex : 0];
  return {
    file,
    kind: classifyDroppedFile(file),
    ignoredCount: files.length - 1,
  };
}

/**
 * True when a drag carries only images. Read from `DataTransfer.items`, which is
 * the only thing readable during `dragover` — `files` is withheld until drop, so
 * this is all the affordance can know about an in-flight drag.
 */
export function isImageOnlyDrag(items: DataTransferItemList | null): boolean {
  if (!items) return false;
  const entries = Array.from(items).filter((item) => item.kind === 'file');
  return entries.length > 0 && entries.every((item) => item.type.startsWith('image/'));
}

/** True when a drag carries files at all — anything else is an in-page drag. */
export function dragCarriesFiles(types: readonly string[]): boolean {
  return types.includes('Files');
}
