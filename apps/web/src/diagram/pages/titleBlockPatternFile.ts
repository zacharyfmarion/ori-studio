/**
 * A crease pattern read from a file for the first page's title block
 * (`implementation-plans/diagram-title-block-final-cp.md`): loaded through
 * the CP kernel in a task session of its own, as Edit opens the same file
 * (`loadCpFile`) — Edit's own pattern is never touched — and its lines kept as
 * the asset the block's pattern names (`DiagramCreasePatternAsset`): every
 * line in its role, fitted to `CREASE_PATTERN_ASSET_BOX`, within what a file
 * keeps (`storedSheetThumbnail`). The original file is not kept. A file with
 * no mountain or valley fold is refused: the block draws the final folds.
 */
import { linesSheetThumbnail } from '../../cp-workspace/sheets/linesSheetThumbnail';
import { storedSheetThumbnail } from '../../cp-workspace/sheets/sheetThumbnail';
import { loadCpFile, titleFromFilename } from '../../engine/loadCpFile';
import { decodeCpGeometryToSnapshot } from '../../engine/oristudioCpGeometry';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import { createCpTaskSession, type CpTaskSession } from '../../engines/cpTaskSession';
import { droppedFileExtension } from '../../lib/fileDrop';
import type { ImportedCreasePatternFormat } from '../../lib/fileFormats';
import { CREASE_PATTERN_ASSET_BOX, titleBlockLine, type DiagramCreasePatternAsset } from '../document/diagramDocument';
import { thumbnailJson } from '../document/diagramFile';

/**
 * The files the title block takes a crease pattern from: those the CP
 * kernel's loaders take, as Fold's Import CP offers them
 * (`fold/io/foldImportFiles.ts`), whose module is not imported here since it
 * brings Fold's samples with it.
 */
export const PATTERN_FILE_EXTENSIONS: readonly ImportedCreasePatternFormat[] = ['cp', 'fold', 'ori', 'orh'];

/** A file's format by its extension; null for one no loader takes, which is refused rather than guessed. */
export function patternFileFormat(name: string): ImportedCreasePatternFormat | null {
  const extension = droppedFileExtension(name);
  return (PATTERN_FILE_EXTENSIONS as readonly string[]).includes(extension) ? (extension as ImportedCreasePatternFormat) : null;
}

/** How long a file may take to load before it is given up, ms: the import dialog's limit for the same load. */
const READ_TIMEOUT_MS = 30_000;

/** Why a file gave no crease pattern: it did not read as one, or it has no mountain or valley fold. */
export type PatternFileRefusal = 'unreadable' | 'no-folds';

/** A crease pattern's lines as the asset the title block names. */
export interface PatternFileAsset {
  asset: DiagramCreasePatternAsset;
  /** Lines were left out to keep within what a file takes back: the shortest creases first. */
  trimmed: boolean;
}

/** What a file gave: its asset and the format it was read as, or why none. */
export type PatternFileResult =
  | ({ ok: true; format: ImportedCreasePatternFormat } & PatternFileAsset)
  | { ok: false; reason: PatternFileRefusal };

/**
 * The asset a crease pattern's lines make, by id `id`, named after the file
 * it came from — every line of the document in its role — or why it makes
 * none: no mountain or valley fold among them. Pure.
 */
export function creasePatternAsset(
  document: OristudioCpDocumentSnapshot,
  name: string,
  id: string
): ({ ok: true } & PatternFileAsset) | { ok: false; reason: 'no-folds' } {
  const ids = document.crease_pattern.line_segments.map((_, index) => index + 1);
  const fitted = linesSheetThumbnail(document, ids, CREASE_PATTERN_ASSET_BOX);
  if (!fitted?.strokes.some((stroke) => stroke.role === 'mountain' || stroke.role === 'valley')) {
    return { ok: false, reason: 'no-folds' };
  }
  const pattern = storedSheetThumbnail(fitted);
  const asset: DiagramCreasePatternAsset = {
    id,
    kind: 'crease-pattern',
    name: titleBlockLine(name),
    pattern,
    bytes: thumbnailJson(pattern).length,
  };
  return { ok: true, asset, trimmed: pattern.strokes.length < fitted.strokes.length };
}

/**
 * A file read as a crease pattern for the title block, as the asset `id`:
 * its bytes as text, as Edit reads a file it opens, loaded by its name's
 * extension in a task session closed after. `unreadable` for a name no
 * loader takes, a file the kernel refuses, or one that takes past
 * {@link READ_TIMEOUT_MS}.
 */
export async function readPatternFile(bytes: Uint8Array, name: string, id: string): Promise<PatternFileResult> {
  const format = patternFileFormat(name);
  if (!format) return { ok: false, reason: 'unreadable' };
  const text = new TextDecoder().decode(bytes);
  let session: CpTaskSession | null = null;
  try {
    session = await createCpTaskSession();
    const { client } = session;
    // The session is closed after, which frees every document it loaded.
    const document = await session.run(
      async () => decodeCpGeometryToSnapshot(await client.documentGeometry(await loadCpFile(client, format, text, { title: titleFromFilename(name) }))),
      new AbortController().signal,
      READ_TIMEOUT_MS
    );
    const made = creasePatternAsset(document, name, id);
    return made.ok ? { ...made, format } : made;
  } catch {
    return { ok: false, reason: 'unreadable' };
  } finally {
    await session?.close().catch(() => undefined);
  }
}
