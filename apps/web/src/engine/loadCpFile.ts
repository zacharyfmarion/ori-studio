/**
 * A crease-pattern file's text loaded into the CP kernel by its format, as
 * Edit opens one: the one dispatch Edit's own document, an import added to
 * it, and a task session of its own (the title block's uploaded pattern,
 * `diagram/pages/titleBlockPatternFile.ts`) all go through, so a file reads
 * the same wherever it is opened.
 */
import type { ImportedCreasePatternFormat } from '../lib/fileFormats';

/** The kernel's loaders a file needs, whichever client holds them: Edit's, or a task session's. */
export interface CpFileLoaders {
  loadCp(text: string, title?: string): Promise<number>;
  loadOri(text: string, acceptUnknownVersion?: boolean): Promise<number>;
  loadOrh(text: string): Promise<number>;
  loadFoldFile(text: string): Promise<number>;
}

/**
 * `text` loaded as a `format` file, and the handle of the document it made.
 * A `.cp` takes the title it is shown with; an `.ori` of a version the kernel
 * does not know loads only where `acceptUnknownVersion` asks it to. Rejects
 * as the kernel does for a file that does not read.
 */
export function loadCpFile(
  api: CpFileLoaders,
  format: ImportedCreasePatternFormat,
  text: string,
  options: { title: string; acceptUnknownVersion?: boolean }
): Promise<number> {
  switch (format) {
    case 'cp':
      return api.loadCp(text, options.title);
    case 'ori':
      return api.loadOri(text, options.acceptUnknownVersion ?? false);
    case 'orh':
      return api.loadOrh(text);
    case 'fold':
      return api.loadFoldFile(text);
  }
}

/** The title a file's document is shown with: its name without the extension a crease pattern or project has. */
export function titleFromFilename(filename: string): string {
  return filename.replace(/\.(cp|fold|ori|orh|osf)$/i, '') || 'Untitled';
}
