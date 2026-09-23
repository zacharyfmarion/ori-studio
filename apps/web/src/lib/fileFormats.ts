/**
 * The file formats Ori Studio opens, named without the parsers that read them.
 *
 * A leaf on purpose: the landing page lists these formats, and importing them from
 * `nativeProjectFile` or `creasePatternImport` put the whole import pipeline in its bundle.
 * Those modules re-export from here, so every existing import keeps working.
 */

export const NATIVE_PROJECT_EXTENSION = 'osf';

export type ImportedCreasePatternFormat = 'fold' | 'cp' | 'ori' | 'orh';

export function importedCreasePatternFormat(filename: string): ImportedCreasePatternFormat {
  if (/\.cp$/i.test(filename)) return 'cp';
  if (/\.ori$/i.test(filename)) return 'ori';
  if (/\.orh$/i.test(filename)) return 'orh';
  return 'fold';
}

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

/** File ▸ Open's dialog. The start screen opens the same one before the workspace has loaded. */
export const OPEN_PROJECT_DIALOG = {
  title: 'Open Ori Studio Project or Crease Pattern',
  extensions: [...OPENABLE_FILE_EXTENSIONS],
};
